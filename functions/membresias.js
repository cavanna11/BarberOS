// ============================================================================
// Membresías — planes mensuales que la barbería le vende a sus clientes
// ============================================================================
// El problema que resuelve no es "anotar quién es socio": es que un barbero no
// pueda declarar que un cliente usó su plan cuando en realidad le cobró el
// servicio en mano (o cuando el plan ni siquiera está pago). Por eso:
//
//   - El estado de la membresía lo escribe SOLO el servidor: lo trae Mercado
//     Pago (webhook + reconciliación diaria) o lo carga el dueño. Nunca el
//     barbero, nunca el cliente, nunca el browser (Rules en false).
//   - El uso lo elige el CLIENTE al reservar, desde su propia cuenta, y se
//     descuenta en la misma transacción que crea el turno. El barbero no tiene
//     un botón para "usar la membresía" de nadie. El único que puede aplicarla
//     a un turno después es el dueño, con motivo, y queda marcado en la
//     auditoría.
//   - Un uso por turno, por construcción: el id del documento del uso ES el id
//     del turno (mismo truco que las reseñas).
//
// Qué vive dónde (siempre en la barbería PRINCIPAL de la cuenta: la membresía
// es de la cuenta y se usa en cualquier sucursal, igual que el abono):
//
//   businesses/{cuenta}/membresiaPlanes/{planId}    lectura pública
//   businesses/{cuenta}/membresias/{id}             🔒 dueño, plataforma, el cliente la suya
//     /periodos/{periodoId}                         🔒 un mes pago con sus contadores
//   businesses/{cuenta}/membresiaUsos/{turnoId}     🔒 auditoría de consumos
//   businesses/{cuenta}/membresiaPagos/{id}         🔒 plata que entró por membresías
//   mpSuscripciones/{preapprovalId}                 🔒 índice para el webhook
//   mpPagos/{paymentId}                             🔒 índice para reintegros
//
// Mercado Pago: las suscripciones que ya existen se crearon en la cuenta del
// barbero, fuera de BarberOS, y no traen ninguna referencia a un cliente
// nuestro. Se VINCULAN a mano (el dueño o la plataforma eligen a quién
// corresponde) y desde ahí el estado lo manda Mercado Pago. Una membresía sin
// suscripción de MP (pago en efectivo, transferencia) también se puede cargar:
// la renueva el dueño a mano.
//
// Idempotencia: el webhook NO procesa eventos, procesa ESTADO. Ante cualquier
// aviso se le pregunta a Mercado Pago cómo está el recurso hoy y se aplica. Un
// aviso repetido no cambia nada; uno viejo que llega tarde aplica el estado
// actual. Los períodos llevan como id el del cobro de MP y se crean con
// `create`, así que el mismo cobro no puede abrir dos meses.

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const logger = require('firebase-functions/logger');
const mp = require('./mercadopago');

// Explícita: este módulo se carga antes que `setGlobalOptions` de index.js
// (misma trampa que mercadopago.js).
const REGION = 'southamerica-east1';
const OPCIONES = { region: REGION, maxInstances: 10 };
const CON_MP = { ...OPCIONES, secrets: [mp.MP_CLIENT_ID, mp.MP_CLIENT_SECRET] };

const db = () => getFirestore();

// ── Estados ────────────────────────────────────────────────────────────────
//
//   pendiente       vinculada a una suscripción de MP que todavía no cobró
//   activa          al día
//   pausada         el cliente pausó la suscripción en MP
//   pago_rechazado  MP no pudo cobrar la cuota (reintenta solo unos días)
//   cancelada       dada de baja: no se renueva más
//   vencida         se terminó el último mes pago y no entró otro
//   reemplazada     cambió de plan: la reemplaza otra membresía
//
// Lo que ya se pagó se respeta: una membresía cancelada, pausada o con la
// cuota siguiente rechazada se puede seguir usando hasta el último día del mes
// que SÍ pagó. Lo que decide si hay beneficio es el período, no la etiqueta.
const USABLES = ['activa', 'pausada', 'pago_rechazado', 'cancelada'];
// Las que cuentan para "un cliente, una membresía": la cancelada no, porque
// darse de baja y contratar otra el mismo mes es un caso real.
const VIVAS = ['pendiente', 'activa', 'pausada', 'pago_rechazado'];
const FINALES = ['vencida', 'reemplazada'];

// Días que se espera la cuota siguiente antes de dar la membresía por vencida.
// Mercado Pago reintenta los cobros rechazados durante unos días.
const DIAS_DE_GRACIA = 3;

const ESTADO_DESDE_MP = {
  authorized: 'activa',
  paused: 'pausada',
  cancelled: 'cancelada',
  pending: 'pendiente',
};

// ── Fechas ('YYYY-MM-DD', igual que appointmentDate) ───────────────────────
// Nada de Date en hora local: el servidor corre en UTC y a partir de las 21 en
// Argentina ya sería mañana.

const FORMATO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

function hoyEnArgentina() {
  return fechaArgentina(new Date());
}

