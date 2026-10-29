// ============================================================================
// Recompensas — campañas de fidelización de cada barbería
// ============================================================================
// Ruleta, tarjeta de fidelidad, caja sorpresa, rasca y ganá, happy hour, racha
// y cumpleaños. Todas apagadas hasta que la barbería las configura y prende.
//
// La forma es la de los cupones y las membresías, y por las mismas razones:
//
//   - Todo lo que mueve un premio lo escribe el SERVIDOR. Las Rules están en
//     `false` para campañas, premios y progreso: si el browser pudiera escribir
//     acá, el cliente se daría un corte gratis y el dueño se inflaría los
//     números. El dueño configura por `guardarCampana`, que valida lo mismo que
//     el panel (probabilidades, topes) y no confía en él.
//   - Los juegos solo deciden CUÁNDO se gana y QUÉ definición sale. El premio
//     es siempre el mismo objeto (`businesses/{id}/premios/{id}`) y lo maneja
//     un solo ciclo: disponible → reservado (al reservar) → usado (al atender)
//     o de vuelta a disponible (si se cancela). Un juego nuevo no toca nada de
//     eso.
//   - El sorteo lo hace el servidor con `crypto`. El browser anima hacia el
//     resultado que le devolvieron: no hay una ruleta que "decida" en el
//     teléfono del cliente.
//
// Qué vive dónde (todo por BARBERÍA, como los cupones: en una cuenta con
// sucursales cada local tiene sus campañas, sus servicios y sus clientes):
//
//   businesses/{id}.recompensas                espejo PÚBLICO de lo activo, sin
//                                              probabilidades (lo lee la reserva
//                                              antes de que haya sesión)
//   businesses/{id}/recompensas/{tipo}         🔒 la campaña completa (dueño)
//   businesses/{id}/premios/{premioId}         🔒 dueño + el cliente los suyos
//   businesses/{id}/recompensasClientes/{uid}  🔒 tarjeta, racha, tiradas, cumple
//   businesses/{id}/recompensasSellos/{aptId}  🔒 un sello por turno atendido
//
// Idempotencia, por construcción y no por chequeos: el id del sello ES el del
// turno (un turno no suma dos veces aunque el barbero toque "Vino" diez veces),
// y el id de cada premio sale de lo que lo originó (`fid_{uid}_{ciclo}`,
// `rasca_{turno}`, `cumple_{uid}_{año}`…), así que el mismo hecho no genera
// dos premios.

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const logger = require('firebase-functions/logger');
const { randomInt } = require('crypto');
const motor = require('./recompensasMotor');

// Explícita: este módulo se carga antes que `setGlobalOptions` de index.js
// (misma trampa que mercadopago.js y membresias.js).
const OPCIONES = { region: 'southamerica-east1', maxInstances: 10 };

const db = () => getFirestore();

function hoyEnArgentina() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/** '2026-11-10' → '10/11'. Para los mensajes al cliente. */
function fechaCorta(f) {
  if (!f) return '';
  const [, m, d] = String(f).split('-');
  return `${d}/${m}`;
}

const ref = {
  negocio: (biz) => db().doc(`businesses/${biz}`),
  campana: (biz, tipo) => db().doc(`businesses/${biz}/recompensas/${tipo}`),
  premio: (biz, id) => db().doc(`businesses/${biz}/premios/${id}`),
  cliente: (biz, uid) => db().doc(`businesses/${biz}/recompensasClientes/${uid}`),
  sello: (biz, aptId) => db().doc(`businesses/${biz}/recompensasSellos/${aptId}`),
};

// ── Permisos ───────────────────────────────────────────────────────────────

/**
 * El dueño de ESA barbería (o de su cuenta con sucursales) o el dueño de la
 * plataforma. Ni el barbero ni el mostrador: una campaña regala plata.
 */
function exigirDueno(request, businessId) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Tenés que iniciar sesión.');
  const id = String(businessId || '').trim();
  if (!id) throw new HttpsError('invalid-argument', 'Falta la barbería.');
  const c = request.auth.token || {};
  if (c.platform === true) return id;
  const suyas = Array.isArray(c.businessIds) && c.businessIds.length ? c.businessIds : [c.businessId];
  if (c.role === 'owner' && suyas.includes(id)) return id;
  throw new HttpsError('permission-denied', 'Solo el dueño de la barbería puede configurar las recompensas.');
}

function exigirCliente(request, businessId) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Tenés que iniciar sesión.');
  const id = String(businessId || '').trim();
  if (!id) throw new HttpsError('invalid-argument', 'Falta la barbería.');
  return { businessId: id, uid: request.auth.uid };
}

