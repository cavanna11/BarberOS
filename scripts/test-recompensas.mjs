// El motor de recompensas, sin emulador.
//
//   node scripts/test-recompensas.mjs
//
// Tres cosas se prueban acá:
//
//   1. Que las configuraciones inválidas NO pasen (probabilidades que suman más
//      de 100, porcentajes imposibles, una ruleta de una sola porción).
//   2. Que la plata esté bien: el descuento de cada tipo de premio, el happy
//      hour, y que un premio nunca deje un precio negativo.
//   3. Que `functions/recompensasMotor.js` y `src/utils/recompensas.js` sean el
//      MISMO código (el segundo se genera del primero) y digan lo mismo.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cuerpoDelMotor } from './espejar-recompensas.mjs';

const require = createRequire(import.meta.url);
const srv = require('../functions/recompensasMotor.js');
const web = await import('../src/utils/recompensas.js');

let pasaron = 0, fallaron = 0;
const fallas = [];
const chequear = (t, ok, d = '') => {
  if (ok) { pasaron++; console.log('  ok    ', t); }
  else { fallaron++; fallas.push(t); console.log('  FALLA ', t, d ? `\n           ${d}` : ''); }
};
const ambos = (t, fn) => {
  const a = fn(srv), b = fn(web);
  chequear(t, JSON.stringify(a) === JSON.stringify(b) && a !== false, `servidor=${JSON.stringify(a)} web=${JSON.stringify(b)}`);
};

// ── 0. Las dos copias son la misma ──────────────────────────────────────────
console.log('\nLas dos copias del motor:');
{
  const raiz = fileURLToPath(new URL('..', import.meta.url));
  const motor = readFileSync(`${raiz}functions/recompensasMotor.js`, 'utf8').replace(/\r\n/g, '\n');
  const espejo = readFileSync(`${raiz}src/utils/recompensas.js`, 'utf8').replace(/\r\n/g, '\n');
  chequear('src/utils/recompensas.js está al día (si falla: node scripts/espejar-recompensas.mjs)',
    espejo.endsWith(cuerpoDelMotor(motor)));
  chequear('exportan las mismas funciones',
    JSON.stringify(Object.keys(srv).sort()) === JSON.stringify(Object.keys(web).sort()));
}

