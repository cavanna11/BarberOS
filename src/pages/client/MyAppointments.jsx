import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../hooks/useTenantData';
import { cancelAppointment } from '../../lib/repository';
import { formatDate, formatPrice } from '../../utils/dateUtils';

const STATUS_LABELS = {
  pendiente: { label: 'Pendiente', className: 'badge-warning' },
  confirmada: { label: 'Confirmada', className: 'badge-success' },
  completada: { label: 'Completada', className: 'badge-success' },
  cancelada: { label: 'Cancelada', className: 'badge-danger' },
  no_asistio: { label: 'No Asistió', className: 'badge-danger' },
};

export default function MyAppointments() {
  const { user, isAuthenticated } = useAuth();
  // Solo las citas del negocio por el que entró el cliente.
  const { appointments, professionals, services, business, slug, businessId } = useTenant();
  const [tab, setTab] = useState('upcoming');
  const today = new Date().toISOString().split('T')[0];

  if (!isAuthenticated) {
    return (
      <div className="my-appointments">
        <div className="empty-state">
          <div className="empty-state-icon">🔒</div>
          <p>Necesitás iniciar sesión para ver tus citas</p>
          <Link to="/login" className="btn btn-primary mt-lg">Iniciar Sesión</Link>
        </div>
      </div>
    );
  }

  const myAppointments = appointments
    .filter(a => a.userId === user.id)
    .sort((a, b) => {
      const dateA = a.appointmentDate + 'T' + a.startTime;
      const dateB = b.appointmentDate + 'T' + b.startTime;
      return dateA > dateB ? -1 : 1;
    });

  const upcoming = myAppointments.filter(a =>
    a.appointmentDate >= today && (a.status === 'pendiente' || a.status === 'confirmada')
  );
  const past = myAppointments.filter(a =>
    a.appointmentDate < today || a.status === 'completada' || a.status === 'cancelada' || a.status === 'no_asistio'
  );

  const displayed = tab === 'upcoming' ? upcoming : past;

  const handleCancel = (id) => {
    if (window.confirm('¿Estás seguro de que querés cancelar esta cita?')) {
      cancelAppointment(businessId, id).catch((err) => {
        console.error('[MyAppointments] No se pudo cancelar:', err);
        alert('No se pudo cancelar el turno: ' + err.message);
      });
    }
  };

  return (
    <div className="my-appointments">
      <h1>Mis Citas</h1>
      <div className="tabs mt-md">
        <button className={`tab ${tab === 'upcoming' ? 'active' : ''}`} onClick={() => setTab('upcoming')}>
          Próximas ({upcoming.length})
        </button>
        <button className={`tab ${tab === 'past' ? 'active' : ''}`} onClick={() => setTab('past')}>
          Pasadas ({past.length})
        </button>
      </div>

      {displayed.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">{tab === 'upcoming' ? '📅' : '📋'}</div>
          <p>{tab === 'upcoming' ? 'No tenés citas próximas' : 'No tenés citas pasadas'}</p>
          {tab === 'upcoming' && <Link to={`/${slug}`} className="btn btn-primary mt-lg">Reservar una cita</Link>}
        </div>
      ) : (
        displayed.map(apt => {
          const prof = professionals.find(p => p.id === apt.professionalId);
          const srv = services.find(s => s.id === apt.serviceId);
          const statusInfo = STATUS_LABELS[apt.status];
          return (
            <div key={apt.id} className="card appointment-card">
              <div className="appointment-info">
                <h3>{srv?.name} con {prof?.name}</h3>
                <div className="details">
                  <span>📅 {formatDate(apt.appointmentDate)}</span>
                  <span>🕐 {apt.startTime}</span>
                </div>
                <div className="details mt-sm">
                  <span>{formatPrice(apt.price, business?.currency)}</span>
                </div>
              </div>
              <div className="appointment-actions">
                <span className={`badge ${statusInfo.className}`}>{statusInfo.label}</span>
                {(apt.status === 'pendiente' || apt.status === 'confirmada') && apt.appointmentDate >= today && (
                  <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => handleCancel(apt.id)}>
                    Cancelar
                  </button>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
