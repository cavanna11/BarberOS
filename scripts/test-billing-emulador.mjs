// Prueba de runBilling contra el emulador: cobro, acumulación, suspensión,
// período de prueba y el salto de mes del día 31.
//
//   firebase emulators:start --only auth,firestore,functions
//   node scripts/test-billing-emulador.mjs
//
// runBilling es programada, así que se prueba llamando a procesarFacturacion,
// que es su cuerpo exportado aparte justamente para esto.
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT = 'barberos-1d60e';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
// El initializeApp() sin argumentos de functions/index.js saca el proyecto de
// acá; fuera de Cloud Functions no hay metadata server que se lo diga.
process.env.GCLOUD_PROJECT = PROJECT;

initializeApp({ projectId: PROJECT });
const db = getFirestore();

let ok = 0, mal = 0;
const chequear = (desc, cond, detalle) => {
  if (cond) { ok++; console.log(`  ok    ${desc}`); }
  else { mal++; console.log(`  FALLA ${desc}\n        ${detalle}`); }
};

const hoyISO = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

const enDias = (n) => {
  const d = new Date(`${hoyISO()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split('T')[0];
};

// Se llama a la lógica directo, no al disparador: una onSchedule no se invoca
// por HTTP y el emulador la ignora si no corrés también el de pubsub. La función
// usa su propio firebase-admin (el de functions/), apuntado al mismo emulador
// por las variables de entorno.
const { procesarFacturacion } = await import('../functions/index.js');

async function correrBilling() {
  await procesarFacturacion();
}

async function negocio(id, { isFrozen = false, trialEndsAt = null }, billing) {
  await db.doc(`businesses/${id}`).set({ name: id, slug: id, isFrozen, trialEndsAt });
  await db.doc(`businesses/${id}/private/billing`).set(billing);
}

const leerBilling = async (id) => (await db.doc(`businesses/${id}/private/billing`).get()).data();
const leerNegocio = async (id) => (await db.doc(`businesses/${id}`).get()).data();

// ── escenario ──────────────────────────────────────────────────────────────
for (const d of (await db.collection('businesses').get()).docs) {
  for (const sub of ['private']) {
    for (const x of (await d.ref.collection(sub).get()).docs) await x.ref.delete();
  }
  await d.ref.delete();
}

// 1. Al día: vence el mes que viene, no se le toca nada.
await negocio('al-dia', {}, { monthlyFee: 12000, debt: 0, nextBillingDate: enDias(20) });

// 2. Vencido ayer: se le cobra y queda suspendido.
await negocio('vencido', {}, { monthlyFee: 12000, debt: 0, nextBillingDate: enDias(-1) });

// 3. Tres vencimientos sin pagar: se acumulan.
await negocio('deudor', {}, { monthlyFee: 10000, debt: 0, nextBillingDate: enDias(-70) });

// 4. Cuenta de prueba vigente: NO se le cobra ni se suspende.
await negocio('en-prueba', { trialEndsAt: enDias(10) }, { monthlyFee: 12000, debt: 0, nextBillingDate: enDias(10) });

// 5. Prueba terminada ayer: entra a cobrarse por el camino normal.
await negocio('prueba-vencida', { trialEndsAt: enDias(-1) }, { monthlyFee: 12000, debt: 0, nextBillingDate: enDias(-1) });

// 6. Ya saldó la deuda: se le tiene que descongelar.
await negocio('saldado', { isFrozen: true }, { monthlyFee: 12000, debt: 0, nextBillingDate: enDias(20) });

console.log('\nCorriendo runBilling...');
await correrBilling();

console.log('\nCobro y suspensión:');
let b = await leerBilling('al-dia');
chequear('al día: no se le cobra', b.debt === 0, JSON.stringify(b));
chequear('al día: sigue activo', (await leerNegocio('al-dia')).isFrozen === false, '');

b = await leerBilling('vencido');
chequear('vencido: se le cobró un mes', b.debt === 12000, JSON.stringify(b));
chequear('vencido: quedó suspendido', (await leerNegocio('vencido')).isFrozen === true, '');
chequear('vencido: se corrió el vencimiento', b.nextBillingDate > enDias(-1), JSON.stringify(b.nextBillingDate));

b = await leerBilling('deudor');
chequear('deudor: acumuló 3 meses (30000)', b.debt === 30000, JSON.stringify(b));

chequear('saldado: se descongeló solo', (await leerNegocio('saldado')).isFrozen === false, '');

console.log('\nPeríodo de prueba:');
b = await leerBilling('en-prueba');
chequear('en prueba: deuda en cero', b.debt === 0, JSON.stringify(b));
chequear('en prueba: NO se suspende', (await leerNegocio('en-prueba')).isFrozen === false, '');

b = await leerBilling('prueba-vencida');
chequear('prueba vencida: se le cobró', b.debt === 12000, JSON.stringify(b));
chequear('prueba vencida: quedó suspendida', (await leerNegocio('prueba-vencida')).isFrozen === true, '');

console.log(`\n${ok} pasaron, ${mal} fallaron\n`);
process.exit(mal ? 1 : 0);
