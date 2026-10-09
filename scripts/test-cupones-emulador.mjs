// Cupones contra el emulador: Rules, validación en servidor y consumo de usos.
//
//   firebase emulators:start --only auth,firestore,functions
//   node scripts/test-cupones-emulador.mjs
//
// Lo de acá es lo que NO se puede probar sin base: que un cliente no pueda
// leer un cupón, que el descuento que se cobra lo decida el servidor, que el
// último uso no se lo lleven dos personas a la vez, y que el uso vuelva cuando
// el turno se cae.
//
// La aritmética del descuento está en `scripts/test-cupones.mjs`, que no
// necesita emulador.
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
  const u = await auth.createUser({ email, emailVerified: true });
  if (claims) await auth.setCustomUserClaims(u.uid, claims);
  const r = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: await auth.createCustomToken(u.uid), returnSecureToken: true }),
  });
  return { uid: u.uid, email, token: (await r.json()).idToken };
}

const cab = (u) => ({ Authorization: `Bearer ${u.token}`, 'Content-Type': 'application/json' });
const leer = (u, path) => fetch(`${DOCS}/${path}`, { headers: u ? cab(u) : {} });
const listar = (u, path) => fetch(`${DOCS}/${path}`, { headers: u ? cab(u) : {} });
const crear = (u, path, datos) => fetch(`${DOCS}/${path}`, { method: 'POST', headers: cab(u), body: JSON.stringify(enc(datos)) });
const escribir = (u, path, datos) => {
  const qs = Object.keys(datos).map((k) => `updateMask.fieldPaths=${k}`).join('&');
  return fetch(`${DOCS}/${path}?${qs}`, { method: 'PATCH', headers: cab(u), body: JSON.stringify(enc(datos)) });
};
const borrar = (u, path) => fetch(`${DOCS}/${path}`, { method: 'DELETE', headers: cab(u) });

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

const BIZ = 'cupon-biz';
const OTRA = 'cupon-otra';

const manana = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
};
const enDias = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
};

const HORARIO = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startTime: '09:00', endTime: '21:00', isActive: true }));

async function sembrarNegocio(id) {
  await db.recursiveDelete(db.doc(`businesses/${id}`)).catch(() => {});
  await db.doc(`businesses/${id}`).set({
    id, name: id, slug: id, isFrozen: false, onlineBookingEnabled: true,
    planId: 'full', capacidades: { fotoPerfil: true, colores: true, logo: true, pagina: true, paginaFoto: true },
    grupoId: null, businessHours: HORARIO, mpConectado: false,
  });
  await db.doc(`businesses/${id}/services/corte`).set({ id: 'corte', name: 'Corte', price: 15000, durationMinutes: 60, isActive: true });
  await db.doc(`businesses/${id}/services/barba`).set({ id: 'barba', name: 'Barba', price: 8000, durationMinutes: 30, isActive: true });
  for (const p of ['martin', 'lucas']) {
    await db.doc(`businesses/${id}/professionals/${p}`).set({ id: p, name: p, isActive: true });
    for (const s of ['corte', 'barba']) {
      await db.doc(`businesses/${id}/professionalServices/${p}-${s}`).set({ professionalId: p, serviceId: s });
      await db.doc(`businesses/${id}/schedules/${p}-${s}`).set({});
    }
    await db.collection(`businesses/${id}/schedules`).doc(p).delete().catch(() => {});
    for (const d of [0, 1, 2, 3, 4, 5, 6]) {
      await db.doc(`businesses/${id}/schedules/${p}-${d}`).set({
        professionalId: p, dayOfWeek: d, startTime: '09:00', endTime: '21:00', isActive: true,
      });
    }
  }
  // Las de arriba dejaron basura con ids compuestos en schedules; se limpia lo
  // que no es un horario de verdad.
  for (const d of (await db.collection(`businesses/${id}/schedules`).get()).docs) {
    if (d.get('dayOfWeek') === undefined) await d.ref.delete();
  }
}

const cupon = (id, datos) => db.doc(`businesses/${BIZ}/cupones/${id}`).set({
  codigo: id, tipo: 'porcentaje', valor: 20, activo: true,
  desde: null, hasta: null, serviciosIds: [], profesionalesIds: [],
  soloPrimeraVisita: false, maxUsos: 0, maxUsosPorCliente: 0,
  usos: 0, usosConfirmados: 0, ingresos: 0, clientesNuevos: 0,
  ...datos,
});

