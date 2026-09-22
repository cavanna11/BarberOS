// Prueba del modelo de permisos de setBusinessAdmin / revokeBusinessAdmin /
// applyPendingClaims contra los emuladores. No toca producción.
//
// Correr con los emuladores arriba:
//   node test-claims.mjs

import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';

const PROJECT = 'barberos-1d60e';
const REGION = 'southamerica-east1';
const FN = (n) => `http://127.0.0.1:5001/${PROJECT}/${REGION}/${n}`;
const AUTH = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`;

initializeApp({ projectId: PROJECT });
const db = getFirestore();
const auth = getAuth();

// ── helpers ────────────────────────────────────────────────────────────────

async function crearUsuario(email, claims, { verificado = true } = {}) {
  try { await auth.deleteUser((await auth.getUserByEmail(email)).uid); } catch { /* no existía */ }
  const u = await auth.createUser({ email, emailVerified: verificado });
  if (claims) await auth.setCustomUserClaims(u.uid, claims);
  return u.uid;
}

/** Token de ID real, con los custom claims adentro. */
async function idToken(uid) {
  const custom = await auth.createCustomToken(uid);
  const r = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  const j = await r.json();
  if (!j.idToken) throw new Error('No se pudo mintear idToken: ' + JSON.stringify(j));
  return j.idToken;
}

async function llamar(nombre, token, data) {
  const r = await fetch(FN(nombre), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ data }),
  });
  const j = await r.json().catch(() => ({}));
  return j.error ? { error: j.error.status || j.error.message } : { ok: j.result };
}

// ── aserciones ─────────────────────────────────────────────────────────────

let pasaron = 0, fallaron = 0;

function chequear(nombre, condicion, detalle) {
  if (condicion) { pasaron++; console.log(`  ok    ${nombre}`); }
  else { fallaron++; console.log(`  FALLA ${nombre}\n        → ${detalle}`); }
}

// ── escenario ──────────────────────────────────────────────────────────────

const B1 = 'biz-uno', B2 = 'biz-dos';

console.log('\nPreparando escenario...');

// El emulador conserva el estado entre corridas: sin esto, el usuario que la
// corrida anterior creó para probar applyPendingClaims ya existe, y el caso
// "nunca entró" devuelve applied en vez de pending.
async function borrarUsuario(email) {
  try { await auth.deleteUser((await auth.getUserByEmail(email)).uid); } catch { /* no existía */ }
}
await borrarUsuario('nuevo@gmail.com');
await borrarUsuario('sin-gmail@hotmail.com');
await borrarUsuario('elegida@hotmail.com');
await borrarUsuario('corta@hotmail.com');
await borrarUsuario('moderador@sacia.tech');
await borrarUsuario('nunca-entro@sacia.tech');
await borrarUsuario('victima@gmail.com');
await borrarUsuario('sinperfil@gmail.com');
for (const d of (await db.collection('platform/team/members').get()).docs) await d.ref.delete();
const pendientes = await db.collection('pendingAdmins').get();
await Promise.all(pendientes.docs.map((d) => d.ref.delete()));

await db.doc(`businesses/${B1}`).set({ name: 'Barbería Uno', slug: 'uno' });
// Un barbero necesita un perfil que exista: sin eso no puede ver su agenda.
await db.doc(`businesses/${B1}/professionals/prof-1`).set({ id: 'prof-1', name: 'Barbero Uno', isActive: true });
await db.doc(`businesses/${B1}/professionals/prof-2`).set({ id: 'prof-2', name: 'Barbero Dos', isActive: true });
await db.doc(`businesses/${B2}`).set({ name: 'Barbería Dos', slug: 'dos' });

const uidPlataforma = await crearUsuario('plataforma@sacia.tech', { platform: true });
const uidDuenoB1    = await crearUsuario('dueno-b1@gmail.com', { businessId: B1, role: 'owner', professionalId: null });
const uidBarbero    = await crearUsuario('barbero@gmail.com', null);
const uidAjeno      = await crearUsuario('cualquiera@gmail.com', null);
await crearUsuario('dueno-b2@gmail.com', { businessId: B2, role: 'owner', professionalId: null });

const tPlataforma = await idToken(uidPlataforma);
const tDuenoB1    = await idToken(uidDuenoB1);
const tAjeno      = await idToken(uidAjeno);

console.log('\nLo que tiene que funcionar:');

let r = await llamar('setBusinessAdmin', tPlataforma, { email: 'dueno-b1@gmail.com', businessId: B1, role: 'owner' });
chequear('plataforma designa dueño', r.ok?.status === 'applied', JSON.stringify(r));

r = await llamar('setBusinessAdmin', tDuenoB1, { email: 'barbero@gmail.com', businessId: B1, role: 'admin', professionalId: 'prof-1' });
chequear('dueño da de alta un barbero en SU negocio', r.ok?.status === 'applied', JSON.stringify(r));

const claimsBarbero = (await auth.getUser(uidBarbero)).customClaims;
chequear('al barbero le quedaron los claims correctos',
  claimsBarbero?.businessId === B1 && claimsBarbero?.role === 'admin' && claimsBarbero?.professionalId === 'prof-1',
  JSON.stringify(claimsBarbero));

r = await llamar('setBusinessAdmin', tDuenoB1, { email: 'nuevo@gmail.com', businessId: B1, role: 'admin', professionalId: 'prof-2' });
chequear('alta de alguien que nunca entró queda pendiente', r.ok?.status === 'pending', JSON.stringify(r));

const pend = await db.doc('pendingAdmins/nuevo@gmail.com').get();
chequear('se escribió el pendiente en Firestore', pend.exists && pend.data().businessId === B1, JSON.stringify(pend.data()));

// Ese usuario entra por primera vez y reclama lo suyo.
const uidNuevo = await crearUsuario('nuevo@gmail.com', null);
r = await llamar('applyPendingClaims', await idToken(uidNuevo), {});
chequear('applyPendingClaims aplica el permiso en el primer login', r.ok?.status === 'applied', JSON.stringify(r));
chequear('y borra el pendiente', !(await db.doc('pendingAdmins/nuevo@gmail.com').get()).exists, 'sigue existiendo');

r = await llamar('applyPendingClaims', tAjeno, {});
chequear('applyPendingClaims sin nada pendiente devuelve none', r.ok?.status === 'none', JSON.stringify(r));

console.log('\nLo que tiene que ser rechazado:');

r = await llamar('setBusinessAdmin', tDuenoB1, { email: 'otro@gmail.com', businessId: B1, role: 'owner' });
chequear('dueño NO puede designar otro dueño', r.error === 'PERMISSION_DENIED', JSON.stringify(r));

r = await llamar('setBusinessAdmin', tDuenoB1, { email: 'colado@gmail.com', businessId: B2, role: 'admin' });
chequear('dueño NO puede tocar otro negocio', r.error === 'PERMISSION_DENIED', JSON.stringify(r));

r = await llamar('setBusinessAdmin', tDuenoB1, { email: 'plataforma@sacia.tech', businessId: B1, role: 'admin' });
chequear('dueño NO puede pisarle los claims a la plataforma', r.error === 'PERMISSION_DENIED', JSON.stringify(r));

const claimsPlat = (await auth.getUser(uidPlataforma)).customClaims;
chequear('la plataforma conserva su claim intacto', claimsPlat?.platform === true, JSON.stringify(claimsPlat));

r = await llamar('revokeBusinessAdmin', tDuenoB1, { email: 'plataforma@sacia.tech', businessId: B1 });
chequear('dueño NO puede revocar a la plataforma', r.error === 'PERMISSION_DENIED', JSON.stringify(r));

r = await llamar('revokeBusinessAdmin', tDuenoB1, { email: 'dueno-b2@gmail.com', businessId: B1 });
chequear('dueño NO puede revocar al dueño de otro negocio', r.error === 'PERMISSION_DENIED', JSON.stringify(r));

r = await llamar('setBusinessAdmin', tAjeno, { email: 'x@gmail.com', businessId: B1, role: 'admin' });
chequear('un cliente cualquiera NO puede asignar permisos', r.error === 'PERMISSION_DENIED', JSON.stringify(r));

r = await llamar('setBusinessAdmin', null, { email: 'x@gmail.com', businessId: B1, role: 'admin' });
chequear('sin sesión, rechazado', r.error === 'UNAUTHENTICATED', JSON.stringify(r));

r = await llamar('setBusinessAdmin', tPlataforma, { email: 'x@gmail.com', businessId: 'no-existe', role: 'admin' });
chequear('negocio inexistente da not-found', r.error === 'NOT_FOUND', JSON.stringify(r));

r = await llamar('setBusinessAdmin', tPlataforma, { email: 'x@gmail.com', businessId: B1, role: 'superadmin' });
chequear('rol inválido rechazado', r.error === 'INVALID_ARGUMENT', JSON.stringify(r));

// Un barbero sin perfil, o con uno borrado, entra al panel y ve la agenda
// VACÍA: las Rules le filtran los turnos por ese id. Pasó en producción
// (22/09/2026): los clientes reservaban y la barbería no se enteraba.
r = await llamar('setBusinessAdmin', tDuenoB1, { email: 'sinperfil@gmail.com', businessId: B1, role: 'admin' });
chequear('barbero SIN perfil asignado, rechazado', r.error === 'INVALID_ARGUMENT', JSON.stringify(r));

r = await llamar('setBusinessAdmin', tDuenoB1, { email: 'sinperfil@gmail.com', businessId: B1, role: 'admin', professionalId: 'prof-borrado' });
chequear('barbero con perfil inexistente, rechazado', r.error === 'NOT_FOUND', JSON.stringify(r));

chequear('y no quedó anotado en la lista de admins',
  !(await db.doc(`businesses/${B1}/admins/sinperfil@gmail.com`).get()).exists, 'quedó escrito');

console.log('\nRevocar (camino feliz):');

r = await llamar('revokeBusinessAdmin', tDuenoB1, { email: 'barbero@gmail.com', businessId: B1 });
chequear('dueño revoca a su barbero', r.ok?.status === 'revoked', JSON.stringify(r));
chequear('al barbero le quedaron los claims vacíos',
  Object.keys((await auth.getUser(uidBarbero)).customClaims || {}).length === 0,
  JSON.stringify((await auth.getUser(uidBarbero)).customClaims));

console.log('');
console.log('Alta con usuario y contrasena:');

r = await llamar('createOwnerWithPassword', tPlataforma, { email: 'sin-gmail@hotmail.com', businessId: B1, name: 'Sin Gmail' });
chequear('la plataforma crea la cuenta con contrasena', r.ok?.status === 'created', JSON.stringify(r));
chequear('devuelve una contrasena usable', typeof r.ok?.password === 'string' && r.ok.password.length >= 12, JSON.stringify(r.ok?.password));

const guardada = r.ok?.password;
const creado = await auth.getUserByEmail('sin-gmail@hotmail.com');
chequear('le quedaron los claims del negocio',
  creado.customClaims?.businessId === B1 && creado.customClaims?.role === 'owner',
  JSON.stringify(creado.customClaims));

// Esa contrasena tiene que servir para entrar de verdad.
const login = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake-key`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'sin-gmail@hotmail.com', password: guardada, returnSecureToken: true }),
});
const jLogin = await login.json();
chequear('entra con esa contrasena', Boolean(jLogin.idToken), JSON.stringify(jLogin.error?.message));

