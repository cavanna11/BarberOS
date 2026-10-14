// ============================================================================
// Ausencias, del lado del servidor
// ============================================================================
// Gemelo de `src/utils/ausencias.js`. Duplicado a propósito y por la misma
// razón que `functions/planes.js`: las Cloud Functions no pueden importar del
// bundle de Vite. Si cambia la regla de solapamiento, cambia en los dos.
//
// El motor del navegador pinta la grilla, pero no puede ser la única autoridad:
// con la consola abierta se saltea. Acá es donde de verdad se rechaza el turno
// de un barbero que avisó que ese día no viene.
//
// La parte que decide (`motivoEnLista`) es SINCRÓNICA y recibe los documentos
// ya leídos. Es para que los turnos fijos, que recorren ocho semanas de fechas
// en un bucle, puedan leer las ausencias UNA vez y no una por fecha.

/** 'HH:MM' → minutos desde medianoche. null si no se entiende. */
function aMinutos(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function texto(min) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/**
 * ¿Choca el turno [inicio, fin) con alguna de estas ausencias? Devuelve el
 * motivo para mostrarle al cliente, o null si está libre.
 *
 * `propias` son las ausencias de ESE profesional en ESA fecha, ya filtradas.
 *
 * Falla CERRADO, igual que el navegador: un registro cuya franja no se entiende
 * bloquea el día entero. Alguien marcó que no viene; entre perder horarios y
 * mandarle un cliente a un barbero que no está, se pierden los horarios.
 */
function motivoEnLista(propias, inicio, fin) {
  if (!propias || !propias.length) return null;

  if (propias.some((a) => !a.desde || !a.hasta)) {
    return 'El profesional no atiende ese día.';
  }

  const intervalos = propias
    .map((a) => [aMinutos(a.desde), aMinutos(a.hasta)])
    .filter(([i, f]) => i !== null && f !== null && f > i);

  if (!intervalos.length) return 'El profesional no atiende ese día.';

  const choca = intervalos.find(([desde, hasta]) => inicio < hasta && fin > desde);
  return choca ? `El profesional no atiende de ${texto(choca[0])} a ${texto(choca[1])} ese día.` : null;
}

/** ¿Falta el día entero? Para apagar fechas sin mirar horarios. */
function faltaTodoElDia(propias) {
  return Boolean(propias && propias.length && propias.some((a) => !a.desde || !a.hasta));
}

/**
 * Las ausencias de un profesional en una fecha.
 *
 * Se consulta por `fecha` SOLA y se filtra el profesional en memoria. Dos
 * igualdades en la misma query pedirían un índice compuesto que el emulador no
 * exige y producción sí — es la trampa que ya pagamos con el tope de turnos por
 * cuenta. Un día tiene un puñado de ausencias como mucho.
 */
async function leerDeLaFecha(db, businessId, professionalId, fecha) {
  const snap = await db.collection(`businesses/${businessId}/ausencias`)
    .where('fecha', '==', fecha)
    .get();
  return snap.docs.map((d) => d.data()).filter((a) => a && a.professionalId === professionalId);
}

/** Todas las de un profesional, para recorrer un rango de fechas sin releer. */
async function leerDelProfesional(db, businessId, professionalId) {
  const snap = await db.collection(`businesses/${businessId}/ausencias`)
    .where('professionalId', '==', professionalId)
    .get();
  return snap.docs.map((d) => d.data()).filter(Boolean);
}

/** Lo que usa `createAppointment`: una fecha, una respuesta. */
async function motivoDeAusencia(db, businessId, professionalId, fecha, inicio, fin) {
  return motivoEnLista(await leerDeLaFecha(db, businessId, professionalId, fecha), inicio, fin);
}

module.exports = {
  motivoEnLista,
  faltaTodoElDia,
  leerDeLaFecha,
  leerDelProfesional,
  motivoDeAusencia,
};
