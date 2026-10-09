// Membresías: planes mensuales, uso al reservar, auditoría y Mercado Pago.
//
// Lo que más importa probar acá no es que "ande": es que NADIE salvo el
// servidor pueda decir que un cliente usó su plan. Y que Mercado Pago, que
// avisa repetido y desordenado, no pueda abrir dos meses con el mismo cobro.
//
// Mercado Pago se reemplaza por un servidor falso en el puerto 5199. Para que
// las Functions del emulador le hablen a ese y no al de verdad:
//
//   echo MP_API_URL=http://127.0.0.1:5199 > functions/.env.local
//   firebase emulators:start --only auth,firestore,functions
//   node scripts/test-membresias-emulador.mjs
//
// (`functions/.env.local` está en .gitignore y el código solo lo mira con
// FUNCTIONS_EMULATOR=true: en producción no hay forma de desviar la API.)
import http from 'node:http';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
const PROJECT = 'barberos-1d60e';
initializeApp({ projectId: PROJECT });
const db = getFirestore(), auth = getAuth();

const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const FN = `http://127.0.0.1:5001/${PROJECT}/southamerica-east1`;
const DOCS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;

const CUENTA = 'biz-memb';       // principal
const SUC = 'biz-memb-2';        // sucursal de la misma cuenta
const OTRA = 'biz-memb-otra';    // otra barbería, otra cuenta
const MP_USER = '999';

let ok = 0, mal = 0;
const chequear = (t, c, d = '') => {
  if (c) { ok++; console.log('  ok   ', t); }
  else { mal++; console.log('  FALLA', t, '\n         ', typeof d === 'string' ? d : JSON.stringify(d)); }
};
const titulo = (t) => console.log(`\n── ${t}`);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Fechas ─────────────────────────────────────────────────────────────────
const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
const dia = (n) => { const d = new Date(`${hoy}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// ── Mercado Pago falso ─────────────────────────────────────────────────────
const mp = { preapprovals: {}, cobros: {}, pagos: {}, puts: [] };
const servidorMP = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const responder = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  let cuerpo = '';
  req.on('data', (c) => { cuerpo += c; });
  req.on('end', () => {
    const p = url.pathname;
    if (req.headers.authorization !== 'Bearer TOKEN-MEMB') return responder(401, { message: 'token' });
    if (p === '/preapproval/search') {
      const email = url.searchParams.get('payer_email');
      return responder(200, { results: Object.values(mp.preapprovals).filter((x) => !email || x.payer_email === email) });
    }
    let m = p.match(/^\/preapproval\/([^/]+)$/);
    if (m) {
      const pre = mp.preapprovals[m[1]];
      if (!pre) return responder(404, { message: 'not found' });
      if (req.method === 'PUT') {
        const datos = JSON.parse(cuerpo || '{}');
        mp.puts.push({ id: m[1], ...datos });
        Object.assign(pre, datos, { last_modified: new Date().toISOString() });
      }
      return responder(200, pre);
    }
    if (p === '/authorized_payments/search') {
      const id = url.searchParams.get('preapproval_id');
      return responder(200, { results: Object.values(mp.cobros).filter((c) => c.preapproval_id === id) });
    }
    m = p.match(/^\/authorized_payments\/([^/]+)$/);
    if (m) return mp.cobros[m[1]] ? responder(200, mp.cobros[m[1]]) : responder(404, { message: 'not found' });
    m = p.match(/^\/v1\/payments\/([^/]+)$/);
    if (m) return mp.pagos[m[1]] ? responder(200, mp.pagos[m[1]]) : responder(404, { message: 'not found' });
    responder(404, { message: `sin ruta ${p}` });
  });
});
await new Promise((r) => servidorMP.listen(5199, '127.0.0.1', r));

// ── Escenario ──────────────────────────────────────────────────────────────
async function vaciar(ruta) {
  for (const d of (await db.collection(ruta).get()).docs) {
    for (const sub of await d.ref.listCollections()) await vaciar(sub.path);
    await d.ref.delete();
  }
}
for (const b of [CUENTA, SUC, OTRA]) {
  for (const c of ['appointments', 'schedules', 'services', 'professionals', 'professionalServices',
    'membresiaPlanes', 'membresias', 'membresiaUsos', 'membresiaPagos', 'notifications', 'private']) {
    await vaciar(`businesses/${b}/${c}`);
  }
}
await vaciar('mpSuscripciones');
await vaciar('mpPagos');

const horario = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startTime: '09:00', endTime: '20:00', isActive: true }));
async function barberia(id, extra) {
  await db.doc(`businesses/${id}`).set({ name: id, slug: id, isFrozen: false, businessHours: horario, ...extra });
}
await barberia(CUENTA, { grupoId: CUENTA, mpConectado: true, mpUserId: MP_USER, membresiasHabilitadas: true });
await barberia(SUC, { grupoId: CUENTA });
await barberia(OTRA, {});
await db.doc(`grupos/${CUENTA}`).set({ principalId: CUENTA, businessIds: [CUENTA, SUC] });
await db.doc(`businesses/${CUENTA}/private/mercadopago`).set({
  accessToken: 'TOKEN-MEMB', refreshToken: 'r', expiraEn: new Date(Date.now() + 90 * 86400000),
});

async function equipo(biz, prof, servicios) {
  await db.doc(`businesses/${biz}/professionals/${prof}`).set({ id: prof, name: prof, isActive: true });
  for (const [srv, nombre, precio] of servicios) {
    await db.doc(`businesses/${biz}/services/${srv}`).set({ id: srv, name: nombre, price: precio, durationMinutes: 30, isActive: true });
    await db.doc(`businesses/${biz}/professionalServices/${prof}-${srv}`).set({ professionalId: prof, serviceId: srv });
  }
  for (const h of horario) {
    await db.doc(`businesses/${biz}/schedules/${prof}-${h.dayOfWeek}`).set({ professionalId: prof, ...h });
  }
}
await equipo(CUENTA, 'prof-1', [['srv-corte', 'Corte', 12000], ['srv-barba', 'Barba', 8000]]);
await equipo(SUC, 'prof-2', [['srv-corte2', 'Corte', 13000]]);
await equipo(OTRA, 'prof-x', [['srv-x', 'Corte', 9000]]);

// ── Usuarios ───────────────────────────────────────────────────────────────
async function cuenta(email, claims = null, { verificado = true, crear = true } = {}) {
  try { await auth.deleteUser((await auth.getUserByEmail(email)).uid); } catch { /* no existía */ }
  if (!crear) return null;
  const u = await auth.createUser({ email, emailVerified: verificado });
  if (claims) await auth.setCustomUserClaims(u.uid, claims);
  const r = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: await auth.createCustomToken(u.uid), returnSecureToken: true }),
  });
  return { uid: u.uid, email, token: (await r.json()).idToken };
}

const dueno = await cuenta('dueno@memb.test', { businessId: CUENTA, role: 'owner', grupoId: CUENTA, businessIds: [CUENTA, SUC] });
const barbero = await cuenta('barbero@memb.test', { businessId: CUENTA, role: 'admin', professionalId: 'prof-1' });
const otroDueno = await cuenta('otro@memb.test', { businessId: OTRA, role: 'owner' });
const plataforma = await cuenta('plat@memb.test', { platform: true });
const ana = await cuenta('ana@memb.test');
const dani = await cuenta('dani@memb.test');
await cuenta('beto@memb.test', null, { crear: false }); // Beto todavía no entró nunca

async function llamar(nombre, u, data = {}) {
  const r = await fetch(`${FN}/${nombre}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(u ? { Authorization: `Bearer ${u.token}` } : {}) },
    body: JSON.stringify({ data }),
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, http: r.status, data: j.result, error: j.error?.status, mensaje: j.error?.message };
}