function fechaArgentina(fecha) {
  const d = fecha instanceof Date ? fecha : new Date(fecha);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

function sumarDias(fecha, n) {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Último día de un mes que arranca en `desde`: el mismo día del mes siguiente,
 * menos uno. 05/08 → 04/09. Si el mes siguiente es más corto, se recorta:
 * 31/01 → 27/02 (28/02 menos uno).
 */
function finDePeriodo(desde) {
  const [y, m, d] = desde.split('-').map(Number); // m: 1..12
  const ultimoDelSiguiente = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const mismoDia = new Date(Date.UTC(y, m, Math.min(d, ultimoDelSiguiente), 12));
  return sumarDias(mismoDia.toISOString().slice(0, 10), -1);
}

// ── Permisos ───────────────────────────────────────────────────────────────

/**
 * El dueño (de la barbería pedida o de cualquiera de su cuenta) o el dueño de
 * la plataforma. Un barbero NO: no carga, no renueva, no aplica, no revierte.
 * Un moderador tampoco: no toca plata.
 */
function exigirDueno(request, businessIdPedido) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Tenés que iniciar sesión.');
  const c = request.auth.token || {};
  const id = String(businessIdPedido || c.businessId || '').trim();
  if (!id) throw new HttpsError('invalid-argument', 'Falta la barbería.');
  if (c.platform === true) return id;
  if (c.role === 'owner' && (c.businessId === id || (c.businessIds || []).includes(id))) return id;
  throw new HttpsError('permission-denied', 'Solo el dueño de la barbería puede gestionar membresías.');
}

/** La barbería principal de la cuenta: donde viven las membresías. */
async function cuentaDe(businessId) {
  const snap = await db().doc(`businesses/${businessId}`).get();
  if (!snap.exists) throw new HttpsError('not-found', 'La barbería no existe.');
  return snap.data().grupoId || businessId;
}

/**
 * Las membresías se habilitan cuenta por cuenta (las prende la plataforma en el
 * documento de la principal; el dueño no puede tocar ese campo). Sin esto, ni
 * planes ni cargas: la función no existe para esa cuenta.
 */
async function exigirHabilitadas(cuentaId) {
  const snap = await db().doc(`businesses/${cuentaId}`).get();
  if (snap.data()?.membresiasHabilitadas !== true) {
    throw new HttpsError('failed-precondition', 'Las membresías no están habilitadas en esta cuenta. Escribinos para activarlas.');
  }
}

/** Las barberías de la cuenta (la principal y sus sucursales). */
async function barberiasDeLaCuenta(cuentaId) {
  const g = await db().doc(`grupos/${cuentaId}`).get();
  const ids = g.exists ? (g.data().businessIds || []) : [];
  return ids.includes(cuentaId) ? ids : [cuentaId, ...ids];
}

const col = (cuentaId, nombre) => db().collection(`businesses/${cuentaId}/${nombre}`);
const normalizarEmail = (e) => String(e || '').trim().toLowerCase();

// ── Lógica pura del beneficio ──────────────────────────────────────────────

/**
 * ¿Qué beneficio del período cubre este servicio, y le quedan usos?
 *
 * Un beneficio es un grupo de servicios que comparten cupo: "4 cortes por
 * mes" en una cuenta con sucursales es el corte de cada sucursal (cada uno
 * con su id), y los cuatro descuentan del mismo 4. `usos: null` = ilimitado.
 * `usosTotales` es un tope general opcional, por encima de cada beneficio.
 *
 * Devuelve { beneficio } o { error } con el mensaje para el cliente.
 */
function beneficioPara(periodo, sucursalId, serviceId) {
  const beneficios = periodo.beneficios || [];
  const candidatos = beneficios.filter((b) => (b.servicios || [])
    .some((s) => s.businessId === sucursalId && s.serviceId === serviceId));
  if (candidatos.length === 0) return { error: 'Esta membresía no incluye este servicio.' };

  const usados = periodo.usadosPorBeneficio || {};
  const tope = periodo.usosTotales;
  if (tope != null && (periodo.usados || 0) >= tope) {
    return { error: 'No quedan usos disponibles este mes.' };
  }
  const libre = candidatos.find((b) => b.usos == null || (usados[b.id] || 0) < b.usos);
  if (!libre) return { error: 'No quedan usos disponibles este mes.' };
  return { beneficio: libre };
}

/** El período pago que cubre una fecha, o null. */
function periodoQueCubre(periodos, fecha) {
  return periodos.find((p) => p.estado === 'vigente' && p.desde <= fecha && fecha <= p.hasta) || null;
}

/** Copia de los términos del plan que se congela en cada período. */
function terminosDelPlan(plan) {
  return {
    beneficios: (plan.beneficios || []).map((b) => ({
      id: b.id,
      nombre: b.nombre,
      usos: b.usos == null ? null : Number(b.usos),
      servicios: (b.servicios || []).map((s) => ({ businessId: s.businessId, serviceId: s.serviceId })),
    })),
    usosTotales: plan.usosTotales == null ? null : Number(plan.usosTotales),
  };
}

// ── Uso dentro de una transacción ──────────────────────────────────────────

/**
 * Lecturas para usar la membresía en un turno. Va DENTRO de la transacción del
 * turno: dos reservas simultáneas por el último uso leen el mismo contador y
 * Firestore reintenta una, que ve el contador ya actualizado y falla con "no
 * quedan usos". Sin transacción, las dos pasarían.
 *
 * Firestore exige todas las lecturas antes de la primera escritura: por eso
 * esto solo LEE y devuelve lo que hay que escribir; `escribirUso` escribe.
 *
 * Valida, en este orden: que haya membresía del cliente en esta cuenta, que su
 * estado permita usarla, que haya un mes pago que cubra la FECHA DEL TURNO, que
 * el plan incluya este servicio en esta sucursal, y que queden usos.
 */
async function prepararUso(tx, {
  cuentaId, sucursalId, serviceId, appointmentDate,
  clienteUid = null, clienteEmail = null, membresiaId = null,
}) {
  let candidatas = [];
  if (membresiaId) {
    const s = await tx.get(col(cuentaId, 'membresias').doc(membresiaId));
    if (s.exists) candidatas.push(s);
  } else {
    const consultas = [];
    if (clienteUid) consultas.push(tx.get(col(cuentaId, 'membresias').where('clienteUid', '==', clienteUid)));
    if (clienteEmail) consultas.push(tx.get(col(cuentaId, 'membresias').where('clienteEmail', '==', clienteEmail)));
    const vistos = new Set();
    for (const q of await Promise.all(consultas)) {
      for (const d of q.docs) if (!vistos.has(d.id)) { vistos.add(d.id); candidatas.push(d); }
    }
  }

  // Una que ya está atada a OTRA cuenta de Google no se puede usar con el mail.
  candidatas = candidatas.filter((d) => {
    const m = d.data();
    return !m.clienteUid || !clienteUid || m.clienteUid === clienteUid || membresiaId;
  });
  if (candidatas.length === 0) throw new HttpsError('failed-precondition', 'No tenés una membresía en esta barbería.');

  const usables = candidatas.filter((d) => USABLES.includes(d.data().estado));
  if (usables.length === 0) throw new HttpsError('failed-precondition', 'La membresía no está activa.');

  // Entre las usables (normalmente una), la que tenga un mes pago que cubra el día.
  let elegida = null;
  let periodoSnap = null;
  let ultimoHasta = null;
  for (const d of usables) {
    const ps = await tx.get(d.ref.collection('periodos').where('hasta', '>=', appointmentDate));
    const lista = ps.docs.map((p) => ({ id: p.id, ...p.data() }));
    const p = periodoQueCubre(lista, appointmentDate);
    if (p) { elegida = d; periodoSnap = ps.docs.find((x) => x.id === p.id); break; }
    const h = d.data().periodoActual?.hasta;
    if (h && (!ultimoHasta || h > ultimoHasta)) ultimoHasta = h;
  }
  if (!elegida) {
    throw new HttpsError('failed-precondition', ultimoHasta && ultimoHasta < appointmentDate
      ? `Tu membresía cubre turnos hasta el ${ultimoHasta.split('-').reverse().join('/')}. Para después, reservá cuando se renueve.`
      : 'La membresía no está activa.');
  }

  const periodo = periodoSnap.data();
  const r = beneficioPara(periodo, sucursalId, serviceId);
  if (r.error) throw new HttpsError('failed-precondition', r.error);

  return { membresiaSnap: elegida, periodoSnap, beneficio: r.beneficio, clienteUid };
}

/**
 * Escribe el uso preparado. Devuelve el snapshot que va en el turno.
 * `estado`: 'reservado' al reservar; 'consumido' si el dueño lo aplica a un
 * turno ya atendido.
 */
function escribirUso(tx, preparado, {
  cuentaId, appointmentId, sucursalId, professionalId, serviceId, serviceName,
  valorServicio, appointmentDate, origen, registradoPor, motivo = null, estado = 'reservado',
  usoAnterior = null,
}) {
  const { membresiaSnap, periodoSnap, beneficio, clienteUid } = preparado;
  const m = membresiaSnap.data();
  const periodo = periodoSnap.data();

  tx.update(periodoSnap.ref, {
    usados: (periodo.usados || 0) + 1,
    [`usadosPorBeneficio.${beneficio.id}`]: ((periodo.usadosPorBeneficio || {})[beneficio.id] || 0) + 1,
  });

  // Primera vez que el cliente la usa con su cuenta de Google: queda atada a ese
  // uid y desde ahí no la puede usar otra cuenta aunque tenga el mismo mail.
  if (!m.clienteUid && clienteUid) tx.update(membresiaSnap.ref, { clienteUid });

  const ahora = new Date();
  // Un turno tiene a lo sumo UN uso vivo. Si ya tuvo uno (liberado o
  // revertido) y se vuelve a aplicar, se pisa el documento pero se conserva
  // su historia en `eventos`: la auditoría no pierde que hubo un ida y vuelta.
  const usoRef = col(cuentaId, 'membresiaUsos').doc(appointmentId);
  const eventosPrevios = usoAnterior?.eventos || [];
  (usoAnterior ? tx.set.bind(tx) : tx.create.bind(tx))(usoRef, {
    id: appointmentId,
    appointmentId,
    membresiaId: membresiaSnap.id,
    periodoId: periodoSnap.id,
    planId: m.planId || null,
    planNombre: m.plan?.nombre || '',
    beneficioId: beneficio.id,
    beneficioNombre: beneficio.nombre || '',
    clienteUid: m.clienteUid || clienteUid || null,
    clienteNombre: m.clienteNombre || '',
    clienteEmail: m.clienteEmail || '',
    sucursalId,
    professionalId: professionalId || null,
    serviceId,
    serviceName: serviceName || '',
    valorServicio: Number(valorServicio) || 0,
    appointmentDate,
    estado,
    origen,
    registradoPor,
    motivo,
    requiereRevision: null,
    creadoEn: FieldValue.serverTimestamp(),
    eventos: [...eventosPrevios, { estado, en: ahora, por: registradoPor.uid, motivo }],
  });

  return {
    membresiaId: membresiaSnap.id,
    usoId: appointmentId,
    planNombre: m.plan?.nombre || '',
    beneficioNombre: beneficio.nombre || '',
    valorServicio: Number(valorServicio) || 0,
    estado,
    origen,
  };
}

/**
 * Cambia el estado de un uso y, si lo saca del cupo, devuelve el uso al
 * período. Transaccional e idempotente: si el uso ya no está en `desde`, no
 * hace nada (el trigger puede correr dos veces sobre el mismo cambio).
 */
async function cambiarEstadoDelUso(cuentaId, usoId, { desde, hacia, por, motivo = null, devolverCupo, turnoRef = null, revision = undefined }) {
  return db().runTransaction(async (tx) => {
    const usoRef = col(cuentaId, 'membresiaUsos').doc(usoId);
    const uso = await tx.get(usoRef);
    if (!uso.exists) return false;
    const u = uso.data();
    if (!desde.includes(u.estado)) return false;

    const periodoRef = col(cuentaId, 'membresias').doc(u.membresiaId).collection('periodos').doc(u.periodoId);
    const periodo = devolverCupo ? await tx.get(periodoRef) : null;

    if (devolverCupo && periodo?.exists) {
      const p = periodo.data();
      tx.update(periodoRef, {
        usados: Math.max(0, (p.usados || 0) - 1),
        [`usadosPorBeneficio.${u.beneficioId}`]: Math.max(0, ((p.usadosPorBeneficio || {})[u.beneficioId] || 0) - 1),
      });
    }
    tx.update(usoRef, {
      estado: hacia,
      ...(revision !== undefined ? { requiereRevision: revision } : {}),
      eventos: FieldValue.arrayUnion({ estado: hacia, en: new Date(), por, motivo }),
    });
    if (turnoRef) {
      tx.update(turnoRef, {
        'membresia.estado': hacia,
        // Revertido = el turno vuelve a ser un turno normal, que se cobra.
        ...(hacia === 'revertido' ? { price: Number(u.valorServicio) || 0 } : {}),
      });
    }
    return true;
  });
}

// ── Planes ─────────────────────────────────────────────────────────────────

/**
 * Crea o edita un plan. Por callable y no por escritura directa porque los
 * servicios de cada beneficio tienen que existir y ser de la cuenta: si no, un
 * plan podría "incluir" el servicio de otra barbería.
 *
 * Editar un plan NO cambia los meses ya pagos: cada período congela los
 * términos con los que se abrió. El cambio corre desde la próxima renovación.
 */
exports.guardarPlanMembresia = onCall(OPCIONES, async (request) => {
  const businessId = exigirDueno(request, request.data?.businessId);
  const cuentaId = await cuentaDe(businessId);
  await exigirHabilitadas(cuentaId);
  const d = request.data || {};

  const nombre = String(d.nombre || '').trim().slice(0, 80);
  if (!nombre) throw new HttpsError('invalid-argument', 'Poné un nombre al plan.');
  const precio = Number(d.precioMensual);
  if (!Number.isFinite(precio) || precio <= 0) throw new HttpsError('invalid-argument', 'El precio mensual tiene que ser mayor a cero.');
  const usosTotales = d.usosTotales === '' || d.usosTotales == null ? null : Number(d.usosTotales);
  if (usosTotales != null && (!Number.isInteger(usosTotales) || usosTotales < 1 || usosTotales > 100)) {
    throw new HttpsError('invalid-argument', 'El tope general de usos tiene que ser un número entre 1 y 100.');
  }

  const permitidas = new Set(await barberiasDeLaCuenta(cuentaId));
  const crudos = Array.isArray(d.beneficios) ? d.beneficios.slice(0, 20) : [];
  if (crudos.length === 0) throw new HttpsError('invalid-argument', 'El plan tiene que incluir al menos un servicio.');

  const beneficios = [];
  for (const [i, b] of crudos.entries()) {
    const usos = b.usos === '' || b.usos == null ? null : Number(b.usos);
    if (usos != null && (!Number.isInteger(usos) || usos < 1 || usos > 100)) {
      throw new HttpsError('invalid-argument', 'La cantidad de usos tiene que ser un número entre 1 y 100 (o vacío para ilimitado).');
    }
    const servicios = [];
    for (const s of (Array.isArray(b.servicios) ? b.servicios.slice(0, 20) : [])) {
      if (!permitidas.has(s.businessId)) throw new HttpsError('permission-denied', 'Un servicio del plan no es de esta cuenta.');
      const srv = await db().doc(`businesses/${s.businessId}/services/${s.serviceId}`).get();
      if (!srv.exists) throw new HttpsError('not-found', 'Un servicio del plan ya no existe.');
      servicios.push({ businessId: s.businessId, serviceId: s.serviceId, nombre: srv.data().name || '' });
    }
    if (servicios.length === 0) continue;
    beneficios.push({
      // El id se conserva al editar: es la clave de los contadores del mes.
      id: /^[a-z0-9-]{1,20}$/i.test(b.id || '') ? b.id : `b${i}-${Date.now().toString(36)}`,
      nombre: String(b.nombre || servicios[0].nombre || 'Servicio').trim().slice(0, 60),
      usos,
      servicios,
    });
  }
  if (beneficios.length === 0) throw new HttpsError('invalid-argument', 'El plan tiene que incluir al menos un servicio.');

  const ref = d.planId ? col(cuentaId, 'membresiaPlanes').doc(String(d.planId)) : col(cuentaId, 'membresiaPlanes').doc();
  if (d.planId && !(await ref.get()).exists) throw new HttpsError('not-found', 'Ese plan no existe.');

  await ref.set({
    id: ref.id,
    nombre,
    descripcion: String(d.descripcion || '').trim().slice(0, 400),
    precioMensual: precio,
    beneficios,
    usosTotales,
    activo: d.activo !== false,
    actualizadoEn: FieldValue.serverTimestamp(),
    ...(d.planId ? {} : { creadoEn: FieldValue.serverTimestamp() }),
  }, { merge: true });

  logger.info('plan de membresía guardado', { cuentaId, planId: ref.id, uid: request.auth.uid });
  return { id: ref.id, cuentaId };
});

// ── Cargar una membresía (vincular la que ya existe) ───────────────────────

/** Lee una suscripción de MP con el token de la cuenta y verifica que sea suya. */
async function leerPreapproval(cuentaId, preapprovalId) {
  const token = await mp.tokenDe(cuentaId);
  if (!token) throw new HttpsError('failed-precondition', 'Conectá Mercado Pago en la barbería principal para vincular suscripciones.');
  let pre;
  try {
    pre = await mp.pedirMP(`/preapproval/${encodeURIComponent(preapprovalId)}`, { token });
  } catch (err) {
    logger.warn('no se pudo leer la suscripción de MP', { cuentaId, preapprovalId, error: err.message });
    throw new HttpsError('not-found', 'No encontramos esa suscripción en tu cuenta de Mercado Pago.');
  }
  const negocio = (await db().doc(`businesses/${cuentaId}`).get()).data() || {};
  if (pre.collector_id && negocio.mpUserId && String(pre.collector_id) !== String(negocio.mpUserId)) {
    throw new HttpsError('permission-denied', 'Esa suscripción es de otra cuenta de Mercado Pago.');
  }
  return pre;
}

/**
 * Busca en la cuenta de Mercado Pago de la barbería las suscripciones de un
 * mail (o todas, si no se pasa), para elegir cuál vincular. Devuelve lo mínimo
 * para reconocerla: nunca el token ni datos de pago.
 */
exports.buscarSuscripcionesMP = onCall(CON_MP, async (request) => {
  const businessId = exigirDueno(request, request.data?.businessId);
  const cuentaId = await cuentaDe(businessId);
  const token = await mp.tokenDe(cuentaId);
  if (!token) throw new HttpsError('failed-precondition', 'Conectá Mercado Pago en la barbería principal para buscar suscripciones.');

  const email = normalizarEmail(request.data?.payerEmail);
  const params = new URLSearchParams({ limit: '50' });
  if (email) params.set('payer_email', email);
  let r;
  try {
    r = await mp.pedirMP(`/preapproval/search?${params}`, { token });
  } catch (err) {
    logger.warn('falló la búsqueda de suscripciones', { cuentaId, error: err.message });
    throw new HttpsError('unavailable', 'Mercado Pago no respondió. Probá de nuevo en un rato.');
  }
  const vinculadas = new Set((await col(cuentaId, 'membresias').where('mp.preapprovalId', '!=', null).get())
    .docs.map((d) => d.data().mp?.preapprovalId));

  return {
    suscripciones: (r.results || []).map((p) => ({
      id: String(p.id),
      motivo: p.reason || '',
      payerEmail: p.payer_email || '',
      estado: p.status || '',
      monto: p.auto_recurring?.transaction_amount ?? null,
      proximoCobro: p.next_payment_date ? fechaArgentina(p.next_payment_date) : null,
      creada: p.date_created ? fechaArgentina(p.date_created) : null,
      vinculada: vinculadas.has(String(p.id)),
    })),
  };
});

/**
 * Carga la membresía de un cliente. Es el camino para las que ya existen: el
 * dueño (o la plataforma) las tiene anotadas y las pasa una por una.
 *
 * El cliente se identifica por el MAIL con el que entra a BarberOS (Google).
 * Si todavía no entró nunca, queda esperando: la primera vez que reserva con
 * ese mail verificado, la membresía se ata a su cuenta. Mismo mecanismo que
 * los permisos pendientes del staff, y con la misma exigencia de mail
 * verificado.
 *
 * Con `preapprovalId`, el estado lo manda Mercado Pago desde ese momento. Sin
 * él, es una membresía "manual" (efectivo, transferencia) que se renueva a
 * mano con `renovarMembresia`.
 *
 * `reemplazaA`: cambio de plan. La anterior pasa a 'reemplazada' y su mes en
 * curso se cierra el día antes de que arranque la nueva. Sin prorrateo: lo que
 * ya consumió en el mes viejo queda ahí, en su historial.
 */
exports.cargarMembresia = onCall(CON_MP, async (request) => {
  const businessId = exigirDueno(request, request.data?.businessId);
  const cuentaId = await cuentaDe(businessId);
  await exigirHabilitadas(cuentaId);
  const d = request.data || {};

  const clienteEmail = normalizarEmail(d.clienteEmail);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clienteEmail)) {
    throw new HttpsError('invalid-argument', 'Poné el mail con el que el cliente entra a reservar.');
  }
  const clienteNombre = String(d.clienteNombre || '').trim().slice(0, 120);
  if (!clienteNombre) throw new HttpsError('invalid-argument', 'Poné el nombre del cliente.');

  const planSnap = await col(cuentaId, 'membresiaPlanes').doc(String(d.planId || '')).get();
  if (!planSnap.exists) throw new HttpsError('not-found', 'Ese plan no existe.');
  const plan = planSnap.data();
  if (plan.activo === false) throw new HttpsError('failed-precondition', 'Ese plan está desactivado.');

  const hoy = hoyEnArgentina();
  const desde = d.desde ? String(d.desde) : hoy;
  if (!FORMATO_FECHA.test(desde)) throw new HttpsError('invalid-argument', 'La fecha de inicio no es válida.');
  const hasta = d.hasta ? String(d.hasta) : finDePeriodo(desde);
  if (!FORMATO_FECHA.test(hasta) || hasta < desde) throw new HttpsError('invalid-argument', 'La fecha de fin del mes pago no es válida.');
  if (hasta < hoy) throw new HttpsError('invalid-argument', 'Ese mes ya terminó: cargá el mes que está pago ahora.');

  // ¿Ya tiene una viva? Un cliente, una membresía (salvo cambio de plan).
  const previas = await col(cuentaId, 'membresias').where('clienteEmail', '==', clienteEmail).get();
  const reemplazaA = d.reemplazaA ? String(d.reemplazaA) : null;
  const otraViva = previas.docs.find((x) => VIVAS.includes(x.data().estado) && x.id !== reemplazaA);
  if (otraViva) {
    throw new HttpsError('already-exists', `${clienteEmail} ya tiene una membresía (${otraViva.data().plan?.nombre || 'otro plan'}). Para cambiarle el plan, usá "Cambiar plan".`);
  }
  if (reemplazaA && !previas.docs.some((x) => x.id === reemplazaA)) {
    throw new HttpsError('not-found', 'La membresía a reemplazar no es de ese cliente.');
  }

  // Mercado Pago, si viene.
  const preapprovalId = d.preapprovalId ? String(d.preapprovalId).trim() : null;
  let pre = null;
  if (preapprovalId) pre = await leerPreapproval(cuentaId, preapprovalId);

  // ¿Ya entró alguna vez con ese mail? Se ata ahora; si no, en su primera reserva.
  let clienteUid = null;
  try {
    const u = await getAuth().getUserByEmail(clienteEmail);
    if (u.emailVerified) clienteUid = u.uid;
  } catch { /* todavía no entró: queda pendiente de atarse */ }

  const ref = col(cuentaId, 'membresias').doc();
  const terminos = terminosDelPlan(plan);
  const por = request.auth.uid;
  const ahora = new Date();
  const monto = d.monto === '' || d.monto == null ? Number(plan.precioMensual) : Number(d.monto);
  const estadoInicial = pre ? (ESTADO_DESDE_MP[pre.status] || 'pendiente') : 'activa';
  // Una vinculada que en MP figura pendiente igual tiene el mes que el dueño
  // dice que está pago: se carga 'activa' si el mes ya está cubierto.
  const estado = pre && estadoInicial === 'pendiente' ? 'activa' : estadoInicial;

  await db().runTransaction(async (tx) => {
    const anterior = reemplazaA ? await tx.get(col(cuentaId, 'membresias').doc(reemplazaA)) : null;
    const periodosAnteriores = anterior ? await tx.get(anterior.ref.collection('periodos').where('hasta', '>=', desde)) : null;
    if (preapprovalId) {
      const idx = await tx.get(db().doc(`mpSuscripciones/${preapprovalId}`));
      // La misma suscripción puede pasar a la membresía nueva en un cambio de
      // plan (MP permite cambiar el monto); a otra membresía cualquiera, no.
      if (idx.exists && idx.data().membresiaId !== reemplazaA) {
        throw new HttpsError('already-exists', 'Esa suscripción de Mercado Pago ya está vinculada a otra membresía.');
      }
    }

    tx.set(ref, {
      id: ref.id,
      cuentaId,
      clienteUid,
      clienteEmail,
      clienteNombre,
      clienteTelefono: String(d.clienteTelefono || '').trim().slice(0, 40),
      planId: planSnap.id,
      plan: { nombre: plan.nombre, precioMensual: Number(plan.precioMensual), ...terminos },
      estado,
      origen: pre ? 'mercadopago' : 'manual',
      mp: pre ? {
        preapprovalId,
        payerEmail: pre.payer_email || null,
        estadoMP: pre.status || null,
        monto: pre.auto_recurring?.transaction_amount ?? null,
        proximoCobro: pre.next_payment_date ? fechaArgentina(pre.next_payment_date) : null,
        actualizadoMP: pre.last_modified || pre.date_created || null,
      } : null,
      periodoActual: { id: `inicial-${desde}`, desde, hasta },
      // Desde cuándo la sigue BarberOS. Los cobros de MP anteriores a esto
      // pagaron meses que ya están cubiertos por la carga (o que ya pasaron).
      inicio: desde,
      reemplazaA: reemplazaA || null,
      reemplazadaPor: null,
      notas: String(d.notas || '').trim().slice(0, 300),
      cargadaPor: por,
      creadaEn: FieldValue.serverTimestamp(),
      historial: [{ estado, en: ahora, por, causa: reemplazaA ? 'cambio de plan' : 'carga' }],
    });

    tx.create(ref.collection('periodos').doc(`inicial-${desde}`), {
      id: `inicial-${desde}`,
      desde,
      hasta,
      estado: 'vigente',
      origen: 'carga',
      ...terminos,
      usados: 0,
      usadosPorBeneficio: {},
      pagoId: null,
      monto,
      creadoEn: FieldValue.serverTimestamp(),
    });

    // El mes inicial es plata que entró: si es manual, el dueño la cobró; si
    // es de MP, el cobro ya pasó antes de vincularla y no lo vamos a ver por
    // webhook. En los dos casos cuenta como ingreso de membresías.
    if (d.registrarPago !== false && monto > 0) {
      tx.create(col(cuentaId, 'membresiaPagos').doc(`${ref.id}-inicial`), {
        membresiaId: ref.id, periodoId: `inicial-${desde}`, monto, fecha: desde,
        origen: pre ? 'mercadopago-previo' : 'manual', clienteNombre, planNombre: plan.nombre,
        registradoPor: por, creadoEn: FieldValue.serverTimestamp(),
      });
    }

    if (preapprovalId) {
      tx.set(db().doc(`mpSuscripciones/${preapprovalId}`), { cuentaId, membresiaId: ref.id, vinculadaEn: FieldValue.serverTimestamp() });
    }

    if (anterior?.exists) {
      tx.update(anterior.ref, {
        estado: 'reemplazada',
        reemplazadaPor: ref.id,
        historial: FieldValue.arrayUnion({ estado: 'reemplazada', en: ahora, por, causa: 'cambio de plan' }),
      });
      // Su mes en curso termina cuando arranca el nuevo. Los usos que ya tiene
      // reservados ahí quedan donde están: son de ese mes.
      for (const p of periodosAnteriores.docs) {
        if (p.data().estado !== 'vigente') continue;
        if (p.data().desde >= desde) tx.update(p.ref, { estado: 'cerrado', cerradoPor: 'cambio de plan' });
        else tx.update(p.ref, { hasta: sumarDias(desde, -1), estado: 'cerrado', cerradoPor: 'cambio de plan' });
      }
    }
  });

  logger.info('membresía cargada', { cuentaId, membresiaId: ref.id, planId: planSnap.id, preapprovalId, uid: por, reemplazaA });
  return { id: ref.id, cuentaId, estado, atada: Boolean(clienteUid) };
});

