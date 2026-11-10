// La aritmética de los cupones, sin emulador.
//
//   node scripts/test-cupones.mjs
//
// Dos cosas se prueban acá:
//
//   1. Que el descuento esté bien calculado. Un porcentaje mal aplicado se
//      cobra de menos a TODOS los clientes, en silencio, hasta que alguien
//      mira la caja a fin de mes.
//   2. Que `functions/cupones.js` y `src/utils/cupon.js` digan lo mismo. Están
//      duplicados porque las Functions no pueden importar del bundle de Vite
//      (igual que `planes.js`), y un duplicado que se desincroniza es peor que
//      no tener el chequeo: el cliente ve un precio y se le cobra otro.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const srv = require('../functions/cupones.js');

// `src/utils/cupon.js` usa `window` adentro de `linkDelCupon`. Importar el
// módulo no lo toca, pero el stub deja probar también esa función.
globalThis.window = { location: { origin: 'https://barberos.sacia.tech' } };
globalThis.sessionStorage = {
  _d: new Map(),
  getItem(k) { return this._d.has(k) ? this._d.get(k) : null; },
  setItem(k, v) { this._d.set(k, String(v)); },
  removeItem(k) { this._d.delete(k); },
};
const web = await import('../src/utils/cupon.js');

let pasaron = 0, fallaron = 0;
const fallas = [];
const chequear = (t, ok, d = '') => {
  if (ok) { pasaron++; console.log('  ok    ', t); }
  else { fallaron++; fallas.push(t); console.log('  FALLA ', t, d ? `\n           ${d}` : ''); }
};

// ── 1. Normalizar el código ─────────────────────────────────────────────────
// La gente escribe con espacios y en minúscula. Si el cupón que el dueño
// repartió por Instagram no entra por un espacio de más, se entera por un
// cliente enojado.
console.log('\nNormalizar el código:');
for (const [entrada, esperado] of [
  ['corte20', 'CORTE20'],
  ['  CORTE20  ', 'CORTE20'],
  ['Corte 20', 'CORTE20'],
  ['corte-20', 'CORTE-20'],
  ['CORTE\t20\n', 'CORTE20'],
  ['', ''],
  [null, ''],
  [undefined, ''],
]) {
  chequear(`${JSON.stringify(entrada)} → ${esperado || '(vacío)'}`,
    srv.normalizarCodigo(entrada) === esperado, srv.normalizarCodigo(entrada));
}

console.log('\nCódigos que no se aceptan:');
for (const [codigo, vale, por] of [
  ['CORTE20', true, 'normal'],
  ['AB', false, 'muy corto'],
  ['ABC', true, 'tres caracteres, el mínimo'],
  ['A'.repeat(24), true, 'veinticuatro, el máximo'],
  ['A'.repeat(25), false, 'veinticinco, uno de más'],
  ['-CORTE', false, 'no puede arrancar con guión'],
  ['CORTE_20', false, 'guión bajo no'],
  ['CORTE.20', false, 'punto no'],
  ['CORTE/20', false, 'barra no: va adentro de una URL'],
  ['CORTE<X>', false, 'nada de etiquetas'],
  ['corte 20', true, 'se normaliza antes de validar'],
]) {
  chequear(`${JSON.stringify(codigo)} (${por})`, srv.codigoValido(codigo) === vale);
}

// ── 2. El descuento ─────────────────────────────────────────────────────────
console.log('\nCuánto descuenta:');
const casos = [
  // [cupón, precio, descuento esperado, final esperado, por qué]
  [{ tipo: 'porcentaje', valor: 20 }, 15000, 3000, 12000, 'el caso del enunciado'],
  [{ tipo: 'porcentaje', valor: 100 }, 15000, 15000, 0, 'el 100% deja el turno gratis, no negativo'],
  [{ tipo: 'porcentaje', valor: 0 }, 15000, 0, 15000, 'cero no descuenta'],
  [{ tipo: 'porcentaje', valor: 150 }, 15000, 15000, 0, 'más de 100 se recorta a 100'],
  [{ tipo: 'porcentaje', valor: -20 }, 15000, 0, 15000, 'un porcentaje negativo NO sube el precio'],
  [{ tipo: 'porcentaje', valor: 33 }, 14500, 4785, 9715, 'sin centavos: 4785.0000000000005 se redondea'],
  [{ tipo: 'fijo', valor: 3000 }, 15000, 3000, 12000, 'monto fijo'],
  [{ tipo: 'fijo', valor: 20000 }, 15000, 15000, 0, 'un fijo mayor al precio se recorta al precio'],
  [{ tipo: 'fijo', valor: -3000 }, 15000, 0, 15000, 'un fijo negativo no sube el precio'],
  [{ tipo: 'fijo', valor: 3000 }, 0, 0, 0, 'sobre un precio en cero no hay nada que descontar'],
  [{ tipo: 'inventado', valor: 50 }, 15000, 0, 15000, 'un tipo que no existe no descuenta nada'],
  [{ tipo: 'porcentaje', valor: 20 }, -500, 0, 0, 'un precio negativo se trata como cero'],
];

