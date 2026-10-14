// Prueba de createAppointment contra el emulador. No toca producción.
//
//   firebase emulators:start --only auth,firestore,functions
//   node scripts/test-reservas-emulador.mjs
//
// Cubre exactamente los vectores que antes pasaban escribiendo directo a
// Firestore: precio falsificado, fecha pasada, profesional inexistente, negocio
// suspendido, horario fuera de agenda, doble reserva, teléfono inválido y más
// de un turno por día del mismo cliente.
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';

const PROJECT = 'barberos-1d60e';
const REGION = 'southamerica-east1';
const FN = (n) => `http://127.0.0.1:5001/${PROJECT}/${REGION}/${n}`;
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';

initializeApp({ projectId: PROJECT });
const db = getFirestore();
const auth = getAuth();

async function usuario(email) {
  try { await auth.deleteUser((await auth.getUserByEmail(email)).uid); } catch { /* no existía */ }
  const u = await auth.createUser({ email, emailVerified: true });
  const r = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: await auth.createCustomToken(u.uid), returnSecureToken: true }),
  });
  return { uid: u.uid, token: (await r.json()).idToken };
}

async function llamar(u, nombre, datos) {
  const r = await fetch(FN(nombre), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(u ? { Authorization: `Bearer ${u.token}` } : {}) },
    body: JSON.stringify({ data: datos }),
  });
  const j = await r.json().catch(() => ({}));
  // `mensaje` aparte del `error`: varios casos solo miran que haya error, pero
  // el texto es lo que de verdad lee el cliente, y un rechazo que no explica
  // por que es un misterio en pantalla.
  return j.error ? { error: j.error.status || j.error.message, mensaje: j.error.message || '' } : { ok: j.result };
}
const reservar = (u, datos) => llamar(u, 'createAppointment', datos);

let ok = 0, mal = 0;
const chequear = (desc, cond, detalle) => {
  if (cond) { ok++; console.log(`  ok    ${desc}`); }
  else { mal++; console.log(`  FALLA ${desc}\n        ${detalle}`); }
};
const titulo = (t) => console.log('\n' + t);

// ── escenario ──────────────────────────────────────────────────────────────
const BID = 'biz-test';
const PROF = 'prof-1', SRV = 'srv-1', SRV_HUERFANO = 'srv-2';

// Un martes lejano, para que nunca quede en el pasado.
const FECHA = '2027-03-02';
const DOW = 1; // 0=Lunes … 6=Domingo (convención de dateUtils, no la de JS)

// Escenario limpio: si otra prueba (o un seed a mano) dejó horarios o
// servicios de más en biz-test, los casos de "día que no trabaja" y "servicio
// que no hace" dejan de valer.
for (const col of ['schedules', 'professionalServices', 'services', 'professionals']) {
  for (const d of (await db.collection(`businesses/${BID}/${col}`).get()).docs) await d.ref.delete();
}
await db.doc(`businesses/${BID}`).set({
  name: 'Test', slug: 'test', isFrozen: false,
  businessHours: [{ dayOfWeek: DOW, startTime: '09:00', endTime: '18:00', isActive: true }],
});
await db.doc(`businesses/${BID}/services/${SRV}`).set({ name: 'Corte', price: 12000, durationMinutes: 30, isActive: true });
await db.doc(`businesses/${BID}/services/${SRV_HUERFANO}`).set({ name: 'Color', price: 30000, durationMinutes: 60, isActive: true });
await db.doc(`businesses/${BID}/professionals/${PROF}`).set({ name: 'Martín', isActive: true });
await db.doc(`businesses/${BID}/professionalServices/ps-1`).set({ professionalId: PROF, serviceId: SRV });
await db.doc(`businesses/${BID}/schedules/sch-1`).set({
  professionalId: PROF, dayOfWeek: DOW, startTime: '09:00', endTime: '18:00',
  breakStart: '13:00', breakEnd: '14:00', isActive: true,
});
for (const d of (await db.collection(`businesses/${BID}/appointments`).get()).docs) await d.ref.delete();

