// ============================================================================
// Qué sucursal eligió la plataforma para administrar, en esta pestaña
// ============================================================================
// Cuando la plataforma entra a una cuenta con varias sucursales, lo primero es
// elegir cuál (ver ElegirSucursalPanel). Esto recuerda que ya eligió, para no
// volver a preguntarle en cada pantalla. Vive en sessionStorage a propósito:
// cada vez que se entra a la cuenta desde el panel global se borra y se vuelve
// a preguntar, que es justamente cuando se puede confundir de local.
//
// Es estado de interfaz, no un permiso: lo que puede tocar cada uno lo deciden
// las Rules.

const clave = (grupoId) => `barberos:sucursalEnPanel:${grupoId}`;

export function sucursalElegidaEnPanel(grupoId) {
  if (!grupoId) return null;
  try { return sessionStorage.getItem(clave(grupoId)); } catch { return null; }
}

export function elegirSucursalEnPanel(grupoId, businessId) {
  if (!grupoId) return;
  try { sessionStorage.setItem(clave(grupoId), businessId); } catch { /* sin storage: vuelve a preguntar */ }
}

export function olvidarSucursalEnPanel(grupoId) {
  if (!grupoId) return;
  try { sessionStorage.removeItem(clave(grupoId)); } catch { /* nada */ }
}
