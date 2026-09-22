import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../hooks/useTenantData';
import { createAppointment, updateAppointment } from '../../lib/repository';
import { calculateStats } from '../../utils/statsCalculator';
import { formatPrice, formatDate, toDateString } from '../../utils/dateUtils';
import NuevoTurnoModal from '../../components/admin/NuevoTurnoModal';
import AgendaDelDia from '../../components/admin/AgendaDelDia';

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
  const { user } = useAuth();
  const { appointments, professionals, services, professionalServices, business, businessId } = useTenant();
  const [showWalkinModal, setShowWalkinModal] = useState(false);
  const [agendando, setAgendando] = useState(false);

  const isOwner = user?.role === 'owner';
  // Local, no toISOString(): eso es UTC, y a partir de las 21:00 en Argentina
  // ya es "mañana" — el walk-in se registraba en el día equivocado.
  const today   = toDateString(new Date());

  // Owner ve todas las citas; peluquero solo las suyas. Sin perfil vinculado
  // no hay turnos que mostrar: el aviso de arriba dice por qué.
  const visibleAppointments = isOwner
    ? appointments
    : user?.professionalId
      ? appointments.filter(a => a.professionalId === user.professionalId)
      : [];

  // Acciones sobre un turno desde la agenda: confirmar, completar, no asistió,
  // cancelar. Completar y "no asistió" recién cuando el turno ya empezó.
  const cambiarEstado = (apt, status) => {
    if (status === 'cancelada' && !window.confirm('¿Cancelar este turno?')) return;
    updateAppointment(businessId, apt.id, { status }).catch((err) => {
      console.error('[Dashboard] No se pudo actualizar el turno:', err);
      alert('No se pudo actualizar el turno: ' + err.message);
    });
  };

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

    const handleWalkin = async (startTime, endTime) => {
      try {
        // Nace en 'pendiente' (lo exigen las Rules) y se confirma acto seguido:
        // el cliente ya está sentado en la silla.
        const id = await createAppointment(businessId, {
          professionalId: user.professionalId,
          serviceId: null,
          appointmentDate: today,
          startTime,
          endTime,
          price: 0,
          type: 'walkin',
          clientName: 'Servicio sin turno',
          clientPhone: null,
          notes: '',
          adminNotes: '',
          userId: user.id,
        });
        await updateAppointment(businessId, id, { status: 'confirmada' });
      } catch (err) {
        console.error('[Dashboard] No se pudo registrar el servicio:', err);
        alert('No se pudo registrar el servicio: ' + err.message);
        return;
      }
      setShowWalkinModal(false);
    };

    return (
      <div>
        {/* Header */}
        <div className="admin-page-header">
          <div>
            <h1>Hola, {user?.name?.split(' ')[0]} 👋</h1>
            {/* La fecha vive en la agenda, que es la que se mueve de día: acá
                arriba decía siempre "hoy" aunque abajo estuvieras mirando
                mañana. */}
          </div>
          <div className="flex items-center gap-md">
            <span className="badge badge-warning" style={{ fontSize: 13, padding: '6px 12px' }}>
              ⏳ {upcomingPending.length} pendiente{upcomingPending.length !== 1 ? 's' : ''}
            </span>
            <button className="btn btn-outline" onClick={() => setAgendando(true)}>
              📅 Agendar turno
            </button>
            <button className="btn btn-primary" onClick={() => setShowWalkinModal(true)}>
              ✂️ Servicio sin turno
            </button>
          </div>
        </div>

        {agendando && <NuevoTurnoModal onClose={() => setAgendando(false)} />}

        {/* La agenda del día, como calendario. Es lo que mira entre corte y corte. */}
        <div className="card">
          <AgendaDelDia
            appointments={visibleAppointments}
            professionals={professionals}
            services={services}
            business={business}
            professionalId={user.professionalId}
            onCambiarEstado={cambiarEstado}
          />
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
              Link para compartir con los clientes: <code>{window.location.origin}/{business.slug}</code>
            </div>
          </div>
          <button
            className="btn btn-outline btn-sm"
            onClick={() => navigator.clipboard?.writeText(`${window.location.origin}/${business.slug}`).catch(() => {})}
          >
            Copiar link
          </button>
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

      {/* Agenda del día, con todos los barberos o filtrada por uno. */}
      <div className="card">
        <AgendaDelDia
          appointments={visibleAppointments}
          professionals={professionals}
          services={services}
          business={business}
          onCambiarEstado={cambiarEstado}
        />
      </div>
    </div>
  );
}
