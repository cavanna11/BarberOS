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
    // Los rechazos de permiso que escribe una function ("Ese turno lo reservó
    // otra persona…") dicen el motivo de verdad: se muestran tal cual. El texto
    // fijo queda para cuando no viene nada útil (las Rules, o un código pelado).
    const fraseDelServidor = ['functions/permission-denied', 'functions/unauthenticated'].includes(err.code)
      && /\s/.test(String(err.message || '').trim()) && String(err.message).length > 20;
    const traducido = new Error(fraseDelServidor ? err.message : (MENSAJES[err.code] || err.message));
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
 * Del cupón se manda SOLO el código. El descuento lo recalcula el servidor
 * sobre el precio del documento del servicio: lo que el browser mostró en el
 * desglose es una vista previa, y si el cupón dejó de servir en el medio, la
 * reserva sigue sin él en vez de romperse.
 *
 * Devuelve { status: 'created', id, price, precioLista, descuento, cuponCodigo, endTime }.
 */
export function createAppointment({ businessId, professionalId, serviceId, appointmentDate, startTime, clientName = '', clientPhone = '', clientEmail = '', notes = '', cuponCodigo = null, usarMembresia = false }) {
  return llamar('createAppointment', {
    businessId, professionalId, serviceId, appointmentDate, startTime,
    clientName, clientPhone, clientEmail, notes, cuponCodigo,
    // "Usar mi membresía": lo marca el cliente. El servidor revalida todo
    // (activa, mes pago, servicio incluido, usos) y descuenta el uso.
    usarMembresia: usarMembresia === true,
  });
}

/**
 * Horarios tomados de un profesional en un día, para pintar la grilla.
 * Devuelve solo { startTime, endTime } de cada turno activo: el cliente no
 * puede leer la agenda del negocio (tiene datos de otros clientes), pero sí
 * necesita saber qué está ocupado. Respuesta: { ocupados: [...] }.
 * No pide sesión: la grilla se mira antes de entrar.
 */
export function getBusySlots({ businessId, professionalId, appointmentDate }) {
  return llamar('getBusySlots', { businessId, professionalId, appointmentDate });
}

/**
 * Crea la cuenta de un dueño con email y contraseña, y le asigna los permisos.
 * Para el barbero que no usa Gmail o no quiere mezclarlo con lo personal.
 *
 * Si se pasa `password`, se usa esa (mínimo 8 caracteres). Si no, la genera el
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
 * Nombra a alguien moderador de la plataforma (o le saca el rol con
 * `enabled: false`). Solo el dueño de la plataforma puede llamarla.
 *
 * Devuelve 'applied' si la cuenta ya existía, 'pending' si nunca entró (se
 * aplica en su primer login), 'revoked' o 'not-found' al quitar.
 */
// ── Mercado Pago ────────────────────────────────────────────────────────────
// El dueño conecta SU cuenta: la seña va derecho a él, la plataforma no toca
// la plata. Ver functions/mercadopago.js.

/** Devuelve la URL de Mercado Pago a la que hay que mandar al dueño. */
export function urlConectarMercadoPago(businessId) {
  return llamar('urlConectarMercadoPago', { businessId });
}

/** Devuelve la seña de un turno. La plata sale de la cuenta del barbero. */
export function devolverSena(appointmentId, businessId) {
  return llamar('devolverSena', { appointmentId, businessId });
}

export function desconectarMercadoPago(businessId) {
  return llamar('desconectarMercadoPago', { businessId });
}

/** Alta sola: crea la barbería con días de prueba y deja al que llama de dueño. */
export function crearBarberiaDePrueba(datos) {
  return llamar('crearBarberiaDePrueba', datos);
}

/**
 * Abre una sucursal nueva dentro de la misma cuenta (Plan Empresarial).
 *
 * Del lado del servidor y no con una escritura del browser porque el tope de
 * sucursales es plata: en la interfaz se saltea con la consola abierta. Además
 * crea el negocio, el slug y la facturación en una sola operación, y le escribe
 * al dueño los claims con la sucursal nueva adentro — sin eso entra y no la ve.
 *
 * `copiarServiciosDe` es opcional: copia el catálogo de otra sucursal de la
 * misma cuenta como punto de partida, en documentos nuevos e independientes.
 *
 * Devuelve { businessId, slug, grupoId, serviciosCopiados }. Después hay que
 * llamar a `refreshClaims()` para que el token traiga la sucursal.
 */
export function crearSucursal({ nombre, slug, telefono = '', whatsapp = '', instagram = '', direccion = '', ciudad = '', businessId = null, copiarServiciosDe = null }) {
  return llamar('crearSucursal', { nombre, slug, telefono, whatsapp, instagram, direccion, ciudad, businessId, copiarServiciosDe });
}

/**
 * Crea un barbero respetando el tope del plan.
 *
 * Del lado del servidor porque las Rules no pueden CONTAR documentos: el tope
 * no se puede expresar ahí, y en la interfaz se saltea con la consola abierta.
 * La cantidad de barberos es justamente lo que separa un plan de otro.
 *
 * Devuelve { id } del profesional nuevo.
 */
