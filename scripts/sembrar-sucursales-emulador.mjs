// Siembra una cuenta empresarial de tres sucursales en el emulador, para mirar
// el panel con el navegador. No es una prueba: es un escenario para ver.
//
//   firebase emulators:start --only auth,firestore,functions
//   node scripts/sembrar-sucursales-emulador.mjs
//   (con VITE_USE_EMULATORS=true en .env) npm run dev
//
// Después se entra con "Continuar con Google" eligiendo la cuenta que imprime al
// final. El Auth del emulador deja entrar con cualquier mail.
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { camposDelPlan } from '../functions/planes.js';

const PROJECT = 'barberos-1d60e';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
initializeApp({ projectId: PROJECT });
const db = getFirestore(), auth = getAuth();

const DUENO = 'dueno-sucursales@gmail.com';
const PLATAFORMA = 'cavannaprogramacion@gmail.com';

const SUCURSALES = [
  { id: 'emp-centro', name: 'Clásica Centro', slug: 'clasica-centro', principal: true },
  { id: 'emp-norte', name: 'Clásica Norte', slug: 'clasica-norte' },
  { id: 'emp-playa', name: 'Clásica Playa', slug: 'clasica-playa' },
];
const GRUPO = SUCURSALES[0].id;

const HORARIO = [0, 1, 2, 3, 4, 5].map((d) => ({
  dayOfWeek: d, startTime: '09:00', endTime: '20:00', isActive: true, breakStart: null, breakEnd: null,
}));

