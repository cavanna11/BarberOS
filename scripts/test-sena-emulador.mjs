// Seña: el turno se guarda mientras el cliente paga, y se confirma solo cuando
// Mercado Pago avisa.
//
// No se llama a Mercado Pago de verdad (haría falta una cuenta conectada): lo
// que se prueba acá es NUESTRA lógica, que es donde están los riesgos —que un
// turno sin pagar no bloquee el horario para siempre, que el que venció deje
// pasar a otro, y que un turno sin seña siga funcionando como siempre.
//
//   firebase emulators:start --only auth,firestore,functions
//   node scripts/test-sena-emulador.mjs
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
initializeApp({ projectId: 'barberos-1d60e' });
const db = getFirestore(), auth = getAuth();

const BID = 'biz-sena';
const PROF = 'prof-s', SRV = 'srv-s';
const FECHA = '2027-04-06'; // un martes
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const FN = 'http://127.0.0.1:5001/barberos-1d60e/southamerica-east1';

let ok = 0, mal = 0;
const chequear = (t, c, d = '') => {
  if (c) { ok++; console.log('  ok   ', t); }
  else { mal++; console.log('  FALLA', t, '\n         ', d); }
};

async function escenario({ conSena, modo = 'obligatoria' }) {
  for (const col of ['appointments', 'schedules', 'services', 'professionals', 'professionalServices']) {
    for (const d of (await db.collection(`businesses/${BID}/${col}`).get()).docs) await d.ref.delete();
  }
  await db.doc(`businesses/${BID}`).set({
    name: 'Seña Test', slug: 'senatest', isFrozen: false,
    businessHours: [{ dayOfWeek: 1, startTime: '09:00', endTime: '20:00', isActive: true }],
    mpConectado: conSena,
    sena: conSena ? { activa: true, monto: 3000, modo } : { activa: false, monto: 0 },
  });
  await db.doc(`businesses/${BID}/professionals/${PROF}`).set({ id: PROF, name: 'Lucas', isActive: true });
  await db.doc(`businesses/${BID}/services/${SRV}`).set({ id: SRV, name: 'Corte', price: 12000, durationMinutes: 30, isActive: true });
  await db.doc(`businesses/${BID}/professionalServices/ps-s`).set({ professionalId: PROF, serviceId: SRV });
  await db.doc(`businesses/${BID}/schedules/sch-s`).set({ professionalId: PROF, dayOfWeek: 1, startTime: '09:00', endTime: '20:00', isActive: true });
}

async function cliente(email) {
  try { await auth.deleteUser((await auth.getUserByEmail(email)).uid); } catch { /* no existía */ }
  const u = await auth.createUser({ email, emailVerified: true });
  const r = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: await auth.createCustomToken(u.uid), returnSecureToken: true }),
  });
  return { uid: u.uid, token: (await r.json()).idToken };
}

const reservar = async (u, datos) => {
  const r = await fetch(`${FN}/createAppointment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${u.token}` },
    body: JSON.stringify({ data: { businessId: BID, professionalId: PROF, serviceId: SRV, appointmentDate: FECHA, clientPhone: '+5491112345678', clientName: 'Test', ...datos } }),
  });
  const j = await r.json();
  return j.result ? { ok: j.result } : { error: j.error?.status, msg: j.error?.message };
};

// ── Sin seña: nada cambia ───────────────────────────────────────────────────
console.log('\nBarbería que NO cobra seña (tiene que seguir igual):');
await escenario({ conSena: false });
let r = await reservar(await cliente('c1-s@gmail.com'), { startTime: '10:00' });
chequear('reserva normal, confirmada de una', r.ok?.status === 'created', JSON.stringify(r));

// ── Con seña ────────────────────────────────────────────────────────────────
console.log('\nBarbería que SÍ cobra seña:');
await escenario({ conSena: true });
const c2 = await cliente('c2-s@gmail.com');
r = await reservar(c2, { startTime: '11:00' });
// Sin una cuenta de Mercado Pago de verdad, crear el pago falla: lo que importa
// es que entonces el turno NO quede bloqueando el horario.
chequear('si no se puede abrir el pago, avisa', r.error === 'UNAVAILABLE', JSON.stringify(r));
const tras = (await db.collection(`businesses/${BID}/appointments`).get()).docs.map((d) => d.data());
chequear('y el turno queda cancelado, sin bloquear el horario',
  tras.length === 1 && tras[0].status === 'cancelada', JSON.stringify(tras.map((a) => a.status)));

