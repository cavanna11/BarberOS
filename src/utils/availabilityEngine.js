// ============================================
// Motor de Disponibilidad
// ============================================
import { timeToMinutes, addMinutes, getLocalDayOfWeek, isToday } from './dateUtils';

/**
 * Calcula los slots disponibles para un profesional+servicio en una fecha.
 */
export function calculateAvailableSlots({
  professionalId,
  serviceId,
  date, // 'YYYY-MM-DD'
  schedules,
  appointments,
  services,
  professionalServices,
  slotInterval = 30,
  businessHours, // <-- Added parameter
}) {
  const dateObj = new Date(date + 'T00:00:00');
  const dayOfWeek = getLocalDayOfWeek(dateObj);

  // 1. Validar horario de la barbería para este día
  let businessStart = null;
  let businessEnd = null;
  if (businessHours) {
    const bizDay = businessHours.find((b) => b.dayOfWeek === dayOfWeek);
    if (!bizDay || !bizDay.isActive) {
      return []; // La barbería está cerrada este día
    }
    if (bizDay.startTime && bizDay.endTime) {
      businessStart = timeToMinutes(bizDay.startTime);
      businessEnd = timeToMinutes(bizDay.endTime);
    }
  }

  // 2. Obtener el horario del profesional para este día
  const schedule = schedules.find(
    (s) => s.professionalId === professionalId && s.dayOfWeek === dayOfWeek && s.isActive
  );

  if (!schedule || !schedule.startTime || !schedule.endTime) {
    return [];
  }

  // 3. Obtener la duración del servicio
  const ps = professionalServices.find(
    (ps) => ps.professionalId === professionalId && ps.serviceId === serviceId
  );
  const service = services.find((s) => s.id === serviceId);
  if (!service) return [];

  const duration = (ps && ps.customDuration) || service.durationMinutes;

  // 4. Generar todos los slots posibles
  const allSlots = [];
  let scheduleStart = timeToMinutes(schedule.startTime);
  let scheduleEnd = timeToMinutes(schedule.endTime);

  // Intersectar con el horario comercial si está configurado
  if (businessStart !== null && businessEnd !== null) {
    scheduleStart = Math.max(scheduleStart, businessStart);
    scheduleEnd = Math.min(scheduleEnd, businessEnd);
  }

  if (scheduleStart + duration > scheduleEnd) {
    return []; // No hay tiempo suficiente dentro del horario cruzado
  }

  const breakStart = schedule.breakStart ? timeToMinutes(schedule.breakStart) : null;
  const breakEnd = schedule.breakEnd ? timeToMinutes(schedule.breakEnd) : null;

  for (let cursor = scheduleStart; cursor + duration <= scheduleEnd; cursor += slotInterval) {
    const slotEnd = cursor + duration;

    // Verificar si toca el descanso
    if (breakStart !== null && breakEnd !== null) {
      if (cursor < breakEnd && slotEnd > breakStart) {
        continue; // El slot se solapa con el descanso
      }
    }

    allSlots.push({
      startTime: minutesToTime(cursor),
      endTime: minutesToTime(slotEnd),
      startMinutes: cursor,
      endMinutes: slotEnd,
    });
  }

  // 5. Obtener citas existentes que bloquean
  const existingAppointments = appointments.filter(
    (a) =>
      a.professionalId === professionalId &&
      a.appointmentDate === date &&
      (a.status === 'pendiente' || a.status === 'confirmada')
  );

  // 6. Filtrar slots ocupados
  const availableSlots = allSlots.filter((slot) => {
    for (const apt of existingAppointments) {
      const aptStart = timeToMinutes(apt.startTime);
      const aptEnd = timeToMinutes(apt.endTime);
      if (slot.startMinutes < aptEnd && slot.endMinutes > aptStart) {
        return false; // Colisión
      }
    }
    return true;
  });

  // 7. Si es hoy, filtrar slots con menos de 10 minutos de antelación
  if (isToday(date)) {
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    // Se necesitan al menos 10 minutos de antelación para reservar
    return availableSlots.filter((slot) => slot.startMinutes >= nowMinutes + 10);
  }

  return availableSlots;
}

function minutesToTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Verifica si un profesional trabaja en una fecha dada y si la barbería está abierta.
 */
export function professionalWorksOnDate(professionalId, date, schedules, businessHours) {
  const dateObj = new Date(date + 'T00:00:00');
  const dayOfWeek = getLocalDayOfWeek(dateObj);

  // Validar si la barbería está abierta este día
  if (businessHours) {
    const bizDay = businessHours.find((b) => b.dayOfWeek === dayOfWeek);
    if (!bizDay || !bizDay.isActive) {
      return false; // La barbería está cerrada
    }
  }

  return schedules.some(
    (s) => s.professionalId === professionalId && s.dayOfWeek === dayOfWeek && s.isActive
  );
}
