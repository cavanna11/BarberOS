// ============================================================================
// Ventana de disponibilidad de un servicio (promos por día y horario)
// ============================================================================
// Un servicio puede ofrecerse solo ciertos días y en cierta franja: "Corte de
// media tarde, martes y miércoles de 16:30 a 19:30, 10% menos". Se guarda en
// el documento del servicio como
//
//   ventana: { dias: [1, 2], desde: '16:30', hasta: '19:30' }
//
// con `dias` en la convención de la app (0=Lunes … 6=Domingo, igual que los
// horarios). Sin `ventana` (o null), el servicio se ofrece siempre.
//
// Lo usan la página de reserva (calendario y grilla), el modal del staff y
// —con la misma lógica copiada— createAppointment en el servidor, que es el
// que de verdad lo hace cumplir.

import { getLocalDayOfWeek, timeToMinutes } from './dateUtils';

const DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

/** ¿Tiene una ventana válida? (no todos los días o no todo el horario) */
export function tieneVentana(servicio) {
  const v = servicio?.ventana;
  if (!v) return false;
  const dias = Array.isArray(v.dias) ? v.dias : [];
  const horario = Boolean(v.desde && v.hasta);
  return dias.length > 0 || horario;
}

/** ¿El servicio se ofrece ese día? */
export function servicioAplicaAlDia(servicio, fechaISO) {
  const v = servicio?.ventana;
  if (!v || !Array.isArray(v.dias) || v.dias.length === 0) return true;
  const dow = getLocalDayOfWeek(new Date(`${fechaISO}T00:00:00`));
  return v.dias.includes(dow);
}

/**
 * ¿Un turno que empieza a `startTime` entra en la franja del servicio?
 *
 * Mira el arranque, no el final, igual que el horario del barbero: la promo de
 * 16:30 a 19:30 incluye el turno de las 19:00 aunque termine 20:00. Exigir que
 * entrara entero dejaba la última hora de cada promo sin usar.
 */
export function servicioAplicaAlHorario(servicio, startTime) {
  const v = servicio?.ventana;
  if (!v || !v.desde || !v.hasta) return true;
  const ini = timeToMinutes(startTime);
  return ini >= timeToMinutes(v.desde) && ini < timeToMinutes(v.hasta);
}

/** "Solo martes y miércoles, de 16:30 a 19:30." para mostrar al cliente. */
export function describirVentana(servicio) {
  const v = servicio?.ventana;
  if (!tieneVentana(servicio)) return '';
  const partes = [];
  if (Array.isArray(v.dias) && v.dias.length > 0 && v.dias.length < 7) {
    const nombres = [...v.dias].sort((a, b) => a - b).map((d) => DIAS[d]).filter(Boolean);
    partes.push(nombres.length === 1 ? `solo los ${nombres[0]}` : `solo ${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`);
  }
  if (v.desde && v.hasta) partes.push(`de ${v.desde} a ${v.hasta}`);
  const texto = partes.join(', ');
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export const NOMBRES_DIAS_CORTOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
