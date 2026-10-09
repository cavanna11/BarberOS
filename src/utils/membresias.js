// ============================================================================
// Membresías: etiquetas, números y auditoría — sin Firestore
// ============================================================================
// Misma regla que `ingresos.js`: recibe arrays y no sabe de dónde salen. Lo que
// decide si un cliente tiene derecho a algo NO está acá: eso lo decide el
// servidor (functions/membresias.js). Esto es para mostrar.
//
// Ingresos: un turno cubierto por la membresía se guarda con `price: 0` (no se
// cobró nada en el local) y el valor del servicio queda en
// `turno.membresia.valorServicio`. Por eso la caja de siempre ya no lo cuenta,
// y lo que entró por membresías sale de `membresiaPagos`, que es otra caja.

import { mesDe } from './ingresos';

export const ESTADOS_MEMBRESIA = {
  pendiente: { label: 'Pendiente de pago', clase: 'badge-warning' },
  activa: { label: 'Activa', clase: 'badge-success' },
  pausada: { label: 'Pausada', clase: 'badge-warning' },
  pago_rechazado: { label: 'Pago rechazado', clase: 'badge-danger' },
  cancelada: { label: 'Cancelada', clase: 'badge-neutral' },
  vencida: { label: 'Vencida', clase: 'badge-neutral' },
  reemplazada: { label: 'Cambió de plan', clase: 'badge-neutral' },
};

export const ESTADOS_USO = {
  reservado: { label: 'Reservado', clase: 'badge-primary' },
  consumido: { label: 'Usado', clase: 'badge-success' },
  liberado: { label: 'Devuelto (cancelado)', clase: 'badge-neutral' },
  revertido: { label: 'Revertido', clase: 'badge-danger' },
};

export const ORIGENES_USO = {
  reserva: 'Lo eligió el cliente',
  dueno: 'Lo aplicó el dueño',
};

/** Un uso que cuenta contra el cupo del mes. */
export const usoVivo = (u) => u?.estado === 'reservado' || u?.estado === 'consumido';

/** ¿El turno está cubierto por una membresía (y no se revirtió)? */
export function turnoConMembresia(turno) {
  const m = turno?.membresia;
  return Boolean(m) && m.estado !== 'revertido' && m.estado !== 'liberado';
}

/** '2026-10-05' → '05/10'. */
export function fechaCorta(fecha) {
  if (typeof fecha !== 'string' || fecha.length < 10) return '';
  const [, m, d] = fecha.split('-');
  return `${d}/${m}`;
}

/** '2026-10-05' → '05/10/2026'. */
export function fechaLarga(fecha) {
  if (typeof fecha !== 'string' || fecha.length < 10) return '';
  return fecha.split('-').reverse().join('/');
}

/**
 * Para la reserva: ¿la membresía del cliente cubre este servicio en esta
 * sucursal y en esta fecha? Devuelve null si no, o
 * `{ beneficio, restantes }` (`restantes` null = ilimitado o desconocido).
 *
 * Es una VISTA PREVIA: si el cliente la marca, el servidor vuelve a mirar todo.
 */
export function coberturaDelServicio(membresia, { businessId, serviceId, fecha = null }) {
  if (!membresia?.usable || !membresia.periodo) return null;
  const p = membresia.periodo;
  const beneficio = (p.beneficios || []).find((b) => (b.servicios || [])
    .some((s) => s.businessId === businessId && s.serviceId === serviceId));
  if (!beneficio) return null;

  if (fecha) {
    const cubierta = (membresia.periodosPagos || []).some((x) => x.desde <= fecha && fecha <= x.hasta);
    if (!cubierta) return { beneficio, restantes: null, fueraDeFecha: true };
  }
  // Los contadores que conocemos son los del mes de HOY. Para un turno de un
  // mes ya renovado, el cupo es otro: no se inventa un número.
  const enEsteMes = !fecha || (p.desde <= fecha && fecha <= p.hasta);
  if (!enEsteMes) return { beneficio, restantes: null };

  const porBeneficio = beneficio.usos == null ? Infinity : beneficio.usos - (beneficio.usados || 0);
  const porTope = p.usosTotales == null ? Infinity : p.usosTotales - (p.usados || 0);
  const restantes = Math.min(porBeneficio, porTope);
  return { beneficio, restantes: Number.isFinite(restantes) ? Math.max(0, restantes) : null };
}

// ── Panel del dueño ────────────────────────────────────────────────────────

