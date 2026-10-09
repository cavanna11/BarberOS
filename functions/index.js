// ============================================================================
// BarberOS — Cloud Functions
// ============================================================================
// Acá vive lo que NO puede vivir en el browser:
//
//  1. Asignar permisos (custom claims). Es la razón principal de que exista
//     este archivo: los claims son la fuente de verdad de las Security Rules y
//     solo el Admin SDK los puede escribir. Si el permiso saliera de un
//     documento de Firestore, un dueño podría editarse el suyo y escalar.
//  2. Facturación mensual. Hoy corre en el browser (BusinessContext) y por eso
//     depende de que alguien abra la app. Como función programada, corre igual
//     aunque nadie entre.
//  3. Recordatorios de WhatsApp, cuando se active: el token de Meta no puede
//     estar en el bundle.
//
// Requiere plan Blaze (pago por uso). Ver FIREBASE_SETUP.md.

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { setGlobalOptions } = require('firebase-functions/v2');
const logger = require('firebase-functions/logger');
// Mercado Pago vive aparte (OAuth + cobro de la seña); se usa en createAppointment.
const mp = require('./mercadopago');
const { limitesDelNegocio, capacidadesDelNegocio, camposDelPlan } = require('./planes');
const cupones = require('./cupones');
// Membresías: planes mensuales de la barbería a sus clientes (createAppointment
// descuenta el uso; el resto vive allá).
const membresias = require('./membresias');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { getMessaging } = require('firebase-admin/messaging');

// Se usan los submódulos y no el namespace `admin.*` a propósito: el emulador
// de Functions envuelve firebase-admin en un proxy para interceptar
// initializeApp, y en el camino se pierden los namespaces perezosos —
// `admin.firestore.FieldValue` llega como undefined y revienta recién en
// runtime, dentro del callable. Con los submódulos no hay proxy que valga.
initializeApp();
const db = getFirestore();

setGlobalOptions({ region: 'southamerica-east1', maxInstances: 10 });

// ── Guardas ────────────────────────────────────────────────────────────────

/**
 * Quién puede tocar los permisos de un negocio. Devuelve 'platform' | 'owner'
 * para que quien llama sepa hasta dónde puede llegar.
 *
 * - La plataforma puede todo: designar dueños, mover gente entre negocios.
 * - El dueño de una barbería puede gestionar SOLO su propio negocio y SOLO el
 *   rol `admin` (barbero). No puede designar otros dueños: el dueño es quien
 *   paga la cuenta, así que quién lo es es una decisión comercial de la
 *   plataforma y no se delega al tenant.
 */
function assertCanManageAdmins(request, businessId) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Tenés que iniciar sesión.');
  }
  const token = request.auth.token;
  if (token.platform === true) return 'platform';
  if (token.role === 'owner' && token.businessId === businessId) return 'owner';
  throw new HttpsError('permission-denied', 'No podés gestionar los permisos de este negocio.');
}

/**
 * Impide que un llamador que no es la plataforma toque a alguien fuera de su
 * alcance — y sobre todo, a la plataforma misma.
 *
 * Esto NO es paranoia: `setCustomUserClaims` REEMPLAZA todos los claims, no los
 * mergea. Sin este chequeo, el dueño de una barbería podría llamar a
 * `setBusinessAdmin` con el mail de la plataforma y rol `admin`: le borraría el
 * claim `platform` y dejaría el panel global sin nadie que pueda entrar. El
 * mismo agujero existe por el lado de `revokeBusinessAdmin`.
 *
 * `targetClaims` son los claims que el destinatario tiene HOY (vacío si nunca
 * entró, que es un caso legítimo y se deja pasar).
 */
function assertTargetEnAlcance(caller, targetClaims, businessId) {
  if (caller === 'platform') return;
  if (targetClaims?.platform === true) {
    throw new HttpsError('permission-denied', 'No podés modificar a la plataforma.');
  }
  if (targetClaims?.role === 'owner') {
    throw new HttpsError('permission-denied', 'Solo la plataforma puede modificar a un dueño.');
  }
  if (targetClaims?.businessId && targetClaims.businessId !== businessId) {
    throw new HttpsError('permission-denied', 'Esa cuenta pertenece a otro negocio.');
  }
}

// ============================================================================
// CUENTAS CON SUCURSALES
// ============================================================================
// Una cuenta empresarial es un GRUPO de barberías administradas por el mismo
// dueño. Cada sucursal es una barbería completa y separada —su equipo, sus
// servicios, sus horarios, su agenda, su link público— y lo único que comparten
// es quién entra.
//
// Cómo se ata: cada negocio del grupo lleva `grupoId`, que es el id del negocio
// PRINCIPAL. Así el principal se reconoce solo (`grupoId === id`) y no hace
// falta un flag aparte que se pueda contradecir con la realidad.
//
// El permiso: el dueño lleva en sus claims
//
//   { businessId: <principal>, role: 'owner', grupoId, businessIds: [...] }
//
// `businessId` sigue existiendo y apuntando a uno solo porque es lo que
// entiende todo el código viejo; `businessIds` es la lista completa y es lo que
// miran las Rules (`bizId in businessIds`). Un barbero NUNCA lleva
// `businessIds`: su claim nombra una sola barbería, así que el aislamiento
// entre sucursales le sale gratis.

/**
 * Los claims que le corresponden a alguien en este negocio, resolviendo el
 * grupo si lo hay.
 *
 * Se recalcula desde la base y no se arrastra lo que viniera de antes: es la
 * única forma de que un claim no quede viejo. `setCustomUserClaims` REEMPLAZA
 * todo, así que armar esto mal no "pierde" un permiso: lo borra.
 *
 * Solo el dueño recibe la lista: un barbero pertenece a UNA sucursal.
 */
async function claimsDeNegocio({ businessId, role, professionalId = null }) {
  const base = { businessId, role, professionalId: professionalId ?? null };
  if (role !== 'owner') return base;

  const snap = await db.doc(`businesses/${businessId}`).get();
  const grupoId = snap.exists ? snap.get('grupoId') || null : null;
  if (!grupoId) return base;

  const hermanas = await db.collection('businesses').where('grupoId', '==', grupoId).get();
  const ids = hermanas.docs.map((d) => d.id);
  if (ids.length < 2) return { ...base, grupoId };

  // El `businessId` suelto apunta al principal del grupo si está entre las
  // suyas: es el que abre el panel por defecto y el que tiene el plan.
  return {
    ...base,
    businessId: ids.includes(grupoId) ? grupoId : businessId,
    grupoId,
    businessIds: ids,
  };
}

// ============================================================================
// 1. PERMISOS
// ============================================================================

/**
 * Le da a un Gmail acceso al panel de una barbería.
 *
 * Cómo funciona: los claims van pegados al UID de Firebase Auth, que existe
 * recién cuando la persona entra por primera vez con Google. Así que:
 *   - si ya entró alguna vez → se le aplican los claims al toque
 *   - si nunca entró        → se deja el permiso "pendiente" en
 *                             /pendingAdmins/{email}, y se aplica solo en su
 *                             primer login (ver applyPendingClaims)
 *
 * Llamada desde el panel: httpsCallable(functions, 'setBusinessAdmin')
 */
exports.setBusinessAdmin = onCall(async (request) => {
  const { email, businessId, role, professionalId = null, name = '' } = request.data || {};

  // Primero quién llama y después qué manda: al revés, alguien sin sesión
  // podía distinguir "datos inválidos" de "no autorizado" y usar la función
  // para tantear. No exponía nada real, pero el orden correcto es este.
  const caller = assertCanManageAdmins(request, businessId);

  if (!email || !businessId || !['owner', 'admin'].includes(role)) {
    throw new HttpsError('invalid-argument', 'Faltan email, businessId o role válido.');
  }

  if (caller !== 'platform' && role !== 'admin') {
    throw new HttpsError('permission-denied', 'Solo la plataforma puede designar dueños.');
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const claims = { businessId, role, professionalId };

  const businessSnap = await db.doc(`businesses/${businessId}`).get();
  if (!businessSnap.exists) {
    throw new HttpsError('not-found', `El negocio ${businessId} no existe.`);
  }

  // Se busca al destinatario ANTES de escribir nada: si está fuera del alcance
  // de quien llama hay que rechazar sin dejar la operación a medio hacer.
  let targetUser = null;
  try {
    targetUser = await getAuth().getUserByEmail(normalizedEmail);
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err;
  }

  assertTargetEnAlcance(caller, targetUser?.customClaims, businessId);

  // Misma razón que en applyPendingClaims: una cuenta que existe pero no tiene
  // el mail verificado puede ser de cualquiera que se registró por la API
  // pública con ese mail. No se le dan permisos.
  if (targetUser && !targetUser.emailVerified) {
    throw new HttpsError(
      'failed-precondition',
      'Ya existe una cuenta con ese mail pero no está verificada. Escribinos y lo revisamos.'
    );
  }

  // Un barbero SIN perfil, o con uno que no existe, no puede ver su agenda:
  // las Rules filtran los turnos por este id. Dejarlo pasar creaba una cuenta
  // que entra al panel y ve la agenda vacía mientras los clientes reservan.
  // Pasó en producción (22/09/2026), así que se valida acá y no solo en la UI.
  if (role === 'admin') {
    if (!professionalId) {
      throw new HttpsError('invalid-argument', 'Un peluquero necesita un perfil de profesional asignado, si no no va a ver sus turnos.');
    }
    const perfil = await db.doc(`businesses/${businessId}/professionals/${professionalId}`).get();
    if (!perfil.exists) {
      throw new HttpsError('not-found', 'Ese perfil de profesional no existe en esta barbería. Elegí uno de la lista.');
    }
  }

  // Registro para la UI (la lista de /admin/admins sale de acá).
  await db.doc(`businesses/${businessId}/admins/${normalizedEmail}`).set({
    email: normalizedEmail,
    name,
    role,
    businessId,
    professionalId,
    addedAt: FieldValue.serverTimestamp(),
  });

  // Nunca entró: su UID todavía no existe, así que el permiso queda anotado y
  // se aplica solo en el primer login (ver applyPendingClaims).
  if (!targetUser) {
    await db.doc(`pendingAdmins/${normalizedEmail}`).set({
      ...claims,
      email: normalizedEmail,
      name,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { status: 'pending', message: 'Se aplicará en su primer login con Google.' };
  }

  // Un usuario pertenece a un solo negocio. Si ya administraba otro, esto lo
  // reemplaza: es intencional, evita accesos cruzados olvidados.
  //
  // La excepción son las SUCURSALES de la misma cuenta: si este negocio es
  // parte de un grupo, el dueño recibe la lista entera (claimsDeNegocio la
  // resuelve leyendo `grupoId`). Sin eso, nombrar de nuevo al dueño de una
  // sucursal le borraba el acceso a las otras tres.
  await getAuth().setCustomUserClaims(targetUser.uid, await claimsDeNegocio(claims));

  // El token del cliente sigue teniendo los claims viejos hasta que se
  // refresca. El frontend tiene que llamar a getIdToken(true) — o cerrar y
  // volver a abrir sesión — para que tomen efecto.
  return { status: 'applied', uid: targetUser.uid };
});

/** Le quita todo acceso administrativo a un mail. */
exports.revokeBusinessAdmin = onCall(async (request) => {
  const { email, businessId } = request.data || {};
  if (!email || !businessId) {
    throw new HttpsError('invalid-argument', 'Faltan email o businessId.');
  }

  const caller = assertCanManageAdmins(request, businessId);
  const normalizedEmail = String(email).trim().toLowerCase();

  // Igual que en setBusinessAdmin: primero se mira a quién se está por tocar.
  // Revocar es tan destructivo como asignar — dejar entrar acá al mail de la
  // plataforma le vaciaría los claims y nadie podría abrir el panel global.
  let targetUser = null;
  try {
    targetUser = await getAuth().getUserByEmail(normalizedEmail);
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err;
  }

  assertTargetEnAlcance(caller, targetUser?.customClaims, businessId);

  await db.doc(`businesses/${businessId}/admins/${normalizedEmail}`).delete();
  await db.doc(`pendingAdmins/${normalizedEmail}`).delete().catch(() => {});

  if (!targetUser) return { status: 'not-found' };

  await getAuth().setCustomUserClaims(targetUser.uid, {});
  // Corta las sesiones abiertas: sin esto, su token actual sigue siendo
  // válido hasta una hora después.
  await getAuth().revokeRefreshTokens(targetUser.uid);
  return { status: 'revoked' };
});

/**
 * Aplica los permisos que quedaron pendientes de alguien que todavía no había
 * entrado nunca. Se llama desde el frontend una vez, después del login.
 * No necesita guarda: solo puede reclamar el permiso dejado para SU propio mail.
 */
exports.applyPendingClaims = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Tenés que iniciar sesión.');
  }

  const email = (request.auth.token.email || '').toLowerCase();
  if (!email) return { status: 'no-email' };

  // Solo con el mail verificado. Con la API pública de Firebase Auth cualquiera
  // puede crear una cuenta de email+contraseña con el mail que quiera, sin
  // verificarlo; sin este chequeo, se registraba con el mail de un pendiente
  // (barbero, dueño o moderador) y se llevaba el permiso. Google verifica; las
  // cuentas que crea la plataforma nacen verificadas; las de un intruso, no.
  if (request.auth.token.email_verified !== true) {
    return { status: 'email-no-verificado' };
  }

  const pendingRef = db.doc(`pendingAdmins/${email}`);
  const pending = await pendingRef.get();
  if (!pending.exists) return { status: 'none' };

  const datos = pending.data();

  // El pendiente puede ser de dos formas: permiso de barbería (businessId +
  // role) o moderador de la plataforma (platform: 'moderator'). Se aplica el
  // que corresponda, nunca una mezcla.
  const claims = datos.platform === true
    ? { platform: true }
    : datos.platform === 'moderator'
      ? { platform: 'moderator' }
      // Si la barbería es parte de una cuenta con sucursales, el dueño entra
      // con todas: la lista se resuelve ahora, no cuando se dejó el pendiente
      // (entre las dos cosas pueden haber abierto una sucursal más).
      : await claimsDeNegocio({
          businessId: datos.businessId,
          role: datos.role,
          professionalId: datos.professionalId ?? null,
        });

  await getAuth().setCustomUserClaims(request.auth.uid, claims);
  await pendingRef.delete();

  // El frontend tiene que refrescar el token para ver los claims nuevos.
  return { status: 'applied', ...claims };
});

// ============================================================================
// 2. FACTURACIÓN
// ============================================================================

/**
 * Suma un mes a 'YYYY-MM-DD' sin saltearse meses.
 *
 * `d.setMonth(d.getMonth() + 1)` parece lo natural y está mal: el 31 de enero
 * más un mes da "31 de febrero", que JS normaliza al 3 de marzo. Un negocio que
 * vence el 31 se saltearía febrero entero. Acá el día se recorta al último del
 * mes destino (31/01 → 28/02), que es lo que espera cualquiera que cobra.
 */
