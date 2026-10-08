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
  const partes = String(nombre || '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '·';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}
