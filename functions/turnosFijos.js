// ============================================================================
// Turnos fijos — el cliente que viene siempre el mismo día a la misma hora
// ============================================================================
// "Juan, todos los martes a las 18" o "cada dos semanas los sábados a las 11".
// El barbero lo carga UNA vez y los turnos se agendan solos.
//
// Por qué del lado del servidor y no como el turno a mano (que escribe el
// browser): las semanas que vienen se tienen que seguir agendando aunque nadie
// abra el panel. Una tarea diaria mantiene siempre HORIZONTE_DIAS agendados
// hacia adelante.
//
// Cada turno generado tiene id `${serieId}_${fecha}`: correr la generación dos
// veces (la tarea diaria, un reintento) no duplica nada, y un turno de la serie
// que el barbero canceló a mano no vuelve a aparecer — el documento existe.
//
// Si un día no se puede (horario tomado, el barbero no trabaja, el local
// cierra), ese turno se SALTEA y queda anotado en la serie: no se pisa a nadie
// ni se mueve el horario por su cuenta.

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const ausenciasSrv = require('./ausencias');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const logger = require('firebase-functions/logger');

const REGION = 'southamerica-east1';
const OPCIONES = { region: REGION, maxInstances: 10 };
const db = () => getFirestore();

/** Cuántos días hacia adelante se mantienen agendados. */
const HORIZONTE_DIAS = 56; // 8 semanas
const FORMATO_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const FORMATO_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