// ── El horario guardado mientras se paga ────────────────────────────────────
// Hay clientes sin Mercado Pago, o sin plata en la cuenta. Si la barbería
// deja elegir, el que quiere pagar en el local tiene que poder reservar igual.
console.log('\nSeña OPCIONAL (la elige el cliente):');
await escenario({ conSena: true, modo: 'opcional' });
r = await reservar(await cliente('c5-s@gmail.com'), { startTime: '14:00', pagarSena: false });
chequear('el que paga en el local reserva sin pasar por Mercado Pago',
  r.ok?.status === 'created', JSON.stringify(r));
const sinSena = (await db.collection(`businesses/${BID}/appointments`).get()).docs.map((d) => d.data());
chequear('y su turno queda reservado de una, sin seña',
  sinSena.length === 1 && sinSena[0].status === 'pendiente' && !sinSena[0].sena,
  JSON.stringify(sinSena.map((a) => [a.status, a.sena])));
r = await reservar(await cliente('c6-s@gmail.com'), { startTime: '15:00', pagarSena: true });
chequear('y el que elige dejar seña va al pago', r.error === 'UNAVAILABLE', JSON.stringify(r));

// Con la seña obligatoria no hay elección: mandar pagarSena:false no alcanza.
await escenario({ conSena: true, modo: 'obligatoria' });
r = await reservar(await cliente('c7-s@gmail.com'), { startTime: '16:00', pagarSena: false });
chequear('con seña obligatoria, no se puede esquivar el pago',
  r.error === 'UNAVAILABLE', JSON.stringify(r));

console.log('\nEl horario que se le guarda al que está pagando:');
await escenario({ conSena: true });
const enEspera = db.collection(`businesses/${BID}/appointments`).doc();
await enEspera.set({
  id: enEspera.id, businessId: BID, userId: 'otro-cliente', professionalId: PROF, serviceId: SRV,
  appointmentDate: FECHA, startTime: '12:00', endTime: '12:30', price: 12000, status: 'esperando_pago',
  sena: { monto: 3000, estado: 'pendiente' },
  senaExpiraEn: new Date(Date.now() + 15 * 60000),
});
r = await reservar(await cliente('c3-s@gmail.com'), { startTime: '12:00' });
chequear('otro cliente NO puede tomar ese horario mientras el primero paga',
  r.error === 'ALREADY_EXISTS', JSON.stringify(r));

await enEspera.update({ senaExpiraEn: new Date(Date.now() - 60000) }); // ya venció
r = await reservar(await cliente('c4-s@gmail.com'), { startTime: '12:00' });
// Falla al crear el pago (no hay cuenta conectada), pero YA no es por el horario:
// el turno vencido dejó de bloquear, que es lo que se está probando.
chequear('vencido el plazo, el horario se libera solo',
  r.error !== 'ALREADY_EXISTS', JSON.stringify(r));

// ── getBusySlots no puede mostrar ocupado lo que ya venció ──────────────────
console.log('\nLa grilla del cliente:');
const busy = async () => {
  const res = await fetch(`${FN}/getBusySlots`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { businessId: BID, professionalId: PROF, appointmentDate: FECHA } }),
  });
  return (await res.json()).result?.ocupados || [];
};
chequear('un turno con la seña vencida NO figura ocupado',
  !(await busy()).some((o) => o.startTime === '12:00'), JSON.stringify(await busy()));

await enEspera.update({ senaExpiraEn: new Date(Date.now() + 15 * 60000) });
chequear('y mientras está vigente, sí figura ocupado',
  (await busy()).some((o) => o.startTime === '12:00'), JSON.stringify(await busy()));

console.log(`\n${ok} pasaron, ${mal} fallaron\n`);
process.exit(mal ? 1 : 0);