/**
 * Renueva a mano una membresía SIN Mercado Pago (cobrada en efectivo o por
 * transferencia): abre el mes siguiente y registra el cobro. Las de MP no se
 * renuevan acá: las renueva el cobro de MP, que es la fuente de verdad.
 *
 * El id del mes es su fecha de inicio: dos clics en "Renovar" chocan contra
 * el mismo documento y el segundo falla, en vez de abrir dos meses.
 */
exports.renovarMembresia = onCall(OPCIONES, async (request) => {
  const businessId = exigirDueno(request, request.data?.businessId);
  const cuentaId = await cuentaDe(businessId);
  const ref = col(cuentaId, 'membresias').doc(String(request.data?.membresiaId || ''));
  const hoy = hoyEnArgentina();

  const r = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'Esa membresía no existe.');
    const m = snap.data();
    if (m.mp?.preapprovalId) throw new HttpsError('failed-precondition', 'Esta membresía se renueva sola con el cobro de Mercado Pago.');
    if (['reemplazada'].includes(m.estado)) throw new HttpsError('failed-precondition', 'Esta membresía fue reemplazada por otra.');

    const planSnap = await tx.get(col(cuentaId, 'membresiaPlanes').doc(m.planId));
    const plan = planSnap.exists ? planSnap.data() : m.plan;

    // Sigue al último mes si todavía no terminó (o terminó hace poco); si hace
    // rato que venció, arranca hoy: no se cobra un mes que ya pasó.
    const ultimo = m.periodoActual?.hasta;
    const desde = ultimo && sumarDias(ultimo, 1) >= hoy ? sumarDias(ultimo, 1) : hoy;
    const hasta = finDePeriodo(desde);
    const id = `m-${desde}`;
    const pref = ref.collection('periodos').doc(id);
    if ((await tx.get(pref)).exists) throw new HttpsError('already-exists', 'Ese mes ya está renovado.');

    const monto = request.data?.monto === '' || request.data?.monto == null ? Number(plan.precioMensual) : Number(request.data.monto);
    if (!Number.isFinite(monto) || monto < 0) throw new HttpsError('invalid-argument', 'El monto no es válido.');
    const terminos = terminosDelPlan(plan);

    tx.create(pref, {
      id, desde, hasta, estado: 'vigente', origen: 'renovacion-manual', ...terminos,
      usados: 0, usadosPorBeneficio: {}, pagoId: null, monto, creadoEn: FieldValue.serverTimestamp(),
    });
    if (monto > 0) {
      tx.create(col(cuentaId, 'membresiaPagos').doc(`${ref.id}-${id}`), {
        membresiaId: ref.id, periodoId: id, monto, fecha: hoy, origen: 'manual',
        clienteNombre: m.clienteNombre || '', planNombre: plan.nombre || m.plan?.nombre || '',
        registradoPor: request.auth.uid, creadoEn: FieldValue.serverTimestamp(),
      });
    }
    tx.update(ref, {
      estado: 'activa',
      periodoActual: { id, desde, hasta },
      plan: { nombre: plan.nombre, precioMensual: Number(plan.precioMensual), ...terminos },
      historial: FieldValue.arrayUnion({ estado: 'activa', en: new Date(), por: request.auth.uid, causa: 'renovación' }),
    });
    return { desde, hasta };
  });

  logger.info('membresía renovada a mano', { cuentaId, membresiaId: ref.id, ...r, uid: request.auth.uid });
  return r;
});

