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

titulo('Viene con alguien (un turno que atiende a dos, uno atrás del otro):');
const DIA_AC = '2027-04-20';   // mismo día de semana que FECHA
await db.doc(`businesses/${BID}/services/srv-nino`).set({ name: 'Corte niño', price: 8000, durationMinutes: 20, isActive: true });
await db.doc(`businesses/${BID}/professionalServices/ps-nino`).set({ professionalId: PROF, serviceId: 'srv-nino' });
const ca1 = await usuario('ca1@gmail.com');
r = await reservar(ca1, { ...base, appointmentDate: DIA_AC, startTime: '10:00', acompanante: { serviceId: 'srv-nino' } });
chequear('corte + corte niño: el precio suma el del acompañante', r.ok?.price === 20000, JSON.stringify(r));
chequear('y el turno dura los dos servicios seguidos (30 + 20)', r.ok?.endTime === '10:50', JSON.stringify(r));
const tAc = r.ok?.id ? (await db.doc(`businesses/${BID}/appointments/${r.ok.id}`).get()).data() : null;
chequear('el turno guarda el servicio del acompañante y la duración total',
  tAc?.acompanante?.serviceId === 'srv-nino' && tAc?.acompanante?.price === 8000 && tAc?.durationMinutes === 50,
  JSON.stringify({ a: tAc?.acompanante, d: tAc?.durationMinutes }));
const ca2 = await usuario('ca2@gmail.com');
r = await reservar(ca2, { ...base, appointmentDate: DIA_AC, startTime: '10:30' });
chequear('el bloque entero queda ocupado: a las 10:30 ya no se puede', r.error === 'ALREADY_EXISTS', JSON.stringify(r));
r = await reservar(ca2, { ...base, appointmentDate: DIA_AC, startTime: '10:50' });
chequear('y a las 10:50, justo cuando termina, sí', r.ok?.status === 'created', JSON.stringify(r));
r = await reservar(ca2, { ...base, appointmentDate: DIA_AC, startTime: '11:30', acompanante: { serviceId: 'srv-nino' } });
chequear('el padre con el hijo no gasta un segundo cupo: sigue valiendo un turno por día', r.error === 'ALREADY_EXISTS', JSON.stringify(r));
const ca3 = await usuario('ca3@gmail.com');
r = await reservar(ca3, { ...base, appointmentDate: DIA_AC, startTime: '14:00', acompanante: { serviceId: 'no-existe' } });
chequear('un servicio de acompañante que no existe se rechaza', r.error === 'FAILED_PRECONDITION', JSON.stringify(r));
r = await reservar(ca3, { ...base, appointmentDate: DIA_AC, startTime: '14:00', acompanante: { serviceId: 'srv-cejas' } });
chequear('un adicional no vale como acompañante', r.error === 'FAILED_PRECONDITION', JSON.stringify(r));
r = await reservar(ca3, { ...base, appointmentDate: DIA_AC, startTime: '14:00', acompanante: { serviceId: SRV_HUERFANO } });
chequear('un servicio que el barbero no hace se rechaza', r.error === 'FAILED_PRECONDITION', JSON.stringify(r));
r = await reservar(ca3, { ...base, appointmentDate: DIA_AC, startTime: '17:45', acompanante: { serviceId: 'srv-nino' } });
chequear('arranca dentro del horario aunque el bloque termine después del cierre', r.ok?.status === 'created' && r.ok?.endTime === '18:35', JSON.stringify(r));

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

titulo('"Cualquier barbero": lo elige el SERVIDOR:');
// Si lo eligiera el navegador, dos clientes mirando la misma grilla mandarían
// el mismo barbero y el segundo recibiría "ya fue tomado" con el otro libre al
// lado. Por eso la elección va adentro de la transacción.
const PROF2 = 'prof-2';
await db.doc(`businesses/${BID}/professionals/${PROF2}`).set({ name: 'Segundo', isActive: true });
await db.doc(`businesses/${BID}/professionalServices/ps-2`).set({ professionalId: PROF2, serviceId: SRV });
await db.doc(`businesses/${BID}/schedules/sch-2`).set({
  professionalId: PROF2, dayOfWeek: DOW, startTime: '09:00', endTime: '18:00',
  breakStart: '13:00', breakEnd: '14:00', isActive: true,
});

