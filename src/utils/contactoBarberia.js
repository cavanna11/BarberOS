// ============================================================================
// Los datos de contacto de una barbería, listos para un href
// ============================================================================
// Están acá y no adentro de un componente porque los usan tres pantallas: la
// ficha de la reserva, la confirmación del turno y la página de presentación.
// Duplicar el armado del link de Maps sería duplicar también la validación que
// evita el XSS, y esa es justo la que no se puede olvidar en una copia.

// Solo links de Google Maps de verdad: el campo lo escribe el dueño y termina
// en un href de la página pública; un `javascript:` ahí sería XSS.
const MAPS_OK = /^https:\/\/(www\.google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl\/maps)/i;

/** 'Av. Colón 1234, Mar del Plata' o '' si no cargó la dirección. */
export function direccionDe(business) {
  return [business?.address, business?.city].filter(Boolean).join(', ');
}

/**
 * El link para "Cómo llegar".
 *
 * Si el dueño pegó el link de su ficha de Google, se usa ese (lleva al negocio,
 * con sus fotos y su horario). Si no, se arma una búsqueda por dirección, que
 * es peor pero funciona. Si no hay ni dirección, no hay botón.
 */
export function linkMaps(business) {
  if (!business) return null;
  if (business.mapsUrl && MAPS_OK.test(String(business.mapsUrl))) return business.mapsUrl;
  const dir = direccionDe(business);
  return dir ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(dir)}` : null;
}

/** El link de WhatsApp del negocio (no del barbero: eso es utils/whatsapp.js). */
export function linkWhatsApp(business) {
  const wa = String(business?.socialLinks?.whatsapp || business?.phone || '').replace(/\D/g, '');
  if (!wa) return null;
  return `https://wa.me/${wa.startsWith('54') ? wa : '549' + wa}`;
}

/** 'volcadoclub' → el usuario de Instagram, sin arroba. '' si no hay. */
export function instagramDe(business) {
  return String(business?.socialLinks?.instagram || '').replace(/^@/, '').trim();
}

export function linkInstagram(business) {
  const ig = instagramDe(business);
  return ig ? `https://instagram.com/${ig}` : null;
}

/**
 * Las iniciales del nombre, para el círculo que va donde iría el logo.
 *
 * Es lo que hace que la página de un plan sin logo propio no se vea como un
 * hueco: un círculo con "VC" se lee como una decisión de diseño, un recuadro
 * vacío se lee como que falta algo.
 */
export function inicialesDe(nombre) {
  // Solo palabras que EMPIEZAN con letra. "Neytan Barber 777" daba "N7",
  // porque la última palabra es un número: la inicial de un número no es una
  // inicial, es ruido. Con el filtro da "NB", que es lo que alguien escribiría.
  const partes = String(nombre || '')
    .trim()
    .split(/\s+/)
    .filter((p) => p && /^\p{L}/u.test(p));
  if (!partes.length) return '·';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

/**
 * La URL del mapa para incrustar, armada por nosotros.
 *
 * Se construye desde la dirección que la barbería ya cargó, y NUNCA desde una
 * URL que escriba el dueño. La diferencia es de seguridad, no de comodidad: un
 * `src` de iframe que viene de un campo de texto es una puerta abierta
 * (`javascript:`, una página que imita un login, publicidad). Acá el dominio
 * está fijo en el código y lo único variable es el texto de la búsqueda, que va
 * codificado.
 *
 * `output=embed` es el mapa clásico: no pide clave de API ni facturación, que
 * es lo que lo hace viable para cada barbería sin administrar nada.
 *
 * Devuelve null sin dirección: un mapa apuntando al centro de la nada es peor
 * que no tener mapa.
 */
export function mapaIncrustado(business) {
  const dir = direccionDe(business);
  if (!dir) return null;
  return `https://maps.google.com/maps?q=${encodeURIComponent(dir)}&z=16&output=embed`;
}

/** Los días que abre, agrupados: "Lun a Vie 09:00–20:00 · Sáb 09:00–18:00". */
export function horarioDeAtencion(business) {
  const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const dias = (business?.businessHours || [])
    .filter((d) => d && d.isActive !== false && d.startTime && d.endTime)
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek);
  if (!dias.length) return [];

  // Se juntan los días seguidos con el mismo horario: "Lunes a viernes de 9 a
  // 20" es como lo diría cualquiera, y siete renglones iguales no los lee nadie.
  const tramos = [];
  for (const d of dias) {
    const ultimo = tramos[tramos.length - 1];
    const mismo = ultimo
      && ultimo.startTime === d.startTime
      && ultimo.endTime === d.endTime
      && ultimo.breakStart === d.breakStart
      && ultimo.breakEnd === d.breakEnd
      && ultimo.hasta === d.dayOfWeek - 1;
    if (mismo) ultimo.hasta = d.dayOfWeek;
    else tramos.push({ desde: d.dayOfWeek, hasta: d.dayOfWeek, ...d });
  }

  return tramos.map((t) => ({
    dias: t.desde === t.hasta ? DIAS[t.desde] : `${DIAS[t.desde]} a ${DIAS[t.hasta]}`,
    horas: t.breakStart && t.breakEnd
      ? `${t.startTime}–${t.breakStart} y ${t.breakEnd}–${t.endTime}`
      : `${t.startTime}–${t.endTime}`,
  }));
}