// ── 1. Validación de campañas ───────────────────────────────────────────────
console.log('\nRuleta — configuraciones:');
const premio = (tipo, valor, probabilidad, extra = {}) => ({ tipo, valor, probabilidad, ...extra });
const ejemplo = [
  premio('porcentaje', 5, 40), premio('porcentaje', 10, 25), premio('porcentaje', 15, 15),
  premio('porcentaje', 20, 8), premio('gratis', 0, 2, { nombre: 'Corte gratis' }),
];
{
  const r = srv.validarCampana('ruleta', { premios: ejemplo, frecuenciaDias: 30, diasVencimiento: 30 });
  chequear('el ejemplo del pedido (suma 90) es válido', r.ok, r.errores.join(' | '));
  chequear('los 10 puntos que faltan son "sin premio"', srv.restoSinPremio(r.config.premios) === 1000);
  chequear('se dibujan 6 porciones (5 premios + sin premio)', srv.segmentosDelJuego(r.config).length === 6);
  chequear('las porciones NO llevan la probabilidad', srv.segmentosDelJuego(r.config).every((s) => !('probabilidad' in s)));
  chequear('nombre automático: "10% OFF"', r.config.premios[1].nombre === '10% OFF');
}
for (const [titulo, cfg, debe] of [
  ['suma 101 → inválida', { premios: [premio('porcentaje', 10, 60), premio('porcentaje', 20, 41)] }, false],
  ['suma exactamente 100 con decimales (33.33+33.33+33.34) → válida',
    { premios: [premio('porcentaje', 5, 33.33, { nombre: 'A' }), premio('porcentaje', 10, 33.33, { nombre: 'B' }), premio('porcentaje', 15, 33.34, { nombre: 'C' })] }, true],
  ['0.1 + 0.2 + 99.7 = 100 (sin error de coma flotante) → válida',
    { premios: [premio('porcentaje', 5, 0.1, { nombre: 'A' }), premio('porcentaje', 10, 0.2, { nombre: 'B' }), premio('porcentaje', 15, 99.7, { nombre: 'C' })] }, true],
  ['probabilidad con tres decimales → inválida', { premios: [premio('porcentaje', 10, 10.555), premio('porcentaje', 5, 10)] }, false],
  ['probabilidad 0 → inválida', { premios: [premio('porcentaje', 10, 0), premio('porcentaje', 5, 10)] }, false],
  ['probabilidad negativa → inválida', { premios: [premio('porcentaje', 10, -5), premio('porcentaje', 5, 10)] }, false],
  ['probabilidad en texto ("abc") → inválida', { premios: [premio('porcentaje', 10, 'abc'), premio('porcentaje', 5, 10)] }, false],
  ['porcentaje 150 → inválido', { premios: [premio('porcentaje', 150, 10)] }, false],
  ['porcentaje 12.5 → inválido (entero)', { premios: [premio('porcentaje', 12.5, 10)] }, false],
  ['monto 0 → inválido', { premios: [premio('monto', 0, 10)] }, false],
  ['sin premios → inválida', { premios: [] }, false],
  ['un solo premio al 100% → inválida (siempre sale lo mismo)', { premios: [premio('porcentaje', 10, 100)] }, false],
  ['un solo premio al 50% → válida (la otra mitad es sin premio)', { premios: [premio('porcentaje', 10, 50)] }, true],
  ['dos premios con el mismo nombre → inválida', { premios: [premio('porcentaje', 10, 10, { nombre: 'X' }), premio('porcentaje', 20, 10, { nombre: 'x' })] }, false],
  ['tipo desconocido → inválida', { premios: [premio('regalo', 10, 10)] }, false],
  ['personalizado sin nombre → inválida', { premios: [premio('personalizado', 0, 10)] }, false],
  ['personalizado con nombre → válida', { premios: [premio('personalizado', 0, 10, { nombre: 'Café de regalo' })] }, true],
  ['12 premios en la ruleta → inválida (tope 11 + sin premio)', { premios: Array.from({ length: 12 }, (_, i) => premio('porcentaje', 5, 1, { nombre: `P${i}` })) }, false],
  ['frecuencia 0 días → inválida', { premios: ejemplo, frecuenciaDias: 0 }, false],
  ['vencimiento 400 días → inválida', { premios: ejemplo, diasVencimiento: 400 }, false],
]) {
  const r = srv.validarCampana('ruleta', cfg);
  chequear(titulo, r.ok === debe, r.errores.join(' | '));
}

console.log('\nCaja y rasca comparten la validación del sorteo:');
chequear('caja con un premio al 100% es válida (no es una ruleta)',
  srv.validarCampana('caja', { premios: [premio('porcentaje', 10, 100)] }).ok);
chequear('rasca no lleva frecuencia (una por turno atendido)',
  !('frecuenciaDias' in srv.validarCampana('rasca', { premios: ejemplo }).config));
chequear('caja que suma 120 → inválida',
  !srv.validarCampana('caja', { premios: [premio('porcentaje', 10, 60, { nombre: 'a' }), premio('porcentaje', 5, 60, { nombre: 'b' })] }).ok);

console.log('\nTarjeta de fidelidad:');
for (const [titulo, cfg, debe] of [
  ['10 casillas, corte gratis', { casillas: 10, premio: { tipo: 'gratis', nombre: 'Corte gratis' } }, true],
  ['5, 8, 12 casillas', { casillas: 8, premio: { tipo: 'porcentaje', valor: 50 } }, true],
  ['2 casillas → inválida', { casillas: 2, premio: { tipo: 'gratis' } }, false],
  ['25 casillas → inválida', { casillas: 25, premio: { tipo: 'gratis' } }, false],
  ['sin recompensa → inválida', { casillas: 10 }, false],
]) {
  const r = srv.validarCampana('fidelidad', cfg);
  chequear(titulo, r.ok === debe, r.errores.join(' | '));
}
chequear('reinicio desconocido cae en automático', srv.validarCampana('fidelidad', { casillas: 10, premio: { tipo: 'gratis' }, reinicio: 'x' }).config.reinicio === 'automatico');

