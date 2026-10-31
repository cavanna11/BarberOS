// ============================================================================
// A dónde vuelve el cliente después de entrar
// ============================================================================
// La reserva manda a /login con `state: { from: '/barberia/reservar' }`. Eso
// vive en el historial del navegador y sobrevive a un popup, pero NO a una
// redirección: cuando Google no puede abrir su ventana (pasa en iPhone, y en
// los navegadores de adentro de otra app) Firebase se va a la página de Google
// y vuelve, la app arranca de cero, y el `state` ya no está. El cliente quedaba
// logueado en la pantalla de login, o en "creá tu barbería", sin su reserva.
//
// Se guarda una copia en sessionStorage, que sí sobrevive a ese viaje (es la
// misma pestaña), y se usa una sola vez.

const CLAVE = 'barberos:volverA';

export function recordarVuelta(ruta) {
  if (!ruta || ruta === '/' || ruta === '/login') return;
  try { sessionStorage.setItem(CLAVE, ruta); } catch { /* sin storage queda el state */ }
}

/** La ruta guardada, si hay. No la borra: para eso está `usarVuelta`. */
export function leerVuelta() {
  try { return sessionStorage.getItem(CLAVE) || null; } catch { return null; }
}

/** La ruta guardada, y la borra: se usa una vez. */
export function usarVuelta() {
  const ruta = leerVuelta();
  try { sessionStorage.removeItem(CLAVE); } catch { /* nada que borrar */ }
  return ruta;
}
