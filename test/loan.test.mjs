import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSchedule, status, ordenarRuta, distancia, addDays } from '../js/loan.js';

const mk = (o = {}) => {
  const s = buildSchedule({ capital: 100000, interestPct: 20, cuotas: 24, startDate: '2026-10-05', ...o });
  return { id: 'L1', total: s.total, schedule: s.rows };
};

test('cuotas: 100.000 al 20% en 24 cuotas = 120.000 y la suma cuadra exacto', () => {
  const s = buildSchedule({ capital: 100000, interestPct: 20, cuotas: 24, startDate: '2026-10-05' });
  assert.equal(s.total, 120000);
  assert.equal(s.interes, 20000);
  assert.equal(s.cuota, 5000);
  assert.equal(s.rows.length, 24);
  assert.equal(s.rows.reduce((a, r) => a + r.monto, 0), 120000);
  assert.equal(s.rows.at(-1).saldo, 0);
});

test('cuotas con redondeo: la ultima absorbe la diferencia', () => {
  const s = buildSchedule({ capital: 100000, interestPct: 20, cuotas: 7, startDate: '2026-10-05' });
  assert.equal(s.rows.reduce((a, r) => a + r.monto, 0), 120000);
  assert.equal(s.rows.at(-1).saldo, 0);
  assert.ok(s.rows.at(-1).monto >= s.cuota);
});

test('primera cuota es al dia siguiente y saltar domingos funciona', () => {
  const s = buildSchedule({ capital: 10000, interestPct: 0, cuotas: 3, startDate: '2026-10-09' }); // viernes
  assert.deepEqual(s.rows.map((r) => r.fecha), ['2026-10-10', '2026-10-11', '2026-10-12']);
  const t = buildSchedule({ capital: 10000, interestPct: 0, cuotas: 3, startDate: '2026-10-09', skipSundays: true });
  assert.deepEqual(t.rows.map((r) => r.fecha), ['2026-10-10', '2026-10-12', '2026-10-13']); // salta el domingo 11
});

test('addDays cruza fin de mes y de anio', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
});

test('validaciones rechazan datos malos', () => {
  assert.throws(() => buildSchedule({ capital: 0, interestPct: 20, cuotas: 10, startDate: '2026-10-05' }));
  assert.throws(() => buildSchedule({ capital: 1000, interestPct: -1, cuotas: 10, startDate: '2026-10-05' }));
  assert.throws(() => buildSchedule({ capital: 1000, interestPct: 10, cuotas: 2.5, startDate: '2026-10-05' }));
  assert.throws(() => buildSchedule({ capital: 1000, interestPct: 10, cuotas: 0, startDate: '2026-10-05' }));
});

test('estado: al dia, atraso y cuota de hoy', () => {
  const loan = mk(); // cuota 5000, primera 2026-10-06
  // Antes de la primera cuota no se debe nada
  assert.equal(status(loan, [], '2026-10-05').debidoHoy, 0);
  // El dia de la 1ra cuota: se debe 5000 pero aun no es mora
  let s = status(loan, [], '2026-10-06');
  assert.equal(s.debidoHoy, 5000);
  assert.equal(s.atrasadas, 0);
  // Pasaron 3 dias sin pagar: cuotas 1,2,3 vencidas antes del dia 9 (06,07,08) -> 3 atrasadas, debe 4 cuotas (incluye hoy)
  s = status(loan, [], '2026-10-09');
  assert.equal(s.atrasadas, 3);
  assert.equal(s.debidoHoy, 20000);
  // Paga 15000 -> cubre 3 cuotas, queda debiendo la de hoy
  s = status(loan, [{ loanId: 'L1', monto: 15000 }], '2026-10-09');
  assert.equal(s.atrasadas, 0);
  assert.equal(s.debidoHoy, 5000);
  assert.equal(s.saldo, 105000);
});

test('pagos anulados o de otro prestamo no cuentan', () => {
  const loan = mk();
  const s = status(loan, [{ loanId: 'L1', monto: 5000, anulado: true }, { loanId: 'OTRO', monto: 9000 }], '2026-10-06');
  assert.equal(s.pagado, 0);
});

test('liquidado cuando el saldo llega a 0 y debidoHoy nunca supera el saldo', () => {
  const loan = mk();
  const s = status(loan, [{ loanId: 'L1', monto: 120000 }], '2027-01-01');
  assert.equal(s.saldo, 0);
  assert.equal(s.liquidado, true);
  assert.equal(s.debidoHoy, 0);
  const t = status(loan, [{ loanId: 'L1', monto: 119000 }], '2027-01-01');
  assert.equal(t.debidoHoy, 1000);
});

test('ruta por cercania parte del origen y deja sin GPS al final', () => {
  const origen = { lat: 10.0, lng: -75.0 };
  const items = [
    { id: 'lejos', gps: { lat: 10.3, lng: -75.0 } },
    { id: 'sin', gps: null },
    { id: 'cerca', gps: { lat: 10.01, lng: -75.0 } },
    { id: 'medio', gps: { lat: 10.1, lng: -75.0 } },
  ];
  assert.deepEqual(ordenarRuta(items, origen).map((i) => i.id), ['cerca', 'medio', 'lejos', 'sin']);
  assert.ok(Math.abs(distancia({ lat: 10, lng: -75 }, { lat: 10.01, lng: -75 }) - 1112) < 15); // ~1.1 km
});