console.log('\nHappy hour:');
for (const [titulo, cfg, debe] of [
  ['martes y miércoles 15 a 17, 20%', { dias: [1, 2], desde: '15:00', hasta: '17:00', porcentaje: 20 }, true],
  ['sin días → inválido', { dias: [], desde: '15:00', hasta: '17:00', porcentaje: 20 }, false],
  ['hasta antes que desde → inválido', { dias: [1], desde: '17:00', hasta: '15:00', porcentaje: 20 }, false],
  ['hora mal escrita → inválido', { dias: [1], desde: '25:00', hasta: '26:00', porcentaje: 20 }, false],
  ['95% → inválido (tope 90)', { dias: [1], desde: '15:00', hasta: '17:00', porcentaje: 95 }, false],
  ['día 7 se descarta (0..6) y queda vacío → inválido', { dias: [7], desde: '15:00', hasta: '17:00', porcentaje: 10 }, false],
]) {
  const r = srv.validarCampana('happyHour', cfg);
  chequear(titulo, r.ok === debe, r.errores.join(' | '));
}

console.log('\nRacha y cumpleaños:');
chequear('racha con dos niveles, ordenados al guardar',
  (() => {
    const r = srv.validarCampana('racha', { diasMax: 30, niveles: [{ racha: 5, premio: { tipo: 'gratis' } }, { racha: 3, premio: { tipo: 'porcentaje', valor: 15 } }] });
    return r.ok && r.config.niveles[0].racha === 3;
  })());
chequear('racha con niveles repetidos → inválida',
  !srv.validarCampana('racha', { diasMax: 30, niveles: [{ racha: 3, premio: { tipo: 'gratis' } }, { racha: 3, premio: { tipo: 'gratis' } }] }).ok);
chequear('racha de 1 visita → inválida (no es una racha)',
  !srv.validarCampana('racha', { diasMax: 30, niveles: [{ racha: 1, premio: { tipo: 'gratis' } }] }).ok);
chequear('cumpleaños con 20% → válido', srv.validarCampana('cumpleanos', { premio: { tipo: 'porcentaje', valor: 20 } }).ok);
chequear('cumpleaños sin premio → inválido', !srv.validarCampana('cumpleanos', {}).ok);
chequear('tipo de campaña inexistente → inválido', !srv.validarCampana('loteria', {}).ok);

// ── 2. El sorteo ────────────────────────────────────────────────────────────
console.log('\nSorteo:');
{
  const cfg = srv.validarCampana('ruleta', { premios: ejemplo }).config;
  chequear('r=0 → primer premio', srv.sortear(cfg.premios, 0) === 0);
  chequear('r=0.3999 → primer premio (40%)', srv.sortear(cfg.premios, 0.3999) === 0);
  chequear('r=0.40 → segundo premio', srv.sortear(cfg.premios, 0.40) === 1);
  chequear('r=0.89 → corte gratis (88..90)', srv.sortear(cfg.premios, 0.89) === 4);
  chequear('r=0.90 → sin premio', srv.sortear(cfg.premios, 0.90) === -1);
  chequear('r=0.99999 → sin premio', srv.sortear(cfg.premios, 0.99999) === -1);
  chequear('r=1 (fuera de rango) no revienta', srv.sortear(cfg.premios, 1) === -1);
  chequear('r=-1 (fuera de rango) → primer premio', srv.sortear(cfg.premios, -1) === 0);

  // Barrido completo: cada punto básico es de un solo premio, y la cuenta da
  // EXACTO lo configurado. No es estadística, es aritmética.
  const cuenta = new Map();
  for (let i = 0; i < 10000; i++) {
    const k = srv.sortear(cfg.premios, i / 10000);
    cuenta.set(k, (cuenta.get(k) || 0) + 1);
  }
  chequear('barrido: 40/25/15/8/2/10 % exactos',
    cuenta.get(0) === 4000 && cuenta.get(1) === 2500 && cuenta.get(2) === 1500
    && cuenta.get(3) === 800 && cuenta.get(4) === 200 && cuenta.get(-1) === 1000,
    JSON.stringify([...cuenta]));
}
ambos('servidor y web sortean igual', (m) => [0, 0.1, 0.5, 0.88, 0.9, 0.95].map((r) => m.sortear(m.validarCampana('ruleta', { premios: ejemplo }).config.premios, r)));

