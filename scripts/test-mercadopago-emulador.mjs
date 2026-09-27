// Mercado Pago: conexión de la cuenta del barbero y resguardo de sus tokens.
//
// Lo que más importa acá NO es que conecte: es que el access token de la cuenta
// de Mercado Pago del barbero —con el que se puede cobrar y mover plata— no
// salga nunca al browser, ni siquiera para su dueño.
//
//   firebase emulators:start --only auth,firestore,functions
//   node scripts/test-mercadopago-emulador.mjs
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
initializeApp({ projectId: 'barberos-1d60e' });
const db = getFirestore(), auth = getAuth();

const BID = 'biz-mp';
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const FN = 'http://127.0.0.1:5001/barberos-1d60e/southamerica-east1';
const DOCS = 'http://127.0.0.1:8080/v1/projects/barberos-1d60e/databases/(default)/documents';

let ok = 0, mal = 0;
const chequear = (t, c, d = '') => {
  if (c) { ok++; console.log('  ok   ', t); }
  else { mal++; console.log('  FALLA', t, '\n         ', d); }
};

await db.doc(`businesses/${BID}`).set({ name: 'MP Test', slug: 'mptest', isFrozen: false, mpConectado: false });
await db.doc(`businesses/${BID}/private/mercadopago`).set({ accessToken: 'SECRETO-NO-DEBE-SALIR', refreshToken: 'r' });

async function cuenta(email, claims) {
  try { await auth.deleteUser((await auth.getUserByEmail(email)).uid); } catch { /* no existía */ }
  const u = await auth.createUser({ email, emailVerified: true });
  await auth.setCustomUserClaims(u.uid, claims);
  const r = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: await auth.createCustomToken(u.uid), returnSecureToken: true }),
  });
  return { uid: u.uid, token: (await r.json()).idToken };
}

const dueno = await cuenta('d-mp@test.com', { businessId: BID, role: 'owner' });
const barbero = await cuenta('b-mp@test.com', { businessId: BID, role: 'admin', professionalId: 'p1' });
const plat = await cuenta('p-mp@test.com', { platform: true });

const llamar = async (n, u, data = {}) => {
  const r = await fetch(`${FN}/${n}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(u ? { Authorization: `Bearer ${u.token}` } : {}) },
    body: JSON.stringify({ data }),
  });
  const j = await r.json();
  return j.result ? { ok: j.result } : { error: j.error?.status, msg: j.error?.message };
};
const leer = (u, path) => fetch(`${DOCS}/${path}`, { headers: u ? { Authorization: `Bearer ${u.token}` } : {} });

console.log('\nTokens de Mercado Pago (lo más sensible de todo el sistema):');
chequear('el DUEÑO no puede leer sus propios tokens desde el browser',
  (await leer(dueno, `businesses/${BID}/private/mercadopago`)).status === 403, 'los leyó');
chequear('un barbero tampoco',
  (await leer(barbero, `businesses/${BID}/private/mercadopago`)).status === 403, 'los leyó');
chequear('la plataforma tampoco (solo el Admin SDK adentro de la function)',
  (await leer(plat, `businesses/${BID}/private/mercadopago`)).status === 403, 'los leyó');
chequear('anónimo tampoco',
  (await leer(null, `businesses/${BID}/private/mercadopago`)).status === 403, 'los leyó');

console.log('\nQuién puede conectar y desconectar:');
let r = await llamar('urlConectarMercadoPago', barbero);
chequear('un barbero NO puede conectar la cuenta', r.error === 'PERMISSION_DENIED', JSON.stringify(r));
r = await llamar('desconectarMercadoPago', barbero);
chequear('un barbero NO puede desconectarla', r.error === 'PERMISSION_DENIED', JSON.stringify(r));
r = await llamar('desconectarMercadoPago', null);
chequear('sin sesión, rechazado', r.error === 'UNAUTHENTICATED', JSON.stringify(r));
r = await llamar('urlConectarMercadoPago', dueno);
// Sin los secrets cargados devuelve failed-precondition, que también es correcto.
chequear('el dueño conecta (o avisa que falta configurar la plataforma)',
  r.error === 'FAILED_PRECONDITION' || Boolean(r.ok?.url), JSON.stringify(r));

// El dueño de la plataforma administra las cuentas y acompaña al barbero
// cuando la configura, así que también puede — pasando de qué barbería.
// Un moderador no: no toca plata.
console.log('\nLa plataforma, administrando una barbería:');
r = await llamar('urlConectarMercadoPago', plat, { businessId: BID });
chequear('la plataforma SÍ puede conectar una barbería',
  r.error === 'FAILED_PRECONDITION' || Boolean(r.ok?.url), JSON.stringify(r));
r = await llamar('urlConectarMercadoPago', plat, {});
chequear('pero tiene que decir cuál', r.error === 'INVALID_ARGUMENT', JSON.stringify(r));
const moderador = await cuenta('mod-mp@test.com', { platform: 'moderator' });
r = await llamar('urlConectarMercadoPago', moderador, { businessId: BID });
chequear('un moderador NO toca el cobro', r.error === 'PERMISSION_DENIED', JSON.stringify(r));
const ajeno = await cuenta('ajeno-mp@test.com', { businessId: 'otra-barberia', role: 'owner' });
await llamar('desconectarMercadoPago', ajeno, { businessId: BID });
chequear('un dueño NO desconecta la barbería de otro',
  (await db.doc(`businesses/${BID}/private/mercadopago`).get()).exists, 'le tocó la cuenta ajena');

console.log('\nDesconectar deja todo limpio:');
r = await llamar('desconectarMercadoPago', dueno);
chequear('el dueño sí puede desconectar', r.ok?.ok === true, JSON.stringify(r));
chequear('se borran los tokens', !(await db.doc(`businesses/${BID}/private/mercadopago`).get()).exists, 'siguen ahí');
const biz = (await db.doc(`businesses/${BID}`).get()).data();
chequear('queda marcado como desconectado', biz.mpConectado === false, JSON.stringify(biz.mpConectado));
// Si no puede cobrar, no puede pedir seña: el cliente quedaría sin poder reservar.
chequear('y la seña queda apagada sola', biz.sena?.activa === false, JSON.stringify(biz.sena));

console.log(`\n${ok} pasaron, ${mal} fallaron\n`);
process.exit(mal ? 1 : 0);
