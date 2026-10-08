// Los límites de los planes, haciéndose cumplir de verdad.
//
//   firebase emulators:start --only auth,firestore,functions
//   node scripts/test-planes-emulador.mjs
//
// Lo que se prueba acá es exactamente lo que NO alcanza con esconder en la
// interfaz: la cantidad de barberos, la foto de perfil, los colores, el logo y
// la página de presentación.
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


// -- 6. Plan a medida --------------------------------------------------------
// El Personalizado se configura uno por uno: tantas sucursales, tantos barberos
// y estas funciones si y estas no. Lo que vale es lo escrito en el documento,
// no una tabla de planes.
console.log('\nPlan a medida (capacidades mezcladas):');

await db.recursiveDelete(db.doc('businesses/plan-medida')).catch(() => {});
await db.doc('slugs/plan-medida-2').delete().catch(() => {});
await db.doc('slugs/plan-medida-3').delete().catch(() => {});
await db.doc('businesses/plan-medida').set({
  id: 'plan-medida', name: 'A medida', slug: 'plan-medida', isFrozen: false,
  primaryColor: '#e03d00', logoUrl: null,
  planId: 'personalizado',
  maxBarbers: 2,
  maxSucursales: 2,
  // Foto si, colores si, logo no, pagina si pero sin foto de portada: una
  // combinacion que no existe en ningun plan de la lista y que tiene que
  // respetarse igual.
  capacidades: { fotoPerfil: true, colores: true, logo: false, pagina: true, paginaFoto: false },
  grupoId: null,
});
await db.doc('businesses/plan-medida/private/billing').set({ planId: 'personalizado', monthlyFee: 45000, debt: 0 });
const duenoMedida = await usuario('dueno-medida@gmail.com', { businessId: 'plan-medida', role: 'owner', professionalId: null });

r = await llamar('crearProfesional', duenoMedida, { businessId: 'plan-medida', datos: { name: 'Uno' } });
chequear('a medida: entra el primer barbero', Boolean(r.ok?.id), JSON.stringify(r));
r = await llamar('crearProfesional', duenoMedida, { businessId: 'plan-medida', datos: { name: 'Dos' } });
chequear('a medida: entra el segundo', Boolean(r.ok?.id), JSON.stringify(r));
r = await llamar('crearProfesional', duenoMedida, { businessId: 'plan-medida', datos: { name: 'Tres' } });
chequear('a medida: el tercero se rechaza (tope 2)', r.error === 'FAILED_PRECONDITION', JSON.stringify(r));

const profMedida = (await db.collection('businesses/plan-medida/professionals').get()).docs[0];
await esperar('a medida: la foto esta habilitada',
  editar(duenoMedida, `businesses/plan-medida/professionals/${profMedida.id}`, { avatarUrl: FOTO }), 'permitido');
await esperar('a medida: los colores estan habilitados',
  editar(duenoMedida, 'businesses/plan-medida', { primaryColor: '#101010' }), 'permitido');
await esperar('a medida: el logo NO',
  editar(duenoMedida, 'businesses/plan-medida', { logoUrl: FOTO }), 'denegado');

r = await llamar('crearSucursal', duenoMedida, { businessId: 'plan-medida', nombre: 'Segunda', slug: 'plan-medida-2' });
chequear('a medida: puede abrir la segunda sucursal (tope 2)', Boolean(r.ok?.businessId), JSON.stringify(r));
r = await llamar('crearSucursal', duenoMedida, { businessId: 'plan-medida', nombre: 'Tercera', slug: 'plan-medida-3' });
chequear('a medida: la tercera se rechaza', r.error === 'FAILED_PRECONDITION', JSON.stringify(r));

// -- 7. La pagina de presentacion --------------------------------------------
// Dos capacidades distintas y conviene no confundirlas: `pagina` (tenerla, del
// Intermedio) y `paginaFoto` (la plantilla con la foto de portada, del Full).
// Un Intermedio tiene su pagina pero con las plantillas que no llevan foto.
//
// La configuracion vive en un documento APARTE, `businesses/{id}/public/pagina`,
// y no adentro del negocio: la portada es una imagen y el documento del negocio
// lo lee cada visitante del link.
console.log('\nLa pagina de presentacion (del Intermedio; la foto, del Full):');

const PORTADA = 'data:image/jpeg;base64,' + 'A'.repeat(300);

// El cliente la lee SIN cuenta: es lo primero que ve al abrir el link.
await db.doc(`businesses/${CUENTAS.full}/public/pagina`).set({ plantilla: 'simple' });
const sinCuenta = await fetch(`${DOCS}/businesses/${CUENTAS.full}/public/pagina`);
chequear('cualquiera lee la pagina sin estar logueado', sinCuenta.status === 200, `HTTP ${sinCuenta.status}`);