function sumarUnMes(fechaISO) {
  const [y, m, d] = fechaISO.split('-').map(Number);
  const anio = m === 12 ? y + 1 : y;
  const mes = m === 12 ? 1 : m + 1;
  const ultimoDia = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const dia = Math.min(d, ultimoDia);
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/**
 * Cobro mensual y suspensión por deuda. Todos los días a las 3 AM.
 *
 * Reemplaza al motor que hoy corre en el browser: ese solo se ejecuta cuando
 * alguien abre la app, así que una cuenta impaga podía seguir funcionando
 * indefinidamente si nadie entraba al panel.
 */
/**
 * El cuerpo de la facturación, aparte del disparador.
 *
 * Se exporta para poder probarlo: una `onSchedule` no se puede invocar por HTTP
 * como un callable, y el emulador la ignora salvo que corras también el de
 * pubsub. Separarla deja que scripts/test-billing-emulador.mjs la llame directo.
 */
async function procesarFacturacion() {
  // La fecha del negocio, no la del servidor: a las 3 AM de Buenos Aires en
  // UTC ya es otro día parte del año.
  const today = hoyEnArgentina();
  const businesses = await db.collection('businesses').get();

  // Una sola lectura por lote en vez de un get() por negocio adentro del
  // loop: con 200 barberías eran 200 viajes en serie.
  const billingRefs = businesses.docs.map((d) => db.doc(`businesses/${d.id}/private/billing`));
  const billingSnaps = [];
  for (let i = 0; i < billingRefs.length; i += 300) {
    const trozo = billingRefs.slice(i, i + 300);
    if (trozo.length) billingSnaps.push(...(await db.getAll(...trozo)));
  }

  // Firestore corta un batch en 500 operaciones y falla el batch ENTERO al
  // pasarse: con un solo batch, a partir de ~250 negocios no se cobraba nada
  // y encima el error no decía cuál era el problema real.
  const LIMITE = 450;
  const escrituras = [];
  const suspendidos = [];

  let enPrueba = 0;

  // Dos pasadas: primero la deuda de cada negocio, después a quién se congela.
  // Hace falta separarlas por las cuentas con sucursales: para decidir si una
  // sucursal sigue abierta hay que saber la deuda del principal, que puede
  // aparecer más adelante en la lista.
  const estado = new Map();

  businesses.docs.forEach((doc, i) => {
    const biz = doc.data();
    const fila = { doc, biz, debt: 0, enPrueba: false };
    estado.set(doc.id, fila);

    // Cuenta de prueba: ni se cobra ni se congela hasta que termine. El
    // primer vencimiento se fija en trialEndsAt al darla de alta, así que al
    // día siguiente de vencer entra a cobrarse sola por el camino normal y
    // queda congelada — que es justamente lo que corta la prueba.
    if (biz.trialEndsAt && today <= biz.trialEndsAt) {
      enPrueba++;
      fila.enPrueba = true;
      return;
    }

    const billingSnap = billingSnaps[i];
    const billing = billingSnap && billingSnap.exists ? billingSnap.data() : {};

    let debt = billing.debt || 0;
    let nextBillingDate = billing.nextBillingDate;
    let changed = false;

    if (!nextBillingDate) {
      nextBillingDate = sumarUnMes(today);
      changed = true;
    }

    // Si pasaron varios vencimientos sin pago, se acumulan todos. El tope de
    // vueltas es una red por si nextBillingDate viniera corrupto: sin él, un
    // valor raro deja la función girando hasta el timeout.
    let vueltas = 0;
    while (today > nextBillingDate && vueltas < 120) {
      debt += billing.monthlyFee || 0;
      nextBillingDate = sumarUnMes(nextBillingDate);
      changed = true;
      vueltas++;
    }
    if (vueltas >= 120) {
      console.error(`[billing] ${doc.id}: nextBillingDate sospechoso (${billing.nextBillingDate}), se corta.`);
    }

    if (changed) {
      escrituras.push({ ref: billingSnap.ref, datos: { debt, nextBillingDate }, merge: true });
    }

    fila.debt = debt;
  });

  // Segunda pasada: la suspensión.
  //
  // En una cuenta con sucursales el plan lo paga el PRINCIPAL y las sucursales
  // van con abono 0. Si cada una mirara solo su propia deuda, el día que el
  // dueño deja de pagar se congelaría el principal y las otras tres seguirían
  // tomando turnos — que es exactamente la palanca de cobro desarmada. La deuda
  // que manda es la del principal del grupo.
  for (const fila of estado.values()) {
    const { doc, biz } = fila;
    const principal = biz.grupoId ? estado.get(biz.grupoId) : null;

    // La prueba es de la cuenta entera: una sucursal no se congela mientras el
    // principal esté en período de prueba (ni al revés).
    if (fila.enPrueba || (principal && principal.enPrueba)) continue;

    const deudaQueManda = Math.max(fila.debt, principal ? principal.debt : 0);

    // `isFrozen` vive en el documento público porque las Rules y la página de
    // reservas lo necesitan para bloquear el link.
    const shouldFreeze = deudaQueManda > 0;
    if (Boolean(biz.isFrozen) !== shouldFreeze) {
      escrituras.push({ ref: doc.ref, datos: { isFrozen: shouldFreeze }, merge: true });
      if (shouldFreeze) suspendidos.push({ id: doc.id, name: biz.name || doc.id, debt: deudaQueManda });
    }
  }

  for (let i = 0; i < escrituras.length; i += LIMITE) {
    const batch = db.batch();
    for (const e of escrituras.slice(i, i + LIMITE)) {
      batch.set(e.ref, e.datos, { merge: true });
    }
    await batch.commit();
  }

  console.log(
    `[billing] ${today}: ${escrituras.length} cambios sobre ${businesses.size} negocios` +
    (enPrueba ? `, ${enPrueba} en período de prueba.` : '.')
  );

  // Que la plataforma se entere de cada cuenta que se cortó por deuda: es
  // el momento de escribirle al dueño, no de descubrirlo en el panel días
  // después.
  await liberarCuponesDePagosAbandonados();

  for (const s of suspendidos) {
    await notificarPlataforma({
      type: 'cuenta_suspendida',
      title: 'Cuenta suspendida por deuda',
      body: `${s.name} quedó suspendida. Debe $${Number(s.debt).toLocaleString('es-AR')}.`,
      businessId: s.id,
      url: '/super-admin/barberias',
    }).catch((err) => console.error('[billing] No se pudo avisar la suspensión:', err.message));
  }
}

/**
 * Devuelve los usos de cupón de los turnos que nunca se pagaron.
 *
 * Un turno con seña nace `esperando_pago` y, si el cliente no paga en 15
 * minutos, deja de ocupar el horario — pero el documento NO se marca cancelado:
 * `reservaViva()` lo descarta por reloj (`senaExpiraEn`) y nada más. Eso está
 * bien para la agenda, pero deja el uso del cupón reservado para siempre, y el
 * trigger de estados no se entera porque el estado nunca cambió.
 *
 * Sin esto, un cupón de 50 usos se agota con 50 personas que abrieron Mercado
 * Pago y cerraron la pestaña.
 *
 * Va en el barrido diario porque es exactamente eso: limpieza de algo que no
 * tiene apuro. El turno se marca `cancelada` —que es lo que es— y el trigger de
 * arriba se encarga de devolver el uso, sin duplicar esa lógica acá.
 */
async function liberarCuponesDePagosAbandonados() {
  const vencidos = await db.collectionGroup('appointments')
    .where('status', '==', 'esperando_pago')
    .where('senaExpiraEn', '<', new Date())
    .limit(400)
    .get();

  for (const d of vencidos.docs) {
    await d.ref.update({
      status: 'cancelada',
      cancelledBy: 'sistema',
      cancellationReason: 'No se completó el pago',
    }).catch((err) => console.error('[billing] no se pudo cerrar un pago abandonado:', err.message));
  }

  if (!vencidos.empty) {
    logger.info('pagos abandonados cerrados', { cantidad: vencidos.size });
  }
}

exports.procesarFacturacion = procesarFacturacion;

exports.runBilling = onSchedule(
  { schedule: '0 3 * * *', timeZone: 'America/Argentina/Buenos_Aires' },
  procesarFacturacion
);

// ============================================================================
// 4. RESERVA DE TURNOS
// ============================================================================
// Por qué existe: hasta acá el turno lo escribía el browser directo a Firestore
// y las Rules solo miraban userId, businessId y status. Todo lo demás venía del
// cliente y se le creía. Verificado contra el emulador, se podía crear un turno
// con price 0, con fecha en 2020, con un profesional inexistente y —lo peor—
// en una barbería SUSPENDIDA por falta de pago, que es justamente la palanca de
// cobro.
//
// El motor de disponibilidad vive en el browser y ahí seguirá (es lo que pinta
// la grilla), pero no puede ser la única autoridad: cualquiera con la consola
// abierta lo saltea. Acá se revalida todo del lado del servidor.
//
// El precio y la duración NUNCA se aceptan del cliente: salen del documento del
// servicio.

/** '09:30' → 570. Igual que utils/dateUtils.js en el front. */
function timeToMinutes(t) {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + m;
}

/** 570 → '09:30'. */
function minutesToTime(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * 0=Lunes … 6=Domingo. OJO: NO es la convención de JS (0=Domingo).
 * Tiene que coincidir clavado con getLocalDayOfWeek de utils/dateUtils.js, que
 * hace el mismo remapeo — si no, los horarios cargados no matchean ningún día.
 * Se toma el mediodía UTC para que el string de fecha no se corra de día.
 */
function diaDeLaSemana(fechaISO) {
  const d = new Date(`${fechaISO}T12:00:00Z`).getUTCDay();
  return d === 0 ? 6 : d - 1;
}

/** Turnos activos (hoy o después) que una cuenta puede tener en una barbería. */
const MAX_TURNOS_ACTIVOS = 3;

// Cuánto se le guarda el horario al cliente mientras paga la seña. Quince
// minutos alcanzan para buscar la tarjeta sin dejar el horario bloqueado media
// tarde si abandona.
const MINUTOS_PARA_PAGAR = 15;

const FORMATO_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const FORMATO_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * ¿Este turno ocupa el lugar?
 *
 * `esperando_pago` es el turno que se le guarda al cliente mientras paga la
 * seña: ocupa el horario, pero solo hasta `senaExpiraEn`. Pasados los 15
 * minutos el lugar vuelve a estar libre aunque el documento siga existiendo —
 * si no, un cliente que abandona el pago le bloquea el horario al barbero para
 * siempre.
 */
function reservaViva(a) {
  if (a.status === 'pendiente' || a.status === 'confirmada') return true;
  if (a.status !== 'esperando_pago') return false;
  const vence = a.senaExpiraEn?.toMillis?.() ?? 0;
  return vence > Date.now();
}

/** Hoy en Buenos Aires, como 'YYYY-MM-DD'. No sirve el hoy del servidor (UTC). */
function hoyEnArgentina() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

// ============================================================================
// CUPONES DE DESCUENTO
// ============================================================================
// El cálculo está en `cupones.js` (sin Firestore, para poder probarlo solo).
// Acá está todo lo que necesita leer o escribir: validar contra la base,
// consumir el uso dentro de la transacción del turno, y devolver el uso cuando
// el turno se cae.
//
// Regla que atraviesa todo: el servidor NUNCA usa el descuento que mandó el
// cliente. Recalcula sobre el precio del documento del servicio, que es el
// único precio en el que se puede confiar. Lo que el browser muestra antes de
// confirmar es una vista previa.

/** Estados en los que un turno cuenta como "este cliente ya vino acá". */
const ESTADOS_DE_CLIENTE = ['pendiente', 'confirmada', 'completada', 'no_asistio'];

/**
 * Freno a la fuerza bruta sobre códigos.
 *
 * Sin esto, `validarCupon` es un oráculo: se le tiran diccionarios hasta que
 * conteste que sí. El mensaje de error ya es siempre el mismo —no dice si el
 * código existe— pero eso solo hace falta MÁS intentos, no los hace inútiles.
 *
 * Se cuentan solo los intentos FALLIDOS, por cuenta y por barbería, en ventanas
 * de 10 minutos. Un cliente real falla una o dos veces (lo copió con un espacio
 * de más, el cupón venció); quince fallos en diez minutos no es un cliente.
 *
 * Vive en una colección que no lee ni escribe nadie desde el browser.
 */
const INTENTOS_MAX = 15;
const INTENTOS_VENTANA_MS = 10 * 60 * 1000;

async function frenarFuerzaBruta(bizId, uid) {
  const ref = db.doc(`rateLimits/cupon_${bizId}_${uid}`);
  const snap = await ref.get();
  const ahora = Date.now();
  const desde = snap.exists ? (snap.get('desde') || 0) : 0;

  // Ventana vencida: se arranca de cero. No es un contador histórico, es "qué
  // viene haciendo esta cuenta ahora".
  if (ahora - desde > INTENTOS_VENTANA_MS) return { bloqueado: false, ref, reiniciar: true };

  const intentos = snap.get('intentos') || 0;
  return { bloqueado: intentos >= INTENTOS_MAX, ref, reiniciar: false };
}

async function anotarIntentoFallido(ref, reiniciar) {
  if (reiniciar) await ref.set({ desde: Date.now(), intentos: 1 });
  else await ref.set({ intentos: FieldValue.increment(1) }, { merge: true });
}

/**
 * Lee el cupón y todo lo que hace falta para decidir si aplica.
 *
 * `tx` opcional: cuando viene, las lecturas entran en la transacción del turno
 * y el tope de usos queda protegido contra la carrera de dos clientes por el
 * último lugar. Sin `tx` es la vista previa, que puede quedar desactualizada
 * entre que el cliente aplica el cupón y confirma — y está bien, porque lo que
 * vale es la validación de adentro de la transacción.
 */
async function leerContextoDelCupon({ tx, businessId, codigo, uid, turnosPrevios = null }) {
  const normalizado = cupones.normalizarCodigo(codigo);
  if (!cupones.codigoValido(normalizado)) return { cupon: null, ctx: {} };

  const ref = db.doc(`businesses/${businessId}/cupones/${normalizado}`);
  const usosDelClienteQ = ref.collection('usos').where('userId', '==', uid);

  // `turnosPrevios` viene resuelto cuando esto corre adentro de la transacción
  // del turno: ahí la agenda del cliente YA se leyó para el tope de turnos
  // activos, y volver a pedirla sería pagar dos veces la misma lectura en la
  // operación más caliente del producto.
  const agendaQ = db.collection(`businesses/${businessId}/appointments`).where('userId', '==', uid);
  const faltaLaAgenda = turnosPrevios === null;

  const snap = tx ? await tx.get(ref) : await ref.get();
  if (!snap.exists) return { cupon: null, ctx: {}, ref };

  const usos = tx ? await tx.get(usosDelClienteQ) : await usosDelClienteQ.get();
  const propios = faltaLaAgenda ? (tx ? await tx.get(agendaQ) : await agendaQ.get()) : null;

  // "Cliente nuevo" = no tenía un turno vivo o pasado en ESTA barbería antes de
  // usar el cupón. Un turno cancelado no cuenta: nunca llegó a venir.
  const tieneTurnosPrevios = faltaLaAgenda
    ? propios.docs.some((d) => ESTADOS_DE_CLIENTE.includes(d.get('status')))
    : turnosPrevios;

  return {
    cupon: { id: snap.id, ...snap.data() },
    ref,
    ctx: {
      usosDelCliente: usos.size,
      tieneTurnosPrevios,
      ahora: new Date(),
    },
  };
}

/**
 * "¿Sirve este código?" — lo que pregunta el browser antes de confirmar.
 *
 * Devuelve el descuento calculado, o un rechazo genérico. El motivo real queda
 * en los logs y nunca viaja al cliente: decirle "ese cupón venció" confirma que
 * el código existe, y con eso alguien arma la lista de los que andan.
 */
exports.validarCupon = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Tenés que iniciar sesión.');
  }
  const { businessId, codigo, serviceId = null, professionalId = null } = request.data || {};
  if (!businessId || !codigo) {
    throw new HttpsError('invalid-argument', 'Faltan datos.');
  }

  const uid = request.auth.uid;
  const freno = await frenarFuerzaBruta(businessId, uid);
  if (freno.bloqueado) {
    throw new HttpsError('resource-exhausted', 'Probaste muchos códigos seguidos. Esperá unos minutos.');
  }

  const srvSnap = serviceId
    ? await db.doc(`businesses/${businessId}/services/${serviceId}`).get()
    : null;
  const precio = srvSnap?.exists ? Number(srvSnap.data().price) || 0 : 0;

  const { cupon, ctx } = await leerContextoDelCupon({ businessId, codigo, uid });
  const r = cupones.aplicarCupon(cupon, precio, { ...ctx, serviceId, professionalId });

  if (!r.aplica) {
    await anotarIntentoFallido(freno.ref, freno.reiniciar);
    logger.info('cupón rechazado', { businessId, uid, motivo: r.motivo });
    return { valido: false, mensaje: cupones.MENSAJE_AL_CLIENTE };
  }

  return {
    valido: true,
    codigo: cupon.codigo,
    tipo: cupon.tipo,
    valor: cupon.valor,
    descuento: r.descuento,
    precioLista: precio,
    precioFinal: r.precioFinal,
  };
});

