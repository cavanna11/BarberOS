// Los límites de los planes, haciéndose cumplir de verdad.
//
//   firebase emulators:start --only auth,firestore,functions
//   node scripts/test-planes-emulador.mjs
//
// Lo que se prueba acá es exactamente lo que NO alcanza con esconder en la
// interfaz: la cantidad de barberos, la foto de perfil, los colores y el logo.
// Todo se golpea como lo haría alguien con la consola abierta — escribiendo
// directo a Firestore con su propio token, o llamando a la Cloud Function.
//
//   Básico      1 barbería · 1 barbero  · sin foto, sin colores, sin logo
//   Intermedio  1 barbería · 3 barberos · con foto
//   Full        1 barbería · ilimitados · con foto, colores y logo
//   Empresarial 4 sucursales (eso vive en test-sucursales-emulador.mjs)
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { camposDelPlan } from '../functions/planes.js';

const PROJECT = 'barberos-1d60e';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.GCLOUD_PROJECT = PROJECT;

initializeApp({ projectId: PROJECT });
const db = getFirestore(), auth = getAuth();

const DOCS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const FN = `http://127.0.0.1:5001/${PROJECT}/southamerica-east1`;

const val = (v) =>
  v === null ? { nullValue: null }
  : typeof v === 'boolean' ? { booleanValue: v }
  : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
  : typeof v === 'object' ? { mapValue: enc(v) }
  : { stringValue: String(v) };
const enc = (o) => ({ fields: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, val(v)])) });

async function usuario(email, claims) {
  try { await auth.deleteUser((await auth.getUserByEmail(email)).uid); } catch { /* no existía */ }
  const u = await auth.createUser({ email, emailVerified: true });
  if (claims) await auth.setCustomUserClaims(u.uid, claims);
  const r = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: await auth.createCustomToken(u.uid), returnSecureToken: true }),
  });
  return { uid: u.uid, email, token: (await r.json()).idToken };
}

const cab = (u) => ({ Authorization: `Bearer ${u.token}`, 'Content-Type': 'application/json' });
const crear = (u, path, datos) => fetch(`${DOCS}/${path}`, { method: 'POST', headers: cab(u), body: JSON.stringify(enc(datos)) });
const editar = (u, path, datos) => {
  const qs = Object.keys(datos).map((k) => `updateMask.fieldPaths=${k}`).join('&');
  return fetch(`${DOCS}/${path}?${qs}`, { method: 'PATCH', headers: cab(u), body: JSON.stringify(enc(datos)) });
};

