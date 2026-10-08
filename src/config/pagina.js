// ============================================================================
// La página de presentación de la barbería
// ============================================================================
// Es lo que ve el cliente al abrir el link, ANTES de la reserva: el nombre, una
// línea de presentación, y una lista de botones grandes — reservar, cómo
// llegar, WhatsApp, Instagram. El modelo es el de un Linktree, no el de un
// constructor de páginas.
//
// Dos decisiones que definen todo lo demás:
//
// 1. **No se diseña, se elige.** El dueño elige una PLANTILLA y el resto se
//    arma solo con los datos que ya cargó (nombre, logo, presentación,
//    dirección, Instagram, WhatsApp, servicios). Un editor libre con bloques,
//    tipografías y márgenes es otro producto, y el resultado típico de dárselo
//    a alguien que no diseña es una página peor que la plantilla.
//
// 2. **La reserva no se toca.** La página vive en `/:slug` y el flujo de
//    siempre pasa a `/:slug/reservar`, igual que estaba. Si la página está
//    apagada —y nace apagada para todos— `/:slug` sigue siendo la reserva.
//    Nadie se entera de que esto existe hasta que lo prende.

import { CAPACIDADES, puede } from './plans';

/**
 * Las plantillas.
 *
 * Son tres y comparten la MISMA estructura de JSX: lo único que cambia es una
 * clase en el contenedor. Así una plantilla nueva es CSS y no una pantalla
 * nueva que después hay que acordarse de arreglar cuando cambia un botón.
 */
export const PLANTILLAS = [
  {
    id: 'simple',
    label: 'Simple',
    descripcion: 'Fondo liso, nombre grande y los botones en una columna.',
    requiere: null,
  },
  {
    id: 'tarjeta',
    label: 'Tarjeta',
    descripcion: 'Todo dentro de una tarjeta centrada, como una tarjeta personal.',
    requiere: null,
  },
  {
    id: 'foto',
    label: 'Con foto de portada',
    descripcion: 'Tu foto a pantalla completa de fondo, con los botones encima.',
    requiere: CAPACIDADES.paginaFoto,
  },
];

export const PLANTILLA_POR_DEFECTO = 'simple';

/** Cuántos botones libres puede agregar, además de los que se arman solos. */
export const MAX_BOTONES = 2;

/** Lo que la portada ocupa como máximo. Lo repiten las Rules. */
export const PORTADA_MAX_BYTES = 400_000;

export function getPlantilla(id) {
  return PLANTILLAS.find((p) => p.id === id) || null;
}

/**
 * Solo http(s). El dueño escribe estos links y terminan en un href de una
 * página pública: `javascript:` ahí sería XSS, y `data:` alcanza para servir
 * un HTML con la marca de la barbería.
 */
export function linkValido(url) {
  const limpio = String(url || '').trim();
  if (!limpio) return false;
  try {
    const u = new URL(limpio);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Los botones libres que se pueden mostrar: con texto, con link, y sanos. */
export function botonesValidos(pagina) {
  return (Array.isArray(pagina?.botones) ? pagina.botones : [])
    .filter((b) => b && String(b.texto || '').trim() && linkValido(b.url))
    .slice(0, MAX_BOTONES);
}

export const PAGINA_VACIA = {
  plantilla: PLANTILLA_POR_DEFECTO,
  titular: '',
  bajada: '',
  coverUrl: null,
  mostrarServicios: true,
  botones: [],
};

/**
 * La configuración efectiva, ya resuelta contra el plan.
 *
 * Que la plantilla con foto se caiga a la simple cuando la cuenta no tiene esa
 * capacidad no es un detalle: una barbería que baja de plan —o a la que se le
 * hizo una excepción y se le saca— tiene la plantilla elegida guardada en la
 * base, y sin este recorte la página quedaría con el hueco de una foto que las
 * Rules ya no dejan guardar. Se degrada, no se rompe.
 */
export function paginaEfectiva(pagina, capacidades) {
  const base = { ...PAGINA_VACIA, ...(pagina || {}) };
  const plantilla = getPlantilla(base.plantilla) || getPlantilla(PLANTILLA_POR_DEFECTO);
  const permitida = !plantilla.requiere || capacidades?.[plantilla.requiere] === true;

  return {
    ...base,
    plantilla: permitida ? plantilla.id : PLANTILLA_POR_DEFECTO,
    coverUrl: capacidades?.[CAPACIDADES.paginaFoto] === true ? base.coverUrl || null : null,
    botones: botonesValidos(base),
  };
}

/**
 * ¿Hay que mostrar la página de presentación en `/:slug`?
 *
 * Las dos condiciones importan. El interruptor, porque nace apagado y nadie
 * quiere que le cambien el link sin pedirlo. Y la capacidad del plan, porque si
 * una cuenta baja de plan con la página prendida, el link tiene que volver a
 * ser la reserva en vez de seguir mostrando una función que ya no paga.
 */
export function tienePagina(business) {
  return business?.paginaActiva === true && puede(business, CAPACIDADES.pagina);
}