/**
 * Dar de baja. No corta el mes que ya está pago: lo que el cliente pagó, lo
 * usa. Si está atada a Mercado Pago, se cancela también allá (si no, MP le
 * seguiría cobrando una membresía que BarberOS ya no respeta).
 */
exports.cancelarMembresia = onCall(CON_MP, async (request) => {
  const businessId = exigirDueno(request, request.data?.businessId);
  const cuentaId = await cuentaDe(businessId);
  const ref = col(cuentaId, 'membresias').doc(String(request.data?.membresiaId || ''));
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Esa membresía no existe.');
  const m = snap.data();
  if (['cancelada', ...FINALES].includes(m.estado)) throw new HttpsError('failed-precondition', 'Esa membresía ya no está activa.');
  const motivo = String(request.data?.motivo || '').trim().slice(0, 300) || null;

  if (m.mp?.preapprovalId && request.data?.cancelarEnMP !== false) {
    const token = await mp.tokenDe(cuentaId);
    if (!token) throw new HttpsError('failed-precondition', 'La cuenta de Mercado Pago está desconectada: cancelala desde Mercado Pago o volvé a conectarla.');
    try {
      await mp.pedirMP(`/preapproval/${encodeURIComponent(m.mp.preapprovalId)}`, {
        metodo: 'PUT', token, cuerpo: { status: 'cancelled' },
      });
    } catch (err) {
      logger.error('no se pudo cancelar la suscripción en MP', { cuentaId, membresiaId: ref.id, error: err.message });
      throw new HttpsError('unavailable', 'Mercado Pago no aceptó la cancelación. Probá de nuevo en un rato.');
    }
  }

  await ref.update({
    estado: 'cancelada',
    canceladaEn: FieldValue.serverTimestamp(),
    motivoBaja: motivo,
    ...(m.mp ? { 'mp.estadoMP': 'cancelled' } : {}),
    historial: FieldValue.arrayUnion({ estado: 'cancelada', en: new Date(), por: request.auth.uid, causa: motivo || 'baja' }),
  });
  logger.info('membresía cancelada', { cuentaId, membresiaId: ref.id, uid: request.auth.uid });
  return { ok: true, vigenteHasta: m.periodoActual?.hasta || null };
});

