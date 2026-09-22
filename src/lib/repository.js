// ============================================================================
// Capa de acceso a Firestore
// ============================================================================
// Ningún componente habla con Firestore directamente: todo pasa por acá.
// Eso mantiene en un solo lugar la forma de los documentos, los nombres de las
// colecciones y las reglas de escritura.
//
// Estructura (tiene que coincidir con firestore.rules):
//
//   /slugs/{slug}                        → { businessId }   público
//   /businesses/{id}                     → marca, horarios, isFrozen  público
//     /private/billing                   → deuda, abono, vencimientos  solo plataforma
//     /professionals/{id}
//     /services/{id}
//     /schedules/{id}
//     /professionalServices/{id}
//     /appointments/{id}
//     /admins/{email}
//   /platform/{doc}
//
// Por qué la facturación va aparte: el documento del negocio es de lectura
// pública (la página de reservas necesita nombre, colores y horarios antes del
// login). Si la deuda viviera ahí, cualquier cliente podría leerla.

import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';

// ── Helpers de rutas ───────────────────────────────────────────────────────
const businessesCol = () => collection(db, 'businesses');
const businessDoc = (id) => doc(db, 'businesses', id);
const billingDoc = (id) => doc(db, 'businesses', id, 'private', 'billing');
const slugDoc = (slug) => doc(db, 'slugs', slug);
export const subCol = (businessId, name) => collection(db, 'businesses', businessId, name);

/** Convierte un snapshot de colección en un array con `id`. */
const rows = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

// ============================================================================
// ESCUCHAR CON RED DE SEGURIDAD
// ============================================================================
// Todas las suscripciones pasan por acá en vez de llamar a onSnapshot a pelo,
// por dos cosas que se vieron en producción como "de la nada el panel muestra
// cero barberías, cero turnos, y no vuelve hasta un F5":
//
//   1. Con la conexión caída un instante (la notebook vuelve del sueño, cambia
//      la red), Firestore puede emitir un snapshot VACÍO desde el caché
//      (`metadata.fromCache`) — y el panel pisaba los datos buenos con nada.
//      Un vacío que viene del caché no se cree: se espera al servidor.
//   2. Si el listener falla con un error terminal, onSnapshot lo cierra y no
//      vuelve a intentar nunca. Acá se reintenta con espera creciente, y
//      además al volver la conexión o la pestaña al frente.
//
// Devuelve una función para desuscribirse, igual que onSnapshot.
function escuchar(ref, mapear, cb, onError) {
  let off = null;
  let cancelado = false;
  let intentos = 0;
  let timer = null;

  const conectar = () => {
    if (cancelado) return;
    if (off) { off(); off = null; }
    off = onSnapshot(
      ref,
      (snap) => {
        intentos = 0;
        const vacio = 'docs' in snap ? snap.empty : !snap.exists();
        if (vacio && snap.metadata.fromCache) return; // ver (1)
        cb(mapear(snap));
      },
      (err) => {
        if (cancelado) return;
        onError?.(err);
        // permission-denied no se arregla reintentando: es una regla.
        if (err?.code === 'permission-denied') return;
        intentos++;
        const espera = Math.min(3000 * 2 ** (intentos - 1), 60000);
        console.warn(`[repository] Listener caído (${err?.code}); reintento en ${espera / 1000}s.`);
        timer = setTimeout(conectar, espera);
      }
    );
  };

  const despertar = () => {
    if (cancelado || intentos === 0) return;
    clearTimeout(timer);
    conectar();
  };
  window.addEventListener('online', despertar);
  document.addEventListener('visibilitychange', despertar);

  conectar();

  return () => {
    cancelado = true;
    clearTimeout(timer);
    window.removeEventListener('online', despertar);
    document.removeEventListener('visibilitychange', despertar);
    if (off) off();
  };
}

const unDoc = (snap) => (snap.exists() ? { id: snap.id, ...snap.data() } : null);
const datosDoc = (snap) => (snap.exists() ? snap.data() : null);

// ============================================================================
// NEGOCIOS
// ============================================================================

/**
 * Alta de un negocio. Escribe tres cosas en un solo batch, porque un negocio a
 * medias (sin slug, o sin facturación) deja la cuenta inutilizable:
 *   1. el documento público
 *   2. el mapa slug → businessId
 *   3. la facturación privada
 *   4. el dueño en la subcolección de admins
 *
 * El permiso REAL del dueño son los custom claims, que asigna una Cloud
 * Function. Este documento es solo el registro que muestra la UI.
 */