exports.createAppointment = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Tenés que iniciar sesión para reservar.');
  }

  const {
    businessId, professionalId, serviceId, appointmentDate, startTime,
    clientName = '', clientPhone = '', clientEmail = '', notes = '',
    cuponCodigo = null,
    // El cliente marcó "usar mi membresía". Es SU elección, desde SU cuenta:
    // el barbero no tiene forma de marcarlo por él (ver membresias.js).
    usarMembresia = false,
  } = request.data || {};

  if (!businessId || !professionalId || !serviceId || !appointmentDate || !startTime) {
    throw new HttpsError('invalid-argument', 'Faltan datos del turno.');
  }
  if (!FORMATO_FECHA.test(appointmentDate) || !FORMATO_HORA.test(startTime)) {
    throw new HttpsError('invalid-argument', 'Fecha u hora con formato inválido.');
  }
  if (appointmentDate < hoyEnArgentina()) {
    throw new HttpsError('invalid-argument', 'No se puede reservar en una fecha pasada.');
  }

  // El teléfono es lo único que le pedimos al cliente además del turno: es por
  // donde lo va a contactar el barbero. Vale la pena que sea un número.
  // Se aceptan espacios, guiones y paréntesis, y se cuentan solo los dígitos:
  // "+54 9 11 1234-5678" y "1123456789" son los dos válidos.
  const digitos = String(clientPhone).replace(/\D/g, '');
  if (digitos.length < 10 || digitos.length > 13) {
    throw new HttpsError('invalid-argument', 'Ingresá un teléfono válido, con código de área.');
  }

  const bizRef = db.doc(`businesses/${businessId}`);
  const [bizSnap, srvSnap, profSnap] = await Promise.all([
    bizRef.get(),
    db.doc(`businesses/${businessId}/services/${serviceId}`).get(),
    db.doc(`businesses/${businessId}/professionals/${professionalId}`).get(),
  ]);

  if (!bizSnap.exists) throw new HttpsError('not-found', 'La barbería no existe.');
  const negocio = bizSnap.data();

  // La suspensión por deuda tiene que cortar la reserva, no solo esconder la UI.
  if (negocio.isFrozen === true) {
    throw new HttpsError('failed-precondition', 'Esta barbería no está tomando turnos en este momento.');
  }
  if (!srvSnap.exists || srvSnap.data().isActive === false) {
    throw new HttpsError('not-found', 'El servicio no existe o no está disponible.');
  }
  if (!profSnap.exists || profSnap.data().isActive === false) {
    throw new HttpsError('not-found', 'El profesional no existe o no está disponible.');
  }

  const servicio = srvSnap.data();
  const duracion = Number(servicio.durationMinutes);
  const precio = Number(servicio.price);
  if (!Number.isFinite(duracion) || duracion <= 0) {
    throw new HttpsError('failed-precondition', 'El servicio no tiene una duración válida.');
  }

  // ¿Este profesional hace este servicio?
  const vinculo = await db.collection(`businesses/${businessId}/professionalServices`)
    .where('professionalId', '==', professionalId)
    .where('serviceId', '==', serviceId)
    .limit(1).get();
  if (vinculo.empty) {
    throw new HttpsError('failed-precondition', 'Ese profesional no realiza el servicio elegido.');
  }

  // ── El turno tiene que caer dentro del horario ────────────────────────────
  const dow = diaDeLaSemana(appointmentDate);
  const inicio = timeToMinutes(startTime);
  const fin = inicio + duracion;

  const horarios = await db.collection(`businesses/${businessId}/schedules`)
    .where('professionalId', '==', professionalId)
    .where('dayOfWeek', '==', dow)
    .limit(1).get();
  const horario = horarios.empty ? null : horarios.docs[0].data();
  if (!horario || horario.isActive === false || !horario.startTime || !horario.endTime) {
    throw new HttpsError('failed-precondition', 'El profesional no trabaja ese día.');
  }

  let desde = timeToMinutes(horario.startTime);
  let hasta = timeToMinutes(horario.endTime);

  // El horario del negocio recorta el del profesional, igual que en el motor
  // del front.
  const diaNegocio = (negocio.businessHours || []).find((b) => b.dayOfWeek === dow);
  if (diaNegocio) {
    if (diaNegocio.isActive === false) {
      throw new HttpsError('failed-precondition', 'La barbería no abre ese día.');
    }
    if (diaNegocio.startTime && diaNegocio.endTime) {
      desde = Math.max(desde, timeToMinutes(diaNegocio.startTime));
      hasta = Math.min(hasta, timeToMinutes(diaNegocio.endTime));
    }
  }

  // Alcanza con que EMPIECE dentro del horario (del barbero y del local): el
  // último turno puede terminar después del cierre, como pasa en el mostrador.
  if (inicio < desde || inicio >= hasta) {
    throw new HttpsError('failed-precondition', 'Ese horario está fuera del horario de atención.');
  }

  // Promo por día y franja del servicio (utils/ventanaServicio.js en el front,
  // misma regla acá, que es donde vale). `dias` en 0=Lunes … 6=Domingo.
  const ventana = servicio.ventana || null;
  if (ventana) {
    const dow = diaDeLaSemana(appointmentDate);
    if (Array.isArray(ventana.dias) && ventana.dias.length > 0 && !ventana.dias.includes(dow)) {
      throw new HttpsError('failed-precondition', `${servicio.name || 'Ese servicio'} no se ofrece ese día.`);
    }
    if (ventana.desde && ventana.hasta) {
      if (inicio < timeToMinutes(ventana.desde) || inicio >= timeToMinutes(ventana.hasta)) {
        throw new HttpsError('failed-precondition', `${servicio.name || 'Ese servicio'} se ofrece solo de ${ventana.desde} a ${ventana.hasta}.`);
      }
    }
  }

  if (horario.breakStart && horario.breakEnd) {
    const dStart = timeToMinutes(horario.breakStart), dEnd = timeToMinutes(horario.breakEnd);
    if (inicio < dEnd && fin > dStart) {
      throw new HttpsError('failed-precondition', 'Ese horario cae en el descanso del profesional.');
    }
  }
  // Horario cortado del local: en ese rato no se atiende, trabaje quien trabaje.
  if (diaNegocio?.breakStart && diaNegocio?.breakEnd) {
    const cStart = timeToMinutes(diaNegocio.breakStart), cEnd = timeToMinutes(diaNegocio.breakEnd);
    if (inicio < cEnd && fin > cStart) {
      throw new HttpsError('failed-precondition', `La barbería cierra de ${diaNegocio.breakStart} a ${diaNegocio.breakEnd}.`);
    }
  }

  // ── ¿Cobra seña? ──────────────────────────────────────────────────────────
  // Solo si el dueño conectó su Mercado Pago Y la activó con un monto. Si
  // conectó pero no la activó, se reserva como siempre.
  // ── ¿Cómo paga? ───────────────────────────────────────────────────────────
  // Tres caminos: dejar la seña, pagar el turno entero ahora, o pagar en el
  // local. Qué está habilitado lo decide la barbería; cuál de esos usa, el
  // cliente (salvo que la seña sea obligatoria).
  const sena = negocio.sena || {};
  const cobraOnline = negocio.mpConectado === true && sena.activa === true && Number(sena.monto) > 0;
  // 'opcional' existe porque hay clientes sin Mercado Pago o sin plata en la
  // cuenta: una barbería no puede perder a esa persona por cómo prefiere pagar.
  const senaOpcional = sena.modo === 'opcional';
  const permiteTotal = sena.permiteTotal === true;

  const pedido = String(request.data?.pagar || (request.data?.pagarSena === false ? 'local' : 'sena'));
  let tipoPago = null;
  if (cobraOnline) {
    if (pedido === 'total' && permiteTotal) tipoPago = 'total';
    else if (pedido === 'local' && senaOpcional) tipoPago = null;
    else tipoPago = 'sena';
  }

  // La seña se decide recién adentro de la transacción, porque depende del
  // precio FINAL y el descuento se resuelve ahí. Lo que se sabe acá es si la
  // barbería cobra online y de qué forma; cuánto, después.
  let pideSena = tipoPago !== null;
  let montoSena = 0;
  // El snapshot que va a quedar guardado en el turno. Se completa adentro de la
  // transacción; si no hay cupón, queda así.
  let cobro = { precioLista: precio, descuento: 0, precioFinal: precio, cuponCodigo: null, cuponId: null };
  // El beneficio de la membresía, si el cliente la usó. Se completa adentro.
  let membresiaAplicada = null;

  // ── Solapamiento, en transacción ──────────────────────────────────────────
  // Va en transacción y no en un get suelto porque dos personas mirando la
  // misma grilla pueden apretar "confirmar" con milisegundos de diferencia: sin
  // esto, los dos leen "libre" y los dos escriben.
  const agenda = db.collection(`businesses/${businessId}/appointments`);
  const ref = agenda.doc();

  // El tipo de pago que PIDIÓ el cliente. Inmutable: lo que se decide adentro
  // de la transacción puede recortarlo (un turno gratis no se cobra), y eso se
  // recalcula en cada intento.
  const tipoPagoPedido = tipoPago;

  await db.runTransaction(async (tx) => {
    // Firestore REINTENTA la transacción cuando hay contención, y el callback
    // vuelve a correr entero. Todo lo que se escribe en las variables de
    // afuera tiene que volver a cero acá adentro, o el segundo intento arranca
    // con los valores del primero.
    //
    // No es teórico: lo encontró la prueba de los tres clientes peleando por
    // el último uso de un cupón. El primero se lo llevaba, los otros dos
    // reintentaban, veían el cupón agotado —y por eso NO se les escribía el
    // uso, que es lo correcto— pero `cobro` todavía tenía el precio con
    // descuento del intento anterior, así que el turno se guardaba a precio
    // de promoción sin haber consumido nada. Un cupón de un uso descontándole
    // a todo el mundo, sin dejar rastro.
    cobro = { precioLista: precio, descuento: 0, precioFinal: precio, cuponCodigo: null, cuponId: null };
    membresiaAplicada = null;
    tipoPago = tipoPagoPedido;
    montoSena = 0;
    pideSena = tipoPago !== null;

    // Los turnos de este cliente en esta barbería, todos, en una sola lectura.
    // Se filtran en memoria en vez de con dos queries por rango porque un
    // where por userId + rango de fecha exigiría un índice compuesto, que el
    // emulador no pide y producción sí: pasaría todas las suites y fallaría
    // recién con el primer cliente real. Un cliente asiduo junta ~50 turnos
    // al año; leerlos es barato.
    const propios = await tx.get(agenda.where('userId', '==', request.auth.uid));
    const activos = propios.docs
      .map((d) => d.data())
      .filter(reservaViva);

    // Un turno activo por cliente por día en esta barbería. El front también lo
    // mira (hasAppointmentToday), pero eso se saltea con la consola abierta —
    // y de hecho estuvo roto un tiempo porque la lista de turnos del cliente
    // llegaba vacía. Acá es donde tiene que valer.
    if (activos.some((a) => a.appointmentDate === appointmentDate)) {
      throw new HttpsError('already-exists', 'Ya tenés un turno ese día. Si querés cambiarlo, cancelá el anterior primero.');
    }

    // Y un tope de turnos a futuro por cuenta. Sin esto, la regla de uno por
    // día no frena a nadie: con una sola cuenta se le llena al barbero la
    // agenda de los próximos 30 días sin ninguna intención de ir. Tres es lo
    // que necesita un cliente real (el de esta semana, el de la que viene y
    // uno más) y lo que hace inútil el abuso.
    const hoy = hoyEnArgentina();
    const aFuturo = activos.filter((a) => a.appointmentDate >= hoy).length;
    if (aFuturo >= MAX_TURNOS_ACTIVOS) {
      throw new HttpsError(
        'resource-exhausted',
        `Ya tenés ${MAX_TURNOS_ACTIVOS} turnos reservados. Cuando pase alguno, o si cancelás uno, podés reservar otro.`
      );
    }

    const delDia = await tx.get(
      agenda.where('appointmentDate', '==', appointmentDate)
            .where('professionalId', '==', professionalId)
    );

    // ── El cupón ────────────────────────────────────────────────────────────
    // Acá adentro y no antes: dos clientes peleando por el último uso leen el
    // mismo contador si se chequea afuera, y los dos pasan. La transacción es
    // lo único que hace que el tope sea un tope.
    //
    // Y se recalcula TODO: existencia, estado, vigencia, servicio, profesional,
    // primera visita, topes y el descuento sobre el precio del documento del
    // servicio. Lo que mandó el browser es, como mucho, el código.
    let cuponRef = null;
    let esClienteNuevo = false;

    // ── La membresía ────────────────────────────────────────────────────────
    // Misma razón que el cupón para ir acá adentro: dos reservas por el último
    // uso del mes leen el mismo contador, y la transacción hace que pase una.
    // Si no corresponde (no activa, servicio no incluido, sin usos, fecha
    // fuera del mes pago) SÍ rompe la reserva, con el motivo: el cliente eligió
    // no pagar, y reservarle a precio de lista sin avisar sería cobrarle algo
    // que no aceptó.
    let usoMembresia = null;
    if (usarMembresia === true) {
      usoMembresia = await membresias.prepararUso(tx, {
        cuentaId: negocio.grupoId || businessId,
        sucursalId: businessId,
        serviceId,
        appointmentDate,
        clienteUid: request.auth.uid,
        // Solo con el mail verificado: es lo que ata una membresía cargada
        // antes de que el cliente entrara por primera vez.
        clienteEmail: request.auth.token.email_verified === true
          ? membresias.normalizarEmail(request.auth.token.email) : null,
      });
    }

    if (cuponCodigo && !usoMembresia) {
      const leido = await leerContextoDelCupon({
        tx, businessId, codigo: cuponCodigo, uid: request.auth.uid,
        // La agenda de este cliente ya se leyó arriba, para el tope de turnos.
        turnosPrevios: propios.docs.some((d) => ESTADOS_DE_CLIENTE.includes(d.get('status'))),
      });
      const r = cupones.aplicarCupon(leido.cupon, precio, {
        ...leido.ctx, serviceId, professionalId,
      });

      // Un cupón que dejó de servir NO rompe la reserva: se sigue sin él y el
      // cliente paga el precio de lista. Romper acá sería lo peor: el cliente
      // ya eligió horario, ya entró con Google, y lo perdemos por un código.
      if (r.aplica) {
        cuponRef = leido.ref;
        esClienteNuevo = !leido.ctx.tieneTurnosPrevios;
        cobro = {
          precioLista: precio,
          descuento: r.descuento,
          precioFinal: r.precioFinal,
          cuponCodigo: leido.cupon.codigo,
          cuponId: leido.cupon.id,
        };
      } else {
        logger.info('cupón no aplicado al reservar', {
          businessId, uid: request.auth.uid, motivo: r.motivo,
        });
      }
    }

    // La seña sale del precio FINAL, nunca del de lista. Con el fijo hace falta
    // el recorte: una seña de $5.000 sobre un corte de $15.000 con 80% OFF
    // serían $5.000 de seña por un turno de $3.000 — se le estaría cobrando de
    // más por adelantado. Y con el precio en cero no hay nada que cobrar
    // online: el cupón ya pagó el turno.
    // Con membresía no se cobra nada en el turno: ni seña ni total. El precio
    // que cuenta en la caja es cero; el valor del servicio queda en el
    // snapshot de la membresía (para "cuánto se consumió por membresías").
    if (usoMembresia) cobro = { precioLista: precio, descuento: 0, precioFinal: 0, cuponCodigo: null, cuponId: null };
    montoSena = tipoPago === 'total' ? cobro.precioFinal : Math.min(Number(sena.monto) || 0, cobro.precioFinal);
    if (!(montoSena > 0)) { tipoPago = null; montoSena = 0; }
    pideSena = tipoPago !== null;

    for (const d of delDia.docs) {
      const a = d.data();
      if (!reservaViva(a)) continue;
      const aIni = timeToMinutes(a.startTime);
      const aFin = a.endTime ? timeToMinutes(a.endTime) : aIni;
      if (inicio < aFin && fin > aIni) {
        throw new HttpsError('already-exists', 'Ese horario ya fue tomado. Elegí otro.');
      }
    }

    const membresia = usoMembresia ? membresias.escribirUso(tx, usoMembresia, {
      cuentaId: negocio.grupoId || businessId,
      appointmentId: ref.id,
      sucursalId: businessId,
      professionalId,
      serviceId,
      serviceName: servicio.name || '',
      valorServicio: precio,
      appointmentDate,
      origen: 'reserva',
      registradoPor: { uid: request.auth.uid, rol: 'cliente' },
    }) : null;
    membresiaAplicada = membresia;

    tx.set(ref, {
      id: ref.id,
      businessId,
      userId: request.auth.uid,
      professionalId,
      serviceId,
      appointmentDate,
      startTime,
      endTime: minutesToTime(fin),
      // El precio que se cobra: el final, ya con el descuento. El campo se
      // llama `price` desde siempre y lo lee todo —la agenda, los ingresos del
      // mes, las estadísticas—, así que es el que tiene que valer. El de lista
      // queda al lado, para poder mostrar el tachado.
      price: cobro.precioFinal,
      // Snapshot del cobro. Es una COPIA histórica a propósito: que el cupón
      // después venza, se apague o cambie de valor no puede tocar un turno ya
      // hecho. Sin esto, el informe de ingresos del mes pasado cambiaría solo.
      ...(cobro.cuponCodigo ? {
        precioLista: cobro.precioLista,
        descuento: cobro.descuento,
        cuponCodigo: cobro.cuponCodigo,
        cuponId: cobro.cuponId,
      } : {}),
      // Snapshot del beneficio aplicado. Lo escribe SOLO el servidor: las Rules
      // rechazan cualquier escritura del browser que toque este campo.
      ...(membresia ? { membresia, precioLista: precio } : {}),
      durationMinutes: duracion,
      serviceName: servicio.name || '',
      clientName: String(clientName).slice(0, 120),
      clientPhone: String(clientPhone).slice(0, 40),
      // Del token, no del cliente: que no se registre un turno con el mail de otro.
      clientEmail: String(request.auth.token.email || clientEmail || '').slice(0, 120),
      notes: String(notes).slice(0, 500),
      // Con seña, el turno NO nace reservado: nace guardado mientras el cliente
      // paga, y se confirma cuando Mercado Pago avisa. Si no paga, vence.
      status: pideSena ? 'esperando_pago' : 'pendiente',
      ...(pideSena ? {
        // `tipo` distingue la seña del turno pagado entero: cambia lo que ve el
        // barbero en la agenda (si le queda algo por cobrar o no).
        sena: { monto: montoSena, estado: 'pendiente', tipo: tipoPago },
        senaExpiraEn: new Date(Date.now() + MINUTOS_PARA_PAGAR * 60000),
      } : {}),
      // Reservado por el cliente desde el link. Los que carga el staff llevan
      // type 'manual' o 'walkin'. Sirve para que el barbero sepa, de un
      // vistazo, cuál entró solo y cuál cargó él.
      origen: 'cliente',
      createdAt: FieldValue.serverTimestamp(),
    });

    if (cuponRef) {
      // Un documento por uso, con el id del turno. Mismo truco que las reseñas:
      // Firestore no deja dos documentos con el mismo id, así que el mismo
      // turno no puede contarse dos veces por más que algo se reintente.
      tx.set(cuponRef.collection('usos').doc(ref.id), {
        appointmentId: ref.id,
        userId: request.auth.uid,
        estado: 'reservado',
        precioLista: cobro.precioLista,
        descuento: cobro.descuento,
        precioFinal: cobro.precioFinal,
        esClienteNuevo,
        creadoEn: FieldValue.serverTimestamp(),
      });
      // `usos` cuenta los RESERVADOS: entre que alguien saca el turno y lo paga
      // pasan 15 minutos, y en ese rato el lugar está tomado. Los confirmados y
      // la plata se cuentan aparte, cuando el turno se concreta.
      tx.update(cuponRef, { usos: FieldValue.increment(1) });
    }
  });

  // Rastro de la reserva. Cuando una barbería dice "el cliente mostró el turno
  // confirmado y a mí no me aparece", esto contesta en un minuto si la reserva
  // llegó al servidor, a qué negocio fue y con qué barbero. Sin nombres ni
  // teléfonos: para eso está el documento.
  logger.info('turno creado', {
    businessId, professionalId, serviceId,
    appointmentDate, startTime, endTime: minutesToTime(fin),
    appointmentId: ref.id, uid: request.auth.uid,
  });

  if (pideSena) {
    try {
      const pago = await mp.crearPagoDeSena({
        businessId,
        appointmentId: ref.id,
        monto: montoSena,
        titulo: `${tipoPago === 'total' ? 'Turno' : 'Seña'} · ${servicio.name || 'Turno'} · ${appointmentDate} ${startTime}`,
        emailCliente: String(request.auth.token.email || ''),
        slug: negocio.slug || '',
      });
      await ref.update({ 'sena.preferenceId': pago.preferenceId });
      return {
        status: 'esperando_pago',
        id: ref.id,
        price: cobro.precioFinal,
        ...cobro,
        endTime: minutesToTime(fin),
        sena: montoSena,
        tipoPago,
        minutos: MINUTOS_PARA_PAGAR,
        pagoUrl: pago.url,
      };
    } catch (err) {
      // Si no se pudo armar el pago, el turno guardado no sirve para nada y le
      // estaría bloqueando el horario a otro: se cancela en el acto.
      logger.error('no se pudo crear el pago de la seña', { businessId, appointmentId: ref.id, error: err.message });
      await ref.update({ status: 'cancelada', cancelledBy: 'sistema', cancellationReason: 'No se pudo generar el pago' }).catch(() => {});
      throw new HttpsError('unavailable', 'No pudimos abrir el pago de la seña. Probá de nuevo en un momento.');
    }
  }

  return { status: 'created', id: ref.id, price: cobro.precioFinal, ...cobro, membresia: membresiaAplicada, endTime: minutesToTime(fin) };
});

