// Con extensión, a propósito: este módulo tiene que poder importarse tal cual
// desde `scripts/test-productos.mjs`, y Node exige la extensión aunque Vite no.
import { enOrden } from './orden.js';

// ============================================================================
// Productos: la cera que el barbero vende al lado del corte
// ============================================================================
// Lo pidió Santiago (22/10/2026): "los barberos quieren subir una cera para el
// pelo que venden. Estaría bueno que la puedan subir ahí a productos, y que
// cuando reserven un corte les aparezca para seleccionar algo si quieren."
//
// ── Por qué NO es un servicio con `adicional: true` ─────────────────────────
// Los adicionales (cejas, lavado, café) se quedan como están, y esto es otra
// cosa. Un adicional es trabajo: lo hace una persona, se hace durante el corte
// y no se agota. Un producto es mercadería: tiene stock, tiene foto, y cuando
// se vendió el último no se puede vender otro. Meter stock adentro de
// `services` haría que la grilla de horarios y el motor de disponibilidad
// tengan que aprender a ignorar un campo que no les importa, y que la pantalla
// de Servicios pregunte por unidades a quien está cargando un corte.
//
// ── El stock es del LOCAL, la venta es del BARBERO ─────────────────────────
// Decisión de Santiago: hay 10 ceras y son del local; cualquiera las vende. Lo
// que se registra es QUIÉN la vendió, y eso sale del barbero del turno. No hay
// un stock por barbero: cuando alguien vende una, baja para todos.
//
// ── Y el stock lo descuenta el SERVIDOR ────────────────────────────────────
// Acá adentro no hay nada que descuente nada: esto calcula y valida, y lo usan
// el panel (para no dejar guardar un precio imposible) y la reserva (para
// mostrar el total). El stock baja dentro de la transacción de
// `createAppointment`, que es el único momento en que dos clientes pidiendo la
// última cera no pueden llevarse las dos.

/** Hasta cuántos productos distintos puede llevar un turno. */
export const MAX_PRODUCTOS_POR_TURNO = 10;

/** Y cuántas unidades de cada uno. Más que esto es una compra al mayoreo. */
export const MAX_UNIDADES = 10;

/** Cuántas unidades quedando se considera "últimas unidades". */
export const STOCK_BAJO = 3;

/**
 * ¿Este producto lleva control de stock?
 *
 * `stock: null` significa "no lo controlo" y es un caso de verdad: el barbero
 * que tiene una caja de sobres de gel no los cuenta, y obligarlo a mantener un
 * número que no mira terminaría con todo en cero y nada vendible. Distinto de
 * `stock: 0`, que es "se me acabó".
 */
export function controlaStock(p) {
  return Number.isFinite(Number(p?.stock)) && p?.stock !== null && p?.stock !== '';
}

/** Las unidades que quedan, o null si no se controla. */
export function stockDe(p) {
  return controlaStock(p) ? Number(p.stock) : null;
}

/**
 * ¿Se puede vender?
 *
 * Inactivo no se vende, y sin stock tampoco. Lo segundo NO se esconde del
 * panel —el dueño tiene que ver que se le acabó para reponerlo— pero sí deja de
 * ofrecerse al cliente: ofrecer algo que no hay es la forma más rápida de que
 * el barbero tenga que explicar por teléfono que no lo tiene.
 */
export function sePuedeVender(p) {
  if (!p || p.isActive === false) return false;
  const s = stockDe(p);
  return s === null || s > 0;
}

/** Los que el cliente puede elegir, en el orden que eligió la barbería. */
export function paraLaVenta(productos = []) {
  return (productos || []).filter(sePuedeVender).slice().sort(enOrden);
}

/**
 * Qué está mal en este producto, o null si está bien.
 *
 * El precio en cero NO es un error: el shampoo de regalo con el corte es un
 * caso real. El precio negativo sí.
 */
export function errorDeProducto({ name, price, stock } = {}) {
  if (!String(name || '').trim()) return 'Ponele un nombre.';
  const p = Number(price);
  if (!Number.isFinite(p) || p < 0) return 'El precio no puede ser negativo.';
  if (stock === '' || stock === null || stock === undefined) return null; // sin control
  const s = Number(stock);
  if (!Number.isInteger(s) || s < 0) return 'El stock tiene que ser un número entero de 0 o más.';
  return null;
}

/**
 * Normaliza lo que viene del formulario.
 *
 * El stock vacío queda en null —"no lo controlo"— y no en 0, que significa que
 * se acabó. Confundirlos deja todo el catálogo sin vender de un día para el
 * otro.
 */
export function normalizarProducto({ name, price, stock, descripcion, imagenUrl, isActive, displayOrder } = {}) {
  const sinControl = stock === '' || stock === null || stock === undefined;
  return {
    name: String(name || '').trim(),
    price: Math.max(0, Math.round(Number(price) || 0)),
    stock: sinControl ? null : Math.max(0, Math.trunc(Number(stock) || 0)),
    descripcion: String(descripcion || '').trim().slice(0, 300),
    imagenUrl: imagenUrl || null,
    isActive: isActive !== false,
    displayOrder: Number.isFinite(Number(displayOrder)) ? Number(displayOrder) : 999,
  };
}

/**
 * Lo que el cliente eligió, limpio y acotado.
 *
 * Entra lo que haya en pantalla (`{ id: cantidad }`) y sale la lista que viaja
 * al servidor. Se acota acá y se vuelve a acotar allá: esto es para que la
 * pantalla no mande una barbaridad, no para confiar en ella.
 */
export function seleccionParaElServidor(seleccion = {}) {
  return Object.entries(seleccion || {})
    .map(([id, cantidad]) => ({ id: String(id), cantidad: Math.trunc(Number(cantidad) || 0) }))
    .filter((x) => x.id && x.cantidad > 0)
    .map((x) => ({ ...x, cantidad: Math.min(x.cantidad, MAX_UNIDADES) }))
    .slice(0, MAX_PRODUCTOS_POR_TURNO);
}

/**
 * Cuánto suman los productos elegidos.
 *
 * Es para MOSTRAR. El total que se cobra lo calcula el servidor con el precio
 * de cada documento: si acá se calculara el precio de verdad, alcanzaría con
 * abrir la consola para comprarse una cera a cero.
 */
export function totalDeProductos(productos = [], seleccion = {}) {
  return seleccionParaElServidor(seleccion).reduce((t, x) => {
    const p = (productos || []).find((y) => y && y.id === x.id);
    return t + (p ? (Number(p.price) || 0) * x.cantidad : 0);
  }, 0);
}

/** Los elegidos con su cantidad, para el resumen de la confirmación. */
export function detalleDeProductos(productos = [], seleccion = {}) {
  return seleccionParaElServidor(seleccion)
    .map((x) => {
      const p = (productos || []).find((y) => y && y.id === x.id);
      return p ? { id: p.id, name: p.name, price: Number(p.price) || 0, cantidad: x.cantidad } : null;
    })
    .filter(Boolean);
}

/**
 * Cuántas unidades más de este producto puede agregar.
 *
 * Sin control de stock, el tope es el de la compra. Con control, lo que queda —
 * y nunca más que eso: el botón de "+" se apaga en el último, en vez de dejarlo
 * pedir cinco y que el servidor le diga que no cuando ya eligió horario.
 */
export function maximoAPedir(p) {
  const s = stockDe(p);
  return s === null ? MAX_UNIDADES : Math.max(0, Math.min(s, MAX_UNIDADES));
}
