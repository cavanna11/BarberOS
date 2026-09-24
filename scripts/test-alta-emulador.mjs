// Alta sola de una barbería de prueba (crearBarberiaDePrueba).
//
// Es la única puerta por la que alguien de afuera crea datos en la plataforma,
// así que lo que más se prueba acá es lo que TIENE que rechazar.
//
//   firebase emulators:start --only auth,firestore,functions
//   node scripts/test-alta-emulador.mjs
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
initializeApp({ projectId: 'barberos-1d60e' });
const db = getFirestore(), auth = getAuth();
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const FN = 'http://127.0.0.1:5001/barberos-1d60e/southamerica-east1';

let pasaron = 0, fallaron = 0;
const chequear = (t, ok, d = '') => {
  if (ok) { pasaron++; console.log('  ok   ', t); }
  else { fallaron++; console.log('  FALLA', t, '\n         ', d); }
};

async function usuario(email, claims = null, verificado = true) {
  try { await auth.deleteUser((await auth.getUserByEmail(email)).uid); } catch { /* no existía */ }
  const u = await auth.createUser({ email, emailVerified: verificado });
  if (claims) await auth.setCustomUserClaims(u.uid, claims);
  const r = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: await auth.createCustomToken(u.uid), returnSecureToken: true }),
  });
  const j = await r.json();
  return { uid: u.uid, token: j.idToken, email };
}