for (const [cupon, precio, desc, final, por] of casos) {
  const r = srv.calcularDescuento(cupon, precio);
  chequear(`${por}`, r.descuento === desc && r.precioFinal === final,
    `esperado −${desc} → ${final}, fue −${r.descuento} → ${r.precioFinal}`);
}

// La propiedad que no puede fallar en ningún caso, probada a lo bruto.
console.log('\nLas tres invariantes, sobre 2000 combinaciones:');
let rotas = 0;
for (let i = 0; i < 2000; i++) {
  const precio = Math.floor(Math.random() * 200000) - 10000;
  const tipo = Math.random() < 0.5 ? 'porcentaje' : 'fijo';
  const valor = Math.floor(Math.random() * 300) - 50;
  const r = srv.calcularDescuento({ tipo, valor }, precio);
  const base = Math.max(0, Math.round(precio));
  if (r.precioFinal < 0 || r.descuento < 0 || r.descuento > base
      || r.descuento + r.precioFinal !== base
      || !Number.isInteger(r.precioFinal) || !Number.isInteger(r.descuento)) {
    rotas++;
    if (rotas === 1) console.log('   primera rota:', { precio, tipo, valor, ...r });
  }
}
chequear('nunca negativo, nunca mayor al precio, siempre entero, y los dos suman el precio', rotas === 0, `${rotas} rotas`);

// ── 3. Cuándo aplica ────────────────────────────────────────────────────────
console.log('\nCuándo aplica y cuándo no:');
const AHORA = new Date('2026-10-08T15:00:00Z');
const base = { activo: true, tipo: 'porcentaje', valor: 20, usos: 0 };

const ev = (cupon, ctx = {}) => srv.evaluarCupon({ ...base, ...cupon }, { ahora: AHORA, ...ctx });

chequear('un cupón normal aplica', ev({}).aplica === true, JSON.stringify(ev({})));
chequear('apagado no', ev({ activo: false }).motivo === srv.MOTIVOS.INACTIVO);
chequear('que no existe, no', srv.evaluarCupon(null, {}).motivo === srv.MOTIVOS.NO_EXISTE);
chequear('todavía no empieza', ev({ desde: '2026-10-09T00:00' }).motivo === srv.MOTIVOS.NO_VIGENTE);
chequear('ya empezó', ev({ desde: '2026-10-01T00:00' }).aplica === true);
chequear('vencido', ev({ hasta: '2026-10-07T00:00' }).motivo === srv.MOTIVOS.VENCIDO);
chequear('vigente', ev({ desde: '2026-10-01T00:00', hasta: '2026-12-31T23:59' }).aplica === true);

chequear('agotado', ev({ maxUsos: 5, usos: 5 }).motivo === srv.MOTIVOS.AGOTADO);
chequear('con un lugar libre, entra', ev({ maxUsos: 5, usos: 4 }).aplica === true);
chequear('maxUsos en 0 significa SIN tope', ev({ maxUsos: 0, usos: 9999 }).aplica === true);

chequear('tope por cliente alcanzado',
  ev({ maxUsosPorCliente: 1 }, { usosDelCliente: 1 }).motivo === srv.MOTIVOS.TOPE_CLIENTE);
chequear('tope por cliente con lugar', ev({ maxUsosPorCliente: 2 }, { usosDelCliente: 1 }).aplica === true);

chequear('solo primera visita, y ya vino',
  ev({ soloPrimeraVisita: true }, { tieneTurnosPrevios: true }).motivo === srv.MOTIVOS.NO_ES_PRIMERA);
chequear('solo primera visita, y es la primera',
  ev({ soloPrimeraVisita: true }, { tieneTurnosPrevios: false }).aplica === true);

chequear('servicio no incluido',
  ev({ serviciosIds: ['s1'] }, { serviceId: 's2' }).motivo === srv.MOTIVOS.SERVICIO);
chequear('servicio incluido', ev({ serviciosIds: ['s1', 's2'] }, { serviceId: 's2' }).aplica === true);
chequear('lista de servicios vacía = todos', ev({ serviciosIds: [] }, { serviceId: 's9' }).aplica === true);
chequear('sin lista de servicios = todos', ev({}, { serviceId: 's9' }).aplica === true);

