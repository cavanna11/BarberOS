// ============================================
// Planes comerciales de BarberOS
// ============================================
// Fuente única de verdad. Antes las cuotas y los precios estaban hardcodeados
// dentro del panel de super-admin; ahora el alta de barbería y el cambio de
// plan leen de acá, así no se desincronizan.
//
// En `features`, una entrada puede ser texto suelto o `{ texto, proximamente }`.
// Lo segundo se pinta con una etiqueta y sirve para no prometer en la landing
// lo que todavía no anda: los avisos por WhatsApp esperan la aprobación de Meta
// y la exportación de clientes no está construida. Vender eso como disponible
// es la clase de cosa que te hace perder un cliente en la primera semana.

export const PLANS = [
  {
    id: 'basico',
    label: 'Plan Básico',
    whatsappQuota: 100,
    monthlyFee: 12000,
    description: 'Ideal para barberos independientes o duplas',
    maxBarbers: 2,
    features: [
      { texto: '100 avisos por WhatsApp/mes', proximamente: true },
      'Hasta 2 barberos',
      'Turnos e historial sin límite',
      'Tu link público con tu marca',
      'Soporte estándar por WhatsApp',
    ],
  },
  {
    id: 'pro',
    label: 'Plan Pro',
    whatsappQuota: 500,
    monthlyFee: 22000,
    description: 'El más elegido para barberías en crecimiento',
    maxBarbers: 5,
    features: [
      { texto: '500 avisos por WhatsApp/mes', proximamente: true },
      'Hasta 5 barberos',
      'Turnos e historial sin límite',
      'Tu link público con tu marca',
      'Estadísticas de facturación',
      'Servicios sin turno en vivo (walk-in)',
      'Soporte prioritario por WhatsApp',
    ],
  },
  {
    id: 'business',
    label: 'Plan Business',
    whatsappQuota: 2000,
    monthlyFee: 35000,
    description: 'Para barberías grandes o múltiples sillones',
    maxBarbers: null,
    features: [
      { texto: '2000 avisos por WhatsApp/mes', proximamente: true },
      'Barberos sin límite',
      'Turnos e historial sin límite',
      'Tu link público con tu marca',
      'Estadísticas y reportes avanzados',
      'Servicios sin turno en vivo (walk-in)',
      { texto: 'Exportación de base de clientes', proximamente: true },
      'Configuración inicial asistida',
    ],
  },
];

export const DEFAULT_PLAN_ID = 'basico';

/** Costo que se le cobra al cliente por cada mensaje fuera de cuota (USD). */
export const OVERAGE_COST_USD = 0.06;

export function getPlan(planId) {
  return PLANS.find((p) => p.id === planId) || null;
}

/** Dada una cuota, devuelve el plan que la usa (o null si es personalizado). */
export function findPlanByQuota(quota) {
  return PLANS.find((p) => p.whatsappQuota === quota) || null;
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