r = await llamar('createOwnerWithPassword', tPlataforma, { email: 'sin-gmail@hotmail.com', businessId: B1, name: 'Otra vez' });
chequear('no pisa una cuenta que ya existe', r.error === 'ALREADY_EXISTS', JSON.stringify(r));

r = await llamar('createOwnerWithPassword', tDuenoB1, { email: 'colado@hotmail.com', businessId: B1, name: 'x' });
chequear('un dueno NO puede fabricar cuentas', r.error === 'PERMISSION_DENIED', JSON.stringify(r));

r = await llamar('resetOwnerPassword', tPlataforma, { email: 'sin-gmail@hotmail.com' });
chequear('la plataforma restablece la contrasena', typeof r.ok?.password === 'string', JSON.stringify(r));
chequear('la contrasena nueva es distinta', r.ok?.password !== guardada, 'salio la misma');

r = await llamar('resetOwnerPassword', tPlataforma, { email: 'plataforma@sacia.tech' });
chequear('NO se restablece la de la plataforma', r.error === 'PERMISSION_DENIED', JSON.stringify(r));

r = await llamar('resetOwnerPassword', tDuenoB1, { email: 'sin-gmail@hotmail.com' });
chequear('un dueno NO restablece contrasenas', r.error === 'PERMISSION_DENIED', JSON.stringify(r));


