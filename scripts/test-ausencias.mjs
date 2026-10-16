// Ausencias: el día suelto que el barbero no va, o el rato que se tiene que ir.
// Sin emulador — es lógica pura sobre fechas y minutos.
//
//   node scripts/test-ausencias.mjs
//
// El caso que lo pidió: una sucursal de Franlook con dos barberos. Justo este
// miércoles Pepito no puede, y el miércoles que viene sí. Si esto se resolviera
// apagando el miércoles en su horario semanal, habría que acordarse de volver a
// prenderlo — y el día que alguien se olvide, pierde todos los miércoles.
//
// Si alguno de estos casos empieza a fallar, un cliente puede sacar turno con
// alguien que no está.
import {
  idDeAusencia, esFecha, errorDeAusencia, normalizarAusencia,
  bloqueosDelDia, chocaConAusencia, faltaTodoElDia, fechasEntre, proximas,
  idDeHorarioEspecial, errorDeHorarioEspecial, normalizarHorarioEspecial,
  esHorarioEspecial, ventanaDelDia, DIA_COMPLETO,
} from '../src/utils/ausencias.js';

let pasaron = 0, fallaron = 0;
const fallas = [];
const chequear = (t, ok, d = '') => {
  if (ok) { pasaron++; console.log('  ok    ', t); }
  else { fallaron++; fallas.push(t); console.log('  FALLA ', t, d ? `\n           ${d}` : ''); }
};

const au = (professionalId, fecha, desde = null, hasta = null) => ({ professionalId, fecha, desde, hasta });
const PEPITO = 'prof-pepito';
const JULIAN = 'prof-julian';
const MIERCOLES = '2026-10-21';
const OTRO_MIERCOLES = '2026-10-28';
const min = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

// ── El id ───────────────────────────────────────────────────────────────────
console.log('\nEl id del documento:');
chequear('día completo', idDeAusencia(PEPITO, MIERCOLES) === 'prof-pepito_2026-10-21_todo',
  idDeAusencia(PEPITO, MIERCOLES));
chequear('franja', idDeAusencia(PEPITO, MIERCOLES, '15:00') === 'prof-pepito_2026-10-21_1500',
  idDeAusencia(PEPITO, MIERCOLES, '15:00'));
chequear('marcar dos veces lo mismo da el MISMO id (no duplica)',
  idDeAusencia(PEPITO, MIERCOLES, '15:00') === idDeAusencia(PEPITO, MIERCOLES, '15:00'));
chequear('dos franjas distintas del mismo día son dos documentos',
  idDeAusencia(PEPITO, MIERCOLES, '15:00') !== idDeAusencia(PEPITO, MIERCOLES, '18:00'));
chequear('el día entero y una franja no se pisan',
  idDeAusencia(PEPITO, MIERCOLES) !== idDeAusencia(PEPITO, MIERCOLES, '15:00'));

// ── Validación ──────────────────────────────────────────────────────────────
console.log('\nQué se acepta y qué no:');
chequear('fecha sola: el día entero', errorDeAusencia({ fecha: MIERCOLES }) === null);
chequear('fecha + franja completa', errorDeAusencia({ fecha: MIERCOLES, desde: '15:00', hasta: '18:00' }) === null);
chequear('sin fecha, no', Boolean(errorDeAusencia({ fecha: '' })));
chequear('fecha con formato raro, no', Boolean(errorDeAusencia({ fecha: '21/10/2026' })));
chequear('MEDIA franja escrita es un error, no "hasta que cierre"',
  Boolean(errorDeAusencia({ fecha: MIERCOLES, desde: '15:00', hasta: null })),
  String(errorDeAusencia({ fecha: MIERCOLES, desde: '15:00', hasta: null })));
chequear('la otra mitad tampoco', Boolean(errorDeAusencia({ fecha: MIERCOLES, desde: null, hasta: '18:00' })));
chequear('fin antes que inicio, no', Boolean(errorDeAusencia({ fecha: MIERCOLES, desde: '18:00', hasta: '15:00' })));
chequear('fin igual al inicio, no (no bloquea nada)',
  Boolean(errorDeAusencia({ fecha: MIERCOLES, desde: '15:00', hasta: '15:00' })));
chequear('hora inventada, no', Boolean(errorDeAusencia({ fecha: MIERCOLES, desde: '25:00', hasta: '26:00' })));
chequear('sin argumentos no revienta', Boolean(errorDeAusencia()));
chequear('esFecha rechaza basura', !esFecha(null) && !esFecha('hoy') && esFecha('2026-01-01'));

