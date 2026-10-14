// ============================================================================
// En qué orden ve el cliente la lista
// ============================================================================
// "Si cargué tres tipos de corte, quiero decidir cuál aparece primero." Es un
// pedido de venta, no de prolijidad: el primero de la lista es el que más se
// elige, y hoy el orden lo decidía el azar de en qué orden los cargaron.
//
// El campo `displayOrder` YA existía y se escribía al crear un servicio
// (`services.length + 1`), pero estaba a medio construir: no había dónde
// cambiarlo, y de todas las pantallas que muestran servicios solo la grilla de
// reserva lo miraba. La página de presentación, la página exclusiva y el modal
// del staff los mostraban como vinieran de Firestore.
//
// ── Por qué flechas y no arrastrar ──────────────────────────────────────────
// Arrastrar es más lindo en una demo y peor en la mano: este panel se usa en el
// celular, la lista scrollea, y en una pantalla táctil "mantener apretado para
// arrastrar" pelea contra "deslizar para bajar". Una flecha es un toque, hace
// una sola cosa, y se deshace con la flecha de al lado.

/**
 * El orden en que la barbería dejó su lista, con el nombre como desempate.
 *
 * `?? 999` cubre a los servicios creados antes de que el campo existiera: van
 * al final, alfabéticos entre ellos, en vez de desaparecer o romper el orden.
 */
export function enOrden(a, b) {
  return (a?.displayOrder ?? 999) - (b?.displayOrder ?? 999)
    || String(a?.name || '').localeCompare(String(b?.name || ''));
}

/** La lista ya ordenada. Azúcar, pero evita repetir `[...x].sort(enOrden)`. */
export function ordenados(lista = []) {
  return [...(lista || [])].sort(enOrden);
}

/**
 * Mover un elemento un lugar arriba o abajo.
 *
 * Devuelve SOLO lo que hay que escribir: `[{ id, displayOrder }]`, y vacío si
 * el movimiento no cambia nada (el primero hacia arriba, el último hacia
 * abajo). Que devuelva las escrituras y no la lista nueva es a propósito: la
 * pantalla no tiene que adivinar qué cambió, y la lista la vuelve a traer la
 * suscripción de Firestore.
 *
 * **Se renumera TODA la lista, no solo los dos que se tocan.** Es el detalle
 * que hace que esto ande con los datos reales: los servicios viejos no tienen
 * `displayOrder`, y los que lo tienen pueden estar repetidos o con huecos
 * (borrar el segundo de tres deja 1 y 3). Si solo se intercambiaran dos
 * valores, mover algo en una lista sin numerar no haría nada visible y
 * parecería que el botón está roto.
 */
export function mover(lista = [], id, direccion) {
  const orden = ordenados(lista);
  const i = orden.findIndex((x) => x && x.id === id);
  if (i === -1) return [];

  const j = direccion === 'arriba' ? i - 1 : i + 1;
  if (j < 0 || j >= orden.length) return [];

  const [movido] = orden.splice(i, 1);
  orden.splice(j, 0, movido);

  return orden
    .map((x, k) => ({ id: x.id, displayOrder: k + 1 }))
    .filter((x, k) => orden[k].displayOrder !== k + 1);
}

/** ¿Este elemento se puede subir / bajar? Para apagar la flecha que no hace nada. */
export function puedeMover(lista = [], id) {
  const orden = ordenados(lista);
  const i = orden.findIndex((x) => x && x.id === id);
  return { arriba: i > 0, abajo: i !== -1 && i < orden.length - 1 };
}