/**
 * Horarios ocupados de un profesional en un día: solo `startTime` y `endTime`
 * de los turnos activos, nada más.
 *
 * Por qué existe: la grilla de reserva se pinta en el browser con
 * availabilityEngine, que necesita saber qué está tomado. Antes el cliente
 * leía la agenda entera del negocio para eso, y eso era una filtración: se
 * llevaba nombre, teléfono y email de todos los demás clientes. Al cerrarla
 * en las Rules, el cliente quedó viendo solo sus propios turnos y la grilla
 * mostraba como libres los horarios de todo el resto — cada reserva terminaba
 * en "ese horario ya fue tomado". Esta función le da a la grilla lo que
 * necesita y ni un campo más. La transacción de createAppointment sigue
 * siendo la que decide.
 */
exports.getBusySlots = onCall(async (request) => {
  // Sin exigir sesión: la grilla se mira antes de entrar (el login se pide
  // recién al confirmar), y la respuesta no tiene ningún dato de nadie.
  const { businessId, professionalId, appointmentDate } = request.data || {};
  if (!businessId || !professionalId || !appointmentDate) {
    throw new HttpsError('invalid-argument', 'Faltan datos.');
  }
  if (!FORMATO_FECHA.test(appointmentDate)) {
    throw new HttpsError('invalid-argument', 'Fecha con formato inválido.');
  }

  const snap = await db.collection(`businesses/${businessId}/appointments`)
    .where('appointmentDate', '==', appointmentDate)
    .where('professionalId', '==', professionalId)
    .get();

  const ocupados = snap.docs
    .map((d) => d.data())
    .filter(reservaViva)
    .map((a) => ({ startTime: a.startTime, endTime: a.endTime || a.startTime }));

  return { ocupados };
});

// ============================================================================
// 4b. NOTIFICACIONES AL STAFF
// ============================================================================
// Cuando entra un turno nuevo (o un cliente cancela), la barbería se entera
// por la campanita del panel. Se escribe desde acá, con un trigger, y no
// desde el browser: el cliente no tiene permiso de escribir en
// /notifications (y no debería tenerlo), y así también cubre los turnos que
// entran por cualquier camino.
//
// Por ahora es solo in-app. Cuando Meta apruebe WhatsApp, el mismo trigger
// manda el mensaje: el punto de entrada ya está.

