// ============================================================================
// El link para que el cliente valore SU turno
// ============================================================================
// Lo pidió Santiago (27/10/2026): que el mensaje de "gracias" de WhatsApp
// lleve, además del agradecimiento, el link para valorar al peluquero y el de
// la ficha de Google.
//
// No hay una pantalla de reseña por turno: la valoración vive adentro de "Mis
// citas", en un modal. En vez de inventar una ruta nueva —con su sesión, su
// manejo de turno inexistente y su propio aislamiento— el link abre esa misma
// pantalla con `?valorar={idDelTurno}`, y ahí se abre el modal solo. Una ruta
// menos que mantener, y el aislamiento ya está resuelto: "Mis citas" muestra
// solo los turnos del que entró.

/** Turnos que el staff carga a mano: no son de una cuenta de cliente. */
const SIN_CUENTA = ['walkin', 'manual', 'fijo'];

/**
 * El link para valorar este turno, o '' si no corresponde ofrecerlo.
 *
 * Vacío cuando:
 *
 * - el turno no está atendido todavía (no hay nada que valorar, y las Rules lo
 *   rechazarían igual);
 * - lo cargó el staff a mano. Esos llevan el `userId` del que los cargó, así
 *   que el link le abriría "Mis citas" vacío a alguien que nunca entró a la
 *   app. Un link muerto adentro de un mensaje de agradecimiento es peor que no
 *   mandar ningún link;
 * - no se sabe el link público de la barbería.
 *
 * El dominio sale de `window.location.origin` y no de una constante: así el
 * mismo código sirve en producción, en una preview de Vercel y en localhost,
 * sin que nadie tenga que acordarse de cambiarlo.
 */
export function linkParaValorar(turno, business) {
  if (!turno || turno.status !== 'completada') return '';
  if (SIN_CUENTA.includes(turno.type)) return '';
  if (!turno.id || !turno.userId) return '';

  const slug = business?.slug;
  if (!slug) return '';

  const origen = typeof window !== 'undefined' && window.location
    ? window.location.origin
    : '';
  if (!origen) return '';

  return `${origen}/${slug}/mis-citas?valorar=${encodeURIComponent(turno.id)}`;
}