await sembrarNegocio(BIZ);
await sembrarNegocio(OTRA);

const dueno = await usuario('cupon-dueno@gmail.com', { businessId: BIZ, role: 'owner', professionalId: null });
const duenoOtra = await usuario('cupon-otra@gmail.com', { businessId: OTRA, role: 'owner', professionalId: null });
const barbero = await usuario('cupon-barbero@gmail.com', { businessId: BIZ, role: 'admin', professionalId: 'martin' });
const cliente = await usuario('cupon-cliente@gmail.com', null);
const cliente2 = await usuario('cupon-cliente2@gmail.com', null);

// ── 1. Lo que el cliente NO puede ───────────────────────────────────────────
// Es la decisión que sostiene todo lo demás: si un cliente pudiera leer un
// cupón, probando códigos encuentra los que andan, y un `list` le entrega la
// promoción entera de la barbería, incluida la que todavía no salió.
console.log('\nLos cupones están cerrados al cliente:');
await cupon('CORTE20', { valor: 20 });

await esperar('un cliente NO puede leer un cupón suelto, ni sabiendo el código',
  leer(cliente, `businesses/${BIZ}/cupones/CORTE20`), 'denegado');
await esperar('un cliente NO puede listar los cupones',
  listar(cliente, `businesses/${BIZ}/cupones`), 'denegado');
await esperar('sin sesión tampoco',
  leer(null, `businesses/${BIZ}/cupones/CORTE20`), 'denegado');
await esperar('un cliente NO puede leer los usos',
  listar(cliente, `businesses/${BIZ}/cupones/CORTE20/usos`), 'denegado');
await esperar('un cliente NO puede crear un cupón',
  crear(cliente, `businesses/${BIZ}/cupones?documentId=TRUCHO`, { codigo: 'TRUCHO', tipo: 'porcentaje', valor: 99, activo: true }), 'denegado');
await esperar('un cliente NO puede editar uno',
  escribir(cliente, `businesses/${BIZ}/cupones/CORTE20`, { valor: 99 }), 'denegado');

// El barbero tampoco: el cupón es la promoción comercial del local.
await esperar('el barbero NO lee los cupones',
  leer(barbero, `businesses/${BIZ}/cupones/CORTE20`), 'denegado');
await esperar('el barbero NO los edita',
  escribir(barbero, `businesses/${BIZ}/cupones/CORTE20`, { valor: 50 }), 'denegado');

// Y el aislamiento entre barberías, que es lo de siempre.
await esperar('el dueño de otra barbería no ve los míos',
  leer(duenoOtra, `businesses/${BIZ}/cupones/CORTE20`), 'denegado');
await esperar('ni me crea uno',
  crear(duenoOtra, `businesses/${BIZ}/cupones?documentId=AJENO`, { codigo: 'AJENO', tipo: 'fijo', valor: 100, activo: true }), 'denegado');

// ── 2. Lo que el dueño SÍ puede, y lo que no ───────────────────────────────
console.log('\nEl dueño administra los suyos:');
await esperar('lee', leer(dueno, `businesses/${BIZ}/cupones/CORTE20`), 'permitido');
await esperar('lista', listar(dueno, `businesses/${BIZ}/cupones`), 'permitido');
await esperar('crea',
  crear(dueno, `businesses/${BIZ}/cupones?documentId=NUEVO10`,
    { codigo: 'NUEVO10', tipo: 'porcentaje', valor: 10, activo: true, usos: 0 }), 'permitido');
await esperar('edita el valor',
  escribir(dueno, `businesses/${BIZ}/cupones/NUEVO10`, { valor: 15 }), 'permitido');
await esperar('lo apaga',
  escribir(dueno, `businesses/${BIZ}/cupones/NUEVO10`, { activo: false }), 'permitido');

// El id TIENE que ser el código: es lo que hace imposible dos cupones con el
// mismo código sin ningún chequeo de unicidad.
await esperar('no puede crear uno con el id distinto del código',
  crear(dueno, `businesses/${BIZ}/cupones?documentId=OTROID`, { codigo: 'NOCOINCIDE', tipo: 'fijo', valor: 100, activo: true, usos: 0 }), 'denegado');
