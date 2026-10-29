// ============================================================================
// Pantalla completa para los juegos (ruleta, caja, rasca)
// ============================================================================
// Un diálogo de verdad, no un div encima: `role="dialog"` con título, el foco
// entra al abrir y vuelve a donde estaba al cerrar, Tab no se escapa a la
// página de atrás, y Escape cierra — salvo mientras la ruleta gira: cerrar a
// mitad de giro dejaría al cliente sin ver qué ganó (el premio igual queda
// guardado, pero la sorpresa era el punto).
import { useEffect, useRef } from 'react';

export default function PantallaJuego({ titulo, subtitulo, onCerrar, bloqueado = false, children }) {
  const caja = useRef(null);
  const previo = useRef(null);

  useEffect(() => {
    previo.current = document.activeElement;
    const nodo = caja.current;
    const primero = nodo?.querySelector('button:not([disabled]), [tabindex="0"]');
    (primero || nodo)?.focus();
    // La página de atrás no scrollea mientras se juega.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
      previo.current?.focus?.();
    };
  }, []);

  const teclado = (e) => {
    if (e.key === 'Escape' && !bloqueado) {
      e.stopPropagation();
      onCerrar();
      return;
    }
    if (e.key !== 'Tab') return;
    const focoables = [...caja.current.querySelectorAll('button:not([disabled]), a[href], input, [tabindex="0"]')];
    if (!focoables.length) return;
    const primero = focoables[0];
    const ultimo = focoables[focoables.length - 1];
    if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
  };

  return (
    <div className="juego-pantalla" role="presentation" onKeyDown={teclado}>
      <div
        ref={caja}
        className="juego-caja"
        role="dialog"
        aria-modal="true"
        aria-labelledby="juego-titulo"
        tabIndex={-1}
      >
        <button
          type="button"
          className="juego-cerrar"
          onClick={onCerrar}
          disabled={bloqueado}
          aria-label="Cerrar"
        >
          ✕
        </button>
        <h2 id="juego-titulo" className="juego-titulo">{titulo}</h2>
        {subtitulo && <p className="juego-subtitulo">{subtitulo}</p>}
        {children}
      </div>
    </div>
  );
}
