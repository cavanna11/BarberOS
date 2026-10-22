// Productos: la mercadería que se vende al lado del corte. Sin emulador — es
// aritmética sobre un array.
//
//   node scripts/test-productos.mjs
//
// Lo pidió Santiago: "los barberos quieren subir una cera para el pelo que
// venden". Acá se prueba la parte que decide QUÉ se le ofrece al cliente y
// CUÁNTO suma. El stock lo descuenta el servidor adentro de la transacción del
// turno, y eso se prueba contra el emulador en test-reservas.
//
// Los casos que importan no son los ideales, son los datos reales: el producto
// sin stock cargado (no lo controla), el que se agotó, el inactivo, y la
// diferencia entre esas tres cosas — confundir "no lo cuento" con "se me
// acabó" deja todo el catálogo sin vender de un día para el otro.
import {
  controlaStock, stockDe, sePuedeVender, paraLaVenta,
  errorDeProducto, normalizarProducto,
  seleccionParaElServidor, totalDeProductos, detalleDeProductos, maximoAPedir,
  MAX_UNIDADES, MAX_PRODUCTOS_POR_TURNO,
} from '../src/utils/productos.js';

let pasaron = 0, fallaron = 0;
const fallas = [];
const chequear = (t, ok, d = '') => {
  if (ok) { pasaron++; console.log('  ok    ', t); }
  else { fallaron++; fallas.push(t); console.log('  FALLA ', t, d ? `\n           ${d}` : ''); }
};

const p = (id, name, price, stock, extra = {}) => ({ id, name, price, stock, ...extra });

// ── Control de stock ────────────────────────────────────────────────────────
console.log('\n"No lo cuento" y "se me acabó" son cosas distintas:');
chequear('con un número, lo controla', controlaStock(p('a', 'Cera', 5000, 10)));
chequear('en CERO también lo controla (se agotó)', controlaStock(p('a', 'Cera', 5000, 0)));
chequear('en null NO lo controla', !controlaStock(p('a', 'Cera', 5000, null)));
chequear('sin el campo tampoco', !controlaStock({ id: 'a', name: 'Cera', price: 5000 }));
chequear('cadena vacía tampoco (es el input del formulario sin tocar)',
  !controlaStock(p('a', 'Cera', 5000, '')));
chequear('stockDe devuelve el número', stockDe(p('a', 'Cera', 5000, 7)) === 7);
chequear('stockDe sin control es null', stockDe(p('a', 'Cera', 5000, null)) === null);

console.log('\nQué se le ofrece al cliente:');
chequear('con stock, sí', sePuedeVender(p('a', 'Cera', 5000, 3)));
chequear('sin control de stock, SIEMPRE', sePuedeVender(p('a', 'Cera', 5000, null)));
chequear('agotado, NO', !sePuedeVender(p('a', 'Cera', 5000, 0)));
chequear('inactivo, NO (aunque tenga stock)',
  !sePuedeVender(p('a', 'Cera', 5000, 10, { isActive: false })));
chequear('basura, NO', !sePuedeVender(null) && !sePuedeVender(undefined));

const CATALOGO = [
  p('cera', 'Cera', 5000, 2, { displayOrder: 2 }),
  p('gel', 'Gel', 3000, null, { displayOrder: 1 }),
  p('shampoo', 'Shampoo', 8000, 0, { displayOrder: 3 }),
  p('pomada', 'Pomada', 6000, 5, { displayOrder: 4, isActive: false }),
];
const vendibles = paraLaVenta(CATALOGO).map((x) => x.id).join(',');
chequear('la lista deja afuera el agotado y el inactivo', vendibles === 'gel,cera', vendibles);
chequear('y respeta el orden que eligió la barbería',
  paraLaVenta(CATALOGO)[0].id === 'gel', vendibles);
chequear('sin argumentos no revienta', paraLaVenta().length === 0);

// ── Validación del formulario ───────────────────────────────────────────────
console.log('\nValidación:');
chequear('sin nombre, no', errorDeProducto({ name: '', price: 100 }) !== null);
chequear('solo espacios, tampoco', errorDeProducto({ name: '   ', price: 100 }) !== null);
chequear('bien', errorDeProducto({ name: 'Cera', price: 5000, stock: 10 }) === null);
chequear('precio CERO sí vale (el shampoo de regalo con el corte)',
  errorDeProducto({ name: 'Shampoo', price: 0 }) === null);
chequear('precio negativo no', errorDeProducto({ name: 'Cera', price: -1 }) !== null);
chequear('stock vacío vale: es "no lo controlo"',
  errorDeProducto({ name: 'Cera', price: 100, stock: '' }) === null);
chequear('stock negativo no', errorDeProducto({ name: 'Cera', price: 100, stock: -3 }) !== null);
chequear('stock con coma no (no hay media cera)',
  errorDeProducto({ name: 'Cera', price: 100, stock: 1.5 }) !== null);

