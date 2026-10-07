// Cuentas con sucursales (Plan Empresarial), contra el emulador.
//
//   firebase emulators:start --only auth,firestore,functions
//   node scripts/test-sucursales-emulador.mjs
//
// Lo que se prueba, en este orden:
//
//   1. AISLAMIENTO. Es lo más importante y es lo que se pidió verificar: que un
//      turno de la sucursal A no aparezca en la B, que el barbero de una no
//      alcance la otra, y que una barbería ajena no se cuele en el grupo. Se
//      golpea la REST API de Firestore con tokens de verdad, así que lo que
//      corre son las Rules reales.
//   2. El ROBO DE GRUPO, que es el agujero que abre esta función: los claims del
//      dueño salen de preguntarle a la base qué negocios comparten `grupoId`, así
//      que si el dueño pudiera escribir ese campo se metería la barbería de otro
//      adentro de su cuenta. Tiene que estar cerrado en las Rules.
//   3. El TOPE de sucursales del plan, que es plata y por eso vive en el
//      servidor.
//   4. La FACTURACIÓN del grupo: el plan lo paga la principal, y si la principal
//      debe, las sucursales también se cierran. Si no, el dueño deja de pagar y
//      sigue trabajando en las otras tres.
//   5. El BORRADO, que es donde es fácil dejar a alguien sin acceso a su cuenta.
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const PROJECT = 'barberos-1d60e';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.GCLOUD_PROJECT = PROJECT;

initializeApp({ projectId: PROJECT });
const db = getFirestore(), auth = getAuth();

const DOCS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const FN = `http://127.0.0.1:5001/${PROJECT}/southamerica-east1`;

// ── codificación de valores de Firestore (igual que en la auditoría de Rules) ─
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

const cab = (u) => u
  ? { Authorization: `Bearer ${u.token}`, 'Content-Type': 'application/json' }
  : { 'Content-Type': 'application/json' };