const llamar = async (nombre, u, data) => {
  const r = await fetch(`${FN}/${nombre}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(u ? { Authorization: `Bearer ${u.token}` } : {}) },
    body: JSON.stringify({ data }),
  });
  const j = await r.json();
  return j.result ? { ok: j.result } : { error: j.error?.status, msg: j.error?.message };
};

// Escenario limpio: los slugs que dejó la corrida anterior harían fallar el alta
// por un motivo que no es el que se está probando.
for (const s of ['mi-barberia', 'otra-mas', 'segunda', 'trucha', 'equis-uno', 'sin-tel', 'anonima']) {
  await db.doc(`slugs/${s}`).delete().catch(() => {});
}

console.log('\nAlta sola:');
const nuevo = await usuario('barbero-nuevo@gmail.com');
let r = await llamar('crearBarberiaDePrueba', nuevo, {
  nombre: 'Barbería Don José', slug: 'mi-barberia', telefono: '11 2345-6789',
  ciudad: 'Mar de Ajó', nombreDueno: 'José',
});
chequear('crea la barbería', r.ok?.businessId && r.ok?.slug === 'mi-barberia', JSON.stringify(r));

const bid = r.ok?.businessId;
const biz = bid ? (await db.doc(`businesses/${bid}`).get()).data() : {};
chequear('con prueba de 5 días', r.ok?.diasDePrueba === 5 && Boolean(biz.trialEndsAt), JSON.stringify(biz.trialEndsAt));
chequear('no nace congelada', biz.isFrozen === false, JSON.stringify(biz.isFrozen));
chequear('marcada como autoservicio', biz.origen === 'autoservicio', JSON.stringify(biz.origen));
chequear('el slug apunta al negocio', (await db.doc('slugs/mi-barberia').get()).data()?.businessId === bid, 'no apunta');
chequear('quien la creó queda de dueño', (await auth.getUser(nuevo.uid)).customClaims?.role === 'owner',
  JSON.stringify((await auth.getUser(nuevo.uid)).customClaims));
chequear('el dueño queda en la lista de admins', (await db.doc(`businesses/${bid}/admins/${nuevo.email}`).get()).exists, 'no está');

const profs = await db.collection(`businesses/${bid}/professionals`).get();
const srvs = await db.collection(`businesses/${bid}/services`).get();
const schs = await db.collection(`businesses/${bid}/schedules`).get();
const ps = await db.collection(`businesses/${bid}/professionalServices`).get();
chequear('arranca con el dueño como profesional', profs.size === 1 && profs.docs[0].data().name === 'José',
  JSON.stringify(profs.docs.map((d) => d.data().name)));
chequear('con servicios de ejemplo', srvs.size === 3, String(srvs.size));
chequear('con horario cargado', schs.size === 7, String(schs.size));
chequear('y los servicios asignados al barbero', ps.size === 3, String(ps.size));

const bill = (await db.doc(`businesses/${bid}/private/billing`).get()).data();
chequear('el primer vencimiento es el fin de la prueba', bill?.nextBillingDate === biz.trialEndsAt, JSON.stringify(bill));
chequear('avisa a la plataforma',
  (await db.collection('platform/notifications/items').where('type', '==', 'alta_nueva').get()).size >= 1, 'sin aviso');

console.log('\nLo que tiene que rechazar:');
// Con el MISMO token de antes del alta. El token dura hasta una hora y todavía
// dice "sin barbería": mirando solo el token, la misma cuenta se creaba una
// barbería atrás de otra.
r = await llamar('crearBarberiaDePrueba', nuevo, { nombre: 'Otra', slug: 'otra-mas', telefono: '11 2345-6789' });
chequear('la misma cuenta NO crea una segunda', r.error === 'FAILED_PRECONDITION', JSON.stringify(r));

const otro = await usuario('otro@gmail.com');
r = await llamar('crearBarberiaDePrueba', otro, { nombre: 'Copia', slug: 'mi-barberia', telefono: '11 2345-6789' });
chequear('un slug ya tomado, rechazado', r.error === 'ALREADY_EXISTS', JSON.stringify(r));

r = await llamar('crearBarberiaDePrueba', otro, { nombre: 'Panel', slug: 'admin', telefono: '11 2345-6789' });
chequear('un slug reservado del sistema, rechazado', r.error === 'ALREADY_EXISTS', JSON.stringify(r));

r = await llamar('crearBarberiaDePrueba', otro, { nombre: 'Rara', slug: 'Con Espacios!', telefono: '11 2345-6789' });
chequear('un slug con formato inválido, rechazado', r.error === 'INVALID_ARGUMENT', JSON.stringify(r));

r = await llamar('crearBarberiaDePrueba', otro, { nombre: 'Sin tel', slug: 'sin-tel', telefono: '123' });
chequear('sin teléfono válido, rechazado', r.error === 'INVALID_ARGUMENT', JSON.stringify(r));

r = await llamar('crearBarberiaDePrueba', otro, { nombre: 'X', slug: 'equis-uno', telefono: '11 2345-6789' });
chequear('nombre de una sola letra, rechazado', r.error === 'INVALID_ARGUMENT', JSON.stringify(r));

r = await llamar('crearBarberiaDePrueba', null, { nombre: 'Anonima', slug: 'anonima', telefono: '11 2345-6789' });
chequear('sin sesión, rechazado', r.error === 'UNAUTHENTICATED', JSON.stringify(r));

// Con la API pública de Auth cualquiera crea una cuenta con el mail que quiera
// sin verificarlo. Sin este cerrojo, el alta quedaba abierta de par en par.
const sinVerificar = await usuario('sin-verificar@gmail.com', null, false);
r = await llamar('crearBarberiaDePrueba', sinVerificar, { nombre: 'Trucha', slug: 'trucha', telefono: '11 2345-6789' });
chequear('mail sin verificar, rechazado', r.error === 'FAILED_PRECONDITION', JSON.stringify(r));

const dueno = await usuario('dueno-otro@gmail.com', { businessId: 'biz-x', role: 'owner' });
r = await llamar('crearBarberiaDePrueba', dueno, { nombre: 'Segunda', slug: 'segunda', telefono: '11 2345-6789' });
chequear('quien ya tiene barbería, rechazado', r.error === 'FAILED_PRECONDITION', JSON.stringify(r));

console.log(`\n${pasaron} pasaron, ${fallaron} fallaron\n`);
process.exit(fallaron ? 1 : 0);
