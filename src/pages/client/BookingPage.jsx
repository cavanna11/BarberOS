import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBooking } from '../../contexts/BookingContext';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../hooks/useTenantData';
import { createAppointment } from '../../lib/functions';
import { calculateAvailableSlots, professionalWorksOnDate } from '../../utils/availabilityEngine';
import { formatDate, formatPrice, toDateString, getMonthName } from '../../utils/dateUtils';

// ---- STEPPER ----
function Stepper({ step }) {
  const labels = ['Profesional', 'Servicio', 'Fecha', 'Horario', 'Datos', 'Confirmar'];
  return (
    <div className="stepper">
      {labels.map((label, idx) => {
        const num = idx + 1;
        const completed = num < step;
        const active = num === step;
        return (
          <div key={num} className="stepper-step">
            {idx > 0 && <div className={`stepper-line ${completed ? 'completed' : ''}`} />}
            <div>
              <div className={`stepper-circle ${active ? 'active' : ''} ${completed ? 'completed' : ''}`}>
                {completed ? '✓' : num}
              </div>
              <div className={`stepper-label ${active ? 'active' : ''}`}>{label}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---- PROFESSIONAL SELECT ----
function ProfessionalSelect({ professionals, selectedId, onSelect }) {
  return (
    <div>
      <h2 className="booking-step-title">Seleccioná tu profesional</h2>
      <p className="booking-step-subtitle">Elegí con quién querés atenderte</p>
      <div className="professionals-grid">
        {professionals.filter(p => p.isActive).map((prof) => (
          <div
            key={prof.id}
            className={`card card-selectable professional-card ${selectedId === prof.id ? 'card-selected' : ''}`}
            onClick={() => onSelect(prof.id)}
          >
            <div className="avatar avatar-lg">
              {prof.avatarUrl ? <img src={prof.avatarUrl} alt={prof.name} /> : prof.name.split(' ').map(n => n[0]).join('')}
            </div>
            <h3>{prof.name}</h3>
            <p className="specialty">{prof.specialty}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- SERVICE SELECT ----
function ServiceSelect({ services, professionalServices, professionalId, selectedId, onSelect, currency }) {
  const available = useMemo(() => {
    const psIds = professionalServices
      .filter(ps => ps.professionalId === professionalId)
      .map(ps => ps.serviceId);
    return services.filter(s => s.isActive && psIds.includes(s.id)).map(s => {
      const ps = professionalServices.find(p => p.professionalId === professionalId && p.serviceId === s.id);
      return { ...s, finalPrice: ps?.customPrice || s.price, finalDuration: ps?.customDuration || s.durationMinutes };
    });
  }, [services, professionalServices, professionalId]);

  return (
    <div>
      <h2 className="booking-step-title">Elegí un servicio</h2>
      <p className="booking-step-subtitle">Servicios disponibles</p>
      <div className="services-list">
        {available.map((service) => (
          <div
            key={service.id}
            className={`card card-selectable service-card ${selectedId === service.id ? 'card-selected' : ''}`}
            onClick={() => onSelect(service.id)}
          >
            <div className="service-info">
              <h3>{service.name}</h3>
              <p>{service.description}</p>
            </div>
            <div className="service-meta">
              <div className="service-price">{formatPrice(service.finalPrice, currency)}</div>
              <div className="service-duration">⏱ {service.finalDuration} min</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- DATE PICKER ----
function DatePicker({ selectedDate, onSelect, professionalId, schedules: allSchedules, businessHours }) {
  const [viewDate, setViewDate] = useState(() => {
    if (selectedDate) return new Date(selectedDate + 'T00:00:00');
    return new Date();
  });

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
  const today = toDateString(new Date());

  const days = [];
  for (let i = 0; i < startOffset; i++) days.push(null);
  for (let d = 1; d <= lastDay.getDate(); d++) days.push(d);

  const prevMonth = () => setViewDate(new Date(year, month - 1, 1));
  const nextMonth = () => setViewDate(new Date(year, month + 1, 1));

  return (
    <div>
      <h2 className="booking-step-title">Elegí una fecha</h2>
      <p className="booking-step-subtitle">Seleccioná el día de tu cita</p>
      <div className="calendar">
        <div className="calendar-header">
          <button className="calendar-nav" onClick={prevMonth}>◀</button>
          <h3>{getMonthName(month)} {year}</h3>
          <button className="calendar-nav" onClick={nextMonth}>▶</button>
        </div>
        <div className="calendar-grid">
          {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(d => (
            <div key={d} className="calendar-day-header">{d}</div>
          ))}
          {days.map((day, idx) => {
            if (day === null) return <div key={`empty-${idx}`} className="calendar-day empty" />;
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const isPastDate = dateStr < today;
            const works = professionalWorksOnDate(professionalId, dateStr, allSchedules, businessHours);
            const isSelected = dateStr === selectedDate;
            const isToday = dateStr === today;

            return (
              <button
                key={dateStr}
                className={`calendar-day ${isSelected ? 'selected' : ''} ${isToday ? 'today' : ''}`}
                disabled={isPastDate || !works}
                onClick={() => onSelect(dateStr)}
              >
                {day}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---- TIME SLOT GRID ----
function TimeSlotGrid({ slots, selectedSlot, onSelect, date }) {
  const morning = slots.filter(s => parseInt(s.startTime.split(':')[0]) < 13);
  const afternoon = slots.filter(s => parseInt(s.startTime.split(':')[0]) >= 13);

  if (slots.length === 0) {
    return (
      <div>
        <h2 className="booking-step-title">Horarios disponibles</h2>
        <p className="booking-step-subtitle">{formatDate(date)}</p>
        <div className="empty-state">
          <div className="empty-state-icon">📅</div>
          <p>No hay horarios disponibles para este día</p>
          <p className="text-sm text-muted mt-sm">Probá seleccionando otra fecha</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="booking-step-title">Elegí un horario</h2>
      <p className="booking-step-subtitle">{formatDate(date)}</p>
      <div className="timeslots-container">
        {morning.length > 0 && (
          <div className="timeslots-section">
            <h3>Mañana</h3>
            <div className="timeslots-grid">
              {morning.map(slot => (
                <button
                  key={slot.startTime}
                  className={`timeslot ${selectedSlot?.startTime === slot.startTime ? 'selected' : ''}`}
                  onClick={() => onSelect(slot)}
                >
                  {slot.startTime}
                </button>
              ))}
            </div>
          </div>
        )}
        {afternoon.length > 0 && (
          <div className="timeslots-section">
            <h3>Tarde</h3>
            <div className="timeslots-grid">
              {afternoon.map(slot => (
                <button
                  key={slot.startTime}
                  className={`timeslot ${selectedSlot?.startTime === slot.startTime ? 'selected' : ''}`}
                  onClick={() => onSelect(slot)}
                >
                  {slot.startTime}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- PERSONAL INFO (solo teléfono — nombre y email vienen de Google) ----
function PersonalInfoStep({ user, phone, onPhoneChange }) {
  return (
    <div>
      <h2 className="booking-step-title">Tu número de teléfono</h2>
      <p className="booking-step-subtitle">Solo necesitamos tu móvil para confirmar la reserva</p>

      <div className="card" style={{ marginBottom: 'var(--space-lg)', display: 'flex', alignItems: 'center', gap: 'var(--space-md)', padding: 'var(--space-md)' }}>
        {user.avatarUrl
          ? <img src={user.avatarUrl} alt={user.name} style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover' }} />
          : <div className="avatar avatar-md">{user.name.split(' ').map(n => n[0]).join('')}</div>
        }
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600 }}>{user.name}</div>
          <div className="text-sm text-secondary">{user.email}</div>
        </div>
        <span className="badge badge-success">✓ Google</span>
      </div>

      <div className="personal-form">
        <div className="form-group">
          <label className="form-label">Teléfono móvil <span className="required">*</span></label>
          <input
            className="form-input"
            type="tel"
            value={phone}
            onChange={e => onPhoneChange(e.target.value)}
            placeholder="+54 11 1234-5678"
            autoFocus
          />
        </div>
      </div>
    </div>
  );
}

// ---- SUMMARY ----
function BookingSummary({ professional, service, date, timeSlot, price, currency, clientName, clientPhone }) {
  return (
    <div>
      <h2 className="booking-step-title">Confirmar tu reserva</h2>
      <p className="booking-step-subtitle">Revisá los datos antes de confirmar</p>
      <div className="booking-summary">
        <div className="summary-card">
          <div className="summary-header">
            <div className="avatar avatar-lg" style={{ margin: '0 auto var(--space-sm)' }}>
              {professional.name.split(' ').map(n => n[0]).join('')}
            </div>
            <h3>{professional.name}</h3>
            <p className="text-sm" style={{ opacity: 0.8 }}>{professional.specialty}</p>
          </div>
          <div className="summary-body">
            <div className="summary-row">
              <span className="summary-label">✂️ Servicio</span>
              <span className="summary-value">{service.name}</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">📅 Fecha</span>
              <span className="summary-value">{formatDate(date)}</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">🕐 Horario</span>
              <span className="summary-value">{timeSlot.startTime} — {timeSlot.endTime}</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">⏱ Duración</span>
              <span className="summary-value">{service.finalDuration || service.durationMinutes} min</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">💰 Total</span>
              <span className="summary-value">{formatPrice(price, currency)}</span>
            </div>
            <div className="summary-row" style={{ borderTop: '1px solid var(--border-color)', marginTop: 'var(--space-sm)', paddingTop: 'var(--space-sm)' }}>
              <span className="summary-label">👤 Cliente</span>
              <span className="summary-value">{clientName}</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">📱 Teléfono</span>
              <span className="summary-value">{clientPhone}</span>
            </div>
          </div>
          <div className="summary-footer">
            <div className="future-feature">
              🔒 Próximamente: pago con Mercado Pago
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- AVISO: el negocio no puede tomar turnos ----
// 'frozen'    → cuenta suspendida por falta de pago
// 'not-ready' → cuenta nueva, todavía sin profesionales o sin servicios
function BookingUnavailable({ reason, business }) {
  const isFrozen = reason === 'frozen';
  return (
    <div className="booking-container" style={{ textAlign: 'center', padding: 'var(--space-xl) var(--space-md)' }}>
      <div
        className="card"
        style={{
          padding: 'var(--space-xl)',
          maxWidth: 500,
          margin: '0 auto',
          borderTop: isFrozen ? '4px solid var(--danger)' : '4px solid var(--primary)',
        }}
      >
        <div style={{ fontSize: 60, marginBottom: 'var(--space-md)' }}>{isFrozen ? '❄️' : '🛠️'}</div>
        <h2 style={{ marginBottom: 'var(--space-md)', color: isFrozen ? 'var(--danger)' : 'inherit' }}>
          {isFrozen ? 'Reservas suspendidas' : 'Todavía no hay turnos disponibles'}
        </h2>
        <p className="text-secondary" style={{ marginBottom: 'var(--space-lg)', lineHeight: 1.5 }}>
          {isFrozen
            ? <>Las reservas online de <strong>{business.name}</strong> están temporalmente suspendidas.</>
            : <><strong>{business.name}</strong> está terminando de configurar su agenda online. Volvé a entrar en un rato.</>}
        </p>
        {business.phone && (
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Si necesitás un turno ahora, escribiles al <strong>{business.phone}</strong>.
          </p>
        )}
      </div>
    </div>
  );
}

// ============================================
// BOOKING PAGE (Main Component)
// ============================================

export default function BookingPage() {
  const { booking, dispatch } = useBooking();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [reservando, setReservando] = useState(false);

  // Datos ya filtrados por el negocio del slug de la URL.
  const { professionals, services, professionalServices, schedules, appointments, business, slug, businessId } =
    useTenant();
  const { step, professionalId, serviceId, date, timeSlot, personalInfo } = booking;

  // Motivos por los que este negocio no puede tomar turnos ahora mismo.
  // Se calcula acá pero se renderiza recién después de todos los hooks: cortar
  // el render antes rompe las reglas de hooks si el motivo cambia en vivo.
  const blockedReason = business?.isFrozen
    ? 'frozen'
    : (professionals.length === 0 || services.length === 0)
      ? 'not-ready'
      : null;

  // Check if user already has an appointment on this day
  const hasAppointmentToday = useMemo(() => {
    if (!user || !date) return false;
    return appointments.some(app => 
      app.userId === user.id && 
      app.appointmentDate === date &&
      // El estado es 'cancelada'. Con 'cancelado' (que no existe) la comparación
      // nunca era falsa, así que un turno ya cancelado seguía bloqueando la
      // reserva de otro el mismo día.
      app.status !== 'cancelada'
    );
  }, [user, date, appointments]);

  const selectedProfessional = professionals.find(p => p.id === professionalId);
  const selectedService = services.find(s => s.id === serviceId);

  // Get customized price
  const ps = professionalServices.find(p => p.professionalId === professionalId && p.serviceId === serviceId);
  const finalPrice = ps?.customPrice || selectedService?.price || 0;
  const finalDuration = ps?.customDuration || selectedService?.durationMinutes || 30;

  // Calculate available slots
  const availableSlots = useMemo(() => {
    if (!professionalId || !serviceId || !date) return [];
    return calculateAvailableSlots({
      professionalId,
      serviceId,
      date,
      schedules,
      appointments,
      services,
      professionalServices,
      slotInterval: business.slotInterval,
      businessHours: business.businessHours,
    });
  }, [professionalId, serviceId, date, schedules, appointments, services, professionalServices, business]);

  if (blockedReason) {
    return <BookingUnavailable reason={blockedReason} business={business} />;
  }

  const canGoNext = () => {
    switch (step) {
      case 1: return !!professionalId;
      case 2: return !!serviceId;
      case 3: return !!date && !hasAppointmentToday;
      case 4: return !!timeSlot;
      case 5: return !!personalInfo.phone;
      default: return false;
    }
  };

  const handleNext = () => {
    if (step === 3 && hasAppointmentToday) {
      setError('Ya tenés un turno reservado para este día.');
      return;
    }
    setError('');
    dispatch({ type: 'NEXT_STEP' });
  };

  const handleBack = () => {
    setError('');
    dispatch({ type: 'PREV_STEP' });
  };

  const handleConfirm = async () => {
    if (reservando) return;
    setReservando(true);
    setError('');

    const datos = {
      userId: user.id,
      clientName: user.name,
      clientEmail: user.email,
      clientPhone: personalInfo.phone,
      professionalId,
      serviceId,
      appointmentDate: date,
      startTime: timeSlot.startTime,
      endTime: timeSlot.endTime,
      price: finalPrice,
      notes: '',
      adminNotes: '',
    };

    try {
      // El turno se escribe en Firestore: desde este momento lo ve el barbero
      // en su panel, en su propio dispositivo.
      //
      // Va por la Cloud Function, que revalida todo del lado del servidor: el
      // motor de disponibilidad de acá arriba pinta la grilla, pero cualquiera
      // con la consola abierta lo saltea. El precio sale del servicio, no de
      // este formulario.
      const res = await createAppointment({
        businessId,
        professionalId,
        serviceId,
        appointmentDate: date,
        startTime: timeSlot.startTime,
        clientName: user.name,
        clientPhone: personalInfo.phone,
        clientEmail: user.email,
      });
      const id = res.id;
      datos.price = res.price;
      datos.endTime = res.endTime;

      dispatch({ type: 'RESET' });
      navigate(`/${slug}/confirmacion`, {
        state: { appointment: { ...datos, id, businessId, status: 'pendiente' } },
      });
    } catch (err) {
      console.error('[BookingPage] No se pudo reservar:', err);
      // La Cloud Function devuelve mensajes ya escritos para el cliente
      // ("Ese horario ya fue tomado. Elegí otro."), así que se muestran tal
      // cual en vez de envolverlos en otra frase.
      const esDeNegocio = [
        'functions/already-exists',
        'functions/failed-precondition',
        'functions/invalid-argument',
        'functions/not-found',
      ].includes(err.code);
      setError(
        esDeNegocio
          ? err.message
          : 'No se pudo confirmar la reserva. Actualizá la página e intentá de nuevo.'
      );
      setReservando(false);
    }
  };

  return (
    <div className="booking-container">
      <Stepper step={step} />

      {error && (
        <div className="badge badge-danger mb-md" style={{ display: 'block', textAlign: 'center', padding: '12px', borderRadius: '8px', fontSize: '14px' }}>
          {error}
        </div>
      )}

      {step === 1 && (
        <ProfessionalSelect
          professionals={professionals}
          selectedId={professionalId}
          onSelect={id => dispatch({ type: 'SET_PROFESSIONAL', payload: id })}
        />
      )}

      {step === 2 && (
        <ServiceSelect
          services={services}
          professionalServices={professionalServices}
          professionalId={professionalId}
          selectedId={serviceId}
          onSelect={id => dispatch({ type: 'SET_SERVICE', payload: id })}
          currency={business.currency}
        />
      )}

      {step === 3 && (
        <DatePicker
          selectedDate={date}
          onSelect={d => dispatch({ type: 'SET_DATE', payload: d })}
          professionalId={professionalId}
          schedules={schedules}
          businessHours={business.businessHours}
        />
      )}

      {step === 4 && (
        <TimeSlotGrid
          slots={availableSlots}
          selectedSlot={timeSlot}
          onSelect={s => dispatch({ type: 'SET_TIMESLOT', payload: s })}
          date={date}
        />
      )}

      {step === 5 && (
        <PersonalInfoStep
          user={user}
          phone={personalInfo.phone}
          onPhoneChange={phone => dispatch({ type: 'SET_PERSONAL_INFO', payload: { phone } })}
        />
      )}

      {step === 6 && selectedProfessional && selectedService && (
        <BookingSummary
          professional={selectedProfessional}
          service={{ ...selectedService, finalDuration }}
          date={date}
          timeSlot={timeSlot}
          price={finalPrice}
          currency={business.currency}
          clientName={user.name}
          clientPhone={personalInfo.phone}
        />
      )}

      <div className="booking-nav">
        {step > 1 ? (
          <button className="btn btn-outline" onClick={handleBack}>← Atrás</button>
        ) : <div />}

        {step < 6 ? (
          <button className="btn btn-primary" disabled={!canGoNext()} onClick={handleNext}>
            Siguiente →
          </button>
        ) : step === 6 ? (
          <button className="btn btn-primary btn-lg" onClick={handleConfirm} disabled={reservando}>
            {reservando ? 'Confirmando…' : '✅ Confirmar Reserva'}
          </button>
        ) : null}
      </div>
    </div>
  );
}