await esperar('no puede cambiarle el código a uno que existe',
  escribir(dueno, `businesses/${BIZ}/cupones/NUEVO10`, { codigo: 'RENOMBRADO' }), 'denegado');

// Los contadores son del servidor: son el resultado de lo que pasó, no campos.
// Se le ponen números de verdad primero: `affectedKeys()` lista solo las claves
// que CAMBIAN, así que escribir el mismo valor no es una escritura y la regla
// —con razón— la deja pasar. El caso que importa es bajarlos.
await db.doc(`businesses/${BIZ}/cupones/NUEVO10`).update({ usos: 7, usosConfirmados: 5, ingresos: 60000 });
await esperar('NO puede ponerse los usos en cero (reviviría un cupón agotado)',
  escribir(dueno, `businesses/${BIZ}/cupones/NUEVO10`, { usos: 0 }), 'denegado');
await esperar('NO puede inflarse los ingresos',
  escribir(dueno, `businesses/${BIZ}/cupones/NUEVO10`, { ingresos: 999999 }), 'denegado');
await esperar('NO puede borrarse los clientes nuevos',
  escribir(dueno, `businesses/${BIZ}/cupones/NUEVO10`, { usosConfirmados: 0 }), 'denegado');
// Pero editar el cupón SIN tocar los contadores sigue andando: si no, un cupón
// que ya se usó no se podría volver a editar nunca.
await esperar('sí puede editar el valor de un cupón que ya tiene usos',
  escribir(dueno, `businesses/${BIZ}/cupones/NUEVO10`, { valor: 12 }), 'permitido');
await esperar('NO puede escribir un uso a mano',
  crear(dueno, `businesses/${BIZ}/cupones/CORTE20/usos?documentId=inventado`, { userId: 'x', estado: 'confirmado' }), 'denegado');

// Valores imposibles: el descuento sale de acá y se cobra de verdad.
await esperar('un porcentaje de 200 se rechaza',
  crear(dueno, `businesses/${BIZ}/cupones?documentId=MALO1`, { codigo: 'MALO1', tipo: 'porcentaje', valor: 200, activo: true, usos: 0 }), 'denegado');
await esperar('un valor negativo se rechaza',
  crear(dueno, `businesses/${BIZ}/cupones?documentId=MALO2`, { codigo: 'MALO2', tipo: 'fijo', valor: -500, activo: true, usos: 0 }), 'denegado');
await esperar('un tipo inventado se rechaza',
  crear(dueno, `businesses/${BIZ}/cupones?documentId=MALO3`, { codigo: 'MALO3', tipo: 'regalo', valor: 10, activo: true, usos: 0 }), 'denegado');
await esperar('un código en minúscula se rechaza (se normaliza antes de mandar)',
  crear(dueno, `businesses/${BIZ}/cupones?documentId=minus`, { codigo: 'minus', tipo: 'fijo', valor: 10, activo: true, usos: 0 }), 'denegado');
await esperar('borra el suyo', borrar(dueno, `businesses/${BIZ}/cupones/NUEVO10`), 'permitido');

// ── 3. validarCupon ─────────────────────────────────────────────────────────
console.log('\nvalidarCupon: contesta sí o no, y nada más:');
let r = await llamar('validarCupon', cliente, { businessId: BIZ, codigo: 'CORTE20', serviceId: 'corte', professionalId: 'martin' });
chequear('un cupón bueno devuelve el descuento calculado',
  r.ok?.valido === true && r.ok.descuento === 3000 && r.ok.precioFinal === 12000, JSON.stringify(r));

r = await llamar('validarCupon', cliente, { businessId: BIZ, codigo: '  corte 20 ', serviceId: 'corte', professionalId: 'martin' });
chequear('con espacios y en minúscula, entra igual', r.ok?.valido === true, JSON.stringify(r));

r = await llamar('validarCupon', cliente, { businessId: BIZ, codigo: 'NOEXISTE', serviceId: 'corte', professionalId: 'martin' });
chequear('uno que no existe: inválido', r.ok?.valido === false, JSON.stringify(r));
chequear('y NO dice por qué (eso permitiría enumerar códigos)',
  r.ok?.motivo === undefined && !/no existe|venc|agotad/i.test(r.ok?.mensaje || ''), JSON.stringify(r.ok));

