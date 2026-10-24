// Qué pantalla le toca a alguien que abrió el link de una barbería. Sin
// emulador: es una decisión pura sobre cuatro datos.
//
//   node scripts/test-estado-negocio.mjs
//
// Esto existe por una captura que mandó un barbero el 24/10/2026: abrió el
// link de SU barbería desde el navegador de Instagram y leyó "No encontramos
// este negocio". A veces sí y a veces no.
//
// Si alguno de estos casos empieza a fallar, a un cliente le va a aparecer que
// la barbería no existe — y ese cliente no vuelve ni avisa.
import { estadoDelNegocio } from '../src/utils/estadoDelNegocio.js';

let pasaron = 0, fallaron = 0;
const fallas = [];
const chequear = (t, ok, d = '') => {
  if (ok) { pasaron++; console.log('  ok    ', t); }
  else { fallaron++; fallas.push(t); console.log('  FALLA ', t, d ? `\n           ${d}` : ''); }
};

const SLUG = 'la-barberia';
const NEGOCIO = { id: 'b1', slug: SLUG, name: 'La Barbería' };
const con = (extra) => estadoDelNegocio({ businessSlug: SLUG, ...extra });

// ── El caso que lo pidió ────────────────────────────────────────────────────
console.log('\nLa ventana que mostraba "no encontramos este negocio":');
chequear('el slug resolvió pero el negocio todavía no llegó → CARGANDO',
  con({ slugEstado: { slug: SLUG, estado: 'ok' } }) === 'resolviendo',
  con({ slugEstado: { slug: SLUG, estado: 'ok' } }));
chequear('y cuando llega, se ve la barbería',
  con({ business: NEGOCIO, slugEstado: { slug: SLUG, estado: 'ok' } }) === 'ok');

console.log('\nCuándo SÍ se dice que no existe:');
chequear('cuando la lectura del slug dijo que no está',
  con({ slugEstado: { slug: SLUG, estado: 'no-existe' } }) === 'no-existe');
chequear('mientras se está resolviendo, no',
  con({ slugEstado: { slug: SLUG, estado: 'resolviendo' } }) === 'resolviendo');
chequear('sin ningún dato todavía, tampoco',
  con({}) === 'resolviendo', con({}));
chequear('con la sesión todavía cargando, tampoco',
  con({ loading: true, slugEstado: { slug: SLUG, estado: 'ok' } }) === 'resolviendo');

console.log('\nCuando no se pudo averiguar:');
chequear('es su propia pantalla, NO "no existe"',
  con({ slugEstado: { slug: SLUG, estado: 'sin-conexion' } }) === 'sin-conexion');
chequear('y gana incluso si la sesión sigue cargando (hay algo que decir)',
  con({ loading: true, slugEstado: { slug: SLUG, estado: 'sin-conexion' } }) === 'sin-conexion');

console.log('\nEl estado de OTRO slug no decide sobre este:');
chequear('un "no existe" que quedó de la barbería anterior no cuenta',
  con({ slugEstado: { slug: 'otra-barberia', estado: 'no-existe' } }) === 'resolviendo',
  con({ slugEstado: { slug: 'otra-barberia', estado: 'no-existe' } }));
chequear('ni un "sin conexión" de otro slug',
  con({ slugEstado: { slug: 'otra', estado: 'sin-conexion' } }) === 'resolviendo');

console.log('\nLa barbería cerrada:');
chequear('congelada por falta de pago',
  con({ business: { ...NEGOCIO, isFrozen: true } }) === 'cerrado');
chequear('con las reservas pausadas a mano',
  con({ business: { ...NEGOCIO, onlineBookingEnabled: false } }) === 'cerrado');
chequear('congelada manda sobre el estado del slug',
  con({ business: { ...NEGOCIO, isFrozen: true }, slugEstado: { slug: SLUG, estado: 'ok' } }) === 'cerrado');

console.log('\nEl equipo de la plataforma (no entra por el slug):');
chequear('mientras no cargó la cartera, cargando',
  con({ esPlataforma: true, negociosCargados: false }) === 'resolviendo');
chequear('con la cartera cargada y sin ese negocio, no existe',
  con({ esPlataforma: true, negociosCargados: true }) === 'no-existe');
chequear('pero si el slug dijo sin conexión, manda eso',
  con({ esPlataforma: true, negociosCargados: true, slugEstado: { slug: SLUG, estado: 'sin-conexion' } }) === 'sin-conexion');

console.log('\nBasura:');
chequear('sin argumentos no revienta', estadoDelNegocio() === 'resolviendo');
chequear('slugEstado en null', con({ slugEstado: null }) === 'resolviendo');
chequear('un estado desconocido no se toma por respuesta',
  con({ slugEstado: { slug: SLUG, estado: 'cualquier-cosa' } }) === 'resolviendo');

console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
if (fallas.length) console.log('Fallaron:\n  - ' + fallas.join('\n  - '));
console.log('');
process.exit(fallaron ? 1 : 0);
