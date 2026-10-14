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
  diagnosticoDelIntervalo, serviciosQueAchicanLaGrilla,
  INTERVALO_MIN, INTERVALO_MAX,
  mezclaDeTurnos, recomendacionAutomatica,
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

// -- 9. Quien tira la grilla para abajo --------------------------------------
// El caso real que lo destapo: a Neytan le recomendaba 10 y parecia un bug del
// consejo. No lo era — el consejo estaba bien sobre datos mal cargados. Tenia
// un "Perfilado de cejas con navaja" de 10 minutos como servicio suelto entre
// cortes de 30 y 60, cuando en la practica se hace junto con el corte.
console.log('\nQuién obliga a una grilla más chica de lo necesario:');

const NEYTAN_REAL = [
  srv('a', 'Corte de pelo + perfilado de cejas', 30),
  srv('b', 'Corte + Barba + Perfilado de cejas', 50, { adicional: true }),
  srv('c', 'Perfilado de cejas con navaja', 10),
  srv('d', 'Corte infantil', 30),
  srv('e', '777 SIGNATURE', 60),
  srv('f', 'Mascarilla facial', 30),
];

chequear('con sus datos de hoy el MCD es 10, y está bien calculado',
  intervaloSugerido(NEYTAN_REAL) === 10, String(intervaloSugerido(NEYTAN_REAL)));

const culpables = serviciosQueAchicanLaGrilla(NEYTAN_REAL);
chequear('el culpable es UNO solo', culpables.length === 1, JSON.stringify(culpables));
chequear('y es el perfilado de cejas de 10 minutos',
  culpables[0]?.id === 'c' && culpables[0]?.duracion === 10, JSON.stringify(culpables));
chequear('sin él, la grilla sana sería de 30',
  culpables[0]?.grillaSinEl === 30, String(culpables[0]?.grillaSinEl));
chequear('el adicional de 50 min NO cuenta (no se reserva solo)',
  !culpables.some((c) => c.id === 'b'), JSON.stringify(culpables));

chequear('si todos están alineados, no hay culpables',
  serviciosQueAchicanLaGrilla([srv('a','A',20), srv('b','B',40), srv('c','C',60)]).length === 0);
chequear('con un solo servicio no hay a quién culpar',
  serviciosQueAchicanLaGrilla([srv('a','A',25)]).length === 0);
chequear('sin servicios tampoco', serviciosQueAchicanLaGrilla([]).length === 0);

chequear('el diagnóstico los lleva adentro',
  diagnosticoDelIntervalo(NEYTAN_REAL, 20).culpables?.[0]?.id === 'c',
  JSON.stringify(diagnosticoDelIntervalo(NEYTAN_REAL, 20).culpables));


// ── 7. El intervalo automático: la mezcla real de turnos ────────────────────
// El MCD trata a todos los servicios como si salieran igual, y por eso le
// daba a Volcado Club el consejo equivocado. Medido sobre 6000 días
// simulados, el cruce está en 1 de cada 5: si el servicio que no encaja en la
// grilla sale menos que eso, conviene la grilla del más pedido.
console.log('\nLa mezcla real de turnos:');

const turnosDe = (pares, fecha = '2026-10-01') =>
  pares.flatMap(([id, n]) => Array.from({ length: n }, () => ({
    serviceId: id, appointmentDate: fecha, status: 'completada',
  })));