await cupon('VENCIDO', { hasta: '2020-01-01T00:00' });
r = await llamar('validarCupon', cliente, { businessId: BIZ, codigo: 'VENCIDO', serviceId: 'corte', professionalId: 'martin' });
chequear('un cupón vencido da el MISMO mensaje que uno inexistente',
  r.ok?.valido === false && r.ok.mensaje === 'El código no es válido o ya no está disponible.', JSON.stringify(r));

r = await llamar('validarCupon', null, { businessId: BIZ, codigo: 'CORTE20' });
chequear('sin sesión no se puede probar códigos', r.error === 'UNAUTHENTICATED', JSON.stringify(r));

await cupon('SOLOBARBA', { serviciosIds: ['barba'] });
r = await llamar('validarCupon', cliente, { businessId: BIZ, codigo: 'SOLOBARBA', serviceId: 'corte', professionalId: 'martin' });
chequear('un cupón de otro servicio no entra', r.ok?.valido === false, JSON.stringify(r));
r = await llamar('validarCupon', cliente, { businessId: BIZ, codigo: 'SOLOBARBA', serviceId: 'barba', professionalId: 'martin' });
chequear('y en el suyo sí, sobre el precio de ESE servicio',
  r.ok?.valido === true && r.ok.precioLista === 8000 && r.ok.precioFinal === 6400, JSON.stringify(r));

// ── 4. El freno a la fuerza bruta ───────────────────────────────────────────
console.log('\nFuerza bruta sobre códigos:');
await db.doc(`rateLimits/cupon_${BIZ}_${cliente2.uid}`).delete().catch(() => {});
let bloqueado = false;
for (let i = 0; i < 20; i++) {
  const res = await llamar('validarCupon', cliente2, { businessId: BIZ, codigo: `PRUEBA${i}X`, serviceId: 'corte', professionalId: 'martin' });
  if (res.error === 'RESOURCE_EXHAUSTED') { bloqueado = true; break; }
}
chequear('después de muchos intentos fallidos, se corta', bloqueado);
r = await llamar('validarCupon', cliente, { businessId: BIZ, codigo: 'CORTE20', serviceId: 'corte', professionalId: 'martin' });
chequear('y el freno es por cuenta: a otro cliente no lo toca', r.ok?.valido === true, JSON.stringify(r));

// ── 5. El descuento que se COBRA lo decide el servidor ─────────────────────
console.log('\nAl reservar, manda el servidor:');
const reservar = (u, datos) => llamar('createAppointment', u, {
  businessId: BIZ, professionalId: 'martin', serviceId: 'corte',
  appointmentDate: manana(), startTime: '10:00',
  clientName: 'Cliente', clientPhone: '2234567890',
  ...datos,
});

const limpiarTurnos = async (bizId = BIZ) => {
  for (const d of (await db.collection(`businesses/${bizId}/appointments`).get()).docs) await d.ref.delete();
};

await limpiarTurnos();
r = await reservar(cliente, { cuponCodigo: 'CORTE20' });
chequear('reserva con cupón: el precio guardado es el final',
  r.ok?.price === 12000 && r.ok?.descuento === 3000 && r.ok?.precioLista === 15000, JSON.stringify(r));

let apt = await db.doc(`businesses/${BIZ}/appointments/${r.ok.id}`).get();
chequear('el turno guarda el snapshot del cobro',
  apt.get('price') === 12000 && apt.get('precioLista') === 15000
  && apt.get('descuento') === 3000 && apt.get('cuponCodigo') === 'CORTE20', JSON.stringify(apt.data()));

let c = await db.doc(`businesses/${BIZ}/cupones/CORTE20`).get();
chequear('el uso quedó reservado en el cupón', c.get('usos') === 1, String(c.get('usos')));
let uso = await db.doc(`businesses/${BIZ}/cupones/CORTE20/usos/${r.ok.id}`).get();
chequear('y hay un documento de uso con el id del turno',
  uso.exists && uso.get('estado') === 'reservado' && uso.get('precioFinal') === 12000, JSON.stringify(uso.data()));
chequear('marcado como cliente nuevo (era su primer turno acá)', uso.get('esClienteNuevo') === true);

const idConCupon = r.ok.id;

