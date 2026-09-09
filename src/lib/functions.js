// ============================================================================
// Capa de acceso a las Cloud Functions
// ============================================================================
// Mismo criterio que repository.js con Firestore: ningún componente llama a un
// callable directamente, todo pasa por acá. Así los nombres de las funciones y
// la forma de sus argumentos viven en un solo lugar.
//
// Por qué existen estas funciones del lado del servidor: los permisos son
// custom claims del token, y solo el Admin SDK los puede escribir. Si el
// permiso saliera de un documento de Firestore, un dueño podría editarse el
// suyo y escalar. Ver functions/index.js.

import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

/**
 * Las Functions requieren plan Blaze. Mientras no estén desplegadas, llamarlas
 * devuelve `functions/not-found` — un error que no dice nada útil al que lo lee
 * en la consola. Se traduce a algo accionable.
 *
 * `internal` aparece cuando el callable ni siquiera resuelve (proyecto sin
 * Blaze, o emulador apagado con VITE_USE_EMULATORS=true).
 */
const MENSAJES = {
  'functions/not-found': 'La función no está desplegada. Falta activar Blaze y correr firebase deploy --only functions.',
  'functions/internal': 'No se pudo contactar a las Cloud Functions. ¿Están desplegadas, o el emulador está corriendo?',
  'functions/unauthenticated': 'Tenés que iniciar sesión.',
  'functions/permission-denied': 'No tenés permiso para esta operación.',
};

async function llamar(nombre, datos) {
  if (!functions) {
    throw new Error('Firebase no está inicializado: revisá las variables de entorno.');
  }
  try {
    const { data } = await httpsCallable(functions, nombre)(datos);
    return data;
  } catch (err) {
    // Se conserva el código original: quien llama a veces necesita distinguir
    // (por ejemplo, tratar un not-found como "todavía no hay Blaze" y seguir).
    const traducido = new Error(MENSAJES[err.code] || err.message);
    traducido.code = err.code;
    traducido.original = err;
    throw traducido;
  }
}

/** ¿El error viene de que las Functions todavía no están desplegadas? */
export function esFunctionNoDesplegada(err) {
  return err?.code === 'functions/not-found' || err?.code === 'functions/internal';
}

/**
 * Le da a un Gmail acceso al panel de una barbería.
 *
 * Devuelve `{ status: 'applied' }` si la persona ya había entrado alguna vez
 * con Google, o `{ status: 'pending' }` si nunca entró — en ese caso el permiso
 * queda anotado y se aplica solo en su primer login.
 *
 * Quién puede llamarla: la plataforma para cualquier negocio y cualquier rol;
 * el dueño de una barbería solo dentro de la suya y solo con rol 'admin'.
 */
export function setBusinessAdmin({ email, businessId, role, professionalId = null, name = '' }) {
  return llamar('setBusinessAdmin', { email, businessId, role, professionalId, name });
}

/** Le quita todo acceso administrativo a un mail. */
export function revokeBusinessAdmin({ email, businessId }) {
  return llamar('revokeBusinessAdmin', { email, businessId });
}

/**
 * Reserva un turno con validación del lado del servidor.
 *
 * El precio y la hora de fin NO se mandan: los calcula la función a partir del
 * documento del servicio. Tampoco se manda el estado. Todo lo que el cliente
 * podía falsificar escribiendo directo a Firestore se decide del lado del
 * servidor: negocio suspendido, fecha pasada, profesional que no hace ese
 * servicio, horario fuera de agenda y solapamiento con otro turno.
 *
 * Devuelve { status: 'created', id, price, endTime }.
 */
export function createAppointment({ businessId, professionalId, serviceId, appointmentDate, startTime, clientName = '', clientPhone = '', clientEmail = '', notes = '' }) {
  return llamar('createAppointment', {
    businessId, professionalId, serviceId, appointmentDate, startTime,
    clientName, clientPhone, clientEmail, notes,
  });
}

/**
 * Crea la cuenta de un dueño con email y contraseña, y le asigna los permisos.
 * Para el barbero que no usa Gmail o no quiere mezclarlo con lo personal.
 *
 * Si se pasa `password`, se usa esa (mínimo 6 caracteres). Si no, la genera el
 * servidor.
 *
 * Devuelve `{ status: 'created', email, password }`. **La contraseña viene una
 * sola vez**: Firebase guarda solo su hash, así que si se pierde hay que
 * generar otra con `resetOwnerPassword`.
 */
export function createOwnerWithPassword({ email, businessId, name = '', role = 'owner', professionalId = null, password = null }) {
  return llamar('createOwnerWithPassword', { email, businessId, name, role, professionalId, password });
}

/** Genera una contraseña nueva para quien perdió la suya. Corta sus sesiones abiertas. */
export function resetOwnerPassword({ email, password = null }) {
  return llamar('resetOwnerPassword', { email, password });
}

/**
 * Reclama el permiso que quedó pendiente para el mail de la sesión actual.
 * Se llama una vez después del login. Devuelve `{ status: 'none' }` si no había
 * nada pendiente, que es el caso normal y no es un error.
 */
export function applyPendingClaims() {
  return llamar('applyPendingClaims', {});
}
