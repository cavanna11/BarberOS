import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { subscribeAllTickets, setTicketStatus, TICKET_ESTADOS } from '../../lib/repository';
import TicketChat from '../../components/TicketChat';

const COLOR_ESTADO = {
  abierto: 'badge-warning',
  respondido: 'badge-success',
  cerrado: 'badge-neutral',
};

const CATEGORIA_LABEL = {
  consulta: 'Consulta',
  problema: 'Problema',
  facturacion: 'Facturación',
  sugerencia: 'Sugerencia',
};

function fecha(ts) {
  if (!ts?.toDate) return 'recién';
  return ts.toDate().toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Bandeja de entrada de soporte de toda la plataforma. */
export default function TicketsPanel() {
  const { user } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [seleccionado, setSeleccionado] = useState(null);
  const [filtro, setFiltro] = useState('pendientes');
  const [error, setError] = useState('');

  useEffect(() => {
    return subscribeAllTickets(setTickets, (err) => {
      console.error('[TicketsPanel] No se pudieron leer los tickets:', err);
      setError(
        err.code === 'failed-precondition'
          ? 'Falta un índice en Firestore. El error de la consola del navegador trae un link para crearlo con un clic.'
          : 'No se pudieron cargar los tickets: ' + err.message
      );
    });
  }, []);

  const visibles = tickets.filter((t) => {
    if (filtro === 'pendientes') return t.status !== 'cerrado';
    if (filtro === 'cerrados') return t.status === 'cerrado';
    return true;
  });

  const sinLeer = tickets.filter((t) => t.unreadForPlatform).length;
  const activo = seleccionado ? tickets.find((t) => t.id === seleccionado) || null : null;

  const cambiarEstado = async (id, status) => {
    try {
      await setTicketStatus(id, status);
    } catch (err) {
      console.error('[TicketsPanel] No se pudo cambiar el estado:', err);
      alert('No se pudo cambiar el estado: ' + err.message);
    }
  };

  return (
    <div>
      <div
        className="card"
        style={{ padding: 'var(--space-md)', marginBottom: 'var(--space-md)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
      >
        <div>
          <h3 style={{ margin: 0 }}>Soporte</h3>
          <p className="text-secondary" style={{ fontSize: 13, margin: '4px 0 0' }}>
            {sinLeer > 0
              ? `${sinLeer} ticket${sinLeer !== 1 ? 's' : ''} esperando respuesta.`
              : 'No hay tickets sin responder.'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[
            { id: 'pendientes', label: 'Pendientes' },
            { id: 'cerrados', label: 'Cerrados' },
            { id: 'todos', label: 'Todos' },
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => setFiltro(f.id)}
              className={`btn ${filtro === f.id ? 'btn-primary' : 'btn-outline'} btn-sm`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="notice notice-danger" style={{ marginBottom: 'var(--space-md)' }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: activo ? '340px 1fr' : '1fr', gap: 'var(--space-lg)' }}>
        <div className="card" style={{ padding: 0, overflow: 'hidden', alignSelf: 'start' }}>
          {visibles.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">📨</div>
              <p>
                {filtro === 'pendientes'
                  ? 'Ningún ticket pendiente. Todo respondido.'
                  : 'No hay tickets en esta vista.'}
              </p>
            </div>
          ) : (
            visibles.map((t) => (
              <button
                key={t.id}
                onClick={() => setSeleccionado(t.id)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: 'var(--space-md)',
                  border: 'none',
                  borderBottom: '1px solid var(--border)',
                  borderLeft: t.id === seleccionado ? '3px solid var(--primary)' : '3px solid transparent',
                  background: t.id === seleccionado ? 'var(--primary-light)' : 'transparent',
                  cursor: 'pointer',
                }}
              >
                {/* Qué barbería es, primero: es lo que más importa acá. */}
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    color: 'var(--primary)',
                    marginBottom: 4,
                  }}
                >
                  {t.businessName || t.businessId}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'start' }}>
                  <strong style={{ fontSize: 13.5 }}>{t.subject}</strong>
                  {t.unreadForPlatform && (
                    <span className="badge badge-danger" style={{ fontSize: 10 }}>nuevo</span>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
                  <span className={`badge ${COLOR_ESTADO[t.status]}`} style={{ fontSize: 10 }}>
                    {TICKET_ESTADOS[t.status]}
                  </span>
                  <span className="badge badge-neutral" style={{ fontSize: 10 }}>
                    {CATEGORIA_LABEL[t.category] || t.category}
                  </span>
                  <span className="text-muted" style={{ fontSize: 11 }}>{fecha(t.lastMessageAt)}</span>
                </div>
              </button>
            ))
          )}
        </div>

        {activo && (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 'var(--space-md)', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    color: 'var(--primary)',
                  }}
                >
                  {activo.businessName}
                </div>
                <h3 style={{ marginTop: 2 }}>{activo.subject}</h3>
                <span className="text-muted" style={{ fontSize: 12 }}>
                  ID del negocio: <code>{activo.businessId}</code> · abierto el {fecha(activo.createdAt)}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {activo.status === 'cerrado' ? (
                  <button className="btn btn-outline btn-sm" onClick={() => cambiarEstado(activo.id, 'abierto')}>
                    Reabrir
                  </button>
                ) : (
                  <button className="btn btn-outline btn-sm" onClick={() => cambiarEstado(activo.id, 'cerrado')}>
                    Cerrar ticket
                  </button>
                )}
              </div>
            </div>

            <TicketChat ticket={activo} role="platform" user={user} alto={400} />
          </div>
        )}
      </div>
    </div>
  );
}
