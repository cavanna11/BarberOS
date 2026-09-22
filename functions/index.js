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
  const claims = datos.platform === 'moderator'
    ? { platform: 'moderator' }
    : { businessId: datos.businessId, role: datos.role, professionalId: datos.professionalId ?? null };

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

  businesses.docs.forEach((doc, i) => {
    const biz = doc.data();

    // Cuenta de prueba: ni se cobra ni se congela hasta que termine. El
    // primer vencimiento se fija en trialEndsAt al darla de alta, así que al
    // día siguiente de vencer entra a cobrarse sola por el camino normal y
    // queda congelada — que es justamente lo que corta la prueba.
    if (biz.trialEndsAt && today <= biz.trialEndsAt) {
      enPrueba++;
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

    // `isFrozen` vive en el documento público porque las Rules y la página de
    // reservas lo necesitan para bloquear el link.
    const shouldFreeze = debt > 0;
    if (Boolean(biz.isFrozen) !== shouldFreeze) {
      escrituras.push({ ref: doc.ref, datos: { isFrozen: shouldFreeze }, merge: true });
      if (shouldFreeze) suspendidos.push({ id: doc.id, name: biz.name || doc.id, debt });
    }
  });

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
  for (const s of suspendidos) {
    await notificarPlataforma({
      type: 'cuenta_suspendida',
      title: 'Cuenta suspendida por deuda',
      body: `${s.name} quedó suspendida. Debe $${Number(s.debt).toLocaleString('es-AR')}.`,
      businessId: s.id,
      url: '/super-admin?tab=tenants',
    }).catch((err) => console.error('[billing] No se pudo avisar la suspensión:', err.message));
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

const FORMATO_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const FORMATO_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Hoy en Buenos Aires, como 'YYYY-MM-DD'. No sirve el hoy del servidor (UTC). */
function hoyEnArgentina() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

exports.createAppointment = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Tenés que iniciar sesión para reservar.');
  }

  const {
    businessId, professionalId, serviceId, appointmentDate, startTime,
    clientName = '', clientPhone = '', clientEmail = '', notes = '',
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

  // ── Solapamiento, en transacción ──────────────────────────────────────────
  // Va en transacción y no en un get suelto porque dos personas mirando la
  // misma grilla pueden apretar "confirmar" con milisegundos de diferencia: sin
  // esto, los dos leen "libre" y los dos escriben.
  const agenda = db.collection(`businesses/${businessId}/appointments`);
  const ref = agenda.doc();

  await db.runTransaction(async (tx) => {
    // Los turnos de este cliente en esta barbería, todos, en una sola lectura.
    // Se filtran en memoria en vez de con dos queries por rango porque un
    // where por userId + rango de fecha exigiría un índice compuesto, que el
    // emulador no pide y producción sí: pasaría todas las suites y fallaría
    // recién con el primer cliente real. Un cliente asiduo junta ~50 turnos
    // al año; leerlos es barato.
    const propios = await tx.get(agenda.where('userId', '==', request.auth.uid));
    const activos = propios.docs
      .map((d) => d.data())
      .filter((a) => a.status === 'pendiente' || a.status === 'confirmada');

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

    for (const d of delDia.docs) {
      const a = d.data();
      if (a.status !== 'pendiente' && a.status !== 'confirmada') continue;
      const aIni = timeToMinutes(a.startTime);
      const aFin = a.endTime ? timeToMinutes(a.endTime) : aIni;
      if (inicio < aFin && fin > aIni) {
        throw new HttpsError('already-exists', 'Ese horario ya fue tomado. Elegí otro.');
      }
    }

    tx.set(ref, {
      id: ref.id,
      businessId,
      userId: request.auth.uid,
      professionalId,
      serviceId,
      appointmentDate,
      startTime,
      endTime: minutesToTime(fin),
      // Del servicio, no del cliente.
      price: precio,
      durationMinutes: duracion,
      serviceName: servicio.name || '',
      clientName: String(clientName).slice(0, 120),
      clientPhone: String(clientPhone).slice(0, 40),
      // Del token, no del cliente: que no se registre un turno con el mail de otro.
      clientEmail: String(request.auth.token.email || clientEmail || '').slice(0, 120),
      notes: String(notes).slice(0, 500),
      status: 'pendiente',
      // Reservado por el cliente desde el link. Los que carga el staff llevan
      // type 'manual' o 'walkin'. Sirve para que el barbero sepa, de un
      // vistazo, cuál entró solo y cuál cargó él.
      origen: 'cliente',
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  return { status: 'created', id: ref.id, price: precio, endTime: minutesToTime(fin) };
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
    .filter((a) => a.status === 'pendiente' || a.status === 'confirmada')
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
  const mensaje = {
    tokens,
    data: {
      title: String(datos.title || 'BarberOS'),
      body: String(datos.body || ''),
      type: String(datos.type || ''),
      notificationId: String(datos.notificationId || ''),
      url: '/admin/citas',
    },
    webpush: {
      headers: { Urgency: 'high', TTL: '86400' },
      fcmOptions: { link: '/admin/citas' },
    },
  };

  let res;
  try {
    res = await getMessaging().sendEachForMulticast(mensaje);
  } catch (err) {
    console.error('[push] No se pudo enviar:', err.message);
    return;
  }

  const muertos = [];
  res.responses.forEach((r, i) => {
    if (r.success) return;
    const code = r.error?.code || '';
    if (code.includes('registration-token-not-registered') || code.includes('invalid-argument')) {
      muertos.push(tokens[i]);
    } else {
      console.warn('[push] Falló un envío:', code);
    }
  });
  await Promise.all(muertos.map((t) => db.doc(`businesses/${bizId}/devices/${t}`).delete().catch(() => {})));
}

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
      data: {
        title: String(datos.title || 'BarberOS'),
        body: String(datos.body || ''),
        type: String(datos.type || ''),
        notificationId: String(datos.notificationId || ''),
        url: String(datos.url || '/super-admin'),
      },
      webpush: { headers: { Urgency: 'high', TTL: '86400' }, fcmOptions: { link: String(datos.url || '/super-admin') } },
    });
  } catch (err) {
    console.error('[push plataforma] No se pudo enviar:', err.message);
    return;
  }
  const muertos = [];
  res.responses.forEach((r, i) => {
    if (r.success) return;
    const code = r.error?.code || '';
    if (code.includes('registration-token-not-registered') || code.includes('invalid-argument')) muertos.push(tokens[i]);
  });
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
    url: '/super-admin?tab=soporte',
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
    url: '/super-admin?tab=soporte',
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

  const resumen = { usuarios: 0, tickets: 0, pendientes: 0 };

  // 1. Claims: todos los usuarios cuyo businessId sea este. Se buscan en Auth
  //    y no solo en /admins, porque el registro de /admins puede estar
  //    incompleto y el claim es lo que da acceso.
  let pageToken;
  do {
    const page = await getAuth().listUsers(1000, pageToken);
    for (const u of page.users) {
      if (u.customClaims?.businessId === businessId) {
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

  const { email, enabled = true, name = '' } = request.data || {};
  if (!email) throw new HttpsError('invalid-argument', 'Falta el email.');

  const normalizedEmail = String(email).trim().toLowerCase();

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

  // Un dueño de plataforma no se degrada a moderador por acá. Si algún día hay
  // más de uno, se decide a mano.
  if (user?.customClaims?.platform === true) {
    throw new HttpsError('permission-denied', 'Esa cuenta ya es dueña de la plataforma.');
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
    role: 'moderator',
    addedAt: FieldValue.serverTimestamp(),
  });

  if (!user) {
    // Nunca entró: queda anotado y applyPendingClaims lo aplica en su primer
    // login. Se reutiliza el mismo mecanismo que los admins de barbería.
    await db.doc(`pendingAdmins/${normalizedEmail}`).set({
      platform: 'moderator',
      email: normalizedEmail,
      name,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { status: 'pending', message: 'Se aplicará en su primer login.' };
  }

  // Si administraba una barbería, esto lo reemplaza: una cuenta tiene UN rol.
  await getAuth().setCustomUserClaims(user.uid, { platform: 'moderator' });
  return { status: 'applied', uid: user.uid };
});

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