/** Resumen de la cartera: activas, ingreso recurrente, altas y bajas del mes. */
export function resumenDeMembresias(membresias = [], mes) {
  const activas = membresias.filter((m) => ['activa', 'pausada', 'pago_rechazado'].includes(m.estado));
  const recurrente = activas
    .filter((m) => m.estado === 'activa')
    .reduce((s, m) => s + (Number(m.mp?.monto ?? m.plan?.precioMensual) || 0), 0);
  const delMes = (f) => mesDe(f) === mes;
  const altas = membresias.filter((m) => delMes(m.inicio || m.periodoActual?.desde) && m.estado !== 'reemplazada' && !m.reemplazaA).length;
  const bajas = membresias.filter((m) => (m.historial || []).some((h) => ['cancelada', 'vencida'].includes(h.estado)
    && delMes(fechaDeHistorial(h.en)))).length;
  const porPlan = new Map();
  for (const m of activas) {
    const k = m.plan?.nombre || 'Sin plan';
    porPlan.set(k, (porPlan.get(k) || 0) + 1);
  }
  return {
    activas: activas.length,
    recurrente,
    altas,
    bajas,
    porPlan: [...porPlan.entries()].map(([nombre, cantidad]) => ({ nombre, cantidad })).sort((a, b) => b.cantidad - a.cantidad),
  };
}

/** Las fechas del historial llegan como Timestamp de Firestore o como Date. */
function fechaDeHistorial(en) {
  const d = en?.toDate ? en.toDate() : (en instanceof Date ? en : null);
  if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Plata que entró por membresías en un mes (sin las cuotas devueltas). */
export function cobradoPorMembresias(pagos = [], mes) {
  let total = 0, count = 0;
  for (const p of pagos) {
    if (p.revertido || mesDe(p.fecha) !== mes) continue;
    total += Number(p.monto) || 0;
    count++;
  }
  return { total, count };
}

/**
 * Valor de lista de lo que se consumió con membresías en un mes: "cobré
 * $200.000 en membresías y se consumieron $250.000 en servicios".
 * Cuenta los usos vivos (reservados o usados) cuyo turno cae en ese mes.
 */
export function consumidoPorMembresias(usos = [], mes) {
  let total = 0, count = 0;
  for (const u of usos) {
    if (!usoVivo(u) || mesDe(u.appointmentDate) !== mes) continue;
    total += Number(u.valorServicio) || 0;
    count++;
  }
  return { total, count };
}

/**
 * Usos agrupados por una clave, para la auditoría: por barbero, por sucursal,
 * por servicio. Ordenado de más a menos: lo raro salta arriba.
 * `nombres`: { [clave]: 'Nombre legible' }.
 */
export function usosAgrupados(usos = [], campo, nombres = {}) {
  const grupos = new Map();
  for (const u of usos) {
    if (!usoVivo(u)) continue;
    const k = u[campo] || '—';
    const g = grupos.get(k) || { clave: k, nombre: nombres[k] || u.serviceName || k, cantidad: 0, valor: 0, porDueno: 0 };
    g.cantidad++;
    g.valor += Number(u.valorServicio) || 0;
    if (u.origen === 'dueno') g.porDueno++;
    grupos.set(k, g);
  }
  return [...grupos.values()].sort((a, b) => b.cantidad - a.cantidad);
}

/** Filtra usos por mes ('YYYY-MM' o 'todos'), barbero, sucursal, origen y estado. */
export function filtrarUsos(usos = [], { mes = 'todos', professionalId = '', sucursalId = '', origen = '', estado = '', revision = false } = {}) {
  return usos.filter((u) => (mes === 'todos' || mesDe(u.appointmentDate) === mes)
    && (!professionalId || u.professionalId === professionalId)
    && (!sucursalId || u.sucursalId === sucursalId)
    && (!origen || u.origen === origen)
    && (!estado || u.estado === estado)
    && (!revision || Boolean(u.requiereRevision)))
    .sort((a, b) => String(b.appointmentDate).localeCompare(String(a.appointmentDate)));
}

/**
 * Lo que la agenda atendió con membresía en un mes (turnos completados o
 * ausentes cubiertos por el plan), a precio de lista. Sale de los turnos, así
 * que sirve en el dashboard sin leer la auditoría.
 */
export function cubiertoPorMembresiasEnTurnos(appointments = [], mes) {
  let total = 0, count = 0;
  for (const a of appointments) {
    if (!turnoConMembresia(a) || !['completada', 'no_asistio'].includes(a.status)) continue;
    if (mesDe(a.appointmentDate) !== mes) continue;
    total += Number(a.membresia.valorServicio) || 0;
    count++;
  }
  return { total, count };
}