chequear('profesional no incluido',
  ev({ profesionalesIds: ['p1'] }, { professionalId: 'p2' }).motivo === srv.MOTIVOS.PROFESIONAL);
chequear('profesional incluido', ev({ profesionalesIds: ['p1'] }, { professionalId: 'p1' }).aplica === true);

// ── 4. Los dos módulos tienen que decir lo mismo ───────────────────────────
console.log('\nEl servidor y el browser calculan igual:');
let distintos = 0;
for (let i = 0; i < 1000; i++) {
  const precio = Math.floor(Math.random() * 100000);
  const tipo = Math.random() < 0.5 ? 'porcentaje' : 'fijo';
  const valor = Math.floor(Math.random() * 200);
  const a = srv.calcularDescuento({ tipo, valor }, precio);
  const b = web.calcularDescuento({ tipo, valor }, precio);
  if (a.descuento !== b.descuento || a.precioFinal !== b.precioFinal) {
    distintos++;
    if (distintos === 1) console.log('   primera diferencia:', { precio, tipo, valor, servidor: a, browser: b });
  }
}
chequear('el mismo descuento en 1000 combinaciones', distintos === 0, `${distintos} distintas`);

let codigosDistintos = 0;
for (const c of ['corte20', ' Corte 20 ', 'CORTE-20', '', 'a'.repeat(30), 'ñandu']) {
  if (srv.normalizarCodigo(c) !== web.normalizarCodigo(c)) codigosDistintos++;
  if (srv.codigoValido(c) !== web.codigoValido(c)) codigosDistintos++;
}
chequear('la misma normalización y la misma validación', codigosDistintos === 0, `${codigosDistintos} distintas`);
chequear('el mismo texto de rechazo', srv.MENSAJE_AL_CLIENTE === web.MENSAJE_AL_CLIENTE);
chequear('la misma expresión para el código', String(srv.CODIGO_OK) === String(web.CODIGO_OK));

// ── 5. Los textos y el link ────────────────────────────────────────────────
console.log('\nTextos y link:');
chequear('describe un porcentaje', srv.describirCupon({ tipo: 'porcentaje', valor: 20 }) === '20% OFF');
chequear('describe un fijo', srv.describirCupon({ tipo: 'fijo', valor: 3000 }) === '$3.000 OFF');
chequear('el link lleva el código normalizado',
  web.linkDelCupon('volcadoclub', ' corte 20 ') === 'https://barberos.sacia.tech/volcadoclub?cupon=CORTE20',
  web.linkDelCupon('volcadoclub', ' corte 20 '));
chequear('con servicio preseleccionado',
  web.linkDelCupon('volcadoclub', 'CORTE20', 's1').endsWith('?cupon=CORTE20&servicio=s1'),
  web.linkDelCupon('volcadoclub', 'CORTE20', 's1'));
chequear('el mensaje para compartir nombra la barbería, el descuento y el código',
  (() => {
    const m = web.mensajeParaCompartir({ tipo: 'porcentaje', valor: 20, codigo: 'CORTE20' }, 'Volcado Club', 'https://x');
    return m.includes('Volcado Club') && m.includes('20% OFF') && m.includes('CORTE20') && m.includes('https://x');
  })());

// ── 6. El estado que ve el dueño ───────────────────────────────────────────
console.log('\nEl estado en la lista del panel:');
const est = (c) => web.estadoDelCupon({ activo: true, usos: 0, ...c }, AHORA).estado;
chequear('andando', est({}) === 'activo');
chequear('apagado', est({ activo: false }) === 'inactivo');
chequear('todavía no empieza', est({ desde: '2026-12-01T00:00' }) === 'no-vigente');
chequear('vencido', est({ hasta: '2026-01-01T00:00' }) === 'vencido');
chequear('agotado', est({ maxUsos: 3, usos: 3 }) === 'agotado');

// ── 7. El cupón del link sobrevive ─────────────────────────────────────────
// Es lo que hace que un link de Instagram sirva para algo: entre que el cliente
// toca y confirma hay un login y, con seña, un viaje a Mercado Pago.
console.log('\nEl cupón del link, guardado por visita:');
web.recordarCupon('biz-1', ' corte 20 ');
chequear('se guarda normalizado', web.cuponRecordado('biz-1') === 'CORTE20', String(web.cuponRecordado('biz-1')));
chequear('es por barbería: en otra no está', web.cuponRecordado('biz-2') === null);
web.recordarCupon('biz-2', 'OTRO10');
chequear('cada barbería tiene el suyo',
  web.cuponRecordado('biz-1') === 'CORTE20' && web.cuponRecordado('biz-2') === 'OTRO10');