const cliente = await usuario('cliente@gmail.com');
const base = {
  businessId: BID, professionalId: PROF, serviceId: SRV,
  appointmentDate: FECHA, startTime: '10:00',
  clientPhone: '+54 9 11 1234-5678',
};

titulo('Camino feliz:');
let r = await reservar(cliente, { ...base, clientName: 'Cliente' });
chequear('reserva válida', r.ok?.status === 'created', JSON.stringify(r));
chequear('el precio lo pone el servidor (12000)', r.ok?.price === 12000, JSON.stringify(r.ok));
chequear('el fin lo calcula el servidor (10:30)', r.ok?.endTime === '10:30', JSON.stringify(r.ok));

const guardado = r.ok?.id ? (await db.doc(`businesses/${BID}/appointments/${r.ok.id}`).get()).data() : {};
chequear('nace en estado pendiente', guardado.status === 'pendiente', JSON.stringify(guardado.status));
chequear('el userId es el de la sesión', guardado.userId === cliente.uid, JSON.stringify(guardado.userId));

titulo('Lo que antes se colaba escribiendo directo a Firestore:');
// Otro cliente: el primero ya tiene su turno del día y un-por-día lo pararía antes.
const c2 = await usuario('c2@gmail.com');
r = await reservar(c2, { ...base, startTime: '11:00', price: 0 });
chequear('price 0 se ignora, manda el del servicio', r.ok?.price === 12000, JSON.stringify(r));

r = await reservar(cliente, { ...base, appointmentDate: '2020-01-01' });
chequear('fecha en el pasado, rechazada', r.error === 'INVALID_ARGUMENT', JSON.stringify(r));

r = await reservar(cliente, { ...base, professionalId: 'NO-EXISTE', startTime: '15:00' });
chequear('profesional inexistente, rechazado', r.error === 'NOT_FOUND', JSON.stringify(r));

r = await reservar(cliente, { ...base, serviceId: 'NO-EXISTE', startTime: '15:00' });
chequear('servicio inexistente, rechazado', r.error === 'NOT_FOUND', JSON.stringify(r));

r = await reservar(cliente, { ...base, serviceId: SRV_HUERFANO, startTime: '15:00' });
chequear('servicio que ese profesional no hace, rechazado', r.error === 'FAILED_PRECONDITION', JSON.stringify(r));

titulo('Horario:');
r = await reservar(cliente, { ...base, startTime: '08:00' });
chequear('antes de abrir, rechazado', r.error === 'FAILED_PRECONDITION', JSON.stringify(r));
// Regla del mostrador: alcanza con que EMPIECE dentro del horario. El barbero
// termina la cabeza que arrancó antes de cerrar. (Cliente nuevo: el de arriba
// ya tiene su turno del día y lo pararía el uno-por-día.)
const cTarde = await usuario('ctarde@gmail.com');
r = await reservar(cTarde, { ...base, startTime: '17:45', clientName: 'Tarde' });
chequear('arranca 17:45 y termina pasado el cierre: se toma', r.ok?.status === 'created', JSON.stringify(r));
r = await reservar(cliente, { ...base, startTime: '18:00' });
chequear('arranca justo al cierre, rechazado', r.error === 'FAILED_PRECONDITION', JSON.stringify(r));
r = await reservar(cliente, { ...base, startTime: '19:00' });
chequear('arranca después del cierre, rechazado', r.error === 'FAILED_PRECONDITION', JSON.stringify(r));
r = await reservar(cliente, { ...base, startTime: '13:15' });
chequear('cae en el descanso, rechazado', r.error === 'FAILED_PRECONDITION', JSON.stringify(r));
r = await reservar(cliente, { ...base, appointmentDate: '2027-03-01' });
chequear('día que no trabaja, rechazado', r.error === 'FAILED_PRECONDITION', JSON.stringify(r));
// Horario cortado del local: el barbero trabaja 09–18 seguido, pero el local
// cierra de 15 a 16:30; ese rato no se puede reservar aunque él esté.
await db.doc(`businesses/${BID}`).update({ businessHours: [{ dayOfWeek: DOW, startTime: '09:00', endTime: '18:00', breakStart: '15:00', breakEnd: '16:30', isActive: true }] });
r = await reservar(cliente, { ...base, startTime: '15:30' });
chequear('cae en el corte del local, rechazado', r.error === 'FAILED_PRECONDITION', JSON.stringify(r));
r = await reservar(cliente, { ...base, startTime: '14:45' });
chequear('termina adentro del corte del local (14:45–15:15), rechazado', r.error === 'FAILED_PRECONDITION', JSON.stringify(r));
await db.doc(`businesses/${BID}`).update({ businessHours: [{ dayOfWeek: DOW, startTime: '09:00', endTime: '18:00', isActive: true }] });

