// ============================================
// Planes comerciales de BarberOS
// ============================================
// Fuente única de verdad. El alta de barbería, el cambio de plan, la landing y
// los topes que hace cumplir el panel leen de acá, así no se desincronizan.
//
// La escalera se ordena por CAPACIDAD, y la capacidad es lo único que el
// sistema hace cumplir de verdad:
//
//   maxSucursales → cuántas barberías puede tener una misma cuenta
//   maxBarbers    → cuántos barberos activos por sucursal
//
// `null` en cualquiera de los dos significa "sin tope".
//
// En `features`, una entrada puede ser texto suelto o `{ texto, proximamente }`.
// Lo segundo se pinta con una etiqueta y sirve para no prometer en la landing lo
// que todavía no anda: los avisos por WhatsApp esperan la aprobación de Meta y
// la exportación de clientes no está construida.
//
// Cada plan lista SOLO lo que lo diferencia. Lo que tienen todos va en
// FEATURES_COMUNES y se muestra aparte. No se le resta una función al Básico
// para inventar una diferencia: prometer una que no existe es peor que no
// prometerla, porque el primer cliente que pregunte qué compró se entera solo.
//
// `monthlyFee: null` = precio todavía no definido. La landing muestra
// "Consultanos" en vez de un número inventado, y en el alta la plataforma tipea
// el abono acordado. El único precio cerrado hoy es el del Full ($25.000), que
// es la propuesta que ya se está vendiendo: una barbería, barberos sin límite y
// todo incluido.

/** Lo que incluye cualquier plan. Se muestra una vez, debajo de las tarjetas. */
export const FEATURES_COMUNES = [
  'Turnos e historial sin límite',
  'Tu link público con tu marca',
  'Ingresos del mes e historial por mes',
  'Servicios sin turno en vivo (walk-in)',
  'Seña por Mercado Pago, directo a tu cuenta',
  'Cada barbero ve solo su agenda',
  'App para el celular con avisos al instante',
];

export const PLANS = [
  {
    id: 'basico',
    label: 'Plan Básico',
    description: 'Para el barbero que trabaja solo',
    maxSucursales: 1,
    maxBarbers: 1,
    monthlyFee: null,
    whatsappQuota: 100,
    // La capacidad (barberías y barberos) se muestra aparte, en su propio
    // bloque: acá va solo lo que no entra ahí, para no decir dos veces lo mismo.
    features: [
      { texto: '100 avisos por WhatsApp/mes', proximamente: true },
      'Soporte por WhatsApp',
    ],
  },
  {
    id: 'intermedio',
    label: 'Plan Intermedio',
    description: 'Para la barbería con equipo chico',
    maxSucursales: 1,
    maxBarbers: 3,
    monthlyFee: null,
    whatsappQuota: 500,
    features: [
      { texto: '500 avisos por WhatsApp/mes', proximamente: true },
      'Soporte por WhatsApp',
    ],
  },
  {
    id: 'full',
    label: 'Plan Full',
    description: 'Una barbería, sin límite de equipo',
    maxSucursales: 1,
    maxBarbers: null,
    monthlyFee: 25000,
    whatsappQuota: 2000,
    destacado: true,
    features: [
      { texto: '2000 avisos por WhatsApp/mes', proximamente: true },
      { texto: 'Exportación de base de clientes', proximamente: true },
      'Armado de la cuenta con acompañamiento',
      'Soporte prioritario por WhatsApp',
    ],
  },
  {
    id: 'empresarial',
    label: 'Plan Empresarial',
    description: 'Varias sucursales, una sola cuenta',
    maxSucursales: 4,
    maxBarbers: null,
    monthlyFee: null,
    whatsappQuota: null,
    empresarial: true,
    features: [
      'Una sola cuenta para administrarlas todas',
      'Cada sucursal con su equipo, servicios y horarios',
      'Números por sucursal y de todas juntas',
      'Soporte prioritario por WhatsApp',
    ],
  },
  {
    id: 'personalizado',
    label: 'Plan Personalizado',
    description: 'Para lo que no entra en los planes de arriba',
    // Sin topes definidos: se acuerdan uno por uno y la plataforma los carga a
    // mano en el alta (los campos `maxBarbers` y `maxSucursales` del negocio
    // pisan lo que diga el plan).
    maxSucursales: null,
    maxBarbers: null,
    monthlyFee: null,
    whatsappQuota: null,
    aMedida: true,
    features: [
      'Diseño web propio',
      'Configuraciones especiales',
      'Personalización avanzada',
      'Desarrollos a medida',
    ],
  },
];