console.log('\nNormalizar lo que viene del formulario:');
chequear('los campos vacíos quedan en null, no en cadena vacía',
  normalizarAusencia({ professionalId: PEPITO, fecha: MIERCOLES, desde: '', hasta: '' }).desde === null);
chequear('media franja se descarta entera (queda el día completo)',
  normalizarAusencia({ professionalId: PEPITO, fecha: MIERCOLES, desde: '15:00', hasta: '' }).desde === null);
chequear('una franja válida se conserva',
  normalizarAusencia({ professionalId: PEPITO, fecha: MIERCOLES, desde: '15:00', hasta: '18:00' }).hasta === '18:00');

// ── Los bloqueos del día ────────────────────────────────────────────────────
console.log('\nQué queda bloqueado:');
const SOLO_DIA = [au(PEPITO, MIERCOLES)];
chequear('día completo: todoElDia en true y ningún intervalo',
  bloqueosDelDia(SOLO_DIA, PEPITO, MIERCOLES).todoElDia === true
  && bloqueosDelDia(SOLO_DIA, PEPITO, MIERCOLES).intervalos.length === 0);
chequear('al OTRO barbero no le afecta',
  bloqueosDelDia(SOLO_DIA, JULIAN, MIERCOLES).todoElDia === false);
chequear('el miércoles que viene NO queda bloqueado (ese era el problema)',
  bloqueosDelDia(SOLO_DIA, PEPITO, OTRO_MIERCOLES).todoElDia === false);

const FRANJA = [au(PEPITO, MIERCOLES, '15:00', '18:00')];
chequear('franja: no es todo el día',
  bloqueosDelDia(FRANJA, PEPITO, MIERCOLES).todoElDia === false);
chequear('franja: queda el intervalo en minutos',
  JSON.stringify(bloqueosDelDia(FRANJA, PEPITO, MIERCOLES).intervalos) === JSON.stringify([[900, 1080]]),
  JSON.stringify(bloqueosDelDia(FRANJA, PEPITO, MIERCOLES).intervalos));

const DOS = [au(PEPITO, MIERCOLES, '16:00', '17:00'), au(PEPITO, MIERCOLES, '10:00', '11:00')];
chequear('dos franjas el mismo día salen ordenadas',
  JSON.stringify(bloqueosDelDia(DOS, PEPITO, MIERCOLES).intervalos) === JSON.stringify([[600, 660], [960, 1020]]),
  JSON.stringify(bloqueosDelDia(DOS, PEPITO, MIERCOLES).intervalos));
chequear('si además falta todo el día, gana el día completo',
  bloqueosDelDia([...DOS, au(PEPITO, MIERCOLES)], PEPITO, MIERCOLES).todoElDia === true);

chequear('sin ausencias no bloquea nada', bloqueosDelDia([], PEPITO, MIERCOLES).intervalos.length === 0);
chequear('no revienta con basura adentro',
  bloqueosDelDia([null, {}, au(PEPITO, MIERCOLES, 'x', 'y')], PEPITO, MIERCOLES).todoElDia === true);

// ── El choque, que es lo que deciden el motor y el servidor ─────────────────
console.log('\n¿El turno choca con la ausencia?');
const choca = (aus, ini, fin) => chocaConAusencia(aus, PEPITO, MIERCOLES, min(ini), min(fin));
chequear('día completo: choca cualquier turno', choca(SOLO_DIA, '09:00', '09:30'));
chequear('franja 15-18: un turno 15:00-15:30 choca', choca(FRANJA, '15:00', '15:30'));
chequear('franja 15-18: un turno 17:30-18:30 choca (empieza adentro)', choca(FRANJA, '17:30', '18:30'));
chequear('franja 15-18: un turno 14:00-15:00 NO choca (termina justo al empezar)',
  !choca(FRANJA, '14:00', '15:00'));
chequear('franja 15-18: un turno 18:00-18:30 NO choca (empieza justo al terminar)',
  !choca(FRANJA, '18:00', '18:30'));
chequear('franja 15-18: un turno 14:30-15:30 choca (lo pisa de costado)', choca(FRANJA, '14:30', '15:30'));
chequear('franja 15-18: un turno 09:00-10:00 no choca', !choca(FRANJA, '09:00', '10:00'));
chequear('un turno que ENVUELVE la franja choca', choca(FRANJA, '14:00', '19:00'));
chequear('la ausencia de otro barbero no choca',
  !chocaConAusencia(FRANJA, JULIAN, MIERCOLES, min('15:00'), min('16:00')));
