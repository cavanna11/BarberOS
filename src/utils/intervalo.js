// ============================================================================
// El intervalo de la grilla, y cuánto tiempo cuesta elegirlo mal
// ============================================================================
// `slotInterval` es cada cuánto se ofrece un turno: con 30, el cliente ve 09:00,
// 09:30, 10:00. La duración de cada turno la define el servicio.
//
// El problema que esto resuelve lo trajo un barbero: su corte clásico sale en
// 20 minutos y el degradé en 40, con la grilla cada 30. Pensaba que el problema
// era tener servicios de distinta duración. No lo es:
//
//   **el problema es que 30 no divide ni a 20 ni a 40.**
//
// La grilla arranca a la hora de apertura y suma de a `slotInterval`. Un corte
// de 20 termina 09:20, que no es un punto de la grilla, y el siguiente turno no
// puede empezar hasta las 09:30: 10 minutos muertos. Un degradé de 40 se come
// el slot de las 09:30 y arranca el siguiente a las 10:10 → próximo punto
// 10:30: 20 minutos muertos.
//
// Medido con el motor de verdad sobre una jornada de 09:00 a 20:00 y 15 turnos
// mezclados: con la grilla cada 30 se pierden **200 minutos** y el día termina
// 19:20; con la grilla cada 20 —el máximo común divisor de 20 y 40— se pierden
// **cero** y el mismo trabajo termina 16:00.
//
// Por eso el panel no se limita a dejar elegir el número: le dice cuál le
// conviene y cuánto le cuesta el que tiene. Un número suelto no se puede decidir
// bien; con el costo al lado, sí.

/** Lo que se puede escribir en el panel. */
export const INTERVALO_MIN = 5;
export const INTERVALO_MAX = 120;

/**
 * Lo más chico que vale la pena SUGERIR, que no es lo mismo.
 *
 * Una grilla de 5 minutos es válida y no desperdicia nada, pero en una jornada
 * de once horas son 132 horarios para elegir: el cliente deja de leer la lista
 * y empieza a tocar cualquiera. Cuando el máximo común divisor cae por debajo
 * de esto, la salida honesta no es achicar la grilla hasta lo ilegible — es
 * decirle al barbero que redondee las duraciones de sus servicios.
 */
export const INTERVALO_SUGERIBLE_MIN = 10;

/** Un intervalo usable, siempre. Protege al motor de un 0 o un texto. */
export function normalizarIntervalo(valor, porDefecto = 30) {
  const n = Math.round(Number(valor));
  if (!Number.isFinite(n) || n < INTERVALO_MIN) return porDefecto;
  return Math.min(n, INTERVALO_MAX);
}

/** Máximo común divisor. */
export function mcd(a, b) {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y) { [x, y] = [y, x % y]; }
  return x;
}

/** Las duraciones distintas de los servicios que se reservan solos. */
export function duracionesDe(servicios = []) {
  const dur = servicios
    .filter((s) => s && s.isActive !== false && s.adicional !== true)
    .map((s) => Math.round(Number(s.durationMinutes)))
    .filter((d) => Number.isFinite(d) && d > 0);
  return [...new Set(dur)].sort((a, b) => a - b);
}

/**
 * El intervalo que no desperdicia nada: el MCD de las duraciones.
 *
 * Devuelve null si no hay con qué calcularlo, o si el MCD queda por debajo de
 * `INTERVALO_SUGERIBLE_MIN`. Ese segundo caso importa y no es un detalle
 * técnico: significa que las duraciones no están alineadas entre sí (25 y 40
 * dan MCD 5) y la salida no es achicar la grilla hasta lo ilegible, es
 * redondear las duraciones. El panel lo dice con esas palabras.
 */
export function intervaloSugerido(servicios = []) {
  const dur = duracionesDe(servicios);
  if (!dur.length) return null;
  const g = dur.reduce((a, b) => mcd(a, b));
  return g >= INTERVALO_SUGERIBLE_MIN ? Math.min(g, INTERVALO_MAX) : null;
}

/**
 * Cuántos minutos muertos deja CADA turno de cada servicio con este intervalo.
 *
 * El turno ocupa su duración, pero el siguiente no puede arrancar hasta el
 * próximo punto de la grilla: la diferencia es lo que se pierde.
 *
 *   desperdicio = ceil(duración / intervalo) × intervalo − duración
 *
 * No se inventa cuántos turnos tiene el día: se informa por servicio, que es un
 * dato exacto. "Cada degradé te deja 20 minutos muertos" se entiende y es
 * verdad; "perdés 200 minutos por día" supone una mezcla de turnos que nadie
 * midió.
 */