// El interruptor vive en el negocio, y tambien esta atado al plan: si no,
// un Basico se prende la pagina con la consola abierta y la tiene gratis.
await esperar('Basico: NO puede prender su pagina',
  editar(duenoBasico, `businesses/${CUENTAS.basico}`, { paginaActiva: true }), 'denegado');
await esperar('Basico: NO puede escribir la configuracion de la pagina',
  editar(duenoBasico, `businesses/${CUENTAS.basico}/public/pagina`, { plantilla: 'simple' }), 'denegado');

await esperar('Intermedio: SI puede prender su pagina',
  editar(duenoInter, `businesses/${CUENTAS.intermedio}`, { paginaActiva: true }), 'permitido');
await esperar('Intermedio: SI puede elegir plantilla y textos',
  editar(duenoInter, `businesses/${CUENTAS.intermedio}/public/pagina`,
    { plantilla: 'tarjeta', titular: 'La barberia del barrio', bajada: 'Cortes clasicos' }), 'permitido');

// Y aca esta la linea entre las dos capacidades.
await esperar('Intermedio: la foto de portada NO',
  editar(duenoInter, `businesses/${CUENTAS.intermedio}/public/pagina`, { coverUrl: PORTADA }), 'denegado');
await esperar('Full: la foto de portada SI',
  editar(duenoFull, `businesses/${CUENTAS.full}/public/pagina`, { coverUrl: PORTADA }), 'permitido');

// Sin tope, una imagen pesada se lleva puesto el limite de 1 MB por documento y
// la pagina deja de poder guardarse nunca mas.
await esperar('Full: una portada gigante se rechaza igual',
  editar(duenoFull, `businesses/${CUENTAS.full}/public/pagina`,
    { coverUrl: 'data:image/jpeg;base64,' + 'A'.repeat(500000) }), 'denegado');

// Quitarla siempre se puede: es lo que pasa cuando alguien baja de plan y hay
// que poder dejar la pagina sin la foto que ya no le corresponde.
await esperar('Full: sacar la portada se permite',
  editar(duenoFull, `businesses/${CUENTAS.full}/public/pagina`, { coverUrl: null }), 'permitido');

// Aislamiento: la pagina es de lectura publica, la escritura no.
await esperar('nadie escribe la pagina de otra barberia',
  editar(duenoInter, `businesses/${CUENTAS.full}/public/pagina`, { titular: 'Robada' }), 'denegado');
await esperar('nadie prende la pagina de otra barberia',
  editar(duenoInter, `businesses/${CUENTAS.full}`, { paginaActiva: false }), 'denegado');

// El barbero no: la pagina es la cara comercial de la barberia y la maneja el
// dueno. `canManage` es dueno o plataforma, no el staff.
await esperar('el barbero no edita la pagina de la barberia',
  editar(barberoBasico, `businesses/${CUENTAS.basico}/public/pagina`, { titular: 'Mia' }), 'denegado');

// El plan a medida, con la combinacion rara: pagina si, portada no.
await esperar('a medida: la pagina esta habilitada',
  editar(duenoMedida, 'businesses/plan-medida/public/pagina', { plantilla: 'simple' }), 'permitido');
await esperar('a medida: la portada NO',
  editar(duenoMedida, 'businesses/plan-medida/public/pagina', { coverUrl: PORTADA }), 'denegado');

// Y una cuenta vieja, sin el campo escrito: la pagina le queda habilitada, por
// la misma razon que la foto. Nace apagada igual, asi que no le cambia el link.
await esperar('una cuenta vieja puede tener pagina',
  editar(duenoViejo, 'businesses/plan-viejo/public/pagina', { plantilla: 'simple' }), 'permitido');

// -- 8. Completar planes en las cuentas viejas (migrarPlanes) ----------------
// Va AL FINAL a proposito: escribe sobre las barberias que sembraron las
// secciones anteriores, asi que correrla antes les cambiaria el escenario.
//
// Lo que de verdad se prueba aca es el caso que no se ve a simple vista: una
// cuenta que YA tiene el campo `capacidades` pero a la que le falta una clave
// NUEVA. En las Rules una clave ausente vale TRUE, asi que esa cuenta tiene la
// funcion nueva habilitada aunque la interfaz le diga que no.
console.log('\nCompletar planes en las cuentas viejas:');

const plataforma = await usuario('plataforma-planes@gmail.com', { platform: true });

// Solo el dueño de la plataforma. Esto escribe con el Admin SDK, por arriba de
// las Rules, justo sobre los campos que las Rules no le dejan tocar a nadie.
r = await llamar('migrarPlanes', duenoFull, { aplicar: true });
chequear('migrar: un dueño de barberia no puede correrla', r.error === 'PERMISSION_DENIED', JSON.stringify(r));
r = await llamar('migrarPlanes', null, { aplicar: true });
chequear('migrar: sin sesion tampoco', r.error === 'UNAUTHENTICATED', JSON.stringify(r));

