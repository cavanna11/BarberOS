// El intervalo de la grilla: el consejo que le damos al barbero y la defensa
// del motor. Sin emulador — es aritmética.
//
//   node scripts/test-intervalo.mjs
//
// El caso que originó todo esto: un barbero con corte clásico de 20 minutos y
// degradé de 40, con la grilla cada 30. Los números de abajo están medidos
// contra el motor de verdad (availabilityEngine) sobre una jornada de 09:00 a
// 20:00 con 15 turnos mezclados:
//
//   grilla cada 30 → 200 minutos muertos, el día termina 19:20
//   grilla cada 20 →   0 minutos muertos, el día termina 16:00
//
// Si alguno de estos casos empieza a fallar, el consejo que ve el barbero dejó
// de ser cierto.
import {
  mcd, normalizarIntervalo, duracionesDe, intervaloSugerido,
  desperdicioPorServicio, turnosQueEntran, jornadaSemanal,
  diagnosticoDelIntervalo, INTERVALO_MIN, INTERVALO_MAX,
} from '../src/utils/intervalo.js';

let pasaron = 0, fallaron = 0;
const fallas = [];
const chequear = (t, ok, d = '') => {
  if (ok) { pasaron++; console.log('  ok    ', t); }
  else { fallaron++; fallas.push(t); console.log('  FALLA ', t, d ? `\n           ${d}` : ''); }
};

const srv = (id, name, durationMinutes, extra = {}) => ({ id, name, durationMinutes, ...extra });

// El catálogo del barbero que preguntó.
const NEYTAN = [srv('c', 'Corte clásico', 20), srv('d', 'Degradé', 40)];

// ── 1. El mínimo común divisor ──────────────────────────────────────────────
console.log('\nMáximo común divisor:');
for (const [a, b, esperado] of [[20, 40, 20], [40, 20, 20], [25, 40, 5], [30, 45, 15], [30, 30, 30], [7, 13, 1]]) {
  chequear(`mcd(${a}, ${b}) = ${esperado}`, mcd(a, b) === esperado, String(mcd(a, b)));
}

// ── 2. Un intervalo siempre usable ──────────────────────────────────────────
// Es lo que protege al motor: `for (c = inicio; c < fin; c += intervalo)` con
// un 0 adentro no termina nunca y le congela el navegador a cada cliente que
// abra el link de esa barbería.
console.log('\nNormalizar el intervalo (la defensa contra el bucle infinito):');
for (const [entrada, esperado, por] of [
  [30, 30, 'normal'],
  [0, 30, 'CERO: congelaría el navegador'],
  [-10, 30, 'negativo'],
  [null, 30, 'vacío'],
  [undefined, 30, 'sin definir'],
  ['abc', 30, 'texto'],
  [NaN, 30, 'NaN'],
  [1, 30, 'por debajo del mínimo'],
  [5, 5, 'el mínimo justo'],
  [999, INTERVALO_MAX, 'absurdamente grande'],
  ['20', 20, 'texto numérico, como llega de un input'],
  [22.6, 23, 'con decimales'],
]) {
  const r = normalizarIntervalo(entrada);
  chequear(`${JSON.stringify(entrada)} → ${esperado} (${por})`, r === esperado, String(r));
}
chequear('nunca devuelve algo menor al mínimo',
  [0, -5, 1, 4, NaN, null, 'x'].every((v) => normalizarIntervalo(v) >= INTERVALO_MIN));

// ── 3. Qué duraciones cuentan ───────────────────────────────────────────────
console.log('\nQué servicios entran en la cuenta:');
chequear('las duraciones salen ordenadas y sin repetir',
  JSON.stringify(duracionesDe([srv('a', 'A', 40), srv('b', 'B', 20), srv('c', 'C', 40)])) === '[20,40]');
chequear('un servicio inactivo no cuenta',
  JSON.stringify(duracionesDe([srv('a', 'A', 20), srv('b', 'B', 45, { isActive: false })])) === '[20]');
chequear('un ADICIONAL no cuenta: no se reserva solo, se suma al corte',
  JSON.stringify(duracionesDe([srv('a', 'A', 20), srv('b', 'Cejas', 7, { adicional: true })])) === '[20]');
chequear('una duración rota no cuenta',
  JSON.stringify(duracionesDe([srv('a', 'A', 20), srv('b', 'B', 0), srv('c', 'C', null)])) === '[20]');
