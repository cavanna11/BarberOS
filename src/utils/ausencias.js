// Con extension, a proposito: este modulo tiene que poder importarse tal cual
// desde `scripts/test-ausencias.mjs`, y Node exige la extension aunque Vite no.
import { timeToMinutes } from './dateUtils.js';

// ============================================================================
// Ausencias: el día suelto que el barbero no va, o el rato que se tiene que ir
// ============================================================================
// El horario semanal dice lo que pasa TODAS las semanas: Pepito trabaja los
// miércoles. Lo que faltaba era la excepción de una sola vez — este miércoles
// no puede— sin que haya que acordarse de volver a prenderlo el jueves. Esa es
// toda la idea: se marca una fecha, y el miércoles que viene sigue trabajando.
//
// Dos formas, y la segunda la pidió el mismo caso:
//
//   día completo   hoy no viene
//   franja         hoy se va de 15:00 a 18:00 y después vuelve
//
// Por eso NO es un `isActive` en el horario del día: eso apagaría todos los
// miércoles. Es un documento por fecha.
//
// ── Por qué un documento por DÍA y no un rango ──────────────────────────────
// Para las vacaciones daban ganas de guardar `{ desde, hasta }` y listo. No se
// puede preguntar: Firestore no admite desigualdad sobre dos campos distintos
// en la misma consulta, así que `fecha <= hoy AND hasta >= hoy` no existe. Con
// un documento por día, "¿está ausente?" es una igualdad y no necesita ni
// índice. Las vacaciones se cargan con un selector de desde/hasta que escribe
// los días de una sola vez.
//
// ── Por qué no lleva motivo ─────────────────────────────────────────────────
// La colección es de LECTURA PÚBLICA, porque la grilla del cliente la necesita
// antes de que haya sesión. "Está enfermo" o "se fue de viaje" quedaría legible
// para cualquiera que mire la API. Acá adentro va una fecha y, si acaso, un
// horario: nada que no se deduzca de ver la agenda vacía.

/**
 * El id del documento, determinista.
 *
 * Mismo criterio que las reseñas y los usos de membresía: el id ES la clave
 * natural, así que marcar dos veces el mismo día (o la misma franja) no crea
 * dos documentos. Sin esto, tocar el botón con la conexión lenta deja
 * duplicados que después hay que borrar de a uno.
 */
export function idDeAusencia(professionalId, fecha, desde = null) {
  const franja = desde ? String(desde).replace(':', '') : 'todo';
  return `${professionalId}_${fecha}_${franja}`;
}

/** ¿Es 'HH:MM' válido? */
function esHora(v) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || ''));
}

/** ¿Es 'YYYY-MM-DD' válido? */
export function esFecha(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
}

/**
 * Qué está mal en esta ausencia, o null si está bien.
 *
 * `desde` y `hasta` en null = el día entero. Uno solo de los dos es un error y
 * no un "desde ahí hasta que cierre": media franja escrita es media franja
 * olvidada, y el turno que entre en la otra mitad no lo quería nadie.
 */
export function errorDeAusencia({ fecha, desde = null, hasta = null } = {}) {
  if (!esFecha(fecha)) return 'Elegí una fecha.';
  if (desde === null && hasta === null) return null;
  if (!esHora(desde) || !esHora(hasta)) return 'Poné la hora de inicio y la de fin, o dejá las dos vacías para el día entero.';
  if (timeToMinutes(hasta) <= timeToMinutes(desde)) return 'La hora de fin tiene que ser posterior a la de inicio.';
  return null;
}

/** Normaliza lo que viene del formulario: vacío es null, no cadena vacía. */
export function normalizarAusencia({ professionalId, fecha, desde = null, hasta = null } = {}) {
  const d = esHora(desde) ? desde : null;
  const h = esHora(hasta) ? hasta : null;
  const franja = d && h;
  return {
    professionalId,
    fecha,
    desde: franja ? d : null,
    hasta: franja ? h : null,
  };
}