export function desperdicioPorServicio(servicios = [], slotInterval = 30) {
  const paso = normalizarIntervalo(slotInterval);
  return servicios
    .filter((s) => s && s.isActive !== false && s.adicional !== true)
    .map((s) => {
      const dur = Math.round(Number(s.durationMinutes));
      if (!Number.isFinite(dur) || dur <= 0) return null;
      const ocupa = Math.ceil(dur / paso) * paso;
      return { id: s.id, name: s.name, duracion: dur, desperdicio: ocupa - dur };
    })
    .filter(Boolean)
    .sort((a, b) => b.desperdicio - a.desperdicio);
}

/**
 * Cuántos turnos de ESTE servicio entran en una jornada, con este intervalo.
 *
 * Sirve para decir "con 30 entran 22 cortes, con 20 entran 33", que es la forma
 * en que un barbero mide si le conviene. `jornada` en minutos.
 */
export function turnosQueEntran(duracion, slotInterval, jornada) {
  const paso = Math.ceil(duracion / normalizarIntervalo(slotInterval)) * normalizarIntervalo(slotInterval);
  if (!(paso > 0) || !(jornada > 0)) return 0;
  return Math.floor(jornada / paso);
}

/** Minutos que trabaja por semana, según el horario cargado del local. */
export function jornadaSemanal(businessHours = []) {
  const aMin = (t) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || ''));
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  return businessHours
    .filter((d) => d && d.isActive !== false)
    .reduce((total, d) => {
      const desde = aMin(d.startTime), hasta = aMin(d.endTime);
      if (desde === null || hasta === null || hasta <= desde) return total;
      const corte = aMin(d.breakStart) !== null && aMin(d.breakEnd) !== null
        ? Math.max(0, aMin(d.breakEnd) - aMin(d.breakStart))
        : 0;
      return total + (hasta - desde) - corte;
    }, 0);
}

/**
 * Qué servicios están forzando una grilla más chica de lo necesario.
 *
 * El MCD lo decide el conjunto: con servicios de 30, 30 y 60 la grilla sana es
 * 30, pero basta UNO de 10 para que baje a 10 y el barbero termine con una
 * lista de 66 horarios sin entender por qué.
 *
 * Caso real: Neytan tenía "Perfilado de cejas con navaja — 10 min" cargado como
 * servicio suelto en vez de como adicional. Sus otros servicios duran 30 y 60,
 * así que el consejo correcto era 30 y el sistema le decía 10 — bien calculado
 * sobre datos mal cargados.
 *
 * Para cada servicio se calcula el MCD de TODOS LOS DEMÁS: si da más grande que
 * el del conjunto, ese servicio es el que está tirando la grilla para abajo. No
 * es una heurística, es exacto.
 */
