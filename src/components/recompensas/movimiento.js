// Si el cliente pidió menos movimiento en su sistema, las animaciones de las
// recompensas se saltean: la ruleta muestra el resultado, la tarjeta aparece
// ya sellada, no hay confetti. Lo que se dice (el texto, el premio) es el mismo.
//
// Se pregunta en el momento y no se guarda: el cliente lo puede cambiar con la
// página abierta.
export function prefiereMenosMovimiento() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** '2026-11-10' → '10/11'. */
export function fechaCorta(f) {
  if (!f) return '';
  const [, m, d] = String(f).split('-');
  return `${d}/${m}`;
}

/** Para qué servicios vale un premio (o el happy hour), en palabras. */
export function paraQueServicios(premio, services = []) {
  const ids = premio?.serviceIds || [];
  if (!ids.length) return 'Para cualquier servicio';
  const nombres = ids.map((id) => services.find((s) => s.id === id)?.name).filter(Boolean);
  return nombres.length ? `Para ${nombres.join(', ')}` : 'Para servicios seleccionados';
}

const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

/** [0,1,2,3,4] → 'Lun a Vie'; [1,3] → 'Mar y Jue'. 0 = Lunes. */
export function diasEnTexto(dias = []) {
  const d = [...dias].sort((a, b) => a - b);
  if (d.length === 7) return 'Todos los días';
  const seguidos = d.length > 2 && d.every((x, i) => i === 0 || x === d[i - 1] + 1);
  if (seguidos) return `${DIAS[d[0]]} a ${DIAS[d[d.length - 1]]}`;
  const nombres = d.map((x) => DIAS[x]);
  return nombres.length > 1 ? `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}` : nombres[0] || '';
}

// ── Lo que el cliente vio de su tarjeta, en ESTE teléfono ──────────────────
// Es una comodidad visual (para animar solo lo nuevo), no un dato: si se borra,
// la tarjeta aparece sellada sin animación y no se pierde nada.

const claveVisto = (businessId, uid) => `barberos:tarjeta:${businessId}:${uid}`;

/** `{ ciclo, sellos }` de la última visita, o null. */
export function leerVisto(businessId, uid) {
  try {
    const v = JSON.parse(localStorage.getItem(claveVisto(businessId, uid)) || 'null');
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

export function guardarVisto(businessId, uid, valor) {
  try { localStorage.setItem(claveVisto(businessId, uid), JSON.stringify(valor)); } catch { /* sin storage, sin animación */ }
}

/**
 * Desde qué casilla animar. Primera vez en este teléfono: sin animación (no se
 * sabe qué vio). Si completó una tarjeta y arrancó otra, la nueva desde cero.
 */
export function desdeDondeAnimar(visto, ciclo, sellos) {
  if (!visto) return sellos;
  if (Number(visto.ciclo) !== Number(ciclo)) return 0;
  return Math.min(Number(visto.sellos) || 0, sellos);
}

/**
 * Cuántos grados tiene que girar la rueda para que la porción `indice` quede
 * bajo el puntero, partiendo de `actual` y dando `vueltas` completas.
 *
 * Un pequeño desvío al azar dentro de la porción (sin tocar los bordes) hace
 * que no frene siempre en el centro exacto, que es lo que delata una ruleta
 * "arreglada" aunque no lo esté.
 */
export function rotacionHacia(indice, cantidad, actual = 0, vueltas = 6) {
  const paso = 360 / Math.max(1, cantidad);
  const centro = indice * paso + paso / 2;
  const desvio = (Math.random() - 0.5) * paso * 0.6;
  const destino = 360 - centro + desvio;
  const base = actual - (actual % 360);
  return base + vueltas * 360 + destino;
}
