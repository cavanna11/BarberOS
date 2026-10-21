// ============================================================================
// La pantalla en blanco que se arregla con F5
// ============================================================================
// Cada pantalla se baja recién cuando hace falta (`lazy()` en App.jsx), en un
// archivo con un hash en el nombre: `BookingPage-a1b2c3.js`. Cuando se publica
// una versión nueva, esos nombres cambian y los viejos dejan de existir.
//
// El que tenía la app abierta desde antes —el barbero con el panel instalado
// en el celular, que no lo cierra nunca, o el cliente que dejó la pestaña— sigue
// corriendo la versión vieja. Al tocar una pantalla que todavía no había
// abierto, pide el archivo viejo, no está, el import falla y React desmonta
// todo: pantalla en blanco. F5 baja la versión nueva y anda.
//
// Esto hace ese F5 solo. Una sola vez cada tanto: si el archivo falla por otra
// cosa (sin señal), recargar en loop sería peor que el blanco.

const CLAVE = 'barberos:recargaPorVersion';
const ESPERA_MS = 30_000;

/** ¿El error es "no pude bajar un pedazo de la app"? Cada navegador lo dice distinto. */
export function esErrorDeCarga(err) {
  const msg = String(err?.message || err || '');
  return /dynamically imported module|Importing a module script failed|Failed to load module script|error loading dynamically imported module|ChunkLoadError|Unable to preload CSS/i.test(msg);
}

/**
 * Recarga la página para traer la versión nueva. Devuelve false si ya se
 * recargó hace un rato por lo mismo (y no lo vuelve a hacer).
 */
export function recargarPorVersionNueva() {
  try {
    const ultima = Number(sessionStorage.getItem(CLAVE)) || 0;
    if (Date.now() - ultima < ESPERA_MS) return false;
    sessionStorage.setItem(CLAVE, String(Date.now()));
  } catch {
    // Sin sessionStorage no hay cómo cortar un loop: mejor no recargar.
    return false;
  }
  window.location.reload();
  return true;
}

/**
 * `lazy(() => import(...))`, pero si el archivo ya no existe recarga en vez de
 * romper. Mientras recarga devuelve una promesa que no termina, así el
 * `Suspense` sigue mostrando "cargando" y no parpadea un error.
 */
export function importarConReintento(importar) {
  return () => importar().catch((err) => {
    if (esErrorDeCarga(err) && recargarPorVersionNueva()) return new Promise(() => {});
    throw err;
  });
}
