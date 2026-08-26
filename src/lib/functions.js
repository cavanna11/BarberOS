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
 * Reclama el permiso que quedó pendiente para el mail de la sesión actual.
 * Se llama una vez después del login. Devuelve `{ status: 'none' }` si no había
 * nada pendiente, que es el caso normal y no es un error.
 */
export function applyPendingClaims() {
  return llamar('applyPendingClaims', {});
}
