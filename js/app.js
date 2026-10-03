// Pantallas y acciones de MicroCaribe.
// Patron: guardamos el estado en `nav` (donde estoy), pintamos con paint() y
// reaccionamos a clics/formularios con "delegacion de eventos" (un solo listener para toda la pagina).
import * as L from './loan.js';
import * as S from './store.js';

const $app = document.getElementById('app');
const $modal = document.getElementById('modal');
const $toast = document.getElementById('toast');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => '$' + Math.round(n).toLocaleString('es-CO');
const fdate = (s) => L.parse(s).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });

const nav = { tab: 'hoy', clientId: null, loanId: null, q: '', fechaCaja: L.today(), ordenGps: false };
let unlocked = false;
let pending = 0;
let origen = null; // ubicacion actual para ordenar la ruta

/* ---------- datos derivados ---------- */
const client = (id) => S.data.clients.find((c) => c.id === id);
const loansOf = (id) => S.data.loans.filter((l) => l.clientId === id);
const st = (loan) => L.status(loan, S.data.payments);
const activeLoans = () => S.data.loans.filter((l) => { const c = client(l.clientId); return c && !c.deleted && !st(l).liquidado; });
const paymentsOn = (d) => S.data.payments.filter((p) => !p.anulado && p.fecha === d);
const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);

/* ---------- avisos y ventanas ---------- */
let toastTimer;
function toast(msg) {
  $toast.textContent = msg;
  $toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($toast.hidden = true), 3200);
}
const openModal = (html) => { $modal.innerHTML = `<div class="sheet">${html}</div>`; $modal.hidden = false; };
const closeModal = () => { $modal.hidden = true; $modal.innerHTML = ''; };

/* ---------- pintado ---------- */
async function render() {
  pending = await S.pendingCount();
  paint();
}

function paint() {
  if (!unlocked) { $app.innerHTML = viewLock(); return; }
  let body;
  if (nav.tab === 'clientes' && nav.loanId) body = viewLoan();
  else if (nav.tab === 'clientes' && nav.clientId) body = viewClient();
  else body = { hoy: viewHoy, clientes: viewClientes, caja: viewCaja, mas: viewMas }[nav.tab]();
  const ICONOS = {
    hoy: '<path d="M4 5h16v14H4zM4 9h16M8 3v4M16 3v4"/>',
    clientes: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>',
    caja: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="3"/>',
    mas: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  };
  const tab = (id, label) => `<button data-a="tab" data-tab="${id}" class="${nav.tab === id ? 'act' : ''}" aria-label="${label}">
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONOS[id]}</svg><span>${label}</span></button>`;
  $app.innerHTML = `
    <header class="top"><b>MicroCaribe</b>
      <span class="row">
        ${pending ? `<span class="pill">${pending} sin subir</span>` : ''}
        <span class="pill ${navigator.onLine ? 'on' : 'off'}">${navigator.onLine ? 'Con señal' : 'Sin señal'}</span>
      </span>
    </header>
    <main>${body}</main>
    <nav class="tabs">${tab('hoy', 'Hoy')}${tab('clientes', 'Clientes')}${tab('caja', 'Caja')}${tab('mas', 'Más')}</nav>`;
}

/* ---------- pantalla: PIN ---------- */
function viewLock() {
  const first = !S.hasPin();
  return `<main class="lock">
    <h1>MicroCaribe</h1>
    <p>${first
      ? 'Crea un PIN de <b>6 o más dígitos</b>. Con él se cifran los datos de este equipo. <b>Si lo olvidas, no se puede recuperar.</b>'
      : 'Escribe tu PIN para entrar.'}</p>
    <form data-f="lock">
      <input name="pin" type="password" inputmode="numeric" autocomplete="off" placeholder="PIN" required>
      ${first ? '<input name="pin2" type="password" inputmode="numeric" autocomplete="off" placeholder="Repite el PIN" required>' : ''}
      <button class="btn primary big">${first ? 'Crear PIN' : 'Entrar'}</button>
      <p class="err" id="lockErr"></p>
    </form>
    ${first ? `<hr><p class="muted">Equipo nuevo con datos anteriores:</p>
      <div class="row">
        <button class="btn" data-a="restoreCloud">Restaurar de la nube</button>
        <label class="btn">Restaurar de archivo<input type="file" id="restoreFile" accept=".json" hidden></label>
      </div>` : ''}
  </main>`;
}

