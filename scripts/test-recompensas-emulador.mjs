// Recompensas contra el emulador: permisos, sorteo del servidor, el premio en
// la reserva y el ciclo que sigue al turno.
//
//   firebase emulators:start --only auth,firestore,functions
//   node scripts/test-recompensas-emulador.mjs
//
// Lo de acá es lo que NO se puede probar sin base: que nadie más que el dueño
// configure una campaña, que el cliente no pueda escribirse un premio, que el
// descuento lo decida el servidor, que el mismo premio no se use dos veces, y
// que la tarjeta sume UNA vez por turno atendido.
//
// La aritmética (probabilidades, descuentos, rachas, cumpleaños) está en
// `scripts/test-recompensas.mjs`, que no necesita emulador.
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

const val = (v) =>
  v === null ? { nullValue: null }
  : typeof v === 'boolean' ? { booleanValue: v }
  : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
  : Array.isArray(v) ? { arrayValue: { values: v.map(val) } }
  : typeof v === 'object' ? { mapValue: enc(v) }
  : { stringValue: String(v) };
const enc = (o) => ({ fields: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, val(v)])) });

async function usuario(email, claims) {
  try { await auth.deleteUser((await auth.getUserByEmail(email)).uid); } catch { /* no existía */ }
  const u = await auth.createUser({ email, emailVerified: true, displayName: email.split('@')[0] });
  if (claims) await auth.setCustomUserClaims(u.uid, claims);
  const r = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: await auth.createCustomToken(u.uid), returnSecureToken: true }),
  });
  return { uid: u.uid, email, token: (await r.json()).idToken };
}

const cab = (u) => ({ Authorization: `Bearer ${u.token}`, 'Content-Type': 'application/json' });
const leer = (u, path) => fetch(`${DOCS}/${path}`, { headers: u ? cab(u) : {} });
const escribir = (u, path, datos) => {
  const qs = Object.keys(datos).map((k) => `updateMask.fieldPaths=${k}`).join('&');
  return fetch(`${DOCS}/${path}?${qs}`, { method: 'PATCH', headers: cab(u), body: JSON.stringify(enc(datos)) });
};
const quitarCampo = (u, path, campo) =>
  fetch(`${DOCS}/${path}?updateMask.fieldPaths=${campo}`, { method: 'PATCH', headers: cab(u), body: JSON.stringify({ fields: {} }) });

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

/**
 * Espera a que un trigger haga lo suyo. Los triggers del emulador tardan, y el
 * primer disparo de cada uno carga el contenedor: una espera fija hace que el
 * caso falle de a ratos y parezca un bug. Se pregunta hasta que se cumple.
 */
async function hasta(leerFn, cumple, ms = 15000) {
  const fin = Date.now() + ms;
  let ultimo;
  while (Date.now() < fin) {
    ultimo = await leerFn();
    if (cumple(ultimo)) return ultimo;
    await new Promise((r) => setTimeout(r, 300));
  }
  return ultimo;
}