const hoyEnArgentina = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const sumarDias = (f, n) => { const d = new Date(`${f}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
/** 0=Lunes … 6=Domingo, la convención de los horarios. */
const diaDeLaSemana = (f) => (new Date(`${f}T12:00:00Z`).getUTCDay() + 6) % 7;
const aMinutos = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
const aHora = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** ¿Este turno ocupa el lugar? (la misma regla que createAppointment) */
function reservaViva(a) {
  if (a.status === 'pendiente' || a.status === 'confirmada') return true;
  if (a.status !== 'esperando_pago') return false;
  return (a.senaExpiraEn?.toMillis?.() ?? 0) > Date.now();
}

/**
 * El dueño de la cuenta, la plataforma, o el barbero sobre SU agenda. Devuelve
 * el businessId validado.
 */
function exigirStaff(request, businessId, professionalId = null) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Tenés que iniciar sesión.');
  const c = request.auth.token || {};
  const id = String(businessId || '').trim();
  if (!id) throw new HttpsError('invalid-argument', 'Falta la barbería.');
  if (c.platform === true) return { id, rol: 'plataforma' };
  const deLaCuenta = c.businessId === id || (c.businessIds || []).includes(id);
  if (deLaCuenta && c.role === 'owner') return { id, rol: 'owner' };
  // El mostrador agenda para cualquiera: es su trabajo. Lo que no puede es
  // ver la caja del negocio, y eso se decide en otro lado.
  if (deLaCuenta && c.role === 'cajero') return { id, rol: 'owner' };
  if (deLaCuenta && c.role === 'admin') {
    if (professionalId && professionalId !== c.professionalId) {
      throw new HttpsError('permission-denied', 'Solo podés agendar turnos fijos en tu propia agenda.');
    }
    return { id, rol: 'admin', professionalId: c.professionalId };
  }
  throw new HttpsError('permission-denied', 'Solo el staff de la barbería.');
}

/** Por qué no se puede ese día, o null si se puede. */
function motivoDelDia(negocio, horarioProf, fecha, inicio, fin, ausenciasProf = []) {
  const dow = diaDeLaSemana(fecha);
  const local = (negocio.businessHours || []).find((h) => h.dayOfWeek === dow);
  if (local && local.isActive === false) return 'el local cierra ese día';
  const prof = horarioProf.find((h) => h.dayOfWeek === dow);
  if (!prof || prof.isActive === false || !prof.startTime || !prof.endTime) return 'el barbero no trabaja ese día';
  let desde = aMinutos(prof.startTime), hasta = aMinutos(prof.endTime);
  if (local?.startTime && local?.endTime) { desde = Math.max(desde, aMinutos(local.startTime)); hasta = Math.min(hasta, aMinutos(local.endTime)); }
  if (inicio < desde || inicio >= hasta) return 'fuera del horario de atención';
  for (const h of [prof, local]) {
    if (h?.breakStart && h?.breakEnd && inicio < aMinutos(h.breakEnd) && fin > aMinutos(h.breakStart)) return 'cae en el corte del mediodía';
  }
  // El día suelto que avisó que no viene. Se saltea esa fecha y la serie sigue:
  // un turno fijo no se da de baja porque el barbero falte un miércoles.
  if (ausenciasSrv.motivoEnLista(ausenciasProf.filter((x) => x.fecha === fecha), inicio, fin)) {
    return 'el barbero avisó que ese día no está';
  }
  return null;
}

/**
 * Agenda los turnos de una serie entre dos fechas (inclusive), cada
 * `cadaSemanas`. Cada uno en su transacción: el horario se verifica libre
 * justo antes de escribir. Devuelve { creados, saltados }.
 */
async function generar(bizId, serieSnap, desde, hasta) {
  const s = serieSnap.data();
  const negocio = (await db().doc(`businesses/${bizId}`).get()).data() || {};
  if (negocio.isFrozen === true) return { creados: [], saltados: [] };
  const horarioProf = (await db().collection(`businesses/${bizId}/schedules`).where('professionalId', '==', s.professionalId).get())
    .docs.map((d) => d.data());
  // Una sola lectura para todas las fechas del bucle: consultarlas por fecha
  // serían ocho viajes a la base para una serie semanal.
  const ausenciasProf = await ausenciasSrv.leerDelProfesional(db(), bizId, s.professionalId);
  const inicio = aMinutos(s.startTime);
  const fin = inicio + s.durationMinutes;
  const paso = 7 * s.cadaSemanas;
  const agenda = db().collection(`businesses/${bizId}/appointments`);

  const creados = [], saltados = [];
  let ultima = null;
  for (let fecha = desde; fecha <= hasta; fecha = sumarDias(fecha, paso)) {
    ultima = fecha;
    const motivo = motivoDelDia(negocio, horarioProf, fecha, inicio, fin, ausenciasProf);
    if (motivo) { saltados.push({ fecha, motivo }); continue; }

    const ref = agenda.doc(`${serieSnap.id}_${fecha}`);
    const r = await db().runTransaction(async (tx) => {
      if ((await tx.get(ref)).exists) return 'ya-estaba';
      const delDia = await tx.get(agenda.where('appointmentDate', '==', fecha).where('professionalId', '==', s.professionalId));
      const choca = delDia.docs.map((d) => d.data()).filter(reservaViva).some((a) => {
        const aIni = aMinutos(a.startTime), aFin = a.endTime ? aMinutos(a.endTime) : aIni;
        return inicio < aFin && fin > aIni;
      });
      if (choca) return 'ocupado';
      tx.set(ref, {
        id: ref.id,
        businessId: bizId,
        userId: s.creadoPor,
        professionalId: s.professionalId,
        serviceId: s.serviceId,
        serviceName: s.serviceName,
        appointmentDate: fecha,
        startTime: s.startTime,
        endTime: aHora(fin),
        price: s.price,
        durationMinutes: s.durationMinutes,
        clientName: s.clientName,
        clientPhone: s.clientPhone,
        clientEmail: '',
        notes: s.notes || '',
        status: 'confirmada',
        type: 'fijo',
        serieId: serieSnap.id,
        createdAt: FieldValue.serverTimestamp(),
      });
      return 'creado';
    });
    if (r === 'creado') creados.push(fecha);
    else if (r === 'ocupado') saltados.push({ fecha, motivo: 'ese horario ya estaba tomado' });
  }

  await serieSnap.ref.update({
    ...(ultima ? { generadoHasta: ultima } : {}),
    ...(saltados.length ? { saltados: FieldValue.arrayUnion(...saltados) } : {}),
  });
  return { creados, saltados };
}

/**
 * Crea un turno fijo y agenda las próximas semanas. `fecha` es la del primer
 * turno (define el día de la semana); `cadaSemanas` 1 a 8.
 */
exports.crearTurnoFijo = onCall(OPCIONES, async (request) => {
  const d = request.data || {};
  const { id: bizId } = exigirStaff(request, d.businessId, d.professionalId);
  const cadaSemanas = Number(d.cadaSemanas);
  if (!Number.isInteger(cadaSemanas) || cadaSemanas < 1 || cadaSemanas > 8) {
    throw new HttpsError('invalid-argument', 'Elegí cada cuántas semanas se repite (1 a 8).');
  }
  if (!FORMATO_FECHA.test(String(d.fecha)) || !FORMATO_HORA.test(String(d.startTime))) {
    throw new HttpsError('invalid-argument', 'Fecha u hora con formato inválido.');
  }
  if (d.fecha < hoyEnArgentina()) throw new HttpsError('invalid-argument', 'El primer turno no puede ser en el pasado.');
  const clientName = String(d.clientName || '').trim().slice(0, 120);
  if (!clientName) throw new HttpsError('invalid-argument', 'Poné el nombre del cliente.');
  const digitos = String(d.clientPhone || '').replace(/\D/g, '');
  if (digitos && (digitos.length < 10 || digitos.length > 13)) {
    throw new HttpsError('invalid-argument', 'El teléfono tiene que tener entre 10 y 13 dígitos, o dejalo vacío.');
  }

  const [prof, srv, vinculo] = await Promise.all([
    db().doc(`businesses/${bizId}/professionals/${d.professionalId}`).get(),
    db().doc(`businesses/${bizId}/services/${d.serviceId}`).get(),
    db().collection(`businesses/${bizId}/professionalServices`)
      .where('professionalId', '==', String(d.professionalId)).where('serviceId', '==', String(d.serviceId)).limit(1).get(),
  ]);
  if (!prof.exists || prof.data().isActive === false) throw new HttpsError('not-found', 'Ese profesional no existe o está inactivo.');
  if (!srv.exists || srv.data().isActive === false || srv.data().adicional === true) throw new HttpsError('not-found', 'Ese servicio no existe o no se puede agendar.');
  if (vinculo.empty) throw new HttpsError('failed-precondition', 'Ese profesional no hace ese servicio.');
  const ps = vinculo.docs[0].data();
  const servicio = srv.data();
  const duracion = Number(ps.customDuration || servicio.durationMinutes) || 30;

  // El primer turno tiene que poder darse: si no, se avisa por qué y no se
  // crea nada (una serie que arranca salteada confunde más de lo que ayuda).
  const negocio = (await db().doc(`businesses/${bizId}`).get()).data() || {};
  const horarioProf = (await db().collection(`businesses/${bizId}/schedules`).where('professionalId', '==', String(d.professionalId)).get())
    .docs.map((x) => x.data());
  const inicio = aMinutos(d.startTime);
  const ausenciasDelProf = await ausenciasSrv.leerDelProfesional(db(), bizId, String(d.professionalId));
  const motivo = motivoDelDia(negocio, horarioProf, d.fecha, inicio, inicio + duracion, ausenciasDelProf);
  if (motivo) throw new HttpsError('failed-precondition', `El primer turno no se puede: ${motivo}.`);
  const ocupado = (await db().collection(`businesses/${bizId}/appointments`)
    .where('appointmentDate', '==', d.fecha).where('professionalId', '==', String(d.professionalId)).get())
    .docs.map((x) => x.data()).filter(reservaViva)
    .some((a) => inicio < (a.endTime ? aMinutos(a.endTime) : aMinutos(a.startTime)) && inicio + duracion > aMinutos(a.startTime));
  if (ocupado) throw new HttpsError('already-exists', 'Ese horario ya está tomado el primer día. Elegí otro.');

  const ref = db().collection(`businesses/${bizId}/turnosFijos`).doc();
  await ref.set({
    id: ref.id,
    professionalId: d.professionalId,
    professionalName: prof.data().name || '',
    serviceId: d.serviceId,
    serviceName: servicio.name || '',
    price: Number(ps.customPrice || servicio.price) || 0,
    durationMinutes: duracion,
    clientName,
    clientPhone: String(d.clientPhone || '').trim().slice(0, 40),
    notes: String(d.notes || '').trim().slice(0, 500),
    diaSemana: diaDeLaSemana(d.fecha),
    startTime: d.startTime,
    cadaSemanas,
    desde: d.fecha,
    generadoHasta: null,
    saltados: [],
    activo: true,
    creadoPor: request.auth.uid,
    creadoEn: FieldValue.serverTimestamp(),
  });

  const r = await generar(bizId, await ref.get(), d.fecha, sumarDias(hoyEnArgentina(), HORIZONTE_DIAS));
  logger.info('turno fijo creado', { bizId, serieId: ref.id, cadaSemanas, creados: r.creados.length, saltados: r.saltados.length });
  return { serieId: ref.id, ...r };
});

/**
 * Da de baja un turno fijo: no se agendan más, y los que ya estaban agendados
 * de hoy en adelante se cancelan (los pasados quedan, son historial).
 */
exports.darDeBajaTurnoFijo = onCall(OPCIONES, async (request) => {
  const d = request.data || {};
  const staff = exigirStaff(request, d.businessId);
  const ref = db().doc(`businesses/${staff.id}/turnosFijos/${String(d.serieId || '')}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Ese turno fijo no existe.');
  if (staff.rol === 'admin' && snap.data().professionalId !== staff.professionalId) {
    throw new HttpsError('permission-denied', 'Ese turno fijo no es de tu agenda.');
  }
  const hoy = hoyEnArgentina();
  const futuros = (await db().collection(`businesses/${staff.id}/appointments`).where('serieId', '==', ref.id).get())
    .docs.filter((t) => t.data().appointmentDate >= hoy && ['pendiente', 'confirmada'].includes(t.data().status));
  const lote = db().batch();
  for (const t of futuros) {
    lote.update(t.ref, {
      status: 'cancelada', cancelledBy: 'staff', cancelledAt: new Date().toISOString(),
      cancellationReason: 'Se dio de baja el turno fijo',
    });
  }
  lote.update(ref, { activo: false, bajaEn: FieldValue.serverTimestamp(), bajaPor: request.auth.uid });
  await lote.commit();
  logger.info('turno fijo dado de baja', { bizId: staff.id, serieId: ref.id, cancelados: futuros.length });
  return { cancelados: futuros.length };
});