export function serviciosQueAchicanLaGrilla(servicios = []) {
  const lista = servicios.filter((x) => x && x.isActive !== false && x.adicional !== true
    && Number.isFinite(Math.round(Number(x.durationMinutes))) && Number(x.durationMinutes) > 0);
  if (lista.length < 2) return [];

  const g = (arr) => arr.map((x) => Math.round(Number(x.durationMinutes))).reduce((a, b) => mcd(a, b));
  const total = g(lista);

  return lista
    .map((srv, i) => {
      const resto = lista.filter((_, j) => j !== i);
      const sinEl = g(resto);
      return sinEl > total
        ? { id: srv.id, name: srv.name, duracion: Math.round(Number(srv.durationMinutes)), grillaSinEl: sinEl }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.grillaSinEl - a.grillaSinEl);
}

/**
 * El diagnóstico completo, listo para pintar.
 *
 * `estado`:
 *   'sin-servicios'  no hay con qué opinar
 *   'ok'             el intervalo divide a todas las duraciones: no se pierde nada
 *   'mejorable'      hay un intervalo mejor, y se dice cuál
 *   'muy-fino'       no se pierde nada, pero la grilla es más chica de lo
 *                    necesario (ver abajo)
 *   'desalineados'   las duraciones no tienen un divisor común usable
 *
 * Lo de 'muy-fino' salió de una pregunta buena: "si pongo la grilla cada 10 y
 * me entra un servicio de 60, ¿no se me atrasa todo?". No: un turno de 60 ya
 * bloquea la hora entera, no un slot de 10 — eso el motor lo hace desde
 * siempre. Pero medido con 200 días simulados y clientes eligiendo el horario
 * que les gusta (no el primero libre), apareció el problema de al lado:
 *
 *   grilla cada 10 → 3.3 huecos por día de menos de 20 minutos = 33 min tirados
 *   grilla cada 20 → 0 huecos inútiles, y 463 minutos vendidos contra 460
 *
 * Con la grilla fina el cliente deja agujeros donde no entra ni el servicio más
 * corto. Con el MCD, cada turno termina justo donde puede empezar otro. Y de
 * paso ve 33 horarios en vez de 66.
 */
export function diagnosticoDelIntervalo(servicios = [], slotInterval = 30) {
  const duraciones = duracionesDe(servicios);
  if (!duraciones.length) return { estado: 'sin-servicios' };

  const perdidas = desperdicioPorServicio(servicios, slotInterval).filter((x) => x.desperdicio > 0);
  const sugerido = intervaloSugerido(servicios);

  const culpables = serviciosQueAchicanLaGrilla(servicios);

  if (!perdidas.length) {
    // No se pierde nada por turno, pero si el MCD es MAYOR que el intervalo,
    // la grilla es más chica de lo que hace falta: más opciones para el cliente
    // y más lugar para que queden huecos que no sirven.
    if (sugerido !== null && sugerido > slotInterval) {
      return { estado: 'muy-fino', duraciones, sugerido, culpables };
    }
    return { estado: 'ok', duraciones, sugerido };
  }
  if (sugerido === null) return { estado: 'desalineados', duraciones, perdidas, culpables };
  return { estado: 'mejorable', duraciones, perdidas, sugerido, culpables };
}

// ============================================================================
// El intervalo automático: calculado con los turnos que de verdad salieron
// ============================================================================
// El MCD de las duraciones trata a todos los servicios como si salieran igual,
// y eso es lo que lo hacía dar un consejo equivocado. Caso real: Volcado Club
// tiene corte de 60 y barba de 30, con la grilla en 60. El MCD dice 30 y el
// panel le ofrecía el botón para cambiarlo — pero el 90% de sus turnos son el
// corte de 60, y la barba casi no sale.
//
// Simulado sobre 6000 días (jornada de 11 h, 13 pedidos, el cliente se corre
// hasta una hora de su horario preferido antes de no reservar), barriendo
// cuánto sale la barba:
//
//   sale el  5% → grilla 60 vende 32 min/día MÁS que la de 30
//           10% → +22        (este es Volcado)
//           15% → +11
//           20% → empatan           ← el cruce
//           25% → grilla 30 vende 9 min/día más
//           40% → +34
//           50% → +51
//
// **El cruce está en 1 de cada 5.** Si el servicio que no encaja en la grilla
// sale menos que eso, los minutos que deja sueltos son menos que los que se
// pierden fragmentando el día; si sale más, conviene bajar al MCD.
//
// Y con la grilla gruesa hay tiempo muerto de verdad (17 a 27 min/día en
// Volcado: el rato que deja cada barba), solo que vende más igual. Eso se le
// muestra, no se le esconde: la recomendación dice qué se gana Y qué se pierde.
//
// De ahí sale la regla, que además se puede explicar en una frase:
//
//   la grilla va a la duración del servicio que MÁS te piden, salvo que los que
//   no encajan ahí sumen más de 1 de cada 5 turnos — entonces va el MCD.

/** Cuántos días de turnos se miran. Tres meses: aguanta un mes flojo. */
export const DIAS_DE_HISTORIAL = 90;

/**
 * Menos turnos que esto no son una mezcla, son una anécdota.
 *
 * Con 8 turnos, uno solo de barba ya pesa 12% y dos pesan 25%: la respuesta
 * salta de un lado al otro del cruce por un turno. Debajo de este número se
 * dice que todavía no hay con qué, y se vuelve al MCD, que no pierde nada con
 * ninguna mezcla.
 */
export const TURNOS_MINIMOS = 20;

/** El cruce medido: hasta acá, el servicio que no encaja no justifica bajar. */
export const PROPORCION_TOLERADA = 0.20;

function fechaMenos(dias, hoy) {
  const d = new Date(hoy);
  d.setDate(d.getDate() - dias);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Cuántos turnos salieron de cada duración, en los últimos `dias`.
 *
 * La duración sale del servicio COMO ESTÁ HOY, no de lo que duraba el turno
 * cuando se tomó: lo que se está decidiendo es la grilla de acá en adelante.
 *
 * No se cuentan los cancelados —no ocuparon lugar— ni los adicionales, que no
 * se reservan solos. Los "no vino" SÍ cuentan: el horario estuvo tomado, que es
 * lo único que le importa a la grilla.
 */
export function mezclaDeTurnos(turnos = [], servicios = [], { dias = DIAS_DE_HISTORIAL, hoy = new Date() } = {}) {
  const desde = fechaMenos(dias, hoy);
  const porId = new Map();
  for (const s of servicios) {
    if (!s || s.isActive === false || s.adicional === true) continue;
    const dur = Math.round(Number(s.durationMinutes));
    if (Number.isFinite(dur) && dur > 0) porId.set(s.id, { nombre: s.name, dur });
  }

  const grupos = new Map();
  let total = 0;
  for (const t of turnos) {
    if (!t || t.status === 'cancelada') continue;
    if (!t.appointmentDate || t.appointmentDate < desde) continue;
    const srv = porId.get(t.serviceId);
    if (!srv) continue; // servicio borrado, o pasado a adicional
    total += 1;
    const g = grupos.get(srv.dur) || { duracion: srv.dur, turnos: 0, nombres: new Map() };
    g.turnos += 1;
    g.nombres.set(srv.nombre, (g.nombres.get(srv.nombre) || 0) + 1);
    grupos.set(srv.dur, g);
  }

  const lista = [...grupos.values()]
    .map((g) => ({
      duracion: g.duracion,
      turnos: g.turnos,
      proporcion: total ? g.turnos / total : 0,
      // El nombre con el que el barbero lo reconoce: el más pedido de esa duración.
      nombre: [...g.nombres.entries()].sort((a, b) => b[1] - a[1])[0][0],
    }))
    // Más pedido primero. A igual cantidad, el más corto: con la duda, la
    // grilla más fina es la que no deja tiempo muerto.
    .sort((a, b) => b.turnos - a.turnos || a.duracion - b.duracion);

  return { total, desde, grupos: lista };
}

/**
 * El intervalo que conviene según la mezcla real. Null si no alcanza para opinar.
 *
 * `motivo`:
 *   'mas-pedido'    la grilla es la duración del servicio que más sale
 *   'mcd'           los que no encajaban pesaban demasiado: va el MCD
 *   'desalineados'  ni el MCD sirve (cae por debajo de 10): hay que redondear
 *                   las duraciones en Servicios
 */
export function intervaloPorDemanda(mezcla) {
  const grupos = mezcla?.grupos || [];
  if (!grupos.length) return null;

  const g = grupos.map((x) => x.duracion).reduce((a, b) => mcd(a, b));
  const comun = g >= INTERVALO_SUGERIBLE_MIN && g <= INTERVALO_MAX ? g : null;

  const masPedido = grupos[0];
  const noEncajan = grupos.filter((x) => x.duracion % masPedido.duracion !== 0);
  const pesoQueNoEncaja = noEncajan.reduce((a, x) => a + x.proporcion, 0);

  if (masPedido.duracion <= INTERVALO_MAX && pesoQueNoEncaja <= PROPORCION_TOLERADA) {
    return { intervalo: masPedido.duracion, motivo: 'mas-pedido', masPedido, noEncajan, pesoQueNoEncaja, comun };
  }
  if (comun === null) {
    return { intervalo: null, motivo: 'desalineados', masPedido, noEncajan, pesoQueNoEncaja, comun };
  }
  return { intervalo: comun, motivo: 'mcd', masPedido, noEncajan, pesoQueNoEncaja, comun };
}

/**
 * La recomendación completa, lista para pintar. Es lo que mira el componente.
 *
 * Cuando hay historial, ESTA es la única que opina: el diagnóstico por MCD
 * (`diagnosticoDelIntervalo`) queda para la barbería que todavía no tiene
 * turnos cargados. Si opinaran las dos a la vez se contradicen — en Volcado,
 * una diría 60 y la otra 30 — y dos consejos opuestos en la misma pantalla no
 * son más información, son ninguna.
 */
export function recomendacionAutomatica(servicios = [], turnos = [], opciones = {}) {
  const dias = opciones.dias || DIAS_DE_HISTORIAL;
  if (!duracionesDe(servicios).length) return { hay: false, motivo: 'sin-servicios', dias };

  const mezcla = mezclaDeTurnos(turnos, servicios, opciones);
  const r = mezcla.total >= TURNOS_MINIMOS ? intervaloPorDemanda(mezcla) : null;
  if (!r) return { hay: false, motivo: 'sin-historial', turnos: mezcla.total, dias };

  return {
    hay: r.intervalo !== null,
    motivo: r.motivo,
    intervalo: r.intervalo,
    mezcla,
    masPedido: r.masPedido,
    noEncajan: r.noEncajan,
    pesoQueNoEncaja: r.pesoQueNoEncaja,
    comun: r.comun,
    turnos: mezcla.total,
    dias,
  };
}