// ── El premio ──────────────────────────────────────────────────────────────

/**
 * Arma el documento de un premio nuevo. Es una COPIA de la definición: que el
 * dueño después cambie la ruleta no puede cambiarle el premio a quien ya lo
 * ganó, igual que el snapshot del cupón en el turno.
 */
function documentoDelPremio({ id, businessId, uid, email = '', nombreCliente = '', campana, origen, def, venceEn }) {
  return {
    id,
    businessId,
    userId: uid,
    email: String(email || '').slice(0, 120),
    nombreCliente: String(nombreCliente || '').slice(0, 120),
    campana,
    origen: { tipo: origen.tipo, ref: origen.ref || null },
    nombre: def.nombre || motor.describirPremio(def),
    tipo: def.tipo,
    valor: Number(def.valor) || 0,
    serviceIds: Array.isArray(def.serviceIds) ? def.serviceIds : [],
    icono: def.icono || '🎁',
    color: def.color || '#e03d00',
    estado: 'disponible',
    venceEn,
    appointmentId: null,
    creadoEn: FieldValue.serverTimestamp(),
  };
}

/** Para devolverle al browser: sin Timestamps (no viajan bien en un callable). */
function premioParaElCliente(p) {
  if (!p) return null;
  const hoy = hoyEnArgentina();
  return {
    id: p.id,
    campana: p.campana,
    origen: p.origen || null,
    nombre: p.nombre,
    tipo: p.tipo,
    valor: p.valor,
    serviceIds: p.serviceIds || [],
    icono: p.icono,
    color: p.color,
    estado: motor.estadoDelPremio(p, hoy),
    venceEn: p.venceEn || null,
    appointmentId: p.appointmentId || null,
    creadoEn: p.creadoEn?.toMillis?.() ?? null,
    usadoEn: p.usadoEn?.toMillis?.() ?? null,
  };
}

const sumarStat = (tx, biz, tipo, campo, n = 1) => {
  if (!motor.TIPOS_CAMPANA.includes(tipo)) return;
  tx.set(ref.campana(biz, tipo), { stats: { [campo]: FieldValue.increment(n) } }, { merge: true });
};

// ── Configurar una campaña ─────────────────────────────────────────────────

/**
 * Crea, edita, prende o apaga una campaña.
 *
 * `config` opcional: sin él, solo cambia `activa` (los botones Activar /
 * Desactivar de la grilla). Prender una campaña sin configuración válida se
 * rechaza: "nada activado por defecto" incluye no activar algo a medio armar.
 *
 * Además de la campaña, actualiza el ESPEJO público en el documento del negocio
 * (`recompensas.{tipo}`), en la misma transacción: si quedaran desfasados, la
 * reserva mostraría una ruleta que el servidor ya no deja jugar.
 *
 * Apagar una campaña NO toca lo ya ganado: los premios siguen valiendo hasta su
 * vencimiento, y la tarjeta conserva sus sellos (si se vuelve a prender, sigue
 * donde estaba). Un premio que se le dio a un cliente es un compromiso.
 */
exports.guardarCampana = onCall(OPCIONES, async (request) => {
  const { businessId: pedido, tipo, activa, config } = request.data || {};
  const businessId = exigirDueno(request, pedido);
  if (!motor.TIPOS_CAMPANA.includes(tipo)) {
    throw new HttpsError('invalid-argument', 'Ese tipo de campaña no existe.');
  }

  let validada = null;
  if (config !== undefined) {
    const v = motor.validarCampana(tipo, config);
    if (!v.ok) throw new HttpsError('invalid-argument', v.errores.join(' '));
    validada = v.config;
  }

  const resultado = await db().runTransaction(async (tx) => {
    const [campSnap, bizSnap] = await Promise.all([
      tx.get(ref.campana(businessId, tipo)),
      tx.get(ref.negocio(businessId)),
    ]);
    if (!bizSnap.exists) throw new HttpsError('not-found', 'La barbería no existe.');

    const previa = campSnap.exists ? campSnap.data() : null;
    const cfg = validada || previa?.config || null;
    const prender = typeof activa === 'boolean' ? activa : previa?.activa === true;

    if (prender) {
      // La configuración guardada se revalida al prender: pudo haberse escrito
      // con una versión anterior de las reglas.
      const v = cfg ? motor.validarCampana(tipo, cfg) : { ok: false, errores: ['Configurá la campaña antes de activarla.'] };
      if (!v.ok) throw new HttpsError('failed-precondition', v.errores.join(' '));
    }

    const datos = {
      id: tipo,
      businessId,
      tipo,
      nombre: motor.NOMBRES_CAMPANA[tipo],
      activa: prender,
      config: cfg,
      actualizadoEn: FieldValue.serverTimestamp(),
      actualizadoPor: request.auth.uid,
      ...(previa ? {} : { creadoEn: FieldValue.serverTimestamp(), stats: { entregados: 0, usados: 0, jugadas: 0 } }),
    };
    tx.set(ref.campana(businessId, tipo), datos, { merge: true });

    // El espejo: presente = activa. Un `update` con la ruta con puntos crea el
    // mapa si no existía, y `delete()` saca solo esa clave.
    tx.update(ref.negocio(businessId), {
      [`recompensas.${tipo}`]: prender ? motor.vistaPublica(tipo, cfg) : FieldValue.delete(),
    });

    return { activa: prender, config: cfg };
  });

  logger.info('campaña de recompensas guardada', {
    businessId, tipo, activa: resultado.activa, por: request.auth.uid,
  });
  return { ok: true, tipo, ...resultado };
});

