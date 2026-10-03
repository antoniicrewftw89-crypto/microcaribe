// Servidor de MicroCaribe: sirve la app y hace de "nube" para el respaldo.
// Sin dependencias: solo Node. Uso:  node server.js   ->  http://localhost:3000
//
// La nube NUNCA ve datos legibles: los registros llegan ya cifrados desde el celular.

import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(ROOT, 'data', 'cloud.json');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const MAX_BODY = 6 * 1024 * 1024;

const PUBLICOS = new Set([
  'index.html', 'styles.css', 'sw.js', 'manifest.webmanifest', 'icon.svg',
  'js/app.js', 'js/store.js', 'js/loan.js',
]);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

async function loadCloud() {
  if (!existsSync(DATA_FILE)) return { meta: null, records: {} };
  return JSON.parse(await readFile(DATA_FILE, 'utf8'));
}

async function saveCloud(cloud) {
  await mkdir(path.dirname(DATA_FILE), { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(cloud));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Paquete demasiado grande'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const json = (res, status, obj) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');

    if (url.pathname === '/api/sync' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      if (!Array.isArray(body.records)) return json(res, 400, { error: 'records invalido' });
      const cloud = await loadCloud();
      if (body.meta) cloud.meta = body.meta;
      let aceptados = 0;
      for (const r of body.records) {
        const actual = cloud.records[r.key];
        if (!actual || r.ver >= actual.ver) { // gana la version mas nueva
          cloud.records[r.key] = r;
          aceptados++;
        }
      }
      await saveCloud(cloud);
      return json(res, 200, { ok: true, aceptados });
    }

    if (url.pathname === '/api/records' && req.method === 'GET') {
      const cloud = await loadCloud();
      if (!cloud.meta) return json(res, 404, { error: 'No hay respaldo en la nube' });
      return json(res, 200, { meta: cloud.meta, records: Object.values(cloud.records) });
    }

    // Archivos estaticos: SOLO los de esta lista cerrada (nada de rutas armadas con lo que
    // manda el navegador, asi no hay forma de salir de la carpeta ni de leer data/ o server.js)
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    if (!PUBLICOS.has(rel)) {
      res.writeHead(404);
      return res.end('No encontrado');
    }
    const file = path.join(ROOT, rel);
    const buf = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'EISDIR') {
      res.writeHead(404);
      return res.end('No encontrado');
    }
    json(res, e.status || 500, { error: e.message });
  }
});

server.listen(PORT, HOST, () => console.log(`MicroCaribe en http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}`));