/**
 * Planes que ya no se venden pero que todavía tienen cuentas adentro.
 *
 * No se borran ni se renombran a propósito: `getPlan('pro')` tiene que seguir
 * devolviendo el tope de 5 barberos que esa barbería compró. Si el id
 * desapareciera, `getPlan` daría null, el tope quedaría en "sin límite" y el
 * panel dejaría sumar barberos de gratis. Se migran a mano, hablando con cada
 * cliente — no silenciosamente desde acá.
 *
 * Ojo con `basico`: el id se reusa en la escalera nueva con un tope más bajo
 * (2 barberos → 1). Como el tope se compara al AGREGAR y no al editar, nadie
 * pierde un barbero que ya tenga; pero a una cuenta vieja de Básico con dos
 * barberos hay que pasarla a Intermedio o dejarle el tope viejo escrito en el
 * documento (`maxBarbers`, que pisa al del plan).
 */
export const PLANES_HISTORICOS = [
  {
    id: 'pro',
    label: 'Plan Pro (discontinuado)',
    description: 'Escalera vieja',
    maxSucursales: 1,
    maxBarbers: 5,
    monthlyFee: 22000,
    whatsappQuota: 500,
    historico: true,
    features: ['Hasta 5 barberos'],
  },
  {
    id: 'business',
    label: 'Plan Business (discontinuado)',
    description: 'Escalera vieja',
    maxSucursales: 1,
    maxBarbers: null,
    monthlyFee: 35000,
    whatsappQuota: 2000,
    historico: true,
    features: ['Barberos sin límite'],
  },
];

export const TODOS_LOS_PLANES = [...PLANS, ...PLANES_HISTORICOS];

export const DEFAULT_PLAN_ID = 'basico';

/** Costo que se le cobra al cliente por cada mensaje fuera de cuota (USD). */
export const OVERAGE_COST_USD = 0.06;

export function getPlan(planId) {
  return TODOS_LOS_PLANES.find((p) => p.id === planId) || null;
}

/** Dada una cuota, devuelve el plan que la usa (o null si es personalizado). */
export function findPlanByQuota(quota) {
  return TODOS_LOS_PLANES.find((p) => p.whatsappQuota === quota) || null;
}

/**
 * Los topes que corresponden a ESTE negocio.
 *
 * El plan es el valor por defecto; lo que esté escrito en el documento del
 * negocio manda. Esos dos campos solo los puede escribir la plataforma (las
 * Rules los bloquean para el dueño), así que sirven para tres cosas: el Plan
 * Personalizado, dejarle a una cuenta vieja el tope que compró, y hacerle una
 * excepción a alguien sin cambiarle el plan.
 *
 * `null` = sin tope. Por eso se pregunta si la clave EXISTE y no si tiene
 * valor: `maxBarbers: null` guardado a mano significa "sin límite", no "usá el
 * del plan".
 */
export function limitesDelNegocio(business) {
  const plan = getPlan(business?.planId);
  const propio = (campo, porDefecto) =>
    business && Object.prototype.hasOwnProperty.call(business, campo) && business[campo] !== undefined
      ? business[campo]
      : porDefecto;

  return {
    maxBarbers: propio('maxBarbers', plan?.maxBarbers ?? null),
    maxSucursales: propio('maxSucursales', plan?.maxSucursales ?? 1),
  };
}

/** ¿Este negocio puede tener más de una sucursal? */
export function permiteSucursales(business) {
  const { maxSucursales } = limitesDelNegocio(business);
  return maxSucursales === null || maxSucursales > 1;
}

/** '$25.000' o null si el precio todavía no está definido. */
export function precioLindo(monthlyFee) {
  return typeof monthlyFee === 'number' && monthlyFee > 0
    ? `$${monthlyFee.toLocaleString('es-AR')}`
    : null;
}

/** Horario comercial por defecto. dayOfWeek: 0 = Lunes … 6 = Domingo. */
export const DEFAULT_BUSINESS_HOURS = [
  { dayOfWeek: 0, startTime: '09:00', endTime: '20:00', isActive: true },
  { dayOfWeek: 1, startTime: '09:00', endTime: '20:00', isActive: true },
  { dayOfWeek: 2, startTime: '09:00', endTime: '20:00', isActive: true },
  { dayOfWeek: 3, startTime: '09:00', endTime: '20:00', isActive: true },
  { dayOfWeek: 4, startTime: '09:00', endTime: '20:00', isActive: true },
  { dayOfWeek: 5, startTime: '09:00', endTime: '18:00', isActive: true },
  { dayOfWeek: 6, startTime: '', endTime: '', isActive: false },
];