/**
 * Reinicia la tarjeta de un cliente que la completó, con reinicio manual. La
 * tarjeta nueva toma las casillas configuradas HOY.
 */
exports.reiniciarTarjeta = onCall(OPCIONES, async (request) => {
  const { businessId: pedido, userId } = request.data || {};
  const businessId = exigirDueno(request, pedido);
  if (!userId) throw new HttpsError('invalid-argument', 'Falta el cliente.');

  return db().runTransaction(async (tx) => {
    const [camp, cli] = await Promise.all([
      tx.get(ref.campana(businessId, 'fidelidad')),
      tx.get(ref.cliente(businessId, String(userId))),
    ]);
    if (!cli.exists) throw new HttpsError('not-found', 'Ese cliente no tiene tarjeta.');
    const f = cli.get('fidelidad') || {};
    if (f.completa !== true) throw new HttpsError('failed-precondition', 'Esa tarjeta todavía no está completa.');
    const casillas = Number(camp.get('config')?.casillas) || Number(f.casillas) || 10;
    tx.update(cli.ref, {
      fidelidad: { ...f, ciclo: (Number(f.ciclo) || 1) + 1, sellos: 0, casillas, completa: false },
      actualizadoEn: FieldValue.serverTimestamp(),
    });
    return { ok: true };
  });
});

// ── Lo que ve el cliente ───────────────────────────────────────────────────

/**
 * "Tus premios": la tarjeta, la racha, los premios y lo que puede jugar.
 *
 * Es UNA llamada al entrar a la pantalla, no una suscripción: el cliente mira
 * esto un par de veces por mes y no tiene sentido pagarle un listener.
 *
 * De paso hace el mantenimiento que le corresponde, con el cliente adelante y
 * sin un proceso nocturno: escribe como vencidos los premios que vencieron, y
 * genera el regalo de cumpleaños si está en la ventana y todavía no lo tiene.
 */