// ── Uso: aplicar y revertir (solo el dueño) ────────────────────────────────

/**
 * El dueño aplica la membresía a un turno que ya existe. Dos casos reales: el
 * cliente se olvidó de marcarla al reservar, o el turno lo cargó el staff a
 * mano (no tiene la cuenta del cliente, así que hay que decir de quién es).
 *
 * El barbero NO puede: es exactamente el fraude que esto evita (cobrar en mano
 * y anotar que lo cubrió el plan). Con motivo obligatorio y `origen` 'dueño',
 * queda separado en la auditoría de lo que eligió el propio cliente.
 */
exports.aplicarMembresia = onCall(OPCIONES, async (request) => {
  const sucursalId = exigirDueno(request, request.data?.businessId);
  const cuentaId = await cuentaDe(sucursalId);
  const { appointmentId, membresiaId } = request.data || {};
  const motivo = String(request.data?.motivo || '').trim().slice(0, 300);
  if (!appointmentId || !membresiaId) throw new HttpsError('invalid-argument', 'Faltan el turno o la membresía.');
  if (motivo.length < 3) throw new HttpsError('invalid-argument', 'Escribí el motivo: queda en la auditoría.');

  const turnoRef = db().doc(`businesses/${sucursalId}/appointments/${appointmentId}`);
  const snapshot = await db().runTransaction(async (tx) => {
    const turnoSnap = await tx.get(turnoRef);
    if (!turnoSnap.exists) throw new HttpsError('not-found', 'Ese turno no existe.');
    const t = turnoSnap.data();
    if (t.membresia && t.membresia.estado !== 'revertido' && t.membresia.estado !== 'liberado') {
      throw new HttpsError('already-exists', 'Este turno ya tiene la membresía aplicada.');
    }
    if (!['pendiente', 'confirmada', 'completada'].includes(t.status)) {
      throw new HttpsError('failed-precondition', 'Solo se aplica a un turno pendiente, confirmado o atendido.');
    }
    const usoPrevio = await tx.get(col(cuentaId, 'membresiaUsos').doc(appointmentId));

    // Si el turno lo reservó un cliente con su cuenta, la membresía tiene que
    // ser de ESE cliente: el dueño no puede cargarle el turno de uno al plan
    // de otro. Los que cargó el staff no tienen cuenta de cliente, y ahí manda
    // lo que elige el dueño (con su motivo). Va antes que el cupo: el motivo
    // del rechazo tiene que ser el de verdad.
    const mSnap = await tx.get(col(cuentaId, 'membresias').doc(String(membresiaId)));
    if (!mSnap.exists) throw new HttpsError('not-found', 'Esa membresía no existe.');
    const m = mSnap.data();
    const cargadoPorStaff = t.type === 'manual' || t.type === 'walkin' || t.origen !== 'cliente';
    if (!cargadoPorStaff && t.userId !== m.clienteUid) {
      throw new HttpsError('permission-denied', 'Ese turno lo reservó otra persona: la membresía no es suya.');
    }

    const prep = await prepararUso(tx, {
      cuentaId, sucursalId, serviceId: t.serviceId, appointmentDate: t.appointmentDate, membresiaId,
    });

    if (usoPrevio.exists && ['reservado', 'consumido'].includes(usoPrevio.data().estado)) {
      throw new HttpsError('already-exists', 'Este turno ya tiene la membresía aplicada.');
    }

    const snap = escribirUso(tx, prep, {
      cuentaId, appointmentId, sucursalId,
      professionalId: t.professionalId, serviceId: t.serviceId, serviceName: t.serviceName,
      valorServicio: t.precioLista ?? t.price, appointmentDate: t.appointmentDate,
      origen: 'dueno',
      registradoPor: { uid: request.auth.uid, rol: request.auth.token.platform === true ? 'plataforma' : 'owner' },
      motivo,
      estado: t.status === 'completada' ? 'consumido' : 'reservado',
      usoAnterior: usoPrevio.exists ? usoPrevio.data() : null,
    });
    // `price` es lo que se cobra (lo leen la caja y las estadísticas): con la
    // membresía, cero. El valor del servicio queda en el snapshot.
    tx.update(turnoRef, { membresia: snap, price: 0, precioLista: Number(t.precioLista ?? t.price) || 0 });
    return snap;
  });

  logger.info('membresía aplicada por el dueño', { cuentaId, sucursalId, appointmentId, membresiaId, uid: request.auth.uid });
  return { ok: true, membresia: snapshot };
});

