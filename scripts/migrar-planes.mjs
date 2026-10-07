// Escribe en cada barbería los topes y las capacidades que le corresponden a su
// plan, para las cuentas que son anteriores a que esos campos existieran.
//
// Por qué hace falta: las Security Rules no pueden importar la tabla de planes,
// así que leen `capacidades` del documento del negocio. Una cuenta vieja no lo
// tiene, y la regla asume TRUE por defecto — a propósito: nadie pierde de un día
// para el otro la foto que ya tenía cargada. Pero eso también significa que
// hasta que esto corra, el Básico sigue pudiendo subir fotos.
//
//   node scripts/migrar-planes.mjs                 # muestra qué haría, no toca nada
//   node scripts/migrar-planes.mjs --aplicar       # escribe
//   node scripts/migrar-planes.mjs --aplicar --emulador
//
// Contra producción necesita credenciales de administrador: la variable
// GOOGLE_APPLICATION_CREDENTIALS apuntando a la clave de servicio, o
// `firebase login` con el proyecto activo.
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { camposDelPlan } from '../functions/planes.js';

const APLICAR = process.argv.includes('--aplicar');
const EMULADOR = process.argv.includes('--emulador');
const PROJECT = 'barberos-1d60e';

if (EMULADOR) process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
initializeApp(EMULADOR ? { projectId: PROJECT } : { projectId: PROJECT, credential: applicationDefault() });
const db = getFirestore();

const negocios = await db.collection('businesses').get();
console.log(`\n${negocios.size} barberías${EMULADOR ? ' (emulador)' : ' (PRODUCCIÓN)'}\n`);

let aEscribir = 0, saltadas = 0;
const lote = db.batch();

for (const d of negocios.docs) {
  const biz = d.data();
  const plan = camposDelPlan(biz.planId);

  if (!plan) {
    console.log(`  — ${biz.name || d.id}: plan desconocido (${biz.planId || 'sin plan'}), se deja como está`);
    saltadas++;
    continue;
  }

  // Lo que ya está escrito manda: puede ser una excepción que le hicimos a esa
  // cuenta a mano. Esto solo COMPLETA lo que falta.
  const cambios = {};
  if (biz.capacidades === undefined) cambios.capacidades = plan.capacidades;
  if (biz.maxSucursales === undefined) cambios.maxSucursales = plan.maxSucursales;
  if (biz.maxBarbers === undefined) cambios.maxBarbers = plan.maxBarbers;
  if (biz.grupoId === undefined) cambios.grupoId = null;

  if (Object.keys(cambios).length === 0) {
    saltadas++;
    continue;
  }

  const resumen = Object.entries(cambios)
    .map(([k, v]) => `${k}=${typeof v === 'object' && v !== null ? JSON.stringify(v) : v}`)
    .join(' · ');
  console.log(`  ${APLICAR ? '✓' : '→'} ${biz.name || d.id} [${biz.planId}]: ${resumen}`);

  if (APLICAR) lote.set(d.ref, cambios, { merge: true });
  aEscribir++;
}

// ── El mapa público de cada grupo de sucursales ─────────────────────────────
// `/grupos/{id}` lo escribe `crearSucursal`, pero los grupos creados antes de
// que existiera ese mapa no lo tienen — y sin él, la página de reservas no
// puede ofrecerle al cliente elegir sucursal. Se reconstruye desde `grupoId`,
// que es el dato de verdad.
const grupos = new Map();
for (const d of negocios.docs) {
  const grupoId = d.get('grupoId');
  if (!grupoId) continue;
  if (!grupos.has(grupoId)) grupos.set(grupoId, []);
  grupos.get(grupoId).push(d.id);
}

let gruposEscritos = 0;
for (const [grupoId, ids] of grupos) {
  if (ids.length < 2) continue;   // un grupo de uno no es un grupo
  const ref = db.doc(`grupos/${grupoId}`);
  const actual = await ref.get();
  const yaEstaban = (actual.exists ? actual.get('businessIds') : null) || [];
  const faltan = ids.filter((id) => !yaEstaban.includes(id));
  if (actual.exists && faltan.length === 0 && yaEstaban.length === ids.length) continue;

  console.log(`  ${APLICAR ? '✓' : '→'} grupo ${grupoId}: ${ids.length} sucursales`);
  if (APLICAR) {
    lote.set(ref, {
      principalId: grupoId,
      businessIds: ids,
      actualizadoEn: new Date(),
    });
  }
  gruposEscritos++;
}
if (gruposEscritos) aEscribir += gruposEscritos;

if (APLICAR && aEscribir) {
  await lote.commit();
  console.log(`\nListo: ${aEscribir} barberías actualizadas, ${saltadas} ya estaban.\n`);
} else if (APLICAR) {
  console.log(`\nNo había nada que actualizar (${saltadas} ya estaban).\n`);
} else {
  console.log(
    `\n${aEscribir} barberías se actualizarían, ${saltadas} ya están.\n` +
    `Nada se escribió. Para hacerlo: node scripts/migrar-planes.mjs --aplicar\n`
  );
}

process.exit(0);