/**
 * Los ratos bloqueados de ESE profesional en ESA fecha.
 *
 * Devuelve `{ todoElDia, intervalos }`, con los intervalos en minutos desde
 * medianoche — la misma unidad en la que trabaja el motor, para que una
 * ausencia parcial se descuente igual que el corte del mediodía y no haga
 * falta un camino nuevo.
 */
export function bloqueosDelDia(ausencias = [], professionalId, fecha) {
  const propias = (ausencias || []).filter(
    (a) => a && a.professionalId === professionalId && a.fecha === fecha
  );
  if (!propias.length) return { todoElDia: false, intervalos: [] };

  if (propias.some((a) => !a.desde || !a.hasta)) {
    return { todoElDia: true, intervalos: [] };
  }

  const intervalos = propias
    .map((a) => [timeToMinutes(a.desde), timeToMinutes(a.hasta)])
    .filter(([i, f]) => Number.isFinite(i) && Number.isFinite(f) && f > i)
    .sort((a, b) => a[0] - b[0]);

  // Si hay un registro para este día pero no se le pudo sacar ni un intervalo
  // usable, se bloquea el día ENTERO. Falla cerrado a propósito: alguien marcó
  // que no viene, y entre perder unos horarios y mandarle un cliente a un
  // barbero que no está, se pierden los horarios. No debería pasar nunca —se
  // valida al guardar y las Rules lo acotan— pero esta es la función de la que
  // dependen el motor y el servidor para decidir, y acá no se adivina.
  if (!intervalos.length) return { todoElDia: true, intervalos: [] };

  return { todoElDia: false, intervalos };
}

/**
 * ¿Un turno de [inicio, fin) choca con una ausencia?
 *
 * Minutos desde medianoche. Es la pregunta que hacen el motor del navegador y
 * `createAppointment` del lado del servidor — las dos tienen que contestar lo
 * mismo, así que la cuenta vive acá y no duplicada en cada uno.
 */
export function chocaConAusencia(ausencias, professionalId, fecha, inicio, fin) {
  const { todoElDia, intervalos } = bloqueosDelDia(ausencias, professionalId, fecha);
  if (todoElDia) return true;
  return intervalos.some(([desde, hasta]) => inicio < hasta && fin > desde);
}

/** ¿Falta todo el día? Para pintar el calendario sin armar los intervalos. */
export function faltaTodoElDia(ausencias, professionalId, fecha) {
  return bloqueosDelDia(ausencias, professionalId, fecha).todoElDia;
}

/**
 * Las fechas de un rango, inclusive, para cargar vacaciones de una.
 *
 * Tope de un año: el selector deja elegir cualquier par de fechas y un dedo
 * torcido en el año escribiría miles de documentos.
 */
export function fechasEntre(desde, hasta, tope = 366) {
  if (!esFecha(desde) || !esFecha(hasta)) return [];
  const salida = [];
  const d = new Date(`${desde}T12:00:00`);
  const fin = new Date(`${hasta}T12:00:00`);
  if (fin < d) return [];
  while (d <= fin && salida.length < tope) {
    const m = String(d.getMonth() + 1).padStart(2, '0');
    salida.push(`${d.getFullYear()}-${m}-${String(d.getDate()).padStart(2, '0')}`);
    d.setDate(d.getDate() + 1);
  }
  return salida;
}

/**
 * Las ausencias de un profesional de hoy en adelante, ordenadas y agrupadas por
 * día, que es como se leen en el panel.
 */
export function proximas(ausencias = [], professionalId, desdeFecha) {
  return (ausencias || [])
    .filter((a) => a && a.professionalId === professionalId && a.fecha >= desdeFecha)
    .sort((a, b) => (a.fecha === b.fecha
      ? String(a.desde || '').localeCompare(String(b.desde || ''))
      : a.fecha.localeCompare(b.fecha)));
}