titulo('Teléfono:');
const c3 = await usuario('c3@gmail.com');
r = await reservar(c3, { ...base, startTime: '15:00', clientPhone: '123' });
chequear('teléfono corto, rechazado', r.error === 'INVALID_ARGUMENT', JSON.stringify(r));
r = await reservar(c3, { ...base, startTime: '15:00', clientPhone: 'hola' });
chequear('teléfono sin dígitos, rechazado', r.error === 'INVALID_ARGUMENT', JSON.stringify(r));
r = await reservar(c3, { ...base, startTime: '15:00', clientPhone: '' });
chequear('teléfono vacío, rechazado', r.error === 'INVALID_ARGUMENT', JSON.stringify(r));
r = await reservar(c3, { ...base, startTime: '15:00', clientPhone: '1123456789' });
chequear('10 dígitos sin código de país, permitido', r.ok?.status === 'created', JSON.stringify(r));

titulo('Un turno por día:');
// `cliente` ya reservó a las 10:00. Otro el mismo día, en otro horario libre:
r = await reservar(cliente, { ...base, startTime: '16:00' });
chequear('segundo turno el mismo día, rechazado', r.error === 'ALREADY_EXISTS', JSON.stringify(r));

titulo('Doble reserva (otro cliente, sin turno ese día):');
const c4 = await usuario('c4@gmail.com');
r = await reservar(c4, { ...base, startTime: '10:15' });
chequear('se solapa con el de las 10:00, rechazado', r.error === 'ALREADY_EXISTS', JSON.stringify(r));
r = await reservar(c4, { ...base, startTime: '10:30' });
chequear('pegado al anterior (10:30), permitido', r.ok?.status === 'created', JSON.stringify(r));

titulo('Negocio suspendido por deuda:');
await db.doc(`businesses/${BID}`).update({ isFrozen: true });
const c5 = await usuario('c5@gmail.com');
r = await reservar(c5, { ...base, startTime: '16:00' });
chequear('barbería suspendida, no toma turnos', r.error === 'FAILED_PRECONDITION', JSON.stringify(r));
await db.doc(`businesses/${BID}`).update({ isFrozen: false });

titulo('Sin sesión:');
r = await reservar(null, { ...base, startTime: '16:30' });
chequear('anónimo, rechazado', r.error === 'UNAUTHENTICATED', JSON.stringify(r));

