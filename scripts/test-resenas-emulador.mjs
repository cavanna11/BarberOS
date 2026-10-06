// Reseñas de los clientes, contra el emulador.
//
//   firebase emulators:start --only auth,firestore
//   node scripts/test-resenas-emulador.mjs
//
// Lo que tiene que ser IMPOSIBLE, que es de lo que se trata esta suite:
//
//   - valorar un turno que todavía no pasó, o que se canceló, o al que el
//     cliente no fue;
//   - valorar el turno de otra persona;
//   - dejar dos reseñas del mismo turno;
//   - mandar una reseña diciendo que es de otro barbero o de otra barbería
//     (sería ensuciarle el promedio a alguien que no te atendió);
//   - que un barbero lea las reseñas de los turnos de otro;
//   - que un cliente se baje todas las reseñas de la barbería.
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const PROJECT = 'barberos-1d60e';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
initializeApp({ projectId: PROJECT });
const db = getFirestore(), auth = getAuth();

const DOCS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';

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

const cab = (u) => (u
  ? { Authorization: `Bearer ${u.token}`, 'Content-Type': 'application/json' }
  : { 'Content-Type': 'application/json' });

const leer = (u, path) => fetch(`${DOCS}/${path}`, { headers: cab(u) });
// Crear con id propio: POST con documentId, que es como escribe el SDK cuando
// el id lo elige la app (acá, el id del turno).
const crearCon = (u, col, id, datos) =>
  fetch(`${DOCS}/${col}?documentId=${id}`, { method: 'POST', headers: cab(u), body: JSON.stringify(enc(datos)) });
const editar = (u, path, datos) => {
  const qs = Object.keys(datos).map((k) => `updateMask.fieldPaths=${k}`).join('&');
  return fetch(`${DOCS}/${path}?${qs}`, { method: 'PATCH', headers: cab(u), body: JSON.stringify(enc(datos)) });
};
const borrar = (u, path) => fetch(`${DOCS}/${path}`, { method: 'DELETE', headers: cab(u) });
async function consultar(u, padre, col, where) {
  const q = { structuredQuery: { from: [{ collectionId: col }] } };
  if (where) q.structuredQuery.where = { fieldFilter: { field: { fieldPath: where[0] }, op: 'EQUAL', value: val(where[1]) } };
  return fetch(`${DOCS}/${padre}:runQuery`, { method: 'POST', headers: cab(u), body: JSON.stringify(q) });
}

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

// ── escenario ───────────────────────────────────────────────────────────────
const BIZ = 'biz-resenas';
const OTRA = 'biz-resenas-otra';

await db.recursiveDelete(db.doc(`businesses/${BIZ}`)).catch(() => {});
await db.recursiveDelete(db.doc(`businesses/${OTRA}`)).catch(() => {});

await db.doc(`businesses/${BIZ}`).set({ id: BIZ, name: 'La Barbería', slug: 'la-barberia', isFrozen: false, planId: 'full' });
await db.doc(`businesses/${OTRA}`).set({ id: OTRA, name: 'Otra', slug: 'otra-barberia', isFrozen: false, planId: 'full' });

await db.doc(`businesses/${BIZ}/professionals/p1`).set({ id: 'p1', name: 'Martín', isActive: true });
await db.doc(`businesses/${BIZ}/professionals/p2`).set({ id: 'p2', name: 'Lucas', isActive: true });
await db.doc(`businesses/${BIZ}/services/s1`).set({ id: 's1', name: 'Corte', price: 8000, durationMinutes: 30, isActive: true });

const cliente = await usuario('cliente-resena@gmail.com', null);
const otroCliente = await usuario('otro-cliente@gmail.com', null);
const dueno = await usuario('dueno-resenas@gmail.com', { businessId: BIZ, role: 'owner', professionalId: null });
const barbero1 = await usuario('barbero-p1@gmail.com', { businessId: BIZ, role: 'admin', professionalId: 'p1' });
const barbero2 = await usuario('barbero-p2@gmail.com', { businessId: BIZ, role: 'admin', professionalId: 'p2' });

const turno = (id, extra) => db.doc(`businesses/${BIZ}/appointments/${id}`).set({
  id, businessId: BIZ, userId: cliente.uid, clientName: 'Juan',
  professionalId: 'p1', serviceId: 's1',
  appointmentDate: '2026-10-01', startTime: '10:00', endTime: '10:30',
  price: 8000, status: 'completada', ...extra,
});