let hora = 9;
const reservar = (u, biz, prof, srv, fecha, extra = {}) => llamar('createAppointment', u, {
  businessId: biz, professionalId: prof, serviceId: srv, appointmentDate: fecha,
  startTime: `${String(hora++ % 11 + 9).padStart(2, '0')}:00`,
  clientName: 'Cliente', clientPhone: '1123456789', ...extra,
});

const val = (v) => v === null ? { nullValue: null }
  : typeof v === 'boolean' ? { booleanValue: v }
  : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
  : typeof v === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, val(x)])) } }
  : { stringValue: String(v) };
const cab = (u) => ({ 'Content-Type': 'application/json', ...(u ? { Authorization: `Bearer ${u.token}` } : {}) });
const leerREST = (u, ruta) => fetch(`${DOCS}/${ruta}`, { headers: cab(u) });
const editarREST = (u, ruta, datos) => fetch(
  `${DOCS}/${ruta}?${Object.keys(datos).map((k) => `updateMask.fieldPaths=${k}`).join('&')}`,
  { method: 'PATCH', headers: cab(u), body: JSON.stringify({ fields: Object.fromEntries(Object.entries(datos).map(([k, v]) => [k, val(v)])) }) },
);
const crearREST = (u, ruta, datos) => fetch(`${DOCS}/${ruta}`, {
  method: 'POST', headers: cab(u),
  body: JSON.stringify({ fields: Object.fromEntries(Object.entries(datos).map(([k, v]) => [k, val(v)])) }),
});
const listarREST = (u, padre, coleccion) => fetch(`${DOCS}/${padre}:runQuery`, {
  method: 'POST', headers: cab(u), body: JSON.stringify({ structuredQuery: { from: [{ collectionId: coleccion }] } }),
});

/** Espera a que un trigger termine: reintenta la condición hasta 8 s. */
async function cuando(fn) {
  for (let i = 0; i < 40; i++) {
    const r = await fn();
    if (r) return r;
    await dormir(200);
  }
  return fn();
}