function fechaLinda(fechaISO) {
  const d = new Date(`${fechaISO}T12:00:00Z`);
  const dias = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  return `${dias[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
}

async function notificar(bizId, datos) {
  const ref = db.collection(`businesses/${bizId}/notifications`).doc();
  await ref.set({
    id: ref.id,
    leidaPor: {},
    createdAt: FieldValue.serverTimestamp(),
    ...datos,
  });
  await enviarPush(bizId, { ...datos, notificationId: ref.id });
}

/**
 * Push a los teléfonos registrados: los del dueño siempre, y los del barbero
 * al que le toca el turno. Mensaje de DATOS (sin bloque `notification`), para
 * que el service worker decida cómo mostrarlo y la app en primer plano no lo
 * duplique con la campanita.
 *
 * Los tokens que FCM da por muertos (app desinstalada, permiso revocado) se
 * borran acá mismo; si no, la lista crece para siempre.
 */
/**
 * Arma el mensaje de push.
 *
 * Lleva `notification` ADEMÁS de `data`, y ese es el punto: con un mensaje de
 * solo datos, el aviso lo tiene que dibujar nuestro service worker, y si por lo
 * que sea no corre —falló el importScripts, el navegador no lo despertó— el
 * push llega y no se ve nada. Con `notification`, lo muestra el navegador solo.
 * Nuestro código pasa a ser el respaldo y no el único camino.
 *
 * `data` se mantiene porque de ahí salen el link y el id para no duplicar.
 */
/**
 * ¿El token está muerto de verdad?
 *
 * Antes también se borraba con `invalid-argument`, y ese código lo devuelve
 * FCM cuando el MENSAJE está mal armado, no el teléfono. Con un mensaje
 * inválido, un solo envío le borraba el registro a todo el equipo y nadie
 * volvía a recibir nada hasta activarlo de nuevo a mano.
 */
function tokenMuerto(code) {
  return String(code).includes('registration-token-not-registered')
      || String(code).includes('invalid-registration-token');
}

// FCM exige HTTPS en `webpush.fcm_options.link`. Le veníamos mandando una ruta
// relativa ('/admin/citas'), que es motivo de rechazo del mensaje entero.
const SITIO = process.env.SITIO_URL || 'https://barberos.sacia.tech';

function mensajePush(datos, urlPorDefecto) {
  const ruta = String(datos.url || urlPorDefecto);
  const url = ruta.startsWith('http') ? ruta : SITIO + (ruta.startsWith('/') ? ruta : `/${ruta}`);
  const title = String(datos.title || 'BarberOS');
  const body = String(datos.body || '');
  const notificationId = String(datos.notificationId || '');
  return {
    data: { title, body, type: String(datos.type || ''), notificationId, url },
    notification: { title, body },
    webpush: {
      headers: { Urgency: 'high', TTL: '86400' },
      // `tag` con el id del aviso: si el mismo llega dos veces (el navegador y
      // nuestro handler), la segunda reemplaza a la primera en vez de sumar.
      notification: {
        title,
        body,
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-72.png',
        tag: notificationId || undefined,
        vibrate: [120, 60, 120],
        data: { url },
      },
      fcmOptions: { link: url },
    },
  };
}

async function enviarPush(bizId, datos) {
  const snap = await db.collection(`businesses/${bizId}/devices`).get();
  if (snap.empty) return;

  const destinatarios = snap.docs.filter((d) => {
    const dev = d.data();
    if (dev.role === 'owner') return true;
    return dev.professionalId && dev.professionalId === datos.professionalId;
  });
  if (!destinatarios.length) return;

  const tokens = destinatarios.map((d) => d.id);
  const mensaje = { tokens, ...mensajePush(datos, '/admin/citas') };

  let res;
  try {
    res = await getMessaging().sendEachForMulticast(mensaje);
  } catch (err) {
    console.error('[push] No se pudo enviar:', err.message);
    return;
  }

  const muertos = [];
  const fallas = [];
  res.responses.forEach((r, i) => {
    if (r.success) return;
    const code = r.error?.code || 'desconocido';
    fallas.push(code);
    if (tokenMuerto(code)) muertos.push(tokens[i]);
  });
  if (fallas.length) {
    logger.warn('push con fallas', { bizId, enviados: res.successCount, fallidos: res.failureCount, codigos: fallas, borrados: muertos.length });
  }
  await Promise.all(muertos.map((t) => db.doc(`businesses/${bizId}/devices/${t}`).delete().catch(() => {})));
}

/**
 * Manda un push de prueba a los teléfonos de QUIEN llama, y devuelve cuántos
 * salieron y cuántos fallaron.
 *
 * Es la única forma honesta de contestar "¿les están llegando los avisos?":
 * el envío puede fallar por un token muerto, por el permiso revocado en el
 * teléfono o porque nunca se activó, y desde afuera todo se ve igual.
 */
// ============================================================================
// Alta sola: el barbero se crea la cuenta de prueba sin esperar a nadie
// ============================================================================
// Hasta acá las cuentas las dábamos de alta nosotros, una por una. El que
// entraba a curiosear un sábado a la noche se encontraba con "escribinos por
// WhatsApp" y se perdía. Esto le deja la barbería andando en un minuto, con
// DIAS_DE_PRUEBA días; después la corta la facturación sola, por el mismo
// camino que cualquier cuenta impaga.
//
// Es la única puerta por la que alguien de afuera crea datos en la plataforma,
// así que tiene cuatro cerrojos:
//   1. sesión con mail verificado (Google lo verifica; el alta por contraseña
//      la hacemos nosotros y nace verificada);
//   2. una barbería por cuenta: si ya tiene claims, no pasa;
//   3. el slug se toma en una transacción, con formato y lista de reservados;
//   4. un tope de altas por día, para que un script no llene la base.

const DIAS_DE_PRUEBA = 5;
const ALTAS_POR_DIA = 40;
const SLUGS_RESERVADOS = ['login', 'admin', 'super-admin', 'confirmacion', 'mis-citas', 'cuenta', 'crear-barberia'];

const HORARIO_POR_DEFECTO = [
  { dayOfWeek: 0, startTime: '09:00', endTime: '20:00', isActive: true },
  { dayOfWeek: 1, startTime: '09:00', endTime: '20:00', isActive: true },
  { dayOfWeek: 2, startTime: '09:00', endTime: '20:00', isActive: true },
  { dayOfWeek: 3, startTime: '09:00', endTime: '20:00', isActive: true },
  { dayOfWeek: 4, startTime: '09:00', endTime: '20:00', isActive: true },
  { dayOfWeek: 5, startTime: '09:00', endTime: '18:00', isActive: true },
  { dayOfWeek: 6, startTime: '', endTime: '', isActive: false },
];

// Con qué arranca la cuenta. Un panel vacío no se entiende: el dueño entra,
// ve su propio perfil, tres servicios típicos y el link ya funcionando.
const SERVICIOS_INICIALES = [
  { name: 'Corte de cabello', price: 12000, durationMinutes: 30 },
  { name: 'Corte + barba', price: 16000, durationMinutes: 45 },
  { name: 'Barba', price: 7000, durationMinutes: 20 },
];

/**
 * La fecha de dentro de N días, en Buenos Aires.
 *
 * Con `toISOString()` esto daba un día de más: después de las 21:00 en
 * Argentina, en UTC ya es mañana. La cuenta prometía 5 días de prueba y el
 * panel mostraba 6.
 */
function enDiasISO(dias) {
  const [a, m, d] = hoyEnArgentina().split('-').map(Number);
  // Mediodía UTC para que sumar días no cruce husos por un par de horas.
  const base = new Date(Date.UTC(a, m - 1, d, 12));
  base.setUTCDate(base.getUTCDate() + dias);
  return base.toISOString().slice(0, 10);
}

function limpiar(texto, largo) {
  return String(texto || '').trim().slice(0, largo);
}

exports.crearBarberiaDePrueba = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Entrá con tu cuenta para crear la barbería.');
  if (request.auth.token.email_verified !== true) {
    throw new HttpsError('failed-precondition', 'Necesitamos un mail verificado. Entrá con Google.');
  }

  const claims = request.auth.token || {};
  if (claims.businessId || claims.platform) {
    throw new HttpsError('failed-precondition', 'Esta cuenta ya tiene un panel asignado.');
  }
  // Y de nuevo contra la fuente real: el token dura hasta una hora, así que el
  // de ANTES del alta sigue diciendo "sin barbería". Con solo mirar el token,
  // la misma cuenta se creaba una barbería atrás de otra (visto en el
  // emulador). Los claims del usuario, en cambio, ya están escritos.
  const cuenta = await getAuth().getUser(request.auth.uid);
  const claimsReales = cuenta.customClaims || {};
  if (claimsReales.businessId || claimsReales.platform) {
    throw new HttpsError('failed-precondition', 'Esta cuenta ya tiene una barbería.');
  }

  const nombre = limpiar(request.data?.nombre, 60);
  const slug = limpiar(request.data?.slug, 30).toLowerCase();
  const telefono = limpiar(request.data?.telefono, 40);
  const ciudad = limpiar(request.data?.ciudad, 60);
  const nombreDueno = limpiar(request.data?.nombreDueno, 60);

  if (nombre.length < 2) throw new HttpsError('invalid-argument', 'Poné el nombre de la barbería.');
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(slug) || slug.length < 3) {
    throw new HttpsError('invalid-argument', 'El link solo puede tener letras, números y guiones (mínimo 3).');
  }
  if (SLUGS_RESERVADOS.includes(slug)) {
    throw new HttpsError('already-exists', 'Ese link está reservado por el sistema. Probá con otro.');
  }
  const soloNumeros = telefono.replace(/\D/g, '');
  if (soloNumeros.length < 8 || soloNumeros.length > 15) {
    throw new HttpsError('invalid-argument', 'Poné un teléfono de contacto válido.');
  }

  // Tope diario de altas: si algo se desmadra, se frena solo y avisa, en vez de
  // que nos enteremos por la factura de Firebase.
  const desde = new Date(Date.now() - 24 * 3600 * 1000);
  const ultimas = await db.collection('businesses')
    .where('createdAt', '>=', desde)
    .count().get()
    .catch(() => null);
  if (ultimas && ultimas.data().count >= ALTAS_POR_DIA) {
    logger.error('tope diario de altas alcanzado', { intento: slug });
    await notificarPlataforma({
      type: 'alta_nueva',
      title: 'Tope de altas alcanzado',
      body: 'Se frenaron las altas automáticas por las últimas 24 h. Revisá si es real o alguien está probando.',
      url: '/super-admin',
    }).catch(() => {});
    throw new HttpsError('resource-exhausted', 'Estamos recibiendo muchas altas juntas. Escribinos y te la activamos a mano.');
  }

  const email = String(request.auth.token.email || '').toLowerCase();
  const businessRef = db.collection('businesses').doc();
  const businessId = businessRef.id;
  const finPrueba = enDiasISO(DIAS_DE_PRUEBA);
  // La cuenta nace en el Básico de la escalera nueva: una barbería, un barbero
  // (el dueño, que es el que se carga solo acá abajo). Si quiere sumar equipo,
  // el panel se lo dice y le deja el botón para escribir — que es justo el
  // momento de hablar del plan.
  //
  // El abono NO puede ser 0: runBilling suma `monthlyFee` a la deuda y congela
  // cuando la deuda es mayor a cero, así que con 0 la cuenta de prueba quedaría
  // gratis para siempre y la prueba no cortaría nunca. Sale de la tabla de
  // planes (hoy, $15.000), así que si cambia el precio del Básico cambia acá
  // solo.
  const plan = camposDelPlan('basico');

  // El slug se toma en una transacción: dos personas eligiendo el mismo nombre
  // al mismo tiempo no pueden quedarse las dos con el link.
  const slugRef = db.doc(`slugs/${slug}`);
  await db.runTransaction(async (tx) => {
    const tomado = await tx.get(slugRef);
    if (tomado.exists) {
      throw new HttpsError('already-exists', 'Ese link ya está ocupado. Probá con otro.');
    }
    tx.set(slugRef, { businessId });
    tx.set(businessRef, {
      id: businessId,
      name: nombre,
      slug,
      logoUrl: null,
      primaryColor: '#E85D2A',
      secondaryColor: '#1A1A1A',
      accentColor: '#E85D2A',
      phone: telefono,
      email,
      address: '',
      city: ciudad,
      country: 'Argentina',
      currency: 'ARS',
      timezone: 'America/Argentina/Buenos_Aires',
      slotInterval: 30,
      minCancelHours: 2,
      onlineBookingEnabled: true,
      welcomeMessage: '',
      socialLinks: { instagram: '', whatsapp: telefono },
      planId: plan.planId,
      whatsappQuota: plan.whatsappQuota,
      maxBarbers: plan.maxBarbers,
      maxSucursales: plan.maxSucursales,
      capacidades: plan.capacidades,
      // Sin grupo: es una barbería sola. El campo existe desde el alta para que
      // una consulta por `grupoId` no dependa de si la clave está o no.
      grupoId: null,
      isFrozen: false,
      trialEndsAt: finPrueba,
      // De dónde salió la cuenta: las que se dan de alta solas se miran
      // distinto en el panel global.
      origen: 'autoservicio',
      businessHours: HORARIO_POR_DEFECTO.map((h) => ({ ...h })),
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  // Facturación: el primer vencimiento es el día que termina la prueba, así
  // runBilling la cobra (y la congela) sola al día siguiente.
  const lote = db.batch();
  lote.set(db.doc(`businesses/${businessId}/private/billing`), {
    planId: plan.planId,
    monthlyFee: plan.monthlyFee,
    debt: 0,
    lastPaymentDate: null,
    nextBillingDate: finPrueba,
  });
  lote.set(db.doc(`businesses/${businessId}/admins/${email}`), {
    email,
    name: nombreDueno || nombre,
    role: 'owner',
    businessId,
    professionalId: null,
    addedAt: FieldValue.serverTimestamp(),
  });

  // Para que el link público funcione desde el minuto uno: el dueño como
  // profesional, con horario, y unos servicios para editar.
  const profRef = db.collection(`businesses/${businessId}/professionals`).doc();
  lote.set(profRef, {
    id: profRef.id,
    name: nombreDueno || nombre,
    specialty: '',
    bio: '',
    avatarUrl: null,
    displayOrder: 1,
    isActive: true,
  });
  HORARIO_POR_DEFECTO.forEach((h) => {
    const ref = db.collection(`businesses/${businessId}/schedules`).doc();
    lote.set(ref, { id: ref.id, professionalId: profRef.id, ...h, breakStart: null, breakEnd: null });
  });
  SERVICIOS_INICIALES.forEach((s, i) => {
    const ref = db.collection(`businesses/${businessId}/services`).doc();
    lote.set(ref, { id: ref.id, ...s, description: '', isActive: true, displayOrder: i + 1 });
    const psRef = db.collection(`businesses/${businessId}/professionalServices`).doc();
    lote.set(psRef, { id: psRef.id, professionalId: profRef.id, serviceId: ref.id });
  });
  await lote.commit();

  // El permiso de verdad: sin esto entra y no ve nada.
  // Acá NO se cortan las sesiones a propósito: la persona está en la pantalla
  // esperando, y revocarle el token la echaría justo al crear su cuenta. El
  // front pide un token nuevo (refreshClaims) y entra derecho al panel.
  await getAuth().setCustomUserClaims(request.auth.uid, { businessId, role: 'owner', professionalId: null });

  logger.info('alta de prueba', { businessId, slug, email });
  await notificarPlataforma({
    type: 'alta_nueva',
    title: 'Barbería nueva',
    body: `${nombre} (${email}) se dio de alta sola. Prueba hasta el ${finPrueba}.`,
    url: '/super-admin',
  }).catch((err) => logger.warn('no se pudo avisar del alta', { error: err.message }));

  return { businessId, slug, trialEndsAt: finPrueba, diasDePrueba: DIAS_DE_PRUEBA };
});

// ============================================================================
// ALTA DE BARBEROS (tope del plan)
// ============================================================================

/**
 * Crea un profesional respetando el tope de barberos del plan.
 *
 * Por qué del lado del servidor: las Security Rules no pueden CONTAR documentos,
 * así que el tope no se puede expresar ahí. Si viviera solo en la interfaz —que
 * es donde estuvo hasta ahora— cualquiera con la consola abierta se agrega los
 * barberos que quiera, y la cantidad de barberos es exactamente lo que separa
 * un plan de otro. Las Rules dejan de permitir el `create` directo al dueño: lo
 * único que puede crear profesionales es esta función (y la plataforma, que
 * prepara cuentas).
 *
 * Se cuentan solo los ACTIVOS: desactivar a alguien que se fue libera el lugar.
 */
exports.crearProfesional = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Tenés que iniciar sesión.');

  const token = request.auth.token || {};
  const businessId = String(request.data?.businessId || '').trim();
  if (!businessId) throw new HttpsError('invalid-argument', 'Falta el id de la barbería.');

  const esPlataforma = token.platform === true;
  if (!esPlataforma) {
    const propias = Array.isArray(token.businessIds) ? token.businessIds : [token.businessId];
    if (token.role !== 'owner' || !propias.includes(businessId)) {
      throw new HttpsError('permission-denied', 'Solo el dueño de la barbería puede agregar barberos.');
    }
  }

  const snap = await db.doc(`businesses/${businessId}`).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Esa barbería no existe.');
  const biz = snap.data();

  const datos = request.data?.datos || {};
  const nombre = limpiar(datos.name, 60);
  if (nombre.length < 2) throw new HttpsError('invalid-argument', 'Poné el nombre del barbero.');

  const { maxBarbers } = limitesDelNegocio(biz);
  if (maxBarbers !== null) {
    const activos = (await db.collection(`businesses/${businessId}/professionals`).get())
      .docs.filter((d) => d.get('isActive') !== false).length;
    if (activos >= maxBarbers) {
      throw new HttpsError(
        'failed-precondition',
        maxBarbers === 1
          ? 'Tu plan incluye un solo barbero. Para sumar equipo hay que ampliar el plan.'
          : `Tu plan incluye hasta ${maxBarbers} barberos y ya los tenés cargados.`
      );
    }
  }

  // La foto es otra función del plan. Las Rules la frenan también, pero acá se
  // puede decir POR QUÉ en vez de devolver un permission-denied pelado.
  const capacidades = capacidadesDelNegocio(biz);
  let avatarUrl = typeof datos.avatarUrl === 'string' ? datos.avatarUrl : null;
  if (avatarUrl && !capacidades.fotoPerfil) {
    throw new HttpsError('failed-precondition', 'La foto de perfil está disponible desde el Plan Intermedio.');
  }
  if (avatarUrl && avatarUrl.length > 250000) {
    throw new HttpsError('invalid-argument', 'La foto es demasiado grande.');
  }

  const ref = db.collection(`businesses/${businessId}/professionals`).doc();
  await ref.set({
    id: ref.id,
    name: nombre,
    specialty: limpiar(datos.specialty, 60),
    bio: limpiar(datos.bio, 300),
    avatarUrl,
    displayOrder: Number(datos.displayOrder) || 1,
    isActive: true,
  });

  return { id: ref.id };
});

// ============================================================================
// SUCURSALES (Plan Empresarial)
// ============================================================================

/**
 * Le vuelve a escribir los claims a los dueños de un grupo, para que la lista de
 * sucursales que llevan en el token sea la que está en la base.
 *
 * Se llama después de agregar o quitar una sucursal. Mira la subcolección
 * `admins` del principal, que es el registro de quién es dueño; si la persona
 * nunca entró, el permiso queda pendiente igual que en `setBusinessAdmin`.
 *
 * NO corta las sesiones a propósito: el dueño está en la pantalla esperando que
 * la sucursal aparezca, y revocarle el token lo echaría del panel justo ahí. El
 * frontend pide un token nuevo (`refreshClaims`) al volver.
 */
async function sincronizarClaimsDelGrupo(grupoId) {
  const admins = await db.collection(`businesses/${grupoId}/admins`)
    .where('role', '==', 'owner').get();

  const claims = await claimsDeNegocio({ businessId: grupoId, role: 'owner', professionalId: null });
  let aplicados = 0;

  for (const d of admins.docs) {
    const email = d.id;
    try {
      const usuario = await getAuth().getUserByEmail(email);
      await getAuth().setCustomUserClaims(usuario.uid, claims);
      aplicados++;
    } catch (err) {
      if (err.code !== 'auth/user-not-found') throw err;
      // Nunca entró: queda pendiente y se aplica en su primer login.
      await db.doc(`pendingAdmins/${email}`).set({
        businessId: grupoId,
        role: 'owner',
        professionalId: null,
        email,
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  }

  return { aplicados, claims };
}

/**
 * Abre una sucursal nueva dentro de la misma cuenta.
 *
 * Esto NO podía ser una escritura del browser por tres razones, y cada una
 * alcanza sola:
 *
 *   1. El tope de sucursales es plata. Si viviera en la interfaz, con la consola
 *      abierta se abren cuarenta.
 *   2. Crear una barbería es un documento público + el slug + la facturación en
 *      una sola operación. A medias queda una cuenta inutilizable.
 *   3. Los claims solo los escribe el Admin SDK, y sin el claim nuevo el dueño
 *      no ve la sucursal que acaba de crear.
 *
 * La sucursal nace VACÍA de equipo y catálogo, a propósito: son datos de esa
 * sucursal y no del grupo. Lo único que se copia, y solo si lo piden, es la
 * lista de servicios — como punto de partida, en documentos nuevos e
 * independientes. Cambiarle el precio en una no toca a la otra.
 */
exports.crearSucursal = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Tenés que iniciar sesión.');

  const token = request.auth.token || {};
  const esPlataforma = token.platform === true;

  if (!esPlataforma && token.email_verified !== true) {
    throw new HttpsError('failed-precondition', 'Necesitamos un mail verificado. Entrá con Google.');
  }

  // De qué cuenta. El dueño abre sucursales de la suya; la plataforma puede
  // hacerlo por cualquiera, pasando el negocio explícitamente.
  const businessIdPedido = String(request.data?.businessId || '').trim();
  const businessId = esPlataforma
    ? (businessIdPedido || token.businessId || '')
    : (token.businessId || '');

  if (!businessId) {
    // Pasaba de verdad: el dueño de la plataforma no tiene `businessId` en su
    // token (no pertenece a ninguna barbería), así que si el panel no manda cuál
    // es la cuenta, acá no hay forma de adivinarlo. El panel ahora lo manda
    // siempre; el mensaje queda explicando qué falta, no "falta algo".
    throw new HttpsError(
      'invalid-argument',
      'No sabemos a qué cuenta agregarle la sucursal. Entrá al panel de la barbería ' +
      'principal y creala desde ahí.'
    );
  }
  if (!esPlataforma) {
    if (token.role !== 'owner') {
      throw new HttpsError('permission-denied', 'Solo el dueño de la cuenta puede abrir sucursales.');
    }
    // Una sucursal del grupo también vale como punto de partida, pero no la
    // barbería de otro.
    const propias = Array.isArray(token.businessIds) ? token.businessIds : [token.businessId];
    if (businessIdPedido && !propias.includes(businessIdPedido)) {
      throw new HttpsError('permission-denied', 'Esa barbería no es de tu cuenta.');
    }
  }

  const snap = await db.doc(`businesses/${businessId}`).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Esa barbería no existe.');
  const biz = snap.data();

  // El principal del grupo es el que tiene el plan y el que paga. Si la cuenta
  // todavía no es un grupo, el principal es esta misma barbería.
  const grupoId = biz.grupoId || businessId;
  const principalRef = db.doc(`businesses/${grupoId}`);
  const principalSnap = grupoId === businessId ? snap : await principalRef.get();
  if (!principalSnap.exists) throw new HttpsError('not-found', 'No se encontró la barbería principal de la cuenta.');
  const principal = principalSnap.data();

  const { maxSucursales } = limitesDelNegocio(principal);
  if (maxSucursales !== null && maxSucursales <= 1) {
    throw new HttpsError(
      'failed-precondition',
      'Tu plan es de una sola barbería. Con el Plan Empresarial podés tener hasta 4 sucursales.'
    );
  }

  const nombre = limpiar(request.data?.nombre, 60);
  const slug = limpiar(request.data?.slug, 30).toLowerCase();
  const copiarServiciosDe = String(request.data?.copiarServiciosDe || '').trim();

  if (nombre.length < 2) throw new HttpsError('invalid-argument', 'Poné el nombre de la sucursal.');
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(slug) || slug.length < 3) {
    throw new HttpsError('invalid-argument', 'El link solo puede tener letras, números y guiones (mínimo 3).');
  }
  if (SLUGS_RESERVADOS.includes(slug)) {
    throw new HttpsError('already-exists', 'Ese link está reservado por el sistema. Probá con otro.');
  }

  const nuevaRef = db.collection('businesses').doc();
  const nuevoId = nuevaRef.id;
  const slugRef = db.doc(`slugs/${slug}`);

  // El slug y el tope se chequean DENTRO de la transacción: dos pestañas
  // abiertas creando la cuarta y la quinta sucursal al mismo tiempo pasarían
  // las dos un chequeo hecho antes.
  await db.runTransaction(async (tx) => {
    const tomado = await tx.get(slugRef);
    if (tomado.exists) {
      throw new HttpsError('already-exists', 'Ese link ya está ocupado. Probá con otro.');
    }

    const hermanas = await tx.get(db.collection('businesses').where('grupoId', '==', grupoId));
    // Cuando la cuenta todavía no es un grupo la consulta trae 0 y la barbería
    // que ya existe cuenta igual: es la primera de las cuatro.
    const actuales = Math.max(1, hermanas.size);

    if (maxSucursales !== null && actuales >= maxSucursales) {
      throw new HttpsError(
        'failed-precondition',
        `Tu plan permite hasta ${maxSucursales} sucursales y ya tenés ${actuales}.`
      );
    }

    tx.set(slugRef, { businessId: nuevoId });

    tx.set(nuevaRef, {
      id: nuevoId,
      name: nombre,
      slug,
      // La marca se hereda del principal: es la misma barbería en otra esquina.
      // Todo lo demás (equipo, servicios, horarios) nace vacío y propio.
      logoUrl: principal.logoUrl ?? null,
      primaryColor: principal.primaryColor || '#E85D2A',
      secondaryColor: principal.secondaryColor || '#1A1A1A',
      accentColor: principal.accentColor || '#E85D2A',
      phone: limpiar(request.data?.telefono, 40) || principal.phone || '',
      email: principal.email || '',
      address: limpiar(request.data?.direccion, 120),
      city: limpiar(request.data?.ciudad, 60) || principal.city || '',
      country: principal.country || 'Argentina',
      currency: principal.currency || 'ARS',
      timezone: principal.timezone || 'America/Argentina/Buenos_Aires',
      slotInterval: principal.slotInterval || 30,
      minCancelHours: principal.minCancelHours ?? 2,
      onlineBookingEnabled: true,
      welcomeMessage: '',
      socialLinks: { instagram: '', whatsapp: principal.socialLinks?.whatsapp || '' },
      // El plan es de la CUENTA: la sucursal lo lleva copiado para que el panel
      // sepa sus topes, pero el abono se cobra una vez, en el principal.
      planId: principal.planId || null,
      whatsappQuota: 0,
      maxBarbers: limitesDelNegocio(principal).maxBarbers,
      maxSucursales,
      // Las funciones habilitadas son de la CUENTA, no de cada local: si el
      // Empresarial incluye logo y colores, los incluye en las cuatro.
      capacidades: capacidadesDelNegocio(principal),
      // Si la cuenta está suspendida por deuda, la sucursal nace suspendida:
      // abrir una sucursal nueva no puede ser la forma de destrabar el link.
      isFrozen: principal.isFrozen === true,
      // Sin período de prueba PROPIO: la prueba es de la cuenta y vive en la
      // principal. Copiárselo hacía que la sucursal mostrara "se terminó tu
      // prueba" por su cuenta, como si tuviera un plan aparte. runBilling mira
      // el de la principal para decidir por todo el grupo.
      trialEndsAt: null,
      origen: 'sucursal',
      grupoId,
      businessHours: (principal.businessHours || HORARIO_POR_DEFECTO).map((h) => ({ ...h })),
      createdAt: FieldValue.serverTimestamp(),
    });

    // Facturación propia pero en cero: el plan lo paga el principal. runBilling
    // le hace seguir la suerte del principal (si el principal debe, la sucursal
    // también se congela).
    tx.set(db.doc(`businesses/${nuevoId}/private/billing`), {
      planId: principal.planId || null,
      monthlyFee: 0,
      debt: 0,
      lastPaymentDate: null,
      nextBillingDate: null,
      esSucursal: true,
      grupoId,
    });

    // El grupo se forma recién ahora: hasta la primera sucursal, la barbería
    // original es una cuenta común sin `grupoId`.
    if (!principal.grupoId) {
      tx.update(principalRef, { grupoId });
    }

    // El mapa público del grupo: qué barberías lo componen. Lo usa la página de
    // reservas para preguntarle al cliente a qué sucursal va. Va en la MISMA
    // transacción que el alta porque si queda a medias, la sucursal existe y no
    // aparece en el selector — y nadie se entera hasta que un cliente no la
    // encuentra.
    //
    // Guarda solo ids: el nombre y la dirección se leen del documento de cada
    // barbería, así no hay dos lugares que se puedan contradecir.
    const idsDelGrupo = [grupoId, ...hermanas.docs.map((d) => d.id).filter((id) => id !== grupoId), nuevoId];
    tx.set(db.doc(`grupos/${grupoId}`), {
      principalId: grupoId,
      businessIds: [...new Set(idsDelGrupo)],
      actualizadoEn: FieldValue.serverTimestamp(),
    });
  });

  // Los dueños del principal, en la sucursal nueva.
  const lote = db.batch();
  const duenos = await db.collection(`businesses/${grupoId}/admins`).where('role', '==', 'owner').get();
  for (const d of duenos.docs) {
    lote.set(db.doc(`businesses/${nuevoId}/admins/${d.id}`), {
      ...d.data(),
      businessId: nuevoId,
      professionalId: null,
      addedAt: FieldValue.serverTimestamp(),
    });
  }

  // Servicios como punto de partida, si lo pidieron. Documentos NUEVOS: no se
  // comparte nada: tocarle el precio en una sucursal no toca la otra.
  let serviciosCopiados = 0;
  if (copiarServiciosDe) {
    const permitido = copiarServiciosDe === grupoId
      || (await db.doc(`businesses/${copiarServiciosDe}`).get()).get('grupoId') === grupoId;
    if (!permitido) {
      throw new HttpsError('permission-denied', 'Solo podés copiar los servicios de una sucursal de tu cuenta.');
    }
    const origen = await db.collection(`businesses/${copiarServiciosDe}/services`).get();
    origen.docs.forEach((d, i) => {
      const ref = db.collection(`businesses/${nuevoId}/services`).doc();
      const datos = d.data();
      lote.set(ref, { ...datos, id: ref.id, displayOrder: datos.displayOrder ?? i + 1 });
      serviciosCopiados++;
    });
  }

  await lote.commit();

  // Y el permiso: sin esto el dueño entra y no ve la sucursal que creó.
  await sincronizarClaimsDelGrupo(grupoId);

  logger.info('sucursal creada', { grupoId, nuevoId, slug, serviciosCopiados });

  await notificarPlataforma({
    type: 'alta_nueva',
    title: 'Sucursal nueva',
    body: `${principal.name || grupoId} abrió la sucursal "${nombre}".`,
    businessId: nuevoId,
    url: '/super-admin/barberias',
  }).catch((err) => logger.warn('no se pudo avisar la sucursal', { error: err.message }));

  return { businessId: nuevoId, slug, grupoId, serviciosCopiados };
});

exports.probarPush = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Tenés que iniciar sesión.');

  const uid = request.auth.uid;
  const claims = request.auth.token || {};
  const esPlataforma = claims.platform === true || claims.platform === 'moderator';
  const businessId = claims.businessId || null;

  if (!esPlataforma && !businessId) {
    throw new HttpsError('permission-denied', 'Esta cuenta no tiene panel.');
  }

  const col = esPlataforma
    ? db.collection('platformDevices')
    : db.collection(`businesses/${businessId}/devices`);
  const snap = await col.where('uid', '==', uid).get();
  const tokens = snap.docs.map((d) => d.id);

  if (!tokens.length) {
    return { enviados: 0, fallidos: 0, dispositivos: 0 };
  }

  const url = esPlataforma ? '/super-admin' : '/admin/citas';
  let res;
  try {
    res = await getMessaging().sendEachForMulticast({
      tokens,
      ...mensajePush({
        title: 'Prueba de BarberOS',
        body: 'Si ves este aviso, las notificaciones te están llegando bien.',
        type: 'prueba',
        notificationId: `prueba-${Date.now()}`,
        url,
      }, url),
    });
  } catch (err) {
    logger.error('prueba de push fallida', { uid, error: err.message });
    throw new HttpsError('internal', 'No se pudo enviar la prueba: ' + err.message);
  }

  // Los tokens muertos se borran acá también: si el teléfono se desinstaló, el
  // documento queda y la próxima prueba volvería a decir "falló".
  const muertos = [];
  const errores = [];
  res.responses.forEach((r, i) => {
    if (r.success) return;
    const code = r.error?.code || 'desconocido';
    errores.push(code);
    if (tokenMuerto(code)) muertos.push(tokens[i]);
  });
  await Promise.all(muertos.map((t) => col.doc(t).delete().catch(() => {})));

  logger.info('prueba de push', { uid, dispositivos: tokens.length, ok: res.successCount, fallidos: res.failureCount });
  return {
    dispositivos: tokens.length,
    enviados: res.successCount,
    fallidos: res.failureCount,
    muertos: muertos.length,
    errores,
  };
});

/**
 * Para el dueño: qué cuentas de su barbería tienen los avisos activados.
 * No devuelve tokens —eso sirve para mandarle mensajes a un teléfono— sino
 * cuántos dispositivos tiene cada uno y cuándo fue el último registro.
 */
exports.estadoPushDelEquipo = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Tenés que iniciar sesión.');
  const claims = request.auth.token || {};
  const businessId = claims.businessId || request.data?.businessId || null;
  const esPlataforma = claims.platform === true || claims.platform === 'moderator';

  if (!businessId) throw new HttpsError('invalid-argument', 'Falta el negocio.');
  if (!esPlataforma && !(claims.businessId === businessId && claims.role === 'owner')) {
    throw new HttpsError('permission-denied', 'Solo el dueño de la barbería.');
  }

  const snap = await db.collection(`businesses/${businessId}/devices`).get();
  const porPerfil = {};
  snap.docs.forEach((d) => {
    const dev = d.data();
    const clave = dev.role === 'owner' ? 'owner' : (dev.professionalId || 'sin-perfil');
    const actual = porPerfil[clave] || { dispositivos: 0, ultimo: null };
    actual.dispositivos += 1;
    const ts = dev.updatedAt?.toDate?.() || null;
    if (ts && (!actual.ultimo || ts > actual.ultimo)) actual.ultimo = ts;
    porPerfil[clave] = actual;
  });

  return {
    equipo: Object.entries(porPerfil).map(([clave, v]) => ({
      clave,
      dispositivos: v.dispositivos,
      ultimo: v.ultimo ? v.ultimo.toISOString() : null,
    })),
  };
});

exports.onNuevoTurno = onDocumentCreated('businesses/{bizId}/appointments/{aptId}', async (event) => {
  const a = event.data?.data();
  if (!a) return;
  // Lo cargó el propio staff (walk-in o a mano): ya lo sabe.
  if (a.type === 'walkin' || a.type === 'manual') return;

  await notificar(event.params.bizId, {
    type: 'nuevo_turno',
    title: 'Nuevo turno',
    body: `${a.clientName || 'Un cliente'} reservó ${a.serviceName || 'un servicio'} · ${fechaLinda(a.appointmentDate)} ${a.startTime}`,
    professionalId: a.professionalId || null,
    appointmentId: event.params.aptId,
    appointmentDate: a.appointmentDate || null,
  });
});

exports.onTurnoCancelado = onDocumentUpdated('businesses/{bizId}/appointments/{aptId}', async (event) => {
  const antes = event.data?.before?.data();
  const ahora = event.data?.after?.data();
  if (!antes || !ahora) return;
  if (antes.status === 'cancelada' || ahora.status !== 'cancelada') return;
  // Solo si canceló el cliente. Si lo canceló el barbero, ya lo sabe.
  if (ahora.cancelledBy !== 'client') return;

  await notificar(event.params.bizId, {
    type: 'turno_cancelado',
    title: 'Turno cancelado',
    body: `${ahora.clientName || 'Un cliente'} canceló ${ahora.serviceName || 'su turno'} · ${fechaLinda(ahora.appointmentDate)} ${ahora.startTime}`,
    professionalId: ahora.professionalId || null,
    appointmentId: event.params.aptId,
    appointmentDate: ahora.appointmentDate || null,
  });
});

/**
 * El uso del cupón sigue al turno.
 *
 * Por qué un trigger y no el panel: "Vino / No vino / Cancelar" y la
 * cancelación del cliente son escrituras DIRECTAS a Firestore desde el browser
 * (`updateAppointment`), no llamadas a una function. Ahí no se puede
 * incrementar un contador de forma confiable —ni siquiera con las Rules, que no
 * saben sumar— y tampoco se le puede dar al cliente permiso para tocar los
 * números de un cupón. Acá corre con el Admin SDK, después del hecho, y ve el
 * antes y el después.
 *
 * Qué consume y qué devuelve:
 *
 *   cancelada  → se devuelve el uso. El turno no pasó; el cupón vuelve a estar
 *                disponible, para ese cliente y para el tope total.
 *   no_asistio → se consume. Reservó con el descuento y dejó el horario
 *                bloqueado: es exactamente el uso que el cupón pagó.
 *   completada → se consume, y recién acá suma a los ingresos del cupón.
 *
 * `usos` es el contador de RESERVADOS (el que frena el tope). `usosConfirmados`,
 * `ingresos` y `clientesNuevos` son el informe, y cuentan lo que de verdad
 * ocurrió.
 */
const ESTADOS_QUE_CONSUMEN = ['completada', 'no_asistio'];

exports.onTurnoConCupon = onDocumentUpdated('businesses/{bizId}/appointments/{aptId}', async (event) => {
  const antes = event.data?.before?.data();
  const ahora = event.data?.after?.data();
  if (!antes || !ahora) return;
  if (antes.status === ahora.status) return;

  const cuponId = ahora.cuponId;
  if (!cuponId) return;

  const { bizId, aptId } = event.params;
  const cuponRef = db.doc(`businesses/${bizId}/cupones/${cuponId}`);
  const usoRef = cuponRef.collection('usos').doc(aptId);

  // El uso manda sobre el turno: dice en qué estado quedó contado. Sin esto,
  // dos cambios de estado seguidos (cancelada → confirmada → cancelada)
  // devolverían el uso dos veces y el contador se iría a negativo.
  await db.runTransaction(async (tx) => {
    const uso = await tx.get(usoRef);
    if (!uso.exists) return;
    const contado = uso.get('estado');

    if (ahora.status === 'cancelada') {
      if (contado === 'liberado') return;
      tx.update(usoRef, { estado: 'liberado', cerradoEn: FieldValue.serverTimestamp() });
      // Si ya estaba confirmado, se descuenta de las dos cuentas.
      tx.update(cuponRef, {
        usos: FieldValue.increment(-1),
        ...(contado === 'confirmado' ? {
          usosConfirmados: FieldValue.increment(-1),
          ingresos: FieldValue.increment(-(Number(uso.get('precioFinal')) || 0)),
          ...(uso.get('esClienteNuevo') ? { clientesNuevos: FieldValue.increment(-1) } : {}),
        } : {}),
      });
      return;
    }

    if (ESTADOS_QUE_CONSUMEN.includes(ahora.status)) {
      if (contado === 'confirmado') return;
      // Un uso que se había liberado y vuelve (el barbero reactiva un turno
      // cancelado) tiene que volver a ocupar su lugar en el tope.
      const vuelve = contado === 'liberado';
      tx.update(usoRef, { estado: 'confirmado', cerradoEn: FieldValue.serverTimestamp() });
      tx.update(cuponRef, {
        ...(vuelve ? { usos: FieldValue.increment(1) } : {}),
        usosConfirmados: FieldValue.increment(1),
        // Los ingresos del cupón son lo que de verdad se cobró, no el precio de
        // lista: es el número con el que el dueño decide si la promo le sirvió.
        ingresos: FieldValue.increment(Number(uso.get('precioFinal')) || 0),
        ...(uso.get('esClienteNuevo') ? { clientesNuevos: FieldValue.increment(1) } : {}),
      });
    }
  }).catch((err) => {
    logger.error('no se pudo actualizar el uso del cupón', {
      bizId, aptId, cuponId, error: err.message,
    });
  });
});

// ============================================================================
// 4c. NOTIFICACIONES A LA PLATAFORMA
// ============================================================================
// La campanita del panel global: tickets nuevos, respuestas de una barbería
// en un ticket, y cuentas suspendidas por deuda. Mismo esquema que las del
// staff (/platform/notifications/items + push a /platformDevices), pero para
// el equipo de la plataforma (dueño y moderadores).

async function notificarPlataforma(datos) {
  const ref = db.collection('platform/notifications/items').doc();
  await ref.set({
    id: ref.id,
    leidaPor: {},
    createdAt: FieldValue.serverTimestamp(),
    ...datos,
  });
  await enviarPushPlataforma({ ...datos, notificationId: ref.id });
}

async function enviarPushPlataforma(datos) {
  const snap = await db.collection('platformDevices').get();
  if (snap.empty) return;
  const tokens = snap.docs.map((d) => d.id);
  let res;
  try {
    res = await getMessaging().sendEachForMulticast({
      tokens,
      ...mensajePush(datos, '/super-admin'),
    });
  } catch (err) {
    console.error('[push plataforma] No se pudo enviar:', err.message);
    return;
  }
  const muertos = [];
  const fallas = [];
  res.responses.forEach((r, i) => {
    if (r.success) return;
    const code = r.error?.code || 'desconocido';
    fallas.push(code);
    if (tokenMuerto(code)) muertos.push(tokens[i]);
  });
  if (fallas.length) {
    logger.warn('push de plataforma con fallas', { enviados: res.successCount, fallidos: res.failureCount, codigos: fallas, borrados: muertos.length });
  }
  await Promise.all(muertos.map((t) => db.doc(`platformDevices/${t}`).delete().catch(() => {})));
}

exports.onTicketNuevo = onDocumentCreated('tickets/{ticketId}', async (event) => {
  const t = event.data?.data();
  if (!t) return;
  await notificarPlataforma({
    type: 'ticket_nuevo',
    title: `Ticket nuevo · ${t.businessName || 'una barbería'}`,
    body: String(t.subject || '').slice(0, 140) || 'Sin asunto',
    businessId: t.businessId || null,
    ticketId: event.params.ticketId,
    url: '/super-admin/soporte',
  });
});

exports.onMensajeDeTicket = onDocumentCreated('tickets/{ticketId}/messages/{msgId}', async (event) => {
  const m = event.data?.data();
  if (!m || m.authorRole !== 'business') return; // lo que escribe la plataforma no se avisa a sí misma

  const ticketSnap = await db.doc(`tickets/${event.params.ticketId}`).get();
  const t = ticketSnap.exists ? ticketSnap.data() : {};

  // El primer mensaje entra en el mismo batch que el ticket: ya lo avisó
  // onTicketNuevo. En un batch, serverTimestamp() resuelve al mismo instante
  // para todas las escrituras, así que si coinciden es ese primer mensaje.
  const creado = t.createdAt?.toMillis?.();
  const escrito = m.createdAt?.toMillis?.();
  if (creado && escrito && creado === escrito) return;

  await notificarPlataforma({
    type: 'ticket_mensaje',
    title: `${m.authorName || t.businessName || 'Una barbería'} respondió`,
    body: `${t.subject ? t.subject + ': ' : ''}${String(m.text || '').slice(0, 120)}`,
    businessId: t.businessId || null,
    ticketId: event.params.ticketId,
    url: '/super-admin/soporte',
  });
});

// ============================================================================
// 5. ALTA CON CONTRASEÑA
// ============================================================================
// El login con Google alcanza para quien ya tiene Gmail, pero deja afuera al
// barbero que no lo usa o no quiere mezclarlo con lo personal. Como el
// onboarding es manual, la plataforma le crea la cuenta y le entrega una
// contraseña.
//
// Solo el Admin SDK puede crear un usuario sin que la persona se registre sola,
// así que esto no puede vivir en el browser.

const { randomBytes } = require('crypto');

// Sin caracteres que se confunden al dictarlos por teléfono o WhatsApp:
// nada de O/0, l/1/I. La contraseña se va a leer en voz alta más de una vez.
const ALFABETO = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Contraseña aleatoria de 12 caracteres, con entropía de crypto y no de Math.random. */
function generarPassword(largo = 12) {
  const bytes = randomBytes(largo);
  let out = '';
  for (let i = 0; i < largo; i++) out += ALFABETO[bytes[i] % ALFABETO.length];
  return out;
}

/**
 * Crea la cuenta de un dueño con email y contraseña, y le asigna los claims.
 *
 * Devuelve la contraseña UNA sola vez: no queda guardada en ningún lado (Firebase
 * solo guarda su hash), así que si se pierde hay que generar otra con
 * `resetOwnerPassword`. Eso es a propósito — una contraseña recuperable en texto
 * plano es una contraseña filtrada esperando su turno.
 */
exports.createOwnerWithPassword = onCall(async (request) => {
  const {
    email, businessId, name = '', role = 'owner', professionalId = null,
    // Opcional: si viene, se usa esa. Si no, la genera el servidor.
    password: elegida = null,
  } = request.data || {};

  if (!email || !businessId || !['owner', 'admin'].includes(role)) {
    throw new HttpsError('invalid-argument', 'Faltan email, businessId o role válido.');
  }

  // Crear cuentas es de la plataforma, no del tenant: el dueño de una barbería
  // puede dar de alta barberos (setBusinessAdmin) pero no fabricar usuarios.
  if (!request.auth || request.auth.token.platform !== true) {
    throw new HttpsError('permission-denied', 'Solo la plataforma puede crear cuentas.');
  }

  const normalizedEmail = String(email).trim().toLowerCase();

  const businessSnap = await db.doc(`businesses/${businessId}`).get();
  if (!businessSnap.exists) {
    throw new HttpsError('not-found', `El negocio ${businessId} no existe.`);
  }

  // Si ya existe, no se le pisa la contraseña: puede ser alguien que ya venía
  // entrando con Google, y cambiársela en silencio lo dejaría afuera.
  try {
    await getAuth().getUserByEmail(normalizedEmail);
    throw new HttpsError(
      'already-exists',
      'Ya existe una cuenta con ese mail. Usá "Agregar administrador" para darle acceso, o restablecele la contraseña.'
    );
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    if (err.code !== 'auth/user-not-found') throw err;
  }

  // Firebase exige 6 caracteres como mínimo. Se valida acá para que el error
  // llegue en castellano y no como un código del SDK.
  if (elegida !== null && String(elegida).length < 8) {
    throw new HttpsError('invalid-argument', 'La contraseña tiene que tener al menos 8 caracteres.');
  }

  const password = elegida ? String(elegida) : generarPassword();
  const user = await getAuth().createUser({
    email: normalizedEmail,
    password,
    displayName: name || undefined,
    emailVerified: true, // la cuenta la crea la plataforma, no hay mail que verificar
  });

  await getAuth().setCustomUserClaims(user.uid, { businessId, role, professionalId });

  await db.doc(`businesses/${businessId}/admins/${normalizedEmail}`).set({
    email: normalizedEmail,
    name,
    role,
    businessId,
    professionalId,
    addedAt: FieldValue.serverTimestamp(),
  });

  // Por si quedó un permiso anotado de antes: ya no hace falta, se aplicó acá.
  await db.doc(`pendingAdmins/${normalizedEmail}`).delete().catch(() => {});

  return { status: 'created', uid: user.uid, email: normalizedEmail, password };
});

/**
 * Genera una contraseña nueva para alguien que ya tiene cuenta. Para cuando el
 * barbero la pierde y hay que pasarle otra por WhatsApp.
 */
exports.resetOwnerPassword = onCall(async (request) => {
  const { email, password: elegida = null } = request.data || {};
  if (!email) throw new HttpsError('invalid-argument', 'Falta el email.');
  if (elegida !== null && String(elegida).length < 8) {
    throw new HttpsError('invalid-argument', 'La contraseña tiene que tener al menos 8 caracteres.');
  }

  if (!request.auth || request.auth.token.platform !== true) {
    throw new HttpsError('permission-denied', 'Solo la plataforma puede restablecer contraseñas.');
  }

  const normalizedEmail = String(email).trim().toLowerCase();

  let user;
  try {
    user = await getAuth().getUserByEmail(normalizedEmail);
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      throw new HttpsError('not-found', 'No hay ninguna cuenta con ese mail.');
    }
    throw err;
  }

  // No se le tocan los claims: esto cambia la llave, no el permiso.
  if (user.customClaims?.platform === true) {
    throw new HttpsError('permission-denied', 'No se restablece la contraseña de la plataforma desde acá.');
  }

  const password = elegida ? String(elegida) : generarPassword();
  await getAuth().updateUser(user.uid, { password });

  // Las sesiones abiertas con la contraseña vieja dejan de valer.
  await getAuth().revokeRefreshTokens(user.uid);

  return { status: 'reset', email: normalizedEmail, password };
});

// ============================================================================
// 5b. BORRAR UNA BARBERÍA
// ============================================================================
// Firestore no borra en cascada: eliminar /businesses/{id} desde el browser
// dejaba huérfanas todas las subcolecciones, el slug, los tickets, los
// pendientes y —lo peor— los claims de los usuarios, que seguían con acceso a
// un negocio que ya no existía. Va acá, con el Admin SDK, para hacerlo entero
// y en un solo lugar. Solo el dueño de la plataforma; un moderador, no.
//
// Es definitivo. La confirmación (escribir el nombre) la pide el panel.

exports.deleteBusiness = onCall(async (request) => {
  assertPlatformOwner(request);

  const { businessId, confirmName } = request.data || {};
  if (!businessId) throw new HttpsError('invalid-argument', 'Falta el id del negocio.');

  const ref = db.doc(`businesses/${businessId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Ese negocio no existe.');
  const negocio = snap.data();

  // Segunda barrera, del lado del servidor: el nombre tal cual.
  if (String(confirmName || '').trim() !== String(negocio.name || '').trim()) {
    throw new HttpsError('failed-precondition', 'El nombre no coincide.');
  }

  // Borrar la barbería PRINCIPAL de una cuenta con sucursales dejaría a las
  // otras colgadas: sin plan, sin abono (el abono vive en la principal) y con un
  // `grupoId` que apunta a un documento que ya no existe — es decir, andando
  // gratis y sin que nadie las pueda cobrar ni suspender. Se borran las
  // sucursales primero, a conciencia, una por una.
  const esPrincipal = negocio.grupoId && negocio.grupoId === businessId;
  if (esPrincipal) {
    const hermanas = await db.collection('businesses').where('grupoId', '==', businessId).get();
    const otras = hermanas.docs.filter((d) => d.id !== businessId);
    if (otras.length > 0) {
      throw new HttpsError(
        'failed-precondition',
        `Esta es la barbería principal de una cuenta con ${otras.length} sucursal(es): ` +
        otras.map((d) => d.get('name') || d.id).join(', ') +
        '. Borrá primero las sucursales.'
      );
    }
  }

  const resumen = { usuarios: 0, tickets: 0, pendientes: 0, reasignados: 0 };

  // 1. Claims: todos los usuarios cuyo businessId sea este. Se buscan en Auth
  //    y no solo en /admins, porque el registro de /admins puede estar
  //    incompleto y el claim es lo que da acceso.
  //
  //    Con cuentas de varias sucursales hay un caso más: el dueño lleva la lista
  //    `businessIds`. Si se borra UNA sucursal no hay que dejarlo sin acceso a
  //    las otras — hay que sacarle esa de la lista. Vaciarle los claims, como se
  //    hacía antes, lo echaba de su propia cuenta por borrar una sucursal.
  let pageToken;
  do {
    const page = await getAuth().listUsers(1000, pageToken);
    for (const u of page.users) {
      const c = u.customClaims || {};
      const lista = Array.isArray(c.businessIds) ? c.businessIds : [];
      const quedan = lista.filter((id) => id !== businessId);

      const loNombra = c.businessId === businessId || lista.includes(businessId);
      if (!loNombra) continue;

      if (quedan.length > 0) {
        // Le queda cuenta: se le reasigna la principal que siga existiendo.
        // Las claves se arman a mano y no con un spread + undefined: un
        // `undefined` adentro de los claims es un campo que queda escrito como
        // nulo o directamente rechazado, según la versión del SDK.
        const nuevos = {
          businessId: quedan.includes(c.grupoId) ? c.grupoId : quedan[0],
          role: c.role || 'owner',
          professionalId: c.professionalId ?? null,
        };
        if (quedan.length > 1) {
          nuevos.businessIds = quedan;
          if (c.grupoId) nuevos.grupoId = c.grupoId;
        }
        await getAuth().setCustomUserClaims(u.uid, nuevos);
        resumen.reasignados++;
      } else {
        await getAuth().setCustomUserClaims(u.uid, {});
        await getAuth().revokeRefreshTokens(u.uid);
        resumen.usuarios++;
      }
    }
    pageToken = page.pageToken;
  } while (pageToken);

  // 2. Pendientes que apuntaban acá.
  const pendientes = await db.collection('pendingAdmins').where('businessId', '==', businessId).get();
  for (const d of pendientes.docs) { await d.ref.delete(); resumen.pendientes++; }

  // 3. Tickets (con sus mensajes).
  const tickets = await db.collection('tickets').where('businessId', '==', businessId).get();
  for (const d of tickets.docs) { await db.recursiveDelete(d.ref); resumen.tickets++; }

  // 4. El slug.
  if (negocio.slug) await db.doc(`slugs/${negocio.slug}`).delete().catch(() => {});

  // 4b. El mapa público del grupo, que es lo que lee la página de reservas para
  //     ofrecer las sucursales. Si no se actualiza, el cliente sigue viendo una
  //     sucursal que ya no existe y al tocarla cae en "no encontramos este
  //     negocio".
  if (negocio.grupoId) {
    const grupoRef = db.doc(`grupos/${negocio.grupoId}`);
    const grupo = await grupoRef.get();
    if (grupo.exists) {
      const quedan = (grupo.get('businessIds') || []).filter((id) => id !== businessId);
      // Sin sucursales ya no es un grupo: se borra el mapa para que la página
      // vuelva a comportarse como una barbería sola.
      if (quedan.length <= 1) await grupoRef.delete().catch(() => {});
      else await grupoRef.set({ businessIds: quedan, actualizadoEn: FieldValue.serverTimestamp() }, { merge: true });
    }
  }

  // 5. El negocio con todas sus subcolecciones.
  await db.recursiveDelete(ref);

  return { status: 'deleted', ...resumen };
});

