import { lazy } from 'react';

// ============================================================================
// Páginas exclusivas: diseño a medida, pagado aparte
// ============================================================================
// Las plantillas de `config/pagina.js` son el producto: las elige cualquiera y
// lo que las hace suyas son sus datos. Esto es otra cosa. Es una página hecha a
// mano para UNA barbería que la pagó como trabajo de diseño, y por eso vive
// fuera de las plantillas y no aparece en el editor de "Mi página".
//
// Lo que NO cambia es la reserva: la página exclusiva reemplaza solamente lo
// que se ve en `/:slug`. El flujo de siempre sigue en `/:slug/reservar`, con el
// mismo motor, las mismas validaciones y los mismos colores de la barbería.
//
// Se indexa por `businessId` y no por slug: el slug lo puede cambiar el dueño
// desde Configuración, y un link nuevo no tiene que hacerle perder la página
// que pagó.
//
// Cada página es un `lazy()`: el resto de las barberías no se baja ni un byte
// de este código, ni de sus fuentes, ni de su CSS.

export const PAGINAS = {
  // Neytan Barber 777 — Santa Teresita. Diseño encargado en octubre de 2026.
  UgRVepKBCLf84xkgVgSX: lazy(() => import('./neytan/PaginaNeytan')),
};

/** ¿Esta barbería tiene página exclusiva? */
export function paginaExclusiva(businessId) {
  return Boolean(businessId && PAGINAS[businessId]);
}