const FECHA_Q = '2027-05-04';   // mismo día de semana que FECHA
const cQ1 = await usuario('q1@gmail.com');
r = await reservar(cQ1, { ...base, professionalId: 'cualquiera', appointmentDate: FECHA_Q, startTime: '10:00' });
chequear('reserva sin elegir barbero', r.ok?.status === 'created', JSON.stringify(r));
chequear('el servidor devuelve a QUIÉN le tocó',
  [PROF, PROF2].includes(r.ok?.professionalId), JSON.stringify(r.ok?.professionalId));
chequear('y su nombre, para poder decírselo', Boolean(r.ok?.professionalName), JSON.stringify(r.ok));
const primero = r.ok?.professionalId;
const guardadoQ = (await db.doc(`businesses/${BID}/appointments/${r.ok.id}`).get()).data();
chequear('el turno se guarda con el barbero elegido, no con el centinela',
  guardadoQ.professionalId === primero, String(guardadoQ.professionalId));

// El mismo horario otra vez: tiene que caer en el OTRO, no fallar.
const cQ2 = await usuario('q2@gmail.com');
r = await reservar(cQ2, { ...base, professionalId: 'cualquiera', appointmentDate: FECHA_Q, startTime: '10:00' });
chequear('el segundo cliente a la misma hora entra con el OTRO barbero',
  r.ok?.status === 'created' && r.ok?.professionalId !== primero,
  JSON.stringify([r.ok?.professionalId, primero, r.error, r.mensaje]));

// Con los dos ocupados, recién ahí se rechaza.
const cQ3 = await usuario('q3@gmail.com');
r = await reservar(cQ3, { ...base, professionalId: 'cualquiera', appointmentDate: FECHA_Q, startTime: '10:00' });
chequear('con los dos ocupados, rechaza', Boolean(r.error), JSON.stringify(r));
chequear('y lo dice en plural', String(r.mensaje || '').includes('todos los profesionales'), JSON.stringify(r.mensaje));

// Si uno solo hace el servicio, "cualquiera" cae en ese.
await db.doc(`businesses/${BID}/professionalServices/ps-2`).delete();
const cQ4 = await usuario('q4@gmail.com');
r = await reservar(cQ4, { ...base, professionalId: 'cualquiera', appointmentDate: '2027-05-11', startTime: '10:00' });
chequear('si solo uno hace el servicio, le toca ese',
  r.ok?.professionalId === PROF, JSON.stringify([r.ok?.professionalId, r.mensaje]));
await db.doc(`businesses/${BID}/professionalServices/ps-2`).set({ professionalId: PROF2, serviceId: SRV });

// Fuera de horario: el motivo tiene que ser el real, no "no hay nadie".
const cQ5 = await usuario('q5@gmail.com');
r = await reservar(cQ5, { ...base, professionalId: 'cualquiera', appointmentDate: '2027-05-11', startTime: '08:00' });
chequear('fuera de horario explica el motivo de verdad',
  String(r.mensaje || '').includes('horario de atención'), JSON.stringify(r.mensaje));

// Una ausencia de uno no bloquea al otro.
await db.doc(`businesses/${BID}/ausencias/${PROF}_2027-05-18_todo`).set({ professionalId: PROF, fecha: '2027-05-18', desde: null, hasta: null });
const cQ6 = await usuario('q6@gmail.com');
r = await reservar(cQ6, { ...base, professionalId: 'cualquiera', appointmentDate: '2027-05-18', startTime: '10:00' });
chequear('si uno está ausente, le toca el otro',
  r.ok?.professionalId === PROF2, JSON.stringify([r.ok?.professionalId, r.mensaje]));

