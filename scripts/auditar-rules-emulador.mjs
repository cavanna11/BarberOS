// Auditoría de firestore.rules contra el emulador.
// Actúa como distintos usuarios reales (tokens de ID con sus claims) y golpea
// la REST API de Firestore, así que lo que se prueba son las Rules de verdad.
//
//   firebase emulators:start --only auth,firestore
//   node auditar-rules.mjs
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
const PROJECT = 'barberos-1d60e';
const DOCS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';

initializeApp({ projectId: PROJECT });
const db = getFirestore(), auth = getAuth();

// ── codificación de valores de Firestore ───────────────────────────────────
const val = (v) =>
  v === null ? { nullValue: null }
  : typeof v === 'boolean' ? { booleanValue: v }
  : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
  : { stringValue: String(v) };
const enc = (o) => ({ fields: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, val(v)])) });

// ── usuarios ───────────────────────────────────────────────────────────────
async function usuario(email, claims) {
  try { await auth.deleteUser((await auth.getUserByEmail(email)).uid); } catch {}
  const u = await auth.createUser({ email, emailVerified: true });
  if (claims) await auth.setCustomUserClaims(u.uid, claims);
  const custom = await auth.createCustomToken(u.uid);
  const r = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  const j = await r.json();
  return { uid: u.uid, email, token: j.idToken };
}

const cab = (u) => u ? { Authorization: `Bearer ${u.token}`, 'Content-Type': 'application/json' }
                     : { 'Content-Type': 'application/json' };

const leer   = (u, path)        => fetch(`${DOCS}/${path}`, { headers: cab(u) });
const crear  = (u, path, datos) => fetch(`${DOCS}/${path}`, { method: 'POST', headers: cab(u), body: JSON.stringify(enc(datos)) });
const editar = (u, path, datos) => {
  const qs = Object.keys(datos).map(k => `updateMask.fieldPaths=${k}`).join('&');
  return fetch(`${DOCS}/${path}?${qs}`, { method: 'PATCH', headers: cab(u), body: JSON.stringify(enc(datos)) });
};
const borrar = (u, path) => fetch(`${DOCS}/${path}`, { method: 'DELETE', headers: cab(u) });

async function consultar(u, padre, col, where) {
  const q = { structuredQuery: { from: [{ collectionId: col }] } };
  if (where) q.structuredQuery.where = { fieldFilter: { field: { fieldPath: where[0] }, op: 'EQUAL', value: val(where[1]) } };
  return fetch(`${DOCS}/${padre}:runQuery`, { method: 'POST', headers: cab(u), body: JSON.stringify(q) });
}

// ── aserciones ─────────────────────────────────────────────────────────────
let ok = 0, mal = 0;
const hallazgos = [];
async function esperar(desc, promesa, debe) {   // debe: 'permitido' | 'denegado'
  const r = await promesa;
  const permitido = r.status < 400;
  const real = permitido ? 'permitido' : 'denegado';
  if (real === debe) { ok++; console.log(`  ok    ${desc}`); }
  else {
    mal++; console.log(`  FALLA ${desc}\n        esperado ${debe}, fue ${real} (HTTP ${r.status})`);
    hallazgos.push(desc);
  }
}

// ── escenario: dos barberías ───────────────────────────────────────────────
const A = 'biz-alfa', B = 'biz-beta';
await db.doc(`businesses/${A}`).set({ name: 'Alfa', slug: 'alfa', isFrozen: false, planId: 'basico', monthlyFee: 12000 });
await db.doc(`businesses/${B}`).set({ name: 'Beta', slug: 'beta', isFrozen: false, planId: 'basico', monthlyFee: 12000 });
await db.doc('slugs/alfa').set({ businessId: A });
await db.doc(`businesses/${A}/private/billing`).set({ debt: 5000, monthlyFee: 12000 });
await db.doc(`businesses/${A}/appointments/apt-otro`).set({
  id: 'apt-otro', businessId: A, userId: 'otro-uid', clientName: 'Ajeno', clientPhone: '+54 11 9999',
  professionalId: 'p1', serviceId: 's1', appointmentDate: '2026-09-01', startTime: '10:00', endTime: '10:30',
  price: 12000, status: 'pendiente' });