r = await llamar('createOwnerWithPassword', tPlataforma, { email: 'elegida@hotmail.com', businessId: B1, name: 'Con clave mia', password: 'BarberOS2026' });
chequear('acepta la contrasena que elijo yo', r.ok?.password === 'BarberOS2026', JSON.stringify(r));

const login2 = await fetch(`${AUTH}/accounts:signInWithPassword?key=fake-key`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'elegida@hotmail.com', password: 'BarberOS2026', returnSecureToken: true }),
});
chequear('y sirve para entrar', Boolean((await login2.json()).idToken), 'no entro');

r = await llamar('createOwnerWithPassword', tPlataforma, { email: 'corta@hotmail.com', businessId: B1, name: 'x', password: '123' });
chequear('rechaza una contrasena de menos de 6', r.error === 'INVALID_ARGUMENT', JSON.stringify(r));


console.log('');
console.log('Moderadores de la plataforma:');
const uidMod = await crearUsuario('moderador@sacia.tech', null);
r = await llamar('setPlatformModerator', tPlataforma, { email: 'moderador@sacia.tech', name: 'Mod' });
chequear('la plataforma nombra un moderador', r.ok?.status === 'applied', JSON.stringify(r));
chequear('le queda platform: moderator (NO true)',
  (await auth.getUser(uidMod)).customClaims?.platform === 'moderator', JSON.stringify((await auth.getUser(uidMod)).customClaims));