// Los dos ausentes: el motivo es la ausencia, no "no hay nadie".
await db.doc(`businesses/${BID}/ausencias/${PROF2}_2027-05-18_todo`).set({ professionalId: PROF2, fecha: '2027-05-18', desde: null, hasta: null });
const cQ7 = await usuario('q7@gmail.com');
r = await reservar(cQ7, { ...base, professionalId: 'cualquiera', appointmentDate: '2027-05-18', startTime: '11:00' });
chequear('con todos ausentes, el motivo es la ausencia',
  String(r.mensaje || '').includes('no atiende ese día'), JSON.stringify(r.mensaje));
for (const d of (await db.collection(`businesses/${BID}/ausencias`).get()).docs) await d.ref.delete();

// Y el camino de siempre no cambió.
const cQ8 = await usuario('q8@gmail.com');
r = await reservar(cQ8, { ...base, professionalId: 'NO-EXISTE', appointmentDate: '2027-05-25', startTime: '10:00' });
chequear('un profesional inexistente sigue siendo un error', Boolean(r.error), JSON.stringify(r));

for (const d of (await db.collection(`businesses/${BID}/appointments`).get()).docs) {
  if ((d.data().appointmentDate || '') >= '2027-05-01') await d.ref.delete();
}
await db.doc(`businesses/${BID}/professionals/${PROF2}`).delete();
await db.doc(`businesses/${BID}/professionalServices/ps-2`).delete();
await db.doc(`businesses/${BID}/schedules/sch-2`).delete();

// ============================================================================
// PRODUCTOS (22/10/2026)
// ============================================================================
// "Los barberos quieren subir una cera para el pelo que venden." El precio y el
// stock los decide el servidor, y el stock baja DENTRO de la transacción del
// turno: es el único momento en que dos clientes pidiendo la última unidad no
// se la pueden llevar los dos.
//
// Lo que estos casos protegen:
//   - que el precio salga del documento y no del cliente (lo de siempre),
//   - que no se pueda comprar lo que no hay,
//   - que la venta quede con el barbero que la hizo (es lo que se pidió),
//   - y que el stock VUELVA si el turno se cancela o el cliente no viene.
titulo('Productos:');

const CERA = 'prod-cera', GEL = 'prod-gel', AGOTADO = 'prod-agotado', INACT = 'prod-inactivo';
const prodRef = (id) => db.doc(`businesses/${BID}/productos/${id}`);
const leerStock = async (id) => (await prodRef(id).get()).get('stock');
/** Espera a que el trigger mueva el stock al valor esperado. */
async function esperarStock(id, valor, ms = 25000) {
  const hasta = Date.now() + ms;
  while (Date.now() < hasta) {
    if ((await leerStock(id)) === valor) return true;
    await new Promise((res) => setTimeout(res, 500));
  }
  return false;
}
/** Lo mismo para el estado de la venta. */
async function esperarVenta(aptId, estado, ms = 25000) {
  const hasta = Date.now() + ms;
  while (Date.now() < hasta) {
    const d = (await db.doc(`businesses/${BID}/ventasProductos/${aptId}`).get()).data();
    if (d && d.estado === estado) return true;
    await new Promise((res) => setTimeout(res, 500));
  }
  return false;
}
const venta = async (aptId) => (await db.doc(`businesses/${BID}/ventasProductos/${aptId}`).get()).data();

await prodRef(CERA).set({ name: 'Cera mate', price: 5000, stock: 3, isActive: true, vendidos: 0 });
await prodRef(GEL).set({ name: 'Gel', price: 3000, stock: null, isActive: true, vendidos: 0 });
await prodRef(AGOTADO).set({ name: 'Shampoo', price: 8000, stock: 0, isActive: true, vendidos: 0 });
await prodRef(INACT).set({ name: 'Pomada', price: 6000, stock: 9, isActive: false, vendidos: 0 });