const HOY = new Date('2026-10-13T12:00:00');
const ayer = (dias) => {
  const d = new Date(HOY); d.setDate(d.getDate() - dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Volcado Club, como está en producción: corte 60 y barba 30, grilla en 60.
const VOLCADO = [srv('c', 'Corte', 60), srv('b', 'Barba', 30)];
const VOLCADO_TURNOS = turnosDe([['c', 108], ['b', 12]]);

const mz = mezclaDeTurnos(VOLCADO_TURNOS, VOLCADO, { hoy: HOY });
chequear('cuenta los 120 turnos', mz.total === 120, String(mz.total));
chequear('el más pedido queda primero, con su nombre',
  mz.grupos[0].duracion === 60 && mz.grupos[0].turnos === 108 && mz.grupos[0].nombre === 'Corte',
  JSON.stringify(mz.grupos[0]));
chequear('la barba sale 1 de cada 10',
  Math.abs(mz.grupos[1].proporcion - 0.1) < 1e-9, String(mz.grupos[1].proporcion));

const vol = recomendacionAutomatica(VOLCADO, VOLCADO_TURNOS, { hoy: HOY });
chequear('VOLCADO: recomienda 60, no el MCD de 30',
  vol.hay && vol.intervalo === 60 && vol.motivo === 'mas-pedido', JSON.stringify(vol.intervalo));
chequear('VOLCADO: el MCD seguía diciendo 30 (el consejo que estaba mal)',
  intervaloSugerido(VOLCADO) === 30, String(intervaloSugerido(VOLCADO)));
chequear('VOLCADO: nombra qué servicio no encaja y cuánto pesa',
  vol.noEncajan.length === 1 && vol.noEncajan[0].nombre === 'Barba'
  && Math.abs(vol.pesoQueNoEncaja - 0.1) < 1e-9, JSON.stringify(vol.noEncajan));

// El cruce. Con 20 de 100 todavía gana el más pedido; con 21, el MCD.
const enElCruce = (n) => recomendacionAutomatica(
  VOLCADO, turnosDe([['c', 100 - n], ['b', n]]), { hoy: HOY });
chequear('justo en el cruce (20%) todavía gana el más pedido',
  enElCruce(20).intervalo === 60, String(enElCruce(20).intervalo));
chequear('pasado el cruce (21%) pasa al MCD',
  enElCruce(21).intervalo === 30 && enElCruce(21).motivo === 'mcd', String(enElCruce(21).intervalo));
// Con mayoria clara del corte, el que no encaja pesa demasiado y manda el MCD.
chequear('corte 60% / barba 40%: el que no encaja pesa demasiado, va el MCD',
  enElCruce(40).intervalo === 30 && enElCruce(40).motivo === 'mcd',
  JSON.stringify([enElCruce(40).intervalo, enElCruce(40).motivo]));
// Empatados, el desempate toma el mas CORTO: ahi el de 60 encaja solo y se
// llega a la misma respuesta sin necesitar el MCD.
chequear('mitad y mitad: 30, y por el camino limpio (el de 60 encaja)',
  enElCruce(50).intervalo === 30 && enElCruce(50).motivo === 'mas-pedido',
  JSON.stringify([enElCruce(50).intervalo, enElCruce(50).motivo]));

// El barbero que trajo el problema: 20 y 40. El 40 ES múltiplo de 20, así que
// nada queda afuera y la respuesta es la misma que daba el MCD.
const vein = recomendacionAutomatica(NEYTAN, turnosDe([['c', 70], ['d', 30]]), { hoy: HOY });
chequear('20/40: recomienda 20 (el 40 encaja en la grilla de 20)',
  vein.intervalo === 20 && vein.pesoQueNoEncaja === 0, JSON.stringify([vein.intervalo, vein.pesoQueNoEncaja]));

// Si el más pedido es el corto, los largos múltiplos siguen entrando.
const corto = recomendacionAutomatica(VOLCADO, turnosDe([['b', 70], ['c', 30]]), { hoy: HOY });
chequear('si el más pedido es el de 30, la grilla es 30 y el de 60 encaja',
  corto.intervalo === 30 && corto.pesoQueNoEncaja === 0, String(corto.intervalo));

// Duraciones que no se pueden alinear: ni el MCD sirve.
const FEO = [srv('a', 'A', 25), srv('b', 'B', 40)];
const feo = recomendacionAutomatica(FEO, turnosDe([['a', 50], ['b', 50]]), { hoy: HOY });
chequear('25 y 40 mitad y mitad: no hay grilla razonable, hay que redondear',
  !feo.hay && feo.motivo === 'desalineados' && feo.intervalo === null, JSON.stringify(feo.motivo));
chequear('pero si el de 25 casi no sale, la grilla es la del de 40',
  recomendacionAutomatica(FEO, turnosDe([['b', 95], ['a', 5]]), { hoy: HOY }).intervalo === 40);

// ── Lo que NO se cuenta ─────────────────────────────────────────────────────
console.log('\nQué turnos entran en la cuenta:');
chequear('los cancelados no cuentan: no ocuparon el horario',
  mezclaDeTurnos([...turnosDe([['c', 5]]), ...turnosDe([['b', 50]]).map((t) => ({ ...t, status: 'cancelada' }))],
    VOLCADO, { hoy: HOY }).total === 5);
chequear('los "no vino" SÍ cuentan: el horario estuvo tomado',
  mezclaDeTurnos(turnosDe([['c', 5]]).map((t) => ({ ...t, status: 'no_asistio' })), VOLCADO, { hoy: HOY }).total === 5);
chequear('los más viejos que la ventana no cuentan',
  mezclaDeTurnos(turnosDe([['c', 30]], ayer(200)), VOLCADO, { hoy: HOY }).total === 0);
chequear('los de hace 89 días sí',
  mezclaDeTurnos(turnosDe([['c', 30]], ayer(89)), VOLCADO, { hoy: HOY }).total === 30);
chequear('los de un servicio borrado no cuentan',
  mezclaDeTurnos(turnosDe([['fantasma', 30]]), VOLCADO, { hoy: HOY }).total === 0);
chequear('los de un adicional tampoco (no se reservan solos)',
  mezclaDeTurnos(turnosDe([['x', 30]]), [...VOLCADO, srv('x', 'Cejas', 10, { adicional: true })], { hoy: HOY }).total === 0);
chequear('los de un servicio desactivado tampoco',
  mezclaDeTurnos(turnosDe([['x', 30]]), [...VOLCADO, srv('x', 'Viejo', 45, { isActive: false })], { hoy: HOY }).total === 0);

// ── Cuándo NO opina ─────────────────────────────────────────────────────────
console.log('\nCuándo el automático se calla:');
chequear('con menos de 20 turnos no opina: una mezcla de 8 salta por un turno',
  recomendacionAutomatica(VOLCADO, turnosDe([['c', 15], ['b', 4]]), { hoy: HOY }).motivo === 'sin-historial');
chequear('con 20 justos ya opina',
  recomendacionAutomatica(VOLCADO, turnosDe([['c', 20]]), { hoy: HOY }).hay === true);
chequear('sin turnos, "sin-historial" y dice cuántos tiene',
  recomendacionAutomatica(VOLCADO, [], { hoy: HOY }).turnos === 0);
chequear('sin servicios, "sin-servicios"',
  recomendacionAutomatica([], VOLCADO_TURNOS, { hoy: HOY }).motivo === 'sin-servicios');
chequear('no revienta con basura',
  recomendacionAutomatica(undefined, undefined).hay === false);
chequear('ni con turnos a medio cargar',
  mezclaDeTurnos([null, {}, { serviceId: 'c' }], VOLCADO, { hoy: HOY }).total === 0);

// Un servicio más largo que el máximo que se puede escribir.
const LARGO = [srv('a', 'Jornada', 180), srv('b', 'Corte', 60)];
chequear('un servicio de 180 no se recomienda como grilla (el tope es 120)',
  recomendacionAutomatica(LARGO, turnosDe([['a', 95], ['b', 5]]), { hoy: HOY }).intervalo === 60,
  String(recomendacionAutomatica(LARGO, turnosDe([['a', 95], ['b', 5]]), { hoy: HOY }).intervalo));
console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
if (fallas.length) console.log('Fallaron:\n  - ' + fallas.join('\n  - '));
console.log('');
process.exit(fallaron ? 1 : 0);