chequear('queda en platform/team/members', (await db.doc('platform/team/members/moderador@sacia.tech').get()).exists, 'no esta');

const tMod = await idToken(uidMod);
r = await llamar('setPlatformModerator', tMod, { email: 'otro-mod@sacia.tech' });
chequear('un moderador NO nombra moderadores', r.error === 'PERMISSION_DENIED', JSON.stringify(r));
r = await llamar('setBusinessAdmin', tMod, { email: 'x@gmail.com', businessId: B1, role: 'owner' });
chequear('un moderador NO asigna duenos', r.error === 'PERMISSION_DENIED', JSON.stringify(r));
r = await llamar('createOwnerWithPassword', tMod, { email: 'y@gmail.com', businessId: B1 });
chequear('un moderador NO crea cuentas', r.error === 'PERMISSION_DENIED', JSON.stringify(r));

r = await llamar('setPlatformModerator', tPlataforma, { email: 'plataforma@sacia.tech' });
chequear('NO se cambia a si misma', r.error === 'FAILED_PRECONDITION', JSON.stringify(r));
r = await llamar('setPlatformModerator', tDuenoB1, { email: 'z@gmail.com' });
chequear('un dueno de barberia NO nombra moderadores', r.error === 'PERMISSION_DENIED', JSON.stringify(r));

r = await llamar('setPlatformModerator', tPlataforma, { email: 'nunca-entro@sacia.tech' });
chequear('alguien que nunca entro queda pendiente', r.ok?.status === 'pending', JSON.stringify(r));
const uidNuevoMod = await crearUsuario('nunca-entro@sacia.tech', null);
r = await llamar('applyPendingClaims', await idToken(uidNuevoMod), {});
chequear('y en su primer login le toma el rol', r.ok?.status === 'applied' && r.ok?.platform === 'moderator', JSON.stringify(r));

// ── Robo de permisos pendientes con una cuenta sin verificar ───────────────
// Con la API pública de Auth cualquiera crea una cuenta email+contraseña con el
// mail que quiera (sin verificar). Si eso alcanzara para reclamar un pendiente,
// se robaba el rol de un barbero, un dueño o un moderador.
console.log('\n-- Cuentas sin verificar --');
r = await llamar('setBusinessAdmin', tPlataforma, { email: 'victima@gmail.com', businessId: B1, role: 'admin', professionalId: 'prof-1' });
chequear('la plataforma deja pendiente a victima@gmail.com', r.ok?.status === 'pending', JSON.stringify(r));
const uidIntruso = await crearUsuario('victima@gmail.com', null, { verificado: false });
r = await llamar('applyPendingClaims', await idToken(uidIntruso), {});
chequear('una cuenta sin verificar NO reclama el pendiente', r.ok?.status === 'email-no-verificado', JSON.stringify(r));
chequear('  (y sigue sin claims)', !(await auth.getUser(uidIntruso)).customClaims?.businessId, JSON.stringify((await auth.getUser(uidIntruso)).customClaims));
chequear('  (y el pendiente sigue ahi)', (await db.doc('pendingAdmins/victima@gmail.com').get()).exists, '');
r = await llamar('setBusinessAdmin', tPlataforma, { email: 'victima@gmail.com', businessId: B1, role: 'admin', professionalId: 'prof-1' });
chequear('ni la plataforma le da permisos a una cuenta sin verificar', r.error === 'FAILED_PRECONDITION', JSON.stringify(r));
await auth.updateUser(uidIntruso, { emailVerified: true });
r = await llamar('applyPendingClaims', await idToken(uidIntruso), {});
chequear('verificada, si lo reclama', r.ok?.status === 'applied', JSON.stringify(r));