/* ---------- pantalla: Hoy (RF-04, RF-07, RF-08) ---------- */
const clientsEmpty = () => !S.data.clients.some((c) => !c.deleted);

function cobrosHoy() {
  return activeLoans()
    .map((l) => ({ loan: l, c: client(l.clientId), s: st(l), gps: client(l.clientId).gps || null }))
    .filter((x) => x.s.debidoHoy > 0);
}

function viewHoy() {
  let items = cobrosHoy();
  if (nav.ordenGps && origen) items = L.ordenarRuta(items, origen);
  else items.sort((a, b) => b.s.atrasadas - a.s.atrasadas || a.c.nombre.localeCompare(b.c.nombre));
  const hoy = L.today();
  const cobrado = sum(paymentsOn(hoy), (p) => p.monto);
  const porCobrar = sum(items, (x) => x.s.debidoHoy);
  const enMora = items.filter((x) => x.s.atrasadas > 0);
  return `
    <h2>${L.parse(hoy).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
    <div class="stats">
      <div class="stat hi"><small>Por cobrar hoy</small><span class="big-n">${money(porCobrar)}</span></div>
      <div class="stat"><small>Cobrado hoy</small><span class="big-n">${money(cobrado)}</span></div>
    </div>
    ${enMora.length ? `<div class="card mora"><b>${enMora.length} cliente(s) en mora</b> (aparecen primero)</div>` : ''}
    <div class="row between">
      <h3>${items.length} cobro(s)</h3>
      <button class="btn sm" data-a="ruta">${nav.ordenGps ? 'Quitar orden GPS' : 'Ordenar por cercanía'}</button>
    </div>
    ${items.length ? items.map(rowCobro).join('')
      : clientsEmpty() ? '<div class="card"><h3>Bienvenido</h3><p>Aún no tienes clientes. Crea el primero para empezar a cobrar.</p><button class="btn primary big" data-a="newClientHome">Crear primer cliente</button></div>'
      : '<div class="card"><h3>Todo cobrado</h3><p>No hay cobros pendientes para hoy.</p></div>'}`;
}

function rowCobro(x) {
  return `<div class="card ${x.s.atrasadas ? 'mora' : ''}">
    <div class="row between"><h3>${esc(x.c.nombre)}</h3><span class="big-n">${money(x.s.debidoHoy)}</span></div>
    <p class="muted">${esc(x.c.direccion || 'Sin dirección')}${x.gps ? '' : ' - sin GPS'}</p>
    ${x.s.atrasadas ? `<span class="badge mora">MORA: ${x.s.atrasadas} cuota(s) atrasada(s)</span>` : ''}
    <div class="row" style="margin-top:.5rem">
      <button class="btn ok grow" data-a="pay" data-loan="${x.loan.id}">Cobrar</button>
      <button class="btn grow" data-a="openLoan" data-client="${x.c.id}" data-loan="${x.loan.id}">Ver</button>
    </div></div>`;
}

/* ---------- pantalla: Clientes (RF-01) ---------- */
function viewClientes() {
  const q = nav.q.trim().toLowerCase();
  const list = S.data.clients
    .filter((c) => !c.deleted)
    .filter((c) => !q || [c.nombre, c.cedula, c.telefono, c.direccion].some((v) => String(v || '').toLowerCase().includes(q)))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
  return `
    <div class="row between"><h2>Clientes</h2><button class="btn primary" data-a="newClient">+ Nuevo</button></div>
    <input id="q" data-bind="q" placeholder="Buscar nombre, cédula, teléfono..." value="${esc(nav.q)}">
    ${list.length ? list.map((c) => {
      const act = loansOf(c.id).filter((l) => !st(l).liquidado);
      const mora = act.some((l) => st(l).atrasadas > 0);
      return `<div class="card link" data-a="openClient" data-client="${c.id}">
        <div class="row between"><h3>${esc(c.nombre)}</h3>${mora ? '<span class="badge mora">MORA</span>' : act.length ? '<span class="badge ok">AL DÍA</span>' : ''}</div>
        <p class="muted">${esc(c.telefono || '')} ${act.length ? '- debe ' + money(sum(act, (l) => st(l).saldo)) : '- sin deuda'}</p></div>`;
    }).join('') : '<div class="card">Sin resultados.</div>'}`;
}