/** Mantiene agendados HORIZONTE_DIAS hacia adelante en todas las series activas. */
async function extenderTurnosFijos() {
  const tope = sumarDias(hoyEnArgentina(), HORIZONTE_DIAS);
  let series = 0, creados = 0;
  for (const b of (await db().collection('businesses').get()).docs) {
    for (const s of (await b.ref.collection('turnosFijos').where('activo', '==', true).get()).docs) {
      series++;
      const datos = s.data();
      const desde = datos.generadoHasta ? sumarDias(datos.generadoHasta, 7 * datos.cadaSemanas) : datos.desde;
      if (desde > tope) continue;
      try {
        creados += (await generar(b.id, s, desde, tope)).creados.length;
      } catch (err) {
        logger.error('no se pudo extender un turno fijo', { bizId: b.id, serieId: s.id, error: err.message });
      }
    }
  }
  logger.info('turnos fijos extendidos', { series, creados });
  return { series, creados };
}

exports.extenderTurnosFijosDiario = onSchedule(
  { ...OPCIONES, schedule: '0 4 * * *', timeZone: 'America/Argentina/Buenos_Aires' },
  async () => { await extenderTurnosFijos(); }
);

/** Para correrla a mano (la plataforma) y para las pruebas. */
exports.extenderTurnosFijos = onCall(OPCIONES, async (request) => {
  if (request.auth?.token?.platform !== true) throw new HttpsError('permission-denied', 'Solo la plataforma.');
  return extenderTurnosFijos();
});