// ── Borrar una barbería entera ──────────────────────────────────────────────
console.log('\n-- deleteBusiness --');
const BX = 'biz-borrar';
await db.doc(`businesses/${BX}`).set({ name: 'Para Borrar', slug: 'para-borrar', isFrozen: false });
await db.doc('slugs/para-borrar').set({ businessId: BX });
await db.doc(`businesses/${BX}/professionals/p1`).set({ name: 'x' });
await db.doc(`businesses/${BX}/appointments/a1`).set({ businessId: BX, status: 'pendiente' });
await db.doc(`businesses/${BX}/private/billing`).set({ debt: 0 });
await db.doc('tickets/tk-borrar').set({ businessId: BX, subject: 'x', status: 'abierto' });
await db.doc('tickets/tk-borrar/messages/m1').set({ text: 'x' });
await db.doc('pendingAdmins/pend-borrar@gmail.com').set({ businessId: BX, role: 'admin' });
const uidDuenoX = await crearUsuario('dueno-borrar@gmail.com', { businessId: BX, role: 'owner' });
const uidBarbX = await crearUsuario('barbero-borrar@gmail.com', { businessId: BX, role: 'admin', professionalId: 'p1' });

r = await llamar('deleteBusiness', tMod, { businessId: BX, confirmName: 'Para Borrar' });
chequear('un moderador NO borra barberias', r.error === 'PERMISSION_DENIED', JSON.stringify(r));
r = await llamar('deleteBusiness', tDuenoB1, { businessId: BX, confirmName: 'Para Borrar' });
chequear('un dueno NO borra barberias', r.error === 'PERMISSION_DENIED', JSON.stringify(r));
r = await llamar('deleteBusiness', tPlataforma, { businessId: BX, confirmName: 'Otro nombre' });
chequear('con el nombre equivocado, no borra', r.error === 'FAILED_PRECONDITION', JSON.stringify(r));
chequear('  (y el negocio sigue ahi)', (await db.doc(`businesses/${BX}`).get()).exists, '');
r = await llamar('deleteBusiness', tPlataforma, { businessId: BX, confirmName: 'Para Borrar' });
chequear('la plataforma borra con el nombre exacto', r.ok?.status === 'deleted' && r.ok?.usuarios === 2 && r.ok?.tickets === 1, JSON.stringify(r));
chequear('  el negocio ya no existe', !(await db.doc(`businesses/${BX}`).get()).exists, '');
chequear('  ni sus subcolecciones', (await db.collection(`businesses/${BX}/appointments`).get()).empty && !(await db.doc(`businesses/${BX}/private/billing`).get()).exists, '');
chequear('  ni el slug', !(await db.doc('slugs/para-borrar').get()).exists, '');
chequear('  ni el ticket con sus mensajes', !(await db.doc('tickets/tk-borrar').get()).exists && !(await db.doc('tickets/tk-borrar/messages/m1').get()).exists, '');
chequear('  ni el pendiente', !(await db.doc('pendingAdmins/pend-borrar@gmail.com').get()).exists, '');
chequear('  y el dueno quedo sin claims', Object.keys((await auth.getUser(uidDuenoX)).customClaims || {}).length === 0, JSON.stringify((await auth.getUser(uidDuenoX)).customClaims));
chequear('  y el barbero tambien', Object.keys((await auth.getUser(uidBarbX)).customClaims || {}).length === 0, '');
r = await llamar('deleteBusiness', tPlataforma, { businessId: BX, confirmName: 'Para Borrar' });
chequear('borrar dos veces da not-found', r.error === 'NOT_FOUND', JSON.stringify(r));

r = await llamar('setPlatformModerator', tPlataforma, { email: 'moderador@sacia.tech', enabled: false });
chequear('la plataforma le quita el rol', r.ok?.status === 'revoked', JSON.stringify(r));
chequear('le quedan los claims vacios', Object.keys((await auth.getUser(uidMod)).customClaims || {}).length === 0, '');

console.log(`\n${pasaron} pasaron, ${fallaron} fallaron\n`);
process.exit(fallaron ? 1 : 0);