function viewClient() {
  const c = client(nav.clientId);
  const ls = loansOf(c.id);
  return `
    <button class="btn sm" data-a="backClients">&larr; Clientes</button>
    <h2>${esc(c.nombre)}</h2>
    <div class="card">
      <p>Cédula: <b>${esc(c.cedula || '-')}</b></p>
      <p>Teléfono: <b>${c.telefono ? `<a href="tel:${esc(c.telefono)}">${esc(c.telefono)}</a>` : '-'}</b></p>
      <p>Dirección: <b>${esc(c.direccion || '-')}</b></p>
      <p>GPS: <b>${c.gps ? `${c.gps.lat.toFixed(5)}, ${c.gps.lng.toFixed(5)}` : 'no capturado'}</b>
        ${c.gps ? `<a href="https://www.google.com/maps?q=${c.gps.lat},${c.gps.lng}" target="_blank" rel="noopener">Cómo llegar</a>` : ''}</p>
      <div class="row"><button class="btn sm" data-a="editClient" data-client="${c.id}">Editar</button>
      <button class="btn sm danger" data-a="delClient" data-client="${c.id}">Eliminar</button></div>
    </div>
    <div class="row between"><h3>Préstamos</h3><button class="btn primary sm" data-a="newLoan" data-client="${c.id}">+ Préstamo</button></div>
    ${ls.length ? ls.map((l) => {
      const s = st(l);
      return `<div class="card link ${s.atrasadas ? 'mora' : ''}" data-a="openLoan" data-client="${c.id}" data-loan="${l.id}">
        <div class="row between"><b>${money(l.capital)} - ${l.cuotas} cuotas</b>
        ${s.liquidado ? '<span class="badge ok">PAGADO</span>' : s.atrasadas ? '<span class="badge mora">MORA</span>' : '<span class="badge ok">AL DÍA</span>'}</div>
        <p class="muted">Desde ${fdate(l.fecha)} - saldo <b>${money(s.saldo)}</b></p></div>`;
    }).join('') : '<div class="card">Aún no tiene préstamos.</div>'}`;
}

/* ---------- pantalla: Prestamo (RF-02, RF-03) ---------- */
function viewLoan() {
  const l = S.data.loans.find((x) => x.id === nav.loanId);
  const c = client(l.clientId);
  const s = st(l);
  const hoy = L.today();
  let acum = 0;
  const rows = l.schedule.map((r) => {
    acum += r.monto;
    const pagada = acum <= s.pagado;
    const cls = pagada ? 'paid' : r.fecha < hoy ? 'late' : r.fecha === hoy ? 'today' : '';
    return `<tr class="${cls}"><td>${r.n}</td><td>${fdate(r.fecha)}</td><td>${money(r.monto)}</td><td>${money(r.saldo)}</td></tr>`;
  }).join('');
  const pagos = S.data.payments.filter((p) => p.loanId === l.id).sort((a, b) => b.ts - a.ts);
  return `
    <button class="btn sm" data-a="openClient" data-client="${c.id}">&larr; ${esc(c.nombre)}</button>
    <h2>Préstamo ${money(l.capital)}</h2>
    <div class="stats">
      <div class="stat"><small>Total a pagar</small><b>${money(l.total)}</b></div>
      <div class="stat"><small>Cuota diaria</small><b>${money(l.cuota)}</b></div>
      <div class="stat"><small>Pagado</small><b>${money(s.pagado)}</b></div>
      <div class="stat hi"><small>Saldo</small><b>${money(s.saldo)}</b></div>
    </div>
    <p class="muted">Primera cuota: ${fdate(l.schedule[0].fecha)} · Última cuota: ${fdate(l.schedule.at(-1).fecha)}</p>
    ${s.atrasadas ? `<div class="card mora"><b>${s.atrasadas} cuota(s) atrasada(s)</b> - debe hoy ${money(s.debidoHoy)}</div>` : ''}
    ${s.liquidado ? '<div class="card"><span class="badge ok">PAGADO COMPLETO</span></div>'
      : `<button class="btn ok big" data-a="pay" data-loan="${l.id}">Registrar pago</button>`}
    <h3>Tabla de cuotas</h3>
    <div class="table-wrap"><table><tr><th>#</th><th>Fecha</th><th>Cuota</th><th>Saldo</th></tr>${rows}</table></div>
    <p class="muted">Verde = pagada. Rojo = atrasada. Amarillo = hoy.</p>
    <h3>Pagos</h3>
    ${pagos.length ? pagos.map((p) => `<div class="card ${p.anulado ? '' : ''}">
      <div class="row between"><b>${p.anulado ? '<s>' : ''}${money(p.monto)}${p.anulado ? '</s> ANULADO' : ''}</b><span class="muted">${esc(p.recibo)} - ${fdate(p.fecha)} ${esc(p.hora || '')}</span></div>
      <div class="row" style="margin-top:.4rem"><button class="btn sm" data-a="receipt" data-pay="${p.id}">Recibo</button>
      ${p.anulado ? '' : `<button class="btn sm danger" data-a="voidPay" data-pay="${p.id}">Anular</button>`}</div></div>`).join('')
      : '<div class="card">Sin pagos todavía.</div>'}`;
}

