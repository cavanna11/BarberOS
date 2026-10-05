// ============================================================================
// Ingresos: el mes en curso y el historial mes por mes
// ============================================================================
// Aparte de `statsCalculator.js` a propósito: ese archivo anda y está marcado
// para no tocar. Esto se suma al costado, con la misma regla de oro — recibe
// arrays por argumento y no sabe de dónde salieron.
//
// Qué cuenta como ingreso: SOLO los turnos `completada`, igual que el total
// histórico que el panel ya mostraba. Un turno confirmado todavía no es plata
// cobrada, y uno con seña pagada tampoco: la seña es una parte, y el turno puede
// terminar en "no vino". Si algún día se quiere ver "lo que entró por señas",
// es otra métrica, no esta.
//
// Las fechas de los turnos son strings 'YYYY-MM-DD' (campo `appointmentDate`,
// NO `date`), así que el mes sale de cortar el string. Nada de `new Date()` en
// el medio: eso arrastra la zona horaria del browser y a partir de las 21:00 en
// Argentina ya contaría el mes siguiente.

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

/** '2026-10-05' → '2026-10'. Devuelve null si la fecha no sirve. */
export function mesDe(fechaISO) {
  if (typeof fechaISO !== 'string' || fechaISO.length < 7) return null;
  const mes = fechaISO.slice(0, 7);
  return /^\d{4}-\d{2}$/.test(mes) ? mes : null;
}

/** El mes en curso, con el reloj de la máquina del que mira. */
export function mesActual(hoy = new Date()) {
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
}

/** '2026-10' → 'Octubre 2026'. */
export function nombreDeMes(mes) {
  if (!mes) return '';
  const [anio, m] = mes.split('-').map(Number);
  return `${MESES[m - 1] || mes} ${anio}`;
}

/** '2026-10' → 'Octubre' (sin año, para cuando el año ya está dicho). */
export function nombreCortoDeMes(mes) {
  if (!mes) return '';
  const m = Number(mes.split('-')[1]);
  return MESES[m - 1] || mes;
}

const esCobrado = (a) => a?.status === 'completada';
const precio = (a) => Number(a?.price) || 0;

/**
 * Lo facturado en un mes puntual. Devuelve `{ total, count }`.
 * `mes` en formato 'YYYY-MM'; por defecto, el mes en curso.
 */
export function ingresosDelMes(appointments = [], mes = mesActual()) {
  let total = 0;
  let count = 0;
  for (const a of appointments) {
    if (!esCobrado(a)) continue;
    if (mesDe(a.appointmentDate) !== mes) continue;
    total += precio(a);
    count++;
  }
  return { total, count };
}

/**
 * Historial completo, un renglón por mes con movimiento, del más nuevo al más
 * viejo. Los meses sin un solo turno completado no aparecen: una fila en cero
 * para un mes en que la barbería no existía no informa nada.
 */
export function historialPorMes(appointments = []) {
  const porMes = new Map();
  for (const a of appointments) {
    if (!esCobrado(a)) continue;
    const mes = mesDe(a.appointmentDate);
    if (!mes) continue;
    const fila = porMes.get(mes) || { mes, total: 0, count: 0 };
    fila.total += precio(a);
    fila.count++;
    porMes.set(mes, fila);
  }
  return [...porMes.values()].sort((a, b) => b.mes.localeCompare(a.mes));
}

/** El total histórico, para no recorrer dos veces cuando ya se pidió el resto. */
export function ingresosHistoricos(appointments = []) {
  let total = 0;
  let count = 0;
  for (const a of appointments) {
    if (!esCobrado(a)) continue;
    total += precio(a);
    count++;
  }
  return { total, count };
}

/**
 * Cuánto cambió el mes en curso contra el anterior, en porcentaje.
 * Devuelve null cuando no hay mes anterior con qué comparar: "+100%" porque el
 * mes pasado la cuenta no existía es un número que engaña.
 */
export function variacionMensual(historial = []) {
  if (historial.length < 2) return null;
  const [actual, anterior] = historial;
  if (!anterior.total) return null;
  return Math.round(((actual.total - anterior.total) / anterior.total) * 100);
}

// ── Ingresos de la PLATAFORMA (las suscripciones que cobra BarberOS) ────────
// Ojo con no mezclar las dos cosas: lo de arriba es lo que factura una
// barbería cortando pelo; esto es lo que BarberOS le cobra a las barberías.
// Son dos cajas distintas y ponerlas juntas en un mismo número no querría
// decir nada.
//
// Cada cobro registrado desde el panel global deja un documento en
// `platform/cobros/items` con `{ businessId, monto, fecha }`. Antes solo se
// pisaba `lastPaymentDate` en la facturación del negocio, así que la plata
// cobrada el mes pasado no quedaba en ningún lado: el historial arranca el día
// que esto se puso.

/** Suma de cobros de un mes. `cobros`: docs de platform/cobros/items. */
export function cobradoEnElMes(cobros = [], mes = mesActual()) {
  let total = 0;
  let count = 0;
  for (const c of cobros) {
    if (mesDe(c?.fecha) !== mes) continue;
    total += Number(c?.monto) || 0;
    count++;
  }
  return { total, count };
}

/** Todo lo cobrado desde que se registra. */
export function cobradoHistorico(cobros = []) {
  let total = 0;
  for (const c of cobros) total += Number(c?.monto) || 0;
  return { total, count: cobros.length };
}

/** Historial de cobros de la plataforma, por mes, del más nuevo al más viejo. */
export function cobrosPorMes(cobros = []) {
  const porMes = new Map();
  for (const c of cobros) {
    const mes = mesDe(c?.fecha);
    if (!mes) continue;
    const fila = porMes.get(mes) || { mes, total: 0, count: 0 };
    fila.total += Number(c?.monto) || 0;
    fila.count++;
    porMes.set(mes, fila);
  }
  return [...porMes.values()].sort((a, b) => b.mes.localeCompare(a.mes));
}
