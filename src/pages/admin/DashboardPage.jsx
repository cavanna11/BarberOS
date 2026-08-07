import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useBusiness } from '../../contexts/BusinessContext';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../hooks/useTenantData';
import { calculateStats } from '../../utils/statsCalculator';
import { formatPrice, formatDate } from '../../utils/dateUtils';

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

// ─── Modal Servicio sin turno ──────────────────────────────────────────────
function WalkinModal({ onClose, onConfirm }) {
  const [duration, setDuration] = useState(30);

  const now = new Date();
  const startH = now.getHours();
  const startM = now.getMinutes();
  const startTime = `${String(startH).padStart(2, '0')}:${String(startM).padStart(2, '0')}`;
  const endTotal  = startH * 60 + startM + duration;
  const endTime   = `${String(Math.floor(endTotal / 60) % 24).padStart(2, '0')}:${String(endTotal % 60).padStart(2, '0')}`;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
        <div className="modal-header">
          <h3>✂️ Servicio sin turno</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <p className="text-secondary" style={{ marginBottom: 'var(--space-md)', fontSize: 14 }}>
            Registrá un servicio inmediato. El horario quedará bloqueado para reservas online.
          </p>

          <div className="form-group">
            <label className="form-label">Inicio (ahora)</label>
            <div
              className="form-input"
              style={{ background: 'var(--bg-secondary)', cursor: 'default', fontWeight: 700, fontSize: 18 }}
            >
              {startTime}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Duración estimada</label>
            <select
              className="form-input"
              value={duration}
              onChange={e => setDuration(Number(e.target.value))}
            >
              <option value={30}>30 minutos</option>
              <option value={60}>1 hora</option>
              <option value={90}>1 hora 30 min</option>
              <option value={120}>2 horas</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Finaliza aprox.</label>
            <div
              className="form-input"
              style={{ background: 'var(--bg-secondary)', cursor: 'default', fontWeight: 700, fontSize: 18 }}
            >
              {endTime}
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={() => onConfirm(startTime, endTime)}>
            ✅ Registrar servicio
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Componente principal ──────────────────────────────────────────────────
export default function DashboardPage() {
  const { dispatch } = useBusiness();
  const { user } = useAuth();
  const { appointments, professionals, services, professionalServices, business } = useTenant();
  const [showWalkinModal, setShowWalkinModal] = useState(false);

  const isOwner = user?.role === 'owner';
  const today   = new Date().toISOString().split('T')[0];

  // Owner ve todas las citas; peluquero solo las suyas
  const visibleAppointments = isOwner
    ? appointments
    : appointments.filter(a => a.professionalId === user?.professionalId);

  // ══════════════════════════════════════════════════════════════════════════
  // VISTA PELUQUERO
  // ══════════════════════════════════════════════════════════════════════════
  if (!isOwner) {
    const upcomingPending = visibleAppointments
      .filter(a =>
        (a.status === 'pendiente' || a.status === 'confirmada') &&
        a.appointmentDate >= today
      )
      .sort((a, b) => {
        const da = a.appointmentDate + 'T' + a.startTime;
        const db = b.appointmentDate + 'T' + b.startTime;
        return da.localeCompare(db);
      });

    const handleWalkin = (startTime, endTime) => {
      dispatch({
        type: 'ADD_APPOINTMENT',
        payload: {
          id: 'walkin-' + Date.now(),
          businessId: business.id || 'biz-001',
          professionalId: user.professionalId,
          serviceId: null,
          appointmentDate: today,
          startTime,
          endTime,
          price: 0,
          status: 'confirmada',
          type: 'walkin',
          clientName: 'Servicio sin turno',
          clientPhone: null,
          notes: '',
          adminNotes: '',
          createdAt: new Date().toISOString(),
          userId: user.id,
        },
      });
      setShowWalkinModal(false);
    };

    return (
      <div>
        {/* Header */}
        <div className="admin-page-header">
          <div>
            <h1>Hola, {user?.name?.split(' ')[0]} 👋</h1>
            <span className="text-secondary text-sm" style={{ marginTop: 4, display: 'block' }}>
              {formatDate(today)}
            </span>
          </div>
          <div className="flex items-center gap-md">
            <span className="badge badge-warning" style={{ fontSize: 13, padding: '6px 12px' }}>
              ⏳ {upcomingPending.length} pendiente{upcomingPending.length !== 1 ? 's' : ''}
            </span>
            <button className="btn btn-primary" onClick={() => setShowWalkinModal(true)}>
              ✂️ Servicio sin turno
            </button>
          </div>
        </div>

        {/* Lista de turnos próximos */}
        <div className="card">
          <h3 style={{ marginBottom: 'var(--space-md)' }}>📋 Turnos próximos</h3>

          {upcomingPending.length === 0 ? (
            <div className="empty-state" style={{ padding: 'var(--space-xl)' }}>
              <p>No tenés turnos pendientes próximos 🎉</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
              {upcomingPending.map(apt => {
                const srv        = services.find(s => s.id === apt.serviceId);
                const isWalkin   = apt.type === 'walkin';
                const isAptToday = apt.appointmentDate === today;

                return (
                  <div
                    key={apt.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-md)',
                      padding: 'var(--space-md)',
                      background: isAptToday ? 'var(--primary-light)' : 'var(--bg-secondary)',
                      borderRadius: 'var(--radius-md)',
                      borderLeft: `4px solid ${isAptToday ? 'var(--primary)' : 'var(--border-color)'}`,
                    }}
                  >
                    {/* Hora */}
                    <div style={{ minWidth: 72, textAlign: 'center' }}>
                      <div style={{
                        fontSize: 20,
                        fontWeight: 700,
                        color: isAptToday ? 'var(--primary)' : 'var(--text-primary)',
                        lineHeight: 1.1,
                      }}>
                        {apt.startTime}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        {isAptToday ? 'Hoy' : formatDate(apt.appointmentDate).split(',')[0]}
                      </div>
                    </div>

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {isWalkin ? (
                        <div className="flex items-center gap-sm">
                          <span style={{ fontWeight: 600 }}>✂️ Servicio sin turno</span>
                          <span className="badge badge-neutral" style={{ fontSize: 11 }}>bloqueado</span>
                        </div>
                      ) : (
                        <>
                          <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {apt.clientName || 'Cliente'}
                          </div>
                          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                            {srv?.name || '—'} &nbsp;·&nbsp; {apt.startTime}–{apt.endTime}
                          </div>
                          {apt.clientPhone && (
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                              📞 {apt.clientPhone}
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    {/* Badge estado */}
                    <span className={`badge ${STATUS_BADGES[apt.status]}`} style={{ flexShrink: 0 }}>
                      {STATUS_LABELS[apt.status]}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {showWalkinModal && (
          <WalkinModal
            onClose={() => setShowWalkinModal(false)}
            onConfirm={handleWalkin}
          />
        )}
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // VISTA DUEÑO
  // ══════════════════════════════════════════════════════════════════════════
  const stats = calculateStats(visibleAppointments, professionals, services);

  const todayAppointments = visibleAppointments
    .filter(a => a.appointmentDate === today && (a.status === 'pendiente' || a.status === 'confirmada'))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  const maxRevProf = Math.max(...stats.ingresosPorProfesional.map(p => p.total), 1);
  const maxRevSrv  = Math.max(...stats.ingresosPorServicio.map(s => s.total), 1);

  // Una cuenta recién creada no puede tomar turnos hasta tener staff y catálogo.
  // Este checklist es lo que hay que completar antes de entregarla al cliente.
  const setupSteps = [
    {
      done: professionals.length > 0,
      label: 'Cargar al menos un profesional con sus horarios',
      to: '/admin/profesionales',
      cta: 'Cargar profesionales',
    },
    {
      done: services.length > 0,
      label: 'Cargar el catálogo de servicios con precios',
      to: '/admin/servicios',
      cta: 'Cargar servicios',
    },
    {
      done: Boolean(business?.businessHours?.some(h => h.isActive)),
      label: 'Definir el horario de atención del local',
      to: '/admin/configuracion',
      cta: 'Definir horarios',
    },
    {
      // Sin esta asignación el cliente elige profesional y llega a un paso 2
      // vacío: los servicios que se le ofrecen son los de ESE profesional.
      done:
        professionals.length > 0 &&
        professionals.every(p => professionalServices.some(ps => ps.professionalId === p.id)),
      label: 'Asignarle al menos un servicio a cada profesional',
      to: '/admin/profesionales',
      cta: 'Asignar servicios',
    },
  ];
  const pendingSteps = setupSteps.filter(s => !s.done);

  return (
    <div>
      {pendingSteps.length > 0 && (
        <div
          className="card"
          style={{ padding: 'var(--space-md)', marginBottom: 'var(--space-lg)', borderLeft: '4px solid var(--primary)' }}
        >
          <h3 style={{ marginBottom: 4 }}>Falta configurar la cuenta</h3>
          <p className="text-secondary" style={{ fontSize: 13, marginBottom: 'var(--space-md)' }}>
            Hasta que estos puntos estén listos, el link público de{' '}
            <strong>{business?.name}</strong> no puede tomar turnos.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {setupSteps.map(step => (
              <div
                key={step.to}
                style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, flexWrap: 'wrap' }}
              >
                <span style={{ fontSize: 15 }}>{step.done ? '✅' : '⬜'}</span>
                <span
                  style={{
                    flex: 1,
                    minWidth: 200,
                    color: step.done ? 'var(--text-muted)' : 'var(--text)',
                    textDecoration: step.done ? 'line-through' : 'none',
                  }}
                >
                  {step.label}
                </span>
                {!step.done && (
                  <Link to={step.to} className="btn btn-outline btn-sm">{step.cta}</Link>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {pendingSteps.length === 0 && business?.slug && (
        <div
          className="card"
          style={{ padding: 'var(--space-md)', marginBottom: 'var(--space-lg)', borderLeft: '4px solid var(--success)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
        >
          <div>
            <strong style={{ fontSize: 14 }}>✅ La cuenta está lista para tomar turnos</strong>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              Link para compartir con los clientes: <code>/{business.slug}</code>
            </div>
          </div>
          <a
            href={`/${business.slug}`}
            target="_blank"
            rel="noreferrer"
            className="btn btn-outline btn-sm"
            style={{ textDecoration: 'none' }}
          >
            Ver link público
          </a>
        </div>
      )}

      <div className="admin-page-header">
        <h1>Dashboard</h1>
        <span className="badge badge-primary">📅 {formatDate(today)}</span>
      </div>

      {/* Stats Grid */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: 'var(--primary-light)', color: 'var(--primary)' }}>📊</div>
          <div className="stat-card-value">{stats.total}</div>
          <div className="stat-card-label">Total Reservas</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: 'var(--success-light)', color: 'var(--success)' }}>✅</div>
          <div className="stat-card-value">{stats.completadas}</div>
          <div className="stat-card-label">Completadas</div>
          <div className="stat-card-change positive">
            {stats.total > 0 ? ((stats.completadas / stats.total) * 100).toFixed(0) : 0}% del total
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: 'var(--primary-light)', color: 'var(--primary)' }}>💰</div>
          <div className="stat-card-value">{formatPrice(stats.ingresosTotales, business.currency)}</div>
          <div className="stat-card-label">Ingresos Totales</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: 'var(--danger-light)', color: 'var(--danger)' }}>❌</div>
          <div className="stat-card-value">{stats.noAsistio}</div>
          <div className="stat-card-label">No Asistieron</div>
          <div className="stat-card-change negative">{stats.tasaNoAsistencia}%</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: 'var(--warning-light)', color: 'var(--warning)' }}>⏳</div>
          <div className="stat-card-value">{stats.pendientes}</div>
          <div className="stat-card-label">Pendientes</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: 'var(--danger-light)', color: 'var(--danger)' }}>↩️</div>
          <div className="stat-card-value">{stats.canceladas}</div>
          <div className="stat-card-label">Canceladas</div>
          <div className="stat-card-change negative">{stats.tasaCancelacion}%</div>
        </div>
      </div>

      {/* Revenue */}
      <div className="revenue-section">
        <div className="revenue-card">
          <h3>Ingresos por Profesional</h3>
          {stats.ingresosPorProfesional.map(p => (
            <div key={p.id} className="revenue-bar-item">
              <div className="revenue-bar-header">
                <span>{p.name}</span>
                <span className="text-secondary">{formatPrice(p.total, business.currency)} ({p.count} citas)</span>
              </div>
              <div className="revenue-bar-track">
                <div className="revenue-bar-fill" style={{ width: `${(p.total / maxRevProf) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
        <div className="revenue-card">
          <h3>Ingresos por Servicio</h3>
          {stats.ingresosPorServicio.map(s => (
            <div key={s.id} className="revenue-bar-item">
              <div className="revenue-bar-header">
                <span>{s.name}</span>
                <span className="text-secondary">{formatPrice(s.total, business.currency)} ({s.count})</span>
              </div>
              <div className="revenue-bar-track">
                <div className="revenue-bar-fill" style={{ width: `${(s.total / maxRevSrv) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Citas de hoy */}
      <div className="upcoming-table">
        <h3>📅 Citas de Hoy ({todayAppointments.length})</h3>
        {todayAppointments.length === 0 ? (
          <div className="empty-state" style={{ padding: 'var(--space-xl)' }}>
            <p>No hay citas programadas para hoy</p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Hora</th>
                <th>Profesional</th>
                <th>Cliente</th>
                <th>Teléfono</th>
                <th>Servicio</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {todayAppointments.map(apt => {
                const prof = professionals.find(p => p.id === apt.professionalId);
                const srv  = services.find(s => s.id === apt.serviceId);
                return (
                  <tr key={apt.id}>
                    <td><strong>{apt.startTime}</strong></td>
                    <td>{prof?.name}</td>
                    <td>{apt.clientName || apt.userId}</td>
                    <td>{apt.clientPhone || '—'}</td>
                    <td>
                      {apt.type === 'walkin'
                        ? <span className="badge badge-neutral">Sin turno ✂️</span>
                        : (srv?.name || '—')
                      }
                    </td>
                    <td>
                      <span className={`badge ${apt.status === 'confirmada' ? 'badge-success' : 'badge-warning'}`}>
                        {apt.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
