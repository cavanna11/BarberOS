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

/**
 * Las sucursales de una cuenta, para la página pública.
 *
 * Dos pasos y los dos son lecturas públicas:
 *   1. /grupos/{grupoId} dice QUÉ barberías componen la cuenta (solo ids).
 *   2. el documento de cada una da el nombre, la dirección y si está abierta.
 *
 * Por qué no una consulta por `grupoId` sobre `businesses`: listar esa colección
 * solo se le permite al panel global, y con razón — ahí está la cartera entera
 * de clientes. El mapa del grupo es el mismo truco que /slugs: un documento
 * chiquito y público que evita abrir la colección.
 *
 * Por qué el grupo guarda solo ids: así el nombre y la dirección nunca quedan
 * viejos. Si estuvieran copiados en el grupo, cambiar la dirección en
 * Configuración dejaría al selector mostrando la de antes.
 */
export async function obtenerSucursalesDelGrupo(grupoId) {
  if (!grupoId) return [];
  const grupo = await getDoc(doc(db, 'grupos', grupoId));
  if (!grupo.exists()) return [];

  const ids = grupo.data().businessIds || [];
  const docs = await Promise.all(ids.map((id) => getDoc(businessDoc(id))));

  return docs
    .filter((d) => d.exists())
    .map((d) => ({ id: d.id, ...d.data() }))
    // La principal primero, el resto por nombre: el orden no puede depender de
    // en qué orden volvieron las lecturas.
    .sort((a, b) => {
      if (a.id === grupoId) return -1;
      if (b.id === grupoId) return 1;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
}

/** Escucha un negocio puntual. Devuelve la función para desuscribirse. */
export function subscribeBusiness(businessId, cb, onError) {
  return escuchar(businessDoc(businessId), unDoc, cb, onError);
}

/**
 * Escucha VARIOS negocios puntuales, por id.
 *
 * Para las cuentas con sucursales: el dueño tiene hasta cuatro barberías y el
 * panel necesita las cuatro para el selector y para la pantalla que las muestra
 * juntas. No se puede resolver con una sola consulta a la colección: listar
 * `businesses` solo se le permite al panel global (si no, cualquiera se baja la
 * cartera de clientes). Son N lecturas de un documento cada una, que es
 * exactamente lo que se necesita y nada más.
 *
 * Emite en el orden de `ids` para que la lista no cambie de orden entre
 * renders según cuál llegó primero.
 */
export function subscribeBusinesses(ids, cb, onError) {
  const datos = new Map();
  const offs = ids.map((id) =>
    subscribeBusiness(
      id,
      (negocio) => {
        if (negocio) datos.set(id, negocio);
        else datos.delete(id);
        cb(ids.map((i) => datos.get(i)).filter(Boolean));
      },
      onError
    )
  );
  return () => offs.forEach((off) => off());
}

/** Escucha TODOS los negocios. Solo el dueño de plataforma puede listar. */
export function subscribeAllBusinesses(cb, onError) {
  return escuchar(businessesCol(), rows, cb, onError);
}

/**
 * Campos que el dueño de una barbería NO puede tocar: las Rules rechazan la
 * escritura completa si vienen incluidos, así que se filtran antes de mandar.
 */
// Los mismos campos que las Rules no dejan tocar al dueño. Se filtran también
// acá porque el formulario de Configuración manda el negocio entero: si uno de
// estos viajara con un valor distinto, las Rules rechazan la escritura ENTERA y
// el dueño no puede guardar ni el nombre. Si agregás uno en firestore.rules,
// agregalo acá.
const CAMPOS_SOLO_PLATAFORMA = [
  'isFrozen', 'planId', 'monthlyFee', 'whatsappQuota', 'slug', 'id',
  'trialEndsAt', 'maxBarbers', 'maxSucursales', 'origen', 'mpConectado', 'mpUserId',
  // Qué funciones tiene habilitadas el plan. Es lo que miran las Rules para
  // dejar o no subir una foto, poner colores propios o un logo.
  'capacidades',
  // `grupoId` ata la barbería a una cuenta con sucursales y de ahí salen los
  // claims del dueño. Lo escribe solo la function `crearSucursal`.
  'grupoId',
];

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

  // El cobro queda anotado aparte, como un asiento más del libro. Antes lo
  // único que sobrevivía era `lastPaymentDate`, que se pisa en cada cobro: la
  // plata cobrada el mes pasado no quedaba en ningún lado y no había forma de
  // decir cuánto facturó la plataforma en septiembre. El historial arranca el
  // día que esto se puso: los cobros anteriores no se pueden reconstruir.
  await registrarCobro({ businessId, monto, fecha });

  if (nuevaDeuda === 0) await setBusinessFrozen(businessId, false);
  return nuevaDeuda;
}

// ============================================================================
// COBROS DE LA PLATAFORMA (lo que BarberOS le factura a las barberías)
// ============================================================================
// Un documento por cobro en /platform/cobros/items. No se mezcla con lo que
// factura la barbería cortando pelo: son dos cajas distintas.

const cobrosCol = () => collection(db, 'platform', 'cobros', 'items');

export async function registrarCobro({ businessId, monto, fecha, nota = '' }) {
  const ref = doc(cobrosCol());
  await setDoc(ref, {
    businessId,
    monto: Number(monto) || 0,
    // 'YYYY-MM-DD' (la fecha del cobro, que puede no ser hoy) y además el
    // instante real, para ordenar sin ambigüedad cuando hay varios el mismo día.
    fecha,
    nota,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

/**
 * Los cobros registrados, del más nuevo al más viejo.
 *
 * Ojo con el `orderBy('fecha')`: Firestore EXCLUYE los documentos que no tienen
 * ese campo. Todos los que escribe `registrarCobro` lo llevan; uno sembrado a
 * mano sin `fecha` no aparecería nunca y parecería que el historial está roto.
 */
export function subscribeCobros(cb, onError) {
  const q = query(cobrosCol(), orderBy('fecha', 'desc'), limit(500));
  return escuchar(q, rows, cb, onError);
}

export async function borrarCobro(id) {
  await deleteDoc(doc(db, 'platform', 'cobros', 'items', id));
}

export async function upgradePlan(businessId, { planId, whatsappQuota, monthlyFee, maxBarbers = null, maxSucursales = 1, capacidades = null, sucursales = [] }) {
  const batch = writeBatch(db);
  // La cuota y los TOPES viven en el documento público porque el panel del
  // negocio los muestra y los hace cumplir; el abono en el privado porque es
  // plata.
  //
  // Los topes se escriben acá y no se dejan implícitos en el plan: si el día que
  // se cambia la escalera comercial una cuenta tiene que conservar lo que
  // compró, tiene que estar escrito en su documento.
  batch.update(businessDoc(businessId), {
    planId, whatsappQuota, maxBarbers, maxSucursales,
    // Las funciones que el plan habilita (foto, colores, logo). Las Rules leen
    // ESTE campo: sin escribirlo, cambiar de plan no cambiaría nada de lo que
    // la base acepta.
    ...(capacidades ? { capacidades } : {}),
  });
  batch.set(billingDoc(businessId), { monthlyFee, planId }, { merge: true });

  // Las SUCURSALES de la cuenta reciben los mismos topes y capacidades, pero no
  // el abono: el plan lo paga la principal. Si no se propagara, el dueño que
  // sube de plan vería la función nueva en la principal y no en las otras tres,
  // porque lo que miran las Rules es el campo de CADA documento.
  for (const id of sucursales) {
    if (!id || id === businessId) continue;
    batch.update(businessDoc(id), {
      planId, maxBarbers, maxSucursales,
      ...(capacidades ? { capacidades } : {}),
    });
  }

  await batch.commit();
}

// ============================================================================
// RESEÑAS
// ============================================================================
// Una por turno. El id del documento ES el id del turno: con eso, la segunda
// reseña del mismo turno es imposible sin contar nada ni confiar en el
// frontend — Firestore no deja crear dos documentos con el mismo id, y las
// Rules solo permiten actualizar al que la escribió.

const reviewDoc = (businessId, appointmentId) =>
  doc(db, 'businesses', businessId, 'reviews', appointmentId);

/**
 * Deja (o corrige) la reseña de un turno.
 *
 * El profesional, el servicio y el negocio NO se aceptan de quien llama: salen
 * del turno. Las Rules lo vuelven a verificar contra el documento del turno,
 * así que una reseña no puede quedar colgada del barbero equivocado.
 */
export async function guardarResena(businessId, turno, { stars, comment = '' }) {
  const ref = reviewDoc(businessId, turno.id);
  const existente = await getDoc(ref);

  const datos = {
    stars: Number(stars),
    comment: String(comment || '').slice(0, 600),
  };

  if (existente.exists()) {
    await updateDoc(ref, { ...datos, updatedAt: serverTimestamp() });
    return { id: ref.id, actualizada: true };
  }

  await setDoc(ref, {
    ...datos,
    id: turno.id,
    businessId,
    appointmentId: turno.id,
    userId: turno.userId,
    professionalId: turno.professionalId,
    serviceId: turno.serviceId ?? null,
    clientName: turno.clientName || '',
    appointmentDate: turno.appointmentDate,
    createdAt: serverTimestamp(),
  });
  return { id: ref.id, actualizada: false };
}

/** Las reseñas que dejó esta persona en esta barbería. */
export async function misResenas(businessId, uid) {
  const q = query(subCol(businessId, 'reviews'), where('userId', '==', uid));
  return rows(await getDocs(q));
}

/** Todas las reseñas de una barbería, de la más nueva a la más vieja. */
export async function obtenerResenas(businessId) {
  const filas = rows(await getDocs(subCol(businessId, 'reviews')));
  return filas.sort((a, b) => String(b.appointmentDate || '').localeCompare(String(a.appointmentDate || '')));
}

// ============================================================================
// SUBCOLECCIONES DEL NEGOCIO
// ============================================================================

/**
 * Lee una subcolección UNA vez, sin dejar un listener abierto.
 *
 * Para la pantalla que muestra todas las sucursales juntas: necesita los turnos
 * y el equipo de cada una, y dejar cuatro suscripciones vivas por eso sería
 * pagar la agenda entera de cuatro barberías en cada pantalla del panel, no solo
 * en esta. Se lee al entrar y hay un botón para volver a leer.
 *
 * (No rompe la regla de "las suscripciones viven en BusinessSync": esto no es
 * una suscripción, es una lectura, como `getBusinessIdBySlug`.)
 */
export async function obtenerSubcoleccion(businessId, name) {
  const snap = await getDocs(subCol(businessId, name));
  return rows(snap);
}

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

// ── Avisos de la plataforma para todas las barberías ────────────────────────
// Lo que antes se mandaba por WhatsApp uno por uno ("actualicé esto, volvé a
// activar los avisos"). Lo escribe la plataforma y lo ve todo el staff.

const avisosCol = () => collection(db, 'platform', 'avisos', 'items');

export function subscribeAvisos(cb, onError) {
  const q = query(avisosCol(), orderBy('createdAt', 'desc'), limit(10));
  return escuchar(q, rows, cb, onError);
}

export async function publicarAviso(datos) {
  const ref = doc(avisosCol());
  await setDoc(ref, { ...datos, id: ref.id, activo: true, createdAt: serverTimestamp() });
  return ref.id;
}

export async function actualizarAviso(id, cambios) {
  await updateDoc(doc(db, 'platform', 'avisos', 'items', id), cambios);
}

export async function borrarAviso(id) {
  await deleteDoc(doc(db, 'platform', 'avisos', 'items', id));
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