// ============================================================================
// 6. EQUIPO DE LA PLATAFORMA
// ============================================================================
// El dueño de la plataforma puede sumar moderadores: gente de soporte que entra
// al panel global, ve todo y atiende tickets, pero no toca plata, cuentas ni
// suspensiones. Lo que puede hacer lo definen las Rules y el frontend; acá solo
// se pone o se saca el claim.
//
// El claim es `platform: 'moderator'` y NO `platform: true` a propósito: todo lo
// que exige `platform === true` —en las Rules y en estas mismas functions— lo
// deja afuera por defecto. Es la diferencia entre "tiene lo que se le concedió"
// y "tiene todo salvo lo que se le sacó".

/** Solo el dueño de la plataforma. Un moderador no puede nombrar moderadores. */
// Cuentas fundadoras: nadie las puede degradar ni revocar desde el panel, ni
// siquiera otro administrador de plataforma. Sin esto, la primera persona a la
// que le das acceso total puede dejarte afuera de tu propia plataforma, y
// volver a entrar exige la clave de servicio y un script a mano.
const FUNDADORES = ['cavannaprogramacion@gmail.com'];

function assertPlatformOwner(request) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Tenés que iniciar sesión.');
  }
  if (request.auth.token.platform !== true) {
    throw new HttpsError('permission-denied', 'Solo el dueño de la plataforma.');
  }
}

