// Turnos fijos: el cliente de todos los martes a las 18 (o cada 2 semanas).
//
// Lo que importa: que se agenden solos sin pisar a nadie, que correr la
// generación dos veces no duplique, que un turno cancelado a mano no vuelva, y
// que solo el staff (el barbero en SU agenda) los pueda crear y dar de baja.
//
//   firebase emulators:start --only auth,firestore,functions
//   node scripts/test-turnos-fijos-emulador.mjs
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
const PROJECT = 'barberos-1d60e';
initializeApp({ projectId: PROJECT });
const db = getFirestore(), auth = getAuth();
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const FN = `http://127.0.0.1:5001/${PROJECT}/southamerica-east1`;
const DOCS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;

const BID = 'biz-fijos';
let ok = 0, mal = 0;
const chequear = (t, c, d = '') => {
  if (c) { ok++; console.log('  ok   ', t); } else { mal++; console.log('  FALLA', t, '\n         ', typeof d === 'string' ? d : JSON.stringify(d)); }
};
const titulo = (t) => console.log(`\n── ${t}`);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
const dia = (f, n) => { const d = new Date(`${f}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dow = (f) => (new Date(`${f}T12:00:00Z`).getUTCDay() + 6) % 7; // 0=Lunes
// El próximo martes (al menos mañana) y el próximo miércoles.
const proximo = (d) => { let f = dia(hoy, 1); while (dow(f) !== d) f = dia(f, 1); return f; };
const MARTES = proximo(1), MIERCOLES = proximo(2);

// ── Escenario ──────────────────────────────────────────────────────────────
for (const col of ['appointments', 'schedules', 'services', 'professionals', 'professionalServices', 'turnosFijos', 'notifications']) {
  for (const d of (await db.collection(`businesses/${BID}/${col}`).get()).docs) await d.ref.delete();
}
await db.doc(`businesses/${BID}`).set({
  name: 'Fijos', slug: 'fijos', isFrozen: false,
  businessHours: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startTime: '09:00', endTime: '20:00', isActive: d !== 6 })),
});
for (const p of ['prof-a', 'prof-b']) {
  await db.doc(`businesses/${BID}/professionals/${p}`).set({ id: p, name: p === 'prof-a' ? 'Ana' : 'Beto', isActive: true });
  await db.doc(`businesses/${BID}/professionalServices/${p}-corte`).set({ professionalId: p, serviceId: 'corte' });
  // Trabajan martes (1) y jueves (3); el miércoles no.
  for (const d of [0, 1, 2, 3, 4, 5, 6]) {
    await db.doc(`businesses/${BID}/schedules/${p}-${d}`).set({ professionalId: p, dayOfWeek: d, startTime: '09:00', endTime: '20:00', isActive: d === 1 || d === 3 });
  }
}
await db.doc(`businesses/${BID}/services/corte`).set({ id: 'corte', name: 'Corte', price: 10000, durationMinutes: 30, isActive: true });
await db.doc(`businesses/${BID}/services/cejas`).set({ id: 'cejas', name: 'Cejas', price: 3000, durationMinutes: 15, isActive: true, adicional: true });

async function cuenta(email, claims = null) {
  try { await auth.deleteUser((await auth.getUserByEmail(email)).uid); } catch { /* no existía */ }
  const u = await auth.createUser({ email, emailVerified: true });
  if (claims) await auth.setCustomUserClaims(u.uid, claims);
  const r = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: await auth.createCustomToken(u.uid), returnSecureToken: true }),
  });
  return { uid: u.uid, token: (await r.json()).idToken };
}
const dueno = await cuenta('dueno@fijos.test', { businessId: BID, role: 'owner', businessIds: [BID] });
const ana = await cuenta('ana@fijos.test', { businessId: BID, role: 'admin', professionalId: 'prof-a' });
const beto = await cuenta('beto@fijos.test', { businessId: BID, role: 'admin', professionalId: 'prof-b' });
const cliente = await cuenta('cliente@fijos.test');
const plataforma = await cuenta('plat@fijos.test', { platform: true });

async function llamar(nombre, u, data = {}) {
  const r = await fetch(`${FN}/${nombre}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(u ? { Authorization: `Bearer ${u.token}` } : {}) },
    body: JSON.stringify({ data }),
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, data: j.result, error: j.error?.status, mensaje: j.error?.message };
}
const turnosDe = async (serieId) => (await db.collection(`businesses/${BID}/appointments`).where('serieId', '==', serieId).get()).docs.map((d) => d.data());
const base = { businessId: BID, professionalId: 'prof-a', serviceId: 'corte', startTime: '18:00', clientName: 'Juan', clientPhone: '11 2345-6789' };

