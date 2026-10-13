// Adicionales de un turno (cejas, lavado, café…): se suman al servicio
// principal y se guardan en el turno como `adicionales: [{ id, name, price }]`
// (los escribe createAppointment, con el precio del documento de cada uno).

/** ' + Cejas, Lavado' para pegar al nombre del servicio; '' si no tiene. */
export function textoAdicionales(turno) {
  const lista = Array.isArray(turno?.adicionales) ? turno.adicionales : [];
  return lista.length ? ` + ${lista.map((a) => a.name).join(', ')}` : '';
}
