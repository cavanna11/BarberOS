// ============================================================================
// Cupones de descuento — la lógica, sin Firestore
// ============================================================================
// Acá no se lee ni se escribe nada: entran el cupón, el servicio y el contexto,
// y sale si aplica y cuánto descuenta. Separado a propósito, por dos razones:
//
//   1. Es lo único que se puede probar sin emulador, y es donde están los
//      errores que importan (un porcentaje mal aplicado se cobra de menos a
//      todos los clientes, en silencio, hasta que alguien mira la caja).
//   2. El frontend necesita el MISMO cálculo para mostrar el desglose antes de
//      confirmar. Está duplicado en `src/utils/cupon.js` porque las Functions no
//      pueden importar del bundle de Vite — igual que `planes.js`. Si tocás uno,
//      tocá el otro, y las dos suites lo verifican.
//
// Lo que el cliente ve es una vista previa. Lo que vale es lo que calcula
// `createAppointment` con el precio del documento del servicio, que es el único
// precio en el que se puede confiar.

/**
 * El código, como se guarda y como se compara.
 *
 * La gente escribe " corte20 ", "Corte 20" y "CORTE‑20". Sin normalizar, el
 * cupón que el dueño repartió por Instagram no entra por un espacio de más y la
 * barbería se entera por un cliente enojado.
 *
 * Se sacan los espacios de todo el string (no solo de las puntas: "CORTE 20" y
 * "CORTE20" son el mismo código para cualquier persona) y se pasa a mayúsculas.
 * El id del documento ES el código normalizado, así que dos cupones que
 * normalizan igual no pueden coexistir: lo impide Firestore, no un chequeo.
 */
function normalizarCodigo(codigo) {
  return String(codigo ?? '').replace(/\s+/g, '').toUpperCase();
}

/** Un código válido: 3 a 24 caracteres, letras, números y guiones. */
const CODIGO_OK = /^[A-Z0-9][A-Z0-9-]{2,23}$/;

function codigoValido(codigo) {
  return CODIGO_OK.test(normalizarCodigo(codigo));
}

/**
 * Cuánto descuenta este cupón sobre este precio.
 *
 * Devuelve siempre `{ descuento, precioFinal }` con los dos enteros y no
 * negativos. Las tres cosas que no pueden pasar, y que pasan solas si uno
 * confía en la aritmética:
 *
 *   - Un porcentaje fuera de 0–100 (el dueño escribe 200 en el formulario).
 *   - Un monto fijo más grande que el precio: el turno quedaría en negativo y
 *     la seña se calcularía sobre un número imposible. Se recorta al precio.
 *   - Centavos. Los precios de una barbería son enteros y Mercado Pago cobra lo
 *     que le mandás: un 15% de $14.500 da $2.175, y $12.325 de total está bien,
 *     pero un 33% da 4785.0000000000005. Se redondea el DESCUENTO y el final
 *     sale de restar, así que los dos cierran contra el precio de lista.
 */
function calcularDescuento(cupon, precio) {
  const base = Math.max(0, Math.round(Number(precio) || 0));
  const valor = Number(cupon?.valor) || 0;

  let descuento = 0;
  if (cupon?.tipo === 'porcentaje') {
    const pct = Math.min(100, Math.max(0, valor));
    descuento = Math.round((base * pct) / 100);
  } else if (cupon?.tipo === 'fijo') {
    descuento = Math.max(0, Math.round(valor));
  }

  descuento = Math.min(descuento, base);
  return { descuento, precioFinal: base - descuento };
}

/** '20% OFF' o '$3.000 OFF', para los textos. */
function describirCupon(cupon) {
  if (!cupon) return '';
  if (cupon.tipo === 'porcentaje') return `${Number(cupon.valor) || 0}% OFF`;
  return `$${(Number(cupon.valor) || 0).toLocaleString('es-AR')} OFF`;
}

/**
 * Los motivos por los que un cupón no aplica.
 *
 * Son para el PANEL y para los logs. Al cliente se le contesta siempre lo
 * mismo: "el código no es válido o ya no está disponible". Si le dijéramos
 * "ese cupón venció" estaríamos confirmando que el código existe, y con eso
 * alguien prueba diccionarios hasta encontrar los que andan.
 */