// ── 2b. "Si subo el Sin premio, que los demás se acomoden" ─────────────────
// El pedido de un barbero: cargó "0% de descuento" al 40% como "seguí
// participando" y no lo dejaba guardar.
console.log('\nSin premio y reparto automático:');
{
  const r = srv.validarCampana('ruleta', { premios: [premio('porcentaje', 0, 40, { nombre: 'Seguí participando' }), premio('porcentaje', 10, 30)] });
  chequear('un premio de 0% se rechaza con un mensaje que dice qué hacer', !r.ok && r.errores.some((e) => /Sin premio/.test(e)), r.errores.join(' | '));

  const cinco = [premio('porcentaje', 5, 40), premio('porcentaje', 10, 25), premio('porcentaje', 15, 15), premio('porcentaje', 20, 8), premio('gratis', 0, 2)];
  const nuevos = srv.repartirProbabilidades(cinco, 60);
  const suma = nuevos.reduce((t, p) => t + Math.round(p.probabilidad * 100), 0);
  chequear('sin premio en 40%: los premios pasan a sumar EXACTO 60', suma === 6000, JSON.stringify(nuevos.map((p) => p.probabilidad)));
  chequear('…y la configuración queda válida, con 40% sin premio',
    srv.validarCampana('ruleta', { premios: nuevos }).ok && srv.restoSinPremio(nuevos) === 4000);
  chequear('…conservando el peso relativo (el 5% sigue saliendo 5 veces más que el 10%... de 40 a 25)',
    nuevos[0].probabilidad > nuevos[1].probabilidad && nuevos[1].probabilidad > nuevos[2].probabilidad && nuevos[3].probabilidad > nuevos[4].probabilidad);
  chequear('el corte gratis (2%) no desaparece: queda en 1,33%', Math.abs(nuevos[4].probabilidad - 1.33) < 0.011, String(nuevos[4].probabilidad));
  const delBarbero = srv.repartirProbabilidades([premio('porcentaje', 10, 25), premio('porcentaje', 15, 15), premio('porcentaje', 20, 8), premio('gratis', 0, 2)], 60);
  chequear('el caso del barbero (25/15/8/2 a 60) da números redondos: 30 / 18 / 9,6 / 2,4',
    JSON.stringify(delBarbero.map((p) => p.probabilidad)) === JSON.stringify([30, 18, 9.6, 2.4]), JSON.stringify(delBarbero.map((p) => p.probabilidad)));
  chequear('repartir 100 entre 3 da 33,34 + 33,33 + 33,33',
    srv.repartirProbabilidades([premio('porcentaje', 5, 10), premio('porcentaje', 5, 10), premio('porcentaje', 5, 10)], 100)
      .reduce((t, p) => t + Math.round(p.probabilidad * 100), 0) === 10000);
  chequear('todos en 0: se reparte parejo', srv.repartirProbabilidades([premio('porcentaje', 5, 0), premio('porcentaje', 5, 0)], 50).every((p) => p.probabilidad === 25));
  chequear('objetivo 0: nadie queda en 0 (mínimo 0,01%)', srv.repartirProbabilidades([premio('porcentaje', 5, 30), premio('porcentaje', 5, 30)], 0).every((p) => p.probabilidad >= 0.01));
  chequear('solo toca la probabilidad', srv.repartirProbabilidades([premio('porcentaje', 7, 30, { nombre: 'X', color: '#123456' })], 50)[0].nombre === 'X');
  ambos('servidor y web reparten igual', (m) => m.repartirProbabilidades(cinco, 60).map((p) => p.probabilidad));
}