const pFecha = '2027-06-01'; // lunes
const cP1 = await usuario('prod1@gmail.com');
r = await reservar(cP1, {
  ...base, appointmentDate: pFecha, startTime: '10:00', clientName: 'Compra',
  productos: [{ id: CERA, cantidad: 2 }],
});
chequear('se puede reservar con productos', r.ok?.status === 'created', JSON.stringify(r));
chequear('el total suma el producto (12000 + 2×5000)', r.ok?.price === 22000, JSON.stringify(r.ok));
const aptP1 = r.ok?.id;
const docP1 = aptP1 ? (await db.doc(`businesses/${BID}/appointments/${aptP1}`).get()).data() : {};
chequear('el turno guarda qué se lleva',
  (docP1.productos || []).length === 1 && docP1.productos[0].cantidad === 2,
  JSON.stringify(docP1.productos));
chequear('con el precio del DOCUMENTO, no del cliente',
  docP1.productos?.[0]?.price === 5000, JSON.stringify(docP1.productos));
chequear('bajó el stock (3 → 1)', (await leerStock(CERA)) === 1, String(await leerStock(CERA)));

let v = aptP1 ? await venta(aptP1) : null;
chequear('quedó la venta anotada', Boolean(v), JSON.stringify(v));
chequear('con el BARBERO que la hizo', v?.professionalId === PROF, JSON.stringify(v?.professionalId));
chequear('en estado reservado (todavía no se la llevó)', v?.estado === 'reservado', String(v?.estado));
chequear('con el total de los productos solos', v?.total === 10000, String(v?.total));

titulo('Lo que no se puede comprar:');
const cP2 = await usuario('prod2@gmail.com');
r = await reservar(cP2, {
  ...base, appointmentDate: pFecha, startTime: '11:00', clientName: 'Agotado',
  productos: [{ id: AGOTADO, cantidad: 1 }],
});
chequear('un producto agotado se rechaza', Boolean(r.error), JSON.stringify(r));
chequear('y el mensaje dice el nombre', /Shampoo/.test(r.mensaje || ''), r.mensaje);

r = await reservar(cP2, {
  ...base, appointmentDate: pFecha, startTime: '11:00', clientName: 'Mas que hay',
  productos: [{ id: CERA, cantidad: 2 }],
});
chequear('pedir más de lo que queda se rechaza', Boolean(r.error), JSON.stringify(r));
chequear('y dice cuántas quedan', /1 unidad/.test(r.mensaje || ''), r.mensaje);

r = await reservar(cP2, {
  ...base, appointmentDate: pFecha, startTime: '11:00', clientName: 'Inactivo',
  productos: [{ id: INACT, cantidad: 1 }],
});
chequear('un producto inactivo se rechaza', Boolean(r.error), JSON.stringify(r));

r = await reservar(cP2, {
  ...base, appointmentDate: pFecha, startTime: '11:00', clientName: 'Fantasma',
  productos: [{ id: 'no-existe', cantidad: 1 }],
});
chequear('un producto que no existe se rechaza', Boolean(r.error), JSON.stringify(r));
chequear('y ningún rechazo gastó stock', (await leerStock(CERA)) === 1, String(await leerStock(CERA)));

titulo('El producto sin control de stock:');
const cP3 = await usuario('prod3@gmail.com');
r = await reservar(cP3, {
  ...base, appointmentDate: pFecha, startTime: '12:00', clientName: 'Gel',
  productos: [{ id: GEL, cantidad: 4 }],
});
chequear('se vende sin mirar unidades', r.ok?.status === 'created', JSON.stringify(r));
chequear('y suma al total (12000 + 4×3000)', r.ok?.price === 24000, JSON.stringify(r.ok));
chequear('el stock sigue en null, NO en negativo',
  (await leerStock(GEL)) === null, String(await leerStock(GEL)));
