import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useCurrentBusiness } from '../../hooks/useCurrentBusiness';
import { subscribeBusinessTickets, createTicket, TICKET_ESTADOS } from '../../lib/repository';
import TicketChat from '../../components/TicketChat';

const CATEGORIAS = [
  { value: 'consulta', label: 'Consulta — cómo hacer algo' },
  { value: 'problema', label: 'Problema — algo no funciona' },
  { value: 'facturacion', label: 'Facturación — abono, pagos, plan' },
  { value: 'sugerencia', label: 'Sugerencia — me gustaría que…' },
];

const COLOR_ESTADO = {
  abierto: 'badge-warning',
  respondido: 'badge-success',
  cerrado: 'badge-neutral',
};

/** Firestore devuelve Timestamp; hasta que el server confirma llega null. */
function fecha(ts) {
  if (!ts?.toDate) return 'recién';
  return ts.toDate().toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function SupportPage() {
  const { user } = useAuth();
  const { business, businessId } = useCurrentBusiness();

  const [tickets, setTickets] = useState([]);
  const [seleccionado, setSeleccionado] = useState(null);
  const [creando, setCreando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ subject: '', category: 'consulta', message: '' });

  useEffect(() => {
    if (!businessId) return;
    return subscribeBusinessTickets(businessId, setTickets, (err) => {
      console.error('[SupportPage] No se pudieron leer los tickets:', err);
      setError(
        err.code === 'failed-precondition'
          ? 'Firestore necesita crear un índice para esta consulta. Abrí la consola del navegador: el error trae un link directo para generarlo.'
          : 'No se pudo cargar el historial de tickets.'
      );
    });
  }, [businessId]);

  // Mantiene el ticket abierto sincronizado con la lista en vivo.
  const activo = seleccionado ? tickets.find((t) => t.id === seleccionado) || null : null;

  const abrirTicket = async (e) => {
    e.preventDefault();
    if (!form.subject.trim() || !form.message.trim() || enviando) return;

    setEnviando(true);
    setError('');
    try {
      const id = await createTicket({
        businessId,
        businessName: business?.name || '',
        subject: form.subject.trim(),
        category: form.category,
        message: form.message.trim(),
        author: { id: user.id, name: user.name },
      });
      setForm({ subject: '', category: 'consulta', message: '' });
      setCreando(false);
      setSeleccionado(id);
    } catch (err) {
      console.error('[SupportPage] No se pudo abrir el ticket:', err);
      setError('No se pudo abrir el ticket: ' + err.message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1>Soporte</h1>
          <span className="text-secondary text-sm" style={{ marginTop: 4, display: 'block' }}>
            Escribinos por acá. Queda todo registrado y con historial — no hace falta WhatsApp ni mail.
          </span>
        </div>
        {!creando && (
          <button className="btn btn-primary" onClick={() => { setCreando(true); setSeleccionado(null); }}>
            + Nueva consulta
          </button>
        )}
      </div>

      {error && <div className="notice notice-danger" style={{ marginBottom: 'var(--space-md)' }}>{error}</div>}

      {/* ── Formulario de alta ─────────────────────────────────────────── */}
      {creando && (
        <form className="card" onSubmit={abrirTicket} style={{ marginBottom: 'var(--space-lg)' }}>
          <h3 className="mb-lg">Nueva consulta</h3>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--space-md)' }}>
            <div className="form-group">
              <label className="form-label">Asunto <span className="required">*</span></label>
              <input
                className="form-input"
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
                placeholder="Ej: No me aparecen los turnos del sábado"
                autoFocus
              />
            </div>
            <div className="form-group">
              <label className="form-label">Tipo</label>
              <select
                className="form-input"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              >
                {CATEGORIAS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Contanos qué pasa <span className="required">*</span></label>
            <textarea
              className="form-input"
              rows={5}
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
              placeholder="Cuanto más detalle, más rápido lo resolvemos. Si es un problema, contanos qué hiciste antes de que pasara."
              style={{ resize: 'vertical' }}
            />
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-outline" onClick={() => setCreando(false)}>
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!form.subject.trim() || !form.message.trim() || enviando}
            >
              {enviando ? 'Enviando…' : 'Enviar consulta'}
            </button>
          </div>
        </form>
      )}

      {/* ── Lista + conversación ───────────────────────────────────────── */}
      {!creando && (
        <div style={{ display: 'grid', gridTemplateColumns: activo ? '320px 1fr' : '1fr', gap: 'var(--space-lg)' }}>
          <div className="card" style={{ padding: 0, overflow: 'hidden', alignSelf: 'start' }}>
            {tickets.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">💬</div>
                <p style={{ marginBottom: 'var(--space-md)' }}>
                  Todavía no abriste ninguna consulta. Cualquier duda o problema, escribinos por acá.
                </p>
                <button className="btn btn-primary" onClick={() => setCreando(true)}>
                  + Nueva consulta
                </button>
              </div>
            ) : (
              tickets.map((t) => (
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
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'start' }}>
                    <strong style={{ fontSize: 13.5 }}>{t.subject}</strong>
                    {t.unreadForBusiness && (
                      <span className="badge badge-danger" style={{ fontSize: 10 }}>nuevo</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                    <span className={`badge ${COLOR_ESTADO[t.status]}`} style={{ fontSize: 10 }}>
                      {TICKET_ESTADOS[t.status]}
                    </span>
                    <span className="text-muted" style={{ fontSize: 11 }}>{fecha(t.lastMessageAt)}</span>
                  </div>
                </button>
              ))
            )}
          </div>

          {activo && (
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 'var(--space-md)', gap: 12 }}>
                <div>
                  <h3>{activo.subject}</h3>
                  <span className="text-muted" style={{ fontSize: 12 }}>
                    Abierto el {fecha(activo.createdAt)}
                  </span>
                </div>
                <span className={`badge ${COLOR_ESTADO[activo.status]}`}>{TICKET_ESTADOS[activo.status]}</span>
              </div>
              <TicketChat ticket={activo} role="business" user={user} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