exports.misRecompensas = onCall(OPCIONES, async (request) => {
  const { businessId, uid } = exigirCliente(request, request.data?.businessId);
  const hoy = hoyEnArgentina();

  const [bizSnap, cliSnap, premiosSnap] = await Promise.all([
    ref.negocio(businessId).get(),
    ref.cliente(businessId, uid).get(),
    db().collection(`businesses/${businessId}/premios`).where('userId', '==', uid).get(),
  ]);
  if (!bizSnap.exists) throw new HttpsError('not-found', 'La barbería no existe.');
  const campanas = bizSnap.get('recompensas') || {};
  const cliente = cliSnap.exists ? cliSnap.data() : {};

  // Vencidos: se escriben cuando se ven. La decisión no depende de esto
  // (`estadoDelPremio` ya los trata como vencidos), es para que el panel del
  // dueño los cuente bien.
  const vencidos = premiosSnap.docs.filter((d) => motor.estadoDelPremio(d.data(), hoy) === 'vencido' && d.get('estado') === 'disponible');
  if (vencidos.length) {
    const batch = db().batch();
    for (const d of vencidos.slice(0, 400)) batch.update(d.ref, { estado: 'vencido', vencidoEn: FieldValue.serverTimestamp() });
    await batch.commit().catch((err) => logger.warn('no se pudieron marcar vencidos', { businessId, error: err.message }));
  }

  const premios = premiosSnap.docs.map((d) => d.data());

  // El regalo de cumpleaños, si corresponde. En transacción y con id fijo por
  // año: dos pestañas abiertas el mismo día no generan dos regalos.
  const cfgCumple = campanas.cumpleanos;
  const md = cliente.cumple?.fecha;
  if (cfgCumple && md) {
    const v = motor.ventanaDeCumple(md, hoy, cfgCumple);
    if (v.enVentana) {
      const id = `cumple_${uid}_${v.anio}`;
      const nuevo = await db().runTransaction(async (tx) => {
        const ya = await tx.get(ref.premio(businessId, id));
        if (ya.exists) return null;
        const doc = documentoDelPremio({
          id, businessId, uid,
          email: request.auth.token.email, nombreCliente: request.auth.token.name,
          campana: 'cumpleanos', origen: { tipo: 'cumpleanos', ref: String(v.anio) },
          def: cfgCumple.premio, venceEn: v.venceEn,
        });
        tx.set(ya.ref, doc);
        sumarStat(tx, businessId, 'cumpleanos', 'entregados');
        return doc;
      }).catch((err) => { logger.warn('no se pudo generar el regalo de cumpleaños', { businessId, uid, error: err.message }); return null; });
      if (nuevo) premios.push({ ...nuevo, creadoEn: null, nuevo: true });
    }
  }

  const jugadas = cliente.jugadas || {};
  const puede = {};
  for (const tipo of ['ruleta', 'caja']) {
    if (!campanas[tipo]) continue;
    const frec = campanas[tipo].frecuenciaDias;
    puede[tipo] = motor.puedeJugar(jugadas[tipo], hoy, frec);
    puede[`${tipo}Proxima`] = motor.proximaJugada(jugadas[tipo], frec);
  }

  return {
    hoy,
    campanas,
    premios: premios
      .map((p) => ({ ...premioParaElCliente(p), ...(p.nuevo ? { nuevo: true } : {}) }))
      .sort((a, b) => (b.creadoEn ?? Infinity) - (a.creadoEn ?? Infinity)),
    fidelidad: campanas.fidelidad ? {
      ciclo: Number(cliente.fidelidad?.ciclo) || 1,
      sellos: Number(cliente.fidelidad?.sellos) || 0,
      casillas: Number(cliente.fidelidad?.casillas) || campanas.fidelidad.casillas,
      completa: cliente.fidelidad?.completa === true,
      completas: Number(cliente.fidelidad?.completas) || 0,
    } : null,
    racha: campanas.racha ? {
      actual: Number(cliente.racha?.actual) || 0,
      mejor: Number(cliente.racha?.mejor) || 0,
      ultimaFecha: cliente.racha?.ultimaFecha || null,
      venceEn: motor.rachaVenceEn(cliente.racha, campanas.racha),
      // Si ya se le pasó la fecha, la racha que ve es la que va a tener: 0.
      cortada: Boolean(cliente.racha?.ultimaFecha) && motor.rachaVenceEn(cliente.racha, campanas.racha) < hoy,
    } : null,
    rascas: campanas.rasca ? (cliente.rascas || []).map((r) => ({ ref: r.ref, fecha: r.fecha })) : [],
    puede,
    cumple: { fecha: md || null },
  };
});

/**
 * El cliente carga su cumpleaños. UNA vez: si se pudiera cambiar, cualquiera
 * se pondría el cumpleaños cada mes. Si se equivocó, lo corrige el dueño
 * hablando con él (no hay botón para eso, y es a propósito).
 */
