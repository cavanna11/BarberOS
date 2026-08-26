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
const { setGlobalOptions } = require('firebase-functions/v2');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

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

  if (!email || !businessId || !['owner', 'admin'].includes(role)) {
    throw new HttpsError('invalid-argument', 'Faltan email, businessId o role válido.');
  }

  const caller = assertCanManageAdmins(request, businessId);
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
  await getAuth().setCustomUserClaims(targetUser.uid, claims);

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

  const pendingRef = db.doc(`pendingAdmins/${email}`);
  const pending = await pendingRef.get();
  if (!pending.exists) return { status: 'none' };

  const { businessId, role, professionalId = null } = pending.data();
  await getAuth().setCustomUserClaims(request.auth.uid, {
    businessId,
    role,
    professionalId,
  });
  await pendingRef.delete();

  // El frontend tiene que refrescar el token para ver los claims nuevos.
  return { status: 'applied', businessId, role };
});

// ============================================================================
// 2. FACTURACIÓN
// ============================================================================

/**
 * Cobro mensual y suspensión por deuda. Todos los días a las 3 AM.
 *
 * Reemplaza al motor que hoy corre en el browser: ese solo se ejecuta cuando
 * alguien abre la app, así que una cuenta impaga podía seguir funcionando
 * indefinidamente si nadie entraba al panel.
 */
exports.runBilling = onSchedule(
  { schedule: '0 3 * * *', timeZone: 'America/Argentina/Buenos_Aires' },
  async () => {
    const today = new Date().toISOString().split('T')[0];
    const businesses = await db.collection('businesses').get();
    const batch = db.batch();
    let touched = 0;

    for (const doc of businesses.docs) {
      const biz = doc.data();
      const billingRef = db.doc(`businesses/${doc.id}/private/billing`);
      const billingSnap = await billingRef.get();
      const billing = billingSnap.exists ? billingSnap.data() : {};

      let debt = billing.debt || 0;
      let nextBillingDate = billing.nextBillingDate;
      let changed = false;

      if (!nextBillingDate) {
        const d = new Date();
        d.setMonth(d.getMonth() + 1);
        nextBillingDate = d.toISOString().split('T')[0];
        changed = true;
      }

      // Si pasaron varios vencimientos sin pago, se acumulan todos.
      while (today > nextBillingDate) {
        debt += billing.monthlyFee || 0;
        const d = new Date(nextBillingDate + 'T00:00:00');
        d.setMonth(d.getMonth() + 1);
        nextBillingDate = d.toISOString().split('T')[0];
        changed = true;
      }

      if (changed) {
        batch.set(billingRef, { debt, nextBillingDate }, { merge: true });
        touched++;
      }

      // `isFrozen` vive en el documento público porque las Rules y la página de
      // reservas lo necesitan para bloquear el link.
      const shouldFreeze = debt > 0;
      if (Boolean(biz.isFrozen) !== shouldFreeze) {
        batch.update(doc.ref, { isFrozen: shouldFreeze });
        touched++;
      }
    }

    if (touched > 0) await batch.commit();
    console.log(`[billing] ${today}: ${touched} cambios sobre ${businesses.size} negocios.`);
  }
);

// ============================================================================
// 3. RECORDATORIOS DE WHATSAPP (esqueleto)
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