console.log('\nNormalizar:');
const N = normalizarProducto({ name: '  Cera mate  ', price: '5000', stock: '7', isActive: true });
chequear('recorta el nombre', N.name === 'Cera mate', N.name);
chequear('el precio queda número', N.price === 5000 && typeof N.price === 'number');
chequear('el stock queda número', N.stock === 7);
chequear('stock vacío → null, NO cero',
  normalizarProducto({ name: 'x', price: 1, stock: '' }).stock === null,
  String(normalizarProducto({ name: 'x', price: 1, stock: '' }).stock));
chequear('stock "0" → cero, no null',
  normalizarProducto({ name: 'x', price: 1, stock: '0' }).stock === 0);
chequear('la descripción se corta en 300',
  normalizarProducto({ name: 'x', price: 1, descripcion: 'a'.repeat(500) }).descripcion.length === 300);
chequear('nace activo si no se dice nada',
  normalizarProducto({ name: 'x', price: 1 }).isActive === true);
chequear('sin displayOrder va al final',
  normalizarProducto({ name: 'x', price: 1 }).displayOrder === 999);

// ── Lo que viaja al servidor ────────────────────────────────────────────────
console.log('\nLo que viaja al servidor:');
chequear('vacío es vacío', seleccionParaElServidor({}).length === 0);
chequear('sin argumentos tampoco revienta', seleccionParaElServidor().length === 0);
chequear('saca las cantidades en cero',
  seleccionParaElServidor({ cera: 0, gel: 2 }).length === 1);
chequear('saca las negativas',
  seleccionParaElServidor({ cera: -5 }).length === 0);
chequear('acota la cantidad al tope',
  seleccionParaElServidor({ cera: 999 })[0].cantidad === MAX_UNIDADES);
chequear('acota cuántos productos distintos',
  seleccionParaElServidor(Object.fromEntries(
    Array.from({ length: 30 }, (_, i) => [`p${i}`, 1])
  )).length === MAX_PRODUCTOS_POR_TURNO);
chequear('la cantidad queda entera',
  seleccionParaElServidor({ cera: 2.7 })[0].cantidad === 2);

console.log('\nEl total que se MUESTRA:');
chequear('suma precio por cantidad',
  totalDeProductos(CATALOGO, { cera: 2, gel: 1 }) === 13000,
  String(totalDeProductos(CATALOGO, { cera: 2, gel: 1 })));
chequear('sin nada elegido, cero', totalDeProductos(CATALOGO, {}) === 0);
chequear('un id que no está en el catálogo no suma nada (ni revienta)',
  totalDeProductos(CATALOGO, { fantasma: 3 }) === 0);
chequear('sin argumentos, cero', totalDeProductos() === 0);

console.log('\nEl detalle para el resumen:');
const D = detalleDeProductos(CATALOGO, { cera: 2 });
chequear('trae nombre, precio y cantidad',
  D.length === 1 && D[0].name === 'Cera' && D[0].price === 5000 && D[0].cantidad === 2,
  JSON.stringify(D));
chequear('ignora lo que no existe', detalleDeProductos(CATALOGO, { fantasma: 1 }).length === 0);

console.log('\nCuántas unidades puede pedir:');
chequear('con 2 en stock, 2', maximoAPedir(p('a', 'Cera', 1, 2)) === 2);
chequear('agotado, 0', maximoAPedir(p('a', 'Cera', 1, 0)) === 0);
chequear('sin control de stock, el tope de la compra',
  maximoAPedir(p('a', 'Cera', 1, null)) === MAX_UNIDADES);
chequear('con 50 en stock, igual el tope de la compra',
  maximoAPedir(p('a', 'Cera', 1, 50)) === MAX_UNIDADES);

// ── El caso que lo pidió ────────────────────────────────────────────────────
console.log('\nEl caso del pedido (una cera, dos quedando):');
const CERA = [p('cera', 'Cera mate', 5000, 2, { displayOrder: 1 })];
chequear('se le ofrece', paraLaVenta(CERA).length === 1);
chequear('puede pedir hasta 2', maximoAPedir(CERA[0]) === 2);
chequear('dos ceras son 10.000', totalDeProductos(CERA, { cera: 2 }) === 10000);
chequear('pedir tres se recorta antes de molestar al servidor',
  Math.min(seleccionParaElServidor({ cera: 3 })[0].cantidad, maximoAPedir(CERA[0])) === 2);
const AGOTADA = [p('cera', 'Cera mate', 5000, 0, { displayOrder: 1 })];
chequear('cuando se acaba, deja de ofrecerse sola', paraLaVenta(AGOTADA).length === 0);
chequear('pero el dueño la sigue viendo para reponerla (no se filtra el catálogo)',
  AGOTADA.length === 1);

console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
if (fallas.length) console.log('Fallaron:\n  - ' + fallas.join('\n  - '));
console.log('');
process.exit(fallaron ? 1 : 0);
