// Logica pura del negocio (sin pantalla, sin base de datos). Se prueba con test/loan.test.mjs.
// Todos los montos son pesos colombianos ENTEROS: asi no hay errores de decimales.

export const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Fecha "YYYY-MM-DD" -> Date a mediodia local (evita saltos por zona horaria/horario de verano)
export const parse = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
};

export const today = () => iso(new Date());

export function addDays(s, n) {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return iso(d);
}

// RF-02: calcula la cuota y la tabla de amortizacion.
// Modelo "gota a gota": interes FIJO sobre el capital (no sobre saldo), cuotas diarias iguales.
// La ultima cuota absorbe el redondeo para que la suma sea exactamente el total.
export function buildSchedule({ capital, interestPct, cuotas, startDate, skipSundays = false }) {
  capital = Math.round(Number(capital));
  cuotas = Number(cuotas);
  interestPct = Number(interestPct);
  if (!(capital > 0)) throw new Error('El capital debe ser mayor que 0');
  if (!Number.isInteger(cuotas) || cuotas < 1 || cuotas > 400) throw new Error('Las cuotas deben ser un entero entre 1 y 400');
  if (!(interestPct >= 0)) throw new Error('El interés no puede ser negativo');

  const total = Math.round(capital * (1 + interestPct / 100));
  const base = Math.floor(total / cuotas);
  const rows = [];
  let fecha = startDate;
  let acumulado = 0;
  for (let n = 1; n <= cuotas; n++) {
    fecha = addDays(fecha, 1);
    if (skipSundays && parse(fecha).getDay() === 0) fecha = addDays(fecha, 1);
    const monto = n === cuotas ? total - base * (cuotas - 1) : base;
    acumulado += monto;
    rows.push({ n, fecha, monto, saldo: total - acumulado });
  }
  return { total, interes: total - capital, cuota: base, rows };
}

// Estado de un prestamo a una fecha. El saldo SIEMPRE se deriva de los pagos
// (nunca se guarda), asi no puede quedar inconsistente si algo falla (RNF-02).
export function status(loan, payments, hoy = today()) {
  const pagado = payments
    .filter((p) => p.loanId === loan.id && !p.anulado)
    .reduce((s, p) => s + p.monto, 0);
  const saldo = loan.total - pagado;

  let acumulado = 0;
  let cubiertas = 0; // cuotas completas ya pagadas
  let vencidas = 0; // cuotas cuya fecha ya paso (antes de hoy)
  let esperado = 0; // lo que deberia llevar pagado hasta hoy (incluye la cuota de hoy)
  for (const r of loan.schedule) {
    acumulado += r.monto;
    if (acumulado <= pagado) cubiertas++;
    if (r.fecha < hoy) vencidas++;
    if (r.fecha <= hoy) esperado = acumulado;
  }
  return {
    pagado,
    saldo,
    cubiertas,
    atrasadas: Math.max(0, vencidas - cubiertas), // RF-08: cuotas vencidas sin pagar
    debidoHoy: Math.max(0, Math.min(saldo, esperado - pagado)), // atraso + cuota de hoy
    liquidado: saldo <= 0,
  };
}

// RF-07: distancia entre dos puntos GPS en metros (formula de Haversine)
export function distancia(a, b) {
  const R = 6371000;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// RF-07: ordena visitas por el "vecino mas cercano" partiendo de `origen`.
// Los clientes sin GPS van al final. items: [{ ..., gps: {lat, lng} | null }]
export function ordenarRuta(items, origen) {
  const conGps = items.filter((i) => i.gps);
  const sinGps = items.filter((i) => !i.gps);
  const ruta = [];
  let actual = origen;
  while (conGps.length) {
    let mejor = 0;
    let dMejor = Infinity;
    conGps.forEach((it, idx) => {
      const d = distancia(actual, it.gps);
      if (d < dMejor) {
        dMejor = d;
        mejor = idx;
      }
    });
    const [sig] = conGps.splice(mejor, 1);
    ruta.push(sig);
    actual = sig.gps;
  }
  return ruta.concat(sinGps);
}