const vGel = r.ok?.id ? await venta(r.ok.id) : null;
chequear('la venta marca que esa unidad no movió stock',
  vGel?.items?.[0]?.descontado === false, JSON.stringify(vGel?.items));

titulo('La mercadería vuelve si el turno no pasa:');
await db.doc(`businesses/${BID}/appointments/${aptP1}`).update({ status: 'cancelada', cancelledBy: 'client' });
// El trigger corre FUERA de la llamada, así que hay que esperarlo. Con una
// espera fija corta esto fallaba y parecía un bug del trigger: en el emulador
// el primer disparo de cada trigger carga el contenedor y tarda varios
// segundos. Se espera hasta que pase, con tope.
await esperarStock(CERA, 3);
chequear('al cancelar, el stock vuelve (1 → 3)',
  (await leerStock(CERA)) === 3, String(await leerStock(CERA)));
await esperarVenta(aptP1, 'devuelto');
v = await venta(aptP1);
chequear('y la venta queda como devuelta', v?.estado === 'devuelto', String(v?.estado));

// Idempotencia: el mismo estado otra vez no puede devolver dos veces. Es el
// mismo candado que el uso del cupón, y sin él el stock se va para arriba solo.
await db.doc(`businesses/${BID}/appointments/${aptP1}`).update({ status: 'confirmada' });
await new Promise((res) => setTimeout(res, 2500));
await db.doc(`businesses/${BID}/appointments/${aptP1}`).update({ status: 'cancelada', cancelledBy: 'client' });
await new Promise((res) => setTimeout(res, 6000));
chequear('cancelar, reactivar y volver a cancelar NO infla el stock',
  (await leerStock(CERA)) === 3, String(await leerStock(CERA)));

const cP4 = await usuario('prod4@gmail.com');
r = await reservar(cP4, {
  ...base, appointmentDate: '2027-06-08', startTime: '10:00', clientName: 'Atendido',
  productos: [{ id: CERA, cantidad: 1 }],
});
const aptP4 = r.ok?.id;
chequear('reserva con una cera', Boolean(aptP4), JSON.stringify(r));
chequear('bajó a 2', (await leerStock(CERA)) === 2, String(await leerStock(CERA)));
await db.doc(`businesses/${BID}/appointments/${aptP4}`).update({ status: 'completada' });
await esperarVenta(aptP4, 'vendido');
chequear('atendido: la venta se confirma', (await venta(aptP4))?.estado === 'vendido',
  String((await venta(aptP4))?.estado));
chequear('y el stock NO vuelve (se la llevó)',
  (await leerStock(CERA)) === 2, String(await leerStock(CERA)));

const cP5 = await usuario('prod5@gmail.com');
r = await reservar(cP5, {
  ...base, appointmentDate: '2027-06-15', startTime: '10:00', clientName: 'No vino',
  productos: [{ id: CERA, cantidad: 1 }],
});
const aptP5 = r.ok?.id;
await db.doc(`businesses/${BID}/appointments/${aptP5}`).update({ status: 'no_asistio' });
await esperarStock(CERA, 2);
// Acá se separa del cupón, que SÍ se consume con un no-show: el horario quedó
// bloqueado y eso es lo que el descuento pagó. La cera, en cambio, sigue en el
// estante, y cobrársela a quien no vino es ir perdiendo mercadería que nunca
// salió.
chequear('el que no vino no se llevó nada: el stock vuelve',
  (await leerStock(CERA)) === 2, String(await leerStock(CERA)));

for (const d of (await db.collection(`businesses/${BID}/appointments`).get()).docs) {
  if ((d.data().appointmentDate || '') >= '2027-06-01') await d.ref.delete();
}
for (const d of (await db.collection(`businesses/${BID}/ventasProductos`).get()).docs) await d.ref.delete();
for (const id of [CERA, GEL, AGOTADO, INACT]) await prodRef(id).delete();

console.log(`\n${ok} pasaron, ${mal} fallaron\n`);
process.exit(mal ? 1 : 0);