/**
 * Nombra a alguien moderador, o le saca el rol. Devuelve 'applied' si la cuenta
 * ya existía, o 'pending' si nunca entró (se aplica en su primer login, igual
 * que los permisos de barbería).
 */
exports.setPlatformModerator = onCall(async (request) => {
  assertPlatformOwner(request);

  const { email, enabled = true, name = '', rol = 'moderator' } = request.data || {};
  if (!email) throw new HttpsError('invalid-argument', 'Falta el email.');
  if (!['moderator', 'admin'].includes(rol)) {
    throw new HttpsError('invalid-argument', 'El rol tiene que ser moderator o admin.');
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  // `admin` es acceso total al panel global: altas, cobros, suspensiones,
  // borrar barberías y nombrar a otros. `moderator` solo mira y atiende
  // soporte. La diferencia vive en el claim: true vs 'moderator'.
  const esAdmin = rol === 'admin';

  // Nadie se toca a sí mismo desde acá: sacarse el claim de dueño por error
  // dejaría el panel global sin nadie que pueda entrar.
  if (normalizedEmail === String(request.auth.token.email || '').toLowerCase()) {
    throw new HttpsError('failed-precondition', 'No podés cambiar tu propio rol.');
  }

  let user = null;
  try {
    user = await getAuth().getUserByEmail(normalizedEmail);
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err;
  }

  if (FUNDADORES.includes(normalizedEmail)) {
    throw new HttpsError('permission-denied', 'Esa cuenta es fundadora de la plataforma: no se puede cambiar desde acá.');
  }

  const registro = db.doc(`platform/team/members/${normalizedEmail}`);

  if (!enabled) {
    await registro.delete().catch(() => {});
    await db.doc(`pendingAdmins/${normalizedEmail}`).delete().catch(() => {});
    if (!user) return { status: 'not-found' };
    // Se le vacían los claims enteros: un moderador no tiene otro rol que
    // conservar. Y se le cortan las sesiones, si no sigue entrando una hora.
    await getAuth().setCustomUserClaims(user.uid, {});
    await getAuth().revokeRefreshTokens(user.uid);
    return { status: 'revoked' };
  }

  // Registro para la UI del panel (la lista de "Equipo" sale de acá).
  await registro.set({
    email: normalizedEmail,
    name,
    role: esAdmin ? 'admin' : 'moderator',
    addedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  if (!user) {
    // Nunca entró: queda anotado y applyPendingClaims lo aplica en su primer
    // login. Se reutiliza el mismo mecanismo que los admins de barbería.
    await db.doc(`pendingAdmins/${normalizedEmail}`).set({
      platform: esAdmin ? true : 'moderator',
      email: normalizedEmail,
      name,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { status: 'pending', message: 'Se aplicará en su primer login.' };
  }

  // Si administraba una barbería, esto lo reemplaza: una cuenta tiene UN rol.
  await getAuth().setCustomUserClaims(user.uid, { platform: esAdmin ? true : 'moderator' });
  // El rol viaja en el token: sin cortar las sesiones, un ascenso (o una
  // degradación) tarda hasta una hora en tomar efecto.
  await getAuth().revokeRefreshTokens(user.uid);
  return { status: 'applied', uid: user.uid, rol };
});

// ============================================================================
// 3. MERCADO PAGO (seña del turno)
// ============================================================================
// Vive en su propio archivo: son varias funciones y un flujo de OAuth entero.
// La plata va DIRECTO a la cuenta del barbero; la plataforma no la toca.

exports.urlConectarMercadoPago = mp.urlConectarMercadoPago;
exports.callbackMercadoPago = mp.callbackMercadoPago;
exports.desconectarMercadoPago = mp.desconectarMercadoPago;
exports.webhookMercadoPago = mp.webhookMercadoPago;
exports.devolverSena = mp.devolverSena;

// ============================================================================
// 3b. MEMBRESÍAS (planes mensuales de la barbería a sus clientes)
// ============================================================================
// Ver membresias.js. El uso al reservar está en createAppointment, arriba.

exports.guardarPlanMembresia = membresias.guardarPlanMembresia;
exports.buscarSuscripcionesMP = membresias.buscarSuscripcionesMP;
exports.cargarMembresia = membresias.cargarMembresia;
exports.renovarMembresia = membresias.renovarMembresia;
exports.cancelarMembresia = membresias.cancelarMembresia;
exports.aplicarMembresia = membresias.aplicarMembresia;
exports.revertirUsoMembresia = membresias.revertirUsoMembresia;
exports.miMembresia = membresias.miMembresia;
exports.onTurnoMembresia = membresias.onTurnoMembresia;
exports.reconciliarMembresias = membresias.reconciliarMembresias;
exports.reconciliarMembresiasDiario = membresias.reconciliarMembresiasDiario;

// ============================================================================
// COMPLETAR PLANES EN LAS CUENTAS VIEJAS
// ============================================================================
// Escribe en cada barbería los topes y las capacidades que le corresponden a su
// plan, y reconstruye el mapa público de cada cuenta con sucursales.
//
// Es lo mismo que hace `scripts/migrar-planes.mjs`, pero como callable. La
// razón no es comodidad: el script pide la CLAVE DE SERVICIO del proyecto —
// acceso total, sin restricciones— bajada a mano al disco de quien lo corre, y
// confía en que se acuerde de borrarla después. Para una tarea que hay que
// repetir cada vez que se agrega una capacidad nueva, eso es una llave maestra
// dando vueltas por una carpeta. Acá el permiso es el claim que ya tiene el
// dueño de la plataforma, y no hay nada que borrar.
//
// El script sigue existiendo para el día que el panel no esté disponible.
//
// Por qué no puede ser una escritura del browser: `capacidades`, `maxBarbers`,
// `maxSucursales` y `grupoId` son justo los campos que las Rules no dejan tocar
// a nadie salvo a la plataforma, y `/grupos` no lo escribe ningún browser. Con
// el Admin SDK pasa por arriba de las Rules, que es exactamente lo que hace
// falta y exactamente por lo que está cerrado al dueño de la plataforma y a
// nadie más.

/** Qué le falta a ESTE negocio para estar al día con su plan. */
function faltantesDelNegocio(id, biz) {
  const plan = camposDelPlan(biz.planId);
  if (!plan) return { plan: null, cambios: {} };

  // Lo que ya está escrito manda: puede ser una excepción hecha a mano para esa
  // cuenta. Esto solo COMPLETA lo que falta.
  const cambios = {};

  if (biz.capacidades === undefined) {
    cambios.capacidades = plan.capacidades;
  } else {
    // Ojo acá, que es el caso que no se ve: la cuenta tiene el campo, pero le
    // puede faltar una capacidad NUEVA, porque el mapa se escribió con las que
    // existían ese día. En las Rules una clave ausente vale TRUE —así una
    // cuenta vieja no pierde lo que ya usaba—, así que cada capacidad nueva
    // nace habilitada para todos hasta que se le escriba el false.
    const faltan = Object.fromEntries(
      Object.entries(plan.capacidades).filter(([k]) => biz.capacidades[k] === undefined)
    );
    if (Object.keys(faltan).length) cambios.capacidades = { ...biz.capacidades, ...faltan };
  }

  if (biz.maxSucursales === undefined) cambios.maxSucursales = plan.maxSucursales;
  if (biz.maxBarbers === undefined) cambios.maxBarbers = plan.maxBarbers;
  if (biz.grupoId === undefined) cambios.grupoId = null;

  // Una SUCURSAL no tiene período de prueba propio: el plan es de la cuenta y
  // vive en la principal. Las que se crearon antes de ese cambio lo copiaron, y
  // por eso mostraban "se terminó tu prueba" por su cuenta.
  if (biz.grupoId && biz.grupoId !== id && biz.trialEndsAt) cambios.trialEndsAt = null;

  return { plan, cambios };
}

exports.migrarPlanes = onCall(async (request) => {
  assertPlatformOwner(request);
  const aplicar = request.data?.aplicar === true;

  const negocios = await db.collection('businesses').get();
  const lote = db.batch();
  const cambios = [];
  const sinPlan = [];

  for (const d of negocios.docs) {
    const biz = d.data();
    const { plan, cambios: patch } = faltantesDelNegocio(d.id, biz);

    if (!plan) {
      sinPlan.push({ id: d.id, name: biz.name || d.id, planId: biz.planId || null });
      continue;
    }
    if (!Object.keys(patch).length) continue;

    cambios.push({ id: d.id, name: biz.name || d.id, planId: biz.planId, campos: patch });
    if (aplicar) lote.set(d.ref, patch, { merge: true });
  }

  // El mapa público de cada cuenta con sucursales. `/grupos/{id}` lo escribe
  // `crearSucursal`, pero los grupos creados antes de que ese mapa existiera no
  // lo tienen — y sin él, el cliente que abre el link no puede elegir a qué
  // local va. Se reconstruye desde `grupoId`, que es el dato de verdad.
  const porGrupo = new Map();
  for (const d of negocios.docs) {
    const grupoId = d.get('grupoId');
    if (!grupoId) continue;
    if (!porGrupo.has(grupoId)) porGrupo.set(grupoId, []);
    porGrupo.get(grupoId).push(d.id);
  }

  const grupos = [];
  for (const [grupoId, ids] of porGrupo) {
    const doc = await db.doc(`grupos/${grupoId}`).get();
    const actuales = doc.exists ? doc.get('businessIds') || [] : [];
    const iguales = actuales.length === ids.length && ids.every((i) => actuales.includes(i));
    if (iguales) continue;

    grupos.push({ grupoId, businessIds: ids });
    if (aplicar) {
      lote.set(db.doc(`grupos/${grupoId}`), { principalId: grupoId, businessIds: ids }, { merge: true });
    }
  }

  if (aplicar && (cambios.length || grupos.length)) await lote.commit();

  return { aplicado: aplicar, total: negocios.size, cambios, grupos, sinPlan };
});

// ============================================================================
// 4. RECORDATORIOS DE WHATSAPP (esqueleto)
// ============================================================================
// Se activa cuando Meta aprueba el número y las plantillas. El token va como
// secret, nunca en el código:
//   firebase functions:secrets:set WHATSAPP_TOKEN
//
// exports.sendReminders = onSchedule(
//   { schedule: '*/30 * * * *', timeZone: 'America/Argentina/Buenos_Aires',
//     secrets: ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_ID'] },
//   async () => {
//     // Buscar turnos en T-24h y T-2h con status pendiente|confirmada,
//     // POST a graph.facebook.com con la plantilla aprobada,
//     // y registrar el envío en /businesses/{id}/notifications para el
//     // control de cuota del panel global.
//   }
// );