titulo('Tope de turnos a futuro por cuenta (3):');
// Martes siguientes al FECHA base, para que caigan en el único día con horario.
const MARTES = ['2027-03-09', '2027-03-16', '2027-03-23', '2027-03-30'];
const c6 = await usuario('c6@gmail.com');
r = await reservar(c6, { ...base, startTime: '09:00' });
chequear('1º turno (FECHA base), creado', r.ok?.status === 'created', JSON.stringify(r));
r = await reservar(c6, { ...base, appointmentDate: MARTES[0], startTime: '09:00' });
chequear('2º turno, creado', r.ok?.status === 'created', JSON.stringify(r));
r = await reservar(c6, { ...base, appointmentDate: MARTES[1], startTime: '09:00' });
const tercero = r.ok?.id;
chequear('3º turno, creado', r.ok?.status === 'created', JSON.stringify(r));
r = await reservar(c6, { ...base, appointmentDate: MARTES[2], startTime: '09:00' });
chequear('4º turno, rechazado por tope', r.error === 'RESOURCE_EXHAUSTED', JSON.stringify(r));
await db.doc(`businesses/${BID}/appointments/${tercero}`).update({ status: 'cancelada' });
r = await reservar(c6, { ...base, appointmentDate: MARTES[2], startTime: '09:00' });
chequear('cancelado uno, vuelve a poder reservar', r.ok?.status === 'created', JSON.stringify(r));
// Un turno viejo que quedó 'pendiente' porque nadie lo marcó no cuenta: ya pasó.
for (const fecha of ['2020-01-07', '2020-01-14']) {
  await db.collection(`businesses/${BID}/appointments`).add({
    businessId: BID, userId: c6.uid, professionalId: PROF, serviceId: SRV,
    appointmentDate: fecha, startTime: '09:00', endTime: '09:30', status: 'pendiente',
  });
}
// Quedan 3 activos a futuro (base, MARTES[0], MARTES[2]) + 2 viejos. Se cancela
// uno a futuro: con 2 a futuro tiene que entrar; si los viejos contaran serían
// 4 y se rechazaría.
const cuarto = (await db.collection(`businesses/${BID}/appointments`)
  .where('userId', '==', c6.uid).where('appointmentDate', '==', MARTES[2]).get()).docs[0];
await cuarto.ref.update({ status: 'cancelada' });
r = await reservar(c6, { ...base, appointmentDate: MARTES[3], startTime: '09:00' });
chequear('los turnos pasados no cuentan para el tope', r.ok?.status === 'created', JSON.stringify(r));

titulo('Promo por día y franja (ventana del servicio):');
// Corte de media tarde: solo martes (1) y miércoles (2), de 16:30 a 19:30.
await db.doc(`businesses/${BID}/services/srv-promo`).set({
  name: 'Corte de media tarde', price: 10800, durationMinutes: 30, isActive: true,
  ventana: { dias: [1, 2], desde: '16:30', hasta: '19:30' },
});
await db.doc(`businesses/${BID}/professionalServices/ps-promo`).set({ professionalId: PROF, serviceId: 'srv-promo' });
const c8 = await usuario('c8@gmail.com');
// FECHA es martes → día ok. 15:00 está fuera de la franja.
r = await reservar(c8, { ...base, serviceId: 'srv-promo', startTime: '15:00' });
chequear('martes 15:00: fuera de la franja, rechazado', r.error === 'FAILED_PRECONDITION', JSON.stringify(r));
// El caso de Lucas: la promo va hasta 19:30 pero el barbero cierra 18:00.
// 17:45 arranca dentro de las dos cosas y termina 18:15, después del cierre.
// Antes esto se rechazaba y la promo quedaba sin un solo horario para él.
const c8b = await usuario('c8b@gmail.com');
r = await reservar(c8b, { ...base, serviceId: 'srv-promo', appointmentDate: MARTES[3], startTime: '17:45' });
chequear('martes 17:45: promo que termina pasado el cierre, se toma', r.ok?.status === 'created' && r.ok?.price === 10800, JSON.stringify(r));
r = await reservar(c8, { ...base, serviceId: 'srv-promo', startTime: '17:00' });
chequear('martes 17:00: adentro, creado', r.ok?.status === 'created' && r.ok?.price === 10800, JSON.stringify(r));
// Un jueves (2027-03-04) no aplica aunque el horario esté bien. El barbero no
// trabaja jueves en este escenario, así que se le agrega horario para que el
// rechazo sea por la promo y no por la agenda.
await db.doc(`businesses/${BID}/schedules/sch-jueves`).set({ professionalId: PROF, dayOfWeek: 3, startTime: '09:00', endTime: '20:00', isActive: true });
await db.doc(`businesses/${BID}`).update({ businessHours: [{ dayOfWeek: DOW, startTime: '09:00', endTime: '18:00', isActive: true }, { dayOfWeek: 3, startTime: '09:00', endTime: '20:00', isActive: true }] });
const c9 = await usuario('c9@gmail.com');
r = await reservar(c9, { ...base, serviceId: 'srv-promo', appointmentDate: '2027-03-04', startTime: '17:00' });
chequear('jueves 17:00: la promo no es los jueves, rechazado', r.error === 'FAILED_PRECONDITION', JSON.stringify(r));
r = await reservar(c9, { ...base, serviceId: SRV, appointmentDate: '2027-03-04', startTime: '17:00' });
chequear('jueves 17:00 con el corte común: creado', r.ok?.status === 'created', JSON.stringify(r));