await db.doc('tickets/tk-alfa').set({ businessId: A, subject: 'Alfa', status: 'abierto' });
await db.doc('tickets/tk-beta').set({ businessId: B, subject: 'Beta', status: 'abierto' });

const plat     = await usuario('plat@sacia.tech',    { platform: true });
const duenoA   = await usuario('duenoa@gmail.com',   { businessId: A, role: 'owner', professionalId: null });
const barberoA = await usuario('barberoa@gmail.com', { businessId: A, role: 'admin', professionalId: 'p1' });
const duenoB   = await usuario('duenob@gmail.com',   { businessId: B, role: 'owner', professionalId: null });
const cliente  = await usuario('cliente@gmail.com',  null);

console.log('\n-- Aislamiento entre barberias --');
await esperar('dueno de B NO escribe servicios de A',     crear(duenoB, `businesses/${A}/services`, { name: 'x', price: 1 }), 'denegado');
await esperar('dueno de B NO escribe profesionales de A', crear(duenoB, `businesses/${A}/professionals`, { name: 'x' }), 'denegado');
await esperar('dueno de B NO escribe horarios de A',      crear(duenoB, `businesses/${A}/schedules`, { dayOfWeek: 1 }), 'denegado');
await esperar('dueno de B NO edita el negocio A',         editar(duenoB, `businesses/${A}`, { name: 'Hackeado' }), 'denegado');
await esperar('dueno de B NO lee los admins de A',        consultar(duenoB, `businesses/${A}`, 'admins'), 'denegado');
await esperar('dueno de B NO lee la agenda de A',         consultar(duenoB, `businesses/${A}`, 'appointments'), 'denegado');
await esperar('dueno de A SI escribe lo suyo',            crear(duenoA, `businesses/${A}/services`, { name: 'Corte', price: 12000 }), 'permitido');

console.log('\n-- Facturacion --');
await esperar('dueno NO lee su propia facturacion',       leer(duenoA, `businesses/${A}/private/billing`), 'denegado');
await esperar('dueno NO escribe su facturacion',          editar(duenoA, `businesses/${A}/private/billing`, { debt: 0 }), 'denegado');
await esperar('plataforma SI la lee',                     leer(plat, `businesses/${A}/private/billing`), 'permitido');

console.log('\n-- El dueno no puede auto-beneficiarse --');
// Con el negocio ya congelado: acá el cambio es real y affectedKeys lo ve.
await db.doc(`businesses/${A}`).update({ isFrozen: true });
await esperar('dueno NO se descongela (cambio real)',    editar(duenoA, `businesses/${A}`, { isFrozen: false }), 'denegado');
await esperar('plataforma SI lo descongela',             editar(plat,   `businesses/${A}`, { isFrozen: false }), 'permitido');
await esperar('dueno NO se cambia el abono',              editar(duenoA, `businesses/${A}`, { monthlyFee: 1 }), 'denegado');
await esperar('dueno NO se cambia el plan',               editar(duenoA, `businesses/${A}`, { planId: 'premium' }), 'denegado');
await esperar('dueno NO se cambia el slug',               editar(duenoA, `businesses/${A}`, { slug: 'otro' }), 'denegado');
await esperar('dueno SI edita su marca',                  editar(duenoA, `businesses/${A}`, { name: 'Alfa Barberia' }), 'permitido');