/* ---------- pantalla: Caja (RF-09, RF-10) ---------- */
function viewCaja() {
  const d = nav.fechaCaja;
  const cobrado = sum(paymentsOn(d), (p) => p.monto);
  const prestado = sum(S.data.loans.filter((l) => l.fecha === d), (l) => l.capital);
  const gastosDia = S.data.expenses.filter((g) => !g.anulado && g.fecha === d);
  const gastos = sum(gastosDia, (g) => g.monto);
  const neto = cobrado - prestado - gastos;
  const act = activeLoans();
  const moraLoans = act.filter((l) => st(l).atrasadas > 0);
  return `
    <h2>Cuadre de caja</h2>
    <label>Día<input type="date" data-bind="fechaCaja" value="${d}"></label>
    <div class="card">
      <div class="row between"><span>Cobrado</span><b>${money(cobrado)}</b></div>
      <div class="row between"><span>Prestado (desembolsos)</span><b>- ${money(prestado)}</b></div>
      <div class="row between"><span>Gastos</span><b>- ${money(gastos)}</b></div>
      <hr><div class="row between"><b>Efectivo neto del día</b><span class="big-n">${money(neto)}</span></div>
    </div>
    <p class="muted">Efectivo neto = lo cobrado, menos lo prestado, menos los gastos de ese día.</p>
    <div class="row between"><h3>Gastos del día</h3><button class="btn primary sm" data-a="newExpense">+ Gasto</button></div>
    ${gastosDia.length ? gastosDia.map((g) => `<div class="card"><div class="row between"><b>${esc(g.concepto)} ${money(g.monto)}</b>
      <button class="btn sm danger" data-a="delExpense" data-exp="${g.id}">Quitar</button></div>${g.nota ? `<p class="muted">${esc(g.nota)}</p>` : ''}</div>`).join('')
      : '<div class="card">Sin gastos registrados.</div>'}
    <h3>Estado de la cartera</h3>
    <div class="stats">
      <div class="stat"><small>Préstamos activos</small><b>${act.length}</b></div>
      <div class="stat hi"><small>Por cobrar (saldo)</small><b>${money(sum(act, (l) => st(l).saldo))}</b></div>
      <div class="stat"><small>En mora</small><b>${moraLoans.length}</b></div>
      <div class="stat"><small>Saldo en mora</small><b>${money(sum(moraLoans, (l) => st(l).saldo))}</b></div>
    </div>`;
}

/* ---------- pantalla: Mas (RF-05) ---------- */
function viewMas() {
  return `
    <h2>Respaldo y seguridad</h2>
    <div class="card">
      <p>Registros sin subir a la nube: <b>${pending}</b></p>
      <p class="muted">Última sincronización: ${S.meta.lastSync ? new Date(S.meta.lastSync).toLocaleString('es-CO') : 'nunca'}</p>
      <button class="btn primary big" data-a="sync">Sincronizar ahora</button>
      <p class="muted">Se intenta sola cuando hay señal. Cada envío pesa máximo 5 MB.</p>
    </div>
    <div class="card">
      <button class="btn big" data-a="export">Descargar respaldo (archivo)</button>
      <p class="muted">El archivo sigue cifrado: sin tu PIN no se puede leer.</p>
    </div>
    <div class="card">
      <button class="btn big" data-a="lock">Bloquear ahora</button>
      <p class="muted">Se bloquea solo tras 5 minutos sin usar la app.</p>
    </div>`;
}

