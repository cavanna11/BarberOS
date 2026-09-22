// ============================================================================
// De dónde salió un turno
// ============================================================================
// El cliente que reserva por el link pasa por createAppointment, que marca
// `origen: 'cliente'`. Lo que carga el staff desde el panel lleva `type`:
// 'manual' (se lo pidieron por WhatsApp o en persona) o 'walkin' (el que ya
// está sentado en la silla). Los turnos viejos no tienen ninguno de los dos:
// son de cuando solo reservaba el cliente, así que se leen como online.

export function origenTurno(apt) {
  if (apt?.type === 'walkin') return { clave: 'walkin', etiqueta: 'Sin turno', detalle: 'Servicio sin turno previo', icono: '\u2702\ufe0f', clase: 'badge-neutral' };
  if (apt?.type === 'manual') return { clave: 'manual', etiqueta: 'Lo cargaste vos', detalle: 'Cargado a mano desde el panel', icono: '\u270d\ufe0f', clase: 'badge-neutral' };
  return { clave: 'cliente', etiqueta: 'Lo reservó el cliente', detalle: 'Reservado por el cliente desde el link', icono: '\ud83d\udcf1', clase: 'badge-primary' };
}
