// ============================================
// Configuración de la plataforma (BarberOS)
// ============================================

/**
 * Dueños de la PLATAFORMA — acceso al panel global /super-admin: dan de alta
 * barberías, cobran abonos, suspenden cuentas y configuran WhatsApp.
 *
 * No pertenecen a ningún negocio (su `businessId` es null), y NO se gestionan
 * desde la UI a propósito: es una lista en código, así nadie puede otorgarse
 * acceso global desde el panel. Para agregar un socio, se agrega acá y se
 * despliega de nuevo.
 *
 * Nota: se quitó `pocopanjugueteria@gmail.com`, que venía de los datos de
 * prueba con acceso total y estaba marcado en el código como "reemplazar con el
 * Gmail real del dueño". Si es una cuenta tuya o de un socio, agregala abajo.
 */
export const PLATFORM_OWNERS = [
  'cavannaprogramacion@gmail.com',
];

export function isPlatformOwner(email) {
  if (!email) return false;
  return PLATFORM_OWNERS.includes(email.toLowerCase());
}

/**
 * Negocio al que se adoptan los registros viejos de `localStorage` que no
 * tienen `businessId`. Solo aplica a bases creadas antes de la multi-tenancy;
 * en una instalación nueva nunca se usa.
 */
export const LEGACY_BUSINESS_ID = 'biz-001';