/* ---------- formularios ---------- */
const field = (label, name, val = '', extra = '') => `<label>${label}<input name="${name}" value="${esc(val)}" ${extra}></label>`;

function clientForm(c = {}) {
  return `<h2>${c.id ? 'Editar' : 'Nuevo'} cliente</h2>
    <form data-f="client" data-id="${c.id || ''}">
      ${field('Nombre *', 'nombre', c.nombre, 'required autocomplete="off"')}
      ${field('Cédula', 'cedula', c.cedula, 'inputmode="numeric" autocomplete="off"')}
      ${field('Teléfono', 'telefono', c.telefono, 'inputmode="tel" autocomplete="off"')}
      ${field('Dirección / referencia', 'direccion', c.direccion, 'autocomplete="off"')}
      <input type="hidden" name="lat" value="${c.gps?.lat ?? ''}"><input type="hidden" name="lng" value="${c.gps?.lng ?? ''}">
      <p id="gpsTxt" class="muted">${c.gps ? `GPS: ${c.gps.lat.toFixed(5)}, ${c.gps.lng.toFixed(5)}` : 'GPS sin capturar'}</p>
      <button type="button" class="btn" data-a="gpsForm">Capturar mi ubicación actual</button>
      <div class="row" style="margin-top:.8rem"><button class="btn primary grow">Guardar</button><button type="button" class="btn grow" data-a="close">Cancelar</button></div>
    </form>`;
}

function loanForm(clientId) {
  return `<h2>Nuevo préstamo</h2>
    <form data-f="loan" data-client="${clientId}">
      ${field('Capital prestado ($) *', 'capital', '', 'type="number" inputmode="numeric" min="1" step="1" required')}
      ${field('Interés total (%) *', 'interes', 20, 'type="number" inputmode="decimal" min="0" step="0.1" required')}
      ${field('Número de cuotas diarias *', 'cuotas', 24, 'type="number" inputmode="numeric" min="1" max="400" step="1" required')}
      ${field('Fecha de entrega', 'fecha', L.today(), 'type="date" required')}
      <label class="chk"><input type="checkbox" name="domingos"> No cobrar los domingos</label>
      <div class="card" id="preview">Escribe el capital para ver la cuota.</div>
      <div class="row"><button class="btn primary grow">Entregar préstamo</button><button type="button" class="btn grow" data-a="close">Cancelar</button></div>
    </form>`;
}

function payForm(loan) {
  const c = client(loan.clientId);
  const s = st(loan);
  return `<h2>Cobrar a ${esc(c.nombre)}</h2>
    <p>Saldo: <b>${money(s.saldo)}</b> - Debe hoy: <b>${money(s.debidoHoy)}</b></p>
    <form data-f="pay" data-loan="${loan.id}">
      ${field('Valor recibido ($)', 'monto', s.debidoHoy || loan.cuota, `type="number" inputmode="numeric" min="1" max="${s.saldo}" step="1" required`)}
      <div class="row" style="margin-top:.5rem">
        <button type="button" class="btn sm" data-a="fill" data-v="${Math.min(loan.cuota, s.saldo)}">1 cuota</button>
        <button type="button" class="btn sm" data-a="fill" data-v="${s.debidoHoy}">Lo que debe hoy</button>
        <button type="button" class="btn sm" data-a="fill" data-v="${s.saldo}">Todo el saldo</button>
      </div>
      <div class="row" style="margin-top:.8rem"><button class="btn ok grow">Registrar pago</button><button type="button" class="btn grow" data-a="close">Cancelar</button></div>
    </form>`;
}

function expenseForm() {
  return `<h2>Nuevo gasto</h2>
    <form data-f="expense">
      <label>Concepto<select name="concepto"><option>Transporte</option><option>Alimentación</option><option>Otro</option></select></label>
      ${field('Valor ($)', 'monto', '', 'type="number" inputmode="numeric" min="1" step="1" required')}
      ${field('Nota (opcional)', 'nota', '', 'autocomplete="off"')}
      <div class="row" style="margin-top:.8rem"><button class="btn primary grow">Guardar</button><button type="button" class="btn grow" data-a="close">Cancelar</button></div>
    </form>`;
}