exports.guardarCumpleanos = onCall(OPCIONES, async (request) => {
  const { businessId, uid } = exigirCliente(request, request.data?.businessId);
  const fecha = String(request.data?.fecha || '');
  if (!motor.mesDiaValido(fecha)) throw new HttpsError('invalid-argument', 'Esa fecha no existe.');

  return db().runTransaction(async (tx) => {
    const cli = await tx.get(ref.cliente(businessId, uid));
    if (cli.exists && cli.get('cumple')?.fecha) {
      throw new HttpsError('already-exists', 'Tu cumpleaños ya está cargado. Si hay un error, avisale a la barbería.');
    }
    tx.set(cli.ref, {
      userId: uid,
      email: String(request.auth.token.email || '').slice(0, 120),
      cumple: { fecha, cargadoEn: FieldValue.serverTimestamp() },
      actualizadoEn: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { ok: true, fecha };
  });
});

/**
 * Juega la ruleta, la caja o la rasca. El SERVIDOR sortea.
 *
 *   ruleta / caja  una vez cada `frecuenciaDias` (lo configura el dueño)
 *   rasca          una por cada turno atendido; `ref` es el id del turno
 *
 * Devuelve el índice de la porción que salió (en el orden de `segmentos`, que
 * también se devuelve: si el dueño cambió la ruleta mientras el cliente la
 * miraba, se anima con la que vale ahora) y el premio, si hubo.
 */
exports.jugarRecompensa = onCall(OPCIONES, async (request) => {
  const { businessId, uid } = exigirCliente(request, request.data?.businessId);
  const tipo = String(request.data?.tipo || '');
  const rascaRef = request.data?.ref ? String(request.data.ref) : null;
  if (!motor.JUEGOS_DE_SORTEO.includes(tipo)) throw new HttpsError('invalid-argument', 'Ese juego no existe.');
  if (tipo === 'rasca' && !rascaRef) throw new HttpsError('invalid-argument', 'Falta cuál tarjeta raspar.');
  const hoy = hoyEnArgentina();

  const r = await db().runTransaction(async (tx) => {
    const [bizSnap, campSnap, cliSnap] = await Promise.all([
      tx.get(ref.negocio(businessId)),
      tx.get(ref.campana(businessId, tipo)),
      tx.get(ref.cliente(businessId, uid)),
    ]);
    if (!bizSnap.exists) throw new HttpsError('not-found', 'La barbería no existe.');
    if (bizSnap.get('isFrozen') === true) throw new HttpsError('failed-precondition', 'Esta barbería no está tomando turnos en este momento.');
    const camp = campSnap.exists ? campSnap.data() : null;
    if (!camp || camp.activa !== true) throw new HttpsError('failed-precondition', 'Este juego no está disponible ahora.');
    const v = motor.validarCampana(tipo, camp.config);
    if (!v.ok) {
      logger.error('campaña activa con configuración inválida', { businessId, tipo, errores: v.errores });
      throw new HttpsError('failed-precondition', 'Este juego no está disponible ahora.');
    }
    const cfg = v.config;
    const cliente = cliSnap.exists ? cliSnap.data() : {};

    let premioId;
    let rascasRestantes = null;
    if (tipo === 'rasca') {
      const lista = Array.isArray(cliente.rascas) ? cliente.rascas : [];
      if (!lista.some((x) => x.ref === rascaRef)) throw new HttpsError('failed-precondition', 'Esa tarjeta ya se raspó o no es tuya.');
      rascasRestantes = lista.filter((x) => x.ref !== rascaRef);
      premioId = `rasca_${rascaRef}`;
    } else {
      const ultima = cliente.jugadas?.[tipo];
      if (!motor.puedeJugar(ultima, hoy, cfg.frecuenciaDias)) {
        throw new HttpsError('failed-precondition', `Ya jugaste. Vas a poder de nuevo desde el ${fechaCorta(motor.proximaJugada(ultima, cfg.frecuenciaDias))}.`);
      }
      premioId = `${tipo}_${uid}_${hoy}`;
    }

    const premioSnap = await tx.get(ref.premio(businessId, premioId));
    if (premioSnap.exists) throw new HttpsError('already-exists', 'Este juego ya se jugó.');

    // Las lecturas terminaron: de acá en adelante, solo escrituras.
    const indice = motor.sortear(cfg.premios, randomInt(0, 10000) / 10000);
    const segmentos = motor.segmentosDelJuego(cfg);
    let premio = null;
    if (indice >= 0) {
      premio = documentoDelPremio({
        id: premioId, businessId, uid,
        email: request.auth.token.email, nombreCliente: request.auth.token.name,
        campana: tipo, origen: { tipo, ref: rascaRef },
        def: cfg.premios[indice], venceEn: motor.sumarDias(hoy, cfg.diasVencimiento),
      });
      tx.set(premioSnap.ref, premio);
      sumarStat(tx, businessId, tipo, 'entregados');
    }
    sumarStat(tx, businessId, tipo, 'jugadas');
    tx.set(cliSnap.ref, {
      userId: uid,
      email: String(request.auth.token.email || '').slice(0, 120),
      ...(tipo === 'rasca' ? { rascas: rascasRestantes } : { jugadas: { [tipo]: hoy } }),
      actualizadoEn: FieldValue.serverTimestamp(),
    }, { merge: true });

    return {
      indice: indice >= 0 ? indice : segmentos.length - 1,
      gano: indice >= 0,
      segmentos,
      premio: premio ? premioParaElCliente({ ...premio, creadoEn: null }) : null,
      proxima: tipo === 'rasca' ? null : motor.proximaJugada(hoy, cfg.frecuenciaDias),
    };
  });

  logger.info('recompensa jugada', { businessId, uid, tipo, gano: r.gano });
  return r;
});

// ── El premio en la reserva (lo llama createAppointment) ───────────────────

/**
 * Lee y valida el premio que eligió el cliente, ADENTRO de la transacción del
 * turno: dos reservas con el mismo premio en dos pestañas pasan de a una.
 *
 * Si no sirve, rompe la reserva con el motivo — igual que la membresía y al
 * revés que el cupón. El cliente eligió explícitamente usar SU premio:
 * reservarle a precio de lista sin avisar sería cobrarle algo que no aceptó.
 *
 * La barbería correcta sale gratis: el premio se busca en la barbería del
 * turno, así que el de otra sucursal acá no existe.
 */
async function prepararPremio(tx, { businessId, premioId, uid, serviceId, precio, appointmentDate }) {
  const snap = await tx.get(ref.premio(businessId, String(premioId)));
  const noEsta = () => new HttpsError('failed-precondition', 'Ese premio ya no está disponible. Volvé a elegir.');
  if (!snap.exists) throw noEsta();
  const p = snap.data();
  // Mismo mensaje que si no existiera: no se confirma que el id es de otro.
  if (p.userId !== uid) throw noEsta();

  const u = motor.premioUsableEn(p, { fecha: appointmentDate, hoy: hoyEnArgentina() });
  if (!u.usable) {
    const mensajes = {
      vencido: `Tu premio "${p.nombre}" venció el ${fechaCorta(p.venceEn)}.`,
      'vence-antes': `Tu premio "${p.nombre}" vale para turnos hasta el ${fechaCorta(p.venceEn)}. Elegí un día anterior o reservá sin el premio.`,
      reservado: `Ya estás usando "${p.nombre}" en otro turno. Si lo cancelás, vuelve a estar disponible.`,
      usado: `"${p.nombre}" ya se usó.`,
    };
    throw new HttpsError('failed-precondition', mensajes[u.motivo] || 'Ese premio ya no está disponible.');
  }

  const calculo = motor.calcularPremio(p, { precio, serviceId });
  if (!calculo.aplica) {
    throw new HttpsError('failed-precondition', `Tu premio "${p.nombre}" no vale para este servicio. Elegí otro servicio o reservá sin el premio.`);
  }
  return { ref: snap.ref, premio: p, calculo };
}

/** Marca el premio como reservado por este turno. Es una escritura: va después de todas las lecturas. */
function reservarPremio(tx, preparado, appointmentId) {
  tx.update(preparado.ref, {
    estado: 'reservado',
    appointmentId,
    reservadoEn: FieldValue.serverTimestamp(),
  });
}

/** El snapshot que queda en el turno: el barbero lo ve en la agenda. */
function snapshotDelPremio(preparado) {
  const { premio, calculo } = preparado;
  return {
    id: premio.id,
    nombre: premio.nombre,
    tipo: premio.tipo,
    valor: Number(premio.valor) || 0,
    campana: premio.campana || null,
    descuento: calculo.descuento,
  };
}

/**
 * El happy hour que corresponde a este turno, o null. Sale del ESPEJO del
 * negocio, que solo escribe el servidor (las Rules no le dejan tocarlo al
 * dueño), así que se puede confiar en él sin una lectura de más.
 */
function happyHourDelTurno(negocio, { appointmentDate, startTime, serviceId }) {
  const cfg = negocio?.recompensas?.happyHour;
  if (!cfg) return null;
  return motor.enHappyHour(cfg, { fecha: appointmentDate, startTime, serviceId }) ? cfg : null;
}

// ── El turno avanza: el premio y la tarjeta lo siguen ──────────────────────

const TERMINAN_EL_PREMIO = ['completada', 'no_asistio'];
const VIVOS = ['pendiente', 'confirmada'];

/**
 * El premio sigue al turno, con el mismo candado que el uso del cupón: manda el
 * estado del PREMIO, no el del turno.
 *
 *   cancelada            → vuelve a disponible (o vencido, si ya pasó la fecha).
 *                          Era lo pedido: que nadie pierda su premio por cancelar.
 *   completada / no vino → usado. El "no vino" lo consume igual que al cupón:
 *                          el horario quedó bloqueado, que es lo que el premio pagó.
 *   reactivado           → si sigue libre, se vuelve a reservar.
 *   "vino" deshecho      → de usado a reservado (el barbero tocó mal).
 *
 * Un turno ATENDIDO que después "se cancela" no devuelve el premio: sería la
 * forma de usarlo dos veces. Queda logueado para revisar, como la membresía.
 */
async function seguirPremio(bizId, aptId, antes, ahora) {
  const premioRef = ref.premio(bizId, ahora.premio.id);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(premioRef);
    if (!snap.exists) return;
    const p = snap.data();
    const hoy = hoyEnArgentina();
    const esDeEste = p.appointmentId === aptId;

    if (ahora.status === 'cancelada') {
      if (esDeEste && p.estado === 'reservado') {
        tx.update(premioRef, {
          estado: p.venceEn && p.venceEn < hoy ? 'vencido' : 'disponible',
          appointmentId: null,
          liberadoEn: FieldValue.serverTimestamp(),
        });
      } else if (esDeEste && p.estado === 'usado') {
        logger.warn('turno atendido cancelado después: el premio NO se devuelve', { bizId, aptId, premioId: p.id });
      }
      return;
    }

    if (TERMINAN_EL_PREMIO.includes(ahora.status)) {
      if (esDeEste && p.estado === 'reservado') {
        tx.update(premioRef, { estado: 'usado', usadoEn: FieldValue.serverTimestamp() });
        sumarStat(tx, bizId, p.campana, 'usados');
      } else if (!esDeEste || p.estado === 'disponible') {
        logger.warn('turno con premio atendido, pero el premio no estaba reservado para él', { bizId, aptId, premioId: p.id, estado: p.estado });
      }
      return;
    }

    if (VIVOS.includes(ahora.status)) {
      if (antes.status === 'cancelada' && p.estado === 'disponible' && !p.appointmentId) {
        tx.update(premioRef, { estado: 'reservado', appointmentId: aptId, reservadoEn: FieldValue.serverTimestamp() });
      } else if (TERMINAN_EL_PREMIO.includes(antes.status) && esDeEste && p.estado === 'usado') {
        tx.update(premioRef, { estado: 'reservado', usadoEn: FieldValue.delete() });
        sumarStat(tx, bizId, p.campana, 'usados', -1);
      } else if (antes.status === 'cancelada') {
        // Se reactivó un turno cuyo premio ya se usó en otro: el turno conserva
        // el precio con descuento. Lo ve el dueño en los logs.
        logger.warn('turno reactivado con un premio que ya no está libre', { bizId, aptId, premioId: p.id, estado: p.estado });
      }
    }
  });
}

