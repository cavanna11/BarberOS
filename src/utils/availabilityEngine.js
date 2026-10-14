// ============================================
// Motor de Disponibilidad
// ============================================
import { timeToMinutes, getLocalDayOfWeek, isToday } from './dateUtils';
import { normalizarIntervalo } from './intervalo';
import { bloqueosDelDia, faltaTodoElDia } from './ausencias';

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
  ausencias = [],
  businessHours, // <-- Added parameter
}) {
  const dateObj = new Date(date + 'T00:00:00');
  const dayOfWeek = getLocalDayOfWeek(dateObj);

  // 1. Validar horario de la barbería para este día
  let businessStart = null;
  let businessEnd = null;
  // Corte del local (horario cortado): se trata igual que el descanso del
  // profesional, un rato en el que no se ofrecen turnos.
  let corteLocal = null;
  if (businessHours) {
    const bizDay = businessHours.find((b) => b.dayOfWeek === dayOfWeek);
    if (!bizDay || !bizDay.isActive) {
      return []; // La barbería está cerrada este día
    }
    if (bizDay.startTime && bizDay.endTime) {
      businessStart = timeToMinutes(bizDay.startTime);
      businessEnd = timeToMinutes(bizDay.endTime);
    }
    if (bizDay.breakStart && bizDay.breakEnd) {
      corteLocal = [timeToMinutes(bizDay.breakStart), timeToMinutes(bizDay.breakEnd)];
    }
  }

  // 2. Obtener el horario del profesional para este día
  const schedule = schedules.find(
    (s) => s.professionalId === professionalId && s.dayOfWeek === dayOfWeek && s.isActive
  );

  if (!schedule || !schedule.startTime || !schedule.endTime) {
    return [];
  }

  // 2 bis. Las ausencias de ESTE profesional en ESTA fecha.
  //
  // Tercera excepcion al "no tocar este archivo" (las otras: el corte del local
  // y normalizarIntervalo). Hace falta aca porque el horario semanal dice lo que
  // pasa TODOS los miercoles, y esto es el miercoles que no va — apagarlo en el
  // horario apagaria todos.
  //
  // Encaja sin camino nuevo: una ausencia parcial es otro rato excluido, igual
  // que el descanso del profesional y el corte del local, y se descuenta en el
  // mismo lugar.
  const ausente = bloqueosDelDia(ausencias, professionalId, date);
  if (ausente.todoElDia) {
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

  if (scheduleStart >= scheduleEnd) {
    return []; // El horario cruzado no deja ni un minuto
  }

  const breakStart = schedule.breakStart ? timeToMinutes(schedule.breakStart) : null;
  const breakEnd = schedule.breakEnd ? timeToMinutes(schedule.breakEnd) : null;

  // Alcanza con que el turno EMPIECE dentro del horario: el barbero que
  // atiende hasta las 17:30 termina la cabeza que arrancó 17:00, no lo echa a
  // la mitad. Antes se exigía que entrara entero y el último turno del día se
  // perdía siempre (y con él, las promos de media tarde).
  // El paso NUNCA puede ser cero: este bucle avanza sumándolo, y con 0 no
  // termina nunca — se le cuelga el navegador a cada cliente que abra el link
  // de esa barbería. Dejó de ser hipotético el día que el intervalo pasó de ser
  // un desplegable de cuatro opciones a un número que escribe el barbero.
  const paso = normalizarIntervalo(slotInterval);

  for (let cursor = scheduleStart; cursor < scheduleEnd; cursor += paso) {
    const slotEnd = cursor + duration;

    // Verificar si toca el descanso
    if (breakStart !== null && breakEnd !== null) {
      if (cursor < breakEnd && slotEnd > breakStart) {
        continue; // El slot se solapa con el descanso
      }
    }
    if (corteLocal && cursor < corteLocal[1] && slotEnd > corteLocal[0]) {
      continue; // El slot cae en el corte del local
    }
    if (ausente.intervalos.some(([desde, hasta]) => cursor < hasta && slotEnd > desde)) {
      continue; // Ese rato el profesional avisó que no está
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
export function professionalWorksOnDate(professionalId, date, schedules, businessHours, ausencias = []) {
  const dateObj = new Date(date + 'T00:00:00');
  const dayOfWeek = getLocalDayOfWeek(dateObj);

  // Validar si la barbería está abierta este día
  if (businessHours) {
    const bizDay = businessHours.find((b) => b.dayOfWeek === dayOfWeek);
    if (!bizDay || !bizDay.isActive) {
      return false; // La barbería está cerrada
    }
  }

  // El dia que aviso que no viene se apaga en el calendario, y no se descubre
  // al entrar y encontrarlo vacio. Si falta solo un rato, el dia queda
  // habilitado: ese dia igual atiende, y los horarios los recorta el motor.
  if (faltaTodoElDia(ausencias, professionalId, date)) return false;

  return schedules.some(
    (s) => s.professionalId === professionalId && s.dayOfWeek === dayOfWeek && s.isActive
  );
}
