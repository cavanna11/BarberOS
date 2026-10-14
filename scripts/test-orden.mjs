// El orden en que el cliente ve la lista. Sin emulador — es aritmética sobre
// un array.
//
//   node scripts/test-orden.mjs
//
// "Si cargué tres tipos de corte, quiero decidir cuál aparece primero." El
// campo `displayOrder` ya existía y se escribía al crear, pero no había dónde
// cambiarlo y solo la grilla de reserva lo miraba.
//
// Los casos que importan son los datos REALES, no los ideales: servicios
// viejos sin el campo, numeraciones con huecos (borrar el segundo de tres deja
// 1 y 3) y valores repetidos. Si alguno de estos falla, el barbero toca la
// flecha y no pasa nada visible.
import { enOrden, ordenados, mover, puedeMover } from '../src/utils/orden.js';

let pasaron = 0, fallaron = 0;
const fallas = [];
const chequear = (t, ok, d = '') => {
  if (ok) { pasaron++; console.log('  ok    ', t); }
  else { fallaron++; fallas.push(t); console.log('  FALLA ', t, d ? `\n           ${d}` : ''); }
};

const s = (id, name, displayOrder) => ({ id, name, displayOrder });
const nombres = (lista) => ordenados(lista).map((x) => x.id).join(',');
/** Aplica las escrituras que devuelve `mover`, como haría Firestore. */
const aplicar = (lista, escrituras) => lista.map((x) => {
  const w = escrituras.find((e) => e.id === x.id);
  return w ? { ...x, displayOrder: w.displayOrder } : x;
});

// ── Ordenar ─────────────────────────────────────────────────────────────────
console.log('\nEl orden que ve el cliente:');
const TRES = [s('c', 'Corte', 2), s('a', 'Barba', 1), s('b', 'Combo', 3)];
chequear('manda displayOrder, no el nombre ni cómo vino', nombres(TRES) === 'a,c,b', nombres(TRES));

const SIN = [s('z', 'Zeta'), s('a', 'Alfa'), s('m', 'Mu')];
chequear('sin displayOrder, alfabético (no al azar)', nombres(SIN) === 'a,m,z', nombres(SIN));

const MIXTO = [s('viejo', 'Viejo'), s('nuevo', 'Nuevo', 1)];
chequear('los que no tienen el campo van al FINAL, no adelante',
  nombres(MIXTO) === 'nuevo,viejo', nombres(MIXTO));

const EMPATE = [s('b', 'Bravo', 5), s('a', 'Alfa', 5)];
chequear('a igual número, desempata el nombre', nombres(EMPATE) === 'a,b', nombres(EMPATE));

chequear('ordenados() no muta el array original',
  (() => { const l = [s('b', 'B', 2), s('a', 'A', 1)]; ordenados(l); return l[0].id === 'b'; })());
chequear('enOrden no revienta con basura', [null, undefined, {}].sort(enOrden).length === 3);
chequear('ordenados sin argumentos', ordenados().length === 0);

// ── Mover ───────────────────────────────────────────────────────────────────
console.log('\nSubir y bajar:');
let L = [s('a', 'A', 1), s('b', 'B', 2), s('c', 'C', 3)];
chequear('subir el del medio lo pone primero',
  nombres(aplicar(L, mover(L, 'b', 'arriba'))) === 'b,a,c',
  nombres(aplicar(L, mover(L, 'b', 'arriba'))));
chequear('bajar el del medio lo pone último',
  nombres(aplicar(L, mover(L, 'b', 'abajo'))) === 'a,c,b',
  nombres(aplicar(L, mover(L, 'b', 'abajo'))));
chequear('subir el primero no hace nada', mover(L, 'a', 'arriba').length === 0);
chequear('bajar el último no hace nada', mover(L, 'c', 'abajo').length === 0);
chequear('un id que no está no hace nada', mover(L, 'fantasma', 'arriba').length === 0);
chequear('subir y volver a bajar deja todo igual',
  nombres(aplicar(aplicar(L, mover(L, 'b', 'arriba')),
    mover(aplicar(L, mover(L, 'b', 'arriba')), 'b', 'abajo'))) === 'a,b,c');