// Una cuenta de Basico creada DESPUES de la escalera nueva pero ANTES de que
// existiera la pagina: tiene el mapa escrito, sin las claves nuevas.
await db.recursiveDelete(db.doc('businesses/plan-a-medias')).catch(() => {});
await db.doc('businesses/plan-a-medias').set({
  id: 'plan-a-medias', name: 'A medias', slug: 'plan-a-medias', isFrozen: false,
  planId: 'basico', maxBarbers: 1, maxSucursales: 1, grupoId: null,
  capacidades: { fotoPerfil: false, colores: false, logo: false },
});
const duenoAMedias = await usuario('dueno-a-medias@gmail.com', {
  businessId: 'plan-a-medias', role: 'owner', professionalId: null,
});

// Antes de migrar, la regla la deja prender la pagina: la clave no esta escrita.
await esperar('antes de migrar, a la cuenta a medias le queda la pagina habilitada',
  editar(duenoAMedias, 'businesses/plan-a-medias', { paginaActiva: true }), 'permitido');

// El informe primero. No escribe nada.
r = await llamar('migrarPlanes', plataforma, { aplicar: false });
chequear('migrar: el informe dice que esta cuenta necesita cambios',
  r.ok?.cambios?.some((c) => c.id === 'plan-a-medias'), JSON.stringify(r).slice(0, 300));
chequear('migrar: el informe NO escribe',
  (await db.doc('businesses/plan-a-medias').get()).get('capacidades').pagina === undefined,
  JSON.stringify((await db.doc('businesses/plan-a-medias').get()).get('capacidades')));

// Y ahora sí.
r = await llamar('migrarPlanes', plataforma, { aplicar: true });
chequear('migrar: aplicado', r.ok?.aplicado === true, JSON.stringify(r).slice(0, 200));

let caps = (await db.doc('businesses/plan-a-medias').get()).get('capacidades');
chequear('migrar: le completo la clave que faltaba, con el valor de su plan',
  caps.pagina === false && caps.paginaFoto === false, JSON.stringify(caps));
chequear('migrar: no le toco las que ya tenia',
  caps.fotoPerfil === false && caps.colores === false && caps.logo === false, JSON.stringify(caps));

await esperar('despues de migrar, la cuenta a medias YA NO puede prender la pagina',
  editar(duenoAMedias, 'businesses/plan-a-medias', { paginaActiva: false }), 'denegado');

// Una cuenta vieja de verdad, sin el campo: se lo escribe entero. `plan-viejo`
// es del plan `pro`, que es historico y lleva todas las capacidades — asi que
// conserva lo que ya usaba, que es justamente el punto.
caps = (await db.doc('businesses/plan-viejo').get()).get('capacidades');
chequear('migrar: a la cuenta vieja le escribio el campo entero',
  caps && caps.fotoPerfil === true && caps.colores === true && caps.pagina === true, JSON.stringify(caps));

// Lo que no se decide solo: un plan que no esta en la lista se informa y no se
// toca. Pasarla de plan es una charla con el cliente, no un script.
await db.doc('businesses/plan-inventado').set({
  id: 'plan-inventado', name: 'Inventada', slug: 'plan-inventado', isFrozen: false, planId: 'platino',
});
r = await llamar('migrarPlanes', plataforma, { aplicar: true });
chequear('migrar: una cuenta con un plan desconocido se informa y no se toca',
  r.ok?.sinPlan?.some((x) => x.id === 'plan-inventado')
  && (await db.doc('businesses/plan-inventado').get()).get('capacidades') === undefined,
  JSON.stringify(r.ok?.sinPlan));

// El mapa publico de las cuentas con sucursales. Sin el, el cliente que abre el
// link de una cuenta con varios locales no puede elegir a cual va.
await db.doc('grupos/plan-medida').delete().catch(() => {});
r = await llamar('migrarPlanes', plataforma, { aplicar: true });
const mapa = await db.doc('grupos/plan-medida').get();
chequear('migrar: reconstruye el mapa de sucursales que no estaba',
  mapa.exists && mapa.get('businessIds').length === 2 && mapa.get('principalId') === 'plan-medida',
  JSON.stringify(mapa.data()));

// Y correrla dos veces seguidas no tiene nada que hacer: es idempotente, que es
// lo que hace que se pueda apretar el boton sin pensarlo.
r = await llamar('migrarPlanes', plataforma, { aplicar: false });
chequear('migrar: correrla de nuevo no encuentra nada que hacer',
  r.ok?.cambios?.length === 0 && r.ok?.grupos?.length === 0,
  JSON.stringify({ cambios: r.ok?.cambios?.length, grupos: r.ok?.grupos?.length }));

console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
if (fallas.length) console.log('Fallaron:\n  - ' + fallas.join('\n  - '));
console.log('');
process.exit(fallaron ? 1 : 0);