export async function createBusiness({ business, billing, ownerAdmin }) {
  const ref = business.id ? businessDoc(business.id) : doc(businessesCol());
  const businessId = ref.id;

  const batch = writeBatch(db);

  batch.set(ref, {
    ...business,
    id: businessId,
    createdAt: serverTimestamp(),
  });

  batch.set(slugDoc(business.slug), { businessId });

  batch.set(billingDoc(businessId), {
    ...billing,
    debt: billing?.debt ?? 0,
  });

  if (ownerAdmin?.email) {
    const email = ownerAdmin.email.toLowerCase();
    batch.set(doc(db, 'businesses', businessId, 'admins', email), {
      ...ownerAdmin,
      email,
      businessId,
      addedAt: serverTimestamp(),
    });
  }

  await batch.commit();
  return businessId;
}

/** ¿Está libre este slug? Lee un solo documento, no lista la colección. */
export async function isSlugAvailable(slug) {
  const snap = await getDoc(slugDoc(slug));
  return !snap.exists();
}

/** Resuelve el slug público a un businessId. Funciona sin estar logueado. */
export async function getBusinessIdBySlug(slug) {
  const snap = await getDoc(slugDoc(slug));
  return snap.exists() ? snap.data().businessId : null;
}

/** Escucha un negocio puntual. Devuelve la función para desuscribirse. */
export function subscribeBusiness(businessId, cb, onError) {
  return escuchar(businessDoc(businessId), unDoc, cb, onError);
}

/** Escucha TODOS los negocios. Solo el dueño de plataforma puede listar. */
export function subscribeAllBusinesses(cb, onError) {
  return escuchar(businessesCol(), rows, cb, onError);
}

/**
 * Campos que el dueño de una barbería NO puede tocar: las Rules rechazan la
 * escritura completa si vienen incluidos, así que se filtran antes de mandar.
 */
const CAMPOS_SOLO_PLATAFORMA = ['isFrozen', 'planId', 'monthlyFee', 'whatsappQuota', 'slug', 'id'];

export async function updateBusiness(businessId, cambios, { esPlataforma = false } = {}) {
  const payload = { ...cambios };
  if (!esPlataforma) {
    for (const campo of CAMPOS_SOLO_PLATAFORMA) delete payload[campo];
  }
  delete payload.createdAt;
  await updateDoc(businessDoc(businessId), payload);
}

export async function setBusinessFrozen(businessId, isFrozen) {
  await updateDoc(businessDoc(businessId), { isFrozen });
}

// Borrar un negocio es `deleteBusiness` en lib/functions.js: en cascada, con
// el Admin SDK. Desde el browser no se puede hacer entero.

// ============================================================================
// FACTURACIÓN (privada — solo dueño de plataforma)
// ============================================================================

export function subscribeBilling(businessId, cb, onError) {
  return escuchar(billingDoc(businessId), datosDoc, cb, onError);
}

export async function getBilling(businessId) {
  const snap = await getDoc(billingDoc(businessId));
  return snap.exists() ? snap.data() : null;
}

export async function updateBilling(businessId, cambios) {
  await setDoc(billingDoc(businessId), cambios, { merge: true });
}

/** Registra un cobro y descuenta de la deuda. Descongela si queda en cero. */
export async function recordPayment(businessId, monto, fecha) {
  const actual = (await getBilling(businessId)) || {};
  const nuevaDeuda = Math.max(0, (actual.debt || 0) - monto);

  await updateBilling(businessId, {
    debt: nuevaDeuda,
    lastPaymentDate: fecha,
  });

  if (nuevaDeuda === 0) await setBusinessFrozen(businessId, false);
  return nuevaDeuda;
}

export async function upgradePlan(businessId, { planId, whatsappQuota, monthlyFee }) {
  const batch = writeBatch(db);
  // La cuota vive en el documento público porque la UI del negocio la muestra;
  // el abono en el privado porque es plata.
  batch.update(businessDoc(businessId), { planId, whatsappQuota });
  batch.set(billingDoc(businessId), { monthlyFee, planId }, { merge: true });
  await batch.commit();
}

