// ============================================================================
// Quién entra al panel de la barbería
// ============================================================================
// Existe por un bug, y por uno que ya había pasado una vez.
//
// Al agregar el rol `cajero` (14/10/2026) se lo sumó al guard que PROTEGE el
// panel (`ProtectedRoute`), pero no a los tres lugares que LLEVAN al panel
// después de iniciar sesión: el redirect del login, `PublicOnlyRoute` y
// `EntryRoute`. Cada uno tenía su propia copia de `role === 'owner' || role ===
// 'admin'`, escrita a mano.
//
// El resultado es el peor de los síntomas: la cajera entraba con Google
// perfecto, el sistema la reconocía —tenía su claim— pero la mandaba al flujo
// de reserva, a "elegí tu barbero", como si fuera una clienta. Sin error, sin
// cartel, sin nada que mirar.
//
// La lista vive acá, una sola vez. Agregar un rol nuevo y olvidarse de una de
// las cuatro copias ya no es posible.

/** Los roles que tienen panel de barbería. */
export const ROLES_DEL_PANEL = ['owner', 'admin', 'cajero'];

/**
 * ¿Esta persona entra al panel de la barbería?
 *
 * No incluye al equipo de la plataforma: ese va a `/super-admin` y se resuelve
 * antes, con sus propios claims.
 */
export function entraAlPanel(user) {
  return ROLES_DEL_PANEL.includes(user?.role);
}
