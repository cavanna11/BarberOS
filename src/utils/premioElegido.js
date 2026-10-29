// ============================================================================
// El premio que el cliente eligió usar, de "Tus premios" a la reserva
// ============================================================================
// "Usar" en Tus premios lleva a la reserva con ese premio ya elegido. Va en
// sessionStorage por la misma razón que el cupón del link (`utils/cupon.js`):
// tiene que sobrevivir al login y a la vuelta de Mercado Pago, que desmontan la
// app, y es de ESTA visita — mañana no tiene que aparecer elegido solo.
//
// Por barbería: en una cuenta con sucursales los premios son de cada local.

const CLAVE = (businessId) => `barberos:premio:${businessId}`;

export function recordarPremio(businessId, id) {
  if (!businessId || !id) return;
  try { sessionStorage.setItem(CLAVE(businessId), id); } catch { /* sin storage, se elige a mano */ }
}

export function premioRecordado(businessId) {
  if (!businessId) return null;
  try { return sessionStorage.getItem(CLAVE(businessId)); } catch { return null; }
}

export function olvidarPremio(businessId) {
  if (!businessId) return;
  try { sessionStorage.removeItem(CLAVE(businessId)); } catch { /* nada */ }
}
