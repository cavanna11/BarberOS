import { useState, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../hooks/useTenantData';
import { createAppointment, updateAppointment } from '../../lib/repository';
import { calculateAvailableSlots } from '../../utils/availabilityEngine';
import { formatPrice, toDateString } from '../../utils/dateUtils';
import { servicioAplicaAlDia, servicioAplicaAlHorario, describirVentana, tieneVentana } from '../../utils/ventanaServicio';

/**
 * El staff agenda un turno a mano.
 *
 * Por qué existe: al principio la mayoría de los clientes va a seguir pidiendo
 * turno por WhatsApp, y el barbero necesita cargarlo igual para que el horario
 * quede bloqueado y la agenda sea una sola. También sirve para el que no quiere
 * abrir la reserva al público y usa BarberOS solo para ordenarse.
 *
 * Escribe directo a Firestore, no por la Cloud Function `createAppointment`:
 * la función cuenta los turnos del uid que llama (uno por día, tres a futuro),
 * que es una regla para clientes y frenaría al barbero en el cuarto turno que
 * cargue. Las Rules ya permiten al staff crear en su propia agenda. El
 * solapamiento lo evita la grilla, que se arma con la agenda que el staff sí
 * puede ver (el dueño toda, el barbero la suya).
 *
 * Nace 'pendiente' (lo exigen las Rules) y se confirma acto seguido: si el
 * barbero lo cargó es porque ya lo acordó con el cliente.
 */
export default function NuevoTurnoModal({ onClose }) {
  const { user } = useAuth();
  const { appointments, professionals, services, professionalServices, schedules, business, businessId } = useTenant();

  const esBarbero = user?.role === 'admin' && Boolean(user?.professionalId);
  const hoy = toDateString(new Date());

  const [form, setForm] = useState({
    professionalId: esBarbero ? user.professionalId : (professionals[0]?.id || ''),
    serviceId: '',
    date: hoy,
    startTime: '',
    clientName: '',
    clientPhone: '',
    notes: '',
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  const set = (campo) => (ev) => {
    const valor = ev.target.value;
    setForm((f) => {
      const nuevo = { ...f, [campo]: valor };
      // Cambiar de profesional, servicio o día invalida el horario elegido.
      if (campo !== 'startTime' && campo !== 'clientName' && campo !== 'clientPhone' && campo !== 'notes') {
        nuevo.startTime = '';
      }
      if (campo === 'professionalId') nuevo.serviceId = '';
      return nuevo;
    });
  };

  // Solo los servicios que hace ese profesional, igual que en la reserva pública.
  const serviciosDelProfesional = useMemo(() => {
    const ids = new Set(
      professionalServices.filter((ps) => ps.professionalId === form.professionalId).map((ps) => ps.serviceId)
    );
    return services.filter((s) => s.isActive !== false && ids.has(s.id));
  }, [services, professionalServices, form.professionalId]);

  const servicio = services.find((s) => s.id === form.serviceId);
  const ps = professionalServices.find((p) => p.professionalId === form.professionalId && p.serviceId === form.serviceId);
  const precio = ps?.customPrice || servicio?.price || 0;
  const duracion = ps?.customDuration || servicio?.durationMinutes || 30;

  const slots = useMemo(() => {
    if (!form.professionalId || !form.serviceId || !form.date) return [];
    const srv = services.find((s) => s.id === form.serviceId);
    if (!servicioAplicaAlDia(srv, form.date)) return [];
    return calculateAvailableSlots({
      professionalId: form.professionalId,
      serviceId: form.serviceId,
      date: form.date,
      schedules,
      appointments,
      services,
      professionalServices,
      slotInterval: business.slotInterval,
      businessHours: business.businessHours,
    }).filter((s) => servicioAplicaAlHorario(srv, s.startTime, s.endTime));
  }, [form.professionalId, form.serviceId, form.date, schedules, appointments, services, professionalServices, business]);

  const slot = slots.find((s) => s.startTime === form.startTime);
  const digitos = form.clientPhone.replace(/\D/g, '');
  const telefonoOk = digitos.length === 0 || (digitos.length >= 10 && digitos.length <= 13);
  const listo = Boolean(slot) && form.clientName.trim().length > 0 && telefonoOk && !guardando;

  const guardar = async () => {
    if (!listo) return;
    setGuardando(true);
    setError('');
    try {
      const id = await createAppointment(businessId, {
        professionalId: form.professionalId,
        serviceId: form.serviceId,
        appointmentDate: form.date,
        startTime: slot.startTime,
        endTime: slot.endTime,
        price: precio,
        durationMinutes: duracion,
        serviceName: servicio?.name || '',
        clientName: form.clientName.trim().slice(0, 120),
        clientPhone: form.clientPhone.trim().slice(0, 40),
        clientEmail: '',
        notes: form.notes.trim().slice(0, 500),
        // Quién lo cargó. No es el cliente: el turno no le aparece a nadie en
        // "Mis citas", vive solo en la agenda del negocio.
        userId: user.id,
        type: 'manual',
      });
      await updateAppointment(businessId, id, { status: 'confirmada' });
      onClose();
    } catch (err) {
      console.error('[NuevoTurnoModal] No se pudo agendar:', err);
      setError('No se pudo agendar el turno: ' + err.message);
      setGuardando(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <h3>📅 Agendar turno</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <p className="text-secondary" style={{ marginBottom: 'var(--space-md)', fontSize: 14 }}>
            Para el cliente que te pidió turno por WhatsApp o en persona. Queda
            confirmado y bloquea el horario para las reservas online.
          </p>

          {error && (
            <div className="badge badge-danger" style={{ display: 'block', padding: '8px 12px', borderRadius: 8, marginBottom: 'var(--space-md)' }}>
              {error}
            </div>
          )}

          {!esBarbero && (
            <div className="form-group">
              <label className="form-label">Profesional</label>
              <select className="form-input" value={form.professionalId} onChange={set('professionalId')}>
                {professionals.filter((p) => p.isActive !== false).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Servicio</label>
            <select className="form-input" value={form.serviceId} onChange={set('serviceId')}>
              <option value="">Elegí un servicio</option>
              {serviciosDelProfesional.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {formatPrice(s.price, business?.currency)} · {s.durationMinutes} min
                </option>
              ))}
            </select>
            {servicio && tieneVentana(servicio) && (
              <p className="text-sm" style={{ marginTop: 6, color: 'var(--warning)' }}>
                Promo: {describirVentana(servicio).toLowerCase()}.
              </p>
            )}
            {form.professionalId && serviciosDelProfesional.length === 0 && (
              <p className="text-sm text-muted" style={{ marginTop: 6 }}>
                Este profesional no tiene servicios asignados. Se asignan desde Profesionales.
              </p>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">Día</label>
              <input type="date" className="form-input" min={hoy} value={form.date} onChange={set('date')} />
            </div>
            <div className="form-group">
              <label className="form-label">Horario</label>
              <select
                className="form-input"
                value={form.startTime}
                onChange={set('startTime')}
                disabled={!form.serviceId || slots.length === 0}
              >
                <option value="">{!form.serviceId ? 'Primero el servicio' : slots.length === 0 ? 'Sin horarios libres' : 'Elegí un horario'}</option>
                {slots.map((s) => (
                  <option key={s.startTime} value={s.startTime}>{s.startTime} — {s.endTime}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Nombre del cliente</label>
            <input className="form-input" value={form.clientName} onChange={set('clientName')} placeholder="Juan Pérez" maxLength={120} />
          </div>

          <div className="form-group">
            <label className="form-label">Teléfono (opcional)</label>
            <input
              className="form-input"
              type="tel"
              value={form.clientPhone}
              onChange={set('clientPhone')}
              placeholder="11 1234-5678"
              style={!telefonoOk ? { borderColor: 'var(--danger)' } : undefined}
            />
            {!telefonoOk && (
              <p className="text-sm" style={{ color: 'var(--danger)', marginTop: 6 }}>
                Tiene que tener entre 10 y 13 dígitos, o dejalo vacío.
              </p>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">Nota (opcional)</label>
            <input className="form-input" value={form.notes} onChange={set('notes')} placeholder="Viene con el hijo" maxLength={500} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onClose} disabled={guardando}>Cancelar</button>
          <button className="btn btn-primary" onClick={guardar} disabled={!listo}>
            {guardando ? 'Agendando…' : slot ? `Agendar ${slot.startTime}` : 'Agendar'}
          </button>
        </div>
      </div>
    </div>
  );
}