const leer = (u, path) => fetch(`${DOCS}/${path}`, { headers: cab(u) });
const crear = (u, path, datos) => fetch(`${DOCS}/${path}`, { method: 'POST', headers: cab(u), body: JSON.stringify(enc(datos)) });
const editar = (u, path, datos) => {
  const qs = Object.keys(datos).map((k) => `updateMask.fieldPaths=${k}`).join('&');
  return fetch(`${DOCS}/${path}?${qs}`, { method: 'PATCH', headers: cab(u), body: JSON.stringify(enc(datos)) });
};
async function consultar(u, padre, col, where) {
  const q = { structuredQuery: { from: [{ collectionId: col }] } };
  if (where) q.structuredQuery.where = { fieldFilter: { field: { fieldPath: where[0] }, op: 'EQUAL', value: val(where[1]) } };
  const url = padre ? `${DOCS}/${padre}:runQuery` : `${DOCS}:runQuery`;
  return fetch(url, { method: 'POST', headers: cab(u), body: JSON.stringify(q) });
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

let pasaron = 0, fallaron = 0;
const fallas = [];
const chequear = (t, ok, d = '') => {
  if (ok) { pasaron++; console.log('  ok    ', t); }
  else { fallaron++; fallas.push(t); console.log('  FALLA ', t, '\n          ', d); }
};
async function esperar(desc, promesa, debe) {   // debe: 'permitido' | 'denegado'
  const r = await promesa;
  const real = r.status < 400 ? 'permitido' : 'denegado';
  chequear(desc, real === debe, `esperado ${debe}, fue ${real} (HTTP ${r.status})`);
}

// ── escenario ───────────────────────────────────────────────────────────────
// PRINCIPAL ← grupo → SUCURSAL, y una barbería AJENA que no tiene nada que ver.
const P = 'grupo-centro';      // principal del grupo (Plan Empresarial)
const S = 'grupo-norte';       // su sucursal
const AJENA = 'biz-ajena';     // otra barbería, de otro dueño

const SLUGS = ['g-centro', 'g-norte', 'g-ajena', 'g-playa', 'g-ruta', 'g-quinta', 'g-sola'];

async function limpiar() {
  for (const id of [P, S, AJENA, 'biz-sola']) {
    await db.recursiveDelete(db.doc(`businesses/${id}`)).catch(() => {});
  }
  for (const s of SLUGS) await db.doc(`slugs/${s}`).delete().catch(() => {});
  // Las sucursales creadas por una corrida anterior.
  for (const d of (await db.collection('businesses').where('grupoId', '==', P).get()).docs) {
    await db.recursiveDelete(d.ref).catch(() => {});
  }
  for (const d of (await db.collection('tickets').get()).docs) {
    if ([P, S, AJENA].includes(d.get('businessId'))) await db.recursiveDelete(d.ref).catch(() => {});
  }
}
await limpiar();

const base = (nombre, slug, extra = {}) => ({
  id: extra.id || nombre, name: nombre, slug, isFrozen: false,
  planId: 'empresarial', whatsappQuota: 0, onlineBookingEnabled: true,
  businessHours: [{ dayOfWeek: 0, startTime: '09:00', endTime: '18:00', isActive: true }],
  ...extra,
});

await db.doc(`businesses/${P}`).set(base('Centro', 'g-centro', { id: P, grupoId: P }));
await db.doc(`businesses/${S}`).set(base('Norte', 'g-norte', { id: S, grupoId: P }));
await db.doc(`businesses/${AJENA}`).set(base('Ajena', 'g-ajena', { id: AJENA, planId: 'full', grupoId: null }));
for (const s of [['g-centro', P], ['g-norte', S], ['g-ajena', AJENA]]) {
  await db.doc(`slugs/${s[0]}`).set({ businessId: s[1] });
}
await db.doc(`businesses/${P}/private/billing`).set({ monthlyFee: 25000, debt: 0, nextBillingDate: null });
await db.doc(`businesses/${S}/private/billing`).set({ monthlyFee: 0, debt: 0, nextBillingDate: null, esSucursal: true, grupoId: P });

// Equipo y turnos propios de cada una: lo que NO se tiene que mezclar.
await db.doc(`businesses/${P}/professionals/p-centro`).set({ id: 'p-centro', name: 'Martín', isActive: true });
await db.doc(`businesses/${S}/professionals/p-norte`).set({ id: 'p-norte', name: 'Lucas', isActive: true });
await db.doc(`businesses/${P}/appointments/apt-centro`).set({
  id: 'apt-centro', businessId: P, userId: 'cli-1', clientName: 'Cliente del Centro', clientPhone: '+54 11 1111',
  professionalId: 'p-centro', appointmentDate: '2026-10-01', startTime: '10:00', endTime: '10:30',
  price: 8000, status: 'completada',
});
await db.doc(`businesses/${S}/appointments/apt-norte`).set({
  id: 'apt-norte', businessId: S, userId: 'cli-2', clientName: 'Cliente del Norte', clientPhone: '+54 11 2222',
  professionalId: 'p-norte', appointmentDate: '2026-10-01', startTime: '11:00', endTime: '11:30',
  price: 9000, status: 'completada',
});
await db.doc(`businesses/${P}/staffContacts/p-centro`).set({ phone: '+54 11 3333', email: 'martin@gmail.com' });
await db.doc(`businesses/${P}/services/srv-corte`).set({ id: 'srv-corte', name: 'Corte', price: 8000, duration: 30, isActive: true });
await db.doc(`businesses/${P}/services/srv-barba`).set({ id: 'srv-barba', name: 'Barba', price: 5000, duration: 20, isActive: true });
await db.doc(`businesses/${P}/admins/dueno-grupo@gmail.com`).set({
  email: 'dueno-grupo@gmail.com', name: 'Dueño', role: 'owner', businessId: P, professionalId: null,
});

const duenoGrupo = await usuario('dueno-grupo@gmail.com', {
  businessId: P, role: 'owner', professionalId: null, grupoId: P, businessIds: [P, S],
});
const barberoCentro = await usuario('barbero-centro@gmail.com', {
  businessId: P, role: 'admin', professionalId: 'p-centro',
});
const duenoAjeno = await usuario('dueno-ajeno@gmail.com', { businessId: AJENA, role: 'owner', professionalId: null });
const cliente = await usuario('cliente-cualquiera@gmail.com', null);

// ── 1. Aislamiento entre sucursales ─────────────────────────────────────────
console.log('\nAislamiento entre sucursales:');

await esperar('el dueño lee la agenda de la principal',
  consultar(duenoGrupo, `businesses/${P}`, 'appointments'), 'permitido');
await esperar('el dueño lee la agenda de SU sucursal',
  consultar(duenoGrupo, `businesses/${S}`, 'appointments'), 'permitido');
await esperar('el dueño NO lee la agenda de una barbería ajena',
  consultar(duenoGrupo, `businesses/${AJENA}`, 'appointments'), 'denegado');
await esperar('un dueño ajeno NO lee la agenda de la sucursal',
  consultar(duenoAjeno, `businesses/${S}`, 'appointments'), 'denegado');
await esperar('el barbero de la principal NO lista la agenda de la sucursal',
  consultar(barberoCentro, `businesses/${S}`, 'appointments'), 'denegado');
await esperar('el barbero de la principal NO lee un turno de la sucursal',
  leer(barberoCentro, `businesses/${S}/appointments/apt-norte`), 'denegado');
await esperar('el barbero de la principal sí ve sus propios turnos',
  consultar(barberoCentro, `businesses/${P}`, 'appointments', ['professionalId', 'p-centro']), 'permitido');
await esperar('el dueño ajeno NO lee el contacto del staff de la principal',
  leer(duenoAjeno, `businesses/${P}/staffContacts/p-centro`), 'denegado');
await esperar('el dueño del grupo edita la configuración de su sucursal',
  editar(duenoGrupo, `businesses/${S}`, { welcomeMessage: 'Hola Norte' }), 'permitido');
await esperar('el dueño del grupo NO edita la configuración de una ajena',
  editar(duenoGrupo, `businesses/${AJENA}`, { welcomeMessage: 'Mío ahora' }), 'denegado');
await esperar('el dueño del grupo carga un servicio en su sucursal',
  crear(duenoGrupo, `businesses/${S}/services`, { name: 'Corte Norte', price: 9000, duration: 30, isActive: true }), 'permitido');
await esperar('un dueño ajeno NO carga un servicio en la sucursal',
  crear(duenoAjeno, `businesses/${S}/services`, { name: 'Trucho', price: 1, duration: 5, isActive: true }), 'denegado');
await esperar('un cliente cualquiera NO lista la agenda de la sucursal',
  consultar(cliente, `businesses/${S}`, 'appointments'), 'denegado');

// ── 2. Robo de grupo ────────────────────────────────────────────────────────
// El agujero que abre esta feature: los claims se calculan leyendo `grupoId` de
// la base. Si el dueño lo pudiera escribir, se metería la barbería de otro
// adentro de su cuenta y en el próximo recálculo se llevaría sus datos.
console.log('\nRobo de grupo (el ataque que esto tiene que cerrar):');

await esperar('el dueño NO puede escribir grupoId en su propio negocio',
  editar(duenoGrupo, `businesses/${P}`, { grupoId: 'cualquier-cosa' }), 'denegado');
await esperar('un dueño ajeno NO puede meterse en el grupo escribiendo grupoId',
  editar(duenoAjeno, `businesses/${AJENA}`, { grupoId: P }), 'denegado');
await esperar('el dueño NO puede subirse el tope de sucursales',
  editar(duenoGrupo, `businesses/${P}`, { maxSucursales: 99 }), 'denegado');
await esperar('el dueño NO puede subirse el tope de barberos',
  editar(duenoGrupo, `businesses/${P}`, { maxBarbers: 99 }), 'denegado');
await esperar('el dueño NO puede cambiarse el plan',
  editar(duenoGrupo, `businesses/${P}`, { planId: 'personalizado' }), 'denegado');
// Suspendida de verdad antes de intentarlo: escribir el MISMO valor no cambia
// ninguna clave, las Rules no ven el campo en el diff y la escritura pasa sin que
// eso pruebe nada. El ataque real es pasar de suspendida a activa.
await db.doc(`businesses/${S}`).update({ isFrozen: true });
await esperar('el dueño NO puede descongelarse solo',
  editar(duenoGrupo, `businesses/${S}`, { isFrozen: false }), 'denegado');
await db.doc(`businesses/${S}`).update({ isFrozen: false });

// ── 3. Tickets de una cuenta con sucursales ─────────────────────────────────
console.log('\nSoporte:');
await esperar('el dueño abre un ticket desde su sucursal',
  crear(duenoGrupo, 'tickets', { businessId: S, subject: 'Algo del Norte', status: 'abierto' }), 'permitido');
await esperar('el dueño lista los tickets de su sucursal',
  consultar(duenoGrupo, null, 'tickets', ['businessId', S]), 'permitido');
await esperar('un dueño ajeno NO lista los tickets de la sucursal',
  consultar(duenoAjeno, null, 'tickets', ['businessId', S]), 'denegado');
await esperar('un cliente sin barbería NO crea tickets con businessId vacío',
  crear(cliente, 'tickets', { businessId: '', subject: 'Basura', status: 'abierto' }), 'denegado');

// ── 4. Abrir sucursales: el tope del plan ───────────────────────────────────
console.log('\nAbrir sucursales (crearSucursal):');

let r = await llamar('crearSucursal', barberoCentro, { nombre: 'Trucha', slug: 'g-playa' });
chequear('un barbero NO puede abrir sucursales', r.error === 'PERMISSION_DENIED', JSON.stringify(r));

r = await llamar('crearSucursal', duenoAjeno, { nombre: 'Trucha', slug: 'g-playa', businessId: P });
chequear('no se puede abrir una sucursal en la cuenta de otro', r.error === 'PERMISSION_DENIED', JSON.stringify(r));

r = await llamar('crearSucursal', duenoGrupo, { nombre: 'Playa', slug: 'g-norte' });
chequear('rechaza un link ya ocupado', r.error === 'ALREADY_EXISTS', JSON.stringify(r));

r = await llamar('crearSucursal', duenoGrupo, { nombre: 'P', slug: 'g-playa' });
chequear('rechaza un nombre de una sola letra', r.error === 'INVALID_ARGUMENT', JSON.stringify(r));

r = await llamar('crearSucursal', duenoGrupo, { nombre: 'Playa', slug: 'G Playa!' });
chequear('rechaza un link con espacios y símbolos', r.error === 'INVALID_ARGUMENT', JSON.stringify(r));

r = await llamar('crearSucursal', duenoGrupo, {
  nombre: 'Playa', slug: 'g-playa', ciudad: 'Mar de Ajó', copiarServiciosDe: P,
});
chequear('el dueño abre la tercera sucursal', Boolean(r.ok?.businessId), JSON.stringify(r));
const TERCERA = r.ok?.businessId;

if (TERCERA) {
  const nueva = (await db.doc(`businesses/${TERCERA}`).get()).data();
  chequear('la sucursal queda atada al grupo', nueva.grupoId === P, JSON.stringify(nueva.grupoId));

  // El plan es de la CUENTA: una sucursal no tiene período de prueba propio.
  // Copiárselo hacía que mostrara "se terminó tu prueba" por su cuenta.
  chequear('la sucursal NO hereda el período de prueba',
    nueva.trialEndsAt === null, JSON.stringify(nueva.trialEndsAt));
  chequear('hereda el plan de la cuenta', nueva.planId === 'empresarial', JSON.stringify(nueva.planId));
  chequear('hereda los colores de la principal', nueva.primaryColor === undefined || typeof nueva.primaryColor === 'string', '');
  chequear('nace sin equipo propio',
    (await db.collection(`businesses/${TERCERA}/professionals`).get()).size === 0, 'tiene profesionales');
  chequear('nace sin turnos',
    (await db.collection(`businesses/${TERCERA}/appointments`).get()).size === 0, 'tiene turnos');
  chequear('copió los servicios que se le pidieron',
    (await db.collection(`businesses/${TERCERA}/services`).get()).size === 2, String(r.ok?.serviciosCopiados));

  const copiados = (await db.collection(`businesses/${TERCERA}/services`).get()).docs.map((d) => d.id);
  const originales = (await db.collection(`businesses/${P}/services`).get()).docs.map((d) => d.id);
  chequear('los servicios copiados son documentos NUEVOS, no los mismos',
    copiados.every((id) => !originales.includes(id)), JSON.stringify({ copiados, originales }));

  const bill = (await db.doc(`businesses/${TERCERA}/private/billing`).get()).data();
  chequear('la sucursal no tiene abono propio (lo paga la principal)', bill.monthlyFee === 0, JSON.stringify(bill));

  chequear('el slug nuevo apunta a la sucursal',
    (await db.doc('slugs/g-playa').get()).data()?.businessId === TERCERA, 'no apunta');

  const claims = (await auth.getUser(duenoGrupo.uid)).customClaims;
  chequear('el dueño queda con las tres barberías en sus claims',
    Array.isArray(claims.businessIds) && claims.businessIds.length === 3 && claims.businessIds.includes(TERCERA),
    JSON.stringify(claims));
  chequear('y con el grupo en el claim', claims.grupoId === P, JSON.stringify(claims.grupoId));
  chequear('el businessId suelto sigue apuntando a la principal', claims.businessId === P, JSON.stringify(claims.businessId));
}

// La cuarta entra; la quinta no (el Plan Empresarial son 4).
r = await llamar('crearSucursal', duenoGrupo, { nombre: 'Ruta', slug: 'g-ruta' });
chequear('la cuarta sucursal entra', Boolean(r.ok?.businessId), JSON.stringify(r));

r = await llamar('crearSucursal', duenoGrupo, { nombre: 'Quinta', slug: 'g-quinta' });
chequear('la quinta se rechaza por el tope del plan', r.error === 'FAILED_PRECONDITION', JSON.stringify(r));
chequear('y el slug de la quinta no quedó tomado',
  !(await db.doc('slugs/g-quinta').get()).exists, 'quedó tomado');

// Un plan de una sola barbería no puede abrir ninguna.
await db.doc('businesses/biz-sola').set(base('Sola', 'g-sola', { id: 'biz-sola', planId: 'full', grupoId: null }));
await db.doc('slugs/g-sola').set({ businessId: 'biz-sola' });
const duenoSolo = await usuario('dueno-solo@gmail.com', { businessId: 'biz-sola', role: 'owner', professionalId: null });
r = await llamar('crearSucursal', duenoSolo, { nombre: 'Segunda', slug: 'g-quinta' });
chequear('un plan de una sola barbería no abre sucursales', r.error === 'FAILED_PRECONDITION', JSON.stringify(r));

// ── 5. Aislamiento de los datos de la sucursal nueva ────────────────────────
console.log('\nLos datos de cada sucursal, separados:');
if (TERCERA) {
  const turnosP = (await db.collection(`businesses/${P}/appointments`).get()).docs.map((d) => d.id);
  const turnosS = (await db.collection(`businesses/${S}/appointments`).get()).docs.map((d) => d.id);
  chequear('el turno de la principal no está en la sucursal', !turnosS.includes('apt-centro'), JSON.stringify(turnosS));
  chequear('el turno de la sucursal no está en la principal', !turnosP.includes('apt-norte'), JSON.stringify(turnosP));

  const profsP = (await db.collection(`businesses/${P}/professionals`).get()).docs.map((d) => d.get('name'));
  chequear('el barbero de la sucursal no figura en la principal',
    !profsP.includes('Lucas'), JSON.stringify(profsP));
}

// ── 5b. El mapa público del grupo ───────────────────────────────────────────
// Es lo que lee la página de reservas para preguntarle al cliente a qué
// sucursal va. Sin esto, el que recibe el link de una sucursal no se entera de
// que hay otras tres.
console.log('\nEl mapa de sucursales que ve el cliente:');

const grupo = await db.doc(`grupos/${P}`).get();
chequear('crearSucursal deja el mapa del grupo', grupo.exists, 'no existe /grupos/' + P);
chequear('el mapa incluye la principal y las sucursales',
  (grupo.get('businessIds') || []).includes(P) && (grupo.get('businessIds') || []).length >= 3,
  JSON.stringify(grupo.get('businessIds')));

await esperar('cualquiera puede leerlo sin estar logueado (es la página pública)',
  leer(null, `grupos/${P}`), 'permitido');
await esperar('un cliente NO lo puede escribir',
  editar(cliente, `grupos/${P}`, { businessIds: ['cualquier-cosa'] }), 'denegado');
await esperar('el dueño tampoco lo escribe',
  editar(duenoGrupo, `grupos/${P}`, { businessIds: ['cualquier-cosa'] }), 'denegado');
await esperar('nadie lista los grupos sin ser de la plataforma',
  consultar(cliente, null, 'grupos'), 'denegado');

// ── 6. Facturación del grupo ────────────────────────────────────────────────
// El plan lo paga la principal. Si la principal debe, las sucursales también se
// cierran: si no, el dueño deja de pagar y sigue trabajando en las otras tres.
console.log('\nFacturación de la cuenta con sucursales:');

const hoyISO = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const enDias = (n) => {
  const d = new Date(`${hoyISO()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split('T')[0];
};
const { procesarFacturacion } = await import('../functions/index.js');
const leerNegocio = async (id) => (await db.doc(`businesses/${id}`).get()).data();
const leerBilling = async (id) => (await db.doc(`businesses/${id}/private/billing`).get()).data();

// La principal vencida ayer; la sucursal sin abono propio.
await db.doc(`businesses/${P}/private/billing`).set({ monthlyFee: 25000, debt: 0, nextBillingDate: enDias(-1) });
await db.doc(`businesses/${S}/private/billing`).set({ monthlyFee: 0, debt: 0, nextBillingDate: enDias(20), esSucursal: true, grupoId: P });
await db.doc(`businesses/${P}`).update({ isFrozen: false, trialEndsAt: null });
await db.doc(`businesses/${S}`).update({ isFrozen: false, trialEndsAt: null });

await procesarFacturacion();

chequear('a la principal se le cobró el mes', (await leerBilling(P)).debt === 25000, JSON.stringify(await leerBilling(P)));
chequear('la sucursal NO acumula deuda propia', (await leerBilling(S)).debt === 0, JSON.stringify(await leerBilling(S)));
chequear('la principal quedó suspendida', (await leerNegocio(P)).isFrozen === true, '');
chequear('y la sucursal también (si no, el cobro no tiene palanca)',
  (await leerNegocio(S)).isFrozen === true, JSON.stringify((await leerNegocio(S)).isFrozen));

// Ahora paga: se tienen que destrabar las dos.
await db.doc(`businesses/${P}/private/billing`).update({ debt: 0 });
await procesarFacturacion();
chequear('al saldar, la principal se reactiva', (await leerNegocio(P)).isFrozen === false, '');
chequear('al saldar, la sucursal también', (await leerNegocio(S)).isFrozen === false, '');

// Prueba gratis de la cuenta: protege a las sucursales.
await db.doc(`businesses/${P}`).update({ trialEndsAt: enDias(5), isFrozen: false });
await db.doc(`businesses/${S}`).update({ isFrozen: false });
await db.doc(`businesses/${P}/private/billing`).update({ debt: 0, nextBillingDate: enDias(5) });
await procesarFacturacion();
chequear('en período de prueba no se cobra a la principal', (await leerBilling(P)).debt === 0, '');
chequear('ni se suspende la sucursal', (await leerNegocio(S)).isFrozen === false, '');

// ── 7. Borrado ──────────────────────────────────────────────────────────────
console.log('\nBorrar:');
const plataforma = await usuario('plataforma@barberos.test', { platform: true });

r = await llamar('deleteBusiness', plataforma, { businessId: P, confirmName: 'Centro' });
chequear('no se puede borrar la principal con sucursales abiertas',
  r.error === 'FAILED_PRECONDITION', JSON.stringify(r));

r = await llamar('deleteBusiness', plataforma, { businessId: S, confirmName: 'Norte' });
chequear('se puede borrar una sucursal', r.ok?.status === 'deleted', JSON.stringify(r));

const grupoDespues = await db.doc(`grupos/${P}`).get();
chequear('al borrar una sucursal, sale del mapa público',
  grupoDespues.exists && !(grupoDespues.get('businessIds') || []).includes(S),
  JSON.stringify(grupoDespues.exists ? grupoDespues.get('businessIds') : 'borrado'));

const claimsFinal = (await auth.getUser(duenoGrupo.uid)).customClaims || {};
chequear('al borrar una sucursal el dueño NO pierde la cuenta',
  Array.isArray(claimsFinal.businessIds) && !claimsFinal.businessIds.includes(S) && claimsFinal.businessIds.length >= 2,
  JSON.stringify(claimsFinal));
chequear('y sigue apuntando a la principal', claimsFinal.businessId === P, JSON.stringify(claimsFinal.businessId));

console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
if (fallas.length) console.log('Fallaron:\n  - ' + fallas.join('\n  - '));
console.log('');
process.exit(fallaron ? 1 : 0);
