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
// Tres formas, y cada una la pidió un caso real:
//
//   día completo      hoy no viene
//   franja            hoy se va de 15:00 a 18:00 y después vuelve
//   horario especial  mañana trabaja SOLO de 10:00 a 13:00
//
// La tercera es de Santiago (16/10/2026): "mañana este barbero trabaja de 10 a
// 1 de la tarde, el resto de los días normal". Estaba la opción de decir cuándo
// NO vas a estar, pero no la de decir que ese día tu horario es otro.
//
// ── Por qué el horario especial vive ACÁ y no en `schedules` ────────────────
// Porque es lo mismo que una ausencia dicho al revés. Se guarda el rato que SÍ
// trabaja (`trabajaDesde`/`trabajaHasta`) y `bloqueosDelDia` devuelve los ratos
// de AFUERA, que es lo que el motor ya sabe descontar. Un horario en
// `schedules` es el de TODOS los miércoles; ponerle una fecha ahí obligaría al
// motor, al servidor, a los turnos fijos y al modal del staff a aprender un
// caso nuevo cada uno. Así no aprende ninguno.
//
// ── Por qué `desde`/`hasta` quedan en null en esos documentos ──────────────
// Para que un servidor o un bundle VIEJO —el que todavía no sabe de esto— lea
// un documento sin franja y bloquee el día ENTERO. Si se reusaran `desde` y
// `hasta` para guardar el rato que SÍ trabaja, el código viejo leería "no
// trabaja de 10 a 13": exactamente lo contrario, y mudo. Perder un día de
// horarios se nota y se arregla; mandarle un cliente a un barbero que no está,
// no.
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

/** Minutos de un día. El límite de los intervalos que se bloquean. */
export const DIA_COMPLETO = 24 * 60;

/**
 * ¿Este documento dice "ese día trabajo de X a Y" y no "ese día no vengo"?
 *
 * Alcanza con que tenga UNO de los dos campos: así un documento a medio
 * escribir no pasa por ausencia —que tendría la franja en null y bloquearía el
 * día entero sin que nadie lo pidiera— sino por horario especial roto, y
 * `bloqueosDelDia` lo trata como lo que es.
 */
export function esHorarioEspecial(a) {
  return Boolean(a && (a.trabajaDesde || a.trabajaHasta));
}

/**
 * El id del horario especial de un día. Uno por profesional y por fecha: el
 * día tiene UN horario, no varios.
 *
 * El sufijo es otro que el de la ausencia de día completo (`_todo`) a
 * propósito: cargar un horario especial no puede pisar en silencio el día que
 * el barbero marcó que no venía. Conviven, y gana el que no viene.
 */
export function idDeHorarioEspecial(professionalId, fecha) {
  return `${professionalId}_${fecha}_horario`;
}

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

/**
 * 'HH:MM' → minutos, o NaN si no se entiende.
 *
 * `timeToMinutes` hace `.split(':')` sin red: con un campo faltante TIRA, y
 * acá eso no es un error que se vea en un log — es la grilla del cliente
 * reventando entera en el navegador por un documento a medio escribir. Lo
 * encontró un caso de la suite. Esta función convierte ese reviente en un NaN,
 * que es lo que `bloqueosDelDia` ya sabe tratar: bloquear el día.
 */
function minutosDe(v) {
  return esHora(v) ? timeToMinutes(v) : NaN;
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

/**
 * Qué está mal en este horario especial, o null si está bien.
 *
 * Las dos horas son obligatorias: media escrita es media olvidada, y el turno
 * que entre en la otra mitad no lo quería nadie.
 */
export function errorDeHorarioEspecial({ fecha, trabajaDesde = null, trabajaHasta = null } = {}) {
  if (!esFecha(fecha)) return 'Elegí una fecha.';
  if (!esHora(trabajaDesde) || !esHora(trabajaHasta)) {
    return 'Poné desde qué hora y hasta qué hora vas a trabajar ese día.';
  }
  if (timeToMinutes(trabajaHasta) <= timeToMinutes(trabajaDesde)) {
    return 'La hora de fin tiene que ser posterior a la de inicio.';
  }
  return null;
}

/** Normaliza el horario especial. `desde`/`hasta` van en null a propósito. */
export function normalizarHorarioEspecial({ professionalId, fecha, trabajaDesde = null, trabajaHasta = null } = {}) {
  const ok = esHora(trabajaDesde) && esHora(trabajaHasta);
  return {
    professionalId,
    fecha,
    desde: null,
    hasta: null,
    trabajaDesde: ok ? trabajaDesde : null,
    trabajaHasta: ok ? trabajaHasta : null,
  };
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

  const horarios = propias.filter(esHorarioEspecial);
  const faltas = propias.filter((a) => !esHorarioEspecial(a));

  // Una falta sin franja es el día entero, y le gana a cualquier horario
  // especial del mismo día: si alguien marcó que no viene, no viene.
  if (faltas.some((a) => !a.desde || !a.hasta)) {
    return { todoElDia: true, intervalos: [] };
  }

  const intervalos = [];

  // El horario especial entra como los ratos de AFUERA. Así se descuenta en el
  // mismo lugar que el descanso del mediodía y el corte del local, y ni el
  // motor ni el servidor necesitan un camino nuevo.
  for (const h of horarios) {
    const abre = minutosDe(h.trabajaDesde);
    const cierra = minutosDe(h.trabajaHasta);
    // Falla CERRADO, igual que una franja que no se entiende: alguien escribió
    // que ese día su horario es otro y no se pudo leer cuál.
    if (!Number.isFinite(abre) || !Number.isFinite(cierra) || cierra <= abre) {
      return { todoElDia: true, intervalos: [] };
    }
    if (abre > 0) intervalos.push([0, abre]);
    if (cierra < DIA_COMPLETO) intervalos.push([cierra, DIA_COMPLETO]);
  }

  for (const a of faltas) {
    const i = minutosDe(a.desde);
    const f = minutosDe(a.hasta);
    if (Number.isFinite(i) && Number.isFinite(f) && f > i) intervalos.push([i, f]);
  }

  // Si hay un registro para este día pero no se le pudo sacar ni un intervalo
  // usable, se bloquea el día ENTERO. Falla cerrado a propósito: alguien marcó
  // que no viene, y entre perder unos horarios y mandarle un cliente a un
  // barbero que no está, se pierden los horarios. No debería pasar nunca —se
  // valida al guardar y las Rules lo acotan— pero esta es la función de la que
  // dependen el motor y el servidor para decidir, y acá no se adivina.
  if (!intervalos.length) return { todoElDia: true, intervalos: [] };

  intervalos.sort((a, b) => a[0] - b[0]);
  return { todoElDia: false, intervalos };
}

/**
 * El horario especial de ese día, o null si ese día rige el semanal.
 *
 * Devuelve `{ desde, hasta }` en 'HH:MM'. Lo usa el calendario para no dejar
 * prendido un día en el que el horario especial no se cruza con el semanal
 * —ahí no queda ni un turno— y el panel para contar qué turnos quedaron
 * afuera.
 */
export function ventanaDelDia(ausencias = [], professionalId, fecha) {
  const h = (ausencias || []).find(
    (a) => a && a.professionalId === professionalId && a.fecha === fecha && esHorarioEspecial(a)
  );
  if (!h || !esHora(h.trabajaDesde) || !esHora(h.trabajaHasta)) return null;
  if (timeToMinutes(h.trabajaHasta) <= timeToMinutes(h.trabajaDesde)) return null;
  return { desde: h.trabajaDesde, hasta: h.trabajaHasta };
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