/* ---------- recibo (RF-06) ---------- */
function receiptText(p) {
  const l = S.data.loans.find((x) => x.id === p.loanId);
  const c = client(p.clientId);
  const saldoTras = l.total - sum(S.data.payments.filter((x) => x.loanId === l.id && !x.anulado && x.ts <= p.ts), (x) => x.monto);
  const line = '-'.repeat(32);
  return [
    '        MICROCARIBE', line,
    `Recibo: ${p.recibo}${p.anulado ? '  (ANULADO)' : ''}`,
    `Fecha:  ${p.fecha} ${p.hora || ''}`,
    `Cliente: ${c.nombre}`,
    line,
    `PAGO RECIBIDO: ${money(p.monto)}`,
    `Saldo restante: ${money(saldoTras)}`,
    `Préstamo: ${money(l.capital)}`,
    line,
    '     Gracias por su pago',
  ].join('\n');
}

function showReceipt(id) {
  const p = S.data.payments.find((x) => x.id === id);
  openModal(`<h2>Recibo</h2><div class="receipt">${esc(receiptText(p))}</div>
    <div class="row" style="margin-top:.8rem"><button class="btn primary grow" onclick="window.print()">Imprimir / PDF</button>
    <button class="btn grow" data-a="close">Cerrar</button></div>
    <p class="muted">Para impresora térmica de 58 mm: elige tu impresora en el cuadro de impresión.</p>`);
}

/* ---------- acciones (clics) ---------- */
function afterSave() {
  closeModal();
  render();
  clearTimeout(afterSave.t);
  afterSave.t = setTimeout(autoSync, 1500);
}

async function autoSync() {
  if (!unlocked || !navigator.onLine) return;
  try { await S.sync(''); } catch { /* sin nube: queda en la bandeja de salida */ }
  render();
}