chequear('sin servicios, lista vacía', duracionesDe([]).length === 0);

// ── 4. El intervalo sugerido ────────────────────────────────────────────────
console.log('\nEl intervalo que no desperdicia nada:');
chequear('20 y 40 → 20 (el caso de Neytan)', intervaloSugerido(NEYTAN) === 20, String(intervaloSugerido(NEYTAN)));
chequear('20, 30 y 40 → 10', intervaloSugerido([srv('a','A',20), srv('b','B',30), srv('c','C',40)]) === 10);
chequear('un solo servicio de 45 → 45', intervaloSugerido([srv('a','A',45)]) === 45);
chequear('30 y 60 → 30', intervaloSugerido([srv('a','A',30), srv('b','B',60)]) === 30);
chequear('25 y 40 → null: el MCD es 5 y una grilla de 5 son 132 opciones por día',
  intervaloSugerido([srv('a','A',25), srv('b','B',40)]) === null,
  String(intervaloSugerido([srv('a','A',25), srv('b','B',40)])));
chequear('20 y 30 → 10: es chico pero se puede ofrecer',
  intervaloSugerido([srv('a','A',20), srv('b','B',30)]) === 10);
chequear('sin servicios → null', intervaloSugerido([]) === null);

// ── 5. Los minutos muertos ──────────────────────────────────────────────────
// Estos cuatro números son los que ve el barbero en el panel. Salen de la
// simulación contra el motor real.
console.log('\nMinutos muertos por turno (lo que se le muestra):');
const con30 = desperdicioPorServicio(NEYTAN, 30);
chequear('con grilla de 30, el degradé (40 min) deja 20 muertos',
  con30.find((x) => x.id === 'd').desperdicio === 20, JSON.stringify(con30));
chequear('con grilla de 30, el clásico (20 min) deja 10 muertos',
  con30.find((x) => x.id === 'c').desperdicio === 10, JSON.stringify(con30));
chequear('se ordena por el que más pierde', con30[0].id === 'd');

const con20 = desperdicioPorServicio(NEYTAN, 20);
chequear('con grilla de 20, NINGUNO pierde nada',
  con20.every((x) => x.desperdicio === 0), JSON.stringify(con20));

chequear('con grilla de 60, el clásico pierde 40 y el degradé 20',
  desperdicioPorServicio(NEYTAN, 60).every((x) =>
    (x.id === 'c' && x.desperdicio === 40) || (x.id === 'd' && x.desperdicio === 20)),
  JSON.stringify(desperdicioPorServicio(NEYTAN, 60)));

chequear('con grilla de 15 el clásico pierde 10 (15 no divide a 20)',
  desperdicioPorServicio(NEYTAN, 15).find((x) => x.id === 'c').desperdicio === 10);

chequear('un intervalo roto no rompe la cuenta',
  desperdicioPorServicio(NEYTAN, 0).every((x) => Number.isFinite(x.desperdicio) && x.desperdicio >= 0));

// ── 6. Cuántos turnos entran ────────────────────────────────────────────────
// La jornada del ejemplo: 09:00 a 20:00 son 660 minutos.
console.log('\nCuántos turnos entran en el día (09:00–20:00, 660 minutos):');
chequear('clásico de 20 con grilla de 30: 22 turnos', turnosQueEntran(20, 30, 660) === 22, String(turnosQueEntran(20, 30, 660)));
chequear('clásico de 20 con grilla de 20: 33 turnos', turnosQueEntran(20, 20, 660) === 33, String(turnosQueEntran(20, 20, 660)));
chequear('degradé de 40 con grilla de 30: 11 turnos', turnosQueEntran(40, 30, 660) === 11, String(turnosQueEntran(40, 30, 660)));
chequear('degradé de 40 con grilla de 20: 16 turnos', turnosQueEntran(40, 20, 660) === 16, String(turnosQueEntran(40, 20, 660)));
chequear('con jornada en cero, cero turnos', turnosQueEntran(20, 20, 0) === 0);

// ── 7. La jornada, del horario cargado ──────────────────────────────────────
console.log('\nLa jornada semanal sale del horario del local:');
const semana = [0,1,2,3,4].map((d) => ({ dayOfWeek: d, startTime: '09:00', endTime: '20:00', isActive: true }))
  .concat([{ dayOfWeek: 5, startTime: '09:00', endTime: '18:00', isActive: true },
           { dayOfWeek: 6, startTime: '', endTime: '', isActive: false }]);