web.olvidarCupon('biz-1');
chequear('se olvida al usarlo', web.cuponRecordado('biz-1') === null);
chequear('olvidar uno no toca el otro', web.cuponRecordado('biz-2') === 'OTRO10');


// ── 8. Días de la semana ───────────────────────────────────────────────────
// Lo pidió Franlook: un cupón para llenar lunes a miércoles. Cuenta el día del
// TURNO. 09/11/2026 es lunes; 12/11 jueves; 15/11 domingo.
console.log('\nDías de la semana:');
const LMM = { activo: true, tipo: 'porcentaje', valor: 20, dias: [0, 1, 2] };
const evDia = (c, fecha) => srv.evaluarCupon(c, { ahora: AHORA, fecha });
chequear('lunes 09/11 = 0', srv.diaDeLaSemana('2026-11-09') === 0);
chequear('domingo 15/11 = 6', srv.diaDeLaSemana('2026-11-15') === 6);
chequear('vale un lunes', evDia(LMM, '2026-11-09').aplica === true);
chequear('vale un miércoles', evDia(LMM, '2026-11-11').aplica === true);
chequear('no vale un jueves, con motivo día', evDia(LMM, '2026-11-12').motivo === srv.MOTIVOS.DIA);
chequear('no vale un domingo', evDia(LMM, '2026-11-15').aplica === false);
chequear('sin fecha, un cupón con días no aplica', evDia(LMM, null).aplica === false);
chequear('sin días vale cualquier día', evDia({ ...LMM, dias: [] }, '2026-11-15').aplica === true);
chequear('sin el campo vale cualquier día', evDia({ activo: true, tipo: 'fijo', valor: 100 }, '2026-11-14').aplica === true);
chequear('los 7 tildados = todos', srv.diasDelCupon({ dias: [0, 1, 2, 3, 4, 5, 6] }).length === 0);
chequear('basura en dias se ignora', JSON.stringify(srv.diasDelCupon({ dias: [2, '1', 9, -1, 2, 'x'] })) === '[1,2]');
chequear('el día va último: agotado gana sobre el día',
  evDia({ ...LMM, maxUsos: 1, usos: 1 }, '2026-11-12').motivo === srv.MOTIVOS.AGOTADO);
chequear('aplicarCupon descuenta en día válido',
  srv.aplicarCupon(LMM, 10000, { ahora: AHORA, fecha: '2026-11-10' }).precioFinal === 8000);
chequear('aplicarCupon cobra lista en día inválido',
  srv.aplicarCupon(LMM, 10000, { ahora: AHORA, fecha: '2026-11-13' }).precioFinal === 10000);
chequear('texto rango', srv.textoDeDias([0, 1, 2]) === 'de lunes a miércoles', srv.textoDeDias([0, 1, 2]));
chequear('texto salteado', srv.textoDeDias([0, 2, 4]) === 'lunes, miércoles y viernes', srv.textoDeDias([0, 2, 4]));
chequear('texto dos', srv.textoDeDias([5, 6]) === 'sábado y domingo', srv.textoDeDias([5, 6]));
chequear('texto uno', srv.textoDeDias([5]) === 'los sábados' && srv.textoDeDias([1]) === 'los martes');
chequear('mensaje al cliente nombra los días', srv.mensajeDeDia(LMM).includes('de lunes a miércoles'));
// El espejo del front tiene que decir lo mismo.
for (const d of [[0, 1, 2], [0, 2, 4], [5, 6], [5], [], [3, 3, 9]]) {
  chequear(`espejo textoDeDias ${JSON.stringify(d)}`, web.textoDeDias(d) === srv.textoDeDias(d));
}
for (const f of ['2026-11-09', '2026-11-12', '2026-11-15', '2027-03-01']) {
  chequear(`espejo diaDeLaSemana ${f}`, web.diaDeLaSemana(f) === srv.diaDeLaSemana(f));
}
chequear('front: cuponValeElDia lunes', web.cuponValeElDia(LMM, '2026-11-09') === true);
chequear('front: cuponValeElDia jueves', web.cuponValeElDia(LMM, '2026-11-12') === false);
chequear('front: sin días vale siempre', web.cuponValeElDia({ dias: [] }, '2026-11-12') === true);
chequear('el mensaje para compartir dice los días',
  web.mensajeParaCompartir({ ...LMM, codigo: 'TRANQUI' }, 'Franlook', 'https://x').includes('Válido para turnos de lunes a miércoles.'));
chequear('sin días el mensaje no cambia',
  !web.mensajeParaCompartir({ ...LMM, dias: [], codigo: 'X20' }, 'F', 'https://x').includes('Válido'));
console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
if (fallas.length) console.log('Fallaron:\n  - ' + fallas.join('\n  - '));
console.log('');
process.exit(fallaron ? 1 : 0);