// ════════════════════════════════════════════════════════════════════════════
titulo('Quién puede');
let r = await llamar('crearTurnoFijo', cliente, { ...base, fecha: MARTES, cadaSemanas: 1 });
chequear('un cliente no crea turnos fijos', r.error === 'PERMISSION_DENIED', r);
r = await llamar('crearTurnoFijo', beto, { ...base, fecha: MARTES, cadaSemanas: 1 });
chequear('un barbero no crea turnos fijos en la agenda de otro', r.error === 'PERMISSION_DENIED', r);
r = await llamar('crearTurnoFijo', ana, { ...base, serviceId: 'cejas', fecha: MARTES, cadaSemanas: 1 });
chequear('un adicional no se agenda como turno fijo', r.error === 'NOT_FOUND', r);
r = await llamar('crearTurnoFijo', ana, { ...base, fecha: MARTES, cadaSemanas: 9 });
chequear('cada 9 semanas no (1 a 8)', r.error === 'INVALID_ARGUMENT', r);
r = await llamar('crearTurnoFijo', ana, { ...base, fecha: MIERCOLES, cadaSemanas: 1 });
chequear('si el primer día el barbero no trabaja, se avisa y no se crea nada', r.error === 'FAILED_PRECONDITION' && /no trabaja/.test(r.mensaje || ''), r);
chequear('…y no queda ninguna serie a medias', (await db.collection(`businesses/${BID}/turnosFijos`).get()).size === 0);

// ════════════════════════════════════════════════════════════════════════════
titulo('Semanal');
// Un turno ya tomado en la tercera semana: esa se saltea.
const tercera = dia(MARTES, 14);
await db.doc(`businesses/${BID}/appointments/ocupado`).set({
  businessId: BID, professionalId: 'prof-a', serviceId: 'corte', appointmentDate: tercera,
  startTime: '18:00', endTime: '18:30', status: 'confirmada', userId: 'x', clientName: 'Otro', type: 'manual',
});
r = await llamar('crearTurnoFijo', ana, { ...base, fecha: MARTES, cadaSemanas: 1 });
chequear('la barbera crea el turno fijo de Juan, todos los martes a las 18', r.ok && r.data.serieId, r);
const SERIE = r.data?.serieId;
const esperadas = []; for (let f = MARTES; f <= dia(hoy, 56); f = dia(f, 7)) esperadas.push(f);
chequear('se agendan los martes de las próximas 8 semanas, salvo el ocupado',
  r.data?.creados.length === esperadas.length - 1 && !r.data.creados.includes(tercera) && r.data.creados.every((f) => dow(f) === 1), r.data);
chequear('el martes ocupado queda salteado, con el motivo', r.data?.saltados.some((x) => x.fecha === tercera && /tomado/.test(x.motivo)), r.data?.saltados);
let turnos = await turnosDe(SERIE);
chequear('cada turno queda confirmado, como "turno fijo", a las 18', turnos.every((t) => t.status === 'confirmada' && t.type === 'fijo' && t.startTime === '18:00' && t.endTime === '18:30' && t.price === 10000), turnos[0]);
await dormir(2500);
const avisos = (await db.collection(`businesses/${BID}/notifications`).get()).size;
chequear('no manda "nuevo turno" por cada semana que se agenda sola', avisos === 0, avisos);

// ════════════════════════════════════════════════════════════════════════════
titulo('Cada 2 semanas');
r = await llamar('crearTurnoFijo', dueno, { ...base, professionalId: 'prof-b', clientName: 'Pedro', startTime: '10:00', fecha: MARTES, cadaSemanas: 2 });
chequear('el dueño crea uno cada 2 semanas en la agenda de Beto', r.ok, r);
const SERIE2 = r.data?.serieId;
const fechas2 = (r.data?.creados || []);
chequear('van separados 14 días', fechas2.length >= 4 && fechas2.every((f, i) => i === 0 || f === dia(fechas2[i - 1], 14)), fechas2);

