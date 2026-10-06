import { useState, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../hooks/useTenantData';
import { updateAppointment, cancelAppointment } from '../../lib/repository';
import NuevoTurnoModal from '../../components/admin/NuevoTurnoModal';
import { formatDate, formatPrice, fechaCorta, toDateString } from '../../utils/dateUtils';
import { origenTurno } from '../../utils/origenTurno';
import { devolverSena } from '../../lib/functions';
import { useVinculoBarbero, textoVinculo } from '../../hooks/useVinculoBarbero';
import WhatsAppTurno from '../../components/admin/WhatsAppTurno';
import FiltroSucursal from '../../components/admin/FiltroSucursal';
import { useDatosDeSucursales } from '../../hooks/useDatosDeSucursales';

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

/** Cómo se lee el estado de la seña en la tabla. */
function etiquetaSena(apt, moneda) {
  const s = apt.sena;
  if (!s) return <span className="text-muted">—</span>;
  const monto = formatPrice(s.monto, moneda);
  if (s.estado === 'pagada') {
    const total = s.tipo === 'total';
    return (
      <span
        className={`badge ${total ? 'badge-primary' : 'badge-success'}`}
        style={{ fontSize: 11 }}
        title={total ? 'Pagó el turno completo: no le cobres nada' : 'Dejó seña: descontásela del total'}
      >
        {total ? '💳 pagado' : '✅'} {monto}
      </span>
    );
  }
  if (s.estado === 'devuelta') return <span className="badge badge-neutral" style={{ fontSize: 11 }}>↩️ devuelta</span>;
  if (s.estado === 'rechazada') return <span className="badge badge-danger" style={{ fontSize: 11 }}>✕ rechazada</span>;
  return <span className="badge badge-warning" style={{ fontSize: 11 }}>⏳ sin pagar</span>;
}

export default function AppointmentsPage() {
  const { user } = useAuth();
  const {
    appointments, professionals, services, business, businessId, esMultiSucursal,
  } = useTenant();

  const isOwner = user?.role === 'owner';

  // Sucursal: '' = todas, o el id de una. Elegir una puntual la vuelve la
  // activa (lo hace FiltroSucursal) y entonces los datos salen del contexto,
  // en vivo. Con "todas" hay que ir a buscar las otras, de una sola vez.
  const [sucFiltro, setSucFiltro] = useState('');
  const verTodas = esMultiSucursal && !sucFiltro;
  const otrasSucursales = useDatosDeSucursales(['appointments', 'professionals', 'services'], { activo: verTodas });
  const vinculo = useVinculoBarbero();
  const profIdPropio = user?.professionalId ?? null;

  const [filterProf,   setFilterProf]   = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterDate,   setFilterDate]   = useState('');
  const [agendando,    setAgendando]    = useState(false);
  // Arranca en los de hoy: es lo que se mira noventa veces al día. Antes la
  // lista venía toda junta, por orden de carga, y había que ir buscando cuál
  // era de hoy entre los de la semana que viene.
  const [rango, setRango] = useState('hoy');
  const hoy = toDateString(new Date());

  // De dónde salen las filas. Con una sola sucursal (el caso normal) es el
  // contexto y está en vivo; con "todas" es la lectura de las cuatro, y cada
  // fila trae `__bizId` para que las acciones toquen la barbería correcta.
  const turnos = verTodas ? otrasSucursales.juntar('appointments') : appointments;
  const profesionalesVisibles = verTodas ? otrasSucursales.juntar('professionals') : professionals;
  const serviciosVisibles = verTodas ? otrasSucursales.juntar('services') : services;

  const filtered = useMemo(() => {
    let result = [...turnos].sort((a, b) => {
      const da = a.appointmentDate + 'T' + a.startTime;
      const db = b.appointmentDate + 'T' + b.startTime;
      return db.localeCompare(da);
    });

    // Admin/peluquero solo ve sus propias citas. Si no hay perfil vinculado,
    // este filtro comparaba contra undefined y vaciaba la tabla en silencio:
    // se devuelve vacío a propósito y la pantalla lo explica.
    if (!isOwner) {
      if (!profIdPropio) return [];
      result = result.filter(a => a.professionalId === profIdPropio);
    }

    if (filterProf)   result = result.filter(a => a.professionalId === filterProf);
    if (filterStatus) result = result.filter(a => a.status === filterStatus);

    // Una fecha elegida a mano manda sobre las solapas.
    if (filterDate) {
      result = result.filter(a => a.appointmentDate === filterDate);
    } else if (rango === 'hoy') {
      result = result.filter(a => a.appointmentDate === hoy);
    } else if (rango === 'proximos') {
      result = result.filter(a => a.appointmentDate > hoy);
    }

    // Los de hoy y los que vienen, del primero al último (es el orden en que
    // van entrando por la puerta); los pasados, del más reciente al más viejo.
    const cronologico = !filterDate && rango !== 'todos';
    result.sort((a, b) => {
      const ka = a.appointmentDate + 'T' + a.startTime;
      const kb = b.appointmentDate + 'T' + b.startTime;
      return cronologico ? ka.localeCompare(kb) : kb.localeCompare(ka);
    });
    return result;
  }, [turnos, filterProf, filterStatus, filterDate, isOwner, profIdPropio, rango, hoy]);

  const cuantos = useMemo(() => {
    const mios = isOwner ? turnos : turnos.filter(a => a.professionalId === profIdPropio);
    const vivos = mios.filter(a => a.status !== 'cancelada');
    return {
      hoy: vivos.filter(a => a.appointmentDate === hoy).length,
      proximos: vivos.filter(a => a.appointmentDate > hoy).length,
    };
  }, [turnos, isOwner, profIdPropio, hoy]);

  // La devolución sale de la cuenta de Mercado Pago del barbero, así que es
  // una decisión suya y no automática: un botón, con confirmación.
  // La barbería de ESTA fila. Con "todas las sucursales" la tabla junta turnos
  // de cuatro locales: escribir siempre en el negocio activo le cambiaría el
  // estado al turno de otra sucursal. Es el error que hace que este filtro sea
  // peligroso si se hace mal.
  const negocioDe = (apt) => apt.__bizId || businessId;

  const [devolviendo, setDevolviendo] = useState('');
  const devolver = async (apt) => {
    if (!window.confirm(`¿Devolverle la seña de ${formatPrice(apt.sena?.monto, business?.currency)} a ${apt.clientName || 'el cliente'}?

Sale de tu cuenta de Mercado Pago.`)) return;
    setDevolviendo(apt.id);
    try {
      await devolverSena(apt.id, negocioDe(apt));
    } catch (err) {
      console.error('[Citas] No se pudo devolver la seña:', err);
      alert('No se pudo devolver: ' + err.message);
    } finally {
      setDevolviendo('');
    }
  };

  const updateStatus = (apt, status) => {
    updateAppointment(negocioDe(apt), apt.id, { status }).catch((err) => {
      console.error('[AppointmentsPage] No se pudo actualizar el turno:', err);
      alert('No se pudo actualizar el turno: ' + err.message);
    });
  };

  const handleCancel = (apt) => {
    if (window.confirm('¿Cancelar esta cita?')) {
      cancelAppointment(negocioDe(apt), apt.id).catch((err) => {
        console.error('[AppointmentsPage] No se pudo cancelar:', err);
        alert('No se pudo cancelar el turno: ' + err.message);
      });
    }
  };

  // Los mismos botones para la tabla (escritorio) y las tarjetas (celular).
  const accionesDe = (apt) => {
    const started = isAppointmentStarted(apt);
    const blockedMsg = 'El turno todavía no comenzó';
    return (
      <div className="table-actions">
        {(apt.status === 'pendiente' || apt.status === 'confirmada') && (
          <>
            {/* Con palabras: el tilde y el fantasmita no se entendían, y
                marcar si vino o no es lo que más se toca en el día. */}
            <button
              className="btn btn-sm btn-primary"
              title={started ? 'El cliente vino y lo atendiste' : blockedMsg}
              onClick={() => started && updateStatus(apt, 'completada')}
              disabled={!started}
              style={!started ? { opacity: 0.35, cursor: 'not-allowed' } : {}}
            >Vino</button>
            <button
              className="btn btn-sm btn-outline"
              title={started ? 'El cliente no se presentó' : blockedMsg}
              onClick={() => started && updateStatus(apt, 'no_asistio')}
              disabled={!started}
              style={!started ? { opacity: 0.35, cursor: 'not-allowed' } : {}}
            >No vino</button>
            <button className="btn btn-ghost btn-sm" title="Cancelar el turno" onClick={() => handleCancel(apt)}>✕</button>
          </>
        )}
        {apt.status === 'pendiente' && (
          <button className="btn btn-sm btn-outline" title="Avisarle al cliente que el turno queda en pie" onClick={() => updateStatus(apt, 'confirmada')}>Confirmar</button>
        )}
        {apt.sena?.estado === 'pagada' && (
          <button className="btn btn-sm btn-ghost" disabled={devolviendo === apt.id}
            title="Devolverle la seña desde tu Mercado Pago" onClick={() => devolver(apt)}>
            {devolviendo === apt.id ? 'Devolviendo…' : 'Devolver seña'}
          </button>
        )}
      </div>
    );
  };

  return (
    <div>
      <div className="admin-page-header">
        <h1>{isOwner ? 'Citas' : 'Mis Citas'}</h1>
        <div className="flex items-center gap-md">
          <span className="badge badge-neutral">{filtered.length} resultado{filtered.length !== 1 ? 's' : ''}</span>
          {/* El barbero carga los turnos que le piden por WhatsApp o en persona,
              así la agenda online y la de siempre son la misma. */}
          <button className="btn btn-primary" onClick={() => setAgendando(true)}>
            + Agendar turno
          </button>
        </div>
      </div>

      {agendando && <NuevoTurnoModal onClose={() => setAgendando(false)} />}

      {/* Solapas de día: lo primero que se mira. */}
      <div className="citas-solapas">
        {[
          { id: 'hoy', label: 'Hoy', badge: cuantos.hoy },
          { id: 'proximos', label: 'Próximos', badge: cuantos.proximos },
          { id: 'todos', label: 'Todos', badge: null },
        ].map((s) => (
          <button
            key={s.id}
            className={`citas-solapa ${rango === s.id && !filterDate ? 'activa' : ''}`}
            onClick={() => { setRango(s.id); setFilterDate(''); }}
          >
            {s.label}
            {s.badge > 0 && <span className="citas-solapa-badge">{s.badge}</span>}
          </button>
        ))}
      </div>

      {/* Filtros */}
      <div className="filters-bar">
        {/* Con varias sucursales, ver las cuatro juntas o entrar a una, sin
            salir de la pantalla. */}
        <FiltroSucursal valor={sucFiltro} onChange={setSucFiltro} />
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
            {profesionalesVisibles.map(p => (
              <option key={`${p.__bizId || ''}-${p.id}`} value={p.id}>
                {p.name}{verTodas && p.__sucursal ? ` · ${p.__sucursal}` : ''}
              </option>
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
            onClick={() => { setFilterProf(''); setFilterStatus(''); setFilterDate(''); setRango('hoy'); }}
          >
            ✕ Limpiar
          </button>
        )}
      </div>

      {/* En el celular, tarjetas: una tabla de nueve columnas en 375px no se
          lee y deja las acciones fuera de la pantalla. */}
      <div className="citas-tarjetas solo-mobile">
        {filtered.map(apt => {
          const prof = profesionalesVisibles.find(p => p.id === apt.professionalId);
          const srv  = serviciosVisibles.find(s => s.id === apt.serviceId);
          const isWalkin = apt.type === 'walkin';
          const origen = origenTurno(apt);
          return (
            <div key={`${apt.__bizId || ''}-${apt.id}`} className={`card cita-tarjeta estado-${apt.status}`}>
              <div className="cita-tarjeta-fila">
                <div>
                  <div className="cita-tarjeta-hora">{apt.startTime}<span> — {apt.endTime}</span></div>
                  <div className="cita-tarjeta-dia">{fechaCorta(apt.appointmentDate)}</div>
                </div>
                <span className={`badge ${STATUS_BADGES[apt.status]}`}>{STATUS_LABELS[apt.status] || apt.status}</span>
              </div>
              <div className="cita-tarjeta-cliente">
                {isWalkin ? '✂️ Servicio sin turno' : (apt.clientName || 'Cliente')}
                {verTodas && apt.__sucursal && (
                  <span className="badge badge-neutral" style={{ fontSize: 10, marginLeft: 6 }}>{apt.__sucursal}</span>
                )}
              </div>
              <div className="text-sm text-muted" title={origen.detalle}>{origen.icono} {origen.etiqueta}</div>
              <div className="text-sm text-secondary">
                {isWalkin ? 'Horario bloqueado' : `${srv?.name || '—'} · ${formatPrice(apt.price, business?.currency)}`}
                {isOwner && prof && <> · {prof.name}</>}
              </div>
              {apt.clientPhone && !isWalkin && (
                <a className="text-sm" href={`tel:${apt.clientPhone}`} style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>📞 {apt.clientPhone}</a>
              )}
              {!isWalkin && <WhatsAppTurno turno={apt} business={business} servicio={srv} />}
              {accionesDe(apt)}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="empty-state">
            {vinculo.esBarbero && !vinculo.vinculado
              ? <p>⚠️ {textoVinculo(vinculo.motivo)} Pedile al dueño que te vincule desde Administradores.</p>
              : <p>No se encontraron citas con estos filtros</p>}
          </div>
        )}
      </div>

      <div className="card solo-desktop" style={{ padding: 0, overflow: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Día</th>
              <th>Hora</th>
              {verTodas && <th>Sucursal</th>}
              {isOwner && <th>Profesional</th>}
              <th>Cliente</th>
              <th>Lo reservó</th>
              <th className="oculta-mobile">Seña</th>
              <th>Teléfono</th>
              <th>WhatsApp</th>
              <th>Servicio</th>
              <th>Precio</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(apt => {
              const prof    = profesionalesVisibles.find(p => p.id === apt.professionalId);
              const srv     = serviciosVisibles.find(s => s.id === apt.serviceId);
              const isWalkin = apt.type === 'walkin';
              const origen  = origenTurno(apt);

              return (
                <tr key={`${apt.__bizId || ''}-${apt.id}`} style={isWalkin ? { background: 'var(--bg-secondary)', fontStyle: 'italic' } : {}}>
                  <td title={formatDate(apt.appointmentDate)}>
                    <strong>{fechaCorta(apt.appointmentDate)}</strong>
                  </td>
                  <td><strong style={{ fontSize: '1.05rem' }}>{apt.startTime}</strong> <span className="text-muted">— {apt.endTime}</span></td>
                  {verTodas && <td><span className="badge badge-neutral" style={{ fontSize: 11 }}>{apt.__sucursal}</span></td>}
                  {isOwner && <td>{prof?.name}</td>}
                  <td>
                    {isWalkin
                      ? <span className="flex items-center gap-sm"><span>✂️</span><span>Servicio sin turno</span></span>
                      : (apt.clientName || apt.userId)
                    }
                  </td>
                  <td>
                    <span className={`badge ${origen.clase}`} title={origen.detalle} style={{ fontSize: 11 }}>
                      {origen.icono} {origen.etiqueta}
                    </span>
                  </td>
                  <td className="oculta-mobile">{etiquetaSena(apt, business?.currency)}</td>
                  <td>{apt.clientPhone || '—'}</td>
                  <td>
                    {/* Abre WhatsApp con el mensaje escrito; lo manda el
                        barbero desde su número. No se envía nada solo. */}
                    {isWalkin ? <span className="text-muted">—</span> : <WhatsAppTurno turno={apt} business={business} servicio={srv} compacto />}
                  </td>
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
                  <td>{accionesDe(apt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="empty-state">
            {vinculo.esBarbero && !vinculo.vinculado
              ? <p>⚠️ {textoVinculo(vinculo.motivo)} Pedile al dueño que te vincule desde Administradores.</p>
              : <p>No se encontraron citas con estos filtros</p>}
          </div>
        )}
      </div>
    </div>
  );
}
