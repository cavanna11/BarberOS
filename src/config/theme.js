// ============================================================================
// Los colores de cada barbería (white-label)
// ============================================================================
// Los defaults son la identidad de SACIA (sacia.tech): naranja quemado sobre
// casi-blanco. Los mismos valores están en `:root` de index.css — si cambiás
// uno, cambiá el otro.
//
// Una barbería del Plan Full pisa primary/secondary con sus colores desde
// /admin/configuracion. El resto (fondos, texto, bordes, estados) es la base
// del producto y no se toca: dejar elegir el color del texto y el del fondo es
// la forma más rápida de que alguien arme una página ilegible.
//
// Cómo se aplican, y por qué así: `variablesDelTema` devuelve un objeto de
// estilo que se le pone a un contenedor (ver `components/client/TemaNegocio`).
// Las custom properties heredan por el árbol, así que todo lo que está adentro
// —botones, badges, links— sale con los colores de la barbería sin que ningún
// componente se entere.
//
// Antes esto se hacía escribiendo en `document.documentElement`, y tenía dos
// problemas que lo volvían inservible:
//
//   1. Era GLOBAL. El dueño de la plataforma que abre una barbería se quedaba
//      con los colores de esa barbería puestos en su panel hasta recargar.
//   2. Había que acordarse de limpiarlo al salir, y nadie lo hacía.
//
// Dicho de otra forma: la función que aplicaba el tema existía desde el
// principio y NO LA LLAMABA NADIE. Una barbería podía elegir sus colores,
// guardarlos, verlos en la vista previa de Configuración… y el cliente que
// abría su link veía el naranja de BarberOS.

export const defaultTheme = {
  primaryColor: '#e03d00',
  primaryHover: '#b83200',
  primaryLight: '#fdf0eb',
  secondaryColor: '#ff5c1a',
  accentColor: '#ff5c1a',
  bgColor: '#fafafa',
  surfaceColor: '#ffffff',
  textColor: '#0a0a0a',
  textSecondary: '#555555',
  textMuted: '#aaaaaa',
  borderColor: 'rgba(0, 0, 0, 0.08)',
  successColor: '#0f9960',
  warningColor: '#b45309',
  dangerColor: '#d92d20',
};

/** '#e03d00' → { r, g, b }, o null si no es un hex de 3 o 6 dígitos. */
export function hexARgb(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

const aHex = ({ r, g, b }) =>
  '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

/** Más oscuro, para el `:hover` del botón. `f` = cuánto queda (0.8 = 20% más oscuro). */
export function oscurecer(hex, f = 0.8) {
  const c = hexARgb(hex);
  return c ? aHex({ r: c.r * f, g: c.g * f, b: c.b * f }) : null;
}

/** Casi blanco con un tinte del color, para fondos de badge y de selección. */
export function aclarar(hex, f = 0.08) {
  const c = hexARgb(hex);
  if (!c) return null;
  return aHex({
    r: 255 - (255 - c.r) * f,
    g: 255 - (255 - c.g) * f,
    b: 255 - (255 - c.b) * f,
  });
}

/**
 * ¿Sobre este color conviene texto blanco o negro?
 *
 * Importa de verdad: el único color que la barbería elige es el de sus botones,
 * y el texto del botón es blanco fijo en el CSS. Una barbería con el dorado de
 * su cartel se queda con botones que no se leen.
 *
 * La fórmula es la luminancia relativa de WCAG y el corte sale de igualar los
 * dos contrastes: `1.05 / (L + 0.05) = (L + 0.05) / 0.05` da `L ≈ 0.179`. Por
 * encima de eso el negro contrasta más que el blanco.
 *
 * Ojo con la tentación de subirlo a 0.5 "porque el blanco queda mejor": 0.5 es
 * el medio de la LUMINOSIDAD percibida, no de la luminancia, y con ese número
 * un dorado (L ≈ 0.38) se lleva texto blanco con un contraste de 2.4:1, que es
 * justo el caso que esto existe para evitar.
 */
export function textoSobre(hex) {
  const c = hexARgb(hex);
  if (!c) return '#ffffff';
  const lineal = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lineal(c.r) + 0.7152 * lineal(c.g) + 0.0722 * lineal(c.b);
  return L > 0.179 ? '#0a0a0a' : '#ffffff';
}

/**
 * Las variables CSS de ESTE negocio, listas para un `style={}`.
 *
 * Devuelve `{}` cuando no hay nada que pisar: así el contenedor no declara
 * variables iguales a las de `:root` y queda claro, mirando el inspector, cuál
 * es una barbería con colores propios y cuál no.
 *
 * `habilitado` es la capacidad del plan. Va como parámetro y no se lee acá
 * adentro para que este archivo no sepa nada de planes: quien llama ya tiene
 * el negocio y puede preguntar.
 */
export function variablesDelTema(business, habilitado = true) {
  if (!habilitado) return {};
  const primary = hexARgb(business?.primaryColor) ? business.primaryColor : null;
  const secondary = hexARgb(business?.secondaryColor) ? business.secondaryColor : null;
  if (!primary && !secondary) return {};

  const vars = {};
  if (primary) {
    const c = hexARgb(primary);
    vars['--primary'] = primary;
    vars['--primary-hover'] = oscurecer(primary);
    vars['--primary-light'] = aclarar(primary);
    vars['--sobre-primary'] = textoSobre(primary);
    // Estas dos son el mismo color con alfa, y en `:root` están escritas como
    // un `rgba()` literal con el naranja de BarberOS adentro. Si no se pisan
    // acá, el botón de la barbería queda verde con el aro naranja alrededor:
    // el detalle que delata que los colores son una capa de pintura y no el
    // tema. Van derivadas para no pedirle a nadie que elija cuatro colores.
    vars['--border-accent'] = `rgba(${c.r}, ${c.g}, ${c.b}, 0.2)`;
    vars['--primary-glow'] = `rgba(${c.r}, ${c.g}, ${c.b}, 0.12)`;
  }
  if (secondary || primary) {
    vars['--secondary'] = secondary || primary;
    vars['--accent'] = secondary || primary;
    vars['--primary-soft'] = secondary || primary;
  }
  return vars;
}