console.log('\n-- Turnos: cliente --');
await esperar('cliente NO lista la agenda entera',        consultar(cliente, `businesses/${A}`, 'appointments'), 'denegado');
await esperar('cliente SI lista filtrando por su uid',    consultar(cliente, `businesses/${A}`, 'appointments', ['userId', cliente.uid]), 'permitido');
await esperar('cliente NO lee el turno de otro',          leer(cliente, `businesses/${A}/appointments/apt-otro`), 'denegado');
await esperar('cliente NO cancela el turno de otro',      editar(cliente, `businesses/${A}/appointments/apt-otro`, { status: 'cancelada' }), 'denegado');
await esperar('cliente NO reserva a nombre de otro',      crear(cliente, `businesses/${A}/appointments`, { userId: 'otro-uid', businessId: A, status: 'pendiente' }), 'denegado');
await esperar('cliente NO reserva ya confirmada',         crear(cliente, `businesses/${A}/appointments`, { userId: cliente.uid, businessId: A, status: 'confirmada' }), 'denegado');
await esperar('cliente NO reserva para otro negocio',     crear(cliente, `businesses/${A}/appointments`, { userId: cliente.uid, businessId: B, status: 'pendiente' }), 'denegado');
await esperar('cliente NO borra turnos',                  borrar(cliente, `businesses/${A}/appointments/apt-otro`), 'denegado');

console.log('\n-- Turnos: precio (punto 7 del roadmap) --');
await esperar('[?] cliente reserva con price 0',          crear(cliente, `businesses/${A}/appointments`, { userId: cliente.uid, businessId: A, status: 'pendiente', price: 0, appointmentDate: '2026-09-02', startTime: '09:00', endTime: '09:30' }), 'denegado');

console.log('\n-- Barbero (rol admin) --');
await esperar('[?] barbero lee la agenda entera',         consultar(barberoA, `businesses/${A}`, 'appointments'), 'permitido');
await esperar('[?] barbero edita turno de otro',          editar(barberoA, `businesses/${A}/appointments/apt-otro`, { status: 'completada' }), 'denegado');
await esperar('[?] barbero escribe el catalogo',          crear(barberoA, `businesses/${A}/services`, { name: 'inventado', price: 1 }), 'denegado');

console.log('\n-- Tickets --');
await esperar('dueno de A lee su ticket',                 leer(duenoA, 'tickets/tk-alfa'), 'permitido');
await esperar('dueno de A NO lee el ticket de B',         leer(duenoA, 'tickets/tk-beta'), 'denegado');
await esperar('cliente NO lee tickets',                   leer(cliente, 'tickets/tk-alfa'), 'denegado');
await esperar('cliente NO crea ticket',                   crear(cliente, 'tickets', { businessId: A, subject: 'x' }), 'denegado');
// El caso que importa: sin claim, claims().get('businessId','') es '', asi que
// mandar businessId:'' cumplia la igualdad. Probar solo con un id real no lo ve.
await esperar('cliente NO crea ticket con businessId ""', crear(cliente, 'tickets', { businessId: '', subject: 'x' }), 'denegado');
await esperar('dueno de B NO crea ticket a nombre de A',  crear(duenoB, 'tickets', { businessId: A, subject: 'x' }), 'denegado');
await esperar('nadie borra tickets',                      borrar(duenoA, 'tickets/tk-alfa'), 'denegado');

console.log('\n-- Sin sesion --');
await esperar('anonimo lee el negocio (link publico)',    leer(null, `businesses/${A}`), 'permitido');
await esperar('anonimo resuelve el slug',                 leer(null, 'slugs/alfa'), 'permitido');
await esperar('anonimo NO lista negocios',                consultar(null, '', 'businesses'), 'denegado');
await esperar('anonimo NO reserva',                       crear(null, `businesses/${A}/appointments`, { userId: 'x', businessId: A, status: 'pendiente' }), 'denegado');
await esperar('anonimo NO lee pendingAdmins',             leer(null, 'pendingAdmins/x'), 'denegado');

console.log(`\n${ok} pasaron, ${mal} fallaron`);
if (hallazgos.length) { console.log('\nRevisar:'); hallazgos.forEach((h) => console.log('  - ' + h)); }
process.exit(mal ? 1 : 0);
