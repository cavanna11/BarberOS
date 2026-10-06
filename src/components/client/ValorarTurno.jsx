import { useState } from 'react';
import { guardarResena } from '../../lib/repository';
import { linkGoogle } from '../../utils/resenas';
import { formatDate } from '../../utils/dateUtils';

const TEXTOS = {
  1: 'Muy malo',
  2: 'Malo',
  3: 'Más o menos',
  4: 'Bueno',
  5: 'Excelente',
};

/**
 * Valorar un turno: estrellas y, si quiere, un comentario.
 *
 * Reglas que NO viven acá sino en las Security Rules, porque acá se saltean:
 * solo se puede valorar un turno propio y marcado como completado, y hay una
 * sola reseña por turno (el id del documento ES el id del turno).
 *
 * Después de guardar se ofrece dejarla también en Google, si la barbería cargó
 * su link. Se le ofrece a TODOS, no solo a los que puntuaron alto: elegir a
 * quién pedirle la reseña según la nota es "review gating", está prohibido por
 * Google y puede costarle la ficha al negocio.
 */
export default function ValorarTurno({ turno, business, servicio, profesional, resenaPrevia = null, onClose, onGuardada }) {
  const [stars, setStars] = useState(resenaPrevia?.stars || 0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState(resenaPrevia?.comment || '');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [listo, setListo] = useState(false);

  const google = linkGoogle(business);
  const marcadas = hover || stars;

  const guardar = async () => {
    if (!stars || guardando) return;
    setGuardando(true);
    setError('');
    try {
      await guardarResena(business.id, turno, { stars, comment });
      onGuardada?.({ ...turno, stars, comment });
      setListo(true);
    } catch (err) {
      console.error('[ValorarTurno] No se pudo guardar la reseña:', err);
      setError(
        err.code === 'permission-denied'
          ? 'Este turno todavía no se puede valorar. Se habilita cuando la barbería lo marca como atendido.'
          : 'No se pudo guardar tu valoración: ' + err.message
      );
      setGuardando(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="modal-header">
          <h3>{listo ? '¡Gracias!' : '¿Qué tal estuvo tu experiencia?'}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {listo ? (
            <div style={{ textAlign: 'center' }}>
              <div className="estrellas-resumen" style={{ justifyContent: 'center', fontSize: 30 }}>
                {'★'.repeat(stars)}<span className="estrella-apagada">{'★'.repeat(5 - stars)}</span>
              </div>
              <p className="text-secondary" style={{ marginTop: 10 }}>
                Tu valoración le llega a {business?.name || 'la barbería'}. Gracias por tomarte el momento.
              </p>

              {google && (
                <div className="card" style={{ marginTop: 'var(--space-lg)', padding: 'var(--space-md)' }}>
                  <strong>¿Querés compartir tu experiencia en Google?</strong>
                  <p className="text-sm text-secondary" style={{ margin: '6px 0 12px' }}>
                    Se abre la ficha de {business?.name || 'la barbería'} en Google, aparte de acá.
                    Ayuda a que otros la encuentren.
                  </p>
                  <a
                    href={google}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-primary btn-full"
                    style={{ textDecoration: 'none' }}
                  >
                    Dejar reseña en Google →
                  </a>
                </div>
              )}
            </div>
          ) : (
            <>
              <p className="text-secondary text-sm" style={{ marginBottom: 'var(--space-md)' }}>
                {servicio?.name || 'Tu turno'}
                {profesional?.name ? ` con ${profesional.name}` : ''} · {formatDate(turno.appointmentDate)}
              </p>

              {error && <div className="notice notice-danger">{error}</div>}

              <div className="estrellas" onMouseLeave={() => setHover(0)}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`estrella ${n <= marcadas ? 'marcada' : ''}`}
                    onMouseEnter={() => setHover(n)}
                    onFocus={() => setHover(n)}
                    onClick={() => setStars(n)}
                    aria-label={`${n} ${n === 1 ? 'estrella' : 'estrellas'}`}
                  >
                    ★
                  </button>
                ))}
              </div>
              <div className="estrellas-texto">{marcadas ? TEXTOS[marcadas] : 'Tocá las estrellas'}</div>

              <div className="form-group" style={{ marginTop: 'var(--space-md)' }}>
                <label className="form-label">Contanos algo más (opcional)</label>
                <textarea
                  className="form-input"
                  rows={3}
                  value={comment}
                  maxLength={600}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Qué te gustó, qué mejorarías…"
                />
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          {listo ? (
            <button className="btn btn-outline" onClick={onClose}>Cerrar</button>
          ) : (
            <>
              <button className="btn btn-outline" onClick={onClose}>Ahora no</button>
              <button className="btn btn-primary" onClick={guardar} disabled={!stars || guardando}>
                {guardando ? 'Enviando…' : resenaPrevia ? 'Actualizar valoración' : 'Enviar valoración'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