// Lo central: el cliente puede mandar lo que quiera, el precio sale del
// servicio y el descuento del cupón de la base.
await limpiarTurnos();
r = await llamar('createAppointment', cliente, {
  businessId: BIZ, professionalId: 'martin', serviceId: 'corte',
  appointmentDate: manana(), startTime: '11:00',
  clientName: 'C', clientPhone: '2234567890',
  cuponCodigo: 'CORTE20',
  // Todo esto se ignora.
  price: 1, precioLista: 1, descuento: 14999, precioFinal: 1,
});
chequear('un descuento inventado por el cliente se ignora',
  r.ok?.price === 12000 && r.ok?.descuento === 3000, JSON.stringify(r));

await limpiarTurnos();
r = await reservar(cliente, { cuponCodigo: 'NOEXISTE' });
chequear('un cupón que no existe NO rompe la reserva: se paga el precio de lista',
  r.ok?.price === 15000 && !r.ok?.cuponCodigo, JSON.stringify(r));

await limpiarTurnos();
r = await reservar(cliente, { cuponCodigo: 'VENCIDO' });
chequear('un cupón vencido tampoco la rompe', r.ok?.price === 15000, JSON.stringify(r));

await limpiarTurnos();
r = await reservar(cliente, {});
chequear('sin cupón, todo como siempre',
  r.ok?.price === 15000 && r.ok?.descuento === 0, JSON.stringify(r));

// Un cupón de otra barbería no vale acá.
await db.doc(`businesses/${OTRA}/cupones/AJENO50`).set({
  codigo: 'AJENO50', tipo: 'porcentaje', valor: 50, activo: true, usos: 0,
  serviciosIds: [], profesionalesIds: [], soloPrimeraVisita: false, maxUsos: 0, maxUsosPorCliente: 0,
});
await limpiarTurnos();
r = await reservar(cliente, { cuponCodigo: 'AJENO50' });
chequear('el cupón de otra barbería no aplica acá', r.ok?.price === 15000, JSON.stringify(r));

// ── 6. Los topes, de verdad ─────────────────────────────────────────────────
console.log('\nLos topes de uso:');
await cupon('UNOSOLO', { maxUsos: 1, valor: 10 });
await limpiarTurnos();
r = await reservar(cliente, { cuponCodigo: 'UNOSOLO' });
chequear('el primero lo usa', r.ok?.descuento === 1500, JSON.stringify(r));

r = await llamar('createAppointment', cliente2, {
  businessId: BIZ, professionalId: 'lucas', serviceId: 'corte',
  appointmentDate: manana(), startTime: '10:00',
  clientName: 'Otro', clientPhone: '2234567891', cuponCodigo: 'UNOSOLO',
});
chequear('el segundo reserva igual, pero SIN descuento (estaba agotado)',
  r.ok?.price === 15000 && !r.ok?.cuponCodigo, JSON.stringify(r));
c = await db.doc(`businesses/${BIZ}/cupones/UNOSOLO`).get();
chequear('y el contador no pasó de 1', c.get('usos') === 1, String(c.get('usos')));

await cupon('UNOPORCLIENTE', { maxUsosPorCliente: 1, valor: 10 });
await limpiarTurnos();
r = await reservar(cliente, { cuponCodigo: 'UNOPORCLIENTE' });
chequear('el cliente lo usa una vez', r.ok?.descuento === 1500, JSON.stringify(r));
r = await llamar('createAppointment', cliente, {
  businessId: BIZ, professionalId: 'martin', serviceId: 'corte',
  appointmentDate: enDias(2), startTime: '10:00',
  clientName: 'C', clientPhone: '2234567890', cuponCodigo: 'UNOPORCLIENTE',
});
chequear('la segunda vez, el mismo cliente ya no', !r.ok?.cuponCodigo, JSON.stringify(r));

// Primera visita: el que ya tiene un turno acá no entra.
await cupon('BIENVENIDO', { soloPrimeraVisita: true, valor: 50 });
r = await llamar('createAppointment', cliente, {
  businessId: BIZ, professionalId: 'lucas', serviceId: 'corte',
  appointmentDate: enDias(3), startTime: '12:00',
  clientName: 'C', clientPhone: '2234567890', cuponCodigo: 'BIENVENIDO',
});
chequear('solo primera visita: al que ya vino, no', !r.ok?.cuponCodigo, JSON.stringify(r));