// Con el jueves abierto hasta las 20:00 se puede probar el límite de la propia
// promo, sin que el horario del barbero conteste antes.
await db.doc(`businesses/${BID}/services/srv-promo`).update({ ventana: { dias: [1, 2, 3], desde: '16:30', hasta: '19:30' } });
const c10 = await usuario('c10@gmail.com');
r = await reservar(c10, { ...base, serviceId: 'srv-promo', appointmentDate: '2027-03-04', startTime: '19:15' });
chequear('jueves 19:15: arranca dentro de la promo aunque termine después, se toma', r.ok?.status === 'created', JSON.stringify(r));
const c11 = await usuario('c11@gmail.com');
r = await reservar(c11, { ...base, serviceId: 'srv-promo', appointmentDate: '2027-03-04', startTime: '19:30' });
chequear('jueves 19:30: la promo ya cerró, rechazado', r.error === 'FAILED_PRECONDITION', JSON.stringify(r));

titulo('getBusySlots — solo horas, sin datos de otros clientes:');
const c7 = await usuario('c7@gmail.com');
r = await llamar(c7, 'getBusySlots', { businessId: BID, professionalId: PROF, appointmentDate: FECHA });
const ocupados = r.ok?.ocupados || [];
chequear('devuelve los turnos activos del día', ocupados.length >= 3, JSON.stringify(r));
chequear('cada uno trae startTime y endTime', ocupados.every((o) => o.startTime && o.endTime), JSON.stringify(ocupados));
chequear('ninguno trae nombre, teléfono ni userId',
  ocupados.every((o) => !('clientName' in o) && !('clientPhone' in o) && !('userId' in o) && !('clientEmail' in o)),
  JSON.stringify(ocupados));
r = await llamar(c7, 'getBusySlots', { businessId: BID, professionalId: PROF, appointmentDate: MARTES[1] });
chequear('el día del turno cancelado viene vacío', r.ok?.ocupados?.length === 0, JSON.stringify(r));
r = await llamar(null, 'getBusySlots', { businessId: BID, professionalId: PROF, appointmentDate: FECHA });
chequear('anónimo también la ve (la grilla es pública, sin datos de nadie)', r.ok?.ocupados?.length >= 3, JSON.stringify(r));
r = await llamar(c7, 'getBusySlots', { businessId: BID, professionalId: PROF, appointmentDate: '2/3/2027' });
chequear('fecha mal formada, rechazada', r.error === 'INVALID_ARGUMENT', JSON.stringify(r));

