import { useEffect, useRef, useState } from 'react';
import { subscribeTicketMessages, addTicketMessage, markTicketRead } from '../lib/repository';

/**
 * Conversación de un ticket. La usan los dos lados: el panel de la barbería
 * (role="business") y el panel global (role="platform"). Lo único que cambia
 * es de qué lado se alinean los mensajes y con qué rol se firman.
 */
export default function TicketChat({ ticket, role, user, alto = 340 }) {
  const [mensajes, setMensajes] = useState([]);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const finRef = useRef(null);

  useEffect(() => {
    if (!ticket?.id) return;
    return subscribeTicketMessages(
      ticket.id,
      setMensajes,
      (err) => {
        console.error('[TicketChat] No se pudieron leer los mensajes:', err);
        setError('No se pudo cargar la conversación.');
      }
    );
  }, [ticket?.id]);

  // Al abrirlo deja de estar sin leer para quien lo mira.
  useEffect(() => {
    if (!ticket?.id) return;
    const sinLeer = role === 'platform' ? ticket.unreadForPlatform : ticket.unreadForBusiness;
    if (sinLeer) markTicketRead(ticket.id, role).catch(() => {});
  }, [ticket?.id, ticket?.unreadForPlatform, ticket?.unreadForBusiness, role]);

  // Scroll al último mensaje cuando llega uno nuevo.
  useEffect(() => {
    finRef.current?.scrollIntoView({ block: 'end' });
  }, [mensajes.length]);

  const enviar = async (e) => {
    e.preventDefault();
    const limpio = texto.trim();
    if (!limpio || enviando) return;

    setEnviando(true);
    setError('');
    try {
      await addTicketMessage(ticket.id, {
        text: limpio,
        author: { id: user.id, name: user.name },
        role,
      });
      setTexto('');
    } catch (err) {
      console.error('[TicketChat] No se pudo enviar:', err);
      setError('No se pudo enviar el mensaje: ' + err.message);
    } finally {
      setEnviando(false);
    }
  };

  const cerrado = ticket?.status === 'cerrado';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
      <div
        style={{
          height: alto,
          overflowY: 'auto',
          padding: 'var(--space-md)',
          background: 'var(--bg-secondary)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {mensajes.length === 0 && (
          <p className="text-muted" style={{ fontSize: 13, margin: 'auto' }}>
            Cargando conversación…
          </p>
        )}

        {mensajes.map((m) => {
          const propio = m.authorRole === role;
          return (
            <div
              key={m.id}
              style={{
                alignSelf: propio ? 'flex-end' : 'flex-start',
                maxWidth: '78%',
                background: propio ? 'var(--primary)' : 'var(--surface)',
                color: propio ? '#fff' : 'var(--text)',
                border: propio ? 'none' : '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                padding: '8px 12px',
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontFamily: 'var(--font-mono)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  opacity: 0.75,
                  marginBottom: 3,
                }}
              >
                {m.authorRole === 'platform' ? 'Soporte BarberOS' : m.authorName}
              </div>
              <div style={{ fontSize: 13.5, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{m.text}</div>
            </div>
          );
        })}
        <div ref={finRef} />
      </div>

      {error && <div className="notice notice-danger">{error}</div>}

      {cerrado ? (
        <p className="text-muted" style={{ fontSize: 12, textAlign: 'center' }}>
          Este ticket está cerrado. Si escribís, se reabre.
        </p>
      ) : null}

      <form onSubmit={enviar} style={{ display: 'flex', gap: 8 }}>
        <textarea
          className="form-input"
          rows={2}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Escribí tu mensaje…"
          style={{ margin: 0, resize: 'vertical', fontSize: 13.5 }}
          onKeyDown={(e) => {
            // Enter envía, Shift+Enter hace salto de línea.
            if (e.key === 'Enter' && !e.shiftKey) enviar(e);
          }}
        />
        <button type="submit" className="btn btn-primary" disabled={!texto.trim() || enviando}>
          {enviando ? '…' : 'Enviar'}
        </button>
      </form>
    </div>
  );
}