/**
 * Un turno ATENDIDO suma: sello de la tarjeta, visita de la racha y una tarjeta
 * para raspar. Solo turnos que el cliente reservó con SU cuenta: los que carga
 * el staff llevan el uid del que los cargó, y le sumarían sellos al barbero.
 */
async function sumarVisita(bizId, aptId, apt) {
  const bizSnap = await ref.negocio(bizId).get();
  const campanas = bizSnap.get('recompensas') || {};
  const { fidelidad: cfgFid, racha: cfgRacha, rasca: cfgRasca } = campanas;
  if (!cfgFid && !cfgRacha && !cfgRasca) return;

  const uid = apt.userId;
  const hoy = hoyEnArgentina();

  await db().runTransaction(async (tx) => {
    const [selloSnap, cliSnap] = await Promise.all([
      tx.get(ref.sello(bizId, aptId)),
      tx.get(ref.cliente(bizId, uid)),
    ]);
    // El candado: un turno suma UNA vez, por más veces que se toque "Vino".
    if (selloSnap.exists && selloSnap.get('estado') === 'activo') return;
    const cliente = cliSnap.exists ? cliSnap.data() : {};

    const cambios = {};
    const nuevos = [];
    let sumoFidelidad = false;
    let cicloDelSello = null;

    if (cfgFid) {
      cicloDelSello = Number(cliente.fidelidad?.ciclo) || 1;
      const r = motor.avanzarFidelidad(cliente.fidelidad, cfgFid);
      if (r.sumo) {
        sumoFidelidad = true;
        cambios.fidelidad = r.estado;
        if (r.completo) {
          nuevos.push({
            id: `fid_${uid}_${r.cicloCompletado}`, campana: 'fidelidad',
            origen: { tipo: 'fidelidad', ref: String(r.cicloCompletado) },
            def: cfgFid.premio, dias: cfgFid.diasVencimiento,
          });
        }
      }
    }

    if (cfgRacha) {
      const r = motor.avanzarRacha(cliente.racha, apt.appointmentDate, cfgRacha);
      if (r.cambio) {
        cambios.racha = r.estado;
        if (r.nivel) {
          nuevos.push({
            id: `racha_${uid}_${r.estado.inicio}_${r.nivel.racha}`, campana: 'racha',
            origen: { tipo: 'racha', ref: String(r.nivel.racha) },
            def: r.nivel.premio, dias: cfgRacha.diasVencimiento,
          });
        }
      }
    }

    if (cfgRasca) {
      const lista = (Array.isArray(cliente.rascas) ? cliente.rascas : []).filter((x) => x.ref !== aptId);
      // Tope de cinco sin raspar: el que no entra nunca no acumula una pila.
      // La fecha es la del TURNO ("por tu turno del 12/11"), no la del día en
      // que el barbero lo marcó.
      cambios.rascas = [...lista, { ref: aptId, fecha: apt.appointmentDate || hoy }].slice(-5);
    }

    // Lecturas de los premios que se van a crear (todas antes de escribir).
    const existentes = await Promise.all(nuevos.map((n) => tx.get(ref.premio(bizId, n.id))));

    tx.set(ref.sello(bizId, aptId), {
      appointmentId: aptId,
      userId: uid,
      fecha: apt.appointmentDate || null,
      sumoFidelidad,
      ciclo: sumoFidelidad ? cicloDelSello : null,
      estado: 'activo',
      creadoEn: FieldValue.serverTimestamp(),
    });

    tx.set(ref.cliente(bizId, uid), {
      userId: uid,
      email: String(apt.clientEmail || '').slice(0, 120),
      nombre: String(apt.clientName || '').slice(0, 120),
      ...cambios,
      actualizadoEn: FieldValue.serverTimestamp(),
    }, { merge: true });

    nuevos.forEach((n, i) => {
      if (existentes[i].exists) return;
      tx.set(existentes[i].ref, documentoDelPremio({
        id: n.id, businessId: bizId, uid,
        email: apt.clientEmail, nombreCliente: apt.clientName,
        campana: n.campana, origen: n.origen, def: n.def,
        venceEn: motor.sumarDias(hoy, Number(n.dias) || 60),
      }));
      sumarStat(tx, bizId, n.campana, 'entregados');
    });
  });
}

