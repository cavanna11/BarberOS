// ============================================
// Planes comerciales de BarberOS
// ============================================
// Fuente única de verdad. El alta de barbería, el cambio de plan, la landing y
// los topes que hace cumplir el panel leen de acá, así no se desincronizan.
//
// La escalera se ordena por CAPACIDAD y por CAPACIDADES:
//
//   maxSucursales → cuántas barberías puede tener una misma cuenta
//   maxBarbers    → cuántos barberos activos por sucursal
//   capacidades   → qué funciones tiene habilitadas (foto, colores, logo)
//
// `null` en los topes significa "sin límite".
//
// Lo que se promete acá se hace cumplir en tres lugares, y los tres tienen que
// decir lo mismo:
//
//   1. esta configuración  → lo que muestra la interfaz
//   2. firestore.rules     → lo que la base acepta (lee `capacidades` del
//                            documento del negocio, que solo escribe la
//                            plataforma)
//   3. functions/planes.js → lo que validan las Cloud Functions (sucursales y
//                            barberos, que son operaciones de servidor)
//
// Esconder un botón no alcanza: con la consola abierta se saltea. Por eso los
// topes y las capacidades se ESCRIBEN en el documento del negocio al dar de
// alta o al cambiar de plan, y las Rules los verifican ahí.

/** Lo que incluye cualquier plan. Se muestra una vez, debajo de las tarjetas. */
export const FEATURES_COMUNES = [
  'Turnos e historial sin límite',
  'Tu link público para compartir',
  'Ingresos del mes e historial por mes',
  'Reseñas de tus clientes, con estrellas y comentarios',
  'WhatsApp al cliente en un toque, desde tu propio número',
  'Servicios sin turno en vivo (walk-in)',
  'Seña por Mercado Pago, directo a tu cuenta',
  'Cada barbero ve solo su agenda',
  'App para el celular con avisos al instante',
];

/**
 * Las funciones que se habilitan por plan.
 *
 * Son pocas y concretas a propósito: es lo único que de verdad se puede
 * restringir hoy sin romper el producto. Prometer una diferencia que el código
 * no hace cumplir es peor que no prometerla.
 */
export const CAPACIDADES = {
  /** Foto de perfil de cada barbero en la página de reservas. */
  fotoPerfil: 'fotoPerfil',
  /** Colores propios de la marca en la página de reservas y el panel. */
  colores: 'colores',
  /** Logo propio arriba del link público. */
  logo: 'logo',
  /** Su propia página de presentación antes de la reserva. */
  pagina: 'pagina',
  /** La plantilla con imagen de fondo a pantalla completa. */
  paginaFoto: 'paginaFoto',
};

const SIN_CAPACIDADES = { fotoPerfil: false, colores: false, logo: false, pagina: false, paginaFoto: false };
const TODAS = { fotoPerfil: true, colores: true, logo: true, pagina: true, paginaFoto: true };

export const PLANS = [
  {
    id: 'basico',
    label: 'Plan Básico',
    description: 'Para el barbero que trabaja solo',
    maxSucursales: 1,
    maxBarbers: 1,
    monthlyFee: 15000,
    whatsappQuota: 100,
    capacidades: { ...SIN_CAPACIDADES },
    features: [
      'Configuración básica de la barbería',
      'Todo lo que viene incluido en cualquier plan',
    ],
  },
  {
    id: 'intermedio',
    label: 'Plan Intermedio',
    description: 'Para la barbería con equipo chico',
    maxSucursales: 1,
    maxBarbers: 3,
    monthlyFee: 20000,
    whatsappQuota: 500,
    // La página SÍ, pero sin logo ni colores propios: esos siguen en el Full.
    // Donde iría el logo van las iniciales de la barbería, que es lo que hace
    // que no se vea como un hueco.
    capacidades: { ...SIN_CAPACIDADES, fotoPerfil: true, pagina: true },
    features: [
      'Foto de perfil de cada barbero',
      'Tu página de presentación antes de la reserva',
      'Configuración básica de la barbería',
    ],
  },
  {
    id: 'full',
    label: 'Plan Full',
    description: 'Una barbería, sin límite de equipo',
    maxSucursales: 1,
    maxBarbers: null,
    monthlyFee: 30000,
    whatsappQuota: 2000,
    destacado: true,
    capacidades: { ...TODAS },
    features: [
      'Foto de perfil de cada barbero',
      'Tu página con tu logo, tus colores y foto de portada',
      'Tus colores también en la reserva',
      'Soporte prioritario por WhatsApp',
    ],
  },
  {
    id: 'empresarial',
    label: 'Plan Empresarial',
    description: 'Varias sucursales, una sola cuenta',
    maxSucursales: 4,
    maxBarbers: null,
    monthlyFee: 60000,
    whatsappQuota: 2000,
    empresarial: true,
    capacidades: { ...TODAS },
    features: [
      'Una sola cuenta para administrarlas todas',
      'Cada sucursal con su equipo, servicios y horarios',
      // Dicho explícitamente: sin esta línea, la tarjeta del Empresarial lista
      // menos funciones que la del Full y se lee como si perdiera algo.
      'Todo lo del Plan Full, en cada sucursal',
      'Una página propia por sucursal, con su marca',
      'Números de cada sucursal y de todas juntas',
      'Soporte prioritario por WhatsApp',
    ],
  },
  {
    id: 'personalizado',
    label: 'Plan Personalizado',
    description: 'Para lo que no entra en los planes de arriba',
    // Sin topes de lista: se acuerdan uno por uno y la plataforma los carga en
    // el documento del negocio, que es lo que manda.
    maxSucursales: null,
    maxBarbers: null,
    monthlyFee: null,
    whatsappQuota: null,
    aMedida: true,
    capacidades: { ...TODAS },
    features: [
      'Sucursales según tu necesidad',
      'Barberos según tu necesidad',
      'Diseño propio',
      'Configuraciones especiales',
      'Funcionalidades a medida',
      'Precio a negociar',
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
 * Llevan todas las capacidades: compraron "todo incluido" y sacarles la foto
 * del barbero que ya tienen cargada sería cambiarles el trato sin avisar.
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
    capacidades: { ...TODAS },
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
    capacidades: { ...TODAS },
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
 * negocio manda. Esos campos solo los puede escribir la plataforma (las Rules
 * los bloquean para el dueño), así que sirven para tres cosas: el Plan
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

/**
 * Qué funciones tiene habilitadas este negocio.
 *
 * Mismo criterio que los topes: manda lo que esté escrito en el documento
 * (`capacidades`), y el plan es el valor por defecto.
 *
 * Una cuenta vieja todavía no tiene el campo escrito. En ese caso vale lo que
 * diga su plan, y los planes viejos las tienen todas: nadie pierde de un día
 * para el otro la foto que ya tenía cargada. Las cuentas nuevas y las que
 * cambien de plan nacen con el campo puesto, que es lo que miran las Rules.
 */
export function capacidadesDelNegocio(business) {
  const plan = getPlan(business?.planId);
  const delPlan = plan?.capacidades || TODAS;
  const propias = business?.capacidades;
  if (!propias || typeof propias !== 'object') return { ...delPlan };
  return { ...delPlan, ...propias };
}

/** Atajo: ¿este negocio tiene habilitada esta función? */
export function puede(business, capacidad) {
  return capacidadesDelNegocio(business)[capacidad] === true;
}

/** ¿Este negocio puede tener más de una sucursal? */
export function permiteSucursales(business) {
  const { maxSucursales } = limitesDelNegocio(business);
  return maxSucursales === null || maxSucursales > 1;
}

/** '$30.000' o null si el precio todavía no está definido. */
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