const nuevito = await usuario('cupon-nuevito@gmail.com', null);
r = await llamar('createAppointment', nuevito, {
  businessId: BIZ, professionalId: 'lucas', serviceId: 'corte',
  appointmentDate: enDias(4), startTime: '12:00',
  clientName: 'Nuevo', clientPhone: '2234567892', cuponCodigo: 'BIENVENIDO',
});
chequear('y al que nunca vino, sí', r.ok?.descuento === 7500, JSON.stringify(r));

// ── 7. La carrera por el último uso ────────────────────────────────────────
// Dos clientes apretando "confirmar" al mismo tiempo sobre el último lugar.
// Sin la transacción, los dos leen "queda uno" y los dos pasan.
console.log('\nDos clientes y un solo uso disponible:');
await cupon('ULTIMO', { maxUsos: 1, valor: 10 });
await limpiarTurnos();

const corredores = await Promise.all([
  usuario('carrera-1@gmail.com', null),
  usuario('carrera-2@gmail.com', null),
  usuario('carrera-3@gmail.com', null),
]);
const horas = ['14:00', '15:00', '16:00'];
const resultados = await Promise.all(corredores.map((u, i) => llamar('createAppointment', u, {
  businessId: BIZ, professionalId: 'martin', serviceId: 'corte',
  appointmentDate: manana(), startTime: horas[i],
  clientName: `C${i}`, clientPhone: '2234567890', cuponCodigo: 'ULTIMO',
})));

const conDescuento = resultados.filter((x) => x.ok?.cuponCodigo === 'ULTIMO').length;
chequear('exactamente UNO se llevó el descuento', conDescuento === 1,
  JSON.stringify(resultados.map((x) => x.ok?.price ?? x.error)));
chequear('los otros reservaron igual, al precio de lista',
  resultados.filter((x) => x.ok?.price === 15000).length === 2,
  JSON.stringify(resultados.map((x) => x.ok?.price ?? x.error)));

// Y lo que vale es lo que quedó GUARDADO, no lo que devolvió la llamada.
// Firestore reintenta la transacción cuando hay contención, y en el reintento
// el callback vuelve a correr entero: si el estado de afuera no se reinicia,
// el segundo intento escribe el precio con descuento del primero aunque el
// cupón ya esté agotado. Es exactamente el bug que esta prueba encontró.
const guardados = (await db.collection(`businesses/${BIZ}/appointments`).get())
  .docs.map((d) => ({ price: d.get('price'), cupon: d.get('cuponCodigo') || null }));
chequear('en la base queda UN turno con descuento y dos a precio de lista',
  guardados.filter((t) => t.price === 13500 && t.cupon === 'ULTIMO').length === 1
  && guardados.filter((t) => t.price === 15000 && !t.cupon).length === 2,
  JSON.stringify(guardados));
chequear('ningún turno quedó con el precio de promoción sin el cupón',
  guardados.every((t) => t.price === 15000 || t.cupon === 'ULTIMO'),
  JSON.stringify(guardados));
c = await db.doc(`businesses/${BIZ}/cupones/ULTIMO`).get();
chequear('el contador quedó en 1, no en 3', c.get('usos') === 1, String(c.get('usos')));
const usosULTIMO = await db.collection(`businesses/${BIZ}/cupones/ULTIMO/usos`).get();
chequear('y hay un solo documento de uso', usosULTIMO.size === 1, String(usosULTIMO.size));

// ── 8. La seña sale del precio FINAL ───────────────────────────────────────
console.log('\nLa seña, sobre el precio con descuento:');
await db.doc(`businesses/${BIZ}`).update({
  mpConectado: true, sena: { activa: true, monto: 5000, modo: 'opcional', permiteTotal: true },
});
await db.doc(`businesses/${BIZ}/private/mercadopago`).set({ accessToken: 'TEST-falso', userId: '1' });

await cupon('MITAD', { valor: 50 });
await limpiarTurnos();
// Pagar el total: lo que se cobra es el precio YA con descuento.
r = await llamar('createAppointment', cliente, {
  businessId: BIZ, professionalId: 'martin', serviceId: 'corte',
  appointmentDate: manana(), startTime: '17:00',
  clientName: 'C', clientPhone: '2234567890', cuponCodigo: 'MITAD', pagar: 'total',
});
// El pago contra Mercado Pago falla (el token es falso) y el turno se cancela
// solo; lo que importa es con qué monto se intentó.
let turnos = await db.collection(`businesses/${BIZ}/appointments`).get();
let conSena = turnos.docs.find((d) => d.get('cuponCodigo') === 'MITAD');
chequear('"pago todo" cobra el precio con descuento, no el de lista',
  conSena?.get('sena')?.monto === 7500, JSON.stringify(conSena?.get('sena')));

