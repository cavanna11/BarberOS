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
  return onSnapshot(
    businessDoc(businessId),
    (snap) => cb(snap.exists() ? { id: snap.id, ...snap.data() } : null),
    onError
  );
}

/** Escucha TODOS los negocios. Solo el dueño de plataforma puede listar. */
export function subscribeAllBusinesses(cb, onError) {
  return onSnapshot(businessesCol(), (snap) => cb(rows(snap)), onError);
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

export async function deleteBusinessRecord(businessId, slug) {
  // Nota: esto borra el documento y su slug, no las subcolecciones. Firestore
  // no borra en cascada; para limpiar todo hace falta una Cloud Function.
  const batch = writeBatch(db);
  batch.delete(businessDoc(businessId));
  if (slug) batch.delete(slugDoc(slug));
  await batch.commit();
}

// ============================================================================
// FACTURACIÓN (privada — solo dueño de plataforma)
// ============================================================================

export function subscribeBilling(businessId, cb, onError) {
  return onSnapshot(
    billingDoc(businessId),
    (snap) => cb(snap.exists() ? snap.data() : null),
    onError
  );
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
  return onSnapshot(subCol(businessId, name), (snap) => cb(rows(snap)), onError);
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
  return onSnapshot(subCol(businessId, 'appointments'), (snap) => cb(rows(snap)), onError);
}

/**
 * Turnos de un cliente puntual. La query DEBE filtrar por userId: las Rules
 * rechazan el listado completo si no sos staff.
 */
export function subscribeMyAppointments(businessId, userId, cb, onError) {
  return onSnapshot(
    query(subCol(businessId, 'appointments'), where('userId', '==', userId)),
    (snap) => cb(rows(snap)),
    onError
  );
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
export async function cancelAppointment(businessId, id, motivo = '') {
  await updateDoc(doc(db, 'businesses', businessId, 'appointments', id), {
    status: 'cancelada',
    cancelledAt: new Date().toISOString(),
    cancellationReason: motivo,
  });
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
  return onSnapshot(subCol(businessId, 'admins'), (snap) => cb(rows(snap)), onError);
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
  return onSnapshot(
    query(ticketsCol(), orderBy('lastMessageAt', 'desc')),
    (snap) => cb(rows(snap)),
    onError
  );
}

/**
 * Tickets de una barbería.
 * El where es obligatorio: la regla de `list` lo exige, sin él Firestore
 * rechaza la consulta entera.
 */
export function subscribeBusinessTickets(businessId, cb, onError) {
  return onSnapshot(
    query(ticketsCol(), where('businessId', '==', businessId), orderBy('lastMessageAt', 'desc')),
    (snap) => cb(rows(snap)),
    onError
  );
}

export function subscribeTicketMessages(ticketId, cb, onError) {
  return onSnapshot(
    query(collection(db, 'tickets', ticketId, 'messages'), orderBy('createdAt', 'asc')),
    (snap) => cb(rows(snap)),
    onError
  );
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
  return onSnapshot(platformDoc(name), (snap) => cb(snap.exists() ? snap.data() : null), onError);
}

export async function savePlatformConfig(name, data) {
  await setDoc(platformDoc(name), data, { merge: true });
}
