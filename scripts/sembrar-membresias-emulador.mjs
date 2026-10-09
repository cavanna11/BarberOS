// Siembra una barbería con membresías en el emulador, para mirar las pantallas
// en el browser. No es una prueba (esa es test-membresias-emulador.mjs): es un
// escenario para ver.
//
//   firebase emulators:start --only auth,firestore,functions
//   node scripts/sembrar-membresias-emulador.mjs
//   VITE_USE_EMULATORS=true npm run dev
//
// Todo se carga por las Functions de verdad (como lo haría el dueño), no
// escribiendo directo: así lo que se ve es lo que produce el sistema.
// Después se entra con "Continuar con Google" eligiendo la cuenta que imprime.
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const PROJECT = 'barberos-1d60e';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
initializeApp({ projectId: PROJECT });
const db = getFirestore(), auth = getAuth();
const FN = `http://127.0.0.1:5001/${PROJECT}/southamerica-east1`;
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';

const BIZ = 'memb-demo';
const SLUG = 'membresias-demo';
const DUENO = 'dueno-membresias@gmail.com';
const BARBERO = 'barbero-membresias@gmail.com';
const CLIENTES = [
  ['juan-membresia@gmail.com', 'Juan Pérez'],
  ['sofi-membresia@gmail.com', 'Sofía Gómez'],
  ['nico-membresia@gmail.com', 'Nicolás Ruiz'],
];

const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
const dia = (n) => { const d = new Date(`${hoy}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

await db.recursiveDelete(db.doc(`businesses/${BIZ}`)).catch(() => {});
await db.doc(`slugs/${SLUG}`).set({ businessId: BIZ });
const horario = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startTime: '09:00', endTime: '20:00', isActive: true }));
await db.doc(`businesses/${BIZ}`).set({
  id: BIZ, name: 'Barbería del Socio', slug: SLUG, isFrozen: false, businessHours: horario, slotInterval: 30,
  phone: '2257 52-9684', address: 'Av. Siempreviva 742', city: 'Mar del Plata', currency: 'ARS', planId: 'full',
  minCancelHours: 2, createdAt: new Date(), membresiasHabilitadas: true,
});
const servicios = [['corte', 'Corte', 12000, 30], ['barba', 'Barba', 8000, 30], ['corte-barba', 'Corte + barba', 18000, 60]];
for (const [id, name, price, durationMinutes] of servicios) {
  await db.doc(`businesses/${BIZ}/services/${id}`).set({ id, name, price, durationMinutes, isActive: true, description: '' });
}
for (const prof of [['lucas', 'Lucas'], ['mati', 'Mati']]) {
  await db.doc(`businesses/${BIZ}/professionals/${prof[0]}`).set({ id: prof[0], name: prof[1], isActive: true, specialty: 'Barbero' });
  for (const [srv] of servicios) await db.doc(`businesses/${BIZ}/professionalServices/${prof[0]}-${srv}`).set({ professionalId: prof[0], serviceId: srv });
  for (const h of horario) await db.doc(`businesses/${BIZ}/schedules/${prof[0]}-${h.dayOfWeek}`).set({ professionalId: prof[0], ...h });
}

async function cuenta(email, claims = null, nombre = email.split('@')[0]) {
  let u;
  try { u = await auth.getUserByEmail(email); } catch { u = await auth.createUser({ email, emailVerified: true, displayName: nombre }); }
  await auth.setCustomUserClaims(u.uid, claims);
  const r = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: await auth.createCustomToken(u.uid), returnSecureToken: true }),
  });
  return { uid: u.uid, token: (await r.json()).idToken };
}
async function llamar(nombre, u, data) {
  const r = await fetch(`${FN}/${nombre}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${u.token}` }, body: JSON.stringify({ data }),
  });
  const j = await r.json();
  if (j.error) throw new Error(`${nombre}: ${j.error.message}`);
  return j.result;
}

const dueno = await cuenta(DUENO, { businessId: BIZ, role: 'owner', businessIds: [BIZ] });
await cuenta(BARBERO, { businessId: BIZ, role: 'admin', professionalId: 'lucas' });

const plan = await llamar('guardarPlanMembresia', dueno, {
  businessId: BIZ, nombre: 'Corte Mensual', descripcion: 'Cuatro cortes por mes', precioMensual: 25000,
  beneficios: [{ id: 'cortes', nombre: 'Corte', usos: 4, servicios: [{ businessId: BIZ, serviceId: 'corte' }] }],
});
const premium = await llamar('guardarPlanMembresia', dueno, {
  businessId: BIZ, nombre: 'Premium', descripcion: 'Cortes ilimitados y barba', precioMensual: 40000,
  beneficios: [
    { id: 'cortes', nombre: 'Corte', usos: null, servicios: [{ businessId: BIZ, serviceId: 'corte' }, { businessId: BIZ, serviceId: 'corte-barba' }] },
    { id: 'barba', nombre: 'Barba', usos: 4, servicios: [{ businessId: BIZ, serviceId: 'barba' }] },
  ],
});

const clientes = [];
for (const [email, nombre] of CLIENTES) clientes.push(await cuenta(email, null, nombre));
await llamar('cargarMembresia', dueno, { businessId: BIZ, planId: plan.id, clienteEmail: CLIENTES[0][0], clienteNombre: CLIENTES[0][1], clienteTelefono: '11 2345-6789', desde: dia(-5) });
await llamar('cargarMembresia', dueno, { businessId: BIZ, planId: premium.id, clienteEmail: CLIENTES[1][0], clienteNombre: CLIENTES[1][1], desde: dia(-12) });
await llamar('cargarMembresia', dueno, { businessId: BIZ, planId: plan.id, clienteEmail: 'todavia-no-entro@gmail.com', clienteNombre: 'Martín (todavía no entró)', desde: hoy, notas: 'Paga por transferencia' });

// Juan ya usó dos: uno atendido, otro reservado. Nico reserva normal.
const reservar = (u, fecha, hora, srv, usar) => llamar('createAppointment', u, {
  businessId: BIZ, professionalId: 'lucas', serviceId: srv, appointmentDate: fecha, startTime: hora,
  clientName: u === clientes[0] ? 'Juan Pérez' : u === clientes[1] ? 'Sofía Gómez' : 'Nicolás Ruiz',
  clientPhone: '1123456789', usarMembresia: usar,
});
const t1 = await reservar(clientes[0], hoy, '10:00', 'corte', true);
await reservar(clientes[0], dia(3), '11:00', 'corte', true);
await reservar(clientes[1], hoy, '12:00', 'barba', true);
await reservar(clientes[2], hoy, '15:00', 'corte', false);
await db.doc(`businesses/${BIZ}/appointments/${t1.id}`).update({ status: 'completada' });

console.log(`
Listo. Barbería "Barbería del Socio" → http://localhost:5173/${SLUG}

  Dueño:    ${DUENO}      (Membresías, Citas, Dashboard)
  Barbero:  ${BARBERO}    (ve "Membresía — no se cobra" en su agenda)
  Clientes: ${CLIENTES[0][0]} (Corte Mensual, 2 de 4 usados)
            ${CLIENTES[1][0]} (Premium)
            ${CLIENTES[2][0]} (sin membresía)

Entrá con "Continuar con Google" y elegí la cuenta.
`);
process.exit(0);
