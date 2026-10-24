// ============================================================================
// Qué pantalla le toca a alguien que abrió el link de una barbería
// ============================================================================
// Esto existe por una captura que mandó un barbero el 24/10/2026: abrió
// `barberos.sacia.tech/su-barberia` desde el navegador de Instagram y le
// apareció **"No encontramos este negocio"**. A él, que es el dueño del link.
// Y a veces sí y a veces no.
//
// No era la conexión: era una VENTANA DE CARRERA acá adentro.
//
// Resolver el link son dos pasos, y el segundo llega después:
//
//   1. se lee `/slugs/{slug}` y se sabe qué barbería es   → slugEstado 'ok'
//   2. llega el documento de la barbería, por el listener → business
//
// Entre los dos, `business` todavía es undefined y el estado ya no es
// 'resolviendo'. La condición vieja era "si ya no está resolviendo y no hay
// negocio, entonces no existe", así que en esa ventana la pantalla declaraba
// que la barbería no existe. En una conexión rápida dura milisegundos y nadie
// la ve nunca. Adentro del navegador de Instagram, con 4G, dura lo suficiente
// para que el cliente lea el cartel y se vaya — y el barbero piense que el
// sistema no anda.
//
// La regla ahora es una sola y se puede decir en una frase: **solo se declara
// que algo no existe cuando alguien lo afirmó**, y lo único que puede
// afirmarlo es la lectura del slug. Todo lo demás es "todavía no sé", que se
// muestra como "cargando", o "no pude averiguarlo", que es otra pantalla y
// tiene un botón.
//
// Es la tercera vez que este mismo error aparece en este proyecto con otra
// ropa: el turno que no se podía dar, la agenda vacía del barbero sin vínculo,
// y esto. Siempre es lo mismo: confundir "no sé" con "no hay".

/** Los estados que de verdad contestan la pregunta. El resto es "todavía no". */
const RESPUESTAS = ['no-existe', 'sin-conexion'];

/**
 * @param {object} e
 * @param {object|null} e.business      El negocio, si ya llegó.
 * @param {string}      e.businessSlug  El slug de la URL.
 * @param {object|null} e.slugEstado    `{ slug, estado }` de BusinessSync.
 * @param {boolean}     e.esPlataforma  El equipo de la plataforma no va por slug.
 * @param {boolean}     e.negociosCargados  Para la plataforma.
 * @param {boolean}     e.loading       La sesión todavía se está resolviendo.
 * @returns {'ok'|'resolviendo'|'no-existe'|'sin-conexion'|'cerrado'}
 */
export function estadoDelNegocio({
  business = null,
  businessSlug = '',
  slugEstado = null,
  esPlataforma = false,
  negociosCargados = false,
  loading = false,
} = {}) {
  if (business) {
    // Congelada por falta de pago, o con las reservas pausadas a mano.
    if (business.isFrozen || business.onlineBookingEnabled === false) return 'cerrado';
    return 'ok';
  }

  // Lo que dijo la lectura del slug, pero SOLO si habla de este slug. Un
  // estado que quedó de la barbería anterior no decide nada sobre esta.
  const delSlug = slugEstado && slugEstado.slug === businessSlug ? slugEstado.estado : null;

  // No se pudo averiguar. Es su propia pantalla: no se le dice al cliente que
  // el link está mal cuando lo que falló fue la red.
  if (delSlug === 'sin-conexion') return 'sin-conexion';

  if (loading) return 'resolviendo';

  // La plataforma no entra por el slug: tiene la cartera entera cargada.
  if (esPlataforma) return negociosCargados ? 'no-existe' : 'resolviendo';

  // Y acá está el arreglo: 'ok' NO es una respuesta. Significa que el slug
  // resolvió y que el negocio viene en camino.
  return RESPUESTAS.includes(delSlug) ? 'no-existe' : 'resolviendo';
}