const MOTIVOS = {
  NO_EXISTE: 'no-existe',
  INACTIVO: 'inactivo',
  NO_VIGENTE: 'todavia-no-empieza',
  VENCIDO: 'vencido',
  AGOTADO: 'agotado',
  TOPE_CLIENTE: 'tope-por-cliente',
  NO_ES_PRIMERA: 'no-es-primera-visita',
  SERVICIO: 'servicio-no-incluido',
  PROFESIONAL: 'profesional-no-incluido',
  DIA: 'dia-no-incluido',
};

// ── Días de la semana ───────────────────────────────────────────────────────
// `cupon.dias` = [0..6] con 0 = Lunes … 6 = Domingo, la convención de los
// horarios y del happy hour (NO la de JS). Vacío o ausente = todos los días.
// Cuenta el día del TURNO, no el día en que se reserva: "vale lunes a
// miércoles" es para llenar los días tranquilos, y el que reserva un domingo
// para el martes está haciendo justamente eso.

const NOMBRES_DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

/** 'YYYY-MM-DD' → 0 = Lunes … 6 = Domingo. Al mediodía UTC para que no se corra. */
function diaDeLaSemana(fechaISO) {
  const d = new Date(`${fechaISO}T12:00:00Z`).getUTCDay();
  return d === 0 ? 6 : d - 1;
}

