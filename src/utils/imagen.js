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
