// Siembra en el emulador tres barberías con su página de presentación, una por
// plantilla, para mirarlas en el browser.
//
//   firebase emulators:start --only auth,firestore,functions
//   node scripts/sembrar-pagina-emulador.mjs
//   # en otra terminal, con VITE_USE_EMULATORS=true en .env:
//   npm run dev
//
// Después abrir:
//   /pagina-simple     plantilla Simple, Plan Intermedio (sin logo ni colores)
//   /pagina-tarjeta    plantilla Tarjeta, Plan Full con colores propios
//   /pagina-foto       plantilla con foto de portada, Plan Full
//   /pagina-grupo-a    cuenta con dos sucursales: los locales van PRIMERO
//   /pagina-apagada    la página existe pero está apagada → entra a reservar
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { camposDelPlan } from '../functions/planes.js';

const PROJECT = 'barberos-1d60e';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

initializeApp({ projectId: PROJECT });
const db = getFirestore();

// Una portada de verdad no hace falta para mirar el diseño: un degradado en SVG
// pesa 200 bytes y alcanza para ver cómo queda el velo y el texto encima.
const PORTADA = 'data:image/svg+xml;base64,' + Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">
     <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
       <stop offset="0" stop-color="#8a5a3b"/><stop offset="1" stop-color="#1a1410"/>
     </linearGradient></defs>
     <rect width="1200" height="800" fill="url(#g)"/>
   </svg>`
).toString('base64');

const HORARIO = [0, 1, 2, 3, 4, 5].map((d) => ({
  id: `h${d}`, dayOfWeek: d, startTime: '09:00', endTime: '20:00', isActive: true,
}));

// `durationMinutes`, no `duration`: es el nombre que leen el motor de
// disponibilidad y `createAppointment`. Con el otro, la grilla arma turnos sin
// hora de fin ("10:00 — NaN:NaN") y todo dura los 30 minutos del respaldo.
const SERVICIOS = [
  { id: 's1', name: 'Corte', price: 9000, durationMinutes: 45, isActive: true },
  { id: 's2', name: 'Corte y barba', price: 13000, durationMinutes: 60, isActive: true },
  { id: 's3', name: 'Barba', price: 6000, durationMinutes: 30, isActive: true },
];

const PROFESIONALES = [
  { id: 'p1', name: 'Martín', specialty: 'Clásico', isActive: true },
  { id: 'p2', name: 'Lucas', specialty: 'Fade', isActive: true },
];

async function barberia(id, { nombre, plan, pagina, grupoId = null, extra = {}, activa = true }) {
  await db.recursiveDelete(db.doc(`businesses/${id}`)).catch(() => {});
  const p = camposDelPlan(plan);

  await db.doc(`businesses/${id}`).set({
    id,
    name: nombre,
    slug: id,
    isFrozen: false,
    onlineBookingEnabled: true,
    planId: p.planId,
    maxBarbers: p.maxBarbers,
    maxSucursales: p.maxSucursales,
    whatsappQuota: p.whatsappQuota,
    capacidades: p.capacidades,
    grupoId,
    trialEndsAt: null,
    paginaActiva: activa,
    welcomeMessage: 'Cortes clásicos y barba. Atendemos con turno.',
    address: 'Av. Colón 1234',
    city: 'Mar del Plata',
    phone: '2234567890',
    socialLinks: { instagram: '@barberia', whatsapp: '2234567890' },
    businessHours: HORARIO,
    minCancelHours: 2,
    ...extra,
  });

  await db.doc(`businesses/${id}/private/billing`).set({
    planId: plan, monthlyFee: p.monthlyFee, debt: 0, nextBillingDate: '2099-01-01',
  });

  for (const s of SERVICIOS) await db.doc(`businesses/${id}/services/${s.id}`).set(s);
  for (const pr of PROFESIONALES) await db.doc(`businesses/${id}/professionals/${pr.id}`).set(pr);
  for (const pr of PROFESIONALES) {
    // Un documento por barbero y por día, que es la forma que leen el motor de
    // disponibilidad (`s.professionalId === x && s.dayOfWeek === n`) y
    // `createAppointment`. Un solo documento con un `weeklySchedule` adentro
    // NO sirve: el calendario sale con todos los días apagados y parece que la
    // barbería no atiende nunca.
    for (const h of HORARIO) {
      await db.doc(`businesses/${id}/schedules/${pr.id}-${h.dayOfWeek}`).set({
        id: `${pr.id}-${h.dayOfWeek}`,
        professionalId: pr.id,
        dayOfWeek: h.dayOfWeek,
        startTime: h.startTime,
        endTime: h.endTime,
        isActive: true,
      });
    }
    for (const s of SERVICIOS) {
      await db.doc(`businesses/${id}/professionalServices/${pr.id}-${s.id}`)
        .set({ professionalId: pr.id, serviceId: s.id });
    }
  }

  if (pagina) await db.doc(`businesses/${id}/public/pagina`).set(pagina);
  await db.doc(`slugs/${id}`).set({ businessId: id });
  console.log(`  ok  /${id}  (${plan}, plantilla ${pagina?.plantilla || '—'}${activa ? '' : ', APAGADA'})`);
}

console.log('\nSembrando páginas de presentación:\n');

// Intermedio: tiene página, NO tiene logo ni colores propios. Es el caso que
// más importa mirar, porque es el que decide si la escalera cierra: donde iría
// el logo van las iniciales, y si eso se ve como un hueco, la función no sirve.
await barberia('pagina-simple', {
  nombre: 'Barbería del Centro',
  plan: 'intermedio',
  pagina: {
    plantilla: 'simple',
    titular: '',
    bajada: 'Turnos todos los días. Sin esperas.',
    mostrarServicios: true,
    botones: [{ texto: 'Nuestros productos', url: 'https://example.com/productos' }],
  },
});

await barberia('pagina-tarjeta', {
  nombre: 'Volcado Club',
  plan: 'full',
  extra: { primaryColor: '#1f6f54', secondaryColor: '#2f9b78' },
  pagina: {
    plantilla: 'tarjeta',
    titular: 'Volcado Club',
    bajada: 'Barbería y estudio de tatuajes.',
    mostrarServicios: true,
    botones: [],
  },
});

await barberia('pagina-foto', {
  nombre: 'La Esquina',
  plan: 'full',
  extra: { primaryColor: '#c2a24a', secondaryColor: '#e0bd5e' },
  pagina: {
    plantilla: 'foto',
    titular: '',
    bajada: 'Desde 1998 en la misma esquina.',
    coverUrl: PORTADA,
    mostrarServicios: true,
    botones: [
      { texto: 'Trabajá con nosotros', url: 'https://example.com/empleo' },
      { texto: 'Sorteo del mes', url: 'https://example.com/sorteo' },
    ],
  },
});

// Dos sucursales: lo primero que tiene que ver el cliente son los locales, y el
// botón de reservar tiene que decir en CUÁL reserva.
await barberia('pagina-grupo-a', {
  nombre: 'Tijeras — Centro',
  plan: 'empresarial',
  grupoId: 'pagina-grupo-a',
  pagina: { plantilla: 'tarjeta', bajada: 'Dos locales en la ciudad.', mostrarServicios: true, botones: [] },
});
await barberia('pagina-grupo-b', {
  nombre: 'Tijeras — Norte',
  plan: 'empresarial',
  grupoId: 'pagina-grupo-a',
  extra: { address: 'Juan B. Justo 4500', city: 'Mar del Plata' },
  pagina: { plantilla: 'tarjeta', bajada: 'Dos locales en la ciudad.', mostrarServicios: true, botones: [] },
});
await db.doc('grupos/pagina-grupo-a').set({
  principalId: 'pagina-grupo-a',
  businessIds: ['pagina-grupo-a', 'pagina-grupo-b'],
});

// Y la que tiene la página armada pero apagada: su link sigue siendo la reserva,
// exactamente como antes de que esto existiera. Es el caso por defecto de todas
// las barberías de producción hasta que cada una la prenda.
await barberia('pagina-apagada', {
  nombre: 'Sin Página',
  plan: 'full',
  activa: false,
  pagina: { plantilla: 'simple', bajada: 'No se tendría que ver.', mostrarServicios: true, botones: [] },
});

console.log('\nListo. Con VITE_USE_EMULATORS=true, abrí:');
for (const s of ['pagina-simple', 'pagina-tarjeta', 'pagina-foto', 'pagina-grupo-a', 'pagina-apagada']) {
  console.log(`  http://localhost:5173/${s}`);
}
console.log('');
