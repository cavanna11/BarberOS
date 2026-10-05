// ============================================================================
// Topes de los planes, del lado del servidor
// ============================================================================
// Copia de lo que importa de `src/config/plans.js`. Está duplicado a propósito:
// las Functions no pueden importar del bundle del frontend (es ESM con imports
// de Vite), y el tope de sucursales NO puede vivir solo en el browser — se
// saltearía con la consola abierta. El de barberos sí vive solo en la interfaz
// y está asumido (ver CLAUDE.md), pero crear una barbería escribe documentos
// nuevos y cuesta plata, así que ese se hace cumplir acá.
//
// Si agregás o cambiás un plan en src/config/plans.js, cambialo también acá.
// Lo único que hace falta replicar son los dos topes.

const TOPES = {
  basico:        { maxSucursales: 1, maxBarbers: 1 },
  intermedio:    { maxSucursales: 1, maxBarbers: 3 },
  full:          { maxSucursales: 1, maxBarbers: null },
  empresarial:   { maxSucursales: 4, maxBarbers: null },
  // Personalizado: se acuerda uno por uno. Sin topes propios, así que lo que
  // manda es lo que la plataforma escriba en el documento del negocio.
  personalizado: { maxSucursales: null, maxBarbers: null },
  // Escalera vieja, con cuentas adentro. No se borra: si el id desapareciera,
  // el tope quedaría en "sin límite".
  pro:           { maxSucursales: 1, maxBarbers: 5 },
  business:      { maxSucursales: 1, maxBarbers: null },
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
  const plan = TOPES[biz.planId] || null;
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

module.exports = { TOPES, limitesDelNegocio };