chequear('la de otra fecha tampoco',
  !chocaConAusencia(FRANJA, PEPITO, OTRO_MIERCOLES, min('15:00'), min('16:00')));

console.log('\nFalta todo el día (para pintar el calendario):');
chequear('con el día completo, sí', faltaTodoElDia(SOLO_DIA, PEPITO, MIERCOLES));
chequear('con una franja, NO: ese día igual atiende', !faltaTodoElDia(FRANJA, PEPITO, MIERCOLES));

// ── Las vacaciones ──────────────────────────────────────────────────────────
console.log('\nCargar un rango de una vez:');
chequear('del 21 al 24 son 4 días',
  JSON.stringify(fechasEntre('2026-10-21', '2026-10-24'))
  === JSON.stringify(['2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24']),
  JSON.stringify(fechasEntre('2026-10-21', '2026-10-24')));
chequear('un solo día es un solo día', fechasEntre(MIERCOLES, MIERCOLES).length === 1);
chequear('cruza el fin de mes', JSON.stringify(fechasEntre('2026-10-30', '2026-11-02'))
  === JSON.stringify(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']),
  JSON.stringify(fechasEntre('2026-10-30', '2026-11-02')));
chequear('cruza el año y el 29 de febrero bisiesto',
  fechasEntre('2028-02-28', '2028-03-01').includes('2028-02-29'),
  JSON.stringify(fechasEntre('2028-02-28', '2028-03-01')));
chequear('al revés no devuelve nada', fechasEntre('2026-10-24', '2026-10-21').length === 0);
chequear('un año de más tipeado no escribe miles de documentos',
  fechasEntre('2026-10-21', '2036-10-21').length === 366,
  String(fechasEntre('2026-10-21', '2036-10-21').length));
chequear('con basura, nada', fechasEntre('x', 'y').length === 0);

// ── El listado del panel ────────────────────────────────────────────────────
console.log('\nLo que ve el barbero en su panel:');
const MEZCLA = [
  au(PEPITO, '2026-10-28'),
  au(JULIAN, '2026-10-22'),
  au(PEPITO, '2026-10-21', '16:00', '17:00'),
  au(PEPITO, '2026-10-21', '10:00', '11:00'),
  au(PEPITO, '2026-09-01'),
];
const p = proximas(MEZCLA, PEPITO, '2026-10-13');
chequear('solo las suyas', p.every((x) => x.professionalId === PEPITO));
chequear('no muestra las que ya pasaron', !p.some((x) => x.fecha === '2026-09-01'));
chequear('ordenadas por fecha y hora',
  JSON.stringify(p.map((x) => `${x.fecha} ${x.desde || 'todo'}`))
  === JSON.stringify(['2026-10-21 10:00', '2026-10-21 16:00', '2026-10-28 todo']),
  JSON.stringify(p.map((x) => `${x.fecha} ${x.desde || 'todo'}`)));
chequear('sin argumentos no revienta', proximas(undefined, PEPITO, '2026-10-13').length === 0);

// ============================================================================
// El horario especial de un día suelto (16/10/2026)
// ============================================================================
// "Mañana tengo un barbero que solo por la mañana va a trabajar de 10 a 1 de la
// tarde, el resto de los días normal." Se guarda el rato que SÍ trabaja y
// `bloqueosDelDia` devuelve los ratos de AFUERA, que es lo que el motor ya sabe
// descontar.
//
// Lo que estos casos protegen, en orden de gravedad:
//   1. que el código VIEJO no lea el horario al revés (de ahí los null),
//   2. que una ausencia de día completo le gane al horario especial,
//   3. que un horario que no se entiende bloquee el día en vez de abrirlo.
const he = (professionalId, fecha, trabajaDesde, trabajaHasta) =>
  ({ professionalId, fecha, desde: null, hasta: null, trabajaDesde, trabajaHasta });

console.log('\nEl id del horario especial:');
chequear('lleva su propio sufijo',
  idDeHorarioEspecial(PEPITO, MIERCOLES) === 'prof-pepito_2026-10-21_horario',
  idDeHorarioEspecial(PEPITO, MIERCOLES));
chequear('NO pisa la ausencia de día completo del mismo día',
  idDeHorarioEspecial(PEPITO, MIERCOLES) !== idDeAusencia(PEPITO, MIERCOLES));
chequear('cargarlo dos veces da el mismo id (un horario por día)',
  idDeHorarioEspecial(PEPITO, MIERCOLES) === idDeHorarioEspecial(PEPITO, MIERCOLES));

console.log('\nQué cuenta como horario especial:');
chequear('con las dos horas, sí', esHorarioEspecial(he(PEPITO, MIERCOLES, '10:00', '13:00')));
chequear('una ausencia de día completo, no', !esHorarioEspecial(au(PEPITO, MIERCOLES)));
chequear('una franja de ausencia, no', !esHorarioEspecial(au(PEPITO, MIERCOLES, '15:00', '18:00')));
chequear('a medio escribir SÍ cuenta como horario (y falla cerrado después)',
  esHorarioEspecial({ professionalId: PEPITO, fecha: MIERCOLES, trabajaDesde: '10:00' }));
chequear('basura no revienta', !esHorarioEspecial(null) && !esHorarioEspecial({}));

console.log('\nValidación:');
chequear('sin fecha', errorDeHorarioEspecial({ trabajaDesde: '10:00', trabajaHasta: '13:00' }) !== null);
chequear('bien', errorDeHorarioEspecial({ fecha: MIERCOLES, trabajaDesde: '10:00', trabajaHasta: '13:00' }) === null);
chequear('sin la hora de fin: NO vale (media franja es media olvidada)',
  errorDeHorarioEspecial({ fecha: MIERCOLES, trabajaDesde: '10:00' }) !== null);
chequear('sin la de inicio tampoco',
  errorDeHorarioEspecial({ fecha: MIERCOLES, trabajaHasta: '13:00' }) !== null);
chequear('fin antes que inicio',
  errorDeHorarioEspecial({ fecha: MIERCOLES, trabajaDesde: '13:00', trabajaHasta: '10:00' }) !== null);
chequear('fin IGUAL al inicio (un día de cero minutos no es un horario)',
  errorDeHorarioEspecial({ fecha: MIERCOLES, trabajaDesde: '10:00', trabajaHasta: '10:00' }) !== null);
chequear('hora inventada',
  errorDeHorarioEspecial({ fecha: MIERCOLES, trabajaDesde: '25:00', trabajaHasta: '26:00' }) !== null);

console.log('\nNormalizar:');
const NORM = normalizarHorarioEspecial({ professionalId: PEPITO, fecha: MIERCOLES, trabajaDesde: '10:00', trabajaHasta: '13:00' });
chequear('desde/hasta quedan en NULL — es lo que hace que el código viejo falle cerrado',
  NORM.desde === null && NORM.hasta === null, JSON.stringify(NORM));
chequear('guarda el rato que sí trabaja',
  NORM.trabajaDesde === '10:00' && NORM.trabajaHasta === '13:00');
chequear('una hora inválida deja los DOS campos en null (y entonces bloquea el día)',
  (() => {
    const n = normalizarHorarioEspecial({ professionalId: PEPITO, fecha: MIERCOLES, trabajaDesde: 'xx', trabajaHasta: '13:00' });
    return n.trabajaDesde === null && n.trabajaHasta === null;
  })());

console.log('\nLo que se bloquea (el caso del pedido: trabaja 10 a 13):');
const SOLO_MANANA = [he(PEPITO, MIERCOLES, '10:00', '13:00')];
const bm = bloqueosDelDia(SOLO_MANANA, PEPITO, MIERCOLES);
chequear('el día NO queda bloqueado entero', bm.todoElDia === false);
chequear('se bloquea antes de las 10 y después de las 13',
  JSON.stringify(bm.intervalos) === JSON.stringify([[0, min('10:00')], [min('13:00'), DIA_COMPLETO]]),
  JSON.stringify(bm.intervalos));
chequear('un turno de 10:00 a 10:30 entra',
  !chocaConAusencia(SOLO_MANANA, PEPITO, MIERCOLES, min('10:00'), min('10:30')));
chequear('uno de 09:30 a 10:00 NO entra',
  chocaConAusencia(SOLO_MANANA, PEPITO, MIERCOLES, min('09:30'), min('10:00')));
chequear('uno de 12:30 a 13:00 entra justo',
  !chocaConAusencia(SOLO_MANANA, PEPITO, MIERCOLES, min('12:30'), min('13:00')));
chequear('uno que TERMINA pasadas las 13 no entra: a esa hora se va',
  chocaConAusencia(SOLO_MANANA, PEPITO, MIERCOLES, min('12:45'), min('13:15')));
chequear('uno de la tarde no entra',
  chocaConAusencia(SOLO_MANANA, PEPITO, MIERCOLES, min('17:00'), min('17:30')));
chequear('el calendario NO apaga el día (ese día igual atiende)',
  faltaTodoElDia(SOLO_MANANA, PEPITO, MIERCOLES) === false);
chequear('no toca los demás días',
  bloqueosDelDia(SOLO_MANANA, PEPITO, OTRO_MIERCOLES).intervalos.length === 0);
chequear('no toca al otro barbero',
  bloqueosDelDia(SOLO_MANANA, JULIAN, MIERCOLES).intervalos.length === 0);

console.log('\nCon un horario que arranca a medianoche:');
chequear('desde 00:00 no agrega un intervalo vacío adelante',
  JSON.stringify(bloqueosDelDia([he(PEPITO, MIERCOLES, '00:00', '13:00')], PEPITO, MIERCOLES).intervalos)
  === JSON.stringify([[min('13:00'), DIA_COMPLETO]]));
chequear('y sigue sin bloquear el día entero',
  bloqueosDelDia([he(PEPITO, MIERCOLES, '00:00', '13:00')], PEPITO, MIERCOLES).todoElDia === false);

console.log('\nHorario especial + ausencia el mismo día:');
const MIXTO = [he(PEPITO, MIERCOLES, '10:00', '13:00'), au(PEPITO, MIERCOLES, '11:00', '11:30')];
chequear('el rato de la ausencia se descuenta adentro del horario',
  chocaConAusencia(MIXTO, PEPITO, MIERCOLES, min('11:00'), min('11:30')));
chequear('y lo de alrededor sigue entrando',
  !chocaConAusencia(MIXTO, PEPITO, MIERCOLES, min('10:00'), min('10:30')));
chequear('la ausencia de DÍA COMPLETO le gana al horario especial',
  bloqueosDelDia([he(PEPITO, MIERCOLES, '10:00', '13:00'), au(PEPITO, MIERCOLES)], PEPITO, MIERCOLES).todoElDia === true);
chequear('y el calendario apaga el día',
  faltaTodoElDia([he(PEPITO, MIERCOLES, '10:00', '13:00'), au(PEPITO, MIERCOLES)], PEPITO, MIERCOLES) === true);

console.log('\nFalla CERRADO:');
chequear('horario con una hora ilegible bloquea el día entero',
  bloqueosDelDia([he(PEPITO, MIERCOLES, 'xx', '13:00')], PEPITO, MIERCOLES).todoElDia === true);
chequear('horario a medio escribir también',
  bloqueosDelDia([{ professionalId: PEPITO, fecha: MIERCOLES, trabajaDesde: '10:00' }], PEPITO, MIERCOLES).todoElDia === true);
chequear('horario al revés (13 a 10) también',
  bloqueosDelDia([he(PEPITO, MIERCOLES, '13:00', '10:00')], PEPITO, MIERCOLES).todoElDia === true);
chequear('y entonces ningún turno entra',
  chocaConAusencia([he(PEPITO, MIERCOLES, 'xx', 'yy')], PEPITO, MIERCOLES, min('10:00'), min('10:30')));

console.log('\nLa ventana del día, para el calendario y los avisos:');
chequear('la devuelve',
  JSON.stringify(ventanaDelDia(SOLO_MANANA, PEPITO, MIERCOLES)) === '{"desde":"10:00","hasta":"13:00"}',
  JSON.stringify(ventanaDelDia(SOLO_MANANA, PEPITO, MIERCOLES)));
chequear('sin horario especial, null', ventanaDelDia([au(PEPITO, MIERCOLES)], PEPITO, MIERCOLES) === null);
chequear('otro día, null', ventanaDelDia(SOLO_MANANA, PEPITO, OTRO_MIERCOLES) === null);
chequear('otro barbero, null', ventanaDelDia(SOLO_MANANA, JULIAN, MIERCOLES) === null);
chequear('una ventana ilegible es null (no una ventana inventada)',
  ventanaDelDia([he(PEPITO, MIERCOLES, 'xx', '13:00')], PEPITO, MIERCOLES) === null);
chequear('sin argumentos no revienta', ventanaDelDia(undefined, PEPITO, MIERCOLES) === null);

console.log('\nEn la lista del panel:');
const CON_HORARIO = proximas([he(PEPITO, MIERCOLES, '10:00', '13:00'), au(PEPITO, OTRO_MIERCOLES)], PEPITO, '2026-10-13');
chequear('aparece junto a las ausencias', CON_HORARIO.length === 2);
chequear('ordenado por fecha', CON_HORARIO[0].fecha === MIERCOLES);

console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
if (fallas.length) console.log('Fallaron:\n  - ' + fallas.join('\n  - '));
console.log('');
process.exit(fallaron ? 1 : 0);