// ── 3. La plata ─────────────────────────────────────────────────────────────
console.log('\nDescuentos de cada premio:');
for (const [titulo, p, precio, esperado] of [
  ['10% de $18.000 = $16.200', { tipo: 'porcentaje', valor: 10 }, 18000, 16200],
  ['15% de $14.500 = $12.325', { tipo: 'porcentaje', valor: 15 }, 14500, 12325],
  ['33% redondea el descuento, no deja centavos', { tipo: 'porcentaje', valor: 33 }, 14500, 14500 - Math.round(14500 * 0.33)],
  ['$3.000 de $18.000 = $15.000', { tipo: 'monto', valor: 3000 }, 18000, 15000],
  ['$30.000 de $18.000 = $0 (nunca negativo)', { tipo: 'monto', valor: 30000 }, 18000, 0],
  ['gratis = $0', { tipo: 'gratis' }, 18000, 0],
  ['personalizado no toca el precio', { tipo: 'personalizado', nombre: 'Café' }, 18000, 18000],
  ['precio en texto se trata como número', { tipo: 'porcentaje', valor: 10 }, '18000', 16200],
  ['precio negativo → 0', { tipo: 'porcentaje', valor: 10 }, -500, 0],
]) {
  const r = srv.calcularPremio(p, { precio, serviceId: 's1' });
  chequear(titulo, r.aplica && r.precioFinal === esperado && r.descuento + r.precioFinal === Math.max(0, Math.round(Number(precio) || 0)),
    JSON.stringify(r));
}
chequear('premio limitado a otro servicio no aplica',
  !srv.calcularPremio({ tipo: 'gratis', serviceIds: ['corte'] }, { precio: 1000, serviceId: 'barba' }).aplica);
chequear('premio limitado a este servicio aplica',
  srv.calcularPremio({ tipo: 'gratis', serviceIds: ['corte'] }, { precio: 1000, serviceId: 'corte' }).precioFinal === 0);
chequear('premio inexistente no aplica', !srv.calcularPremio(null, { precio: 1000 }).aplica);
ambos('servidor y web calculan igual', (m) => [
  m.calcularPremio({ tipo: 'porcentaje', valor: 33 }, { precio: 14500 }),
  m.calcularPremio({ tipo: 'monto', valor: 999999 }, { precio: 14500 }),
  m.calcularPremio({ tipo: 'gratis', serviceIds: ['a'] }, { precio: 14500, serviceId: 'b' }),
]);

console.log('\nVencimiento:');
const p = { estado: 'disponible', venceEn: '2026-11-10', tipo: 'gratis' };
chequear('el día del vencimiento todavía vale', srv.estadoDelPremio(p, '2026-11-10') === 'disponible');
chequear('al día siguiente está vencido aunque el doc diga disponible', srv.estadoDelPremio(p, '2026-11-11') === 'vencido');
chequear('uno usado sigue usado', srv.estadoDelPremio({ ...p, estado: 'usado' }, '2026-12-01') === 'usado');
chequear('turno el día del vencimiento: usable', srv.premioUsableEn(p, { fecha: '2026-11-10', hoy: '2026-11-01' }).usable);
chequear('turno después del vencimiento: NO (si no, todo premio sería eterno)',
  srv.premioUsableEn(p, { fecha: '2026-11-15', hoy: '2026-11-01' }).motivo === 'vence-antes');
chequear('premio reservado en otro turno: no usable', !srv.premioUsableEn({ ...p, estado: 'reservado' }, { fecha: '2026-11-05', hoy: '2026-11-01' }).usable);