const webhook = (query, cuerpo) => fetch(`${FN}/webhookMercadoPago?${new URLSearchParams(query)}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo || {}),
});

const membresia = (id) => db.doc(`businesses/${CUENTA}/membresias/${id}`).get().then((s) => s.data());
const periodos = (id) => db.collection(`businesses/${CUENTA}/membresias/${id}/periodos`).get().then((q) => q.docs.map((d) => d.data()));
const uso = (aptId) => db.doc(`businesses/${CUENTA}/membresiaUsos/${aptId}`).get().then((s) => (s.exists ? s.data() : null));
const usadosDe = async (id) => {
  const m = await membresia(id);
  return (await db.doc(`businesses/${CUENTA}/membresias/${id}/periodos/${m.periodoActual.id}`).get()).data().usados;
};

// ════════════════════════════════════════════════════════════════════════════
titulo('Planes');

let r = await llamar('guardarPlanMembresia', barbero, {
  businessId: CUENTA, nombre: 'Trucho', precioMensual: 1, beneficios: [{ nombre: 'Corte', usos: 99, servicios: [{ businessId: CUENTA, serviceId: 'srv-corte' }] }],
});
chequear('el barbero no crea planes', r.error === 'PERMISSION_DENIED', r);

r = await llamar('guardarPlanMembresia', otroDueno, {
  businessId: CUENTA, nombre: 'Ajeno', precioMensual: 1, beneficios: [{ nombre: 'Corte', servicios: [{ businessId: CUENTA, serviceId: 'srv-corte' }] }],
});
chequear('el dueño de otra barbería no crea planes en esta', r.error === 'PERMISSION_DENIED', r);

r = await llamar('guardarPlanMembresia', dueno, {
  businessId: CUENTA, nombre: 'Con servicio ajeno', precioMensual: 1000,
  beneficios: [{ nombre: 'Corte', servicios: [{ businessId: OTRA, serviceId: 'srv-x' }] }],
});
chequear('un plan no puede incluir el servicio de otra barbería', r.error === 'PERMISSION_DENIED', r);

r = await llamar('guardarPlanMembresia', otroDueno, {
  businessId: OTRA, nombre: 'Sin habilitar', precioMensual: 1000, beneficios: [{ nombre: 'Corte', servicios: [{ businessId: OTRA, serviceId: 'srv-x' }] }],
});
chequear('una cuenta sin membresías habilitadas no puede crear planes', r.error === 'FAILED_PRECONDITION' && /no están habilitadas/.test(r.mensaje), r);
let rh = await editarREST(otroDueno, `businesses/${OTRA}`, { membresiasHabilitadas: true });
chequear('el dueño no se las habilita solo', rh.status === 403, rh.status);

r = await llamar('guardarPlanMembresia', dueno, { businessId: CUENTA, nombre: 'Gratis', precioMensual: 0, beneficios: [] });
chequear('precio en cero se rechaza', r.error === 'INVALID_ARGUMENT', r);

r = await llamar('guardarPlanMembresia', dueno, {
  businessId: CUENTA, nombre: 'Corte Mensual', precioMensual: 25000,
  // El corte de las dos sucursales comparte el cupo: 2 por mes en cualquiera.
  beneficios: [{ id: 'cortes', nombre: 'Corte', usos: 2, servicios: [
    { businessId: CUENTA, serviceId: 'srv-corte' }, { businessId: SUC, serviceId: 'srv-corte2' },
  ] }],
});
chequear('el dueño crea un plan con el corte de las dos sucursales', r.ok && r.data.id, r);
const PLAN = r.data?.id;

r = await llamar('guardarPlanMembresia', dueno, {
  // Desde la SUCURSAL: el plan igual va a la principal (es de la cuenta).
  businessId: SUC, nombre: 'Premium', precioMensual: 40000, beneficios: [
    { id: 'cortes', nombre: 'Corte', usos: null, servicios: [{ businessId: CUENTA, serviceId: 'srv-corte' }, { businessId: SUC, serviceId: 'srv-corte2' }] },
    { id: 'barba', nombre: 'Barba', usos: 4, servicios: [{ businessId: CUENTA, serviceId: 'srv-barba' }] },
  ],
});
chequear('el plan creado desde una sucursal queda en la principal', r.ok && r.data.cuentaId === CUENTA, r);
const PREMIUM = r.data?.id;

// ════════════════════════════════════════════════════════════════════════════
titulo('Cargar membresías');

r = await llamar('cargarMembresia', barbero, { businessId: CUENTA, planId: PLAN, clienteEmail: ana.email, clienteNombre: 'Ana' });
chequear('el barbero no carga membresías', r.error === 'PERMISSION_DENIED', r);

r = await llamar('cargarMembresia', ana, { businessId: CUENTA, planId: PLAN, clienteEmail: ana.email, clienteNombre: 'Ana' });
chequear('un cliente no se carga su propia membresía', r.error === 'PERMISSION_DENIED', r);

r = await llamar('cargarMembresia', otroDueno, { businessId: CUENTA, planId: PLAN, clienteEmail: ana.email, clienteNombre: 'Ana' });
chequear('el dueño de otra barbería no carga en esta', r.error === 'PERMISSION_DENIED', r);

r = await llamar('cargarMembresia', dueno, {
  businessId: CUENTA, planId: PLAN, clienteEmail: ' ANA@memb.test ', clienteNombre: 'Ana', desde: hoy, hasta: dia(25),
});
chequear('el dueño carga la membresía manual de Ana (mail normalizado)', r.ok && r.data.estado === 'activa' && r.data.atada === true, r);
const M_ANA = r.data?.id;

r = await llamar('cargarMembresia', dueno, { businessId: CUENTA, planId: PLAN, clienteEmail: ana.email, clienteNombre: 'Ana' });
chequear('una segunda membresía viva para el mismo cliente se rechaza', r.error === 'ALREADY_EXISTS', r);

r = await llamar('cargarMembresia', dueno, { businessId: CUENTA, planId: PLAN, clienteEmail: 'x@memb.test', clienteNombre: 'X', desde: dia(-60), hasta: dia(-30) });
chequear('no se carga un mes que ya terminó', r.error === 'INVALID_ARGUMENT', r);

// Suscripciones de MP que "ya existen" en la cuenta del barbero.
mp.preapprovals['pre-beto'] = {
  id: 'pre-beto', status: 'authorized', collector_id: Number(MP_USER), payer_email: 'beto.mp@gmail.com', reason: 'Corte Mensual',
  auto_recurring: { transaction_amount: 25000 }, next_payment_date: `${dia(20)}T10:00:00.000-03:00`,
  date_created: '2026-01-01T10:00:00.000-03:00', last_modified: '2026-01-01T10:00:00.000-03:00',
};
mp.preapprovals['pre-ajena'] = { ...mp.preapprovals['pre-beto'], id: 'pre-ajena', collector_id: 123 };

r = await llamar('buscarSuscripcionesMP', dueno, { businessId: CUENTA, payerEmail: 'beto.mp@gmail.com' });
chequear('el dueño busca las suscripciones de su cuenta de MP por mail', r.ok && r.data.suscripciones.some((s) => s.id === 'pre-beto'), r);
r = await llamar('buscarSuscripcionesMP', barbero, { businessId: CUENTA });
chequear('el barbero no puede listar las suscripciones de MP', r.error === 'PERMISSION_DENIED', r);

r = await llamar('cargarMembresia', dueno, {
  businessId: CUENTA, planId: PLAN, clienteEmail: 'beto@memb.test', clienteNombre: 'Beto', preapprovalId: 'pre-ajena', desde: hoy,
});
chequear('una suscripción de OTRA cuenta de MP no se vincula', r.error === 'PERMISSION_DENIED', r);

r = await llamar('cargarMembresia', dueno, {
  businessId: CUENTA, planId: PLAN, clienteEmail: 'beto@memb.test', clienteNombre: 'Beto', preapprovalId: 'pre-beto', desde: hoy,
});
chequear('Beto (que nunca entró) queda cargado y vinculado a MP, sin atar', r.ok && r.data.atada === false && r.data.estado === 'activa', r);
const M_BETO = r.data?.id;

r = await llamar('cargarMembresia', dueno, {
  businessId: CUENTA, planId: PLAN, clienteEmail: 'otro@cliente.test', clienteNombre: 'Otro', preapprovalId: 'pre-beto',
});
chequear('la misma suscripción de MP no se vincula a dos membresías', r.error === 'ALREADY_EXISTS', r);

// ════════════════════════════════════════════════════════════════════════════
titulo('Reservar usando la membresía');

r = await reservar(ana, CUENTA, 'prof-1', 'srv-corte', dia(1), { usarMembresia: true });
chequear('Ana reserva un corte con la membresía', r.ok && r.data.price === 0 && r.data.membresia?.membresiaId === M_ANA, r);
const T1 = r.data?.id;
let t = (await db.doc(`businesses/${CUENTA}/appointments/${T1}`).get()).data();
chequear('el turno guarda precio 0, el de lista y el snapshot', t?.price === 0 && t?.precioLista === 12000 && t?.membresia?.valorServicio === 12000, t);
let u = await uso(T1);
chequear('queda el uso con su auditoría (quién, cuándo, origen)', u?.estado === 'reservado' && u.origen === 'reserva'
  && u.registradoPor?.uid === ana.uid && u.professionalId === 'prof-1' && u.sucursalId === CUENTA, u);
chequear('el mes de Ana tiene 1 uso', (await usadosDe(M_ANA)) === 1);

r = await reservar(ana, CUENTA, 'prof-1', 'srv-barba', dia(2), { usarMembresia: true });
chequear('un servicio que el plan no incluye se rechaza con el motivo', r.error === 'FAILED_PRECONDITION' && /no incluye/.test(r.mensaje), r);

r = await reservar(ana, CUENTA, 'prof-1', 'srv-corte', dia(40), { usarMembresia: true });
chequear('un turno después del mes pago no usa la membresía', r.error === 'FAILED_PRECONDITION' && /hasta el/.test(r.mensaje), r);

r = await reservar(ana, SUC, 'prof-2', 'srv-corte2', dia(3), { usarMembresia: true });
chequear('Ana usa la membresía en la otra sucursal (mismo cupo)', r.ok && r.data.price === 0, r);
const T2 = r.data?.id;
chequear('el mes de Ana tiene 2 usos (sumó la sucursal)', (await usadosDe(M_ANA)) === 2);

r = await reservar(ana, CUENTA, 'prof-1', 'srv-corte', dia(4), { usarMembresia: true });
chequear('con el cupo lleno: "No quedan usos disponibles este mes."', r.error === 'FAILED_PRECONDITION' && /No quedan usos/.test(r.mensaje), r);

r = await reservar(dani, CUENTA, 'prof-1', 'srv-corte', dia(5), { usarMembresia: true });
chequear('sin membresía: rechazo claro', r.error === 'FAILED_PRECONDITION' && /No tenés una membresía/.test(r.mensaje), r);

r = await reservar(dani, OTRA, 'prof-x', 'srv-x', dia(5), { usarMembresia: true });
chequear('la membresía de una cuenta no sirve en otra barbería', r.error === 'FAILED_PRECONDITION', r);

r = await reservar(ana, CUENTA, 'prof-1', 'srv-barba', dia(6));
chequear('sin marcar la membresía, la reserva es normal y se cobra', r.ok && r.data.price === 8000 && !r.data.membresia, r);
const T_NORMAL_ANA = r.data?.id;

// ── Cancelar libera ────────────────────────────────────────────────────────
titulo('Cancelar, atender, faltar');

let rr = await editarREST(ana, `businesses/${CUENTA}/appointments/${T1}`, { status: 'cancelada', cancelledBy: 'client' });
chequear('Ana cancela su turno', rr.ok, await rr.text());
u = await cuando(async () => { const x = await uso(T1); return x?.estado === 'liberado' ? x : null; });
chequear('cancelar antes del turno libera el uso', u?.estado === 'liberado', u);
chequear('…y el mes vuelve a 1 uso', (await usadosDe(M_ANA)) === 1);
t = (await db.doc(`businesses/${CUENTA}/appointments/${T1}`).get()).data();
chequear('…y el turno lo refleja', t.membresia.estado === 'liberado', t.membresia);

// ── Dos reservas a la vez por el último uso ────────────────────────────────
const [c1, c2] = await Promise.all([
  reservar(ana, CUENTA, 'prof-1', 'srv-corte', dia(7), { usarMembresia: true }),
  reservar(ana, CUENTA, 'prof-1', 'srv-corte', dia(8), { usarMembresia: true }),
]);
const ganadoras = [c1, c2].filter((x) => x.ok);
chequear('dos reservas simultáneas por el último uso: pasa UNA', ganadoras.length === 1, [c1, c2]);
chequear('…y el mes queda en 2, no en 3', (await usadosDe(M_ANA)) === 2);
const T3 = ganadoras[0]?.data?.id;

// ── Atender / no-show consumen ─────────────────────────────────────────────
rr = await editarREST(barbero, `businesses/${CUENTA}/appointments/${T3}`, { status: 'completada' });
chequear('el barbero marca atendido su turno', rr.ok, await rr.text());
u = await cuando(async () => { const x = await uso(T3); return x?.estado === 'consumido' ? x : null; });
chequear('atendido → el uso se consume', u?.estado === 'consumido', u);

rr = await editarREST(barbero, `businesses/${CUENTA}/appointments/${T3}`, { status: 'cancelada' });
chequear('el barbero puede cambiar el estado de un turno ya atendido…', rr.ok);
u = await cuando(async () => { const x = await uso(T3); return x?.requiereRevision ? x : null; });
chequear('…pero eso NO devuelve el uso: queda marcado para revisar', u?.estado === 'consumido' && /completada/.test(u.requiereRevision || ''), u);
chequear('…y el mes sigue en 2', (await usadosDe(M_ANA)) === 2);

rr = await editarREST(dueno, `businesses/${SUC}/appointments/${T2}`, { status: 'no_asistio' });
chequear('el dueño marca "no vino" en la sucursal', rr.ok, await rr.text());
u = await cuando(async () => { const x = await uso(T2); return x?.estado === 'consumido' ? x : null; });
chequear('no-show → el uso se consume', u?.estado === 'consumido' && u.eventos.some((e) => /no asistió/.test(e.motivo || '')), u);

// ════════════════════════════════════════════════════════════════════════════
titulo('Rules: nadie toca la membresía desde el browser');

// Turno normal del barbero para probarle las reglas.
r = await reservar(dani, CUENTA, 'prof-1', 'srv-corte', dia(9));
const T_DANI = r.data?.id;

rr = await editarREST(barbero, `businesses/${CUENTA}/appointments/${T_DANI}`, {
  membresia: { membresiaId: M_ANA, usoId: T_DANI, estado: 'reservado', valorServicio: 12000 }, price: 0,
});
chequear('el barbero NO puede marcar un turno como "con membresía"', rr.status === 403, rr.status);

rr = await editarREST(dueno, `businesses/${CUENTA}/appointments/${T_DANI}`, { membresia: { membresiaId: M_ANA } });
chequear('el dueño tampoco, escribiendo directo (tiene que ir por la function)', rr.status === 403, rr.status);

rr = await crearREST(barbero, `businesses/${CUENTA}/appointments`, {
  userId: barbero.uid, professionalId: 'prof-1', serviceId: 'srv-corte', appointmentDate: dia(10), startTime: '10:00',
  status: 'pendiente', price: 0, type: 'manual', membresia: { membresiaId: M_ANA },
});
chequear('el staff no puede crear un turno que ya venga "con membresía"', rr.status === 403, rr.status);

// Turno con membresía vivo, de prof-1, para probar qué se puede tocar.
await db.doc(`businesses/${CUENTA}/membresias/${M_ANA}/periodos/inicial-${hoy}`).update({ usados: 0, usadosPorBeneficio: {} });
r = await reservar(ana, CUENTA, 'prof-1', 'srv-corte', dia(11), { usarMembresia: true });
const T4 = r.data?.id;
chequear('(Ana reserva otro con membresía)', r.ok, r);

rr = await editarREST(barbero, `businesses/${CUENTA}/appointments/${T4}`, { serviceId: 'srv-barba' });
chequear('al turno con membresía no se le cambia el servicio', rr.status === 403, rr.status);
rr = await editarREST(barbero, `businesses/${CUENTA}/appointments/${T4}`, { price: 12000 });
chequear('…ni el precio', rr.status === 403, rr.status);
rr = await editarREST(barbero, `businesses/${CUENTA}/appointments/${T4}`, { 'membresia.estado': 'liberado' });
chequear('…ni el estado del beneficio', rr.status === 403, rr.status);
rr = await editarREST(barbero, `businesses/${CUENTA}/appointments/${T4}`, { status: 'confirmada' });
chequear('…pero sí confirmarlo', rr.ok, rr.status);

rr = await editarREST(barbero, `businesses/${CUENTA}/membresias/${M_ANA}`, { estado: 'activa' });
chequear('el barbero no escribe membresías', rr.status === 403, rr.status);
rr = await editarREST(dueno, `businesses/${CUENTA}/membresias/${M_ANA}`, { estado: 'activa' });
chequear('el dueño tampoco, directo', rr.status === 403, rr.status);
rr = await editarREST(ana, `businesses/${CUENTA}/membresias/${M_ANA}`, { estado: 'activa' });
chequear('el cliente no toca su propia membresía', rr.status === 403, rr.status);
rr = await editarREST(dueno, `businesses/${CUENTA}/membresiaUsos/${T4}`, { estado: 'liberado' });
chequear('nadie modifica un uso después (ni el dueño)', rr.status === 403, rr.status);
rr = await crearREST(barbero, `businesses/${CUENTA}/membresiaUsos`, { membresiaId: M_ANA, estado: 'consumido' });
chequear('el barbero no inventa usos', rr.status === 403, rr.status);
rr = await editarREST(dueno, `businesses/${CUENTA}/membresiaPlanes/${PLAN}`, { precioMensual: 1 });
chequear('los planes se editan solo por la function', rr.status === 403, rr.status);

rr = await leerREST(ana, `businesses/${CUENTA}/membresias/${M_ANA}`);
chequear('Ana lee su membresía', rr.ok, rr.status);
rr = await leerREST(dani, `businesses/${CUENTA}/membresias/${M_ANA}`);
chequear('otro cliente no lee la de Ana', rr.status === 403, rr.status);
rr = await leerREST(barbero, `businesses/${CUENTA}/membresias/${M_ANA}`);
chequear('el barbero no lee membresías', rr.status === 403, rr.status);
rr = await listarREST(barbero, `businesses/${CUENTA}`, 'membresiaUsos');
chequear('el barbero no lista la auditoría', rr.status === 403, rr.status);
rr = await listarREST(dueno, `businesses/${CUENTA}`, 'membresiaUsos');
chequear('el dueño lista la auditoría', rr.ok, rr.status);
rr = await listarREST(otroDueno, `businesses/${CUENTA}`, 'membresias');
chequear('el dueño de otra barbería no lista estas membresías', rr.status === 403, rr.status);
rr = await listarREST(dueno, `businesses/${CUENTA}`, 'membresiaPagos');
chequear('el dueño ve los cobros de membresías', rr.ok, rr.status);
rr = await listarREST(barbero, `businesses/${CUENTA}`, 'membresiaPagos');
chequear('el barbero no', rr.status === 403, rr.status);
rr = await leerREST(dueno, 'mpSuscripciones/pre-beto');
chequear('el índice de suscripciones no lo lee nadie', rr.status === 403, rr.status);
rr = await leerREST(null, `businesses/${CUENTA}/membresiaPlanes/${PLAN}`);
chequear('los planes son públicos (se muestran en el link)', rr.ok, rr.status);

// ════════════════════════════════════════════════════════════════════════════
titulo('Reprogramación');

rr = await editarREST(barbero, `businesses/${CUENTA}/appointments/${T4}`, { appointmentDate: dia(12) });
chequear('el barbero mueve el turno con membresía a otro día', rr.ok, rr.status);
u = await cuando(async () => { const x = await uso(T4); return x?.appointmentDate === dia(12) ? x : null; });
chequear('el uso sigue atado al mismo turno, con la fecha nueva (no se duplica)', u?.estado === 'reservado' && !u.requiereRevision, u);
chequear('…y el mes sigue contando 1', (await usadosDe(M_ANA)) === 1);
rr = await editarREST(barbero, `businesses/${CUENTA}/appointments/${T4}`, { appointmentDate: dia(60) });
u = await cuando(async () => { const x = await uso(T4); return x?.requiereRevision ? x : null; });
chequear('moverlo fuera del mes pago lo marca para revisar', /fuera del mes/.test(u?.requiereRevision || ''), u);

// ════════════════════════════════════════════════════════════════════════════
titulo('El dueño aplica y revierte');

// Turno cargado por el staff (sin cuenta de cliente).
rr = await crearREST(barbero, `businesses/${CUENTA}/appointments`, {
  userId: barbero.uid, professionalId: 'prof-1', serviceId: 'srv-corte', serviceName: 'Corte',
  appointmentDate: dia(13), startTime: '15:00', endTime: '15:30', status: 'pendiente', price: 12000, type: 'manual', clientName: 'Ana',
});
const T_MANUAL = (await rr.json()).name?.split('/').pop();
chequear('(el barbero carga un turno a mano)', Boolean(T_MANUAL));

r = await llamar('aplicarMembresia', barbero, { businessId: CUENTA, appointmentId: T_MANUAL, membresiaId: M_ANA, motivo: 'vino Ana' });
chequear('el barbero NO puede aplicar una membresía', r.error === 'PERMISSION_DENIED', r);
r = await llamar('aplicarMembresia', dueno, { businessId: CUENTA, appointmentId: T_MANUAL, membresiaId: M_ANA, motivo: '' });
chequear('el dueño tiene que poner el motivo', r.error === 'INVALID_ARGUMENT', r);
r = await llamar('aplicarMembresia', dueno, { businessId: CUENTA, appointmentId: T_MANUAL, membresiaId: M_ANA, motivo: 'Turno por WhatsApp' });
chequear('el dueño aplica la membresía de Ana al turno cargado a mano', r.ok && r.data.membresia.origen === 'dueno', r);
t = (await db.doc(`businesses/${CUENTA}/appointments/${T_MANUAL}`).get()).data();
u = await uso(T_MANUAL);
chequear('el turno pasa a precio 0 y el uso registra al dueño y el motivo', t.price === 0 && u.registradoPor.uid === dueno.uid && u.motivo === 'Turno por WhatsApp', { t, u });
r = await llamar('aplicarMembresia', dueno, { businessId: CUENTA, appointmentId: T_MANUAL, membresiaId: M_ANA, motivo: 'de nuevo' });
chequear('no se aplica dos veces al mismo turno', r.error === 'ALREADY_EXISTS', r);

r = await llamar('aplicarMembresia', dueno, { businessId: CUENTA, appointmentId: T_DANI, membresiaId: M_ANA, motivo: 'probando' });
chequear('el turno que reservó Dani con su cuenta no se carga a la membresía de Ana', r.error === 'PERMISSION_DENIED', r);

r = await llamar('revertirUsoMembresia', barbero, { businessId: CUENTA, appointmentId: T_MANUAL, motivo: 'x' });
chequear('el barbero no revierte usos', r.error === 'PERMISSION_DENIED', r);
const antes = await usadosDe(M_ANA);
r = await llamar('revertirUsoMembresia', dueno, { businessId: CUENTA, appointmentId: T_MANUAL, motivo: 'Pagó en efectivo' });
t = (await db.doc(`businesses/${CUENTA}/appointments/${T_MANUAL}`).get()).data();
chequear('el dueño revierte: el turno vuelve a cobrarse y el uso vuelve al cupo',
  r.ok && t.price === 12000 && t.membresia.estado === 'revertido' && (await usadosDe(M_ANA)) === antes - 1, { r, t });
r = await llamar('revertirUsoMembresia', dueno, { businessId: CUENTA, appointmentId: T_MANUAL, motivo: 'otra vez' });
chequear('revertir dos veces no descuenta dos veces', r.error === 'FAILED_PRECONDITION', r);
u = await uso(T_MANUAL);
chequear('la auditoría conserva aplicado → revertido con motivo', u.eventos.length >= 2 && u.eventos.at(-1).motivo === 'Pagó en efectivo', u.eventos);

// ════════════════════════════════════════════════════════════════════════════
titulo('Cliente que todavía no había entrado');

const beto = await cuenta('beto@memb.test');
r = await llamar('miMembresia', beto, { businessId: SUC });
chequear('Beto entra por primera vez y ve su membresía (desde la sucursal)', r.ok && r.data.membresia?.id === M_BETO && r.data.membresia.usable, r);
chequear('…y le muestra los usos del mes', r.data?.membresia?.periodo?.beneficios?.[0]?.usos === 2);
chequear('…y queda atada a su cuenta', (await membresia(M_BETO)).clienteUid === beto.uid);
const intruso = await cuenta('intruso@memb.test');
r = await llamar('miMembresia', intruso, { businessId: CUENTA });
chequear('otra cuenta no ve membresías ajenas', r.ok && r.data.membresia === null, r);

// ════════════════════════════════════════════════════════════════════════════
titulo('Mercado Pago: webhooks');

const pBeto = await periodos(M_BETO);
const HASTA_INICIAL = pBeto[0].hasta;
const antesDe = (f, n) => new Date(Date.parse(`${f}T12:00:00Z`) - n * 86400000).toISOString().slice(0, 10);

// El cobro que pagó el mes en que se vinculó (anterior a la carga) no abre nada.
mp.cobros['ap-0'] = {
  id: 'ap-0', preapproval_id: 'pre-beto', status: 'processed', transaction_amount: 25000,
  debit_date: `${dia(-3)}T10:00:00.000-03:00`, payment: { id: 'pay-0', status: 'approved' },
};
await webhook({ type: 'subscription_authorized_payment', 'data.id': 'ap-0' });
chequear('un cobro anterior a la vinculación no abre un mes encimado', (await periodos(M_BETO)).length === 1);

// Cobro de la cuota siguiente, aprobado. MP suele cobrar un par de días antes.
mp.cobros['ap-1'] = {
  id: 'ap-1', preapproval_id: 'pre-beto', status: 'processed', transaction_amount: 25000,
  debit_date: `${antesDe(HASTA_INICIAL, 2)}T10:00:00.000-03:00`, payment: { id: 'pay-1', status: 'approved' },
};
rr = await webhook({ type: 'subscription_authorized_payment', 'data.id': 'ap-1' });
chequear('el webhook contesta 200', rr.status === 200);
let ps = await periodos(M_BETO);
const nuevo = ps.find((p) => p.id === 'ap-ap-1');
chequear('un cobro aprobado abre el mes siguiente', Boolean(nuevo) && nuevo.desde > HASTA_INICIAL, ps);
chequear('…pegado al anterior, sin encimarse', nuevo?.desde && nuevo.desde === new Date(Date.parse(`${HASTA_INICIAL}T12:00:00Z`) + 86400000).toISOString().slice(0, 10), { HASTA_INICIAL, nuevo });
chequear('…con los usos en cero', nuevo?.usados === 0);
const pago = (await db.doc(`businesses/${CUENTA}/membresiaPagos/ap-ap-1`).get()).data();
chequear('…y la plata queda como ingreso de membresías', pago?.monto === 25000 && pago.origen === 'mercadopago', pago);

await webhook({ type: 'subscription_authorized_payment', 'data.id': 'ap-1' });
await webhook({}, { type: 'subscription_authorized_payment', data: { id: 'ap-1' } });
await Promise.all([1, 2, 3].map(() => webhook({ topic: 'authorized_payment', id: 'ap-1' })));
ps = await periodos(M_BETO);
chequear('el mismo cobro avisado 6 veces (y en paralelo) abre UN solo mes', ps.filter((p) => p.id === 'ap-ap-1').length === 1 && ps.length === 2, ps.map((p) => p.id));
chequear('…y UN solo ingreso', (await db.collection(`businesses/${CUENTA}/membresiaPagos`).where('membresiaId', '==', M_BETO).get()).size === 2);

// Pausa en MP.
mp.preapprovals['pre-beto'] = { ...mp.preapprovals['pre-beto'], status: 'paused', last_modified: '2026-06-01T10:00:00.000-03:00' };
await webhook({ type: 'subscription_preapproval', 'data.id': 'pre-beto' });
chequear('suscripción pausada en MP → pausada en BarberOS', (await membresia(M_BETO)).estado === 'pausada');

// Aviso viejo que llega tarde: dice "authorized" con fecha anterior.
mp.preapprovals['pre-beto'] = { ...mp.preapprovals['pre-beto'], status: 'authorized', last_modified: '2026-03-01T10:00:00.000-03:00' };
await webhook({ type: 'subscription_preapproval', 'data.id': 'pre-beto' });
chequear('un aviso fuera de orden (más viejo) no pisa el estado', (await membresia(M_BETO)).estado === 'pausada');

r = await reservar(beto, CUENTA, 'prof-1', 'srv-corte', dia(14), { usarMembresia: true });
chequear('pausada, el mes que YA pagó se sigue usando', r.ok && r.data.price === 0, r);

// Cobro rechazado.
mp.cobros['ap-2'] = { id: 'ap-2', preapproval_id: 'pre-beto', status: 'recycling', transaction_amount: 25000, debit_date: `${dia(30)}T10:00:00.000-03:00`, payment: { id: 'pay-2', status: 'rejected' } };
await webhook({ type: 'subscription_authorized_payment', 'data.id': 'ap-2' });
let mb = await membresia(M_BETO);
chequear('cuota rechazada → pago_rechazado, y no abre mes', mb.estado === 'pago_rechazado' && (await periodos(M_BETO)).length === 2, mb.estado);

// Reintento aprobado del mismo cobro.
mp.cobros['ap-2'] = { ...mp.cobros['ap-2'], status: 'processed', payment: { id: 'pay-2b', status: 'approved' } };
await webhook({ type: 'subscription_authorized_payment', 'data.id': 'ap-2' });
mb = await membresia(M_BETO);
chequear('el reintento aprobado abre el mes y la vuelve a activa', mb.estado === 'activa' && (await periodos(M_BETO)).length === 3, mb.estado);

// Devolución de una cuota.
mp.pagos['pay-1'] = { id: 'pay-1', status: 'refunded' };
await webhook({ type: 'payment', 'data.id': 'pay-1' });
ps = await periodos(M_BETO);
chequear('una cuota devuelta revierte su mes (no se reserva con él)', ps.find((p) => p.id === 'ap-ap-1')?.estado === 'revertido', ps.map((p) => [p.id, p.estado]));
chequear('…y el ingreso queda marcado como devuelto', (await db.doc(`businesses/${CUENTA}/membresiaPagos/ap-ap-1`).get()).data().revertido === true);

rr = await webhook({ type: 'subscription_preapproval', 'data.id': 'pre-desconocida' });
chequear('el aviso de una suscripción no vinculada no rompe nada', rr.status === 200);

// Cancelación.
r = await llamar('cancelarMembresia', barbero, { businessId: CUENTA, membresiaId: M_BETO });
chequear('el barbero no da de baja membresías', r.error === 'PERMISSION_DENIED', r);
r = await llamar('cancelarMembresia', dueno, { businessId: CUENTA, membresiaId: M_BETO, motivo: 'pidió la baja' });
chequear('el dueño la da de baja y se cancela también en MP', r.ok && mp.puts.some((p) => p.id === 'pre-beto' && p.status === 'cancelled'), { r, puts: mp.puts });
mb = await membresia(M_BETO);
chequear('…queda cancelada con el motivo en el historial', mb.estado === 'cancelada' && mb.historial.at(-1).causa === 'pidió la baja', mb.estado);
r = await reservar(beto, CUENTA, 'prof-1', 'srv-corte', dia(15), { usarMembresia: true });
chequear('cancelada, todavía usa lo que pagó (el mes en curso)', r.ok, r);

// ════════════════════════════════════════════════════════════════════════════
titulo('Renovación manual y cambio de plan');

r = await llamar('renovarMembresia', dueno, { businessId: CUENTA, membresiaId: M_BETO });
chequear('una membresía de MP no se renueva a mano', r.error === 'FAILED_PRECONDITION', r);
r = await llamar('renovarMembresia', barbero, { businessId: CUENTA, membresiaId: M_ANA });
chequear('el barbero no renueva', r.error === 'PERMISSION_DENIED', r);
r = await llamar('renovarMembresia', dueno, { businessId: CUENTA, membresiaId: M_ANA, monto: 25000 });
chequear('el dueño renueva la de Ana: mes nuevo pegado al anterior', r.ok && r.data.desde === dia(26), r);
r = await llamar('renovarMembresia', dueno, { businessId: CUENTA, membresiaId: M_ANA, monto: 25000 });
// El segundo arranca después del recién creado: no es un duplicado del mismo mes.
chequear('renovar otra vez abre el mes siguiente, no el mismo', r.ok && r.data.desde > dia(26), r);
ps = await periodos(M_ANA);
const delMesPasado = ps.find((p) => p.id === `inicial-${hoy}`);
chequear('el historial del mes anterior queda intacto', delMesPasado?.usados >= 1 && ps.length === 3, ps.map((p) => [p.id, p.usados]));

r = await reservar(ana, CUENTA, 'prof-1', 'srv-corte', dia(27), { usarMembresia: true });
chequear('un turno del mes nuevo descuenta del mes nuevo', r.ok && (await uso(r.data.id))?.periodoId === `m-${dia(26)}`, r);

// (Libera un lugar del tope de 3 turnos a futuro por cliente.)
await editarREST(ana, `businesses/${CUENTA}/appointments/${T_NORMAL_ANA}`, { status: 'cancelada', cancelledBy: 'client' });
r = await llamar('cargarMembresia', dueno, {
  businessId: CUENTA, planId: PREMIUM, clienteEmail: ana.email, clienteNombre: 'Ana', reemplazaA: M_ANA, desde: dia(1),
});
chequear('cambio de plan a Premium', r.ok, r);
const M_ANA2 = r.data?.id;
chequear('la anterior queda "reemplazada" y apunta a la nueva', (await membresia(M_ANA)).estado === 'reemplazada' && (await membresia(M_ANA)).reemplazadaPor === M_ANA2);
r = await reservar(ana, CUENTA, 'prof-1', 'srv-barba', dia(16), { usarMembresia: true });
chequear('con Premium ahora sí usa la barba', r.ok && r.data.membresia?.membresiaId === M_ANA2, r);

// ════════════════════════════════════════════════════════════════════════════
titulo('Reconciliación');

// Un cobro que el webhook nunca avisó (MP caído).
mp.preapprovals['pre-cami'] = { ...mp.preapprovals['pre-beto'], id: 'pre-cami', status: 'authorized', payer_email: 'cami@mp.com', last_modified: '2026-01-01T10:00:00.000-03:00' };
await cuenta('cami@memb.test');
r = await llamar('cargarMembresia', dueno, { businessId: CUENTA, planId: PLAN, clienteEmail: 'cami@memb.test', clienteNombre: 'Cami', preapprovalId: 'pre-cami', desde: hoy });
const M_CAMI = r.data?.id;
mp.cobros['ap-cami'] = { id: 'ap-cami', preapproval_id: 'pre-cami', status: 'processed', transaction_amount: 25000, debit_date: `${dia(25)}T10:00:00.000-03:00`, payment: { id: 'pay-cami', status: 'approved' } };

// Una manual vencida hace rato.
r = await llamar('cargarMembresia', dueno, { businessId: CUENTA, planId: PLAN, clienteEmail: 'vieja@memb.test', clienteNombre: 'Vieja', desde: hoy });
const M_VIEJA = r.data?.id;
await db.doc(`businesses/${CUENTA}/membresias/${M_VIEJA}`).update({ periodoActual: { id: 'x', desde: dia(-40), hasta: dia(-10) } });

r = await llamar('reconciliarMembresias', dueno, {});
chequear('la reconciliación es solo de la plataforma', r.error === 'PERMISSION_DENIED', r);
r = await llamar('reconciliarMembresias', plataforma, {});
chequear('la reconciliación corre', r.ok, r);
chequear('recupera el cobro que el webhook no avisó', (await periodos(M_CAMI)).some((p) => p.id === 'ap-ap-cami'));
chequear('vence la que no pagó', (await membresia(M_VIEJA)).estado === 'vencida');
await llamar('reconciliarMembresias', plataforma, {});
chequear('correrla dos veces no duplica nada', (await periodos(M_CAMI)).length === 2);

// ════════════════════════════════════════════════════════════════════════════
titulo('Ingresos');

const pagos = (await db.collection(`businesses/${CUENTA}/membresiaPagos`).get()).docs.map((d) => d.data());
chequear('cada mes cobrado deja un ingreso de membresías', pagos.length >= 6, pagos.length);
t = (await db.doc(`businesses/${CUENTA}/appointments/${T_NORMAL_ANA}`).get()).data();
chequear('el turno normal se cobra a precio de lista, sin membresía', t.price === 8000 && !t.membresia);

servidorMP.close();
console.log(`\n${ok} ok, ${mal} fallas`);
process.exit(mal ? 1 : 0);
