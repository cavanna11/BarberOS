import { useLocation, Link } from 'react-router-dom';
import { useTenant } from '../../hooks/useTenantData';
import { formatDate, formatPrice } from '../../utils/dateUtils';
import FichaBarberia from '../../components/client/FichaBarberia';

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
      {/* Nace 'pendiente': la barbería lo confirma. Decir "confirmada" acá y
          que el barbero lo vea como pendiente confundía a los dos. */}
      <h1>¡Turno reservado!</h1>
      <p className="text-secondary mt-sm mb-lg">Quedó agendado en la barbería. Si hay algún cambio, te van a avisar.</p>

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

      {/* Es el momento en que el cliente necesita la dirección. */}
      <div style={{ margin: 'var(--space-lg) 0', textAlign: 'left' }}>
        <FichaBarberia business={business} variant="completa" />
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
