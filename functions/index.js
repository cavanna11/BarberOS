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
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

setGlobalOptions({ region: 'southamerica-east1', maxInstances: 10 });

// ── Guardas ────────────────────────────────────────────────────────────────

/** Solo el dueño de la plataforma. Se apoya en el claim, no en una lista. */
function assertPlatform(request) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Tenés que iniciar sesión.');
  }
  if (request.auth.token.platform !== true) {
    throw new HttpsError('permission-denied', 'Solo el dueño de la plataforma.');
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
  assertPlatform(request);

  const { email, businessId, role, professionalId = null, name = '' } = request.data || {};

  if (!email || !businessId || !['owner', 'admin'].includes(role)) {
    throw new HttpsError('invalid-argument', 'Faltan email, businessId o role válido.');
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const claims = { businessId, role, professionalId };

  const businessSnap = await db.doc(`businesses/${businessId}`).get();
  if (!businessSnap.exists) {
    throw new HttpsError('not-found', `El negocio ${businessId} no existe.`);
  }

  // Registro para la UI (la lista de /admin/admins sale de acá).
  await db.doc(`businesses/${businessId}/admins/${normalizedEmail}`).set({
    email: normalizedEmail,
    name,
    role,
    businessId,
    professionalId,
    addedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  try {
    const user = await admin.auth().getUserByEmail(normalizedEmail);

    // Un usuario pertenece a un solo negocio. Si ya administraba otro, esto lo
    // reemplaza: es intencional, evita accesos cruzados olvidados.
    await admin.auth().setCustomUserClaims(user.uid, claims);

    // El token del cliente sigue teniendo los claims viejos hasta que se
    // refresca. El frontend tiene que llamar a getIdToken(true) — o cerrar y
    // volver a abrir sesión — para que tomen efecto.
    return { status: 'applied', uid: user.uid };
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      await db.doc(`pendingAdmins/${normalizedEmail}`).set({
        ...claims,
        email: normalizedEmail,
        name,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { status: 'pending', message: 'Se aplicará en su primer login con Google.' };
    }
    throw err;
  }
});

/** Le quita todo acceso administrativo a un mail. */
exports.revokeBusinessAdmin = onCall(async (request) => {
  assertPlatform(request);

  const { email, businessId } = request.data || {};
  if (!email || !businessId) {
    throw new HttpsError('invalid-argument', 'Faltan email o businessId.');
  }

  const normalizedEmail = String(email).trim().toLowerCase();

  await db.doc(`businesses/${businessId}/admins/${normalizedEmail}`).delete();
  await db.doc(`pendingAdmins/${normalizedEmail}`).delete().catch(() => {});

  try {
    const user = await admin.auth().getUserByEmail(normalizedEmail);
    await admin.auth().setCustomUserClaims(user.uid, {});
    // Corta las sesiones abiertas: sin esto, su token actual sigue siendo
    // válido hasta una hora después.
    await admin.auth().revokeRefreshTokens(user.uid);
    return { status: 'revoked' };
  } catch (err) {
    if (err.code === 'auth/user-not-found') return { status: 'not-found' };
    throw err;
  }
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
  await admin.auth().setCustomUserClaims(request.auth.uid, {
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