titulo('Adicionales (cejas, lavado…: se suman al servicio, no son un turno):');
await db.doc(`businesses/${BID}/services/srv-cejas`).set({ name: 'Perfilado de cejas', price: 4000, durationMinutes: 15, isActive: true, adicional: true });
await db.doc(`businesses/${BID}/services/srv-cafe`).set({ name: 'Café', price: 4000, durationMinutes: 5, isActive: true, adicional: true });
await db.doc(`businesses/${BID}/services/srv-viejo`).set({ name: 'Mascarilla', price: 5000, durationMinutes: 10, isActive: false, adicional: true });
await db.doc(`businesses/${BID}/professionalServices/ps-cejas`).set({ professionalId: PROF, serviceId: 'srv-cejas' });
const c12 = await usuario('c12@gmail.com');
r = await reservar(c12, { ...base, appointmentDate: '2027-03-16', startTime: '10:00', adicionales: ['srv-cejas', 'srv-cafe', 'srv-cejas'] });
chequear('corte + cejas + café: el precio suma los adicionales (sin contar dos veces el repetido)', r.ok?.price === 20000, JSON.stringify(r));
const tAd = r.ok?.id ? (await db.doc(`businesses/${BID}/appointments/${r.ok.id}`).get()).data() : null;
chequear('el turno guarda qué adicionales lleva, con su precio', tAd?.adicionales?.length === 2 && tAd.adicionales.every((a) => a.name && a.price === 4000), JSON.stringify(tAd?.adicionales));
chequear('los adicionales no alargan el turno', tAd?.endTime === '10:30', tAd?.endTime);
const c13 = await usuario('c13@gmail.com');
r = await reservar(c13, { ...base, serviceId: 'srv-cejas', appointmentDate: '2027-03-16', startTime: '11:00' });
chequear('un adicional solo no se reserva como turno', r.error === 'FAILED_PRECONDITION', JSON.stringify(r));
r = await reservar(c13, { ...base, appointmentDate: '2027-03-16', startTime: '11:00', adicionales: ['srv-viejo'] });
chequear('un adicional desactivado se rechaza', r.error === 'FAILED_PRECONDITION', JSON.stringify(r));
r = await reservar(c13, { ...base, appointmentDate: '2027-03-16', startTime: '11:00', adicionales: [SRV_HUERFANO] });
chequear('un servicio común no se puede colar como adicional', r.error === 'FAILED_PRECONDITION', JSON.stringify(r));
r = await reservar(c13, { ...base, appointmentDate: '2027-03-16', startTime: '11:00', adicionales: ['no-existe'] });
chequear('un adicional que no existe se rechaza', r.error === 'FAILED_PRECONDITION', JSON.stringify(r));

titulo('Recargo por pagar con tarjeta o QR:');
const c14 = await usuario('c14@gmail.com');
r = await reservar(c14, { ...base, appointmentDate: '2027-03-23', startTime: '10:00', metodoPago: 'tarjeta' });
chequear('sin recargo configurado, elegir tarjeta no cambia el precio', r.ok?.price === 12000, JSON.stringify(r));
await db.doc(`businesses/${BID}`).update({ recargoTarjeta: 2000 });
const c15 = await usuario('c15@gmail.com');
r = await reservar(c15, { ...base, appointmentDate: '2027-03-23', startTime: '11:00', metodoPago: 'tarjeta', adicionales: ['srv-cejas'] });
chequear('con tarjeta: servicio + adicional + recargo', r.ok?.price === 18000, JSON.stringify(r));
const tRec = r.ok?.id ? (await db.doc(`businesses/${BID}/appointments/${r.ok.id}`).get()).data() : null;
chequear('el turno guarda que paga con tarjeta y cuánto fue el recargo', tRec?.metodoPago === 'tarjeta' && tRec?.recargoTarjeta === 2000, JSON.stringify({ m: tRec?.metodoPago, r: tRec?.recargoTarjeta }));
const c16 = await usuario('c16@gmail.com');
r = await reservar(c16, { ...base, appointmentDate: '2027-03-23', startTime: '12:00', metodoPago: 'efectivo' });
chequear('en efectivo no hay recargo', r.ok?.price === 12000, JSON.stringify(r));
const c17 = await usuario('c17@gmail.com');
r = await reservar(c17, { ...base, appointmentDate: '2027-03-23', startTime: '14:00', metodoPago: 'cualquiera' });
chequear('un método inventado no suma recargo', r.ok?.price === 12000, JSON.stringify(r));
await db.doc(`businesses/${BID}`).update({ recargoTarjeta: 0 });

titulo('Ausencias: el día suelto que el barbero no va:');
// El motor del navegador no ofrece esos horarios, pero con la consola abierta
// se saltea: esta es la barrera de verdad. El caso que lo pidió: una sucursal
// con dos barberos, y justo ESTE miércoles Pepito no puede — sin perder todos
// los miércoles siguientes.
const AUS = `businesses/${BID}/ausencias`;
const FECHA_AUS = '2027-03-30';   // mismo día de semana que FECHA
const FECHA_LIBRE = '2027-04-06'; // el siguiente: tiene que seguir andando