/**
 * Un turno que estaba atendido deja de estarlo (el barbero se equivocó de
 * botón). Se saca el sello si todavía se puede sin quitar nada ya entregado:
 *
 *   - de la tarjeta, solo si el sello es de la tarjeta EN CURSO y no la
 *     completó (un premio entregado no se retira por un clic);
 *   - la rasca, si todavía no se raspó.
 *
 * La racha no retrocede: es "volviste a tiempo", y volver, volvió.
 */
async function anularVisita(bizId, aptId, apt) {
  await db().runTransaction(async (tx) => {
    const selloSnap = await tx.get(ref.sello(bizId, aptId));
    if (!selloSnap.exists || selloSnap.get('estado') !== 'activo') return;
    const cliSnap = await tx.get(ref.cliente(bizId, apt.userId));
    const cliente = cliSnap.exists ? cliSnap.data() : {};
    const sello = selloSnap.data();
    const cambios = {};

    const f = cliente.fidelidad;
    if (sello.sumoFidelidad && f && Number(f.ciclo) === Number(sello.ciclo) && f.completa !== true && Number(f.sellos) > 0) {
      cambios.fidelidad = { ...f, sellos: Number(f.sellos) - 1 };
    } else if (sello.sumoFidelidad) {
      logger.warn('turno des-atendido después de completar la tarjeta: el premio queda', { bizId, aptId });
    }
    if (Array.isArray(cliente.rascas) && cliente.rascas.some((x) => x.ref === aptId)) {
      cambios.rascas = cliente.rascas.filter((x) => x.ref !== aptId);
    }

    tx.update(selloSnap.ref, { estado: 'anulado', anuladoEn: FieldValue.serverTimestamp() });
    if (Object.keys(cambios).length && cliSnap.exists) {
      tx.update(cliSnap.ref, { ...cambios, actualizadoEn: FieldValue.serverTimestamp() });
    }
  });
}

