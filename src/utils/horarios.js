// ============================================================================
// Horario semanal: validación y descripción
// ============================================================================
// Un día de horario es { isActive, startTime, endTime, breakStart, breakEnd }.
// El "horario cortado" (de 8 a 16 y de 19 a 22) se guarda como 08:00–22:00
// con corte 16:00–19:00: es lo que el motor de disponibilidad y
// createAppointment ya entendían como descanso, ahora visible y editable.
//
// Sirve tanto para businessHours (el local) como para schedules (cada barbero).

import { timeToMinutes } from './dateUtils';

/** Si el día tiene corte cargado (aunque esté a medio completar). */
export function tieneCorte(dia) {
  return Boolean(dia?.breakStart || dia?.breakEnd);
}

/**
 * Qué está mal en un día activo, o null si está bien. Los mensajes van
 * directo a la pantalla, al lado del día.
 */
export function avisoDelDia(dia) {
  if (!dia?.isActive) return null;
  if (!dia.startTime || !dia.endTime) return 'Falta el horario.';
  const ini = timeToMinutes(dia.startTime), fin = timeToMinutes(dia.endTime);
  if (fin <= ini) return 'El cierre tiene que ser después de la apertura.';
  if (!tieneCorte(dia)) return null;
  if (!dia.breakStart || !dia.breakEnd) return 'Completá las dos horas del corte.';
  const cIni = timeToMinutes(dia.breakStart), cFin = timeToMinutes(dia.breakEnd);
  if (cFin <= cIni) return 'La vuelta tiene que ser después del cierre.';
  if (cIni <= ini || cFin >= fin) return 'El corte tiene que quedar adentro del horario.';
  return null;
}

/** Primer problema de la semana, con el nombre del día, o null. */
export function errorDeHorario(dias, nombreDia) {
  for (let i = 0; i < (dias || []).length; i++) {
    const aviso = avisoDelDia(dias[i]);
    if (aviso) return `${nombreDia(dias[i].dayOfWeek ?? i)}: ${aviso}`;
  }
  return null;
}

/** "08:00–16:00 y 19:00–22:00", "09:00–19:00" o "" si no atiende. */
export function describirDia(dia) {
  if (!dia?.isActive || !dia.startTime || !dia.endTime) return '';
  if (tieneCorte(dia) && dia.breakStart && dia.breakEnd) {
    return `${dia.startTime}–${dia.breakStart} y ${dia.breakEnd}–${dia.endTime}`;
  }
  return `${dia.startTime}–${dia.endTime}`;
}

/**
 * Corte sugerido al apretar "horario cortado": dos horas alrededor del medio
 * del día, en múltiplos de 30. Para 08:00–22:00 da 14:00–16:00; el dueño lo
 * ajusta después.
 */
export function corteSugerido(dia) {
  const ini = timeToMinutes(dia.startTime || '09:00'), fin = timeToMinutes(dia.endTime || '19:00');
  const medio = Math.round((ini + fin) / 2 / 30) * 30;
  const pad = (n) => String(n).padStart(2, '0');
  const aHora = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  return { breakStart: aHora(Math.max(ini + 30, medio - 60)), breakEnd: aHora(Math.min(fin - 30, medio + 60)) };
}
