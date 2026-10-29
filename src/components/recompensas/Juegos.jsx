// ============================================================================
// Los tres juegos de sorteo: ruleta, caja sorpresa y rasca y ganá
// ============================================================================
// Ninguno decide nada. Los tres llaman a `jugarRecompensa`, el SERVIDOR sortea,
// y acá solo se anima hacia lo que salió. Cambian la animación y nada más: el
// premio que vuelve es el mismo objeto en los tres, y de ahí en adelante lo
// maneja el motor (Tus premios, la reserva, el vencimiento).
//
// Sensación buscada: una oportunidad, no un casino. Sin luces ni sonidos, una
// sola animación por juego, y el resultado dicho en palabras.
import { useEffect, useRef, useState } from 'react';
import { jugarRecompensa } from '../../lib/functions';
import { describirPremio } from '../../utils/recompensas';
import Rueda from './Rueda';
import Celebracion from './Celebracion';
import PantallaJuego from './PantallaJuego';
import { prefiereMenosMovimiento, fechaCorta, rotacionHacia } from './movimiento';

const GIRO_MS = 4800;

function Resultado({ resultado, onSeguir, textoSeguir }) {
  const { gano, premio } = resultado;
  // El botón que se tocó (Girar, Abrir, Raspar) desaparece: sin esto el foco
  // cae al body y con teclado o lector de pantalla el cliente queda perdido.
  const seguir = useRef(null);
  useEffect(() => { seguir.current?.focus(); }, []);
  return (
    <div className="juego-resultado" role="status">
      {gano && <Celebracion />}
      {gano ? (
        <>
          <div className="juego-premio-icono" style={{ background: premio.color }} aria-hidden="true">{premio.icono}</div>
          <p className="juego-premio-titulo">¡Ganaste {premio.nombre}!</p>
          <p className="juego-premio-detalle">
            {premio.tipo === 'personalizado' ? 'Te lo dan en la barbería.' : describirPremio(premio)}
            {premio.venceEn ? ` · Vale hasta el ${fechaCorta(premio.venceEn)}` : ''}
          </p>
          <p className="text-sm text-secondary">Quedó guardado en <strong>Tus premios</strong>.</p>
        </>
      ) : (
        <>
          <div className="juego-premio-icono neutro" aria-hidden="true">🙂</div>
          <p className="juego-premio-titulo">Esta vez no tocó</p>
          <p className="juego-premio-detalle">Seguí sumando: la próxima puede ser la tuya.</p>
        </>
      )}
      <button ref={seguir} type="button" className="btn btn-primary btn-lg" onClick={onSeguir}>{textoSeguir}</button>
    </div>
  );
}

// ── Ruleta ─────────────────────────────────────────────────────────────────

/**
 * Se ofrece justo antes de confirmar la reserva. `segmentos` vienen del espejo
 * público para dibujar la rueda antes de girar; los que vuelven del servidor
 * mandan (si el dueño la cambió en el medio, se anima con la que vale).
 */
