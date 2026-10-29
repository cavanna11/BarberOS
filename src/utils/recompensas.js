// ============================================================================
// Recompensas — el motor del lado del cliente
// ============================================================================
// GENERADO por `scripts/espejar-recompensas.mjs` desde
// `functions/recompensasMotor.js`. No editar a mano: editá el motor y corré
// el script. Está duplicado por la misma razón que `utils/cupon.js` ↔
// `functions/cupones.js`: las Cloud Functions no pueden importar del bundle
// de Vite. `scripts/test-recompensas.mjs` falla si las dos copias difieren.
//
// Lo que se calcula acá es una VISTA PREVIA (el desglose antes de confirmar, la
// validación en vivo del panel). Lo que vale es lo que calcula el servidor.

const TIPOS_CAMPANA = ['ruleta', 'fidelidad', 'caja', 'rasca', 'happyHour', 'racha', 'cumpleanos'];

// Los que se juegan con un sorteo. Comparten la forma de la configuración y el
// mismo `sortear`: la caja y la rasca son la ruleta con otra animación.
const JUEGOS_DE_SORTEO = ['ruleta', 'caja', 'rasca'];

const TIPOS_PREMIO = ['porcentaje', 'monto', 'gratis', 'personalizado'];

const NOMBRES_CAMPANA = {
  ruleta: 'Ruleta',
  fidelidad: 'Tarjeta de fidelidad',
  caja: 'Caja sorpresa',
  rasca: 'Rasca y ganá',
  happyHour: 'Happy hour',
  racha: 'Racha',
  cumpleanos: 'Cumpleaños',
};

// La paleta por defecto de los premios. Sin violeta ni azul (la identidad de
// la marca lo pide), y con suficiente diferencia de luminosidad entre vecinos
// para que una porción de la ruleta no se confunda con la de al lado.
const COLORES = ['#e03d00', '#1f1f1f', '#f2b705', '#2e7d32', '#ff5c1a', '#6d4c41', '#c62828', '#00897b'];

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MES_DIA = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;

// Las probabilidades se suman en PUNTOS BÁSICOS (centésimos de punto), no en
// decimales: 0.1 + 0.2 no da 0.3 en JavaScript, y "la suma da 100,00000001"
// es exactamente el tipo de error que deja una configuración válida afuera o
// una inválida adentro.
const TOTAL_PB = 10000;
const aPB = (p) => Math.round(Number(p) * 100);

// ── Fechas ('YYYY-MM-DD', como appointmentDate) ─────────────────────────────
// Siempre al mediodía UTC: así ningún cambio de huso corre el día.

function diaUTC(fecha) {
  return new Date(`${fecha}T12:00:00Z`);
}

