// Siembra una barbería con las siete recompensas prendidas, para mirar las
// pantallas en el browser. No es una prueba (esa es
// test-recompensas-emulador.mjs): es un escenario para ver.
//
//   firebase emulators:start --only auth,firestore,functions
//   node scripts/sembrar-recompensas-emulador.mjs
//   npm run dev -- --mode emulador
//
// Las campañas se configuran por `guardarCampana` y los sellos los pone el
// trigger de verdad al marcar turnos como atendidos: lo que se ve es lo que
// produce el sistema, no datos escritos a mano.
//
// Las cuentas tienen contraseña (SOLO del emulador) para poder entrar con
// "Soy del equipo: tengo usuario y contraseña" sin la ventana de Google.
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

const BIZ = 'rec-demo';
const SLUG = 'recompensas-demo';
const CLAVE = 'Emulador123';
const DUENO = 'dueno-recompensas@gmail.com';
const JUAN = 'juan-recompensas@gmail.com';
const SOFI = 'sofi-recompensas@gmail.com';

const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
const dia = (n) => { const d = new Date(`${hoy}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

await db.recursiveDelete(db.doc(`businesses/${BIZ}`)).catch(() => {});
await db.doc(`slugs/${SLUG}`).set({ businessId: BIZ });
const horario = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startTime: '09:00', endTime: '20:00', isActive: true }));
await db.doc(`businesses/${BIZ}`).set({
  id: BIZ, name: 'Barbería Demo', slug: SLUG, isFrozen: false, onlineBookingEnabled: true,
  planId: 'full', capacidades: { fotoPerfil: true, colores: true, logo: true, pagina: true, paginaFoto: true },
  grupoId: null, businessHours: horario, mpConectado: false, currency: 'ARS', slotInterval: 30,
  createdAt: new Date(),
});
for (const [id, name, price] of [['corte', 'Corte', 18000], ['barba', 'Barba', 9000], ['corte-barba', 'Corte + barba', 24000]]) {
  await db.doc(`businesses/${BIZ}/services/${id}`).set({ id, name, price, durationMinutes: 30, isActive: true, displayOrder: 1 });
  await db.doc(`businesses/${BIZ}/professionalServices/lucas-${id}`).set({ id: `lucas-${id}`, professionalId: 'lucas', serviceId: id, customPrice: null, customDuration: null });
}
await db.doc(`businesses/${BIZ}/professionals/lucas`).set({ id: 'lucas', name: 'Lucas Martínez', specialty: 'Barbero', isActive: true });
for (const d of [0, 1, 2, 3, 4, 5, 6]) {
  await db.doc(`businesses/${BIZ}/schedules/lucas-${d}`).set({ id: `lucas-${d}`, professionalId: 'lucas', dayOfWeek: d, startTime: '09:00', endTime: '20:00', isActive: true });
}

async function cuenta(email, nombre, claims) {
  try { await auth.deleteUser((await auth.getUserByEmail(email)).uid); } catch { /* no existía */ }
  const u = await auth.createUser({ email, password: CLAVE, emailVerified: true, displayName: nombre });
  if (claims) await auth.setCustomUserClaims(u.uid, claims);
  const r = await fetch(`${AUTH}/accounts:signInWithCustomToken?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: await auth.createCustomToken(u.uid), returnSecureToken: true }),
  });
  return { uid: u.uid, token: (await r.json()).idToken };
}
const llamar = async (nombre, u, data) => {
  const r = await fetch(`${FN}/${nombre}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${u.token}` },
    body: JSON.stringify({ data }),
  });
  const j = await r.json();
  if (j.error) throw new Error(`${nombre}: ${j.error.message}`);
  return j.result;
};

const dueno = await cuenta(DUENO, 'Dueño Demo', { businessId: BIZ, role: 'owner', professionalId: null });
const juan = await cuenta(JUAN, 'Juan Pérez', null);
await cuenta(SOFI, 'Sofía Gómez', null);

const premio = (tipo, valor, extra = {}) => ({ tipo, valor, serviceIds: [], ...extra });
const campana = (tipo, config) => llamar('guardarCampana', dueno, { businessId: BIZ, tipo, activa: true, config });