// a) Día completo
await db.doc(`${AUS}/${PROF}_${FECHA_AUS}_todo`).set({ professionalId: PROF, fecha: FECHA_AUS, desde: null, hasta: null });
const cA1 = await usuario('aus1@gmail.com');
r = await reservar(cA1, { ...base, appointmentDate: FECHA_AUS, startTime: '10:00' });
chequear('con el día marcado, el servidor RECHAZA', Boolean(r.error), JSON.stringify(r));
chequear('y dice por qué', String(r.mensaje || '').includes('no atiende ese día'), JSON.stringify(r.error));

const cA2 = await usuario('aus2@gmail.com');
r = await reservar(cA2, { ...base, appointmentDate: FECHA_LIBRE, startTime: '10:00' });
chequear('el mismo día de la semana SIGUIENTE sigue libre (ese era el pedido)', r.ok?.status === 'created', JSON.stringify(r));

// La ausencia de OTRO barbero no bloquea a este.
await db.doc(`${AUS}/otro-prof_${FECHA_AUS}_todo`).set({ professionalId: 'otro-prof', fecha: FECHA_AUS, desde: null, hasta: null });
await db.doc(`${AUS}/${PROF}_${FECHA_AUS}_todo`).delete();
const cA3 = await usuario('aus3@gmail.com');
r = await reservar(cA3, { ...base, appointmentDate: FECHA_AUS, startTime: '10:00' });
chequear('la ausencia de otro barbero no lo bloquea', r.ok?.status === 'created', JSON.stringify(r));
await db.doc(`${AUS}/otro-prof_${FECHA_AUS}_todo`).delete();

// b) Franja: se va de 15:00 a 17:00 de ESE día
const FECHA_FRANJA = '2027-04-13';
await db.doc(`${AUS}/${PROF}_${FECHA_FRANJA}_1500`).set({ professionalId: PROF, fecha: FECHA_FRANJA, desde: '15:00', hasta: '17:00' });
const cB1 = await usuario('ausb1@gmail.com');
r = await reservar(cB1, { ...base, appointmentDate: FECHA_FRANJA, startTime: '15:30' });
chequear('adentro de la franja, rechaza', Boolean(r.error), JSON.stringify(r));
chequear('y nombra el horario', String(r.mensaje || '').includes('15:00'), JSON.stringify(r.error));

const cB2 = await usuario('ausb2@gmail.com');
r = await reservar(cB2, { ...base, appointmentDate: FECHA_FRANJA, startTime: '14:30' });
chequear('un turno que TERMINA justo cuando empieza la franja, entra', r.ok?.status === 'created', JSON.stringify(r));

const cB3 = await usuario('ausb3@gmail.com');
r = await reservar(cB3, { ...base, appointmentDate: FECHA_FRANJA, startTime: '14:45' });
chequear('uno que la pisa de costado (14:45-15:15), no', Boolean(r.error), JSON.stringify(r));

const cB4 = await usuario('ausb4@gmail.com');
r = await reservar(cB4, { ...base, appointmentDate: FECHA_FRANJA, startTime: '17:00' });
chequear('uno que empieza justo cuando termina, entra', r.ok?.status === 'created', JSON.stringify(r));

const cB5 = await usuario('ausb5@gmail.com');
r = await reservar(cB5, { ...base, appointmentDate: FECHA_FRANJA, startTime: '10:00' });
chequear('la mañana de ese día sigue intacta', r.ok?.status === 'created', JSON.stringify(r));

// c) Falla CERRADO: una ausencia ilegible bloquea el día, no lo deja pasar.
const FECHA_ROTA = '2027-04-20';
await db.doc(`${AUS}/${PROF}_${FECHA_ROTA}_rota`).set({ professionalId: PROF, fecha: FECHA_ROTA, desde: 'xx', hasta: 'yy' });
const cC1 = await usuario('ausc1@gmail.com');
r = await reservar(cC1, { ...base, appointmentDate: FECHA_ROTA, startTime: '10:00' });
chequear('una ausencia con horas ilegibles bloquea el día entero (falla cerrado)', Boolean(r.error), JSON.stringify(r));

for (const d of (await db.collection(AUS).get()).docs) await d.ref.delete();

console.log(`\n${ok} pasaron, ${mal} fallaron\n`);
process.exit(mal ? 1 : 0);