const hoy = new Date();
const diaDe = (resta) => {
  const d = new Date(hoy);
  d.setDate(d.getDate() - resta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

for (const s of SUCURSALES) {
  await db.recursiveDelete(db.doc(`businesses/${s.id}`)).catch(() => {});
  await db.doc(`slugs/${s.slug}`).delete().catch(() => {});
}

let n = 0;
for (const s of SUCURSALES) {
  n++;
  await db.doc(`businesses/${s.id}`).set({
    id: s.id,
    name: s.name,
    slug: s.slug,
    logoUrl: null,
    primaryColor: '#e03d00',
    secondaryColor: '#ff5c1a',
    accentColor: '#ff5c1a',
    phone: '2257 52-9684',
    email: DUENO,
    address: `Av. Siempreviva ${100 * n}`,
    city: 'Mar de Ajó',
    country: 'Argentina',
    currency: 'ARS',
    timezone: 'America/Argentina/Buenos_Aires',
    slotInterval: 30,
    minCancelHours: 2,
    onlineBookingEnabled: true,
    welcomeMessage: 'Reservá tu turno en segundos',
    socialLinks: { instagram: '', whatsapp: '2257 52-9684' },
    planId: 'empresarial',
    whatsappQuota: s.principal ? 2000 : 0,
    maxBarbers: null,
    maxSucursales: 4,
    capacidades: camposDelPlan('empresarial').capacidades,
    googleReviewUrl: 'https://g.page/r/CbarberOSdemo/review',
    grupoId: GRUPO,
    isFrozen: false,
    trialEndsAt: null,
    origen: s.principal ? 'manual' : 'sucursal',
    businessHours: HORARIO.map((h) => ({ ...h })),
    createdAt: new Date(),
  });
  await db.doc(`slugs/${s.slug}`).set({ businessId: s.id });
  await db.doc(`businesses/${s.id}/private/billing`).set({
    planId: 'empresarial',
    monthlyFee: s.principal ? 48000 : 0,
    debt: 0,
    lastPaymentDate: diaDe(10),
    nextBillingDate: diaDe(-20),
    ...(s.principal ? {} : { esSucursal: true, grupoId: GRUPO }),
  });
  await db.doc(`businesses/${s.id}/admins/${DUENO}`).set({
    email: DUENO, name: 'Santiago', role: 'owner', businessId: s.id, professionalId: null, addedAt: new Date(),
  });

  // Equipo y catálogo propios de cada sucursal: distintos a propósito, para que
  // se vea que no se mezclan.
  const equipo = s.principal
    ? ['Martín', 'Lucas', 'Germán']
    : s.id === 'emp-norte' ? ['Nico', 'Brian'] : ['Ariel'];
  const profIds = [];
  for (const [i, nombre] of equipo.entries()) {
    const ref = db.collection(`businesses/${s.id}/professionals`).doc();
    profIds.push(ref.id);
    await ref.set({ id: ref.id, name: nombre, specialty: 'Barbero', bio: '', avatarUrl: null, displayOrder: i + 1, isActive: true });
    for (const h of HORARIO) {
      const sh = db.collection(`businesses/${s.id}/schedules`).doc();
      await sh.set({ id: sh.id, professionalId: ref.id, ...h });
    }
  }

  const servicios = [
    { name: 'Corte', price: 8000 + n * 500, duration: 30 },
    { name: 'Corte + Barba', price: 12000 + n * 500, duration: 45 },
  ];
  const srvIds = [];
  for (const [i, srv] of servicios.entries()) {
    const ref = db.collection(`businesses/${s.id}/services`).doc();
    srvIds.push({ id: ref.id, ...srv });
    await ref.set({ id: ref.id, ...srv, description: '', isActive: true, displayOrder: i + 1, ventana: null });
    for (const pid of profIds) {
      const ps = db.collection(`businesses/${s.id}/professionalServices`).doc();
      await ps.set({ id: ps.id, professionalId: pid, serviceId: ref.id });
    }
  }

  // Turnos completados repartidos en los últimos tres meses, para que el
  // historial de ingresos tenga algo que mostrar.
  const cantidad = s.principal ? 40 : s.id === 'emp-norte' ? 22 : 9;
  for (let i = 0; i < cantidad; i++) {
    const srv = srvIds[i % srvIds.length];
    const ref = db.collection(`businesses/${s.id}/appointments`).doc();
    await ref.set({
      id: ref.id,
      businessId: s.id,
      userId: `cliente-${i % 7}`,
      clientName: `Cliente ${i + 1}`,
      clientPhone: `+54 9 2257 4${String(100000 + i).slice(-5)}`,
      clientEmail: '',
      professionalId: profIds[i % profIds.length],
      serviceId: srv.id,
      appointmentDate: diaDe(i * 2),
      startTime: '10:00',
      endTime: '10:30',
      price: srv.price,
      status: i % 9 === 0 ? 'no_asistio' : 'completada',
      type: 'online',
      notes: '',
      createdAt: new Date(),
    });
  }
}

// Reseñas sobre algunos turnos completados, para que la pantalla tenga qué
// mostrar: promedio, distribución y comentarios.
const COMENTARIOS = [
  'Excelente atención, quedé muy conforme.',
  'Rápido y prolijo. Vuelvo seguro.',
  '',
  'Buen corte pero esperé 15 minutos.',
  'El mejor de la zona.',
  '',
  'Todo bien, aunque el local estaba lleno.',
];

for (const s of SUCURSALES) {
  const turnos = (await db.collection(`businesses/${s.id}/appointments`).get())
    .docs.filter((d) => d.get('status') === 'completada');

  for (const [i, t] of turnos.slice(0, Math.ceil(turnos.length * 0.6)).entries()) {
    const estrellas = [5, 5, 4, 3, 5, 4, 5, 2, 5, 4][i % 10];
    await db.doc(`businesses/${s.id}/reviews/${t.id}`).set({
      id: t.id,
      businessId: s.id,
      appointmentId: t.id,
      userId: t.get('userId'),
      professionalId: t.get('professionalId'),
      serviceId: t.get('serviceId'),
      clientName: t.get('clientName'),
      appointmentDate: t.get('appointmentDate'),
      stars: estrellas,
      comment: COMENTARIOS[i % COMENTARIOS.length],
      createdAt: new Date(),
    });
  }
}

// El dueño, con la cuenta empresarial entera en sus claims.
async function cuenta(email, claims) {
  let u;
  try { u = await auth.getUserByEmail(email); }
  catch { u = await auth.createUser({ email, emailVerified: true, displayName: email.split('@')[0] }); }
  await auth.setCustomUserClaims(u.uid, claims);
  return u.uid;
}

await cuenta(DUENO, {
  businessId: GRUPO,
  role: 'owner',
  professionalId: null,
  grupoId: GRUPO,
  businessIds: SUCURSALES.map((s) => s.id),
});
await cuenta(PLATAFORMA, { platform: true });

// Unos cobros de la plataforma, para que el panel global tenga historial.
for (const d of (await db.collection('platform/cobros/items').get()).docs) await d.ref.delete();
for (const [i, monto] of [48000, 48000, 25000, 25000, 12000].entries()) {
  const ref = db.collection('platform/cobros/items').doc();
  await ref.set({ businessId: GRUPO, monto, fecha: diaDe(i * 20), nota: '', createdAt: new Date() });
}

console.log(`
Listo. En el emulador quedaron:

  Cuenta empresarial "${SUCURSALES[0].name}" con ${SUCURSALES.length} sucursales
  Dueño:      ${DUENO}
  Plataforma: ${PLATAFORMA}

Entrá en http://localhost:5173/login con "Continuar con Google" y elegí la cuenta.
`);
process.exit(0);