exports.onTurnoRecompensas = onDocumentUpdated({ ...OPCIONES, document: 'businesses/{bizId}/appointments/{aptId}' }, async (event) => {
  const antes = event.data?.before?.data();
  const ahora = event.data?.after?.data();
  if (!antes || !ahora || antes.status === ahora.status) return;
  const { bizId, aptId } = event.params;

  if (ahora.premio?.id) {
    await seguirPremio(bizId, aptId, antes, ahora).catch((err) => {
      logger.error('no se pudo actualizar el premio del turno', { bizId, aptId, error: err.message });
    });
  }

  // Solo turnos reservados por el cliente con su cuenta.
  if (ahora.origen !== 'cliente' || !ahora.userId) return;

  if (ahora.status === 'completada') {
    await sumarVisita(bizId, aptId, ahora).catch((err) => {
      logger.error('no se pudo sumar la visita a las recompensas', { bizId, aptId, error: err.message });
    });
  } else if (antes.status === 'completada') {
    await anularVisita(bizId, aptId, ahora).catch((err) => {
      logger.error('no se pudo anular la visita de las recompensas', { bizId, aptId, error: err.message });
    });
  }
});

module.exports.prepararPremio = prepararPremio;
module.exports.reservarPremio = reservarPremio;
module.exports.snapshotDelPremio = snapshotDelPremio;
module.exports.happyHourDelTurno = happyHourDelTurno;
module.exports.motor = motor;