// Un descuento del 80% deja el turno en $3.000: una seña fija de $5.000 sería
// cobrarle más por adelantado que lo que sale el turno.
await cupon('OCHENTA', { valor: 80 });
await limpiarTurnos();
await llamar('createAppointment', cliente2, {
  businessId: BIZ, professionalId: 'lucas', serviceId: 'corte',
  appointmentDate: manana(), startTime: '18:00',
  clientName: 'C2', clientPhone: '2234567891', cuponCodigo: 'OCHENTA', pagar: 'sena',
});
turnos = await db.collection(`businesses/${BIZ}/appointments`).get();
conSena = turnos.docs.find((d) => d.get('cuponCodigo') === 'OCHENTA');
chequear('la seña fija se recorta al precio final (nunca cobra de más)',
  conSena?.get('sena')?.monto === 3000, JSON.stringify(conSena?.get('sena')));

// Y con el turno gratis no hay nada que cobrar online.
await cupon('GRATIS', { valor: 100 });
await limpiarTurnos();
r = await llamar('createAppointment', nuevito, {
  businessId: BIZ, professionalId: 'martin', serviceId: 'corte',
  appointmentDate: enDias(5), startTime: '10:00',
  clientName: 'N', clientPhone: '2234567892', cuponCodigo: 'GRATIS', pagar: 'sena',
});
chequear('con el turno en cero no se pide seña: se reserva y listo',
  r.ok?.status === 'created' && r.ok?.price === 0, JSON.stringify(r));

await db.doc(`businesses/${BIZ}`).update({ mpConectado: false, sena: { activa: false } });

// ── 9. El uso sigue al turno ───────────────────────────────────────────────
// Los cambios de estado son escrituras DIRECTAS del panel a Firestore, no
// llamadas a una function: por eso esto lo hace un trigger. Hay que esperarlo.
console.log('\nQué pasa con el uso cuando el turno cambia de estado:');
const esperarA = async (fn, intentos = 25) => {
  for (let i = 0; i < intentos; i++) {
    if (await fn()) return true;
    await new Promise((res) => setTimeout(res, 400));
  }
  return false;
};

await cupon('SEGUIR', { valor: 20 });
await limpiarTurnos();
r = await reservar(nuevito, { cuponCodigo: 'SEGUIR' });
const idSeguir = r.ok.id;
chequear('reservado con el cupón', r.ok?.cuponCodigo === 'SEGUIR', JSON.stringify(r));

// Atendido: consume el uso y suma a los números del cupón.
await db.doc(`businesses/${BIZ}/appointments/${idSeguir}`).update({ status: 'completada' });
let ok = await esperarA(async () => {
  const d = await db.doc(`businesses/${BIZ}/cupones/SEGUIR`).get();
  return d.get('usosConfirmados') === 1;
});
c = await db.doc(`businesses/${BIZ}/cupones/SEGUIR`).get();
chequear('atendido: cuenta como uso confirmado', ok, JSON.stringify(c.data()));
chequear('y suma a los ingresos lo que de verdad se cobró, no el precio de lista',
  c.get('ingresos') === 12000, String(c.get('ingresos')));
chequear('y suma un cliente nuevo', c.get('clientesNuevos') === 1, String(c.get('clientesNuevos')));

// Cancelado: devuelve el uso, y descuenta lo que había sumado.
await db.doc(`businesses/${BIZ}/appointments/${idSeguir}`).update({ status: 'cancelada', cancelledBy: 'client' });
ok = await esperarA(async () => {
  const d = await db.doc(`businesses/${BIZ}/cupones/SEGUIR`).get();
  return d.get('usos') === 0;
});
c = await db.doc(`businesses/${BIZ}/cupones/SEGUIR`).get();
chequear('cancelado: el uso vuelve a estar disponible', ok, JSON.stringify(c.data()));
chequear('y se descuenta de los números', c.get('usosConfirmados') === 0 && c.get('ingresos') === 0, JSON.stringify(c.data()));