await turno('apt-ok', {});
await turno('apt-pendiente', { status: 'pendiente' });
await turno('apt-cancelado', { status: 'cancelada' });
await turno('apt-no-vino', { status: 'no_asistio' });
await turno('apt-de-otro', { userId: otroCliente.uid });
await turno('apt-p2', { professionalId: 'p2' });

const resena = (extra = {}) => ({
  stars: 5, comment: 'Excelente corte',
  businessId: BIZ, appointmentId: 'apt-ok', userId: cliente.uid,
  professionalId: 'p1', serviceId: 's1',
  clientName: 'Juan', appointmentDate: '2026-10-01',
  ...extra,
});

// ── 1. Cuándo se puede valorar ──────────────────────────────────────────────
console.log('\nCuándo se puede valorar:');

await esperar('un turno que todavía no pasó (pendiente): NO',
  crearCon(cliente, `businesses/${BIZ}/reviews`, 'apt-pendiente', resena({ appointmentId: 'apt-pendiente' })), 'denegado');

await esperar('un turno cancelado: NO',
  crearCon(cliente, `businesses/${BIZ}/reviews`, 'apt-cancelado', resena({ appointmentId: 'apt-cancelado' })), 'denegado');

await esperar('un turno al que no fue: NO',
  crearCon(cliente, `businesses/${BIZ}/reviews`, 'apt-no-vino', resena({ appointmentId: 'apt-no-vino' })), 'denegado');

await esperar('el turno de otra persona: NO',
  crearCon(cliente, `businesses/${BIZ}/reviews`, 'apt-de-otro', resena({ appointmentId: 'apt-de-otro' })), 'denegado');

await esperar('un turno que no existe: NO',
  crearCon(cliente, `businesses/${BIZ}/reviews`, 'apt-fantasma', resena({ appointmentId: 'apt-fantasma' })), 'denegado');

await esperar('sin sesión: NO',
  crearCon(null, `businesses/${BIZ}/reviews`, 'apt-ok', resena()), 'denegado');

// Antes de guardar, la app PREGUNTA si ya existe la reseña de ese turno (para
// saber si crea o corrige). Leer un documento que no existe tiene que devolver
// "no está", no un permiso denegado: con la regla mirando `resource.data` sin
// chequear que exista, reventaba con "Null value error" y NADIE podía dejar su
// primera reseña. No lo agarró ninguna prueba hasta que se probó en el browser.
// Ojo con el código: leer un documento que NO existe devuelve 404 cuando la
// regla permite, y 403 cuando la deniega. Un 404 acá es el resultado bueno.
{
  const r = await leer(cliente, `businesses/${BIZ}/reviews/apt-ok`);
  chequear('preguntar por una reseña que todavía no existe: SÍ (404, no 403)',
    r.status === 404, `HTTP ${r.status}`);
}

await esperar('un turno propio y atendido: SÍ',
  crearCon(cliente, `businesses/${BIZ}/reviews`, 'apt-ok', resena()), 'permitido');

// ── 2. Una sola por turno ───────────────────────────────────────────────────
console.log('\nUna reseña por turno:');

await esperar('no se puede dejar una segunda del mismo turno',
  crearCon(cliente, `businesses/${BIZ}/reviews`, 'apt-ok', resena({ stars: 1 })), 'denegado');

await esperar('sí se puede corregir la propia',
  editar(cliente, `businesses/${BIZ}/reviews/apt-ok`, { stars: 4, comment: 'Muy bueno' }), 'permitido');

await esperar('otra persona NO puede editarla',
  editar(otroCliente, `businesses/${BIZ}/reviews/apt-ok`, { stars: 1 }), 'denegado');

await esperar('al corregirla no se puede cambiar de barbero',
  editar(cliente, `businesses/${BIZ}/reviews/apt-ok`, { professionalId: 'p2' }), 'denegado');

await esperar('al corregirla no se puede cambiar de dueño',
  editar(cliente, `businesses/${BIZ}/reviews/apt-ok`, { userId: otroCliente.uid }), 'denegado');

await esperar('nadie la borra, ni quien la escribió',
  borrar(cliente, `businesses/${BIZ}/reviews/apt-ok`), 'denegado');

await esperar('ni el dueño de la barbería la borra',
  borrar(dueno, `businesses/${BIZ}/reviews/apt-ok`), 'denegado');

// ── 3. Lo que dice la reseña tiene que coincidir con el turno ───────────────
console.log('\nLa reseña no puede mentir sobre el turno:');

