// ============================================================================
// Mercado Pago — seña del turno, cobrada por el barbero
// ============================================================================
// Modelo: OAuth ("marketplace"). El dueño conecta SU cuenta de Mercado Pago y
// nos autoriza a crear cobros en su nombre. La plata entra DIRECTO a su cuenta:
// nunca pasa por una cuenta de la plataforma.
//
// Esto no es un detalle técnico, es la decisión de fondo (27/09/2026): el que
// cobra es el barbero, así que el cobro figura bajo SU CUIT, las retenciones
// se las hacen a él y el comprobante lo emite él. La plataforma es el software
// que arma el link de pago y no toca el dinero. Sin comisión por ahora
// (`marketplace_fee` en 0): en cuanto se cobre una, esa comisión sí sería
// ingreso de la plataforma, con todo lo que eso implica.
//
// Qué vive dónde:
//   businesses/{id}                      → mpConectado, mpUserId, sena (público)
//   businesses/{id}/private/mercadopago  → access_token y refresh_token
//                                          (Rules: nadie desde el browser)
//
// El access token dura ~6 meses y viene con refresh_token; `tokenDe()` lo
// renueva solo cuando está por vencer.

const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const logger = require('firebase-functions/logger');

const MP_CLIENT_ID = defineSecret('MP_CLIENT_ID');
const MP_CLIENT_SECRET = defineSecret('MP_CLIENT_SECRET');

// La región va explícita en cada función: este módulo se carga antes que
// `setGlobalOptions` de index.js, así que sin esto se despliegan en
// us-central1 —otra URL— y el rewrite de Vercel apunta a southamerica-east1.
const REGION = 'southamerica-east1';

const API = 'https://api.mercadopago.com';
const SITIO = process.env.SITIO_URL || 'https://barberos.sacia.tech';
const REDIRECT_URI = `${SITIO}/api/mp/callback`;

const db = () => getFirestore();
const privado = (bizId) => db().doc(`businesses/${bizId}/private/mercadopago`);

/** Lo mismo que hace el resto del archivo: sin sesión no se habla. */
function exigirDueno(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Tenés que iniciar sesión.');
  const claims = request.auth.token || {};
  const businessId = claims.businessId;
  if (!businessId || claims.role !== 'owner') {
    throw new HttpsError('permission-denied', 'Solo el dueño de la barbería puede tocar el cobro.');
  }
  return businessId;
}

async function pedirMP(ruta, { metodo = 'GET', token, cuerpo, idempotencia } = {}) {
  const res = await fetch(`${API}${ruta}`, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(idempotencia ? { 'X-Idempotency-Key': idempotencia } : {}),
    },
    ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
  });
  const datos = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detalle = datos.message || datos.error || res.statusText;
    const err = new Error(`Mercado Pago (${res.status}): ${detalle}`);
    err.status = res.status;
    err.datos = datos;
    throw err;
  }
  return datos;
}

/**
 * El access token vigente de una barbería, renovándolo si está por vencer.
 * Devuelve null si nunca conectó (o si nos revocó el permiso).
 */
async function tokenDe(bizId) {
  const snap = await privado(bizId).get();
  if (!snap.exists) return null;
  const d = snap.data();
  if (!d.accessToken) return null;

  const faltanMenosDeUnDia = !d.expiraEn || d.expiraEn.toMillis() - Date.now() < 86400000;
  if (!faltanMenosDeUnDia) return d.accessToken;
  if (!d.refreshToken) return d.accessToken; // sin refresh, se usa hasta que falle

  try {
    const r = await pedirMP('/oauth/token', {
      metodo: 'POST',
      cuerpo: {
        grant_type: 'refresh_token',
        client_id: MP_CLIENT_ID.value(),
        client_secret: MP_CLIENT_SECRET.value(),
        refresh_token: d.refreshToken,
      },
    });
    await privado(bizId).set({
      accessToken: r.access_token,
      refreshToken: r.refresh_token || d.refreshToken,
      expiraEn: new Date(Date.now() + (r.expires_in || 15552000) * 1000),
      renovadoEn: FieldValue.serverTimestamp(),
    }, { merge: true });
    return r.access_token;
  } catch (err) {
    logger.error('no se pudo renovar el token de Mercado Pago', { bizId, error: err.message });
    return d.accessToken;
  }
}

