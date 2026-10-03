// Prueba de punta a punta con Brave real: PIN, cifrado, XSS, mora, pago, recibo, offline y sincronizacion.
// Uso: node test/e2e.mjs   (con `node server.js` corriendo)
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BRAVE = process.env.BRAVE || `${process.env.LOCALAPPDATA}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`;
const URL = 'http://localhost:3000';

let fallos = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASA ' : 'FALLA'}  ${msg}`); if (!cond) fallos++; };
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hace3 = new Date(); hace3.setDate(hace3.getDate() - 3);

const browser = await chromium.launch({ executablePath: BRAVE, headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
const page = await ctx.newPage();
const errores = [];
page.on('pageerror', (e) => errores.push(e.message));
page.on('dialog', (d) => d.accept());

const entrar = async (pin, pin2) => {
  await page.fill('input[name=pin]', pin);
  if (pin2 !== undefined) await page.fill('input[name=pin2]', pin2);
  await page.click('form[data-f=lock] button');
};
const texto = () => page.locator('#app').innerText();

await page.goto(URL);
await page.waitForSelector('form[data-f=lock]');

// 1. PIN
await entrar('123', '123');
ok((await page.locator('#lockErr').innerText()).includes('6 o más'), 'rechaza PIN corto');
await entrar('123456', '654321');
ok((await page.locator('#lockErr').innerText()).includes('no coinciden'), 'rechaza PIN que no coincide');
await entrar('123456', '123456');
await page.waitForSelector('nav.tabs');
ok(true, 'crea PIN y entra');
{
  const t = await texto();
  ok(t.includes('Crear primer cliente'), 'pantalla de bienvenida cuando no hay clientes');
  ok(t.includes('Más') && t.includes('Con señal'), 'textos con tilde y ñ (Más, Con señal)');
}

// 2. Cliente con intento de XSS
await page.click('nav.tabs button[data-tab=clientes]');
await page.click('[data-a=newClient]');
await page.fill('input[name=nombre]', '<img src=x onerror="window.__xss=1">Pedro');
await page.fill('input[name=direccion]', 'Calle <b>5</b>');
await page.fill('input[name=cedula]', '123');
await page.click('form[data-f=client] button.primary');
await page.waitForSelector('.card.link');
ok(!(await page.evaluate(() => window.__xss)), 'XSS: el HTML escrito en el nombre NO se ejecuta');
ok((await texto()).includes('<img src=x'), 'XSS: el nombre se muestra como texto literal');

// 2b. Cedula duplicada se rechaza
await page.click('[data-a=backClients]').catch(() => {});
await page.click('[data-a=newClient]');
await page.fill('input[name=nombre]', 'Otra persona');
await page.fill('input[name=cedula]', '123');
await page.click('form[data-f=client] button.primary');
await page.waitForFunction(() => document.getElementById('toast').innerText.includes('cédula'), null, { timeout: 4000 }).catch(() => {});
ok((await page.locator('#toast').innerText()).includes('cédula'), 'rechaza cédula duplicada');
await page.click('[data-a=close]');

// 3. Prestamo de hace 3 dias => en mora
await page.click('.card.link');
await page.click('[data-a=newLoan]');
await page.fill('input[name=capital]', '100000');
await page.fill('input[name=fecha]', iso(hace3));
await page.waitForFunction(() => document.getElementById('preview').innerText.includes('5.000'));
ok(true, 'vista previa calcula cuota de $5.000');
await page.click('form[data-f=loan] button.primary');
await page.waitForSelector('.table-wrap').catch(() => {});
await page.click('nav.tabs button[data-tab=hoy]');
const hoy = await texto();
await page.screenshot({ path: path.join(ROOT, 'data', 'hoy.png') });
ok(hoy.includes('MORA'), 'Hoy: el cliente aparece en mora');
ok(hoy.includes('$15.000'), 'Hoy: debe 3 cuotas atrasadas ($15.000) (2 atrasadas + la de hoy) en un préstamo de hace 3 dias');

// 4. Pago + recibo
await page.click('[data-a=pay]');
await page.fill('input[name=monto]', '5000');
await page.click('form[data-f=pay] button.ok');
await page.waitForSelector('.receipt');
const recibo = await page.locator('.receipt').innerText();
ok(recibo.includes('R-0001') && recibo.includes('$5.000') && recibo.includes('$115.000'), 'recibo R-0001 con pago $5.000 y saldo $115.000');
await page.click('[data-a=close]');

// 5. Pago mayor al saldo se rechaza
await page.click('[data-a=pay]');
await page.fill('input[name=monto]', '9999999');
await page.evaluate(() => document.querySelector('form[data-f=pay] input[name=monto]').removeAttribute('max'));
await page.click('form[data-f=pay] button.ok');
ok((await page.locator('#toast').innerText()).includes('saldo'), 'rechaza pago mayor al saldo');
await page.click('[data-a=close]');

// 6. Cifrado: lo guardado en disco no contiene el nombre en claro
const claro = await page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('microcaribe');
  r.onsuccess = () => {
    const q = r.result.transaction('records').objectStore('records').getAll();
    q.onsuccess = () => res(q.result.map((x) => new TextDecoder('latin1').decode(x.data)).join('').includes('Pedro'));
  };
}));
ok(claro === false, 'RNF-01: el nombre NO aparece legible dentro de la base de datos');

