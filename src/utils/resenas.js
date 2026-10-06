// ============================================================================
// Reseñas: filtros y promedios
// ============================================================================
// Misma regla que el resto de los utils de cálculo: reciben arrays por
// argumento y no saben de dónde salieron ni quién los mira.
//
// Las reseñas guardan `appointmentDate` (la fecha del turno, 'YYYY-MM-DD'), que
// es por la que tiene sentido filtrar: "las reseñas de septiembre" son las de
// los turnos de septiembre, no las de los que escribieron en septiembre un
// turno de agosto.

// Solo un link de Google de verdad. El campo lo escribe el dueño y termina en un
// href que toca el cliente: un `javascript:` ahí sería XSS. Misma lista que la
// de Maps en FichaBarberia, más los dominios de reseñas.
const GOOGLE_OK = /^https:\/\/(g\.page|search\.google\.[a-z.]+|www\.google\.[a-z.]+|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl)\//i;

/** El link para dejar reseña en Google de esta barbería, o null. */
export function linkGoogle(business) {
  const url = String(business?.googleReviewUrl || '').trim();
  return url && GOOGLE_OK.test(url) ? url : null;
}

/** Hoy, en la zona del que mira, como 'YYYY-MM-DD'. */
function hoyISO(hoy = new Date()) {
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
}

/**
 * Desde qué día incluye cada período. Devuelve 'YYYY-MM-DD' o null para
 * "siempre".
 *
 * La semana arranca el LUNES, que es como se piensa una semana de trabajo en
 * una barbería (el domingo es el final, no el principio).
 */
export function desdeCuando(periodo, hoy = new Date()) {
  const d = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  if (periodo === 'hoy') return hoyISO(d);
  if (periodo === 'semana') {
    const diaSemana = (d.getDay() + 6) % 7; // 0 = lunes
    d.setDate(d.getDate() - diaSemana);
    return hoyISO(d);
  }
  if (periodo === 'mes') return hoyISO(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
  if (periodo === 'anio') return hoyISO(new Date(hoy.getFullYear(), 0, 1));
  return null;
}

export const PERIODOS = [
  { id: 'todo', label: 'Siempre' },
  { id: 'hoy', label: 'Hoy' },
  { id: 'semana', label: 'Esta semana' },
  { id: 'mes', label: 'Este mes' },
  { id: 'anio', label: 'Este año' },
  { id: 'rango', label: 'Entre dos fechas' },
];

/**
 * Aplica los filtros combinados. Todos son opcionales y se cruzan entre sí:
 * "las de la sucursal Centro, de Juan, de septiembre" es un solo llamado.
 */
export function filtrarResenas(resenas = [], { periodo = 'todo', desde = '', hasta = '', professionalId = '', businessId = '', estrellas = 0 } = {}) {
  const limite = periodo === 'rango' ? (desde || null) : desdeCuando(periodo);
  const tope = periodo === 'rango' ? (hasta || null) : null;

  return resenas.filter((r) => {
    const fecha = r.appointmentDate || '';
    if (limite && fecha < limite) return false;
    if (tope && fecha > tope) return false;
    if (professionalId && r.professionalId !== professionalId) return false;
    if (businessId && r.businessId !== businessId) return false;
    if (estrellas && Number(r.stars) !== Number(estrellas)) return false;
    return true;
  });
}

/**
 * Promedio, total y distribución de 1 a 5.
 *
 * El promedio se redondea a un decimal al mostrarlo, no acá: devolver el número
 * crudo deja que quien lo use decida cómo presentarlo.
 */
export function estadisticasDeResenas(resenas = []) {
  const distribucion = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let suma = 0;
  let total = 0;

  for (const r of resenas) {
    const n = Number(r?.stars);
    if (!Number.isFinite(n) || n < 1 || n > 5) continue;
    distribucion[Math.round(n)]++;
    suma += n;
    total++;
  }

  return {
    total,
    promedio: total ? suma / total : 0,
    distribucion,
    conComentario: resenas.filter((r) => String(r?.comment || '').trim()).length,
  };
}

/** Promedio y cantidad por barbero, del mejor puntuado al peor. */
export function promedioPorBarbero(resenas = [], professionals = []) {
  const porId = new Map();
  for (const r of resenas) {
    const id = r?.professionalId;
    if (!id) continue;
    const fila = porId.get(id) || { id, suma: 0, total: 0 };
    const n = Number(r.stars);
    if (!Number.isFinite(n)) continue;
    fila.suma += n;
    fila.total++;
    porId.set(id, fila);
  }

  return [...porId.values()]
    .map((f) => ({
      id: f.id,
      name: professionals.find((p) => p.id === f.id)?.name || 'Barbero',
      total: f.total,
      promedio: f.total ? f.suma / f.total : 0,
    }))
    .sort((a, b) => b.promedio - a.promedio || b.total - a.total);
}

/** Promedio y cantidad por sucursal, para las cuentas con varias. */
export function promedioPorSucursal(resenas = [], sucursales = []) {
  const porId = new Map();
  for (const r of resenas) {
    const id = r?.businessId;
    if (!id) continue;
    const fila = porId.get(id) || { id, suma: 0, total: 0 };
    const n = Number(r.stars);
    if (!Number.isFinite(n)) continue;
    fila.suma += n;
    fila.total++;
    porId.set(id, fila);
  }

  return [...porId.values()]
    .map((f) => ({
      id: f.id,
      name: sucursales.find((s) => s.id === f.id)?.name || 'Sucursal',
      total: f.total,
      promedio: f.total ? f.suma / f.total : 0,
    }))
    .sort((a, b) => b.promedio - a.promedio || b.total - a.total);
}

/** '★★★★☆' para un puntaje. Para listados, no para elegir. */
export function estrellasDe(n) {
  const llenas = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
  return { llenas: '★'.repeat(llenas), vacias: '★'.repeat(5 - llenas) };
}
