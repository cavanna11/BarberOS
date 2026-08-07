import { useLocation, Link } from 'react-router-dom';
import { useTenant } from '../../hooks/useTenantData';
import { formatDate, formatPrice } from '../../utils/dateUtils';

export default function ConfirmationPage() {
  const location = useLocation();
  const { professionals, services, business, slug } = useTenant();
  const appointment = location.state?.appointment;
  const home = `/${slug}`;

  if (!appointment) {
    return (
      <div className="confirmation-container">
        <div className="empty-state">
          <div className="empty-state-icon">🤔</div>
          <p>No se encontró información de la reserva</p>
          <Link to={home} className="btn btn-primary mt-lg">Reservar una cita</Link>
        </div>
      </div>
    );
  }

  const professional = professionals.find(p => p.id === appointment.professionalId);
  const service = services.find(s => s.id === appointment.serviceId);

  return (
    <div className="confirmation-container">
      <div className="confirmation-icon">✓</div>
      <h1>¡Reserva Confirmada!</h1>
      <p className="text-secondary mt-sm mb-lg">Tu cita fue agendada exitosamente</p>

      <div className="summary-card" style={{ textAlign: 'left' }}>
        <div className="summary-body">
          <div className="summary-row">
            <span className="summary-label">👤 Profesional</span>
            <span className="summary-value">{professional?.name}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">✂️ Servicio</span>
            <span className="summary-value">{service?.name}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">📅 Fecha</span>
            <span className="summary-value">{formatDate(appointment.appointmentDate)}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">🕐 Horario</span>
            <span className="summary-value">{appointment.startTime} — {appointment.endTime}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">💰 Precio</span>
            <span className="summary-value">{formatPrice(appointment.price, business?.currency)}</span>
          </div>
        </div>
      </div>

      <div className="confirmation-actions">
        <Link to={`${home}/mis-citas`} className="btn btn-primary">📅 Ver Mis Citas</Link>
        <Link to={home} className="btn btn-outline">Reservar Otra Cita</Link>
      </div>

      <div className="future-feature mt-lg" style={{ justifyContent: 'center' }}>
        📱 Próximamente: confirmación por WhatsApp
      </div>
    </div>
  );
}