// ── 1. Conectar ─────────────────────────────────────────────────────────────

/**
 * Devuelve la URL a la que mandar al dueño para que autorice con su cuenta.
 * El `state` lleva el businessId firmado por el tiempo: el callback tiene que
 * saber de quién es la autorización, y no puede confiar en lo que le manden.
 */
exports.urlConectarMercadoPago = onCall(
  { region: REGION, secrets: [MP_CLIENT_ID] },
  async (request) => {
    const businessId = exigirDueno(request);
    const clientId = MP_CLIENT_ID.value();
    if (!clientId) throw new HttpsError('failed-precondition', 'Falta configurar Mercado Pago en la plataforma.');

    // El state se guarda para poder verificarlo en el callback y que expire.
    const ref = db().collection('mpEstados').doc();
    await ref.set({
      businessId,
      uid: request.auth.uid,
      creadoEn: FieldValue.serverTimestamp(),
      usado: false,
    });

    const url = `https://auth.mercadopago.com.ar/authorization?client_id=${encodeURIComponent(clientId)}`
      + `&response_type=code&platform_id=mp&state=${encodeURIComponent(ref.id)}`
      + `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
    return { url };
  }
);

/**
 * Adonde vuelve Mercado Pago después de que el dueño autoriza. Es un endpoint
 * HTTP y no un callable porque lo abre el navegador, no la app.
 */
exports.callbackMercadoPago = onRequest(
  { region: REGION, secrets: [MP_CLIENT_ID, MP_CLIENT_SECRET], cors: false },
  async (req, res) => {
    const volver = (mensaje, ok = false) => {
      const destino = `${SITIO}/admin/configuracion?mp=${ok ? 'ok' : 'error'}`
        + (mensaje ? `&detalle=${encodeURIComponent(mensaje)}` : '');
      res.redirect(302, destino);
    };

    const { code, state, error } = req.query;
    if (error) return volver('Cancelaste la autorización en Mercado Pago.');
    if (!code || !state) return volver('Faltaron datos en la vuelta de Mercado Pago.');

    const estadoRef = db().doc(`mpEstados/${state}`);
    const estado = await estadoRef.get();
    if (!estado.exists || estado.data().usado) return volver('Ese enlace ya se usó. Probá de nuevo.');

    // Media hora de vida: un `state` viejo dando vueltas no sirve para nada.
    const creado = estado.data().creadoEn?.toMillis?.() || 0;
    if (Date.now() - creado > 30 * 60 * 1000) return volver('El enlace venció. Probá de nuevo.');

    const businessId = estado.data().businessId;
    try {
      const r = await pedirMP('/oauth/token', {
        metodo: 'POST',
        cuerpo: {
          grant_type: 'authorization_code',
          client_id: MP_CLIENT_ID.value(),
          client_secret: MP_CLIENT_SECRET.value(),
          code,
          redirect_uri: REDIRECT_URI,
        },
      });

      await privado(businessId).set({
        accessToken: r.access_token,
        refreshToken: r.refresh_token || null,
        mpUserId: String(r.user_id || ''),
        publicKey: r.public_key || null,
        expiraEn: new Date(Date.now() + (r.expires_in || 15552000) * 1000),
        conectadoEn: FieldValue.serverTimestamp(),
      }, { merge: true });

      // Lo público: solo que está conectado. Sin esto el panel no sabe nada.
      await db().doc(`businesses/${businessId}`).set({
        mpConectado: true,
        mpUserId: String(r.user_id || ''),
      }, { merge: true });

      await estadoRef.set({ usado: true, usadoEn: FieldValue.serverTimestamp() }, { merge: true });
      logger.info('Mercado Pago conectado', { businessId, mpUserId: String(r.user_id || '') });
      return volver('', true);
    } catch (err) {
      logger.error('falló la conexión con Mercado Pago', { businessId, error: err.message });
      return volver('No se pudo completar la conexión. Probá de nuevo.');
    }
  }
);

exports.desconectarMercadoPago = onCall({ region: REGION }, async (request) => {
  const businessId = exigirDueno(request);
  await privado(businessId).delete().catch(() => {});
  await db().doc(`businesses/${businessId}`).set({
    mpConectado: false,
    mpUserId: FieldValue.delete(),
    // Si se desconecta la cuenta, no puede quedar pidiendo una seña que no
    // puede cobrar: el cliente quedaría trabado sin poder reservar.
    sena: { activa: false, monto: 0 },
  }, { merge: true });
  logger.info('Mercado Pago desconectado', { businessId });
  return { ok: true };
});

module.exports.tokenDe = tokenDe;
module.exports.pedirMP = pedirMP;
module.exports.MP_CLIENT_ID = MP_CLIENT_ID;
module.exports.MP_CLIENT_SECRET = MP_CLIENT_SECRET;

// ── 2. Cobrar la seña ───────────────────────────────────────────────────────

/**
 * Crea la preferencia de pago EN LA CUENTA DEL BARBERO y devuelve el link.
 *
 * `external_reference` lleva el id del turno: es lo que después ata el pago que
 * avisa el webhook con el turno que hay que confirmar. Sin eso, un pago que
 * llega no se sabe de quién es.
 */
async function crearPagoDeSena({ businessId, appointmentId, monto, titulo, emailCliente, slug }) {
  const token = await tokenDe(businessId);
  if (!token) throw new Error('La barbería no tiene Mercado Pago conectado.');

  const vuelta = `${SITIO}/${slug}/confirmacion`;
  const pref = await pedirMP('/checkout/preferences', {
    metodo: 'POST',
    token,
    idempotencia: appointmentId, // dos clics en "pagar" no crean dos cobros
    cuerpo: {
      items: [{
        id: appointmentId,
        title: String(titulo).slice(0, 250),
        quantity: 1,
        currency_id: 'ARS',
        unit_price: Number(monto),
      }],
      ...(emailCliente ? { payer: { email: emailCliente } } : {}),
      external_reference: `${businessId}:${appointmentId}`,
      notification_url: `${SITIO}/api/mp/webhook`,
      back_urls: { success: vuelta, pending: vuelta, failure: `${SITIO}/${slug}` },
      auto_return: 'approved',
      // La seña es de ahora: un link que vive medio día no tiene sentido.
      expires: true,
      expiration_date_to: new Date(Date.now() + 30 * 60000).toISOString(),
      statement_descriptor: 'SENA TURNO',
    },
  });

  return { preferenceId: pref.id, url: pref.init_point || pref.sandbox_init_point };
}

/**
 * Avisos de Mercado Pago. Es la ÚNICA fuente que confirma un pago: lo que diga
 * la vuelta del navegador no vale, porque cualquiera puede escribir esa URL a
 * mano y quedarse con el turno sin pagar.
 *
 * Se le vuelve a preguntar a Mercado Pago por el pago (con el token del
 * barbero) en vez de creerle al cuerpo del aviso, que no viene firmado.
 */
exports.webhookMercadoPago = onRequest(
  { region: REGION, secrets: [MP_CLIENT_ID, MP_CLIENT_SECRET], cors: false },
  async (req, res) => {
    // Mercado Pago reintenta si no le contestás 200 rápido. Cualquier problema
    // nuestro se loguea, pero la respuesta es 200 igual: con un error reintenta
    // durante horas algo que no se va a arreglar solo.
    res.status(200).send('ok');

    try {
      const tipo = req.query.type || req.query.topic || req.body?.type;
      const pagoId = req.query['data.id'] || req.body?.data?.id || req.query.id;
      if (tipo !== 'payment' || !pagoId) return;

      // Para leer el pago hace falta el token del vendedor, así que primero hay
      // que saber de qué barbería es. El aviso trae el user_id de Mercado Pago.
      const vendedor = String(req.query.user_id || req.body?.user_id || '');
      let bizId = null;
      if (vendedor) {
        const q = await db().collection('businesses').where('mpUserId', '==', vendedor).limit(1).get();
        if (!q.empty) bizId = q.docs[0].id;
      }
      if (!bizId) {
        logger.warn('aviso de Mercado Pago sin barbería', { vendedor, pagoId: String(pagoId) });
        return;
      }

      const token = await tokenDe(bizId);
      if (!token) return;

      const pago = await pedirMP(`/v1/payments/${pagoId}`, { token });
      const ref = String(pago.external_reference || '');
      const [refBiz, appointmentId] = ref.split(':');
      if (!appointmentId || refBiz !== bizId) {
        logger.warn('pago sin referencia válida', { pagoId: String(pagoId), ref, bizId });
        return;
      }

      const turnoRef = db().doc(`businesses/${bizId}/appointments/${appointmentId}`);
      const turno = await turnoRef.get();
      if (!turno.exists) {
        logger.warn('pago de un turno que no existe', { pagoId: String(pagoId), bizId, appointmentId });
        return;
      }

      if (pago.status === 'approved') {
        // Se confirma aunque la reserva haya vencido: el cliente pagó, el lugar
        // es suyo. Si mientras tanto otro tomó el horario lo va a ver el
        // barbero en la agenda y lo resuelve; es mejor que quedarse con la
        // plata de alguien sin darle el turno.
        await turnoRef.update({
          status: 'pendiente',
          'sena.estado': 'pagada',
          'sena.paymentId': String(pago.id),
          'sena.pagadaEn': FieldValue.serverTimestamp(),
          senaExpiraEn: FieldValue.delete(),
        });
        logger.info('seña pagada', { bizId, appointmentId, pagoId: String(pago.id), monto: pago.transaction_amount });
      } else if (['rejected', 'cancelled'].includes(pago.status)) {
        await turnoRef.update({ 'sena.estado': 'rechazada', 'sena.paymentId': String(pago.id) });
        logger.info('seña rechazada', { bizId, appointmentId, estado: pago.status });
      }
    } catch (err) {
      logger.error('falló el aviso de Mercado Pago', { error: err.message });
    }
  }
);

// ── 3. Devolver la seña ─────────────────────────────────────────────────────

/**
 * Devolución total, decidida por el barbero desde el panel. La plata sale de SU
 * cuenta, así que la decisión es suya: no hay devolución automática.
 */
exports.devolverSena = onCall(
  { region: REGION, secrets: [MP_CLIENT_ID, MP_CLIENT_SECRET] },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Tenés que iniciar sesión.');
    const claims = request.auth.token || {};
    const bizId = claims.businessId;
    const { appointmentId } = request.data || {};
    if (!bizId || !['owner', 'admin'].includes(claims.role)) {
      throw new HttpsError('permission-denied', 'Solo el staff de la barbería.');
    }
    if (!appointmentId) throw new HttpsError('invalid-argument', 'Falta el turno.');

    const ref = db().doc(`businesses/${bizId}/appointments/${appointmentId}`);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Ese turno no existe.');
    const turno = snap.data();

    // Un barbero solo toca lo suyo, igual que con el resto de la agenda.
    if (claims.role === 'admin' && turno.professionalId !== claims.professionalId) {
      throw new HttpsError('permission-denied', 'Ese turno no es tuyo.');
    }
    const pagoId = turno.sena?.paymentId;
    if (turno.sena?.estado !== 'pagada' || !pagoId) {
      throw new HttpsError('failed-precondition', 'Ese turno no tiene una seña pagada.');
    }

    const token = await tokenDe(bizId);
    if (!token) throw new HttpsError('failed-precondition', 'La cuenta de Mercado Pago está desconectada.');

    try {
      await pedirMP(`/v1/payments/${pagoId}/refunds`, {
        metodo: 'POST',
        token,
        idempotencia: `devolucion-${appointmentId}`,
        cuerpo: {},
      });
    } catch (err) {
      logger.error('no se pudo devolver la seña', { bizId, appointmentId, error: err.message });
      throw new HttpsError('unavailable', 'Mercado Pago no aceptó la devolución: ' + err.message);
    }

    await ref.update({
      'sena.estado': 'devuelta',
      'sena.devueltaEn': FieldValue.serverTimestamp(),
      'sena.devueltaPor': request.auth.uid,
    });
    logger.info('seña devuelta', { bizId, appointmentId, pagoId });
    return { ok: true };
  }
);

module.exports.crearPagoDeSena = crearPagoDeSena;
