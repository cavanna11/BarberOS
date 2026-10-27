import { useState, useEffect } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../hooks/useTenantData';
import { cancelAppointment, misResenas } from '../../lib/repository';
import { formatDate, formatPrice } from '../../utils/dateUtils';
import ValorarTurno from '../../components/client/ValorarTurno';
import MiMembresia from '../../components/client/MiMembresia';
import { miMembresia } from '../../lib/functions';
import { turnoConMembresia } from '../../utils/membresias';
import { textoAdicionales } from '../../utils/adicionales';

const STATUS_LABELS = {
  pendiente: { label: 'Pendiente', className: 'badge-warning' },
  confirmada: { label: 'Confirmada', className: 'badge-success' },
  completada: { label: 'Completada', className: 'badge-success' },
  cancelada: { label: 'Cancelada', className: 'badge-danger' },
  no_asistio: { label: 'No Asistió', className: 'badge-danger' },
};

export default function MyAppointments() {
  const location = useLocation();
  const { user, isAuthenticated } = useAuth();
  // Solo las citas del negocio por el que entró el cliente.
  const { appointments, professionals, services, business, slug, businessId } = useTenant();
  const [tab, setTab] = useState('upcoming');
  const ahora = new Date();

  // Las reseñas que esta persona ya dejó en esta barbería, por turno. Se leen
  // una vez al entrar y no con una suscripción: son dos o tres documentos y
  // solo se usan para saber qué botón mostrar.
  const [resenas, setResenas] = useState({});
  const [valorando, setValorando] = useState(null);

  // El link que el barbero manda por WhatsApp: `?valorar={idDelTurno}`. Abre el
  // modal de la valoración solo, sin que el cliente tenga que buscar el botón
  // entre sus turnos.
  //
  // Se DERIVA del parámetro en vez de copiarse a un estado adentro de un
  // efecto: el turno llega por la suscripción un rato después que la pantalla,
  // así que un efecto tendría que esperarlo, y además guardar en estado algo
  // que ya está en la URL es tener la misma verdad en dos lados.
  //
  // Solo si el turno es suyo (`appointments` ya trae nada más que los de él) y
  // está atendido: un link viejo no puede dejar la pantalla en un estado raro.
  const [params, setParams] = useSearchParams();
  const idAValorar = params.get('valorar');
  const turnoDelLink = idAValorar
    ? (appointments || []).find((a) => a && a.id === idAValorar && a.status === 'completada') || null
    : null;
  const aValorar = valorando || turnoDelLink;

  // Al cerrar se saca el parámetro de la URL: si quedara puesto, el modal se
  // volvería a abrir solo, y el cliente que copia la dirección de la barra para
  // mandársela a alguien le estaría mandando el link para valorar SU turno.
  const cerrarValoracion = () => {
    setValorando(null);
    if (!idAValorar) return;
    const limpios = new URLSearchParams(params);
    limpios.delete('valorar');
    setParams(limpios, { replace: true });
  };

  useEffect(() => {
    if (!businessId || !user?.id) return;
    let vigente = true;
    misResenas(businessId, user.id)
      .then((filas) => {
        if (vigente) setResenas(Object.fromEntries(filas.map((r) => [r.appointmentId || r.id, r])));
      })
      .catch((err) => console.error('[MyAppointments] No se pudieron leer tus reseñas:', err));
    return () => { vigente = false; };
  }, [businessId, user?.id]);

  // Su membresía en esta cuenta, si tiene. Una lectura al entrar.
  const [membresia, setMembresia] = useState({ membresia: null, usos: [] });
  useEffect(() => {
    if (!businessId || !user?.id) return;
    let vigente = true;
    miMembresia(businessId)
      .then((r) => { if (vigente) setMembresia({ membresia: r.membresia || null, usos: r.usos || [] }); })
      .catch((err) => console.warn('[MyAppointments] No se pudo leer tu membresía:', err.message));
    return () => { vigente = false; };
  }, [businessId, user?.id]);

  // Fecha + hora, local. Un turno de hoy a las 11:00 a las 18:00 ya pasó: no
  // es "próximo" ni se puede cancelar.
  const inicioDe = (apt) => new Date(`${apt.appointmentDate}T${apt.startTime || '00:00'}:00`);
  const yaPaso = (apt) => inicioDe(apt) <= ahora;

  // Con cuánta anticipación se puede cancelar: lo elige la barbería
  // (Configuración). Más cerca del turno, el cliente le escribe al barbero.
  const horasMinimas = Number(business?.minCancelHours) || 2;
  const puedeCancelar = (apt) => inicioDe(apt) - ahora > horasMinimas * 60 * 60 * 1000;

  if (!isAuthenticated) {
    return (
      <div className="my-appointments">
        <div className="empty-state">
          <div className="empty-state-icon">🔒</div>
          <p>Necesitás iniciar sesión para ver tus turnos</p>
          <Link to="/login" state={{ from: location.pathname }} className="btn btn-primary mt-lg">
            Iniciar Sesión
          </Link>
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

  const activa = (a) => a.status === 'pendiente' || a.status === 'confirmada';
  const upcoming = myAppointments.filter(a => activa(a) && !yaPaso(a));
  const past = myAppointments.filter(a => !activa(a) || yaPaso(a));

  const displayed = tab === 'upcoming' ? upcoming : past;

  const handleCancel = (id) => {
    if (window.confirm('¿Estás seguro de que querés cancelar este turno?')) {
      cancelAppointment(businessId, id, '', 'client').catch((err) => {
        console.error('[MyAppointments] No se pudo cancelar:', err);
        alert('No se pudo cancelar el turno: ' + err.message);
      });
    }
  };

  return (
    <div className="my-appointments">
      <h1>Mis Turnos</h1>
      <MiMembresia membresia={membresia.membresia} usos={membresia.usos} />
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
          <p>{tab === 'upcoming' ? 'No tenés turnos próximos' : 'No tenés turnos pasados'}</p>
          {tab === 'upcoming' && <Link to={`/${slug}/reservar`} className="btn btn-primary mt-lg">Reservar un turno</Link>}
        </div>
      ) : (
        displayed.map(apt => {
          const prof = professionals.find(p => p.id === apt.professionalId);
          const srv = services.find(s => s.id === apt.serviceId);
          const statusInfo = STATUS_LABELS[apt.status];
          return (
            <div key={apt.id} className="card appointment-card">
              <div className="appointment-info">
                <h3>{srv?.name}{textoAdicionales(apt)} con {prof?.name}</h3>
                <div className="details">
                  <span>📅 {formatDate(apt.appointmentDate)}</span>
                  <span>🕐 {apt.startTime}</span>
                </div>
                <div className="details mt-sm">
                  {turnoConMembresia(apt)
                    ? <span className="badge badge-success">🪪 Con tu membresía</span>
                    : <span>{formatPrice(apt.price, business?.currency)}</span>}
                </div>
              </div>
              <div className="appointment-actions">
                <span className={`badge ${statusInfo.className}`}>{statusInfo.label}</span>

                {/* Valorar: solo cuando la barbería marcó el turno como
                    atendido. Antes de eso no hay nada que valorar, y las Rules
                    lo rechazarían igual. */}
                {apt.status === 'completada' && (
                  resenas[apt.id] ? (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => setValorando(apt)}
                      title="Ya valoraste este turno. Podés corregir tu valoración."
                    >
                      <span className="estrellas-resumen">
                        {'★'.repeat(resenas[apt.id].stars)}
                        <span className="estrella-apagada">{'★'.repeat(5 - resenas[apt.id].stars)}</span>
                      </span>
                      <span style={{ marginLeft: 6 }}>Ya valoraste</span>
                    </button>
                  ) : (
                    <button className="btn btn-outline btn-sm" onClick={() => setValorando(apt)}>
                      ★ Valorar
                    </button>
                  )
                )}

                {activa(apt) && !yaPaso(apt) && (
                  puedeCancelar(apt) ? (
                    <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => handleCancel(apt.id)}>
                      Cancelar
                    </button>
                  ) : (
                    <span className="text-sm text-muted" title={`Se puede cancelar hasta ${horasMinimas} h antes`}>
                      Para cancelar, escribile a la barbería
                    </span>
                  )
                )}
              </div>
            </div>
          );
        })
      )}

      {aValorar && (
        <ValorarTurno
          turno={aValorar}
          business={business}
          servicio={services.find((s) => s.id === aValorar.serviceId) || null}
          profesional={professionals.find((p) => p.id === aValorar.professionalId) || null}
          resenaPrevia={resenas[aValorar.id] || null}
          onGuardada={(r) => setResenas((prev) => ({ ...prev, [aValorar.id]: { ...prev[aValorar.id], stars: r.stars, comment: r.comment } }))}
          onClose={cerrarValoracion}
        />
      )}
    </div>
  );
}
