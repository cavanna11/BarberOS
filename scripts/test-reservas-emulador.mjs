// Prueba de createAppointment contra el emulador. No toca producción.
//
//   firebase emulators:start --only auth,firestore,functions
//   node scripts/test-reservas-emulador.mjs
//
// Cubre exactamente los vectores que antes pasaban escribiendo directo a
// Firestore: precio falsificado, fecha pasada, profesional inexistente, negocio
// suspendido, horario fuera de agenda, doble reserva, teléfono inválido y más
// de un turno por día del mismo cliente.
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';

const PROJECT = 'barberos-1d60e';
const REGION = 'southamerica-east1';
const FN = (n) => `http://127.0.0.1:5001/${PROJECT}/${REGION}/${n}`;
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';

initializeApp({ projectId: PROJECT });
const db = getFirestore();
const auth = getAuth();

async function usuario(email) {
  try { await auth.deleteUser((await auth.getUserByEmail(email)).uid); } catch { /* no existía */ }
  const u = await auth.createUser({ email, emailVerified: true });
  const r = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: await auth.createCustomToken(u.uid), returnSecureToken: true }),
  });
  return { uid: u.uid, token: (await r.json()).idToken };
}

async function reservar(u, datos) {
  const r = await fetch(FN('createAppointment'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(u ? { Authorization: `Bearer ${u.token}` } : {}) },
    body: JSON.stringify({ data: datos }),
  });
  const j = await r.json().catch(() => ({}));
  return j.error ? { error: j.error.status || j.error.message } : { ok: j.result };
}

let ok = 0, mal = 0;
const chequear = (desc, cond, detalle) => {
  if (cond) { ok++; console.log(`  ok    ${desc}`); }
  else { mal++; console.log(`  FALLA ${desc}\n        ${detalle}`); }
};
const titulo = (t) => console.log('\n' + t);

// ── escenario ──────────────────────────────────────────────────────────────
const BID = 'biz-test';
const PROF = 'prof-1', SRV = 'srv-1', SRV_HUERFANO = 'srv-2';

// Un martes lejano, para que nunca quede en el pasado.
const FECHA = '2027-03-02';
const DOW = 1; // 0=Lunes … 6=Domingo (convención de dateUtils, no la de JS)

await db.doc(`businesses/${BID}`).set({
  name: 'Test', slug: 'test', isFrozen: false,
  businessHours: [{ dayOfWeek: DOW, startTime: '09:00', endTime: '18:00', isActive: true }],
});
await db.doc(`businesses/${BID}/services/${SRV}`).set({ name: 'Corte', price: 12000, durationMinutes: 30, isActive: true });
await db.doc(`businesses/${BID}/services/${SRV_HUERFANO}`).set({ name: 'Color', price: 30000, durationMinutes: 60, isActive: true });
await db.doc(`businesses/${BID}/professionals/${PROF}`).set({ name: 'Martín', isActive: true });
await db.doc(`businesses/${BID}/professionalServices/ps-1`).set({ professionalId: PROF, serviceId: SRV });
await db.doc(`businesses/${BID}/schedules/sch-1`).set({
  professionalId: PROF, dayOfWeek: DOW, startTime: '09:00', endTime: '18:00',
  breakStart: '13:00', breakEnd: '14:00', isActive: true,
});
for (const d of (await db.collection(`businesses/${BID}/appointments`).get()).docs) await d.ref.delete();

const cliente = await usuario('cliente@gmail.com');
const base = {
  businessId: BID, professionalId: PROF, serviceId: SRV,
  appointmentDate: FECHA, startTime: '10:00',
  clientPhone: '+54 9 11 1234-5678',
};

titulo('Camino feliz:');
let r = await reservar(cliente, { ...base, clientName: 'Cliente' });
chequear('reserva válida', r.ok?.status === 'created', JSON.stringify(r));
chequear('el precio lo pone el servidor (12000)', r.ok?.price === 12000, JSON.stringify(r.ok));
chequear('el fin lo calcula el servidor (10:30)', r.ok?.endTime === '10:30', JSON.stringify(r.ok));

const guardado = r.ok?.id ? (await db.doc(`businesses/${BID}/appointments/${r.ok.id}`).get()).data() : {};
chequear('nace en estado pendiente', guardado.status === 'pendiente', JSON.stringify(guardado.status));
chequear('el userId es el de la sesión', guardado.userId === cliente.uid, JSON.stringify(guardado.userId));

