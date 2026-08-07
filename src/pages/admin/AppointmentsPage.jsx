import { useState, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../hooks/useTenantData';
import { updateAppointment, cancelAppointment } from '../../lib/repository';
import { formatDate, formatPrice } from '../../utils/dateUtils';

const STATUS_OPTIONS = [
  { value: '', label: 'Todos' },
  { value: 'pendiente',  label: 'Pendiente' },
  { value: 'confirmada', label: 'Confirmada' },
  { value: 'completada', label: 'Completada' },
  { value: 'cancelada',  label: 'Cancelada' },
  { value: 'no_asistio', label: 'No Asistió' },
];

const STATUS_BADGES = {
  pendiente:  'badge-warning',
  confirmada: 'badge-success',
  completada: 'badge-primary',
  cancelada:  'badge-danger',
  no_asistio: 'badge-danger',
};

const STATUS_LABELS = {
  pendiente:  'Pendiente',
  confirmada: 'Confirmada',
  completada: 'Completada',
  cancelada:  'Cancelada',
  no_asistio: 'No asistió',
};

/**
 * Retorna true si el turno ya comenzó (la hora de inicio es ≤ ahora).
 * Solo se puede marcar como completada / no_asistio una vez que el turno arrancó.
 */
function isAppointmentStarted(apt) {
  const [y, mo, d]  = apt.appointmentDate.split('-').map(Number);
  const [h, m]      = apt.startTime.split(':').map(Number);
  const aptDateTime = new Date(y, mo - 1, d, h, m, 0);
  return aptDateTime <= new Date();
}

export default function AppointmentsPage() {
  const { user } = useAuth();
  const { appointments, professionals, services, business, businessId } = useTenant();

  const isOwner = user?.role === 'owner';

  const [filterProf,   setFilterProf]   = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterDate,   setFilterDate]   = useState('');

  const filtered = useMemo(() => {
    let result = [...appointments].sort((a, b) => {
      const da = a.appointmentDate + 'T' + a.startTime;
      const db = b.appointmentDate + 'T' + b.startTime;
      return db.localeCompare(da);
    });

    // Admin/peluquero solo ve sus propias citas
    if (!isOwner) {
      result = result.filter(a => a.professionalId === user?.professionalId);
    }

    if (filterProf)   result = result.filter(a => a.professionalId === filterProf);
    if (filterStatus) result = result.filter(a => a.status === filterStatus);
    if (filterDate)   result = result.filter(a => a.appointmentDate === filterDate);
    return result;
  }, [appointments, filterProf, filterStatus, filterDate, isOwner, user?.professionalId]);

  const updateStatus = (id, status) => {
    updateAppointment(businessId, id, { status }).catch((err) => {
      console.error('[AppointmentsPage] No se pudo actualizar el turno:', err);
      alert('No se pudo actualizar el turno: ' + err.message);
    });
  };

  const handleCancel = (id) => {
    if (window.confirm('¿Cancelar esta cita?')) {
      cancelAppointment(businessId, id).catch((err) => {
        console.error('[AppointmentsPage] No se pudo cancelar:', err);
        alert('No se pudo cancelar el turno: ' + err.message);
      });
    }
  };

  return (
    <div>
      <div className="admin-page-header">
        <h1>{isOwner ? 'Citas' : 'Mis Citas'}</h1>
        <span className="badge badge-neutral">{filtered.length} resultado{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Filtros */}
      <div className="filters-bar">
        <input
          type="date"
          className="form-input"
          value={filterDate}
          onChange={e => setFilterDate(e.target.value)}
          style={{ maxWidth: 180 }}
        />
        {isOwner && (
          <select
            className="form-input"
            value={filterProf}
            onChange={e => setFilterProf(e.target.value)}
            style={{ maxWidth: 200 }}
          >
            <option value="">Todos los profesionales</option>
            {professionals.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
        <select
          className="form-input"
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          style={{ maxWidth: 180 }}
        >
          {STATUS_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        {(filterProf || filterStatus || filterDate) && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => { setFilterProf(''); setFilterStatus(''); setFilterDate(''); }}
          >
            ✕ Limpiar
          </button>
        )}
      </div>

      <div className="card" style={{ padding: 0, overflow: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Hora</th>
              {isOwner && <th>Profesional</th>}
              <th>Cliente</th>
              <th>Teléfono</th>
              <th>Servicio</th>
              <th>Precio</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(apt => {
              const prof    = professionals.find(p => p.id === apt.professionalId);
              const srv     = services.find(s => s.id === apt.serviceId);
              const started = isAppointmentStarted(apt);
              const isWalkin = apt.type === 'walkin';

              // Tooltips para botones temporalmente bloqueados
              const blockedMsg = 'El turno todavía no comenzó';

              return (
                <tr key={apt.id} style={isWalkin ? { background: 'var(--bg-secondary)', fontStyle: 'italic' } : {}}>
                  <td>{formatDate(apt.appointmentDate).split(',')[0]}</td>
                  <td><strong>{apt.startTime}</strong> — {apt.endTime}</td>
                  {isOwner && <td>{prof?.name}</td>}
                  <td>
                    {isWalkin
                      ? <span className="flex items-center gap-sm"><span>✂️</span><span>Servicio sin turno</span></span>
                      : (apt.clientName || apt.userId)
                    }
                  </td>
                  <td>{apt.clientPhone || '—'}</td>
                  <td>
                    {isWalkin
                      ? <span className="badge badge-neutral" style={{ fontSize: 11 }}>bloqueado</span>
                      : (srv?.name || '—')
                    }
                  </td>
                  <td>
                    {isWalkin ? '—' : formatPrice(apt.price, business?.currency)}
                  </td>
                  <td>
                    <span className={`badge ${STATUS_BADGES[apt.status]}`}>
                      {STATUS_LABELS[apt.status] || apt.status}
                    </span>
                  </td>
                  <td>
                    <div className="table-actions">
                      {(apt.status === 'pendiente' || apt.status === 'confirmada') && (
                        <>
                          {/* ✅ Completar — solo si el turno ya empezó */}
                          <button
                            className="btn btn-ghost btn-sm"
                            title={started ? 'Marcar como completada' : blockedMsg}
                            onClick={() => started && updateStatus(apt.id, 'completada')}
                            disabled={!started}
                            style={!started ? { opacity: 0.35, cursor: 'not-allowed' } : {}}
                          >✅</button>

                          {/* 👻 No asistió — solo si el turno ya empezó */}
                          <button
                            className="btn btn-ghost btn-sm"
                            title={started ? 'No asistió' : blockedMsg}
                            onClick={() => started && updateStatus(apt.id, 'no_asistio')}
                            disabled={!started}
                            style={!started ? { opacity: 0.35, cursor: 'not-allowed' } : {}}
                          >👻</button>

                          {/* ❌ Cancelar — siempre disponible */}
                          <button
                            className="btn btn-ghost btn-sm"
                            title="Cancelar"
                            onClick={() => handleCancel(apt.id)}
                          >❌</button>
                        </>
                      )}

                      {/* ✔️ Confirmar — solo para pendientes, siempre disponible */}
                      {apt.status === 'pendiente' && (
                        <button
                          className="btn btn-ghost btn-sm"
                          title="Confirmar"
                          onClick={() => updateStatus(apt.id, 'confirmada')}
                        >✔️</button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="empty-state">
            <p>No se encontraron citas con estos filtros</p>
          </div>
        )}
      </div>
    </div>
  );
}