/** Los días del cupón, limpios y ordenados. [] = todos. */
function diasDelCupon(cupon) {
  const dias = Array.isArray(cupon?.dias) ? cupon.dias : [];
  const limpios = [...new Set(dias.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
  return limpios.length === 7 ? [] : limpios;
}

/**
 * 'de lunes a miércoles', 'lunes, miércoles y viernes', 'los sábados'.
 * Tres o más seguidos van como rango, que se lee de un vistazo.
 */
function textoDeDias(dias) {
  const d = diasDelCupon({ dias });
  if (d.length === 0) return 'todos los días';
  if (d.length === 1) return d[0] === 5 || d[0] === 6 ? `los ${NOMBRES_DIAS[d[0]]}s` : `los ${NOMBRES_DIAS[d[0]]}`;
  const seguidos = d.every((x, i) => i === 0 || x === d[i - 1] + 1);
  if (seguidos && d.length >= 3) return `de ${NOMBRES_DIAS[d[0]]} a ${NOMBRES_DIAS[d[d.length - 1]]}`;
  const nombres = d.map((x) => NOMBRES_DIAS[x]);
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
}

/**
 * Lo que se le dice al cliente cuando el cupón no vale ESE día.
 *
 * Es la única excepción al mensaje genérico, y a propósito: el que tiene el
 * código de verdad y eligió un jueves necesita saber que con cambiar el día le
 * sirve. Decir "no es válido" lo manda a reservar sin descuento o a quejarse.
 * Lo que se filtra (que el código existe) ya está en la historia de Instagram.
 */
function mensajeDeDia(cupon) {
  return `Este cupón vale solo para turnos ${textoDeDias(cupon?.dias)}. Elegí uno de esos días para usarlo.`;
}

/** Lo que se le dice al cliente, pase lo que pase. */
const MENSAJE_AL_CLIENTE = 'El código no es válido o ya no está disponible.';

/**
 * ¿Aplica este cupón, acá y ahora?
 *
 * `ahora` entra por parámetro y no se lee de `Date.now()` adentro para que las
 * pruebas puedan pararse en un instante concreto sin tocar el reloj del
 * proceso. `desde` y `hasta` son ISO ('2026-10-08T18:00').
 *
 * `usosDelCliente` y `tieneTurnosPrevios` los resuelve quien llama, porque son
 * lecturas: acá solo se decide.
 */
function evaluarCupon(cupon, ctx = {}) {
  const {
    serviceId = null,
    professionalId = null,
    usosDelCliente = 0,
    tieneTurnosPrevios = false,
    ahora = new Date(),
    // El día del turno, 'YYYY-MM-DD'. Sin fecha, un cupón con días no aplica:
    // no se puede saber si cae en uno de ellos.
    fecha = null,
  } = ctx;

  if (!cupon) return { aplica: false, motivo: MOTIVOS.NO_EXISTE };
  if (cupon.activo !== true) return { aplica: false, motivo: MOTIVOS.INACTIVO };

  const t = ahora instanceof Date ? ahora.getTime() : new Date(ahora).getTime();
  if (cupon.desde && t < new Date(cupon.desde).getTime()) {
    return { aplica: false, motivo: MOTIVOS.NO_VIGENTE };
  }
  if (cupon.hasta && t > new Date(cupon.hasta).getTime()) {
    return { aplica: false, motivo: MOTIVOS.VENCIDO };
  }

  // Las listas vacías (o ausentes) significan "todos". Es lo que hace que el
  // cupón más común —20% en todo— no obligue a tildar los diez servicios.
  const servicios = Array.isArray(cupon.serviciosIds) ? cupon.serviciosIds : [];
  if (servicios.length > 0 && !servicios.includes(serviceId)) {
    return { aplica: false, motivo: MOTIVOS.SERVICIO };
  }
  const profesionales = Array.isArray(cupon.profesionalesIds) ? cupon.profesionalesIds : [];
  if (profesionales.length > 0 && !profesionales.includes(professionalId)) {
    return { aplica: false, motivo: MOTIVOS.PROFESIONAL };
  }

  // El tope total se compara contra los usos RESERVADOS, no contra los
  // confirmados: entre que alguien saca el turno y lo paga pasan 15 minutos, y
  // en ese rato el lugar está tomado. Si después no paga, se libera.
  const maxUsos = Number(cupon.maxUsos);
  if (Number.isFinite(maxUsos) && maxUsos > 0 && Number(cupon.usos || 0) >= maxUsos) {
    return { aplica: false, motivo: MOTIVOS.AGOTADO };
  }

  const maxPorCliente = Number(cupon.maxUsosPorCliente);
  if (Number.isFinite(maxPorCliente) && maxPorCliente > 0 && usosDelCliente >= maxPorCliente) {
    return { aplica: false, motivo: MOTIVOS.TOPE_CLIENTE };
  }

  if (cupon.soloPrimeraVisita === true && tieneTurnosPrevios) {
    return { aplica: false, motivo: MOTIVOS.NO_ES_PRIMERA };
  }

  // El día va ÚLTIMO a propósito: es el único motivo que se le cuenta al
  // cliente (ver `mensajeDeDia`), y solo tiene sentido decirle "cambiá el día"
  // si con eso de verdad le sirve.
  const dias = diasDelCupon(cupon);
  if (dias.length > 0 && !(fecha && dias.includes(diaDeLaSemana(fecha)))) {
    return { aplica: false, motivo: MOTIVOS.DIA };
  }

  return { aplica: true, motivo: null };
}

/**
 * Lo que el cliente necesita para ver el desglose: evaluación + números.
 *
 * Un solo punto de entrada a propósito. Hoy el cupón NO se acumula con la promo
 * por día y franja del servicio: el precio que entra acá ya es el del servicio,
 * con su promo aplicada o no, y el cupón descuenta sobre eso. El día que se
 * quiera acumular de otra forma, se cambia acá y en ningún otro lado.
 */
function aplicarCupon(cupon, precio, ctx = {}) {
  const evaluacion = evaluarCupon(cupon, ctx);
  if (!evaluacion.aplica) {
    return { ...evaluacion, descuento: 0, precioFinal: Math.max(0, Math.round(Number(precio) || 0)) };
  }
  return { ...evaluacion, ...calcularDescuento(cupon, precio) };
}

module.exports = {
  normalizarCodigo,
  codigoValido,
  calcularDescuento,
  describirCupon,
  evaluarCupon,
  aplicarCupon,
  MOTIVOS,
  MENSAJE_AL_CLIENTE,
  diaDeLaSemana,
  diasDelCupon,
  textoDeDias,
  mensajeDeDia,
  CODIGO_OK,
};
