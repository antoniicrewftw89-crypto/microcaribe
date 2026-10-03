// Almacenamiento local cifrado (RNF-01), transacciones atomicas (RNF-02) y sincronizacion diferida (RF-05, RNF-04).
//
// Como funciona:
//  - Todo se guarda en IndexedDB (la base de datos del navegador, sirve sin internet).
//  - Cada registro se cifra con AES-GCM antes de guardarse. La llave sale de tu PIN (PBKDF2).
//    Sin el PIN, lo que hay en el disco son bytes ilegibles.
//  - Cada cambio (ej. un pago + el contador de recibos) se escribe en UNA sola transaccion:
//    o se guarda todo o no se guarda nada. Si el celular se apaga a medias, no queda a medias.
//  - Cada cambio tambien queda en una "bandeja de salida" (outbox) hasta que se sincroniza.

const DB_NAME = 'microcaribe';
const TYPES = ['clients', 'loans', 'payments', 'expenses'];
export const MAX_SYNC_BYTES = 4_500_000; // RNF-04: tope de 5 MB por ciclo, con margen

const enc = new TextEncoder();
const dec = new TextDecoder();

let db = null;
let key = null;
export const data = { clients: [], loans: [], payments: [], expenses: [] };
export let meta = {}; // salt, canary, deviceId, receiptCounter

