// ============================================================================
// Fotos de perfil sin Firebase Storage
// ============================================================================
// La foto del barbero se guarda como data URL (JPEG chico) adentro del
// documento del profesional, que ya es de lectura pública. Se achica en el
// browser antes de subir: 320px de lado mayor y calidad 0.82 dan ~15–30 KB,
// que en un documento de 1 MB de tope no molesta y en la página de reserva
// carga con el resto del negocio, sin una petición extra.
//
// Cuando haga falta más que esto (galería, logos grandes) se pasa a Storage.

export const FOTO_MAX_BYTES = 250_000;

/** Lee un File de imagen, lo achica y devuelve un data URL JPEG. */
export function redimensionarImagen(file, ladoMax = 320) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith('image/')) return reject(new Error('Elegí una imagen (JPG o PNG).'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const escala = Math.min(1, ladoMax / Math.max(img.width, img.height));
      const w = Math.round(img.width * escala), h = Math.round(img.height * escala);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const out = canvas.toDataURL('image/jpeg', 0.82);
      if (out.length > FOTO_MAX_BYTES) return reject(new Error('La foto sigue siendo muy grande. Probá con otra.'));
      resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen.')); };
    img.src = url;
  });
}

/**
 * Igual que la foto de perfil, pero para el logo de la barbería.
 *
 * Dos diferencias que importan:
 *
 *   - Sale en PNG, no en JPEG: casi todos los logos vienen con fondo
 *     transparente y en JPEG ese fondo se vuelve un rectángulo negro.
 *   - Es apaisado: un logo suele ser más ancho que alto, así que se limita el
 *     lado mayor a 240 px y listo.
 *
 * Si el PNG se pasa de tamaño (pasa con los logos que en realidad son una foto)
 * se reintenta en JPEG sobre fondo blanco, que comprime muchísimo mejor. Es
 * preferible eso a decirle "no se pudo" a alguien que solo quiere poner su logo.
 */
export function redimensionarLogo(file, ladoMax = 240) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith('image/')) return reject(new Error('Elegí una imagen (PNG o JPG).'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const escala = Math.min(1, ladoMax / Math.max(img.width, img.height));
      const w = Math.round(img.width * escala), h = Math.round(img.height * escala);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);

      const png = canvas.toDataURL('image/png');
      if (png.length <= FOTO_MAX_BYTES) return resolve(png);

      // Demasiado grande en PNG: fondo blanco y JPEG.
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      const jpg = canvas.toDataURL('image/jpeg', 0.85);
      if (jpg.length > FOTO_MAX_BYTES) {
        return reject(new Error('El logo es muy pesado. Probá con una imagen más simple o más chica.'));
      }
      resolve(jpg);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen.')); };
    img.src = url;
  });
}

/** Lo que una portada puede pesar. Lo repiten las Rules y `config/pagina.js`. */
export const PORTADA_MAX_BYTES = 400_000;

/**
 * La foto de portada de la página de presentación.
 *
 * Es la única imagen grande del producto, y va a pantalla completa detrás del
 * texto, así que el criterio es distinto al del logo: 1200 px de ancho alcanza
 * para cualquier celular y para un monitor normal, y la calidad se BAJA en
 * pasos hasta que entre en el tope. Rechazarla sería lo peor que podría pasar
 * acá: el dueño eligió la foto de su local y no tiene de dónde sacar otra más
 * liviana.
 *
 * Sale en JPEG siempre: una foto de fondo no necesita transparencia y en PNG
 * pesaría cinco veces más.
 */
export function redimensionarPortada(file, ladoMax = 1200) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith('image/')) return reject(new Error('Elegí una imagen (JPG o PNG).'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const escala = Math.min(1, ladoMax / Math.max(img.width, img.height));
      const w = Math.round(img.width * escala), h = Math.round(img.height * escala);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);

      for (const calidad of [0.82, 0.7, 0.6, 0.5]) {
        const out = canvas.toDataURL('image/jpeg', calidad);
        if (out.length <= PORTADA_MAX_BYTES) return resolve(out);
      }
      reject(new Error('La foto es muy pesada. Probá con una más chica.'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen.')); };
    img.src = url;
  });
}
