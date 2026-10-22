// Adicionales de un turno (cejas, lavado, café…): se suman al servicio
// principal y se guardan en el turno como `adicionales: [{ id, name, price }]`
// (los escribe createAppointment, con el precio del documento de cada uno).

/** ' · 💳 tarjeta/QR' si dijo que paga con tarjeta (y la barbería cobra recargo). */
export function textoMetodoPago(turno) {
  return turno?.metodoPago === 'tarjeta' ? ' · 💳 tarjeta/QR' : '';
}

/**
 * ' · 🧴 Cera mate ×2' — lo que el cliente se lleva.
 *
 * No es decoración: es lo único que le dice al barbero que tiene que sacar algo
 * del estante cuando atienda a esa persona. Un producto comprado que no aparece
 * en la agenda es un producto que el cliente pagó y nadie le dio.
 */
export function textoProductos(turno) {
  const lista = Array.isArray(turno?.productos) ? turno.productos : [];
  if (!lista.length) return '';
  const partes = lista.map((p) => (Number(p.cantidad) > 1 ? `${p.name} ×${p.cantidad}` : p.name));
  return ` · 🧴 ${partes.join(', ')}`;
}

/** ' + Cejas, Lavado' para pegar al nombre del servicio; '' si no tiene. */
export function textoAdicionales(turno) {
  const lista = Array.isArray(turno?.adicionales) ? turno.adicionales : [];
  const extras = lista.length ? ` + ${lista.map((a) => a.name).join(', ')}` : '';
  // Viene con alguien: el turno atiende a dos, uno atrás del otro. Desde el
  // 21/10 es siempre "2 turnos seguidos" del mismo servicio; los turnos de
  // antes pueden traer el servicio de la otra persona.
  const a = turno?.acompanante;
  const acomp = !a?.serviceId ? ''
    : a.serviceId === turno.serviceId ? ' · 👥 2 turnos seguidos'
      : ` · 👨‍👦 con otro: ${a.name}`;
  // Los productos van en la misma línea y por el mismo motivo que los
  // adicionales: es lo que el barbero tiene que saber sin abrir el turno.
  return extras + acomp + textoProductos(turno);
}