function sumarDias(fecha, n) {
  const d = diaUTC(fecha);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function diasEntre(desde, hasta) {
  return Math.round((diaUTC(hasta) - diaUTC(desde)) / 86400000);
}

/** 0 = Lunes … 6 = Domingo, la convención de los horarios de la app. */
function diaDeLaSemana(fecha) {
  return (diaUTC(fecha).getUTCDay() + 6) % 7;
}

function minutos(hora) {
  const [h, m] = String(hora).split(':').map(Number);
  return h * 60 + m;
}

// ── El premio ───────────────────────────────────────────────────────────────

/**
 * Normaliza la definición de un premio y dice qué tiene mal.
 *
 * `conProbabilidad`: los premios de un sorteo la llevan; el de la tarjeta, la
 * racha o el cumpleaños no (se ganan seguro).
 *
 * Devuelve `{ premio, errores }`. `premio` sale siempre armado (con defaults)
 * para que el panel pueda mostrar la vista previa aunque haya errores; lo que
 * se guarda es solo lo que vino sin errores.
 */
function normalizarPremio(p, { conProbabilidad = false, indice = 0 } = {}) {
  const errores = [];
  const d = p && typeof p === 'object' ? p : {};
  const tipo = TIPOS_PREMIO.includes(d.tipo) ? d.tipo : null;
  if (!tipo) errores.push('Elegí qué tipo de premio es.');

  const nombre = String(d.nombre ?? '').trim().slice(0, 40);

  let valor = 0;
  if (tipo === 'porcentaje') {
    valor = Number(d.valor);
    if (!Number.isFinite(valor) || valor < 1 || valor > 100 || !Number.isInteger(valor)) {
      errores.push('El porcentaje tiene que ser un número entero entre 1 y 100.');
      valor = Math.min(100, Math.max(0, Math.round(Number(d.valor) || 0)));
    }
  } else if (tipo === 'monto') {
    valor = Number(d.valor);
    if (!Number.isFinite(valor) || valor < 1 || valor > 10000000) {
      errores.push('El descuento en pesos tiene que ser mayor a cero.');
      valor = Math.max(0, Math.round(Number(d.valor) || 0));
    }
    valor = Math.round(valor);
  }

  if (tipo === 'personalizado' && !nombre) {
    errores.push('Un premio personalizado necesita un nombre (por ejemplo, "Bebida de regalo").');
  }

  const serviceIds = Array.isArray(d.serviceIds)
    ? [...new Set(d.serviceIds.map(String).filter(Boolean))].slice(0, 50)
    : [];

  const color = COLOR.test(String(d.color || '')) ? String(d.color).toLowerCase() : COLORES[indice % COLORES.length];
  // Un emoji puede ocupar hasta 8 unidades (los que llevan modificadores). Más
  // que eso ya no es un ícono, es texto.
  const icono = String(d.icono || '').trim().slice(0, 8) || '🎁';

  const premio = { tipo: tipo || 'porcentaje', valor, nombre, serviceIds, color, icono };

  if (conProbabilidad) {
    const prob = Number(d.probabilidad);
    if (!Number.isFinite(prob) || prob <= 0 || prob > 100) {
      errores.push('Cada premio necesita una probabilidad mayor a 0 y hasta 100.');
    } else if (Math.abs(aPB(prob) - prob * 100) > 1e-6) {
      errores.push('La probabilidad admite hasta dos decimales.');
    }
    premio.probabilidad = Number.isFinite(prob) ? Math.max(0, Math.min(100, aPB(prob) / 100)) : 0;
  }

  if (!premio.nombre) premio.nombre = nombrePorDefecto(premio);
  return { premio, errores };
}

function nombrePorDefecto(p) {
  if (p.tipo === 'porcentaje') return `${p.valor}% OFF`;
  if (p.tipo === 'monto') return `$${Number(p.valor || 0).toLocaleString('es-AR')} OFF`;
  if (p.tipo === 'gratis') return 'Servicio gratis';
  return 'Premio';
}

/** '10% OFF', '$3.000 OFF', 'Gratis' o el nombre del personalizado. */
function describirPremio(p) {
  if (!p) return '';
  if (p.tipo === 'porcentaje') return `${Number(p.valor) || 0}% OFF`;
  if (p.tipo === 'monto') return `$${(Number(p.valor) || 0).toLocaleString('es-AR')} OFF`;
  if (p.tipo === 'gratis') return 'Gratis';
  return p.nombre || 'Premio';
}

/**
 * Cuánto descuenta este premio sobre el precio de ESTE servicio.
 *
 * Mismo criterio que el cupón: sobre el servicio, nunca sobre los adicionales,
 * productos o el turno del acompañante; entero, nunca negativo, nunca mayor al
 * precio. El personalizado ("bebida de regalo") se aplica con descuento 0: el
 * turno lo lleva para que el barbero lo vea en la agenda y lo entregue.
 *
 * `serviceIds` vacío = sirve para cualquier servicio.
 */
function calcularPremio(p, { precio = 0, serviceId = null } = {}) {
  const base = Math.max(0, Math.round(Number(precio) || 0));
  if (!p || !TIPOS_PREMIO.includes(p.tipo)) {
    return { aplica: false, motivo: 'no-existe', descuento: 0, precioFinal: base };
  }
  const servicios = Array.isArray(p.serviceIds) ? p.serviceIds : [];
  if (servicios.length > 0 && !servicios.includes(serviceId)) {
    return { aplica: false, motivo: 'servicio', descuento: 0, precioFinal: base };
  }

  let descuento = 0;
  if (p.tipo === 'porcentaje') {
    const pct = Math.min(100, Math.max(0, Number(p.valor) || 0));
    descuento = Math.round((base * pct) / 100);
  } else if (p.tipo === 'monto') {
    descuento = Math.max(0, Math.round(Number(p.valor) || 0));
  } else if (p.tipo === 'gratis') {
    descuento = base;
  }
  descuento = Math.min(descuento, base);
  return { aplica: true, motivo: null, descuento, precioFinal: base - descuento };
}

/**
 * El estado que el premio TIENE hoy, aunque el documento diga otra cosa.
 *
 * Un premio `disponible` cuyo vencimiento ya pasó está vencido aunque nadie lo
 * haya escrito todavía: el vencimiento no espera a que corra un proceso. El
 * servidor lo escribe cuando lo ve (al abrir "Tus premios"), pero la decisión
 * sale siempre de acá.
 */
function estadoDelPremio(p, hoy) {
  if (!p) return 'no-existe';
  if (p.estado === 'disponible' && p.venceEn && hoy && p.venceEn < hoy) return 'vencido';
  return p.estado || 'disponible';
}

/**
 * ¿Se puede usar este premio en un turno de esta fecha?
 *
 * El turno tiene que caer DENTRO de la vigencia: un premio que vence el 10 no
 * paga un turno del 15, aunque se reserve el 9. Si no, todo premio sería
 * eterno reservando lejos.
 */
function premioUsableEn(p, { fecha, hoy }) {
  const estado = estadoDelPremio(p, hoy);
  if (estado !== 'disponible') return { usable: false, motivo: estado };
  if (p.venceEn && fecha && fecha > p.venceEn) return { usable: false, motivo: 'vence-antes' };
  return { usable: true, motivo: null };
}

// ── Sorteo ──────────────────────────────────────────────────────────────────

/**
 * Qué premio toca. `r` es un número en [0, 1); lo pone quien llama (el servidor
 * con `crypto`, las pruebas con valores fijos).
 *
 * Devuelve el índice del premio, o -1 si salió "sin premio" (la parte que
 * falta para llegar a 100). Nunca hay "casi gana": cada punto básico es de un
 * solo premio.
 */
function sortear(premios, r) {
  const lista = Array.isArray(premios) ? premios : [];
  const ticket = Math.min(TOTAL_PB - 1, Math.max(0, Math.floor(Number(r) * TOTAL_PB)));
  let acumulado = 0;
  for (let i = 0; i < lista.length; i++) {
    acumulado += aPB(lista[i].probabilidad);
    if (ticket < acumulado) return i;
  }
  return -1;
}

/** Puntos básicos que quedan para "sin premio". */
function restoSinPremio(premios) {
  const suma = (premios || []).reduce((t, p) => t + aPB(p.probabilidad), 0);
  return TOTAL_PB - suma;
}

/**
 * Las porciones que se dibujan (ruleta) o se muestran (caja, rasca), en el
 * MISMO orden que usa `sortear`: el índice que devuelve el servidor es el de
 * acá. "Sin premio" va al final, si existe.
 *
 * Sin la probabilidad: el cliente ve los premios, no las chances. No es un
 * secreto de seguridad —el sorteo es del servidor igual—, es que una ruleta con
 * "2%" escrito al lado del corte gratis deja de ser una sorpresa.
 */
function segmentosDelJuego(config) {
  const premios = Array.isArray(config?.premios) ? config.premios : [];
  const segmentos = premios.map((p) => ({
    nombre: p.nombre, tipo: p.tipo, valor: p.valor, color: p.color, icono: p.icono,
  }));
  if (restoSinPremio(premios) > 0) {
    segmentos.push({
      nombre: config?.textoSinPremio || 'Seguí participando',
      tipo: 'nada', valor: 0, color: '#9e9e9e', icono: '🙂',
    });
  }
  return segmentos;
}

// ── Configuración de cada campaña ──────────────────────────────────────────

function entero(v, min, max, porDefecto) {
  const n = Number(v);
  if (!Number.isFinite(n)) return { valor: porDefecto, ok: v === undefined || v === null || v === '' };
  const r = Math.round(n);
  return { valor: Math.min(max, Math.max(min, r)), ok: r === n && n >= min && n <= max };
}

function validarJuego(tipo, c, errores) {
  const premiosIn = Array.isArray(c.premios) ? c.premios : [];
  const max = tipo === 'ruleta' ? 11 : 12;
  if (premiosIn.length === 0) errores.push('Cargá al menos un premio.');
  if (premiosIn.length > max) errores.push(`Hasta ${max} premios.`);

  const premios = premiosIn.slice(0, max).map((p, i) => {
    const r = normalizarPremio(p, { conProbabilidad: true, indice: i });
    r.errores.forEach((e) => errores.push(`Premio ${i + 1}: ${e}`));
    return r.premio;
  });

  const suma = premios.reduce((t, p) => t + aPB(p.probabilidad), 0);
  if (suma > TOTAL_PB) {
    errores.push(`Las probabilidades suman ${(suma / 100).toLocaleString('es-AR')}%: no pueden pasar de 100.`);
  }

  // Una ruleta con una sola porción no es una ruleta: siempre sale lo mismo.
  const porciones = premios.length + (TOTAL_PB - suma > 0 ? 1 : 0);
  if (tipo === 'ruleta' && premiosIn.length > 0 && porciones < 2) {
    errores.push('La ruleta necesita al menos dos porciones: agregá otro premio o dejá una parte sin premio.');
  }

  // Dos premios con el mismo nombre en el mismo sorteo: el cliente no sabe
  // cuál le tocó, y el dueño tampoco cuando lo ve en la agenda.
  const nombres = premios.map((p) => p.nombre.toLowerCase());
  if (new Set(nombres).size !== nombres.length) errores.push('Hay dos premios con el mismo nombre.');

  const config = {
    premios,
    textoSinPremio: String(c.textoSinPremio || '').trim().slice(0, 40) || 'Seguí participando',
    diasVencimiento: entero(c.diasVencimiento, 1, 365, 30).valor,
  };
  if (!entero(c.diasVencimiento, 1, 365, 30).ok) errores.push('El vencimiento va de 1 a 365 días.');

  // La rasca no tiene frecuencia: se gana UNA por turno atendido.
  if (tipo !== 'rasca') {
    const f = entero(c.frecuenciaDias, 1, 365, tipo === 'ruleta' ? 30 : 7);
    if (!f.ok) errores.push('Cada cuántos días se puede jugar: de 1 a 365.');
    config.frecuenciaDias = f.valor;
  }
  return config;
}

/**
 * Valida y normaliza la configuración de una campaña.
 *
 * Devuelve `{ ok, errores, config }`. El servidor guarda SOLO con `ok`; el
 * panel usa los errores para explicarlos al lado de cada campo. No se copia
 * nada de una campaña a otra: cada tipo arma su propia configuración desde lo
 * que recibe.
 */
function validarCampana(tipo, entrada) {
  const errores = [];
  const c = entrada && typeof entrada === 'object' ? entrada : {};
  let config = {};

  if (!TIPOS_CAMPANA.includes(tipo)) {
    return { ok: false, errores: ['Ese tipo de campaña no existe.'], config: {} };
  }

  if (JUEGOS_DE_SORTEO.includes(tipo)) {
    config = validarJuego(tipo, c, errores);
  } else if (tipo === 'fidelidad') {
    const cas = entero(c.casillas, 3, 20, 10);
    if (!cas.ok) errores.push('La tarjeta tiene entre 3 y 20 casillas.');
    const r = normalizarPremio(c.premio);
    r.errores.forEach((e) => errores.push(`Recompensa: ${e}`));
    const venc = entero(c.diasVencimiento, 1, 365, 60);
    if (!venc.ok) errores.push('El vencimiento va de 1 a 365 días.');
    config = {
      casillas: cas.valor,
      premio: r.premio,
      reinicio: c.reinicio === 'manual' ? 'manual' : 'automatico',
      color: COLOR.test(String(c.color || '')) ? String(c.color).toLowerCase() : '#e03d00',
      diseno: ['clasico', 'sellos', 'minimal'].includes(c.diseno) ? c.diseno : 'clasico',
      diasVencimiento: venc.valor,
    };
  } else if (tipo === 'happyHour') {
    const dias = Array.isArray(c.dias)
      ? [...new Set(c.dias.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
      : [];
    if (dias.length === 0) errores.push('Elegí al menos un día.');
    const desde = String(c.desde || '');
    const hasta = String(c.hasta || '');
    if (!HORA.test(desde) || !HORA.test(hasta)) errores.push('Las horas van como 16:00.');
    else if (minutos(desde) >= minutos(hasta)) errores.push('La hora de inicio tiene que ser anterior a la de fin.');
    const pct = entero(c.porcentaje, 1, 90, 10);
    if (!pct.ok) errores.push('El descuento del happy hour va de 1% a 90%.');
    config = {
      dias, desde, hasta, porcentaje: pct.valor,
      serviceIds: Array.isArray(c.serviceIds) ? [...new Set(c.serviceIds.map(String).filter(Boolean))].slice(0, 50) : [],
    };
  } else if (tipo === 'racha') {
    const dm = entero(c.diasMax, 7, 120, 30);
    if (!dm.ok) errores.push('El plazo para volver va de 7 a 120 días.');
    const nivelesIn = Array.isArray(c.niveles) ? c.niveles : [];
    if (nivelesIn.length === 0) errores.push('Cargá al menos un nivel de racha con su premio.');
    if (nivelesIn.length > 6) errores.push('Hasta 6 niveles.');
    const niveles = nivelesIn.slice(0, 6).map((n, i) => {
      const r = entero(n?.racha, 2, 50, 0);
      if (!r.ok || !r.valor) errores.push(`Nivel ${i + 1}: la racha va de 2 a 50 visitas.`);
      const p = normalizarPremio(n?.premio, { indice: i });
      p.errores.forEach((e) => errores.push(`Nivel ${i + 1}: ${e}`));
      return { racha: r.valor, premio: p.premio };
    }).sort((a, b) => a.racha - b.racha);
    const rachas = niveles.map((n) => n.racha);
    if (new Set(rachas).size !== rachas.length) errores.push('Dos niveles no pueden pedir la misma cantidad de visitas.');
    const venc = entero(c.diasVencimiento, 1, 365, 60);
    if (!venc.ok) errores.push('El vencimiento va de 1 a 365 días.');
    config = { diasMax: dm.valor, niveles, diasVencimiento: venc.valor };
  } else if (tipo === 'cumpleanos') {
    const p = normalizarPremio(c.premio);
    p.errores.forEach((e) => errores.push(`Regalo: ${e}`));
    const antes = entero(c.diasAntes, 0, 30, 7);
    const despues = entero(c.diasDespues, 0, 60, 15);
    if (!antes.ok || !despues.ok) errores.push('La ventana del cumpleaños va de 0 a 30 días antes y de 0 a 60 después.');
    config = { premio: p.premio, diasAntes: antes.valor, diasDespues: despues.valor };
  }

  return { ok: errores.length === 0, errores, config };
}

/**
 * Lo que puede ver cualquiera de una campaña activa: va al espejo público del
 * documento del negocio, que se lee sin sesión.
 *
 * Sin probabilidades (ver `segmentosDelJuego`). El resto no es secreto: la
 * recompensa de la tarjeta o los niveles de la racha son justamente lo que el
 * cliente tiene que ver para querer volver.
 */
function vistaPublica(tipo, config) {
  if (JUEGOS_DE_SORTEO.includes(tipo)) {
    return {
      segmentos: segmentosDelJuego(config),
      ...(config.frecuenciaDias ? { frecuenciaDias: config.frecuenciaDias } : {}),
    };
  }
  if (tipo === 'fidelidad') {
    const { casillas, premio, reinicio, color, diseno, diasVencimiento } = config;
    return { casillas, premio, reinicio, color, diseno, diasVencimiento };
  }
  return { ...config };
}

// ── Happy hour ──────────────────────────────────────────────────────────────

/**
 * ¿Este turno cae en el happy hour? Alcanza con que EMPIECE dentro de la
 * franja, igual que la promo por horario del servicio y el horario del local.
 */
function enHappyHour(cfg, { fecha, startTime, serviceId }) {
  if (!cfg || !FECHA.test(String(fecha || '')) || !HORA.test(String(startTime || ''))) return false;
  if (!Array.isArray(cfg.dias) || !cfg.dias.includes(diaDeLaSemana(fecha))) return false;
  if (!HORA.test(String(cfg.desde)) || !HORA.test(String(cfg.hasta))) return false;
  const ini = minutos(startTime);
  if (ini < minutos(cfg.desde) || ini >= minutos(cfg.hasta)) return false;
  const servicios = Array.isArray(cfg.serviceIds) ? cfg.serviceIds : [];
  if (servicios.length > 0 && !servicios.includes(serviceId)) return false;
  return true;
}

function descuentoHappyHour(cfg, precio) {
  return calcularPremio({ tipo: 'porcentaje', valor: Number(cfg?.porcentaje) || 0 }, { precio });
}

// ── Tarjeta de fidelidad ────────────────────────────────────────────────────

/**
 * Suma un sello a la tarjeta. Devuelve el estado nuevo y si se completó.
 *
 * Las casillas de una tarjeta se CONGELAN al empezarla: si el dueño pasa de 10
 * a 8 casillas, el que iba 9 de 10 no se encuentra de golpe con una tarjeta
 * "pasada"; termina la suya y la siguiente ya es de 8. Al revés tampoco pierde:
 * el que iba 7 de 8 no pasa a 7 de 10.
 *
 * Con reinicio manual, la tarjeta llena queda llena hasta que el dueño la
 * reinicia, y los turnos de en el medio NO suman (`esperando-reinicio`): sumar
 * a una tarjeta llena es regalar una segunda sin que nadie lo decida.
 */
function avanzarFidelidad(estado, config) {
  const actual = {
    ciclo: Number(estado?.ciclo) || 1,
    sellos: Number(estado?.sellos) || 0,
    casillas: Number(estado?.casillas) || Number(config.casillas),
    completas: Number(estado?.completas) || 0,
    completa: estado?.completa === true,
  };
  if (actual.completa) return { estado: actual, sumo: false, completo: false, motivo: 'esperando-reinicio' };

  const sellos = actual.sellos + 1;
  if (sellos < actual.casillas) {
    return { estado: { ...actual, sellos }, sumo: true, completo: false, motivo: null };
  }

  const cicloCompletado = actual.ciclo;
  if (config.reinicio === 'manual') {
    return {
      estado: { ...actual, sellos: actual.casillas, completa: true, completas: actual.completas + 1 },
      sumo: true, completo: true, cicloCompletado, motivo: null,
    };
  }
  return {
    estado: {
      ciclo: actual.ciclo + 1, sellos: 0, casillas: Number(config.casillas),
      completas: actual.completas + 1, completa: false,
    },
    sumo: true, completo: true, cicloCompletado, motivo: null,
  };
}

/** "Te faltan 3 cortes para tu corte gratis." */
function faltanParaPremio(estado, config) {
  const casillas = Number(estado?.casillas) || Number(config?.casillas) || 0;
  const sellos = Number(estado?.sellos) || 0;
  return Math.max(0, casillas - sellos);
}

// ── Racha ───────────────────────────────────────────────────────────────────

/**
 * Suma una visita a la racha. Volver dentro de `diasMax` desde la última visita
 * la mantiene; tardar más la corta y arranca de nuevo en 1.
 *
 * Una visita del mismo día o anterior a la última (el barbero marca "vino" un
 * turno viejo después de uno nuevo) no cambia nada: la racha es de visitas en
 * orden, no de clics en el panel.
 *
 * Devuelve el nivel alcanzado si la racha llegó EXACTO a uno: así cada nivel se
 * gana una vez por racha, y una racha nueva (después de cortarse) los vuelve a
 * ofrecer.
 */
function avanzarRacha(estado, fecha, config) {
  const prev = {
    actual: Number(estado?.actual) || 0,
    mejor: Number(estado?.mejor) || 0,
    ultimaFecha: estado?.ultimaFecha || null,
    inicio: estado?.inicio || null,
  };
  if (!FECHA.test(String(fecha || ''))) return { estado: prev, cambio: false, nivel: null };
  if (prev.ultimaFecha && fecha <= prev.ultimaFecha) return { estado: prev, cambio: false, nivel: null };

  const sigue = prev.ultimaFecha && diasEntre(prev.ultimaFecha, fecha) <= Number(config.diasMax);
  const actual = sigue ? prev.actual + 1 : 1;
  const inicio = sigue ? (prev.inicio || prev.ultimaFecha) : fecha;
  const nuevo = { actual, mejor: Math.max(prev.mejor, actual), ultimaFecha: fecha, inicio };
  const nivel = (config.niveles || []).find((n) => n.racha === actual) || null;
  return { estado: nuevo, cambio: true, nivel };
}

/** Hasta cuándo tiene para volver sin cortar la racha. */
function rachaVenceEn(estado, config) {
  if (!estado?.ultimaFecha || !(Number(estado.actual) > 0)) return null;
  return sumarDias(estado.ultimaFecha, Number(config?.diasMax) || 30);
}

// ── Cumpleaños ──────────────────────────────────────────────────────────────

function mesDiaValido(md) {
  if (!MES_DIA.test(String(md || ''))) return false;
  const [m, d] = md.split('-').map(Number);
  // 2024 es bisiesto: el 29 de febrero es un cumpleaños válido.
  const ultimo = new Date(Date.UTC(2024, m, 0)).getUTCDate();
  return d <= ultimo;
}

/** La fecha del cumpleaños en ese año. El 29/02 en un año común cae el 28/02. */
function cumpleEnAnio(md, anio) {
  const [m, d] = md.split('-').map(Number);
  const ultimo = new Date(Date.UTC(anio, m, 0)).getUTCDate();
  return `${anio}-${String(m).padStart(2, '0')}-${String(Math.min(d, ultimo)).padStart(2, '0')}`;
}

/**
 * ¿Hoy está dentro de la ventana del regalo de cumpleaños? Mira el año pasado,
 * este y el que viene, para que un cumpleaños del 2 de enero con 7 días de
 * anticipación se festeje desde el 26 de diciembre.
 *
 * Devuelve `{ enVentana, anio, fecha, venceEn }`. `anio` es el del CUMPLEAÑOS,
 * que es lo que hace al regalo único por año.
 */
function ventanaDeCumple(md, hoy, { diasAntes = 7, diasDespues = 15 } = {}) {
  if (!mesDiaValido(md) || !FECHA.test(String(hoy || ''))) return { enVentana: false };
  const anioHoy = Number(hoy.slice(0, 4));
  for (const anio of [anioHoy - 1, anioHoy, anioHoy + 1]) {
    const fecha = cumpleEnAnio(md, anio);
    const desde = sumarDias(fecha, -diasAntes);
    const hasta = sumarDias(fecha, diasDespues);
    if (hoy >= desde && hoy <= hasta) return { enVentana: true, anio, fecha, venceEn: hasta };
  }
  return { enVentana: false };
}

// ── Frecuencia de juego ────────────────────────────────────────────────────

/** ¿Puede jugar hoy, si jugó por última vez en `ultima`? */
function puedeJugar(ultima, hoy, frecuenciaDias) {
  if (!ultima) return true;
  return diasEntre(ultima, hoy) >= Math.max(1, Number(frecuenciaDias) || 1);
}

function proximaJugada(ultima, frecuenciaDias) {
  if (!ultima) return null;
  return sumarDias(ultima, Math.max(1, Number(frecuenciaDias) || 1));
}

export {
  TIPOS_CAMPANA,
  JUEGOS_DE_SORTEO,
  TIPOS_PREMIO,
  NOMBRES_CAMPANA,
  COLORES,
  normalizarPremio,
  describirPremio,
  calcularPremio,
  estadoDelPremio,
  premioUsableEn,
  sortear,
  restoSinPremio,
  segmentosDelJuego,
  validarCampana,
  vistaPublica,
  enHappyHour,
  descuentoHappyHour,
  avanzarFidelidad,
  faltanParaPremio,
  avanzarRacha,
  rachaVenceEn,
  mesDiaValido,
  ventanaDeCumple,
  puedeJugar,
  proximaJugada,
  sumarDias,
  diasEntre,
  diaDeLaSemana,
};