// ════════════════════════════════════════════════════════════════════════════
titulo('Generación diaria');
r = await llamar('extenderTurnosFijos', dueno, {});
chequear('la generación manual es solo de la plataforma', r.error === 'PERMISSION_DENIED', r);
// Simula que pasó el tiempo: vuelve a generar desde el principio.
await db.doc(`businesses/${BID}/turnosFijos/${SERIE}`).update({ generadoHasta: MARTES });
const antes = (await turnosDe(SERIE)).length;
r = await llamar('extenderTurnosFijos', plataforma, {});
r = await llamar('extenderTurnosFijos', plataforma, {});
chequear('correrla dos veces (y regenerar lo ya agendado) no duplica nada', (await turnosDe(SERIE)).length === antes, { antes, despues: (await turnosDe(SERIE)).length });

// Un martes cancelado a mano no vuelve.
const cancelado = `${SERIE}_${dia(MARTES, 7)}`;
await db.doc(`businesses/${BID}/appointments/${cancelado}`).update({ status: 'cancelada' });
await db.doc(`businesses/${BID}/turnosFijos/${SERIE}`).update({ generadoHasta: MARTES });
await llamar('extenderTurnosFijos', plataforma, {});
chequear('un turno de la serie cancelado a mano no se vuelve a agendar', (await db.doc(`businesses/${BID}/appointments/${cancelado}`).get()).data().status === 'cancelada');

// ════════════════════════════════════════════════════════════════════════════
titulo('Rules');
const leer = (u, ruta) => fetch(`${DOCS}/${ruta}`, { headers: { Authorization: `Bearer ${u.token}` } });
const listar = (u, where) => fetch(`${DOCS}/businesses/${BID}:runQuery`, {
  method: 'POST', headers: { Authorization: `Bearer ${u.token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'turnosFijos' }], ...(where ? { where: { fieldFilter: { field: { fieldPath: 'professionalId' }, op: 'EQUAL', value: { stringValue: where } } } } : {}) } }),
});
let rr = await listar(ana, 'prof-a');
chequear('la barbera lee los suyos', rr.ok, `${rr.status} ${(await rr.text()).slice(0, 200)}`);
chequear('la barbera no lista los de todos', (await listar(ana)).status === 403);
chequear('no lee el de otro barbero', (await leer(ana, `businesses/${BID}/turnosFijos/${SERIE2}`)).status === 403);
rr = await listar(dueno);
chequear('el dueño lista todos', rr.ok, `${rr.status} ${(await rr.text()).slice(0, 200)}`);
chequear('un cliente no lee nada', (await leer(cliente, `businesses/${BID}/turnosFijos/${SERIE}`)).status === 403);
const escribir = await fetch(`${DOCS}/businesses/${BID}/turnosFijos/${SERIE}?updateMask.fieldPaths=activo`, {
  method: 'PATCH', headers: { Authorization: `Bearer ${dueno.token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ fields: { activo: { booleanValue: false } } }),
});
chequear('nadie lo escribe directo (ni el dueño): va por la function', escribir.status === 403);

// ════════════════════════════════════════════════════════════════════════════
titulo('Dar de baja');
r = await llamar('darDeBajaTurnoFijo', beto, { businessId: BID, serieId: SERIE });
chequear('Beto no da de baja el turno fijo de Ana', r.error === 'PERMISSION_DENIED', r);
r = await llamar('darDeBajaTurnoFijo', ana, { businessId: BID, serieId: SERIE });
chequear('Ana lo da de baja', r.ok && r.data.cancelados > 0, r);
turnos = await turnosDe(SERIE);
chequear('se cancelan todos los que venían', turnos.every((t) => t.status === 'cancelada'), turnos.map((t) => t.status));
chequear('…con el motivo', turnos.some((t) => t.cancellationReason === 'Se dio de baja el turno fijo'));
await llamar('extenderTurnosFijos', plataforma, {});
chequear('dado de baja, la generación diaria no agenda más', (await turnosDe(SERIE)).every((t) => t.status === 'cancelada'));
chequear('el de Beto sigue andando', (await turnosDe(SERIE2)).every((t) => t.status === 'confirmada'));

console.log(`\n${ok} ok, ${mal} fallas`);
process.exit(mal ? 1 : 0);