titulo('Lo que antes se colaba escribiendo directo a Firestore:');
// Otro cliente: el primero ya tiene su turno del día y un-por-día lo pararía antes.
const c2 = await usuario('c2@gmail.com');
r = await reservar(c2, { ...base, startTime: '11:00', price: 0 });
chequear('price 0 se ignora, manda el del servicio', r.ok?.price === 12000, JSON.stringify(r));

r = await reservar(cliente, { ...base, appointmentDate: '2020-01-01' });
chequear('fecha en el pasado, rechazada', r.error === 'INVALID_ARGUMENT', JSON.stringify(r));

r = await reservar(cliente, { ...base, professionalId: 'NO-EXISTE', startTime: '15:00' });
chequear('profesional inexistente, rechazado', r.error === 'NOT_FOUND', JSON.stringify(r));

r = await reservar(cliente, { ...base, serviceId: 'NO-EXISTE', startTime: '15:00' });
chequear('servicio inexistente, rechazado', r.error === 'NOT_FOUND', JSON.stringify(r));

r = await reservar(cliente, { ...base, serviceId: SRV_HUERFANO, startTime: '15:00' });
chequear('servicio que ese profesional no hace, rechazado', r.error === 'FAILED_PRECONDITION', JSON.stringify(r));

titulo('Horario:');
r = await reservar(cliente, { ...base, startTime: '08:00' });
chequear('antes de abrir, rechazado', r.error === 'FAILED_PRECONDITION', JSON.stringify(r));
r = await reservar(cliente, { ...base, startTime: '17:45' });
chequear('se pasa del cierre, rechazado', r.error === 'FAILED_PRECONDITION', JSON.stringify(r));
r = await reservar(cliente, { ...base, startTime: '13:15' });
chequear('cae en el descanso, rechazado', r.error === 'FAILED_PRECONDITION', JSON.stringify(r));
r = await reservar(cliente, { ...base, appointmentDate: '2027-03-01' });
chequear('día que no trabaja, rechazado', r.error === 'FAILED_PRECONDITION', JSON.stringify(r));

titulo('Teléfono:');
const c3 = await usuario('c3@gmail.com');
r = await reservar(c3, { ...base, startTime: '15:00', clientPhone: '123' });
chequear('teléfono corto, rechazado', r.error === 'INVALID_ARGUMENT', JSON.stringify(r));
r = await reservar(c3, { ...base, startTime: '15:00', clientPhone: 'hola' });
chequear('teléfono sin dígitos, rechazado', r.error === 'INVALID_ARGUMENT', JSON.stringify(r));
r = await reservar(c3, { ...base, startTime: '15:00', clientPhone: '' });
chequear('teléfono vacío, rechazado', r.error === 'INVALID_ARGUMENT', JSON.stringify(r));
r = await reservar(c3, { ...base, startTime: '15:00', clientPhone: '1123456789' });
chequear('10 dígitos sin código de país, permitido', r.ok?.status === 'created', JSON.stringify(r));

titulo('Un turno por día:');
// `cliente` ya reservó a las 10:00. Otro el mismo día, en otro horario libre:
r = await reservar(cliente, { ...base, startTime: '16:00' });
chequear('segundo turno el mismo día, rechazado', r.error === 'ALREADY_EXISTS', JSON.stringify(r));

titulo('Doble reserva (otro cliente, sin turno ese día):');
const c4 = await usuario('c4@gmail.com');
r = await reservar(c4, { ...base, startTime: '10:15' });
chequear('se solapa con el de las 10:00, rechazado', r.error === 'ALREADY_EXISTS', JSON.stringify(r));
r = await reservar(c4, { ...base, startTime: '10:30' });
chequear('pegado al anterior (10:30), permitido', r.ok?.status === 'created', JSON.stringify(r));

titulo('Negocio suspendido por deuda:');
await db.doc(`businesses/${BID}`).update({ isFrozen: true });
const c5 = await usuario('c5@gmail.com');
r = await reservar(c5, { ...base, startTime: '16:00' });
chequear('barbería suspendida, no toma turnos', r.error === 'FAILED_PRECONDITION', JSON.stringify(r));
await db.doc(`businesses/${BID}`).update({ isFrozen: false });

titulo('Sin sesión:');
r = await reservar(null, { ...base, startTime: '16:30' });
chequear('anónimo, rechazado', r.error === 'UNAUTHENTICATED', JSON.stringify(r));

console.log(`\n${ok} pasaron, ${mal} fallaron\n`);
process.exit(mal ? 1 : 0);