// No vino: consume igual. Reservó con el descuento y bloqueó el horario.
await cupon('NOVINO', { valor: 20 });
await limpiarTurnos();
r = await reservar(cliente, { cuponCodigo: 'NOVINO' });
await db.doc(`businesses/${BIZ}/appointments/${r.ok.id}`).update({ status: 'no_asistio' });
ok = await esperarA(async () => {
  const d = await db.doc(`businesses/${BIZ}/cupones/NOVINO`).get();
  return d.get('usosConfirmados') === 1;
});
c = await db.doc(`businesses/${BIZ}/cupones/NOVINO`).get();
chequear('no vino: el uso se consume igual', ok && c.get('usos') === 1, JSON.stringify(c.data()));

// Y el doble cambio de estado no descuenta dos veces.
await cupon('DOBLE', { valor: 20 });
await limpiarTurnos();
r = await reservar(cliente2, { cuponCodigo: 'DOBLE' });
const idDoble = r.ok.id;
for (const st of ['cancelada', 'cancelada']) {
  await db.doc(`businesses/${BIZ}/appointments/${idDoble}`).update({ status: st, cancelledBy: 'client', notes: String(Math.random()) });
  await new Promise((res) => setTimeout(res, 600));
}
await esperarA(async () => (await db.doc(`businesses/${BIZ}/cupones/DOBLE`).get()).get('usos') === 0);
c = await db.doc(`businesses/${BIZ}/cupones/DOBLE`).get();
chequear('cancelar dos veces no deja el contador en negativo', c.get('usos') === 0, String(c.get('usos')));

// Un turno SIN cupón no toca ningún contador.
await limpiarTurnos();
const antes = (await db.doc(`businesses/${BIZ}/cupones/CORTE20`).get()).get('usos');
r = await reservar(nuevito, {});
await db.doc(`businesses/${BIZ}/appointments/${r.ok.id}`).update({ status: 'completada' });
await new Promise((res) => setTimeout(res, 1200));
c = await db.doc(`businesses/${BIZ}/cupones/CORTE20`).get();
chequear('un turno sin cupón no mueve ningún contador', c.get('usos') === antes, `${antes} → ${c.get('usos')}`);

// ── 10. El pago abandonado devuelve el uso ─────────────────────────────────
// Un turno con seña que nunca se paga NO se marca cancelado solo: deja de
// ocupar el horario por reloj. Sin el barrido, el uso queda reservado para
// siempre y un cupón de 50 se agota con 50 personas que cerraron la pestaña.
console.log('\nPagos abandonados:');
await cupon('ABANDONADO', { valor: 20 });
await limpiarTurnos();
const idMuerto = db.collection(`businesses/${BIZ}/appointments`).doc().id;
await db.doc(`businesses/${BIZ}/appointments/${idMuerto}`).set({
  id: idMuerto, businessId: BIZ, userId: cliente.uid,
  professionalId: 'martin', serviceId: 'corte',
  appointmentDate: manana(), startTime: '19:00', endTime: '20:00',
  price: 12000, precioLista: 15000, descuento: 3000,
  cuponCodigo: 'ABANDONADO', cuponId: 'ABANDONADO',
  status: 'esperando_pago',
  senaExpiraEn: new Date(Date.now() - 60 * 60 * 1000),
});
await db.doc(`businesses/${BIZ}/cupones/ABANDONADO/usos/${idMuerto}`).set({
  appointmentId: idMuerto, userId: cliente.uid, estado: 'reservado',
  precioLista: 15000, descuento: 3000, precioFinal: 12000, esClienteNuevo: false,
});
await db.doc(`businesses/${BIZ}/cupones/ABANDONADO`).update({ usos: 1 });

const { procesarFacturacion } = await import('../functions/index.js');
await procesarFacturacion();

ok = await esperarA(async () => (await db.doc(`businesses/${BIZ}/cupones/ABANDONADO`).get()).get('usos') === 0);
c = await db.doc(`businesses/${BIZ}/cupones/ABANDONADO`).get();
const muerto = await db.doc(`businesses/${BIZ}/appointments/${idMuerto}`).get();
chequear('el turno que nunca se pagó queda cancelado', muerto.get('status') === 'cancelada', muerto.get('status'));
chequear('y el uso del cupón vuelve a estar disponible', ok, String(c.get('usos')));

console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
if (fallas.length) console.log('Fallaron:\n  - ' + fallas.join('\n  - '));
console.log('');
process.exit(fallaron ? 1 : 0);