// 7. Recargar = cerrar y abrir la app: PIN malo falla, PIN bueno recupera todo
await page.reload();
await page.waitForSelector('form[data-f=lock]');
await entrar('000000');
await page.waitForFunction(() => document.getElementById('lockErr')?.innerText.length > 0, null, { timeout: 5000 }).catch(() => {});
ok((await page.locator('#lockErr').innerText()).includes('incorrecto') && !(await page.locator('nav.tabs').count()), 'PIN incorrecto es rechazado y NO deja entrar');
await entrar('123456');
await page.waitForSelector('nav.tabs');
await page.click('nav.tabs button[data-tab=clientes]');
ok((await texto()).includes('Pedro'), 'los datos persisten tras cerrar y abrir');

// 8. Sin internet: la app abre y se puede cobrar
await page.evaluate(() => navigator.serviceWorker.ready);
await page.waitForTimeout(500);
await ctx.setOffline(true);
await page.reload();
await page.waitForSelector('form[data-f=lock]');
ok(true, 'RF-04/offline: la app abre SIN conexion (service worker)');
await entrar('123456');
await page.waitForSelector('nav.tabs');
await page.click('[data-a=pay]');
await page.fill('input[name=monto]', '5000');
await page.click('form[data-f=pay] button.ok');
await page.waitForSelector('.receipt');
ok((await page.locator('.receipt').innerText()).includes('R-0002'), 'RF-03: cobra offline y el recibo sigue la numeracion (R-0002)');
await page.click('[data-a=close]');
await page.click('nav.tabs button[data-tab=mas]');
const pend = await texto();
ok(/sin subir/.test(await page.locator('header.top').innerText()), 'queda en la bandeja "sin subir" mientras no hay señal');

// 9. Vuelve la señal: sincroniza
await ctx.setOffline(false);
await page.click('[data-a=sync]');
await page.waitForFunction(() => !document.querySelector('header.top').innerText.includes('sin subir'), null, { timeout: 8000 }).catch(() => {});
ok(!(await page.locator('header.top').innerText()).includes('sin subir'), 'RF-05: con señal sincroniza y la bandeja queda en 0');
const cloud = path.join(ROOT, 'data', 'cloud.json');
ok(existsSync(cloud), 'la nube guardo el respaldo');
ok(existsSync(cloud) && !readFileSync(cloud, 'utf8').includes('Pedro'), 'la nube NO ve datos legibles (llegan cifrados)');

// 10. Caja
await page.click('nav.tabs button[data-tab=caja]');
const caja = await texto();
ok(caja.includes('$10.000'), 'Caja: cobrado del dia $10.000 (2 pagos)');

ok(errores.length === 0, `sin errores de JavaScript en consola${errores.length ? ': ' + errores.join(' | ') : ''}`);
await page.screenshot({ path: path.join(ROOT, 'data', 'caja.png') });
await browser.close();
console.log(fallos ? `\n${fallos} FALLA(S)` : '\nTODO OK');
process.exit(fallos ? 1 : 0);