// ── Los datos reales, que es donde esto se rompía ───────────────────────────
console.log('\nCon los datos como están de verdad:');
const VIEJOS = [s('a', 'Alfa'), s('b', 'Bravo'), s('c', 'Charlie')];
chequear('lista SIN numerar: mover igual funciona (se renumera todo)',
  nombres(aplicar(VIEJOS, mover(VIEJOS, 'c', 'arriba'))) === 'a,c,b',
  nombres(aplicar(VIEJOS, mover(VIEJOS, 'c', 'arriba'))));
chequear('y les escribe número a TODOS, no solo a los dos tocados',
  mover(VIEJOS, 'c', 'arriba').length === 3, JSON.stringify(mover(VIEJOS, 'c', 'arriba')));

const HUECOS = [s('a', 'Alfa', 1), s('b', 'Bravo', 3), s('c', 'Charlie', 7)];
const trasHuecos = aplicar(HUECOS, mover(HUECOS, 'c', 'arriba'));
chequear('numeración con huecos (1,3,7): queda 1,2,3 consecutiva',
  JSON.stringify(ordenados(trasHuecos).map((x) => x.displayOrder)) === '[1,2,3]',
  JSON.stringify(ordenados(trasHuecos).map((x) => x.displayOrder)));
chequear('y en el orden correcto', nombres(trasHuecos) === 'a,c,b', nombres(trasHuecos));

const REPETIDOS = [s('a', 'Alfa', 1), s('b', 'Bravo', 1), s('c', 'Charlie', 1)];
chequear('todos con el MISMO número: mover rompe el empate',
  nombres(aplicar(REPETIDOS, mover(REPETIDOS, 'c', 'arriba'))) === 'a,c,b',
  nombres(aplicar(REPETIDOS, mover(REPETIDOS, 'c', 'arriba'))));

chequear('no escribe los que ya tenían el número bien',
  mover([s('a', 'A', 1), s('b', 'B', 2), s('c', 'C', 3)], 'c', 'arriba').every((w) => w.id !== 'a'),
  JSON.stringify(mover([s('a', 'A', 1), s('b', 'B', 2), s('c', 'C', 3)], 'c', 'arriba')));

const UNO = [s('solo', 'Único', 1)];
chequear('con un solo elemento no se puede mover a ningún lado',
  mover(UNO, 'solo', 'arriba').length === 0 && mover(UNO, 'solo', 'abajo').length === 0);
chequear('lista vacía no revienta', mover([], 'x', 'arriba').length === 0);
chequear('sin argumentos tampoco', mover().length === 0);

// ── Qué flechas se apagan ───────────────────────────────────────────────────
console.log('\nQué flechas se apagan:');
L = [s('a', 'A', 1), s('b', 'B', 2), s('c', 'C', 3)];
chequear('el primero no puede subir', puedeMover(L, 'a').arriba === false);
chequear('el primero sí puede bajar', puedeMover(L, 'a').abajo === true);
chequear('el último no puede bajar', puedeMover(L, 'c').abajo === false);
chequear('el del medio puede las dos', puedeMover(L, 'b').arriba && puedeMover(L, 'b').abajo);
chequear('el único no puede ninguna',
  !puedeMover(UNO, 'solo').arriba && !puedeMover(UNO, 'solo').abajo);
chequear('un id que no está, ninguna',
  !puedeMover(L, 'fantasma').arriba && !puedeMover(L, 'fantasma').abajo);

// ── El caso que lo pidió ────────────────────────────────────────────────────
console.log('\nEl caso del pedido (tres tipos de corte):');
let CORTES = [
  s('clasico', 'Corte clásico', 1),
  s('degrade', 'Degradé', 2),
  s('maquina', 'Corte a máquina', 3),
];
// "El degradé es el que más quiero vender, que aparezca primero."
CORTES = aplicar(CORTES, mover(CORTES, 'degrade', 'arriba'));
chequear('el degradé queda primero', nombres(CORTES) === 'degrade,clasico,maquina', nombres(CORTES));
chequear('y los números quedan limpios',
  JSON.stringify(ordenados(CORTES).map((x) => x.displayOrder)) === '[1,2,3]',
  JSON.stringify(ordenados(CORTES).map((x) => x.displayOrder)));

console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
if (fallas.length) console.log('Fallaron:\n  - ' + fallas.join('\n  - '));
console.log('');
process.exit(fallaron ? 1 : 0);
