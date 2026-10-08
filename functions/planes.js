// ============================================================================
// Topes y capacidades de los planes, del lado del servidor
// ============================================================================
// Copia de lo que importa de `src/config/plans.js`. Está duplicado a propósito:
// las Functions no pueden importar del bundle del frontend (es ESM con imports
// de Vite), y estos límites NO pueden vivir solo en el browser — se saltean con
// la consola abierta.
//
// Si agregás o cambiás un plan en src/config/plans.js, cambialo también acá.
//
// Las `capacidades` además se ESCRIBEN en el documento del negocio al dar de
// alta o al cambiar de plan, porque las Security Rules no pueden importar nada:
// leen el campo del documento. Esta tabla es lo que decide qué se escribe.

const SIN = { fotoPerfil: false, colores: false, logo: false, pagina: false, paginaFoto: false };
const TODAS = { fotoPerfil: true, colores: true, logo: true, pagina: true, paginaFoto: true };

const PLANES = {
  basico:        { maxSucursales: 1, maxBarbers: 1,    monthlyFee: 15000, whatsappQuota: 100,  capacidades: { ...SIN } },
  intermedio:    { maxSucursales: 1, maxBarbers: 3,    monthlyFee: 20000, whatsappQuota: 500,  capacidades: { ...SIN, fotoPerfil: true, pagina: true } },
  full:          { maxSucursales: 1, maxBarbers: null, monthlyFee: 30000, whatsappQuota: 2000, capacidades: { ...TODAS } },
  empresarial:   { maxSucursales: 4, maxBarbers: null, monthlyFee: 60000, whatsappQuota: 2000, capacidades: { ...TODAS } },
  // Personalizado: se acuerda uno por uno. Sin topes propios, así que lo que
  // manda es lo que la plataforma escriba en el documento del negocio.
  personalizado: { maxSucursales: null, maxBarbers: null, monthlyFee: null, whatsappQuota: null, capacidades: { ...TODAS } },
  // Escalera vieja, con cuentas adentro. No se borra: si el id desapareciera,
  // el tope quedaría en "sin límite". Con todas las capacidades: compraron
  // "todo incluido".
  pro:           { maxSucursales: 1, maxBarbers: 5,    monthlyFee: 22000, whatsappQuota: 500,  capacidades: { ...TODAS } },
  business:      { maxSucursales: 1, maxBarbers: null, monthlyFee: 35000, whatsappQuota: 2000, capacidades: { ...TODAS } },
};

/**
 * Los topes que corresponden a este negocio. `null` = sin tope.
 *
 * El plan es el valor por defecto y lo que esté escrito en el documento manda
 * (`maxSucursales` / `maxBarbers`, que solo puede escribir la plataforma). Se
 * pregunta si la clave EXISTE y no si tiene valor: un `null` guardado a mano
 * significa "sin límite", no "usá el del plan".
 */
function limitesDelNegocio(biz = {}) {
  const plan = PLANES[biz.planId] || null;
  const propio = (campo, porDefecto) =>
    Object.prototype.hasOwnProperty.call(biz, campo) && biz[campo] !== undefined
      ? biz[campo]
      : porDefecto;

  return {
    maxBarbers: propio('maxBarbers', plan ? plan.maxBarbers : null),
    // Sin plan conocido, una sola: es el default conservador. Una cuenta vieja
    // con un planId que ya no existe no debería poder abrir sucursales.
    maxSucursales: propio('maxSucursales', plan ? plan.maxSucursales : 1),
  };
}

/** Qué funciones tiene habilitadas este negocio. */
function capacidadesDelNegocio(biz = {}) {
  const plan = PLANES[biz.planId];
  const delPlan = plan ? plan.capacidades : TODAS;
  const propias = biz.capacidades;
  if (!propias || typeof propias !== 'object') return { ...delPlan };
  return { ...delPlan, ...propias };
}

/**
 * Lo que define este plan, listo para escribir.
 *
 * Todo menos `monthlyFee` va en el documento PÚBLICO del negocio (el panel los
 * muestra y las Rules los verifican). El abono va en /private/billing, que es
 * plata y no puede leerla un cliente cualquiera.
 */
function camposDelPlan(planId) {
  const plan = PLANES[planId];
  if (!plan) return null;
  return {
    planId,
    maxBarbers: plan.maxBarbers,
    maxSucursales: plan.maxSucursales,
    whatsappQuota: plan.whatsappQuota || 0,
    capacidades: { ...plan.capacidades },
    monthlyFee: plan.monthlyFee,
  };
}

module.exports = { PLANES, limitesDelNegocio, capacidadesDelNegocio, camposDelPlan };