const actions = {
  tab: (d) => { Object.assign(nav, { tab: d.tab, clientId: null, loanId: null }); paint(); },
  close: closeModal,
  fill: (d, el) => { el.closest('form').elements.monto.value = d.v; },
  newClient: () => openModal(clientForm()),
  newClientHome: () => { Object.assign(nav, { tab: 'clientes', clientId: null, loanId: null }); paint(); openModal(clientForm()); },
  editClient: (d) => openModal(clientForm(client(d.client))),
  openClient: (d) => { Object.assign(nav, { tab: 'clientes', clientId: d.client, loanId: null }); paint(); },
  backClients: () => { nav.clientId = null; paint(); },
  openLoan: (d) => { Object.assign(nav, { tab: 'clientes', clientId: d.client, loanId: d.loan }); paint(); },
  newLoan: (d) => openModal(loanForm(d.client)),
  pay: (d) => openModal(payForm(S.data.loans.find((l) => l.id === d.loan))),
  receipt: (d) => showReceipt(d.pay),
  newExpense: () => openModal(expenseForm()),

  async delClient(d) {
    const c = client(d.client);
    if (loansOf(c.id).some((l) => !st(l).liquidado)) return toast('Tiene préstamos activos: no se puede eliminar');
    if (!confirm(`¿Eliminar a ${c.nombre}? El historial se conserva.`)) return;
    await S.save({ recs: [{ type: 'clients', rec: { ...c, deleted: true } }] });
    nav.clientId = null;
    afterSave();
  },
  async voidPay(d) {
    const p = S.data.payments.find((x) => x.id === d.pay);
    if (!confirm(`¿Anular el pago ${p.recibo} de ${money(p.monto)}? El saldo vuelve a subir.`)) return;
    await S.save({ recs: [{ type: 'payments', rec: { ...p, anulado: true } }] });
    afterSave();
  },
  async delExpense(d) {
    const g = S.data.expenses.find((x) => x.id === d.exp);
    await S.save({ recs: [{ type: 'expenses', rec: { ...g, anulado: true } }] });
    afterSave();
  },

  gpsForm: (d, el) => {
    const f = el.closest('form');
    if (!navigator.geolocation) return toast('Este equipo no tiene GPS');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        f.elements.lat.value = pos.coords.latitude;
        f.elements.lng.value = pos.coords.longitude;
        document.getElementById('gpsTxt').textContent = `GPS: ${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`;
      },
      () => toast('No se pudo leer la ubicación (revisa el permiso)'),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  },
  ruta: () => {
    if (nav.ordenGps) { nav.ordenGps = false; return paint(); }
    if (!navigator.geolocation) return toast('Este equipo no tiene GPS');
    navigator.geolocation.getCurrentPosition(
      (pos) => { origen = { lat: pos.coords.latitude, lng: pos.coords.longitude }; nav.ordenGps = true; paint(); },
      () => toast('No se pudo leer la ubicación (revisa el permiso)'),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  },

  async sync() {
    try {
      const n = await S.sync('');
      toast(n ? `${n} registros subidos a la nube` : 'Todo al día');
    } catch {
      toast('No hay conexión con la nube');
    }
    render();
  },
  async export() {
    const blob = new Blob([await S.exportBackup()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `microcaribe-respaldo-${L.today()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  },
  lock: () => lockApp(),
  async restoreCloud() {
    try { await S.restoreFromCloud(''); toast('Restaurado. Escribe tu PIN anterior.'); render(); }
    catch (e) { toast(e.message); }
  },
};

/* ---------- formularios (guardar) ---------- */
const forms = {
  async lock(f) {
    const err = document.getElementById('lockErr');
    const pin = f.elements.pin.value;
    try {
      if (!S.hasPin()) {
        if (!/^\d{6,}$/.test(pin)) return (err.textContent = 'El PIN debe tener 6 o más dígitos (solo números)');
        if (pin !== f.elements.pin2.value) return (err.textContent = 'Los PIN no coinciden');
        await S.setup(pin);
      } else if (!(await S.unlock(pin))) {
        return (err.textContent = 'PIN incorrecto');
      }
    } catch (e) {
      return (err.textContent = 'Error: ' + e.message);
    }
    unlocked = true;
    // Despues de restaurar, el contador de recibos puede quedar atras: lo igualamos al mayor recibo existente
    const mayor = Math.max(0, ...S.data.payments.map((p) => Number(String(p.recibo).replace(/\D/g, '')) || 0));
    if (mayor > (S.meta.receiptCounter || 0)) await S.save({ meta: { receiptCounter: mayor } });
    armIdleLock();
    render();
    autoSync();
  },

  async client(f) {
    const e = f.elements;
    const old = f.dataset.id ? client(f.dataset.id) : {};
    const lat = parseFloat(e.lat.value);
    const lng = parseFloat(e.lng.value);
    const rec = {
      ...old,
      id: old.id || S.newId(),
      nombre: e.nombre.value.trim(),
      cedula: e.cedula.value.trim(),
      telefono: e.telefono.value.trim(),
      direccion: e.direccion.value.trim(),
      gps: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null,
    };
    if (!rec.nombre) return toast('El nombre es obligatorio');
    if (rec.cedula && S.data.clients.some((x) => !x.deleted && x.id !== rec.id && x.cedula === rec.cedula)) {
      return toast('Ya existe un cliente con esa cédula');
    }
    await S.save({ recs: [{ type: 'clients', rec }] });
    afterSave();
  },

  async loan(f) {
    const e = f.elements;
    let plan;
    try {
      plan = L.buildSchedule({ capital: e.capital.value, interestPct: e.interes.value, cuotas: e.cuotas.value, startDate: e.fecha.value, skipSundays: e.domingos.checked });
    } catch (err) {
      return toast(err.message);
    }
    const rec = {
      id: S.newId(), clientId: f.dataset.client, fecha: e.fecha.value,
      capital: Math.round(Number(e.capital.value)), interestPct: Number(e.interes.value),
      cuotas: Number(e.cuotas.value), skipSundays: e.domingos.checked,
      total: plan.total, cuota: plan.cuota, schedule: plan.rows,
    };
    await S.save({ recs: [{ type: 'loans', rec }] });
    afterSave();
  },

  async pay(f) {
    const loan = S.data.loans.find((l) => l.id === f.dataset.loan);
    const saldo = st(loan).saldo;
    const monto = Math.round(Number(f.elements.monto.value));
    if (!(monto > 0)) return toast('Escribe un valor mayor que 0');
    if (monto > saldo) return toast(`No puede pasar del saldo (${money(saldo)})`);
    const n = (S.meta.receiptCounter || 0) + 1;
    const now = new Date();
    const pago = {
      id: S.newId(), loanId: loan.id, clientId: loan.clientId, monto, anulado: false, ts: now.getTime(),
      fecha: L.today(), hora: now.toTimeString().slice(0, 5), recibo: 'R-' + String(n).padStart(4, '0'),
    };
    // Pago + contador de recibos en UNA transaccion (RNF-02)
    await S.save({ recs: [{ type: 'payments', rec: pago }], meta: { receiptCounter: n } });
    afterSave();
    showReceipt(pago.id);
  },

  async expense(f) {
    const e = f.elements;
    const monto = Math.round(Number(e.monto.value));
    if (!(monto > 0)) return toast('Escribe un valor mayor que 0');
    const rec = { id: S.newId(), fecha: nav.fechaCaja, concepto: e.concepto.value, monto, nota: e.nota.value.trim(), anulado: false };
    await S.save({ recs: [{ type: 'expenses', rec }] });
    afterSave();
  },
};

/* ---------- vista previa del prestamo mientras escribes ---------- */
function previewLoan(f) {
  const e = f.elements;
  const box = document.getElementById('preview');
  try {
    const p = L.buildSchedule({ capital: e.capital.value, interestPct: e.interes.value, cuotas: e.cuotas.value, startDate: e.fecha.value || L.today(), skipSundays: e.domingos.checked });
    box.innerHTML = `Cuota diaria: <b>${money(p.cuota)}</b><br>Interés: <b>${money(p.interes)}</b><br>Total a pagar: <b>${money(p.total)}</b><br>Última cuota: <b>${fdate(p.rows.at(-1).fecha)}</b>`;
  } catch (err) {
    box.textContent = e.capital.value ? err.message : 'Escribe el capital para ver la cuota.';
  }
}

/* ---------- eventos globales ---------- */
document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-a]');
  if (!el || !actions[el.dataset.a]) return;
  try { await actions[el.dataset.a](el.dataset, el); } catch (e) { toast('Error: ' + e.message); }
});

document.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  const btn = f.querySelector('button:not([type=button])');
  if (btn) btn.disabled = true; // evita doble toque = doble cobro
  try { await forms[f.dataset.f]?.(f); } catch (e) { toast('Error: ' + e.message); }
  if (btn && btn.isConnected) btn.disabled = false;
});

document.addEventListener('input', (ev) => {
  const f = ev.target.closest('form[data-f=loan]');
  if (f) return previewLoan(f);
  if (ev.target.dataset.bind === 'q') {
    nav.q = ev.target.value;
    paint();
    const q = document.getElementById('q');
    q.focus();
    q.setSelectionRange(q.value.length, q.value.length);
  }
});

document.addEventListener('change', async (ev) => {
  const t = ev.target;
  if (t.dataset.bind === 'fechaCaja' && t.value) { nav.fechaCaja = t.value; paint(); }
  if (t.id === 'restoreFile' && t.files[0]) {
    try { await S.importBackup(await t.files[0].text()); toast('Restaurado. Escribe tu PIN anterior.'); render(); }
    catch (e) { toast(e.message); }
  }
});

window.addEventListener('online', () => { paint(); autoSync(); });
window.addEventListener('offline', paint);

/* ---------- bloqueo ---------- */
function lockApp() {
  unlocked = false;
  S.lock();
  Object.assign(nav, { tab: 'hoy', clientId: null, loanId: null, q: '' });
  closeModal();
  paint();
}

let idleTimer;
function armIdleLock() {
  const reset = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => unlocked && lockApp(), 5 * 60 * 1000); };
  ['click', 'keydown', 'touchstart'].forEach((t) => document.addEventListener(t, reset, { passive: true }));
  reset();
}

/* ---------- arranque ---------- */
(async () => {
  if (!window.crypto?.subtle) {
    $app.innerHTML = '<main><h1>Falta conexión segura</h1><p>El cifrado necesita abrir la app desde <b>localhost</b> o <b>https</b>.</p></main>';
    return;
  }
  try {
    await S.init();
  } catch {
    $app.innerHTML = '<main><h1>No se pueden guardar datos aquí</h1><p>Sal del modo privado o prueba otro navegador.</p></main>';
    return;
  }
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