console.log('\nHappy hour:');
const hh = { dias: [1, 2], desde: '15:00', hasta: '17:00', porcentaje: 20, serviceIds: [] };
// 2026-10-27 es martes (1 en la convención 0 = Lunes).
chequear('2026-10-27 es martes (1)', srv.diaDeLaSemana('2026-10-27') === 1);
chequear('martes 15:00 entra', srv.enHappyHour(hh, { fecha: '2026-10-27', startTime: '15:00', serviceId: 'x' }));
chequear('martes 16:59 entra', srv.enHappyHour(hh, { fecha: '2026-10-27', startTime: '16:59', serviceId: 'x' }));
chequear('martes 17:00 NO entra (la franja termina ahí)', !srv.enHappyHour(hh, { fecha: '2026-10-27', startTime: '17:00', serviceId: 'x' }));
chequear('martes 14:59 NO entra', !srv.enHappyHour(hh, { fecha: '2026-10-27', startTime: '14:59', serviceId: 'x' }));
chequear('lunes NO entra', !srv.enHappyHour(hh, { fecha: '2026-10-26', startTime: '15:30', serviceId: 'x' }));
chequear('servicio fuera de la lista NO entra', !srv.enHappyHour({ ...hh, serviceIds: ['corte'] }, { fecha: '2026-10-27', startTime: '15:30', serviceId: 'barba' }));
chequear('20% de $10.000 = $8.000', srv.descuentoHappyHour(hh, 10000).precioFinal === 8000);
chequear('sin config no hay happy hour', !srv.enHappyHour(null, { fecha: '2026-10-27', startTime: '15:30' }));

// ── 4. La tarjeta ───────────────────────────────────────────────────────────
console.log('\nTarjeta de fidelidad — avance:');
{
  const cfg = { casillas: 3, reinicio: 'automatico' };
  let e = {};
  let r = srv.avanzarFidelidad(e, cfg); e = r.estado;
  chequear('primer sello: 1 de 3', e.sellos === 1 && !r.completo);
  r = srv.avanzarFidelidad(e, cfg); e = r.estado;
  r = srv.avanzarFidelidad(e, cfg); e = r.estado;
  chequear('tercer sello completa la tarjeta', r.completo && r.cicloCompletado === 1);
  chequear('reinicio automático: tarjeta nueva, ciclo 2, 0 sellos', e.ciclo === 2 && e.sellos === 0 && e.completas === 1);

  const man = { casillas: 2, reinicio: 'manual' };
  let m = srv.avanzarFidelidad({}, man).estado;
  const fin = srv.avanzarFidelidad(m, man);
  chequear('reinicio manual: completa y queda llena', fin.completo && fin.estado.completa && fin.estado.sellos === 2);
  const otra = srv.avanzarFidelidad(fin.estado, man);
  chequear('tarjeta llena esperando reinicio: el turno siguiente NO suma', !otra.sumo && otra.motivo === 'esperando-reinicio');

  // Cambio de casillas a mitad de tarjeta.
  const vieja = { ciclo: 1, sellos: 8, casillas: 10 };
  const nueva = srv.avanzarFidelidad(vieja, { casillas: 8, reinicio: 'automatico' });
  chequear('el dueño bajó de 10 a 8: el que iba 8/10 NO completa, sigue en su tarjeta de 10', !nueva.completo && nueva.estado.sellos === 9 && nueva.estado.casillas === 10);
  const cierra = srv.avanzarFidelidad(nueva.estado, { casillas: 8, reinicio: 'automatico' });
  chequear('…y la siguiente ya es de 8', cierra.completo && cierra.estado.casillas === 8);
  chequear('faltan: 10 casillas, 7 sellos → 3', srv.faltanParaPremio({ sellos: 7, casillas: 10 }) === 3);
}

