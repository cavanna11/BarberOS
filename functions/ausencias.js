// ============================================================================
// Ausencias, del lado del servidor
// ============================================================================
// Gemelo de `src/utils/ausencias.js` — ausencias (día completo o franja) y el
// horario especial de un día suelto. Duplicado a propósito y por la misma
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
 * ¿Este documento dice "ese día trabajo de X a Y" y no "ese día no vengo"?
 *
 * Gemelo de `esHorarioEspecial` en `src/utils/ausencias.js`. Alcanza con UNO
 * de los dos campos: un documento a medio escribir tiene que caer por el
 * camino del horario roto —que bloquea el día— y no por el de la ausencia.
 */
function esHorarioEspecial(a) {
  return Boolean(a && (a.trabajaDesde || a.trabajaHasta));
}

/**
 * ¿Choca el turno [inicio, fin) con lo que hay cargado ese día? Devuelve el
 * motivo para mostrarle al cliente, o null si está libre.
 *
 * `propias` son los documentos de ESE profesional en ESA fecha, ya filtrados.
 * Pueden ser ausencias (día completo o franja) o el horario especial del día.
 *
 * Falla CERRADO, igual que el navegador: un registro que no se entiende
 * bloquea el día entero. Alguien escribió que ese día es distinto; entre
 * perder horarios y mandarle un cliente a un barbero que no está, se pierden
 * los horarios.
 */
function motivoEnLista(propias, inicio, fin) {
  if (!propias || !propias.length) return null;

  const horarios = propias.filter(esHorarioEspecial);
  const faltas = propias.filter((a) => !esHorarioEspecial(a));

  // Una falta sin franja es el día entero y le gana al horario especial.
  if (faltas.some((a) => !a.desde || !a.hasta)) {
    return 'El profesional no atiende ese día.';
  }

  // El horario especial recorta el día: el turno tiene que caer ENTERO
  // adentro. A diferencia del horario semanal —donde alcanza con empezar
  // dentro, para no echar al cliente a la mitad del corte— acá el barbero
  // avisó que ese día se va a esa hora, y a esa hora se va.
  for (const h of horarios) {
    const abre = aMinutos(h.trabajaDesde);
    const cierra = aMinutos(h.trabajaHasta);
    if (abre === null || cierra === null || cierra <= abre) {
      return 'El profesional no atiende ese día.';
    }
    if (inicio < abre || fin > cierra) {
      return `Ese día el profesional atiende solo de ${texto(abre)} a ${texto(cierra)}.`;
    }
  }

  const intervalos = faltas
    .map((a) => [aMinutos(a.desde), aMinutos(a.hasta)])
    .filter(([i, f]) => i !== null && f !== null && f > i);

  // Hay registros del día y no se pudo leer ni uno: se bloquea.
  if (!horarios.length && !intervalos.length) {
    return 'El profesional no atiende ese día.';
  }

  const choca = intervalos.find(([desde, hasta]) => inicio < hasta && fin > desde);
  return choca ? `El profesional no atiende de ${texto(choca[0])} a ${texto(choca[1])} ese día.` : null;
}

/** ¿Falta el día entero? Para apagar fechas sin mirar horarios. */
function faltaTodoElDia(propias) {
  return Boolean(propias && propias.length
    && propias.some((a) => !esHorarioEspecial(a) && (!a.desde || !a.hasta)));
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
  esHorarioEspecial,
  motivoEnLista,
  faltaTodoElDia,
  leerDeLaFecha,
  leerDelProfesional,
  motivoDeAusencia,
};
