// ============================================
// Calculador de Estadísticas para Dashboard
// ============================================

export function calculateStats(appointments, professionals, services) {
  const total = appointments.length;
  const completadas = appointments.filter((a) => a.status === 'completada').length;
  const pendientes = appointments.filter((a) => a.status === 'pendiente').length;
  const canceladas = appointments.filter((a) => a.status === 'cancelada').length;
  const noAsistio = appointments.filter((a) => a.status === 'no_asistio').length;

  const completedAppointments = appointments.filter((a) => a.status === 'completada');
  const ingresosTotales = completedAppointments.reduce((sum, a) => sum + a.price, 0);

  // Ingresos por profesional
  const ingresosPorProfesional = professionals.map((prof) => {
    const profAppointments = completedAppointments.filter((a) => a.professionalId === prof.id);
    return {
      id: prof.id,
      name: prof.name,
      total: profAppointments.reduce((sum, a) => sum + a.price, 0),
      count: profAppointments.length,
    };
  }).sort((a, b) => b.total - a.total);

  // Ingresos por servicio
  const ingresosPorServicio = services.map((srv) => {
    const srvAppointments = completedAppointments.filter((a) => a.serviceId === srv.id);
    return {
      id: srv.id,
      name: srv.name,
      total: srvAppointments.reduce((sum, a) => sum + a.price, 0),
      count: srvAppointments.length,
    };
  }).sort((a, b) => b.total - a.total);

  return {
    total,
    completadas,
    pendientes,
    canceladas,
    noAsistio,
    ingresosTotales,
    tasaNoAsistencia: total > 0 ? ((noAsistio / total) * 100).toFixed(1) : '0.0',
    tasaCancelacion: total > 0 ? ((canceladas / total) * 100).toFixed(1) : '0.0',
    ingresosPorProfesional,
    ingresosPorServicio,
  };
}