const hoyAR = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const enDias = (n) => {
  const d = new Date(`${hoyAR()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const BIZ = 'rec-biz';
const OTRA = 'rec-otra';
const HORARIO = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startTime: '08:00', endTime: '22:00', isActive: true }));

async function sembrarNegocio(id) {
  await db.recursiveDelete(db.doc(`businesses/${id}`)).catch(() => {});
  await db.doc(`businesses/${id}`).set({
    id, name: id, slug: id, isFrozen: false, onlineBookingEnabled: true,
    planId: 'full', grupoId: null, businessHours: HORARIO, mpConectado: false,
  });
  await db.doc(`businesses/${id}/services/corte`).set({ id: 'corte', name: 'Corte', price: 15000, durationMinutes: 30, isActive: true });
  await db.doc(`businesses/${id}/services/barba`).set({ id: 'barba', name: 'Barba', price: 8000, durationMinutes: 30, isActive: true });
  await db.doc(`businesses/${id}/professionals/martin`).set({ id: 'martin', name: 'Martín', isActive: true });
  for (const s of ['corte', 'barba']) {
    await db.doc(`businesses/${id}/professionalServices/martin-${s}`).set({ professionalId: 'martin', serviceId: s });
  }
  for (const d of [0, 1, 2, 3, 4, 5, 6]) {
    await db.doc(`businesses/${id}/schedules/martin-${d}`).set({
      professionalId: 'martin', dayOfWeek: d, startTime: '08:00', endTime: '22:00', isActive: true,
    });
  }
}

await sembrarNegocio(BIZ);
await sembrarNegocio(OTRA);

const dueno = await usuario('rec-dueno@gmail.com', { businessId: BIZ, role: 'owner', professionalId: null });
const duenoOtra = await usuario('rec-otra@gmail.com', { businessId: OTRA, role: 'owner', professionalId: null });
const barbero = await usuario('rec-barbero@gmail.com', { businessId: BIZ, role: 'admin', professionalId: 'martin' });
const cajero = await usuario('rec-cajero@gmail.com', { businessId: BIZ, role: 'cajero', professionalId: null });
const plataforma = await usuario('rec-plataforma@gmail.com', { platform: true });
const clientes = [];
for (let i = 0; i < 10; i++) clientes.push(await usuario(`rec-cliente${i}@gmail.com`, null));
const [cli, cli2, cli3, cli4, cli5, cli6, cli7, cli8, cli9, cli10] = clientes;

let hora = 8 * 60;
const proximaHora = () => { hora += 30; return `${String(Math.floor(hora / 60)).padStart(2, '0')}:${String(hora % 60).padStart(2, '0')}`; };
const reservar = (u, extra = {}) => llamar('createAppointment', u, {
  businessId: BIZ, professionalId: 'martin', serviceId: 'corte',
  appointmentDate: enDias(2), startTime: proximaHora(), clientName: 'Cliente', clientPhone: '1123456789',
  ...extra,
});
const turno = async (id, biz = BIZ) => (await db.doc(`businesses/${biz}/appointments/${id}`).get()).data();
const premio = async (id, biz = BIZ) => (await db.doc(`businesses/${biz}/premios/${id}`).get()).data();
const progreso = async (uid) => (await db.doc(`businesses/${BIZ}/recompensasClientes/${uid}`).get()).data() || {};
const ponerPremio = (id, datos, biz = BIZ) => db.doc(`businesses/${biz}/premios/${id}`).set({
  id, businessId: biz, campana: 'ruleta', origen: { tipo: 'ruleta', ref: null },
  nombre: datos.nombre || id, valor: 0, serviceIds: [], icono: '🎁', color: '#e03d00',
  estado: 'disponible', venceEn: enDias(30), appointmentId: null, ...datos,
});
const campana = (tipo, config, activa = true, u = dueno, businessId = BIZ) =>
  llamar('guardarCampana', u, { businessId, tipo, activa, config });

// ── 1. Configurar campañas: quién y qué ─────────────────────────────────────
console.log('\nConfigurar campañas:');
const RULETA = {
  premios: [
    { tipo: 'porcentaje', valor: 10, probabilidad: 50, nombre: '10% OFF' },
    { tipo: 'porcentaje', valor: 20, probabilidad: 50, nombre: '20% OFF' },
  ],
  frecuenciaDias: 30, diasVencimiento: 30,
};
{
  const negocio = (await db.doc(`businesses/${BIZ}`).get()).data();
  chequear('nada viene activado: el negocio no tiene recompensas', !negocio.recompensas);
}
let r = await campana('ruleta', RULETA, true, cli);
chequear('un cliente no configura campañas', r.error === 'PERMISSION_DENIED', r.msg);
r = await campana('ruleta', RULETA, true, barbero);
chequear('un barbero tampoco', r.error === 'PERMISSION_DENIED', r.msg);
r = await campana('ruleta', RULETA, true, cajero);
chequear('el mostrador tampoco', r.error === 'PERMISSION_DENIED', r.msg);
r = await campana('ruleta', RULETA, true, duenoOtra);
chequear('el dueño de OTRA barbería tampoco', r.error === 'PERMISSION_DENIED', r.msg);
r = await campana('ruleta', { ...RULETA, premios: [{ ...RULETA.premios[0], probabilidad: 60 }, { ...RULETA.premios[1], probabilidad: 50 }] });
chequear('probabilidades que suman 110 → rechazado en el SERVIDOR', r.error === 'INVALID_ARGUMENT' && /110/.test(r.msg), r.msg);
r = await llamar('guardarCampana', dueno, { businessId: BIZ, tipo: 'fidelidad', activa: true });
chequear('activar una campaña nunca configurada → rechazado', r.error === 'FAILED_PRECONDITION', r.msg);
r = await campana('ruleta', RULETA, false);
chequear('el dueño guarda la ruleta apagada', r.ok?.activa === false, r.msg);
chequear('apagada, no aparece en el espejo público', !(await db.doc(`businesses/${BIZ}`).get()).data().recompensas?.ruleta);
r = await llamar('guardarCampana', dueno, { businessId: BIZ, tipo: 'ruleta', activa: true });
chequear('"Activar" sin tocar la configuración', r.ok?.activa === true, r.msg);
{
  const espejo = (await db.doc(`businesses/${BIZ}`).get()).data().recompensas?.ruleta;
  chequear('activa: aparece en el espejo público con sus porciones', espejo?.segmentos?.length === 2);
  chequear('el espejo NO lleva probabilidades', espejo && espejo.segmentos.every((s) => !('probabilidad' in s)));
}
r = await campana('ruleta', RULETA, true, plataforma);
chequear('la plataforma puede configurar cualquier barbería', r.ok?.activa === true, r.msg);

console.log('\nRules — nadie escribe recompensas desde el browser:');
await esperar('el dueño NO escribe el espejo a mano', escribir(dueno, `businesses/${BIZ}`, { recompensas: { happyHour: { dias: [0], desde: '00:00', hasta: '23:59', porcentaje: 90 } } }), 'denegado');
await esperar('el dueño NO escribe la campaña a mano', escribir(dueno, `businesses/${BIZ}/recompensas/ruleta`, { activa: true }), 'denegado');
await esperar('el dueño SÍ lee su campaña', leer(dueno, `businesses/${BIZ}/recompensas/ruleta`), 'permitido');
await esperar('un cliente NO lee la campaña (tiene las probabilidades)', leer(cli, `businesses/${BIZ}/recompensas/ruleta`), 'denegado');
await esperar('el dueño de otra NO lee la campaña', leer(duenoOtra, `businesses/${BIZ}/recompensas/ruleta`), 'denegado');
await esperar('el dueño sigue pudiendo editar su negocio (otro campo)', escribir(dueno, `businesses/${BIZ}`, { welcomeMessage: 'Hola' }), 'permitido');

// ── 2. La ruleta la sortea el servidor ──────────────────────────────────────
console.log('\nRuleta:');
r = await llamar('jugarRecompensa', null, { businessId: BIZ, tipo: 'ruleta' });
chequear('sin sesión no se juega', r.error === 'UNAUTHENTICATED', r.msg);
r = await llamar('jugarRecompensa', cli, { businessId: BIZ, tipo: 'ruleta' });
const idRuleta = `ruleta_${cli.uid}_${hoyAR()}`;
chequear('el cliente gira y gana (50/50, siempre hay premio)', r.ok?.gano === true && [0, 1].includes(r.ok.indice), JSON.stringify(r));
chequear('devuelve las porciones con las que animar', r.ok?.segmentos?.length === 2);
{
  const p = await premio(idRuleta);
  chequear('el premio quedó guardado, disponible, a nombre del cliente', p?.estado === 'disponible' && p.userId === cli.uid);
  chequear('vence a los 30 días', p?.venceEn === enDias(30), p?.venceEn);
  chequear('es el premio que dijo la respuesta', p?.nombre === r.ok?.premio?.nombre);
}
r = await llamar('jugarRecompensa', cli, { businessId: BIZ, tipo: 'ruleta' });
chequear('la segunda tirada del mes se rechaza', r.error === 'FAILED_PRECONDITION' && /Ya jugaste/.test(r.msg), r.msg);
r = await llamar('jugarRecompensa', cli, { businessId: BIZ, tipo: 'caja' });
chequear('la caja apagada no se juega', r.error === 'FAILED_PRECONDITION', r.msg);
r = await llamar('jugarRecompensa', cli, { businessId: BIZ, tipo: 'loteria' });
chequear('un juego inexistente se rechaza', r.error === 'INVALID_ARGUMENT', r.msg);
await esperar('el cliente lee SU premio', leer(cli, `businesses/${BIZ}/premios/${idRuleta}`), 'permitido');
await esperar('otro cliente NO lee ese premio', leer(cli2, `businesses/${BIZ}/premios/${idRuleta}`), 'denegado');
await esperar('el cliente NO se cambia el premio a "gratis"', escribir(cli, `businesses/${BIZ}/premios/${idRuleta}`, { tipo: 'gratis' }), 'denegado');
await esperar('el dueño NO edita un premio a mano', escribir(dueno, `businesses/${BIZ}/premios/${idRuleta}`, { estado: 'disponible' }), 'denegado');
await esperar('el cliente lee SU tarjeta/progreso', leer(cli, `businesses/${BIZ}/recompensasClientes/${cli.uid}`), 'permitido');
await esperar('otro cliente NO lee ese progreso', leer(cli2, `businesses/${BIZ}/recompensasClientes/${cli.uid}`), 'denegado');
await esperar('el cliente NO se escribe sellos', escribir(cli, `businesses/${BIZ}/recompensasClientes/${cli.uid}`, { fidelidad: { sellos: 9 } }), 'denegado');

// ── 3. El premio en la reserva ──────────────────────────────────────────────
console.log('\nEl premio en la reserva:');
await ponerPremio('p10', { userId: cli2.uid, tipo: 'porcentaje', valor: 10, nombre: '10% OFF' });
await ponerPremio('pGratis', { userId: cli3.uid, tipo: 'gratis', nombre: 'Corte gratis' });
await ponerPremio('pBarba', { userId: cli4.uid, tipo: 'gratis', nombre: 'Barba gratis', serviceIds: ['barba'] });
await ponerPremio('pVencido', { userId: cli4.uid, tipo: 'porcentaje', valor: 50, nombre: 'Viejo', venceEn: enDias(-1) });
await ponerPremio('pCorto', { userId: cli4.uid, tipo: 'porcentaje', valor: 50, nombre: 'Corto', venceEn: enDias(1) });
await ponerPremio('pOtraSucursal', { userId: cli4.uid, tipo: 'gratis', nombre: 'De la otra' }, OTRA);

r = await reservar(cli2, { premioId: 'p10' });
chequear('10% sobre $15.000: el turno se cobra $13.500', r.ok?.price === 13500, JSON.stringify(r));
const aptP10 = r.ok?.id;
{
  const t = await turno(aptP10);
  chequear('el turno lleva el snapshot del premio y el precio de lista', t?.premio?.id === 'p10' && t.precioLista === 15000 && t.premio.descuento === 1500);
  const p = await premio('p10');
  chequear('el premio queda RESERVADO por ese turno (no consumido)', p.estado === 'reservado' && p.appointmentId === aptP10);
}
r = await llamar('aplicarMembresia', dueno, { businessId: BIZ, appointmentId: aptP10, membresiaId: 'cualquiera', motivo: 'prueba' });
chequear('el dueño no le suma una membresía a un turno que ya usa un premio', r.error === 'FAILED_PRECONDITION' && /premio/.test(r.msg), r.msg);
r = await reservar(cli2, { premioId: 'p10', appointmentDate: enDias(3) });
chequear('el mismo premio en otro turno → rechazado', r.error === 'FAILED_PRECONDITION' && /otro turno/.test(r.msg), r.msg);
r = await reservar(cli2, { premioId: 'p10', cuponCodigo: 'ALGO', appointmentDate: enDias(4) });
chequear('premio + cupón a la vez → rechazado', r.error === 'INVALID_ARGUMENT', r.msg);
r = await reservar(cli2, { premioId: 'p10', usarMembresia: true, appointmentDate: enDias(4) });
chequear('premio + membresía a la vez → rechazado', r.error === 'INVALID_ARGUMENT', r.msg);
r = await reservar(cli4, { premioId: 'pBarba' });
chequear('un premio de barba no paga un corte', r.error === 'FAILED_PRECONDITION' && /no vale para este servicio/.test(r.msg), r.msg);
r = await reservar(cli4, { premioId: 'pVencido' });
chequear('un premio vencido se rechaza', r.error === 'FAILED_PRECONDITION' && /venció/.test(r.msg), r.msg);
r = await reservar(cli4, { premioId: 'pCorto', appointmentDate: enDias(5) });
chequear('un turno después del vencimiento del premio se rechaza', r.error === 'FAILED_PRECONDITION' && /hasta el/.test(r.msg), r.msg);
r = await reservar(cli4, { premioId: 'p10', appointmentDate: enDias(6) });
chequear('el premio de OTRO cliente se rechaza (sin decir que existe)', r.error === 'FAILED_PRECONDITION' && /no está disponible/.test(r.msg), r.msg);
r = await llamar('createAppointment', cli4, {
  businessId: BIZ, professionalId: 'martin', serviceId: 'corte', appointmentDate: enDias(7),
  startTime: '10:00', clientPhone: '1123456789', premioId: 'pOtraSucursal',
});
chequear('un premio de otra sucursal no existe acá', r.error === 'FAILED_PRECONDITION', r.msg);
r = await reservar(cli4, { serviceId: 'barba', premioId: 'pBarba', appointmentDate: enDias(8) });
chequear('el de barba sí paga la barba: $0', r.ok?.price === 0, JSON.stringify(r));
r = await reservar(cli3, { premioId: 'pGratis' });
chequear('corte gratis: total $0', r.ok?.price === 0, JSON.stringify(r));
const aptGratis = r.ok?.id;

console.log('\nRules — el turno con premio:');
await esperar('el staff NO le cambia el precio a un turno con premio', escribir(dueno, `businesses/${BIZ}/appointments/${aptP10}`, { price: 15000 }), 'denegado');
await esperar('el staff NO le cambia el servicio', escribir(dueno, `businesses/${BIZ}/appointments/${aptP10}`, { serviceId: 'barba' }), 'denegado');
await esperar('el staff NO le saca el premio', quitarCampo(dueno, `businesses/${BIZ}/appointments/${aptP10}`, 'premio'), 'denegado');
await esperar('el staff NO crea un turno con premio a mano', fetch(`${DOCS}/businesses/${BIZ}/appointments`, {
  method: 'POST', headers: cab(dueno),
  body: JSON.stringify(enc({ userId: dueno.uid, professionalId: 'martin', serviceId: 'corte', appointmentDate: enDias(9), startTime: '10:00', status: 'confirmada', price: 0, premio: { id: 'x' } })),
}), 'denegado');
await esperar('el staff NO crea un turno con happy hour a mano', fetch(`${DOCS}/businesses/${BIZ}/appointments`, {
  method: 'POST', headers: cab(dueno),
  body: JSON.stringify(enc({ userId: dueno.uid, professionalId: 'martin', serviceId: 'corte', appointmentDate: enDias(9), startTime: '10:00', status: 'confirmada', price: 0, happyHour: { porcentaje: 90 } })),
}), 'denegado');

// ── 4. El premio sigue al turno ─────────────────────────────────────────────
console.log('\nEl premio sigue al turno:');
await esperar('el cliente cancela su turno con premio', escribir(cli2, `businesses/${BIZ}/appointments/${aptP10}`, { status: 'cancelada', cancelledBy: 'client' }), 'permitido');
{
  const p = await hasta(() => premio('p10'), (x) => x?.estado === 'disponible');
  chequear('cancelado → el premio VUELVE a estar disponible', p?.estado === 'disponible' && p.appointmentId === null, JSON.stringify(p));
}
r = await reservar(cli2, { premioId: 'p10', appointmentDate: enDias(3) });
chequear('y se puede usar en otro turno', r.ok?.price === 13500, JSON.stringify(r));
const aptP10b = r.ok?.id;
await esperar('el barbero marca "vino" (cambiar el estado sí se puede)', escribir(barbero, `businesses/${BIZ}/appointments/${aptP10b}`, { status: 'completada' }), 'permitido');
{
  const p = await hasta(() => premio('p10'), (x) => x?.estado === 'usado');
  chequear('atendido → el premio se CONSUME', p?.estado === 'usado' && p.appointmentId === aptP10b, JSON.stringify(p));
  const c = await hasta(async () => (await db.doc(`businesses/${BIZ}/recompensas/ruleta`).get()).data(), (x) => x?.stats?.usados === 1);
  chequear('la campaña cuenta un premio usado', c?.stats?.usados === 1, JSON.stringify(c?.stats));
}
await escribir(barbero, `businesses/${BIZ}/appointments/${aptP10b}`, { status: 'confirmada' });
{
  const p = await hasta(() => premio('p10'), (x) => x?.estado === 'reservado');
  chequear('"vino" deshecho → el premio vuelve a reservado', p?.estado === 'reservado', JSON.stringify(p));
}
await escribir(barbero, `businesses/${BIZ}/appointments/${aptP10b}`, { status: 'completada' });
await hasta(() => premio('p10'), (x) => x?.estado === 'usado');
await escribir(dueno, `businesses/${BIZ}/appointments/${aptP10b}`, { status: 'cancelada' });
await new Promise((res) => setTimeout(res, 2500));
chequear('un turno ATENDIDO que después se cancela NO devuelve el premio', (await premio('p10'))?.estado === 'usado');
await escribir(dueno, `businesses/${BIZ}/appointments/${aptGratis}`, { status: 'no_asistio' });
chequear('"no vino" consume el premio (el horario quedó bloqueado)',
  (await hasta(() => premio('pGratis'), (x) => x?.estado === 'usado'))?.estado === 'usado');

// ── 5. Tarjeta de fidelidad ─────────────────────────────────────────────────
console.log('\nTarjeta de fidelidad:');
r = await campana('fidelidad', { casillas: 3, premio: { tipo: 'gratis', nombre: 'Corte gratis' }, reinicio: 'automatico', diasVencimiento: 60 });
chequear('el dueño activa la tarjeta de 3 casillas', r.ok?.activa === true, r.msg);

const turnoDelCliente = async (u, fecha, extra = {}) => {
  const ref = db.collection(`businesses/${BIZ}/appointments`).doc();
  await ref.set({
    id: ref.id, businessId: BIZ, userId: u.uid, professionalId: 'martin', serviceId: 'corte',
    appointmentDate: fecha, startTime: '10:00', endTime: '10:30', price: 15000, status: 'confirmada',
    origen: 'cliente', clientName: u.email, clientEmail: u.email, ...extra,
  });
  return ref.id;
};
const atender = (id) => escribir(barbero, `businesses/${BIZ}/appointments/${id}`, { status: 'completada' });
const sellos = async (u) => (await progreso(u.uid)).fidelidad?.sellos ?? 0;

const t1 = await turnoDelCliente(cli5, enDias(-20));
await atender(t1);
chequear('turno atendido → 1 sello', (await hasta(() => sellos(cli5), (n) => n === 1)) === 1);
await escribir(barbero, `businesses/${BIZ}/appointments/${t1}`, { status: 'no_asistio' });
chequear('el barbero se equivocó ("no vino") → se saca el sello', (await hasta(() => sellos(cli5), (n) => n === 0)) === 0);
await atender(t1);
chequear('lo vuelve a marcar "vino" → 1 sello, no 2', (await hasta(() => sellos(cli5), (n) => n === 1)) === 1);
await escribir(barbero, `businesses/${BIZ}/appointments/${t1}`, { notes: 'algo' });
await new Promise((res) => setTimeout(res, 1500));
chequear('editar otra cosa del turno no suma', (await sellos(cli5)) === 1);
const manual = await turnoDelCliente(cli5, enDias(-15), { origen: null, type: 'manual', userId: barbero.uid });
await atender(manual);
await new Promise((res) => setTimeout(res, 2000));
chequear('un turno cargado por el staff NO le suma sellos a nadie', (await sellos(cli5)) === 1 && !(await progreso(barbero.uid)).fidelidad);
await atender(await turnoDelCliente(cli5, enDias(-10)));
await hasta(() => sellos(cli5), (n) => n === 2);
await atender(await turnoDelCliente(cli5, enDias(-5)));
{
  const pr = await hasta(() => progreso(cli5.uid), (x) => x.fidelidad?.ciclo === 2);
  chequear('la tercera casilla completa la tarjeta y arranca otra (reinicio automático)', pr.fidelidad?.ciclo === 2 && pr.fidelidad.sellos === 0, JSON.stringify(pr.fidelidad));
  const p = await premio(`fid_${cli5.uid}_1`);
  chequear('se generó el premio de la tarjeta', p?.estado === 'disponible' && p.tipo === 'gratis' && p.campana === 'fidelidad', JSON.stringify(p));
}

console.log('\nTarjeta con reinicio manual:');
r = await campana('fidelidad', { casillas: 2, premio: { tipo: 'porcentaje', valor: 50 }, reinicio: 'manual' });
chequear('una tarjeta de 2 casillas se rechaza (mínimo 3)', r.error === 'INVALID_ARGUMENT', r.msg);
r = await campana('fidelidad', { casillas: 3, premio: { tipo: 'porcentaje', valor: 50 }, reinicio: 'manual' });
chequear('el dueño la pasa a 3 casillas con reinicio manual', r.ok?.config?.reinicio === 'manual', r.msg);
await atender(await turnoDelCliente(cli6, enDias(-9)));
await hasta(() => sellos(cli6), (n) => n === 1);
await atender(await turnoDelCliente(cli6, enDias(-8)));
await hasta(() => sellos(cli6), (n) => n === 2);
await atender(await turnoDelCliente(cli6, enDias(-7)));
{
  const pr = await hasta(() => progreso(cli6.uid), (x) => x.fidelidad?.completa === true);
  chequear('se completa y queda llena', pr.fidelidad?.completa === true && pr.fidelidad.sellos === 3);
}
await atender(await turnoDelCliente(cli6, enDias(-6)));
await new Promise((res) => setTimeout(res, 2000));
chequear('llena esperando reinicio: el turno siguiente no suma', (await sellos(cli6)) === 3);
r = await llamar('reiniciarTarjeta', cli6, { businessId: BIZ, userId: cli6.uid });
chequear('el cliente no se reinicia solo la tarjeta', r.error === 'PERMISSION_DENIED', r.msg);
r = await llamar('reiniciarTarjeta', dueno, { businessId: BIZ, userId: cli6.uid });
chequear('el dueño la reinicia', r.ok?.ok === true, r.msg);
{
  const f = (await progreso(cli6.uid)).fidelidad;
  chequear('tarjeta nueva: ciclo 2, 0 sellos', f.ciclo === 2 && f.sellos === 0 && f.completa === false, JSON.stringify(f));
}
r = await llamar('reiniciarTarjeta', dueno, { businessId: BIZ, userId: cli6.uid });
chequear('reiniciar una que no está llena se rechaza', r.error === 'FAILED_PRECONDITION', r.msg);

// ── 6. Rasca y ganá ─────────────────────────────────────────────────────────
console.log('\nRasca y ganá:');
await campana('rasca', { premios: [{ tipo: 'porcentaje', valor: 15, probabilidad: 100 }], diasVencimiento: 20 });
const tRasca = await turnoDelCliente(cli7, enDias(-3));
await atender(tRasca);
{
  const pr = await hasta(() => progreso(cli7.uid), (x) => (x.rascas || []).length === 1);
  chequear('turno atendido → una tarjeta para raspar', pr.rascas?.[0]?.ref === tRasca);
}
r = await llamar('jugarRecompensa', cli8, { businessId: BIZ, tipo: 'rasca', ref: tRasca });
chequear('otro cliente no raspa la tarjeta ajena', r.error === 'FAILED_PRECONDITION', r.msg);
r = await llamar('jugarRecompensa', cli7, { businessId: BIZ, tipo: 'rasca', ref: tRasca });
chequear('el cliente raspa y gana', r.ok?.gano === true && r.ok.premio?.nombre === '15% OFF', JSON.stringify(r));
r = await llamar('jugarRecompensa', cli7, { businessId: BIZ, tipo: 'rasca', ref: tRasca });
chequear('la misma tarjeta no se raspa dos veces', r.error === 'FAILED_PRECONDITION', r.msg);

// ── 7. Racha ────────────────────────────────────────────────────────────────
console.log('\nRacha:');
await campana('racha', { diasMax: 30, niveles: [{ racha: 2, premio: { tipo: 'porcentaje', valor: 25 } }] });
await atender(await turnoDelCliente(cli8, enDias(-40)));
await hasta(async () => (await progreso(cli8.uid)).racha?.actual, (n) => n === 1);
await atender(await turnoDelCliente(cli8, enDias(-25)));
{
  const pr = await hasta(() => progreso(cli8.uid), (x) => x.racha?.actual === 2);
  chequear('volvió a los 15 días: racha 2', pr.racha?.actual === 2);
  const ps = await hasta(async () => (await db.collection(`businesses/${BIZ}/premios`).where('userId', '==', cli8.uid).where('campana', '==', 'racha').get()).size, (n) => n === 1);
  chequear('racha 2 = nivel alcanzado: premio', ps === 1);
}
await atender(await turnoDelCliente(cli8, enDias(20)));
{
  const pr = await hasta(() => progreso(cli8.uid), (x) => x.racha?.ultimaFecha === enDias(20));
  chequear('tardó 45 días: la racha se corta y vuelve a 1', pr.racha?.actual === 1 && pr.racha.mejor === 2, JSON.stringify(pr.racha));
}

// ── 8. Happy hour ───────────────────────────────────────────────────────────
console.log('\nHappy hour:');
r = await campana('happyHour', { dias: [0, 1, 2, 3, 4, 5, 6], desde: '08:00', hasta: '22:00', porcentaje: 20, serviceIds: ['corte'] });
chequear('el dueño activa un happy hour de 20% en cortes', r.ok?.activa === true, r.msg);
r = await reservar(cli9);
chequear('reservar un corte dentro de la franja: $12.000 sin hacer nada', r.ok?.price === 12000 && r.ok.happyHour?.porcentaje === 20, JSON.stringify(r));
chequear('el turno lo dice', (await turno(r.ok?.id))?.happyHour?.descuento === 3000);
r = await reservar(cli9, { serviceId: 'barba', appointmentDate: enDias(3) });
chequear('un servicio fuera de la lista no tiene happy hour', r.ok?.price === 8000 && !r.ok.happyHour, JSON.stringify(r));
await ponerPremio('pHH', { userId: cli10.uid, tipo: 'porcentaje', valor: 10, nombre: '10%' });
r = await reservar(cli10, { premioId: 'pHH' });
chequear('con premio NO se acumula el happy hour (vale el premio)', r.ok?.price === 13500 && !r.ok.happyHour, JSON.stringify(r));
await llamar('guardarCampana', dueno, { businessId: BIZ, tipo: 'happyHour', activa: false });
r = await reservar(cli9, { appointmentDate: enDias(4) });
chequear('apagado: precio de lista', r.ok?.price === 15000 && !r.ok.happyHour, JSON.stringify(r));

// ── 9. Cumpleaños ───────────────────────────────────────────────────────────
console.log('\nCumpleaños:');
await campana('cumpleanos', { premio: { tipo: 'porcentaje', valor: 30, nombre: 'Regalo de cumple' }, diasAntes: 7, diasDespues: 15 });
r = await llamar('guardarCumpleanos', cli10, { businessId: BIZ, fecha: '02-31' });
chequear('una fecha que no existe se rechaza', r.error === 'INVALID_ARGUMENT', r.msg);
r = await llamar('guardarCumpleanos', cli10, { businessId: BIZ, fecha: hoyAR().slice(5) });
chequear('el cliente carga su cumpleaños (hoy)', r.ok?.ok === true, r.msg);
r = await llamar('guardarCumpleanos', cli10, { businessId: BIZ, fecha: '01-01' });
chequear('no se puede cambiar después (si no, cumpliría años cada mes)', r.error === 'ALREADY_EXISTS', r.msg);
r = await llamar('misRecompensas', cli10, { businessId: BIZ });
chequear('al abrir "Tus premios" aparece el regalo de cumpleaños', r.ok?.premios?.some((p) => p.campana === 'cumpleanos' && p.estado === 'disponible'), JSON.stringify(r.ok?.premios));
r = await llamar('misRecompensas', cli10, { businessId: BIZ });
chequear('abrirlo de nuevo no genera un segundo regalo', r.ok?.premios?.filter((p) => p.campana === 'cumpleanos').length === 1);

// ── 10. Mis recompensas, vencidos y campañas apagadas ──────────────────────
console.log('\nMis recompensas:');
r = await llamar('misRecompensas', cli4, { businessId: BIZ });
chequear('el premio vencido se informa como vencido', r.ok?.premios?.find((p) => p.id === 'pVencido')?.estado === 'vencido');
chequear('…y queda escrito como vencido', (await premio('pVencido'))?.estado === 'vencido');
chequear('no muestra premios de otra sucursal', !r.ok?.premios?.some((p) => p.id === 'pOtraSucursal'));
r = await llamar('misRecompensas', cli5, { businessId: BIZ });
chequear('la tarjeta viene con sus sellos y casillas', r.ok?.fidelidad && typeof r.ok.fidelidad.sellos === 'number');
chequear('la ruleta: puede jugar (nunca jugó)', r.ok?.puede?.ruleta === true);
r = await llamar('misRecompensas', cli, { businessId: BIZ });
chequear('el que ya jugó la ruleta no puede, y sabe desde cuándo', r.ok?.puede?.ruleta === false && r.ok.puede.ruletaProxima === enDias(30), JSON.stringify(r.ok?.puede));

await llamar('guardarCampana', dueno, { businessId: BIZ, tipo: 'ruleta', activa: false });
r = await llamar('jugarRecompensa', cli2, { businessId: BIZ, tipo: 'ruleta' });
chequear('ruleta apagada: no se juega más', r.error === 'FAILED_PRECONDITION', r.msg);
r = await reservar(cli, { premioId: idRuleta, appointmentDate: enDias(5) });
chequear('…pero el premio que ya ganó sigue valiendo', typeof r.ok?.price === 'number' && r.ok.price < 15000, JSON.stringify(r));

console.log(`\n${pasaron} pasaron, ${fallaron} fallaron.`);
if (fallaron) {
  console.log('\nFallaron:\n  - ' + fallas.join('\n  - '));
  process.exit(1);
}
process.exit(0);