/**
 * Revertir un uso: el turno vuelve a ser un turno normal (se cobra) y el uso
 * vuelve al cupo del mes. Solo el dueño, con motivo. Es la herramienta para
 * corregir un error o un uso que no corresponde, y queda en la auditoría.
 */
exports.revertirUsoMembresia = onCall(OPCIONES, async (request) => {
  const sucursalId = exigirDueno(request, request.data?.businessId);
  const cuentaId = await cuentaDe(sucursalId);
  const appointmentId = String(request.data?.appointmentId || '');
  const motivo = String(request.data?.motivo || '').trim().slice(0, 300);
  if (!appointmentId) throw new HttpsError('invalid-argument', 'Falta el turno.');
  if (motivo.length < 3) throw new HttpsError('invalid-argument', 'Escribí el motivo: queda en la auditoría.');

  const uso = await col(cuentaId, 'membresiaUsos').doc(appointmentId).get();
  if (!uso.exists) throw new HttpsError('not-found', 'Ese turno no usó membresía.');
  const turnoRef = db().doc(`businesses/${uso.data().sucursalId}/appointments/${appointmentId}`);
  const turno = await turnoRef.get();

  const hecho = await cambiarEstadoDelUso(cuentaId, appointmentId, {
    desde: ['reservado', 'consumido'], hacia: 'revertido', por: request.auth.uid, motivo,
    devolverCupo: true, turnoRef: turno.exists ? turnoRef : null, revision: null,
  });
  if (!hecho) throw new HttpsError('failed-precondition', 'Ese uso ya estaba liberado o revertido.');
  logger.info('uso de membresía revertido', { cuentaId, appointmentId, uid: request.auth.uid });
  return { ok: true };
});

// ── El cliente: su membresía ───────────────────────────────────────────────

/**
 * Lo que ve el cliente: si tiene membresía en esta cuenta, en qué estado, qué
 * incluye y cuántos usos le quedan en el mes de HOY, más sus últimos usos.
 *
 * Por callable y no leyendo Firestore: la membresía cargada antes de que el
 * cliente entrara está buscada por mail, y las Rules no pueden comparar el mail
 * del token sin exponer la colección. Acá se busca por uid o por mail
 * VERIFICADO, y si estaba suelta se ata a su cuenta.
 */
exports.miMembresia = onCall(OPCIONES, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Tenés que iniciar sesión.');
  const businessId = String(request.data?.businessId || '');
  if (!businessId) throw new HttpsError('invalid-argument', 'Falta la barbería.');
  const cuentaId = await cuentaDe(businessId);
  const uid = request.auth.uid;
  const email = request.auth.token.email_verified === true ? normalizarEmail(request.auth.token.email) : null;

  const [porUid, porMail] = await Promise.all([
    col(cuentaId, 'membresias').where('clienteUid', '==', uid).get(),
    email ? col(cuentaId, 'membresias').where('clienteEmail', '==', email).get() : Promise.resolve({ docs: [] }),
  ]);
  const todas = new Map();
  for (const d of [...porUid.docs, ...porMail.docs]) {
    const m = d.data();
    if (m.clienteUid && m.clienteUid !== uid) continue; // atada a otra cuenta
    todas.set(d.id, d);
  }
  // La más relevante: una usable antes que una vencida; entre iguales, la última.
  const orden = (e) => (USABLES.includes(e) ? 0 : e === 'pendiente' ? 1 : 2);
  const elegida = [...todas.values()].sort((a, b) => orden(a.data().estado) - orden(b.data().estado)
    || String(b.data().periodoActual?.desde || '').localeCompare(String(a.data().periodoActual?.desde || '')))[0];
  if (!elegida) return { membresia: null };

  const m = elegida.data();
  if (!m.clienteUid) await elegida.ref.update({ clienteUid: uid }).catch(() => {});

  const hoy = hoyEnArgentina();
  const periodos = (await elegida.ref.collection('periodos').where('hasta', '>=', hoy).get())
    .docs.map((p) => ({ id: p.id, ...p.data() })).filter((p) => p.estado === 'vigente')
    .sort((a, b) => a.desde.localeCompare(b.desde));
  const periodo = periodoQueCubre(periodos, hoy) || periodos[0] || null;

  const usos = (await col(cuentaId, 'membresiaUsos').where('membresiaId', '==', elegida.id).get())
    .docs.map((u) => u.data())
    .sort((a, b) => String(b.appointmentDate).localeCompare(String(a.appointmentDate)))
    .slice(0, 20)
    .map((u) => ({
      appointmentId: u.appointmentId, appointmentDate: u.appointmentDate, serviceName: u.serviceName,
      beneficioNombre: u.beneficioNombre, estado: u.estado, origen: u.origen, sucursalId: u.sucursalId,
    }));

  return {
    membresia: {
      id: elegida.id,
      cuentaId,
      planNombre: m.plan?.nombre || '',
      estado: m.estado,
      usable: USABLES.includes(m.estado) && Boolean(periodo),
      periodo: periodo ? {
        desde: periodo.desde,
        hasta: periodo.hasta,
        usados: periodo.usados || 0,
        usosTotales: periodo.usosTotales ?? null,
        beneficios: (periodo.beneficios || []).map((b) => ({
          id: b.id, nombre: b.nombre, usos: b.usos,
          usados: (periodo.usadosPorBeneficio || {})[b.id] || 0,
          servicios: b.servicios,
        })),
      } : null,
      // Solo los meses ya pagos: para elegir si un turno de más adelante entra.
      periodosPagos: periodos.map((p) => ({ desde: p.desde, hasta: p.hasta })),
      proximoCobro: m.mp?.proximoCobro || null,
      conMercadoPago: Boolean(m.mp?.preapprovalId),
    },
    usos,
  };
});

// ── El turno cambia de estado: el uso acompaña ─────────────────────────────

const VIVO = ['pendiente', 'confirmada', 'esperando_pago'];

/**
 * Cancelar antes de atenderse devuelve el uso. Atenderse o faltar lo consume
 * (el no-show cuesta, como en cualquier plan con cupo). Lo que NO se hace es
 * devolver un uso porque un turno ya atendido "se cancela" después: eso es la
 * forma de lavar un uso, y queda marcado para que lo mire el dueño.
 *
 * Es un trigger (y no lógica en el browser) porque los cambios de estado los
 * escribe el staff directo en Firestore: así cubre todos los caminos.
 */