await esperar('no se puede atribuir a otro barbero',
  crearCon(cliente, `businesses/${BIZ}/reviews`, 'apt-p2', resena({ appointmentId: 'apt-p2', professionalId: 'p1' })), 'denegado');

await esperar('no se puede atribuir a otro servicio',
  crearCon(cliente, `businesses/${BIZ}/reviews`, 'apt-p2', resena({ appointmentId: 'apt-p2', professionalId: 'p2', serviceId: 's9' })), 'denegado');

await esperar('no se puede atribuir a otra barbería',
  crearCon(cliente, `businesses/${BIZ}/reviews`, 'apt-p2', resena({ appointmentId: 'apt-p2', professionalId: 'p2', businessId: OTRA })), 'denegado');

await esperar('el id del documento tiene que ser el del turno',
  crearCon(cliente, `businesses/${BIZ}/reviews`, 'otro-id', resena({ appointmentId: 'apt-p2', professionalId: 'p2' })), 'denegado');

await esperar('con todo coincidiendo, entra',
  crearCon(cliente, `businesses/${BIZ}/reviews`, 'apt-p2', resena({ appointmentId: 'apt-p2', professionalId: 'p2' })), 'permitido');

// ── 4. Puntajes válidos ─────────────────────────────────────────────────────
console.log('\nPuntajes:');

await db.doc(`businesses/${BIZ}/reviews/apt-p2`).delete();

for (const [stars, debe, caso] of [[0, 'denegado', 'cero'], [6, 'denegado', 'seis'], [-1, 'denegado', 'negativo'], [3, 'permitido', 'tres']]) {
  await db.doc(`businesses/${BIZ}/reviews/apt-p2`).delete().catch(() => {});
  await esperar(`${caso} estrellas`,
    crearCon(cliente, `businesses/${BIZ}/reviews`, 'apt-p2', resena({ appointmentId: 'apt-p2', professionalId: 'p2', stars })), debe);
}

await db.doc(`businesses/${BIZ}/reviews/apt-p2`).delete().catch(() => {});
await esperar('un comentario de 2000 caracteres se rechaza',
  crearCon(cliente, `businesses/${BIZ}/reviews`, 'apt-p2', resena({ appointmentId: 'apt-p2', professionalId: 'p2', comment: 'x'.repeat(2000) })), 'denegado');

await esperar('sin comentario está bien (es opcional)',
  crearCon(cliente, `businesses/${BIZ}/reviews`, 'apt-p2', resena({ appointmentId: 'apt-p2', professionalId: 'p2', comment: '' })), 'permitido');

// ── 5. Quién las ve ─────────────────────────────────────────────────────────
console.log('\nQuién las ve:');

await esperar('el dueño lista todas las de su barbería',
  consultar(dueno, `businesses/${BIZ}`, 'reviews'), 'permitido');

await esperar('el barbero lista las de SUS turnos',
  consultar(barbero1, `businesses/${BIZ}`, 'reviews', ['professionalId', 'p1']), 'permitido');

await esperar('el barbero NO lista las de otro barbero',
  consultar(barbero1, `businesses/${BIZ}`, 'reviews', ['professionalId', 'p2']), 'denegado');

await esperar('el barbero NO lista todas',
  consultar(barbero1, `businesses/${BIZ}`, 'reviews'), 'denegado');

await esperar('el barbero NO lee la reseña de un turno de otro',
  leer(barbero2, `businesses/${BIZ}/reviews/apt-ok`), 'denegado');

await esperar('el cliente lee la suya',
  leer(cliente, `businesses/${BIZ}/reviews/apt-ok`), 'permitido');

await esperar('el cliente lista las suyas filtrando por su uid',
  consultar(cliente, `businesses/${BIZ}`, 'reviews', ['userId', cliente.uid]), 'permitido');

await esperar('un cliente NO se baja todas las reseñas de la barbería',
  consultar(cliente, `businesses/${BIZ}`, 'reviews'), 'denegado');

await esperar('otro cliente NO lee una reseña ajena',
  leer(otroCliente, `businesses/${BIZ}/reviews/apt-ok`), 'denegado');

await esperar('sin sesión no se lee nada',
  leer(null, `businesses/${BIZ}/reviews/apt-ok`), 'denegado');

console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
if (fallas.length) console.log('Fallaron:\n  - ' + fallas.join('\n  - '));
console.log('');
process.exit(fallaron ? 1 : 0);
