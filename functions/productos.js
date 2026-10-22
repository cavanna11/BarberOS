// ============================================================================
// Productos, del lado del servidor
// ============================================================================
// Gemelo de `src/utils/productos.js`. Duplicado a propósito y por la misma
// razón que `functions/planes.js` y `functions/ausencias.js`: las Cloud
// Functions no pueden importar del bundle de Vite.
//
// Acá está la parte que importa: el precio y el stock. El navegador muestra un
// total y una cantidad disponible, pero las dos cosas se saltean con la consola
// abierta — y acá no se está jugando con un horario, se está jugando con
// mercadería que existe una sola vez.
//
// Tres cosas pasan en este archivo y las tres tienen que pasar JUNTAS o no
// pasar: el precio sale del documento del producto, el stock alcanza, y el
// stock baja. Si lo último se hiciera afuera de la transacción del turno, dos
// clientes mirando la última cera se la llevarían los dos — y el barbero se
// enteraría cuando el segundo viniera a buscarla.

const { FieldValue } = require('firebase-admin/firestore');

const MAX_PRODUCTOS_POR_TURNO = 10;
const MAX_UNIDADES = 10;

/** ¿Este producto lleva control de stock? `null` = no lo controla. */
function controlaStock(d) {
  return d && d.stock !== null && d.stock !== undefined && Number.isFinite(Number(d.stock));
}

/**
 * Lo que mandó el cliente, limpio: ids únicos y cantidades sanas.
 *
 * Se vuelve a acotar acá aunque el navegador ya lo haya hecho. Lo de allá es
 * para que la pantalla no mande una barbaridad; esto es para no confiar en la
 * pantalla.
 */
function normalizarPedido(productos) {
  if (!Array.isArray(productos)) return [];
  const porId = new Map();
  for (const x of productos) {
    if (!x || typeof x !== 'object') continue;
    const id = String(x.id || '');
    const cantidad = Math.trunc(Number(x.cantidad) || 0);
    if (!id || cantidad <= 0) continue;
    // Si viene el mismo id dos veces, se suman las cantidades en vez de
    // quedarse con una: mandar [{a,5},{a,5}] no puede ser la forma de comprar
    // diez saltándose el tope de uno.
    porId.set(id, Math.min((porId.get(id) || 0) + cantidad, MAX_UNIDADES));
  }
  return [...porId.entries()]
    .slice(0, MAX_PRODUCTOS_POR_TURNO)
    .map(([id, cantidad]) => ({ id, cantidad }));
}

/**
 * Lee los productos pedidos DENTRO de la transacción y devuelve los renglones
 * de la venta, con el precio y el nombre sacados de cada documento.
 *
 * Tira si alguno no existe, está inactivo o no tiene unidades. El mensaje dice
 * el nombre y cuántas quedan, porque "no se pudo reservar" al final de seis
 * pasos manda al cliente a empezar de nuevo sin saber qué cambiar.
 *
 * Se lee con `tx.get` y no antes: entre leer el stock afuera y escribir el
 * turno adentro hay una ventana, y esa ventana es exactamente donde se vende
 * dos veces la última unidad.
 */
async function leerYValidar(tx, db, businessId, pedido, HttpsError) {
  const items = normalizarPedido(pedido);
  if (!items.length) return [];

  const refs = items.map((x) => db.doc(`businesses/${businessId}/productos/${x.id}`));
  const snaps = await Promise.all(refs.map((r) => tx.get(r)));

  const renglones = [];
  snaps.forEach((snap, i) => {
    const d = snap.exists ? snap.data() : null;
    const pedida = items[i].cantidad;

    if (!d || d.isActive === false) {
      throw new HttpsError('failed-precondition',
        'Uno de los productos que elegiste ya no está disponible. Volvé a elegirlos.');
    }

    const nombre = d.name || 'Ese producto';
    if (controlaStock(d)) {
      const hay = Number(d.stock);
      if (hay <= 0) {
        throw new HttpsError('failed-precondition', `Se agotó ${nombre}. Sacá el turno sin ese producto y consultá en la barbería.`);
      }
      if (hay < pedida) {
        throw new HttpsError('failed-precondition',
          `De ${nombre} ${hay === 1 ? 'queda 1 unidad' : `quedan ${hay} unidades`} y pediste ${pedida}. Ajustá la cantidad.`);
      }
    }

    renglones.push({
      productoId: snap.id,
      name: nombre,
      // El precio SIEMPRE del documento, nunca del cliente. Es la mitad de la
      // razón por la que esto vive en el servidor.
      price: Number(d.price) || 0,
      cantidad: pedida,
      // Queda anotado si esta unidad movió el stock: el trigger que devuelve la
      // mercadería al cancelar tiene que saber a cuáles sumarle y a cuáles no.
      // Sin esto, un producto sin control de stock pasaría a tenerlo —en
      // negativo— el día que alguien cancele.
      descontado: controlaStock(d),
    });
  });

  return renglones;
}

/** Lo que suman los productos de la venta. */
function totalDe(renglones) {
  return (renglones || []).reduce((t, r) => t + (Number(r.price) || 0) * (Number(r.cantidad) || 0), 0);
}

/**
 * Baja el stock y deja la venta anotada. Se llama DENTRO de la transacción,
 * después de todas las lecturas.
 *
 * La venta es un documento con el id del TURNO
 * (`businesses/{biz}/ventasProductos/{aptId}`), mismo criterio que las reseñas
 * y los usos de membresía: el id es la clave natural, así que no hay forma de
 * que un turno quede con dos ventas. Y es el documento que después contesta
 * "quién vendió qué": lleva el barbero, la sucursal y la fecha.
 */
function registrarVenta(tx, db, businessId, aptId, renglones, datos) {
  if (!renglones || !renglones.length) return;

  for (const r of renglones) {
    // `vendidos` se cuenta SIEMPRE; el stock, solo si se controla.
    //
    // Estaban juntos adentro de un `if (!r.descontado) continue`, y eso hacía
    // que un producto sin control de stock no sumara ninguna venta: el dueño
    // veía la venta en la lista de abajo y la columna "Vendidos" clavada en
    // cero. Lo encontró Santiago el mismo día. Son dos cosas distintas —
    // cuántas unidades quedan y cuántas se vendieron— y el control de stock
    // solo manda sobre la primera.
    tx.update(db.doc(`businesses/${businessId}/productos/${r.productoId}`), {
      ...(r.descontado ? { stock: FieldValue.increment(-r.cantidad) } : {}),
      // Lo vendido no se usa para decidir nada: es para que el dueño vea qué se
      // mueve sin tener que recorrer los turnos.
      vendidos: FieldValue.increment(r.cantidad),
    });
  }

  tx.set(db.doc(`businesses/${businessId}/ventasProductos/${aptId}`), {
    id: aptId,
    appointmentId: aptId,
    items: renglones,
    total: totalDe(renglones),
    // La venta es del BARBERO del turno: es la pregunta que originó todo esto.
    professionalId: datos.professionalId || null,
    professionalName: datos.professionalName || null,
    clientName: datos.clientName || null,
    userId: datos.userId || null,
    fecha: datos.fecha || null,
    origen: 'reserva',
    // `reservado` y no `vendido`: todavía no se la llevó. Lo resuelve el
    // trigger cuando el turno se cierra.
    estado: 'reservado',
    createdAt: FieldValue.serverTimestamp(),
  });
}

module.exports = {
  MAX_PRODUCTOS_POR_TURNO,
  MAX_UNIDADES,
  controlaStock,
  normalizarPedido,
  leerYValidar,
  totalDe,
  registrarVenta,
};