await campana('ruleta', {
  premios: [
    premio('porcentaje', 5, { probabilidad: 40, icono: '💸', color: '#f2b705' }),
    premio('porcentaje', 10, { probabilidad: 25, icono: '✂️', color: '#e03d00' }),
    premio('porcentaje', 15, { probabilidad: 15, icono: '⭐', color: '#2e7d32' }),
    premio('porcentaje', 20, { probabilidad: 8, icono: '🔥', color: '#1f1f1f' }),
    premio('gratis', 0, { nombre: 'Corte gratis', probabilidad: 2, icono: '💈', color: '#c62828', serviceIds: ['corte'] }),
  ],
  frecuenciaDias: 30, diasVencimiento: 30,
});
await campana('fidelidad', { casillas: 10, premio: premio('gratis', 0, { nombre: 'Corte gratis', icono: '💈', serviceIds: ['corte'] }), reinicio: 'automatico', color: '#e03d00', diseno: 'clasico' });
await campana('caja', {
  premios: [
    premio('porcentaje', 10, { probabilidad: 60, icono: '💸', color: '#f2b705' }),
    premio('personalizado', 0, { nombre: 'Café de regalo', probabilidad: 40, icono: '☕', color: '#6d4c41' }),
  ],
  frecuenciaDias: 7, diasVencimiento: 30,
});
await campana('rasca', { premios: [premio('porcentaje', 15, { probabilidad: 70, icono: '⭐', color: '#2e7d32' })], diasVencimiento: 30 });
await campana('happyHour', { dias: [0, 1, 2, 3, 4], desde: '14:00', hasta: '17:00', porcentaje: 20, serviceIds: ['corte'] });
await campana('racha', { diasMax: 30, niveles: [{ racha: 3, premio: premio('porcentaje', 10) }, { racha: 5, premio: premio('gratis', 0, { nombre: 'Barba gratis', serviceIds: ['barba'] }) }] });
await campana('cumpleanos', { premio: premio('porcentaje', 25, { nombre: 'Regalo de cumpleaños', icono: '🎂' }), diasAntes: 7, diasDespues: 15 });

// Juan viene seguido: 7 turnos atendidos, cada 2 o 3 semanas. Se marcan
// "atendido" como lo haría el barbero, y el trigger pone los sellos.
for (let i = 7; i >= 1; i--) {
  const ref = db.collection(`businesses/${BIZ}/appointments`).doc();
  await ref.set({
    id: ref.id, businessId: BIZ, userId: juan.uid, professionalId: 'lucas', professionalName: 'Lucas Martínez',
    serviceId: 'corte', serviceName: 'Corte', appointmentDate: dia(-i * 18), startTime: '10:00', endTime: '10:30',
    price: 18000, status: 'confirmada', origen: 'cliente', clientName: 'Juan Pérez', clientEmail: JUAN, clientPhone: '1123456789',
  });
  await ref.update({ status: 'completada' });
  // Uno por vez: dos sellos del mismo cliente a la vez pelean la misma transacción.
  const hasta = Date.now() + 15000;
  while (Date.now() < hasta) {
    const p = (await db.doc(`businesses/${BIZ}/recompensasClientes/${juan.uid}`).get()).data();
    if ((p?.fidelidad?.sellos || 0) >= 8 - i) break;
    await new Promise((r) => setTimeout(r, 300));
  }
}
const p = (await db.doc(`businesses/${BIZ}/recompensasClientes/${juan.uid}`).get()).data();

console.log(`
Listo. "Barbería Demo" → http://localhost:5173/${SLUG}

  Contraseña de todas (solo emulador): ${CLAVE}
  Entrar con "Soy del equipo: tengo usuario y contraseña".

  Dueño:  ${DUENO}   → /admin/recompensas (las 7 campañas prendidas)
  Juan:   ${JUAN}    → tarjeta ${p?.fidelidad?.sellos}/10, racha ${p?.racha?.actual}, ${(p?.rascas || []).length} tarjetas para raspar,
                       y una tirada de ruleta al reservar
  Sofía:  ${SOFI}    → cliente nueva: cumpleaños para cargar, caja sin abrir
`);
process.exit(0);
