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

  if (inicio < desde || fin > hasta) {
    throw new HttpsError('failed-precondition', 'Ese horario está fuera del horario de atención.');
  }

  if (horario.breakStart && horario.breakEnd) {
    const dStart = timeToMinutes(horario.breakStart), dEnd = timeToMinutes(horario.breakEnd);
    if (inicio < dEnd && fin > dStart) {
      throw new HttpsError('failed-precondition', 'Ese horario cae en el descanso del profesional.');
    }
  }

  // ── Solapamiento, en transacción ──────────────────────────────────────────
  // Va en transacción y no en un get suelto porque dos personas mirando la
  // misma grilla pueden apretar "confirmar" con milisegundos de diferencia: sin
  // esto, los dos leen "libre" y los dos escriben.
  const agenda = db.collection(`businesses/${businessId}/appointments`);
  const ref = agenda.doc();

  await db.runTransaction(async (tx) => {
    // Un turno activo por cliente por día en esta barbería. El front también lo
    // mira (hasAppointmentToday), pero eso se saltea con la consola abierta —
    // y de hecho estuvo roto un tiempo porque la lista de turnos del cliente
    // llegaba vacía. Acá es donde tiene que valer.
    const propios = await tx.get(
      agenda.where('userId', '==', request.auth.uid)
            .where('appointmentDate', '==', appointmentDate)
    );
    if (propios.docs.some((d) => ['pendiente', 'confirmada'].includes(d.data().status))) {
      throw new HttpsError('already-exists', 'Ya tenés un turno ese día. Si querés cambiarlo, cancelá el anterior primero.');
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
      clientEmail: String(clientEmail).slice(0, 120),
      notes: String(notes).slice(0, 500),
      status: 'pendiente',
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  return { status: 'created', id: ref.id, price: precio, endTime: minutesToTime(fin) };
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
  if (elegida !== null && String(elegida).length < 6) {
    throw new HttpsError('invalid-argument', 'La contraseña tiene que tener al menos 6 caracteres.');
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
  if (elegida !== null && String(elegida).length < 6) {
    throw new HttpsError('invalid-argument', 'La contraseña tiene que tener al menos 6 caracteres.');
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