chequear('5 días de 11 h + sábado de 9 h = 3840 minutos', jornadaSemanal(semana) === 3840, String(jornadaSemanal(semana)));
chequear('el corte del mediodía se descuenta',
  jornadaSemanal([{ dayOfWeek: 0, startTime: '09:00', endTime: '20:00', isActive: true, breakStart: '13:00', breakEnd: '16:00' }]) === 480,
  String(jornadaSemanal([{ dayOfWeek: 0, startTime: '09:00', endTime: '20:00', isActive: true, breakStart: '13:00', breakEnd: '16:00' }])));
chequear('un día cerrado no suma', jornadaSemanal([{ dayOfWeek: 6, startTime: '', endTime: '', isActive: false }]) === 0);
chequear('un horario al revés no resta', jornadaSemanal([{ dayOfWeek: 0, startTime: '20:00', endTime: '09:00', isActive: true }]) === 0);

// ── 8. El diagnóstico que se pinta ──────────────────────────────────────────
console.log('\nEl diagnóstico completo:');
let d = diagnosticoDelIntervalo(NEYTAN, 30);
chequear('30 con 20 y 40 → mejorable, y sugiere 20',
  d.estado === 'mejorable' && d.sugerido === 20 && d.perdidas.length === 2, JSON.stringify(d));

d = diagnosticoDelIntervalo(NEYTAN, 20);
chequear('20 con 20 y 40 → ok, no molesta con nada', d.estado === 'ok', JSON.stringify(d));

d = diagnosticoDelIntervalo(NEYTAN, 10);
chequear('10 con 20 y 40 -> muy-fino: no pierde nada, pero la grilla sobra',
  diagnosticoDelIntervalo(NEYTAN, 10).estado === 'muy-fino', JSON.stringify(diagnosticoDelIntervalo(NEYTAN, 10)));

// El caso que trajo Santiago: un servicio de 60 entre los de 20 y 40.
// Preocupaba que la grilla de 10 "atrasara" los turnos. El motor ya bloquea la
// hora entera con un turno de 60 (verificado aparte, contra el motor), pero sí
// aparece el problema de al lado: huecos de 10 minutos donde no entra nada.
// Medido sobre 200 días con clientes eligiendo a gusto:
//   grilla 10 -> 3.3 huecos/día de menos de 20 min = 33 minutos tirados
//   grilla 20 -> 0 huecos inútiles y MÁS minutos vendidos
const CON_COLOR = [srv('c','Corte',20), srv('d','Degradé',40), srv('x','Color',60)];
chequear('20, 40 y 60 -> el MCD es 20', intervaloSugerido(CON_COLOR) === 20, String(intervaloSugerido(CON_COLOR)));
chequear('con grilla de 10 avisa que sobra, y sugiere 20',
  diagnosticoDelIntervalo(CON_COLOR, 10).estado === 'muy-fino'
  && diagnosticoDelIntervalo(CON_COLOR, 10).sugerido === 20);
chequear('con grilla de 20 no molesta', diagnosticoDelIntervalo(CON_COLOR, 20).estado === 'ok');
chequear('con grilla de 30 avisa que pierde (30 no divide a 20)',
  diagnosticoDelIntervalo(CON_COLOR, 30).estado === 'mejorable');
chequear('con grilla de 60 pierde muchísimo: el corte de 20 bloquea una hora',
  desperdicioPorServicio(CON_COLOR, 60).find((x) => x.id === 'c').desperdicio === 40);

d = diagnosticoDelIntervalo([srv('a','A',25), srv('b','B',40)], 30);
chequear('25 y 40 → desalineados: el consejo es redondear las duraciones',
  d.estado === 'desalineados' && d.sugerido === undefined, JSON.stringify(d));
chequear('y aun así informa cuánto pierde cada uno', d.perdidas.length === 2, JSON.stringify(d.perdidas));

chequear('sin servicios cargados no se opina', diagnosticoDelIntervalo([], 30).estado === 'sin-servicios');
chequear('con solo adicionales tampoco',
  diagnosticoDelIntervalo([srv('a','Cejas',7,{adicional:true})], 30).estado === 'sin-servicios');

console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
if (fallas.length) console.log('Fallaron:\n  - ' + fallas.join('\n  - '));
console.log('');
process.exit(fallaron ? 1 : 0);