// ── 5. La racha ─────────────────────────────────────────────────────────────
console.log('\nRacha:');
{
  const cfg = { diasMax: 30, niveles: [{ racha: 3, premio: { tipo: 'porcentaje', valor: 15 } }] };
  let r = srv.avanzarRacha({}, '2026-01-01', cfg);
  chequear('primera visita: racha 1', r.estado.actual === 1 && !r.nivel);
  r = srv.avanzarRacha(r.estado, '2026-01-25', cfg);
  chequear('a los 24 días: racha 2', r.estado.actual === 2);
  r = srv.avanzarRacha(r.estado, '2026-02-24', cfg);
  chequear('a los 30 días justos: racha 3 y nivel ganado', r.estado.actual === 3 && r.nivel?.racha === 3);
  const corta = srv.avanzarRacha(r.estado, '2026-03-27', cfg);
  chequear('a los 31 días se corta y vuelve a 1', corta.estado.actual === 1 && corta.estado.mejor === 3 && corta.estado.inicio === '2026-03-27');
  const repetida = srv.avanzarRacha(r.estado, '2026-02-24', cfg);
  chequear('la misma fecha otra vez no suma', !repetida.cambio && repetida.estado.actual === 3);
  const vieja = srv.avanzarRacha(r.estado, '2026-01-10', cfg);
  chequear('una visita anterior a la última no suma', !vieja.cambio);
  chequear('vence a los 30 días de la última', srv.rachaVenceEn(r.estado, cfg) === '2026-03-26');
}

// ── 6. Cumpleaños ───────────────────────────────────────────────────────────
console.log('\nCumpleaños:');
chequear('29-02 es válido', srv.mesDiaValido('02-29'));
chequear('31-04 no existe', !srv.mesDiaValido('04-31'));
chequear('13-01 no existe', !srv.mesDiaValido('13-01'));
{
  const v = { diasAntes: 7, diasDespues: 15 };
  chequear('el mismo día está en ventana', srv.ventanaDeCumple('10-29', '2026-10-29', v).enVentana);
  chequear('7 días antes entra', srv.ventanaDeCumple('11-05', '2026-10-29', v).enVentana);
  chequear('8 días antes no entra', !srv.ventanaDeCumple('11-06', '2026-10-29', v).enVentana);
  chequear('15 días después entra y vence ese día',
    srv.ventanaDeCumple('10-14', '2026-10-29', v).venceEn === '2026-10-29');
  const enero = srv.ventanaDeCumple('01-02', '2025-12-28', v);
  chequear('cumple el 2/1, el 28/12 ya está en ventana del año que viene', enero.enVentana && enero.anio === 2026);
  const dic = srv.ventanaDeCumple('12-30', '2027-01-05', v);
  chequear('cumple el 30/12, el 5/1 sigue en la ventana del año anterior', dic.enVentana && dic.anio === 2026);
  chequear('29/02 en año común se festeja el 28/02', srv.ventanaDeCumple('02-29', '2027-02-28', { diasAntes: 0, diasDespues: 0 }).enVentana);
}

// ── 7. Frecuencia de juego ─────────────────────────────────────────────────
console.log('\nFrecuencia:');
chequear('nunca jugó: puede', srv.puedeJugar(null, '2026-10-29', 30));
chequear('jugó hace 29 días con frecuencia 30: no puede', !srv.puedeJugar('2026-09-30', '2026-10-29', 30));
chequear('jugó hace 30 días: puede', srv.puedeJugar('2026-09-29', '2026-10-29', 30));
chequear('frecuencia diaria: mañana sí', srv.puedeJugar('2026-10-28', '2026-10-29', 1));
chequear('frecuencia diaria: hoy otra vez no', !srv.puedeJugar('2026-10-29', '2026-10-29', 1));
chequear('próxima jugada', srv.proximaJugada('2026-10-01', 30) === '2026-10-31');

console.log(`\n${pasaron} pasaron, ${fallaron} fallaron.`);
if (fallaron) {
  console.log('\nFallaron:\n  - ' + fallas.join('\n  - '));
  process.exit(1);
}
