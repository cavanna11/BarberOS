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

  if (!perdidas.length) {
    // No se pierde nada por turno, pero si el MCD es MAYOR que el intervalo,
    // la grilla es más chica de lo que hace falta: más opciones para el cliente
    // y más lugar para que queden huecos que no sirven.
    if (sugerido !== null && sugerido > slotInterval) {
      return { estado: 'muy-fino', duraciones, sugerido };
    }
    return { estado: 'ok', duraciones, sugerido };
  }
  if (sugerido === null) return { estado: 'desalineados', duraciones, perdidas };
  return { estado: 'mejorable', duraciones, perdidas, sugerido };
}