exports.onTurnoMembresia = onDocumentUpdated({ ...OPCIONES, document: 'businesses/{bizId}/appointments/{aptId}' }, async (event) => {
  const antes = event.data?.before?.data();
  const ahora = event.data?.after?.data();
  if (!antes || !ahora) return;
  const snap = ahora.membresia;
  if (!snap?.usoId || ['liberado', 'revertido'].includes(snap.estado)) return;

  const { bizId, aptId } = event.params;
  const cuentaId = await cuentaDe(bizId).catch(() => null);
  if (!cuentaId) return;
  const turnoRef = event.data.after.ref;
  const quien = ahora.cancelledBy === 'client' ? 'cliente' : (ahora.cancelledBy || 'staff');

  if (antes.status !== ahora.status) {
    if (VIVO.includes(antes.status) && ahora.status === 'cancelada') {
      await cambiarEstadoDelUso(cuentaId, aptId, {
        desde: ['reservado'], hacia: 'liberado', por: quien, motivo: 'turno cancelado',
        devolverCupo: true, turnoRef,
      });
      return;
    }
    if (['completada', 'no_asistio'].includes(ahora.status)) {
      await cambiarEstadoDelUso(cuentaId, aptId, {
        desde: ['reservado'], hacia: 'consumido', por: 'staff',
        motivo: ahora.status === 'no_asistio' ? 'no asistió' : 'atendido',
        devolverCupo: false, turnoRef,
      });
      return;
    }
    if (['completada', 'no_asistio'].includes(antes.status)) {
      // Un turno atendido que vuelve atrás o se cancela: el uso NO se devuelve.
      await col(cuentaId, 'membresiaUsos').doc(aptId).update({
        requiereRevision: `el turno pasó de ${antes.status} a ${ahora.status}`,
        eventos: FieldValue.arrayUnion({ estado: 'revision', en: new Date(), por: 'staff', motivo: `${antes.status} → ${ahora.status}` }),
      }).catch(() => {});
      return;
    }
  }

  // Reprogramación: el staff cambia fecha u hora del MISMO turno. El uso queda
  // atado al turno (su id no cambia), así que no se duplica. Si la fecha nueva
  // cae fuera del mes pago, queda marcado para revisar.
  if (antes.appointmentDate !== ahora.appointmentDate) {
    const usoRef = col(cuentaId, 'membresiaUsos').doc(aptId);
    const uso = await usoRef.get();
    if (!uso.exists) return;
    const u = uso.data();
    const p = await col(cuentaId, 'membresias').doc(u.membresiaId).collection('periodos').doc(u.periodoId).get();
    const dentro = p.exists && p.data().desde <= ahora.appointmentDate && ahora.appointmentDate <= p.data().hasta;
    await usoRef.update({
      appointmentDate: ahora.appointmentDate,
      requiereRevision: dentro ? (u.requiereRevision || null) : 'reprogramado fuera del mes pago',
      eventos: FieldValue.arrayUnion({ estado: u.estado, en: new Date(), por: 'staff', motivo: `reprogramado ${antes.appointmentDate} → ${ahora.appointmentDate}` }),
    });
  }
});

// ── Mercado Pago: aplicar estado ───────────────────────────────────────────

/**
 * Aplica el estado actual de una suscripción de MP a su membresía.
 *
 * `last_modified` protege del aviso viejo que llega tarde: si lo que tenemos
 * es más nuevo que lo que vino, no se toca. Las membresías reemplazadas o
 * vencidas no "reviven" por un aviso de MP.
 */
async function aplicarPreapproval(cuentaId, membresiaId, pre) {
  const ref = col(cuentaId, 'membresias').doc(membresiaId);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const m = snap.data();
    const nuevo = pre.last_modified || pre.date_created || null;
    const viejo = m.mp?.actualizadoMP || null;
    if (viejo && nuevo && Date.parse(nuevo) < Date.parse(viejo)) return;

    const cambios = {
      'mp.estadoMP': pre.status || null,
      'mp.payerEmail': pre.payer_email || m.mp?.payerEmail || null,
      'mp.monto': pre.auto_recurring?.transaction_amount ?? m.mp?.monto ?? null,
      'mp.proximoCobro': pre.next_payment_date ? fechaArgentina(pre.next_payment_date) : null,
      'mp.actualizadoMP': nuevo,
    };

    let estado = ESTADO_DESDE_MP[pre.status] || m.estado;
    // 'pending' en MP no baja a pendiente una membresía que ya tiene mes pago.
    if (estado === 'pendiente' && m.estado !== 'pendiente') estado = m.estado;
    // Volver a 'authorized' no tapa un rechazo: eso lo decide el próximo cobro.
    if (estado === 'activa' && m.estado === 'pago_rechazado') estado = 'pago_rechazado';
    if (FINALES.includes(m.estado)) estado = m.estado;

    if (estado !== m.estado) {
      cambios.estado = estado;
      cambios.historial = FieldValue.arrayUnion({ estado, en: new Date(), por: 'mercadopago', causa: `suscripción ${pre.status}` });
      if (estado === 'cancelada') cambios.canceladaEn = FieldValue.serverTimestamp();
    }
    tx.update(ref, cambios);
  });
}

/**
 * Un cobro mensual aprobado abre un mes nuevo. El id del mes es el del cobro
 * de MP y se crea con `create`: el mismo cobro avisado diez veces abre UN mes.
 *
 * El mes arranca el día del cobro, salvo que ese día ya esté cubierto por otro
 * mes pago (MP suele cobrar un par de días antes): ahí arranca al día
 * siguiente del que lo cubre. Se calcula contra TODOS los meses, no contra "el
 * último", para que dos cobros avisados al revés no se encimen.
 */
async function aplicarCobro(cuentaId, membresiaId, cobro) {
  const ref = col(cuentaId, 'membresias').doc(membresiaId);
  const periodoId = `ap-${cobro.id}`;
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return 'sin-membresia';
    const m = snap.data();
    const pref = ref.collection('periodos').doc(periodoId);
    if ((await tx.get(pref)).exists) return 'repetido';
    if (FINALES.includes(m.estado)) return 'finalizada';

    // Un cobro de antes de que BarberOS siguiera esta membresía pagó un mes
    // que ya está cubierto por la carga inicial: no abre nada. Sin esto, la
    // reconciliación importaría el historial entero de MP como meses nuevos.
    if (m.inicio && cobro.fecha < m.inicio) return 'anterior';

    const periodos = (await tx.get(ref.collection('periodos'))).docs.map((p) => p.data())
      .filter((p) => p.estado !== 'revertido');
    const planSnap = await tx.get(col(cuentaId, 'membresiaPlanes').doc(m.planId));
    const plan = planSnap.exists ? planSnap.data() : m.plan;

    let desde = cobro.fecha;
    for (let i = 0; i < 24; i++) {
      const cubre = periodos.find((p) => p.desde <= desde && desde <= p.hasta);
      if (!cubre) break;
      desde = sumarDias(cubre.hasta, 1);
    }
    // Si ya hay un mes que arranca antes del fin natural (un cobro posterior
    // que se avisó primero), este termina justo antes: nunca dos meses
    // cubriendo el mismo día.
    const siguiente = periodos.map((p) => p.desde).filter((d) => d > desde).sort()[0];
    const hasta = siguiente && siguiente <= finDePeriodo(desde) ? sumarDias(siguiente, -1) : finDePeriodo(desde);
    const terminos = terminosDelPlan(plan);

    tx.create(pref, {
      id: periodoId, desde, hasta, estado: 'vigente', origen: 'mercadopago', ...terminos,
      usados: 0, usadosPorBeneficio: {}, pagoId: cobro.pagoId, monto: cobro.monto,
      creadoEn: FieldValue.serverTimestamp(),
    });
    tx.set(col(cuentaId, 'membresiaPagos').doc(periodoId), {
      membresiaId, periodoId, monto: cobro.monto, fecha: cobro.fecha, origen: 'mercadopago',
      pagoId: cobro.pagoId, clienteNombre: m.clienteNombre || '', planNombre: plan.nombre || '',
      creadoEn: FieldValue.serverTimestamp(),
    });
    if (cobro.pagoId) tx.set(db().doc(`mpPagos/${cobro.pagoId}`), { cuentaId, membresiaId, periodoId });

    const esElUltimo = !m.periodoActual?.hasta || hasta >= m.periodoActual.hasta;
    tx.update(ref, {
      ...(esElUltimo ? { periodoActual: { id: periodoId, desde, hasta } } : {}),
      ...(m.estado !== 'cancelada' ? { estado: 'activa' } : {}),
      plan: { nombre: plan.nombre, precioMensual: Number(plan.precioMensual), ...terminos },
      historial: FieldValue.arrayUnion({ estado: m.estado === 'cancelada' ? 'cancelada' : 'activa', en: new Date(), por: 'mercadopago', causa: `cobro ${cobro.id} aprobado` }),
    });
    return 'creado';
  });
}

async function marcarCobroRechazado(cuentaId, membresiaId, cobroId) {
  const ref = col(cuentaId, 'membresias').doc(membresiaId);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const m = snap.data();
    if (!['activa', 'pausada'].includes(m.estado)) return;
    // Si el mes del cobro ya se abrió con otro intento aprobado, no hay rechazo.
    if ((await tx.get(ref.collection('periodos').doc(`ap-${cobroId}`))).exists) return;
    tx.update(ref, {
      estado: 'pago_rechazado',
      historial: FieldValue.arrayUnion({ estado: 'pago_rechazado', en: new Date(), por: 'mercadopago', causa: `cobro ${cobroId} rechazado` }),
    });
  });
}