// ============================================================================
// SUBCOLECCIONES DEL NEGOCIO
// ============================================================================

/** Escucha una subcolección del negocio (professionals, services, etc.). */
export function subscribeSubcollection(businessId, name, cb, onError) {
  return escuchar(subCol(businessId, name), rows, cb, onError);
}

export async function addToSubcollection(businessId, name, data) {
  const ref = data.id
    ? doc(db, 'businesses', businessId, name, data.id)
    : doc(subCol(businessId, name));
  await setDoc(ref, { ...data, id: ref.id });
  return ref.id;
}

export async function updateInSubcollection(businessId, name, id, cambios) {
  await updateDoc(doc(db, 'businesses', businessId, name, id), cambios);
}

export async function removeFromSubcollection(businessId, name, id) {
  await deleteDoc(doc(db, 'businesses', businessId, name, id));
}

/**
 * Reemplaza en bloque los documentos de una subcolección que cumplen un
 * filtro. Se usa para reasignar horarios de un profesional o los servicios que
 * presta, donde lo natural es "estos son los que quedan".
 */
export async function replaceMatching(businessId, name, campo, valor, nuevos) {
  const actuales = await getDocs(query(subCol(businessId, name), where(campo, '==', valor)));
  const batch = writeBatch(db);
  actuales.docs.forEach((d) => batch.delete(d.ref));
  nuevos.forEach((item) => {
    const ref = item.id
      ? doc(db, 'businesses', businessId, name, item.id)
      : doc(subCol(businessId, name));
    batch.set(ref, { ...item, id: ref.id });
  });
  await batch.commit();
}

// ============================================================================
// TURNOS
// ============================================================================

/** Turnos del negocio. El staff los ve todos. */
export function subscribeAppointments(businessId, cb, onError) {
  return escuchar(subCol(businessId, 'appointments'), rows, cb, onError);
}

/**
 * Turnos de UN profesional. Es lo que ve un barbero: las Rules le permiten
 * listar solo los suyos, así que la query tiene que traer el filtro o Firestore
 * rechaza la consulta entera.
 */
export function subscribeAppointmentsDeProfesional(businessId, professionalId, cb, onError) {
  return escuchar(query(subCol(businessId, 'appointments'), where('professionalId', '==', professionalId)), rows, cb, onError);
}

/**
 * Turnos de un cliente puntual. La query DEBE filtrar por userId: las Rules
 * rechazan el listado completo si no sos staff.
 */
export function subscribeMyAppointments(businessId, userId, cb, onError) {
  return escuchar(query(subCol(businessId, 'appointments'), where('userId', '==', userId)), rows, cb, onError);
}