/* ---------- utilidades ---------- */
const b64 = (buf) => {
  const u = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = (tx) => new Promise((res, rej) => {
  tx.oncomplete = () => res();
  tx.onerror = () => rej(tx.error);
  tx.onabort = () => rej(tx.error || new Error('Transacción cancelada'));
});

/* ---------- apertura ---------- */
export async function init() {
  db = await new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('records', { keyPath: 'key' });
      d.createObjectStore('outbox', { keyPath: 'key' });
      d.createObjectStore('meta', { keyPath: 'k' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const rows = await req(db.transaction('meta').objectStore('meta').getAll());
  meta = Object.fromEntries(rows.map((r) => [r.k, r.v]));
}

export const hasPin = () => !!meta.salt;

/* ---------- cifrado ---------- */
async function derive(pin, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 200_000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
async function seal(obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return { iv, data: ct };
}
async function open(row) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: row.iv }, key, row.data);
  return JSON.parse(dec.decode(pt));
}

async function putMeta(obj) {
  const tx = db.transaction('meta', 'readwrite');
  for (const [k, v] of Object.entries(obj)) tx.objectStore('meta').put({ k, v });
  await done(tx);
  Object.assign(meta, obj);
}

/* ---------- PIN ---------- */
export async function setup(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  key = await derive(pin, salt);
  const canary = await seal({ ok: 1 }); // sirve para comprobar el PIN despues
  await putMeta({ salt, canary, deviceId: crypto.randomUUID(), receiptCounter: 0 });
  await loadAll();
}

export async function unlock(pin) {
  const k = await derive(pin, meta.salt);
  try {
    key = k;
    await open(meta.canary);
  } catch {
    key = null;
    return false; // PIN incorrecto: AES-GCM no descifra
  }
  await loadAll();
  return true;
}

export function lock() {
  key = null;
  for (const t of TYPES) data[t] = [];
}

async function loadAll() {
  const rows = await req(db.transaction('records').objectStore('records').getAll());
  for (const t of TYPES) data[t] = [];
  for (const row of rows) {
    if (data[row.type]) data[row.type].push(await open(row));
  }
}

/* ---------- guardar (atomico) ---------- */
// changes: { recs: [{type, rec}], meta: { receiptCounter: 5 } }
export async function save({ recs = [], meta: m = {} }) {
  if (!key) throw new Error('Base de datos bloqueada');
  // 1) Cifrar todo ANTES de abrir la transaccion (IndexedDB se cierra sola si esperamos otra cosa)
  const sealed = [];
  for (const { type, rec } of recs) {
    const copy = { ...rec, ver: (rec.ver || 0) + 1, updatedAt: Date.now() };
    const s = await seal(copy);
    sealed.push({ type, copy, row: { key: `${type}:${copy.id}`, type, iv: s.iv, data: s.data, ver: copy.ver } });
  }
  // 2) Una sola transaccion: registros + bandeja de salida + meta. Todo o nada.
  const tx = db.transaction(['records', 'outbox', 'meta'], 'readwrite');
  for (const { row } of sealed) {
    tx.objectStore('records').put(row);
    tx.objectStore('outbox').put({ key: row.key, ver: row.ver });
  }
  for (const [k, v] of Object.entries(m)) tx.objectStore('meta').put({ k, v });
  await done(tx);
  // 3) Solo cuando el disco confirmo, actualizamos la memoria
  for (const { type, copy } of sealed) {
    const i = data[type].findIndex((x) => x.id === copy.id);
    if (i >= 0) data[type][i] = copy;
    else data[type].push(copy);
  }
  Object.assign(meta, m);
}

export const newId = () => crypto.randomUUID();

/* ---------- sincronizacion (RF-05) ---------- */
export async function pendingCount() {
  if (!db) return 0;
  return req(db.transaction('outbox').objectStore('outbox').count());
}

async function postBatch(baseUrl, batch) {
  const res = await fetch(`${baseUrl}/api/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deviceId: meta.deviceId,
      meta: { salt: b64(meta.salt), canary: { iv: b64(meta.canary.iv), data: b64(meta.canary.data) } },
      records: batch,
    }),
  });
  if (!res.ok) throw new Error(`La nube respondió ${res.status}`);
  // Borrar de la bandeja SOLO lo que se envio y no cambio mientras tanto
  const tx = db.transaction('outbox', 'readwrite');
  const st = tx.objectStore('outbox');
  for (const it of batch) {
    const cur = await req(st.get(it.key));
    if (cur && cur.ver === it.ver) st.delete(it.key);
  }
  await done(tx);
}

// Envia por paquetes de maximo MAX_SYNC_BYTES. Devuelve cuantos registros subio.
export async function sync(baseUrl = '') {
  const pend = await req(db.transaction('outbox').objectStore('outbox').getAll());
  if (!pend.length) {
    await putMeta({ lastSync: Date.now() });
    return 0;
  }
  let batch = [];
  let size = 0;
  let sent = 0;
  for (const o of pend) {
    const row = await req(db.transaction('records').objectStore('records').get(o.key));
    if (!row) continue;
    const item = { key: row.key, type: row.type, ver: row.ver, iv: b64(row.iv), data: b64(row.data) };
    const len = JSON.stringify(item).length;
    if (batch.length && size + len > MAX_SYNC_BYTES) {
      await postBatch(baseUrl, batch);
      sent += batch.length;
      batch = [];
      size = 0;
    }
    batch.push(item);
    size += len;
  }
  if (batch.length) {
    await postBatch(baseUrl, batch);
    sent += batch.length;
  }
  await putMeta({ lastSync: Date.now() });
  return sent;
}

/* ---------- respaldo / restauracion ---------- */
// Los datos del respaldo siguen cifrados: quien tenga el archivo sin el PIN no lee nada.
async function restorePayload(payload) {
  if (hasPin()) throw new Error('Este equipo ya tiene datos. Restaurar solo se permite en un equipo nuevo.');
  if (!payload?.meta?.salt || !Array.isArray(payload.records)) throw new Error('Respaldo inválido');
  const tx = db.transaction(['records', 'meta'], 'readwrite');
  for (const r of payload.records) {
    tx.objectStore('records').put({ key: r.key, type: r.type, ver: r.ver, iv: unb64(r.iv), data: unb64(r.data) });
  }
  const m = {
    salt: unb64(payload.meta.salt),
    canary: { iv: unb64(payload.meta.canary.iv), data: unb64(payload.meta.canary.data) },
    deviceId: crypto.randomUUID(),
    receiptCounter: payload.meta.receiptCounter ?? 0,
  };
  for (const [k, v] of Object.entries(m)) tx.objectStore('meta').put({ k, v });
  await done(tx);
  Object.assign(meta, m);
}

export async function restoreFromCloud(baseUrl = '') {
  const res = await fetch(`${baseUrl}/api/records`);
  if (!res.ok) throw new Error(`La nube respondió ${res.status}`);
  await restorePayload(await res.json());
}

export async function exportBackup() {
  const rows = await req(db.transaction('records').objectStore('records').getAll());
  return JSON.stringify({
    meta: {
      salt: b64(meta.salt),
      canary: { iv: b64(meta.canary.iv), data: b64(meta.canary.data) },
      receiptCounter: meta.receiptCounter,
    },
    records: rows.map((r) => ({ key: r.key, type: r.type, ver: r.ver, iv: b64(r.iv), data: b64(r.data) })),
  });
}

export const importBackup = async (text) => restorePayload(JSON.parse(text));