export function crearProfesional({ businessId, datos }) {
  return llamar('crearProfesional', { businessId, datos });
}

/** Manda un push de prueba a los teléfonos de esta misma cuenta. */
export function probarPush() {
  return llamar('probarPush', {});
}

/** Para el dueño: quién del equipo tiene los avisos activados. */
export function estadoPushDelEquipo(businessId) {
  return llamar('estadoPushDelEquipo', { businessId });
}

export function setPlatformModerator({ email, enabled = true, name = '', rol = 'moderator' }) {
  return llamar('setPlatformModerator', { email, enabled, name, rol });
}

/**
 * Reclama el permiso que quedó pendiente para el mail de la sesión actual.
 * Se llama una vez después del login. Devuelve `{ status: 'none' }` si no había
 * nada pendiente, que es el caso normal y no es un error.
 */
export function applyPendingClaims() {
  return llamar('applyPendingClaims', {});
}

/**
 * Borra una barbería entera: negocio, subcolecciones, slug, tickets,
 * pendientes, y les saca el acceso a sus usuarios. Solo el dueño de la
 * plataforma. `confirmName` tiene que ser el nombre exacto del negocio.
 * Devuelve { status: 'deleted', usuarios, tickets, pendientes }.
 */
export function deleteBusiness({ businessId, confirmName }) {
  return llamar('deleteBusiness', { businessId, confirmName });
}

/**
 * "¿Sirve este código?" — antes de confirmar la reserva.
 *
 * Devuelve `{ valido: true, codigo, descuento, precioLista, precioFinal }`, o
 * `{ valido: false, mensaje }` con un texto genérico. El motivo exacto no viaja
 * a propósito: decirle "ese cupón venció" le confirma que el código existe, y
 * con eso se arma la lista de los que andan probando diccionarios.
 *
 * Es una VISTA PREVIA. El descuento que se cobra lo recalcula
 * `createAppointment` sobre el precio del documento del servicio.
 */
export function validarCupon({ businessId, codigo, serviceId, professionalId }) {
  return llamar('validarCupon', { businessId, codigo, serviceId, professionalId });
}

/**
 * Completa en cada barbería los topes y las capacidades de su plan, y
 * reconstruye el mapa público de las cuentas con sucursales.
 *
 * Con `aplicar: false` (el default) no escribe nada: devuelve qué haría. Hay
 * que correrla después de agregar una capacidad nueva, porque en las Rules una
 * capacidad que no está escrita vale TRUE y queda habilitada para todos.
 *
 * Devuelve { aplicado, total, cambios[], grupos[], sinPlan[] }.
 */
export function migrarPlanes({ aplicar = false } = {}) {
  return llamar('migrarPlanes', { aplicar });
}

// ============================================================================
// Membresías (functions/membresias.js)
// ============================================================================
// Todo lo que cambia una membresía pasa por acá: las Rules no dejan escribir
// nada de eso desde el browser, ni al dueño. Los mensajes de error ya vienen
// escritos para mostrarse.

/** Crea o edita un plan. `beneficios`: [{ id?, nombre, usos|null, servicios: [{ businessId, serviceId }] }]. */
export function guardarPlanMembresia(datos) {
  return llamar('guardarPlanMembresia', datos);
}

/** Suscripciones de la cuenta de Mercado Pago de la barbería, para vincular. */
export function buscarSuscripcionesMP({ businessId, payerEmail = '' }) {
  return llamar('buscarSuscripcionesMP', { businessId, payerEmail });
}

/**
 * Carga la membresía de un cliente (la que ya existe, anotada a mano).
 * `preapprovalId` opcional: si viene, el estado lo manda Mercado Pago.
 * `reemplazaA`: cambio de plan.
 */
export function cargarMembresia(datos) {
  return llamar('cargarMembresia', datos);
}

/** Abre el mes siguiente de una membresía SIN Mercado Pago y registra el cobro. */
export function renovarMembresia({ businessId, membresiaId, monto = null }) {
  return llamar('renovarMembresia', { businessId, membresiaId, monto });
}

/** Baja: respeta el mes pago; si es de MP, la cancela también allá. */
export function cancelarMembresia({ businessId, membresiaId, motivo = '' }) {
  return llamar('cancelarMembresia', { businessId, membresiaId, motivo });
}

/** El dueño aplica la membresía a un turno que ya existe (con motivo). */
export function aplicarMembresia({ businessId, appointmentId, membresiaId, motivo }) {
  return llamar('aplicarMembresia', { businessId, appointmentId, membresiaId, motivo });
}

/** El dueño revierte un uso: el turno vuelve a cobrarse. */
export function revertirUsoMembresia({ businessId, appointmentId, motivo }) {
  return llamar('revertirUsoMembresia', { businessId, appointmentId, motivo });
}

/** La membresía del cliente que mira, en esta cuenta, o `{ membresia: null }`. */
export function miMembresia(businessId) {
  return llamar('miMembresia', { businessId });
}