export function RuletaJuego({ businessId, segmentos: iniciales = [], onGanado, onJugado, onCerrar, textoSeguir = 'Seguir con mi reserva' }) {
  const [segmentos, setSegmentos] = useState(iniciales);
  const [rotacion, setRotacion] = useState(0);
  const [estado, setEstado] = useState('listo'); // listo | pidiendo | girando | resultado | error
  const [resultado, setResultado] = useState(null);
  const [error, setError] = useState('');
  // En una ref: si el padre pasa una función nueva en cada render, el efecto
  // del giro se reiniciaría a mitad de camino.
  const ganado = useRef(onGanado);
  useEffect(() => { ganado.current = onGanado; }, [onGanado]);

  const girar = async () => {
    setEstado('pidiendo');
    setError('');
    try {
      const r = await jugarRecompensa({ businessId, tipo: 'ruleta' });
      // La tirada ya se gastó en el servidor, gane o no.
      onJugado?.();
      setSegmentos(r.segmentos);
      setResultado(r);
      if (prefiereMenosMovimiento()) {
        setRotacion(rotacionHacia(r.indice, r.segmentos.length, 0, 0));
        setEstado('resultado');
        if (r.gano) ganado.current?.(r.premio);
        return;
      }
      setEstado('girando');
      // Un frame después, para que el navegador pinte la rueda con la
      // transición puesta antes de cambiarle el ángulo.
      requestAnimationFrame(() => setRotacion((a) => rotacionHacia(r.indice, r.segmentos.length, a)));
    } catch (err) {
      setError(err.message || 'No se pudo girar la ruleta.');
      setEstado('error');
    }
  };

  useEffect(() => {
    if (estado !== 'girando') return undefined;
    const t = setTimeout(() => {
      setEstado('resultado');
      if (resultado?.gano) ganado.current?.(resultado.premio);
    }, GIRO_MS + 150);
    return () => clearTimeout(t);
  }, [estado, resultado]);

  return (
    <PantallaJuego
      titulo="🎡 Girá la ruleta"
      subtitulo="Antes de confirmar tu turno, probá suerte. Lo que ganes se aplica solo."
      onCerrar={onCerrar}
      bloqueado={estado === 'girando' || estado === 'pidiendo'}
    >
      <div className="ruleta-escena">
        <Rueda segmentos={segmentos} rotacion={rotacion} girando={estado === 'girando'} duracionMs={GIRO_MS} tamano={290} />
        {/* Para el lector de pantalla, lo que hay en la rueda dicho en texto. */}
        <p className="sr-only">Premios posibles: {segmentos.map((s) => s.nombre).join(', ')}.</p>
      </div>
      {estado === 'girando' && <p className="juego-estado" aria-live="polite">Girando…</p>}
      {estado === 'resultado' && resultado && (
        <Resultado resultado={resultado} onSeguir={onCerrar} textoSeguir={textoSeguir} />
      )}
      {(estado === 'listo' || estado === 'pidiendo' || estado === 'error') && (
        <div className="juego-acciones">
          {error && <div className="notice notice-danger" role="alert">{error}</div>}
          {estado !== 'error' && (
            <button type="button" className="btn btn-primary btn-lg juego-boton" onClick={girar} disabled={estado === 'pidiendo'}>
              {estado === 'pidiendo' ? 'Preparando…' : 'Girar'}
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onCerrar}>
            {estado === 'error' ? 'Cerrar' : 'Ahora no'}
          </button>
        </div>
      )}
    </PantallaJuego>
  );
}

// ── Caja sorpresa ──────────────────────────────────────────────────────────

export function CajaJuego({ businessId, onGanado, onCerrar }) {
  const [estado, setEstado] = useState('cerrada'); // cerrada | abriendo | abierta | error
  const [resultado, setResultado] = useState(null);
  const [error, setError] = useState('');

  const abrir = async () => {
    setEstado('abriendo');
    setError('');
    try {
      // La sacudida dura lo que tarda el servidor, y al menos lo suficiente
      // para que se note: si el servidor contesta en 80 ms, igual se sacude.
      const [r] = await Promise.all([
        jugarRecompensa({ businessId, tipo: 'caja' }),
        new Promise((ok) => setTimeout(ok, prefiereMenosMovimiento() ? 0 : 900)),
      ]);
      setResultado(r);
      setEstado('abierta');
      if (r.gano) onGanado?.(r.premio);
    } catch (err) {
      setError(err.message || 'No se pudo abrir la caja.');
      setEstado('error');
    }
  };

  return (
    <PantallaJuego titulo="🎁 Caja sorpresa" subtitulo="Abrila y mirá qué te tocó." onCerrar={onCerrar} bloqueado={estado === 'abriendo'}>
      <div className={`caja-escena ${estado}`}>
        <div className="caja" aria-hidden="true">
          <div className="caja-tapa"><span className="caja-mono" /></div>
          <div className="caja-cuerpo"><span className="caja-cinta" /></div>
          {estado === 'abierta' && resultado?.gano && (
            <div className="caja-premio" style={{ background: resultado.premio.color }}>{resultado.premio.icono}</div>
          )}
        </div>
      </div>
      {estado === 'abierta' && resultado && (
        <Resultado resultado={resultado} onSeguir={onCerrar} textoSeguir="Listo" />
      )}
      {estado !== 'abierta' && (
        <div className="juego-acciones">
          {error && <div className="notice notice-danger" role="alert">{error}</div>}
          {estado !== 'error' && (
            <button type="button" className="btn btn-primary btn-lg juego-boton" onClick={abrir} disabled={estado === 'abriendo'}>
              {estado === 'abriendo' ? 'Abriendo…' : 'Abrir la caja'}
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onCerrar} disabled={estado === 'abriendo'}>
            {estado === 'error' ? 'Cerrar' : 'Después'}
          </button>
        </div>
      )}
    </PantallaJuego>
  );
}

// ── Rasca y ganá ───────────────────────────────────────────────────────────

const UMBRAL_RASPADO = 0.5;

/**
 * La capa se raspa con el dedo o el mouse (Pointer Events: los dos con el
 * mismo código). Abajo está el resultado, que se pide al servidor al primer
 * toque: si se pidiera al abrir, cerrar sin raspar igual gastaría la tarjeta.
 *
 * Para teclado y lector de pantalla está "Raspar todo", que hace lo mismo sin
 * arrastrar nada.
 */
export function RascaJuego({ businessId, refTurno, onGanado, onCerrar }) {
  const lienzo = useRef(null);
  const raspando = useRef(false);
  const pedido = useRef(null);
  const trazos = useRef(0);
  const [resultado, setResultado] = useState(null);
  const [descubierta, setDescubierta] = useState(false);
  const [error, setError] = useState('');

  // La capa plateada, una vez.
  useEffect(() => {
    const c = lienzo.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    const { width, height } = c;
    const g = ctx.createLinearGradient(0, 0, width, height);
    g.addColorStop(0, '#b8b8b8');
    g.addColorStop(0.5, '#dcdcdc');
    g.addColorStop(1, '#a6a6a6');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#7a7a7a';
    ctx.font = 'bold 22px "Space Grotesk", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('RASPÁ ACÁ', width / 2, height / 2 + 8);
  }, []);

  const pedirResultado = () => {
    if (pedido.current) return pedido.current;
    pedido.current = jugarRecompensa({ businessId, tipo: 'rasca', ref: refTurno })
      .then((r) => {
        setResultado(r);
        if (r.gano) onGanado?.(r.premio);
        return r;
      })
      .catch((err) => {
        setError(err.message || 'No se pudo raspar la tarjeta.');
        throw err;
      });
    return pedido.current;
  };

  const descubrir = async () => {
    try { await pedirResultado(); } catch { return; }
    setDescubierta(true);
  };

  const proporcionRaspada = () => {
    const c = lienzo.current;
    const { data } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    let vacios = 0;
    // Un píxel de cada 16 alcanza para estimar, y no traba el dedo.
    for (let i = 3; i < data.length; i += 64) if (data[i] === 0) vacios++;
    return vacios / (data.length / 64);
  };

  const rascar = (e) => {
    if (!raspando.current || descubierta) return;
    const c = lienzo.current;
    const r = c.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * c.width;
    const y = ((e.clientY - r.top) / r.height) * c.height;
    const ctx = c.getContext('2d');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(x, y, 20, 0, Math.PI * 2);
    ctx.fill();
    trazos.current += 1;
    // Se mide de a ratos, no en cada movimiento.
    if (trazos.current % 12 === 0 && proporcionRaspada() > UMBRAL_RASPADO && resultado) setDescubierta(true);
  };

  return (
    <PantallaJuego titulo="🎫 Rasca y ganá" subtitulo="Gracias por venir. Raspá la tarjeta con el dedo." onCerrar={onCerrar}>
      <div className={`rasca-tarjeta ${descubierta ? 'descubierta' : ''}`}>
        <div className="rasca-fondo" aria-hidden={!descubierta}>
          {resultado ? (
            resultado.gano ? (
              <><span className="rasca-icono">{resultado.premio.icono}</span><strong>{resultado.premio.nombre}</strong></>
            ) : <><span className="rasca-icono">🙂</span><strong>Esta vez no</strong></>
          ) : <span className="text-secondary">…</span>}
        </div>
        <canvas
          ref={lienzo}
          width={300}
          height={150}
          className="rasca-capa"
          aria-hidden="true"
          onPointerDown={(e) => {
            raspando.current = true;
            e.currentTarget.setPointerCapture?.(e.pointerId);
            pedirResultado().catch(() => {});
            rascar(e);
          }}
          onPointerMove={rascar}
          onPointerUp={() => { raspando.current = false; }}
          onPointerCancel={() => { raspando.current = false; }}
        />
      </div>
      {error && <div className="notice notice-danger" role="alert">{error}</div>}
      {descubierta && resultado ? (
        <Resultado resultado={resultado} onSeguir={onCerrar} textoSeguir="Listo" />
      ) : (
        <div className="juego-acciones">
          <button type="button" className="btn btn-outline" onClick={descubrir}>Raspar todo</button>
        </div>
      )}
    </PantallaJuego>
  );
}