const llamar = async (nombre, u, data) => {
  const r = await fetch(`${FN}/${nombre}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(u ? { Authorization: `Bearer ${u.token}` } : {}) },
    body: JSON.stringify({ data }),
  });
  const j = await r.json();
  return j.result ? { ok: j.result } : { error: j.error?.status, msg: j.error?.message };
};

let pasaron = 0, fallaron = 0;
const fallas = [];
const chequear = (t, ok, d = '') => {
  if (ok) { pasaron++; console.log('  ok    ', t); }
  else { fallaron++; fallas.push(t); console.log('  FALLA ', t, d ? `\n           ${d}` : ''); }
};
async function esperar(desc, promesa, debe) {
  const r = await promesa;
  const real = r.status < 400 ? 'permitido' : 'denegado';
  chequear(desc, real === debe, `esperado ${debe}, fue ${real} (HTTP ${r.status})`);
}

// ── escenario: una barbería por plan ────────────────────────────────────────
const CUENTAS = {
  basico: 'plan-basico',
  intermedio: 'plan-intermedio',
  full: 'plan-full',
};

const FOTO = 'data:image/jpeg;base64,' + 'A'.repeat(200);

async function sembrar(planId, id) {
  await db.recursiveDelete(db.doc(`businesses/${id}`)).catch(() => {});
  const plan = camposDelPlan(planId);
  await db.doc(`businesses/${id}`).set({
    id, name: `Barbería ${planId}`, slug: id, isFrozen: false,
    primaryColor: '#e03d00', secondaryColor: '#ff5c1a', accentColor: '#ff5c1a',
    logoUrl: null, onlineBookingEnabled: true,
    planId: plan.planId,
    maxBarbers: plan.maxBarbers,
    maxSucursales: plan.maxSucursales,
    whatsappQuota: plan.whatsappQuota,
    capacidades: plan.capacidades,
    grupoId: null,
  });
  await db.doc(`businesses/${id}/private/billing`).set({ planId, monthlyFee: plan.monthlyFee, debt: 0 });
}

for (const [plan, id] of Object.entries(CUENTAS)) await sembrar(plan, id);

const duenoBasico = await usuario('dueno-basico@gmail.com', { businessId: CUENTAS.basico, role: 'owner', professionalId: null });
const duenoInter = await usuario('dueno-inter@gmail.com', { businessId: CUENTAS.intermedio, role: 'owner', professionalId: null });
const duenoFull = await usuario('dueno-full@gmail.com', { businessId: CUENTAS.full, role: 'owner', professionalId: null });

// ── 1. Cantidad de barberos ─────────────────────────────────────────────────
console.log('\nTope de barberos (Cloud Function, no la interfaz):');

let r = await llamar('crearProfesional', duenoBasico, { businessId: CUENTAS.basico, datos: { name: 'Martín' } });
chequear('Básico: el primer barbero entra', Boolean(r.ok?.id), JSON.stringify(r));

r = await llamar('crearProfesional', duenoBasico, { businessId: CUENTAS.basico, datos: { name: 'Segundo' } });
chequear('Básico: el segundo se rechaza', r.error === 'FAILED_PRECONDITION', JSON.stringify(r));

// Y por el camino de atrás: escribiendo el documento a mano, que es lo que hace
// cualquiera con la consola abierta.
await esperar('Básico: tampoco puede crearlo escribiendo directo a Firestore',
  crear(duenoBasico, `businesses/${CUENTAS.basico}/professionals`, { name: 'Trucho', isActive: true }), 'denegado');

for (const n of ['Uno', 'Dos', 'Tres']) {
  r = await llamar('crearProfesional', duenoInter, { businessId: CUENTAS.intermedio, datos: { name: n } });
  chequear(`Intermedio: entra el barbero ${n}`, Boolean(r.ok?.id), JSON.stringify(r));
}
r = await llamar('crearProfesional', duenoInter, { businessId: CUENTAS.intermedio, datos: { name: 'Cuarto' } });
chequear('Intermedio: el cuarto se rechaza', r.error === 'FAILED_PRECONDITION', JSON.stringify(r));

for (const n of ['Ana', 'Bruno', 'Caro', 'Dani', 'Eze', 'Facu']) {
  r = await llamar('crearProfesional', duenoFull, { businessId: CUENTAS.full, datos: { name: n } });
  if (r.error) { chequear(`Full: el barbero ${n} entra`, false, JSON.stringify(r)); break; }
}
chequear('Full: barberos sin límite (seis seguidos)',
  (await db.collection(`businesses/${CUENTAS.full}/professionals`).get()).size === 6,
  String((await db.collection(`businesses/${CUENTAS.full}/professionals`).get()).size));

// Desactivar libera el lugar: el que se fue no le ocupa el puesto al que entra.
const unoDelInter = (await db.collection(`businesses/${CUENTAS.intermedio}/professionals`).get()).docs[0];
await unoDelInter.ref.update({ isActive: false });
r = await llamar('crearProfesional', duenoInter, { businessId: CUENTAS.intermedio, datos: { name: 'Reemplazo' } });
chequear('Intermedio: desactivar a uno libera el lugar', Boolean(r.ok?.id), JSON.stringify(r));

// Nadie puede agregar barberos en la barbería de otro.
r = await llamar('crearProfesional', duenoBasico, { businessId: CUENTAS.full, datos: { name: 'Intruso' } });
chequear('no se puede agregar un barbero en la barbería de otro', r.error === 'PERMISSION_DENIED', JSON.stringify(r));

// ── 2. Foto de perfil ───────────────────────────────────────────────────────
console.log('\nFoto de perfil (desde el Intermedio):');

const profBasico = (await db.collection(`businesses/${CUENTAS.basico}/professionals`).get()).docs[0];
const profInter = (await db.collection(`businesses/${CUENTAS.intermedio}/professionals`).get()).docs[0];

await esperar('Básico: NO puede ponerle foto a un barbero',
  editar(duenoBasico, `businesses/${CUENTAS.basico}/professionals/${profBasico.id}`, { avatarUrl: FOTO }), 'denegado');

r = await llamar('crearProfesional', duenoBasico, { businessId: CUENTAS.basico, datos: { name: 'Con foto', avatarUrl: FOTO } });
chequear('Básico: la function también rechaza la foto',
  r.error === 'FAILED_PRECONDITION' || r.error === 'PERMISSION_DENIED', JSON.stringify(r));

await esperar('Básico: sí puede editar el nombre de su barbero',
  editar(duenoBasico, `businesses/${CUENTAS.basico}/professionals/${profBasico.id}`, { specialty: 'Barbero' }), 'permitido');

await esperar('Intermedio: SÍ puede ponerle foto',
  editar(duenoInter, `businesses/${CUENTAS.intermedio}/professionals/${profInter.id}`, { avatarUrl: FOTO }), 'permitido');

await esperar('Intermedio: una foto gigante se rechaza igual',
  editar(duenoInter, `businesses/${CUENTAS.intermedio}/professionals/${profInter.id}`, { avatarUrl: 'data:image/jpeg;base64,' + 'A'.repeat(300000) }), 'denegado');

// El barbero del Básico tampoco se la pone desde "Mi Configuración".
const barberoBasico = await usuario('barbero-basico@gmail.com', {
  businessId: CUENTAS.basico, role: 'admin', professionalId: profBasico.id,
});
await esperar('Básico: el barbero tampoco se pone foto a sí mismo',
  editar(barberoBasico, `businesses/${CUENTAS.basico}/professionals/${profBasico.id}`, { avatarUrl: FOTO }), 'denegado');
await esperar('Básico: el barbero sí puede editar su bio',
  editar(barberoBasico, `businesses/${CUENTAS.basico}/professionals/${profBasico.id}`, { bio: 'Corto hace 10 años' }), 'permitido');

// ── 3. Colores y logo ───────────────────────────────────────────────────────
console.log('\nColores y logo (desde el Full):');

await esperar('Básico: NO puede cambiar el color primario',
  editar(duenoBasico, `businesses/${CUENTAS.basico}`, { primaryColor: '#000000' }), 'denegado');
await esperar('Básico: NO puede poner logo',
  editar(duenoBasico, `businesses/${CUENTAS.basico}`, { logoUrl: FOTO }), 'denegado');
await esperar('Básico: sí puede editar su presentación',
  editar(duenoBasico, `businesses/${CUENTAS.basico}`, { welcomeMessage: 'Bienvenidos' }), 'permitido');

await esperar('Intermedio: tampoco puede cambiar los colores',
  editar(duenoInter, `businesses/${CUENTAS.intermedio}`, { primaryColor: '#000000' }), 'denegado');

await esperar('Full: SÍ puede cambiar los colores',
  editar(duenoFull, `businesses/${CUENTAS.full}`, { primaryColor: '#123456' }), 'permitido');
await esperar('Full: SÍ puede poner logo',
  editar(duenoFull, `businesses/${CUENTAS.full}`, { logoUrl: FOTO }), 'permitido');
await esperar('Full: un logo gigante se rechaza igual',
  editar(duenoFull, `businesses/${CUENTAS.full}`, { logoUrl: 'data:image/png;base64,' + 'A'.repeat(300000) }), 'denegado');

// Lo que ningún plan permite: subirse las capacidades uno mismo.
await esperar('nadie se habilita las funciones solo',
  editar(duenoBasico, `businesses/${CUENTAS.basico}`, { capacidades: { fotoPerfil: true, colores: true, logo: true } }), 'denegado');

// ── 4. Sucursales ───────────────────────────────────────────────────────────
console.log('\nSucursales (solo el Empresarial):');

for (const [plan, id] of Object.entries(CUENTAS)) {
  const u = plan === 'basico' ? duenoBasico : plan === 'intermedio' ? duenoInter : duenoFull;
  const res = await llamar('crearSucursal', u, { businessId: id, nombre: 'Segunda', slug: `${id}-2` });
  chequear(`${plan}: no puede abrir una segunda barbería`, res.error === 'FAILED_PRECONDITION', JSON.stringify(res));
}

// ── 5. Cuentas viejas, sin el campo escrito ─────────────────────────────────
// Las Rules asumen que SÍ puede cuando `capacidades` no existe. Es a propósito:
// una barbería que ya tiene su foto cargada no la puede perder de un día para el
// otro porque salió una escalera de planes nueva.
console.log('\nCuentas anteriores a los planes nuevos:');

await db.recursiveDelete(db.doc('businesses/plan-viejo')).catch(() => {});
await db.doc('businesses/plan-viejo').set({
  id: 'plan-viejo', name: 'Vieja', slug: 'plan-viejo', isFrozen: false,
  primaryColor: '#e03d00', planId: 'pro',   // sin `capacidades`
});
await db.doc('businesses/plan-viejo/professionals/p1').set({ id: 'p1', name: 'Viejo', isActive: true });
const duenoViejo = await usuario('dueno-viejo@gmail.com', { businessId: 'plan-viejo', role: 'owner', professionalId: null });

await esperar('una cuenta vieja conserva la foto',
  editar(duenoViejo, 'businesses/plan-viejo/professionals/p1', { avatarUrl: FOTO }), 'permitido');
await esperar('y conserva los colores',
  editar(duenoViejo, 'businesses/plan-viejo', { primaryColor: '#222222' }), 'permitido');

console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
if (fallas.length) console.log('Fallaron:\n  - ' + fallas.join('\n  - '));
console.log('');
process.exit(fallaron ? 1 : 0);