export async function createAppointment(businessId, data) {
  const ref = doc(subCol(businessId, 'appointments'));
  await setDoc(ref, {
    ...data,
    id: ref.id,
    businessId,
    // Las Rules exigen que nazca en 'pendiente'.
    status: 'pendiente',
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateAppointment(businessId, id, cambios) {
  await updateDoc(doc(db, 'businesses', businessId, 'appointments', id), cambios);
}

/** Cancelar. Los turnos no se borran nunca: así queda historial. */
export async function cancelAppointment(businessId, id, motivo = '', quien = 'staff') {
  await updateDoc(doc(db, 'businesses', businessId, 'appointments', id), {
    status: 'cancelada',
    cancelledAt: new Date().toISOString(),
    cancellationReason: motivo,
    // 'client' o 'staff'. El trigger onTurnoCancelado avisa a la barbería solo
    // cuando canceló el cliente.
    cancelledBy: quien,
  });
}

// ============================================================================
// NOTIFICACIONES AL STAFF
// ============================================================================
// Las crea un trigger de Functions cuando entra o se cancela un turno. Desde
// acá solo se leen y se marcan leídas.

/** Todas las del negocio (dueño), o solo las del profesional (barbero). */
export function subscribeNotifications(businessId, { professionalId = null } = {}, cb, onError) {
  const base = subCol(businessId, 'notifications');
  // Sin orderBy cuando hay where: la combinación pediría un índice compuesto.
  // Se ordena en memoria, son pocas.
  const q = professionalId
    ? query(base, where('professionalId', '==', professionalId))
    : query(base, orderBy('createdAt', 'desc'), limit(60));
  return escuchar(q, (snap) => rows(snap).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).slice(0, 60), cb, onError);
}

export async function markNotificationRead(businessId, id, uid) {
  await updateDoc(doc(db, 'businesses', businessId, 'notifications', id), {
    [`leidaPor.${uid}`]: true,
  });
}

// Las de la plataforma (panel global): tickets y suspensiones.
export function subscribePlatformNotifications(cb, onError) {
  const q = query(collection(db, 'platform', 'notifications', 'items'), orderBy('createdAt', 'desc'), limit(60));
  return escuchar(q, rows, cb, onError);
}

export async function markPlatformNotificationRead(id, uid) {
  await updateDoc(doc(db, 'platform', 'notifications', 'items', id), { [`leidaPor.${uid}`]: true });
}

/**
 * Marca varias como leídas en UN solo commit.
 *
 * Antes eran N updates sueltos en paralelo, cada uno con su `catch` vacío: si
 * alguno fallaba, esa notificación volvía a aparecer sin leer y sin decir por
 * qué. En batch o entran todas o no entra ninguna, y el error se propaga.
 */
export async function markNotificationsRead(ids, uid, { businessId = null } = {}) {
  if (!ids.length || !uid) return;
  // El límite de un batch de Firestore es 500 escrituras; la campana trae 60.
  const batch = writeBatch(db);
  for (const id of ids) {
    const ref = businessId
      ? doc(db, 'businesses', businessId, 'notifications', id)
      : doc(db, 'platform', 'notifications', 'items', id);
    batch.update(ref, { [`leidaPor.${uid}`]: true });
  }
  await batch.commit();
}

// ── Dispositivos con push ───────────────────────────────────────────────────
// Un documento por token de FCM: /businesses/{id}/devices/{token}. El trigger
// de Functions les manda el push (al dueño todo; al barbero, lo suyo).

export async function saveDevice(businessId, token, datos) {
  await setDoc(doc(db, 'businesses', businessId, 'devices', token), {
    ...datos,
    token,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function removeDevice(businessId, token) {
  await deleteDoc(doc(db, 'businesses', businessId, 'devices', token));
}

// Los del equipo de la plataforma van en una colección propia.
export async function savePlatformDevice(token, datos) {
  await setDoc(doc(db, 'platformDevices', token), { ...datos, token, updatedAt: serverTimestamp() }, { merge: true });
}

export async function removePlatformDevice(token) {
  await deleteDoc(doc(db, 'platformDevices', token));
}

// ============================================================================
// CONTACTO DEL STAFF
// ============================================================================
// El documento de un profesional es de LECTURA PÚBLICA: la página de reservas
// necesita nombre, especialidad y foto antes del login. Por eso el teléfono y
// el mail personales no van ahí — irían de regalo a cualquiera con el link.
//
// Van en un único documento privado del negocio, indexado por professionalId.
// Se lee bajo demanda desde el panel y no por suscripción: lo consultan dos
// pantallas y casi nunca cambia, así que un listener permanente sería pagar de
// más por dato que casi nadie mira.

/** { [professionalId]: { phone, email } }. Vacío si nunca se cargó nada. */
export async function getStaffContacts(businessId) {
  const snap = await getDocs(subCol(businessId, 'staffContacts'));
  return Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]));
}

export async function saveStaffContact(businessId, professionalId, { phone = '', email = '' }) {
  await setDoc(doc(db, 'businesses', businessId, 'staffContacts', professionalId), { phone, email });
}

/** Firestore no borra en cascada: al eliminar un profesional hay que sacarlo. */
export async function removeStaffContact(businessId, professionalId) {
  await deleteDoc(doc(db, 'businesses', businessId, 'staffContacts', professionalId));
}

// ============================================================================
// ADMINS DEL NEGOCIO
// ============================================================================

export function subscribeAdmins(businessId, cb, onError) {
  return escuchar(subCol(businessId, 'admins'), rows, cb, onError);
}

/**
 * Registra un admin para la UI. NO otorga acceso por sí solo: el permiso real
 * son los custom claims, que asigna la Cloud Function `setBusinessAdmin`.
 */
export async function saveAdminRecord(businessId, admin) {
  const email = admin.email.toLowerCase();
  await setDoc(doc(db, 'businesses', businessId, 'admins', email), {
    ...admin,
    email,
    businessId,
    addedAt: admin.addedAt || new Date().toISOString(),
  });
}

export async function removeAdminRecord(businessId, email) {
  await deleteDoc(doc(db, 'businesses', businessId, 'admins', email.toLowerCase()));
}

// ============================================================================
// EQUIPO DE LA PLATAFORMA
// ============================================================================
// Moderadores: gente de soporte con acceso al panel global. Lo escribe solo la
// Cloud Function setPlatformModerator; acá solo se lee.

export function subscribePlatformTeam(cb, onError) {
  return escuchar(collection(db, 'platform', 'team', 'members'), rows, cb, onError);
}

// ============================================================================
// TICKETS DE SOPORTE
// ============================================================================
// Colección de primer nivel para que el panel global los liste todos sin
// necesitar collectionGroup. Cada ticket lleva businessId y las Rules se
// encargan de que una barbería solo vea los suyos.

const ticketsCol = () => collection(db, 'tickets');

export const TICKET_ESTADOS = {
  abierto: 'Abierto',
  respondido: 'Respondido',
  cerrado: 'Cerrado',
};

/** Todos los tickets de la plataforma, del más movido al más viejo. */
export function subscribeAllTickets(cb, onError) {
  return escuchar(query(ticketsCol(), orderBy('lastMessageAt', 'desc')), rows, cb, onError);
}

/**
 * Tickets de una barbería.
 * El where es obligatorio: la regla de `list` lo exige, sin él Firestore
 * rechaza la consulta entera.
 */
export function subscribeBusinessTickets(businessId, cb, onError) {
  return escuchar(query(ticketsCol(), where('businessId', '==', businessId), orderBy('lastMessageAt', 'desc')), rows, cb, onError);
}

export function subscribeTicketMessages(ticketId, cb, onError) {
  return escuchar(query(collection(db, 'tickets', ticketId, 'messages'), orderBy('createdAt', 'asc')), rows, cb, onError);
}

/** Abre un ticket con su primer mensaje, en un solo batch. */
export async function createTicket({ businessId, businessName, subject, category, message, author }) {
  const ref = doc(ticketsCol());
  const ahora = serverTimestamp();

  const batch = writeBatch(db);
  batch.set(ref, {
    id: ref.id,
    businessId,
    businessName,
    subject,
    category,
    status: 'abierto',
    createdAt: ahora,
    lastMessageAt: ahora,
    // Para que el panel global sepa de un vistazo dónde hace falta responder.
    lastMessageBy: 'business',
    unreadForPlatform: true,
    unreadForBusiness: false,
  });
  batch.set(doc(collection(db, 'tickets', ref.id, 'messages')), {
    text: message,
    authorId: author.id,
    authorName: author.name,
    authorRole: 'business',
    createdAt: ahora,
  });

  await batch.commit();
  return ref.id;
}

/** Responde un ticket. `role` es 'platform' o 'business'. */
export async function addTicketMessage(ticketId, { text, author, role }) {
  const ahora = serverTimestamp();

  const batch = writeBatch(db);
  batch.set(doc(collection(db, 'tickets', ticketId, 'messages')), {
    text,
    authorId: author.id,
    authorName: author.name,
    authorRole: role,
    createdAt: ahora,
  });
  batch.update(doc(db, 'tickets', ticketId), {
    lastMessageAt: ahora,
    lastMessageBy: role,
    status: role === 'platform' ? 'respondido' : 'abierto',
    unreadForPlatform: role === 'business',
    unreadForBusiness: role === 'platform',
  });

  await batch.commit();
}

export async function setTicketStatus(ticketId, status) {
  await updateDoc(doc(db, 'tickets', ticketId), { status });
}

/** Marca como leído para quien lo está mirando. */
export async function markTicketRead(ticketId, role) {
  await updateDoc(doc(db, 'tickets', ticketId), {
    [role === 'platform' ? 'unreadForPlatform' : 'unreadForBusiness']: false,
  });
}

// ============================================================================
// CONFIGURACIÓN GLOBAL DE PLATAFORMA
// ============================================================================

const platformDoc = (name) => doc(db, 'platform', name);

export function subscribePlatformConfig(name, cb, onError) {
  return escuchar(platformDoc(name), datosDoc, cb, onError);
}

export async function savePlatformConfig(name, data) {
  await setDoc(platformDoc(name), data, { merge: true });
}
