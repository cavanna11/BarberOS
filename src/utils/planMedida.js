// ============================================================================
// Plan Personalizado: pasar el formulario a lo que se guarda, y al revés
// ============================================================================
// Aparte del componente porque son funciones, no pantalla: el alta y el cambio
// de plan las usan igual.

/** '' | '4' → null | 4. Vacío es "sin tope". */
export function aNumeroOSinTope(valor) {
  const t = String(valor ?? '').trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/**
 * El estado inicial del formulario, a partir de un negocio existente.
 *
 * Las capacidades arrancan en true cuando el campo no está: es el mismo
 * criterio que las Rules para las cuentas viejas, así el formulario muestra lo
 * que la base de verdad permite hoy y no lo contrario.
 */
export function medidaDesdeNegocio(biz) {
  const cap = biz?.capacidades || {};
  return {
    maxSucursales: biz?.maxSucursales == null ? '' : String(biz.maxSucursales),
    maxBarbers: biz?.maxBarbers == null ? '' : String(biz.maxBarbers),
    fotoPerfil: cap.fotoPerfil !== false,
    colores: cap.colores !== false,
    logo: cap.logo !== false,
    pagina: cap.pagina !== false,
    paginaFoto: cap.paginaFoto !== false,
    whatsappQuota: biz?.whatsappQuota == null ? '' : String(biz.whatsappQuota),
  };
}

/** Lo que hay que escribir en el negocio, a partir del formulario. */
export function camposDeLaMedida(medida) {
  return {
    maxSucursales: aNumeroOSinTope(medida.maxSucursales),
    maxBarbers: aNumeroOSinTope(medida.maxBarbers),
    whatsappQuota: aNumeroOSinTope(medida.whatsappQuota) || 0,
    capacidades: {
      fotoPerfil: medida.fotoPerfil === true,
      colores: medida.colores === true,
      logo: medida.logo === true,
      pagina: medida.pagina === true,
      paginaFoto: medida.paginaFoto === true,
    },
  };
}
