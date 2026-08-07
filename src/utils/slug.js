/**
 * Convierte el nombre de un negocio en un slug apto para URL.
 * "Barbería Don José" → "barberia-don-jose"
 */
export function slugify(text) {
  return String(text || '')
    .normalize('NFD')
    // Rango de diacríticos combinantes: los saca después del normalize.
    .replace(/[̀-ͯ]/g, '')
    .replace(/ñ/gi, 'n')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

// Rutas propias de la app: un negocio no puede quedarse con estos slugs porque
// chocarían con el ruteo.
const RESERVED_SLUGS = ['login', 'admin', 'super-admin', 'confirmacion', 'mis-citas'];

/**
 * Igual que slugify pero garantiza que no choque con uno existente ni con las
 * rutas reservadas. Si "don-jose" ya existe, devuelve "don-jose-2".
 */
export function uniqueSlug(text, existingSlugs = []) {
  const base = slugify(text) || 'negocio';
  const taken = new Set([...existingSlugs, ...RESERVED_SLUGS]);

  if (!taken.has(base)) return base;

  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export function isReservedSlug(slug) {
  return RESERVED_SLUGS.includes(slug);
}
