// ============================================================================
// WhatsApp por wa.me — sin API, sin bot, sin envío automático
// ============================================================================
// Lo único que hace esto es ARMAR UN LINK. Al tocarlo se abre WhatsApp en el
// teléfono del barbero con el mensaje ya escrito, y el barbero decide si lo
// manda. No hay nada del lado del servidor: ni API de Meta, ni plantillas
// aprobadas, ni costo por mensaje, ni un bot que escriba en nombre de nadie.
//
// Es a propósito y es la diferencia con la integración de WhatsApp Cloud que
// sigue pendiente de Meta: aquella manda sola (recordatorios automáticos), esta
// solo le ahorra al barbero escribir lo mismo veinte veces por día.
//
// El número es SIEMPRE el que cargó el cliente al reservar. No se guarda ni se
// usa ningún otro: si el turno no tiene teléfono, no hay botón.

/**
 * Pasa un teléfono como lo escribe la gente a lo que necesita wa.me:
 * solo dígitos, con código de país.
 *
 *   "11 2345-6789"        → 5491123456789
 *   "(0223) 15 456-7890"  → 5492234567890
 *   "+54 9 11 2345 6789"  → 5491123456789
 *   "02257 15-529684"     → 5492257529684
 *
 * Qué resuelve cada paso, porque todos salieron de números reales:
 *
 *   - Los separadores (espacios, guiones, paréntesis, +) se van.
 *   - El 0 de larga distancia al principio (0223, 02257) no va en el
 *     internacional.
 *   - El 15 de los celulares argentinos tampoco: se reemplaza por el 9 que va
 *     después del 54.
 *   - Si ya viene con 54, se respeta; si no, se agrega 54 9 (celular argentino,
 *     que es lo que usa WhatsApp).
 *
 * Devuelve null si lo que queda no puede ser un teléfono: mejor no mostrar el
 * botón que abrir WhatsApp con un número que no existe.
 */
export function normalizarTelefono(crudo, paisPorDefecto = '54') {
  let n = String(crudo || '').replace(/\D/g, '');
  if (!n) return null;

  // Ya viene en internacional.
  if (n.startsWith('00')) n = n.slice(2);

  if (n.startsWith(paisPorDefecto) && n.length >= 12) {
    // 54 + resto. Si el resto arranca con 0 o trae un 15, se limpia igual.
    let resto = n.slice(paisPorDefecto.length);
    if (resto.startsWith('9')) resto = resto.slice(1);
    resto = limpiarNacional(resto);
    if (!resto) return null;
    return `${paisPorDefecto}9${resto}`;
  }

  const resto = limpiarNacional(n);
  if (!resto) return null;
  return `${paisPorDefecto}9${resto}`;
}

/** Saca el 0 de larga distancia y el 15 de los celulares. */
function limpiarNacional(numero) {
  let n = numero;
  if (n.startsWith('0')) n = n.slice(1);

  // El 15 va después del código de área: 223 15 4567890 → 2234567890.
  // Las áreas argentinas son de 2 a 4 dígitos, así que se busca el 15 en esa
  // ventana y no en cualquier lado (un número que EMPIECE con 15 adentro del
  // abonado no se toca).
  for (const largoArea of [2, 3, 4]) {
    if (n.length > largoArea + 2 && n.slice(largoArea, largoArea + 2) === '15') {
      const sinQuince = n.slice(0, largoArea) + n.slice(largoArea + 2);
      // Un número argentino sin el 15 queda en 10 dígitos (área + abonado).
      if (sinQuince.length === 10) return sinQuince;
    }
  }

  // Entre 8 (fijo sin área, raro pero posible) y 13 dígitos. Fuera de eso es
  // basura: un DNI, una fecha, un "no tiene".
  if (n.length < 8 || n.length > 13) return null;
  return n;
}

/** El link de wa.me listo para abrir, o null si el teléfono no sirve. */
export function linkWhatsApp(telefono, mensaje = '') {
  const numero = normalizarTelefono(telefono);
  if (!numero) return null;
  const texto = mensaje ? `?text=${encodeURIComponent(mensaje)}` : '';
  return `https://wa.me/${numero}${texto}`;
}

/** "Lucas Pérez" → "Lucas". Para que el mensaje no suene a formulario. */
function nombreDePila(nombre) {
  return String(nombre || '').trim().split(/\s+/)[0] || '';
}

/** '2026-10-07' → '7/10'. Corta, que es como se dice una fecha por WhatsApp. */
function diaCorto(fechaISO) {
  if (typeof fechaISO !== 'string') return '';
  const [, m, d] = fechaISO.split('-');
  return m && d ? `${Number(d)}/${Number(m)}` : '';
}

/**
 * Los mensajes que se ofrecen en cada turno.
 *
 * Se arman con lo que el turno ya tiene: nombre, barbería, día, hora y
 * servicio. Si falta algo, la frase se acomoda sola en vez de quedar con un
 * hueco ("a las undefined").
 */
export function mensajesDelTurno(turno, { nombreNegocio = '', nombreServicio = '' } = {}) {
  const cliente = nombreDePila(turno?.clientName);
  const hola = cliente ? `Hola ${cliente}` : 'Hola';
  const donde = nombreNegocio ? ` en ${nombreNegocio}` : '';
  const dia = diaCorto(turno?.appointmentDate);
  const hora = turno?.startTime || '';
  const servicio = nombreServicio ? ` (${nombreServicio})` : '';

  return {
    recordatorio:
      `${hola}! Te recordamos tu turno${donde}` +
      (dia ? ` el ${dia}` : '') +
      (hora ? ` a las ${hora}` : '') +
      `${servicio}. ¡Te esperamos!`,

    gracias:
      `${hola}! Gracias por elegirnos${donde}. ` +
      `Cualquier cosa que necesites, escribinos por acá. ¡Te esperamos la próxima!`,

    enCamino:
      `${hola}! Te confirmamos tu turno${donde}` +
      (dia ? ` el ${dia}` : '') +
      (hora ? ` a las ${hora}` : '') +
      `. Si no podés venir, avisanos con tiempo así se lo damos a otra persona. ¡Gracias!`,
  };
}
