// ============================================================================
// La reserva a medio hacer
// ============================================================================
// El cliente elige barbero, servicio, día y hora, y recién ahí se le pide
// entrar con Google. Varios se fueron en ese punto creyendo que el turno ya
// estaba: eligieron todo, vieron la pantalla de Google y cerraron.
//
// Acá se guarda lo elegido para poder decirle, cuando vuelva: "te faltó
// confirmar este turno". Vive en localStorage, del lado del cliente: no es un
// turno, no ocupa la agenda y no lo ve la barbería. Solo sirve para que no
// pierda lo que ya eligió.

const CLAVE = 'barberos:reserva-pendiente';
const HORAS_VALIDA = 48;

/** Guarda lo elegido hasta ahora. Silencioso si no hay localStorage. */
export function guardarPendiente(datos) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify({ ...datos, guardadoEn: Date.now() }));
  } catch { /* modo privado, sin storage: no es grave */ }
}

export function borrarPendiente() {
  try { localStorage.removeItem(CLAVE); } catch { /* nada */ }
}

/**
 * Devuelve la reserva a medio hacer de ESTE negocio, si sigue teniendo
 * sentido: no venció, y el horario todavía no pasó. Si no, null (y se limpia).
 */
export function leerPendiente(businessId) {
  let guardado;
  try { guardado = JSON.parse(localStorage.getItem(CLAVE) || 'null'); } catch { return null; }
  if (!guardado || guardado.businessId !== businessId) return null;

  const vencida = Date.now() - (guardado.guardadoEn || 0) > HORAS_VALIDA * 3600 * 1000;
  // Ofrecerle retomar un turno de ayer sería peor que no ofrecerle nada.
  const yaPaso = guardado.date && guardado.startTime
    ? new Date(`${guardado.date}T${guardado.startTime}:00`) <= new Date()
    : true;

  if (vencida || yaPaso) { borrarPendiente(); return null; }
  return guardado;
}