/** Lee un cobro de suscripción de MP y lo normaliza. */
function normalizarCobro(ap) {
  const pago = ap.payment || {};
  const aprobado = pago.status === 'approved' || (ap.status === 'processed' && pago.status !== 'rejected' && pago.id);
  const rechazado = ['rejected', 'cancelled'].includes(pago.status) || ap.status === 'cancelled';
  const fecha = fechaArgentina(ap.debit_date || pago.date_approved || ap.date_created || new Date()) || hoyEnArgentina();
  return {
    id: String(ap.id),
    preapprovalId: String(ap.preapproval_id || ''),
    pagoId: pago.id ? String(pago.id) : null,
    monto: Number(ap.transaction_amount) || 0,
    fecha,
    aprobado: Boolean(aprobado),
    rechazado: Boolean(rechazado) && !aprobado,
  };
}

/**
 * Entrada desde el webhook (`mercadopago.js`). Devuelve true si el aviso era de
 * membresías (lo haya podido aplicar o no), false si no tiene nada que ver.
 *
 * Nunca se cree el cuerpo del aviso: se le pregunta a MP con el token de la
 * barbería dueña de la suscripción.
 */
async function procesarAvisoMP(tipo, recursoId) {
  const id = String(recursoId || '');
  if (!id) return false;

  if (tipo === 'subscription_preapproval' || tipo === 'preapproval') {
    const idx = await db().doc(`mpSuscripciones/${id}`).get();
    if (!idx.exists) { logger.info('aviso de una suscripción no vinculada', { preapprovalId: id }); return true; }
    const { cuentaId, membresiaId } = idx.data();
    const token = await mp.tokenDe(cuentaId);
    if (!token) return true;
    const pre = await mp.pedirMP(`/preapproval/${encodeURIComponent(id)}`, { token });
    await aplicarPreapproval(cuentaId, membresiaId, pre);
    logger.info('suscripción actualizada', { cuentaId, membresiaId, estado: pre.status });
    return true;
  }

  if (tipo === 'subscription_authorized_payment' || tipo === 'authorized_payment') {
    // El cobro no trae a qué cuenta pertenece hasta leerlo, y para leerlo hace
    // falta un token. Se prueba con las cuentas que tienen suscripciones
    // vinculadas — pocas — hasta que una lo pueda leer.
    const ap = await leerCobroConAlgunToken(id);
    if (!ap) return true;
    const cobro = normalizarCobro(ap.datos);
    const idx = await db().doc(`mpSuscripciones/${cobro.preapprovalId}`).get();
    if (!idx.exists) { logger.info('cobro de una suscripción no vinculada', { cobroId: id }); return true; }
    const { cuentaId, membresiaId } = idx.data();
    if (cobro.aprobado) {
      const r = await aplicarCobro(cuentaId, membresiaId, cobro);
      logger.info('cobro de membresía', { cuentaId, membresiaId, cobroId: id, resultado: r });
    } else if (cobro.rechazado) {
      await marcarCobroRechazado(cuentaId, membresiaId, cobro.id);
      logger.info('cobro de membresía rechazado', { cuentaId, membresiaId, cobroId: id });
    }
    return true;
  }

  return false;
}

/**
 * Para un pago común (`type=payment`): si es el de una cuota de membresía que
 * se devolvió o se desconoció, el mes que abrió queda revertido — no se puede
 * reservar con él — y el dueño lo ve. Los usos ya hechos no se tocan: el
 * servicio ya se prestó; qué hacer con eso lo decide el dueño.
 */
async function procesarPagoDeMembresia(pagoId, token) {
  const idx = await db().doc(`mpPagos/${pagoId}`).get();
  if (!idx.exists) return false;
  const { cuentaId, membresiaId, periodoId } = idx.data();
  const pago = await mp.pedirMP(`/v1/payments/${encodeURIComponent(pagoId)}`, { token: token || await mp.tokenDe(cuentaId) });
  if (!['refunded', 'charged_back', 'cancelled'].includes(pago.status)) return true;
  const ref = col(cuentaId, 'membresias').doc(membresiaId);
  await db().runTransaction(async (tx) => {
    const p = await tx.get(ref.collection('periodos').doc(periodoId));
    if (!p.exists || p.data().estado === 'revertido') return;
    tx.update(p.ref, { estado: 'revertido', revertidoPor: `pago ${pago.status}` });
    tx.update(col(cuentaId, 'membresiaPagos').doc(periodoId), { revertido: true, estadoPago: pago.status });
    tx.update(ref, {
      historial: FieldValue.arrayUnion({ estado: 'revertido', en: new Date(), por: 'mercadopago', causa: `pago ${pagoId} ${pago.status}` }),
    });
  });
  logger.info('cuota de membresía devuelta', { cuentaId, membresiaId, periodoId, estado: pago.status });
  return true;
}

async function leerCobroConAlgunToken(cobroId) {
  const cuentas = [...new Set((await db().collection('mpSuscripciones').get()).docs.map((d) => d.data().cuentaId))];
  for (const cuentaId of cuentas) {
    const token = await mp.tokenDe(cuentaId);
    if (!token) continue;
    try {
      return { cuentaId, datos: await mp.pedirMP(`/authorized_payments/${encodeURIComponent(cobroId)}`, { token }) };
    } catch (err) {
      if (err.status !== 404 && err.status !== 403 && err.status !== 401) throw err;
    }
  }
  logger.warn('cobro de suscripción que ninguna cuenta puede leer', { cobroId });
  return null;
}

// ── Reconciliación diaria ──────────────────────────────────────────────────

/**
 * Lo que el webhook no trajo (MP caído, un aviso perdido, la function que
 * falló) lo trae esto: una vez por día se le pregunta a MP por cada
 * suscripción vinculada, y se vencen las membresías cuyo último mes pago
 * terminó hace más de DIAS_DE_GRACIA días sin que entre otro.
 */
async function reconciliarMembresias() {
  const hoy = hoyEnArgentina();
  const limite = sumarDias(hoy, -DIAS_DE_GRACIA);
  const negocios = await db().collection('businesses').get();
  let revisadas = 0, vencidas = 0, errores = 0;

  for (const b of negocios.docs) {
    const membresias = await b.ref.collection('membresias').where('estado', 'in', [...USABLES, 'pendiente']).get();
    for (const d of membresias.docs) {
      revisadas++;
      const m = d.data();
      try {
        if (m.mp?.preapprovalId) {
          const token = await mp.tokenDe(b.id);
          if (token) {
            const pre = await mp.pedirMP(`/preapproval/${encodeURIComponent(m.mp.preapprovalId)}`, { token });
            await aplicarPreapproval(b.id, d.id, pre);
            // Los cobros de la suscripción: si alguno aprobado no abrió su mes
            // (aviso perdido), se abre ahora. `aplicarCobro` es idempotente.
            const r = await mp.pedirMP(`/authorized_payments/search?preapproval_id=${encodeURIComponent(m.mp.preapprovalId)}&limit=12`, { token })
              .catch(() => ({ results: [] }));
            for (const ap of r.results || []) {
              const cobro = normalizarCobro(ap);
              if (cobro.aprobado) await aplicarCobro(b.id, d.id, cobro);
            }
          }
        }
        const fresca = (await d.ref.get()).data();
        const hasta = fresca.periodoActual?.hasta;
        if (hasta && hasta < limite && ['activa', 'pausada', 'pago_rechazado'].includes(fresca.estado)) {
          await d.ref.update({
            estado: 'vencida',
            historial: FieldValue.arrayUnion({ estado: 'vencida', en: new Date(), por: 'sistema', causa: `sin pago desde ${hasta}` }),
          });
          vencidas++;
        }
      } catch (err) {
        errores++;
        logger.error('no se pudo reconciliar una membresía', { cuentaId: b.id, membresiaId: d.id, error: err.message });
      }
    }
  }
  logger.info('reconciliación de membresías', { revisadas, vencidas, errores });
  return { revisadas, vencidas, errores };
}

exports.reconciliarMembresiasDiario = onSchedule(
  { ...CON_MP, schedule: '30 3 * * *', timeZone: 'America/Argentina/Buenos_Aires' },
  async () => { await reconciliarMembresias(); }
);

/** Para correrla a mano desde el panel global (o las pruebas). Solo plataforma. */
exports.reconciliarMembresias = onCall(CON_MP, async (request) => {
  if (request.auth?.token?.platform !== true) throw new HttpsError('permission-denied', 'Solo la plataforma.');
  return reconciliarMembresias();
});

// Para createAppointment (index.js) y el webhook (mercadopago.js).
module.exports.prepararUso = prepararUso;
module.exports.escribirUso = escribirUso;
module.exports.cuentaDe = cuentaDe;
module.exports.procesarAvisoMP = procesarAvisoMP;
module.exports.procesarPagoDeMembresia = procesarPagoDeMembresia;
module.exports.normalizarEmail = normalizarEmail;
// Lógica pura, para las pruebas sin emulador.
module.exports._puro = { finDePeriodo, beneficioPara, periodoQueCubre, normalizarCobro, sumarDias };
