// ============================================
// ESTADO INICIAL — BarberOS (producción)
// ============================================
// Reemplaza al viejo `mockData.js`, que traía 4 negocios de demostración,
// profesionales, servicios, 12 citas y 108 logs de WhatsApp inventados.
//
// La base arranca VACÍA. Los negocios se dan de alta a mano desde
// /super-admin → "Nueva barbería", que es el modelo de venta: el cliente se
// contacta, se cierra la venta, y la cuenta se prepara desde el panel global.
//
// El único acceso pre-cargado es el dueño de la plataforma, definido en
// src/config/platform.js (no vive acá porque no pertenece a ningún negocio).

/** Negocios (tenants). Se crean desde el panel de super-admin. */
export const businesses = [];

/**
 * Negocio activo. `null` hasta que exista al menos uno: la app entera maneja
 * este caso, no asume que hay un negocio cargado.
 */
export const businessSettings = null;

/** Staff de cada negocio. Los carga el dueño de la barbería desde /admin. */
export const professionals = [];

/** Catálogo de servicios de cada negocio. */
export const services = [];

/** Qué profesional presta qué servicio (y con qué precio/duración propios). */
export const professionalServices = [];

/** Horarios de trabajo por profesional y día. */
export const schedules = [];

/** Turnos reservados. */
export const appointments = [];

/** Clientes. Se crean solos cuando alguien reserva con su cuenta de Google. */
export const users = [];

/**
 * Admins autorizados por negocio. Se completa al dar de alta cada barbería
 * (el Gmail del dueño) y desde /admin/admins (su equipo).
 * El dueño de la plataforma NO va acá: va en platform.js.
 */
export const authorizedAdmins = [];

/**
 * Credenciales de la API de WhatsApp Cloud. Vacías a propósito: se cargan una
 * sola vez desde /super-admin → "API WhatsApp Cloud". Un número único de SACIA
 * para todos los tenants.
 *
 * NUNCA hardcodear el token acá. En producción va como variable de entorno del
 * backend (ver FIREBASE_SETUP.md) — el token no debe llegar nunca al browser.
 */
export const whatsappConfig = {
  status: 'disconnected',
  phoneId: '',
  token: '',
  templateConfirmation:
    'Hola {{1}}, tu turno en {{2}} para el día {{3}} a las {{4}} quedó confirmado. ¡Te esperamos!',
  templateReminder:
    'Hola {{1}}, te recordamos tu turno en {{2}} el día {{3}} a las {{4}}. Si no podés asistir, cancelalo con anticipación.',
};

/** Log de mensajes enviados. Se llena solo. */
export const whatsappLogs = [];
