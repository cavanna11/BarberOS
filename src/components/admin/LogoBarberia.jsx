import { useRef, useState } from 'react';
import { redimensionarLogo } from '../../utils/imagen';

// Mismo número que la landing y el resto del panel.
const LINK_AMPLIAR = 'https://wa.me/5492257529684?text=' +
  encodeURIComponent('Hola! Quiero poner mi logo en mi cuenta de BarberOS.');

/**
 * Subir el logo de la barbería.
 *
 * Va como data URL adentro del documento del negocio, igual que la foto del
 * barbero y por la misma razón: sin Firebase Storage, el logo viaja con los
 * datos que la página de reservas ya pide, sin una petición extra ni un bucket
 * que administrar. Se achica a 240 px y queda en PNG para no romper las
 * transparencias.
 *
 * `bloqueada` es para los planes que no lo incluyen: se muestra apagado y se
 * dice desde qué plan está, en vez de esconderlo. El permiso real está en las
 * Security Rules.
 */
export default function LogoBarberia({ value, nombre = '', onChange, bloqueada = false }) {
  const inputRef = useRef(null);
  const [error, setError] = useState('');
  const [procesando, setProcesando] = useState(false);

  const elegir = async (ev) => {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file) return;
    setError('');
    setProcesando(true);
    try {
      onChange(await redimensionarLogo(file));
    } catch (err) {
      setError(err.message);
    } finally {
      setProcesando(false);
    }
  };

  return (
    <div className="form-group">
      <label className="form-label">Logo de la barbería</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div
          style={{
            width: 96, height: 56, borderRadius: 8, border: '1px solid var(--border)',
            background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center',
            justifyContent: 'center', overflow: 'hidden', flexShrink: 0,
          }}
        >
          {value
            ? <img src={value} alt={nombre} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
            : <span className="text-muted" style={{ fontSize: 11 }}>sin logo</span>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => inputRef.current?.click()}
            disabled={procesando || bloqueada}
          >
            {procesando ? 'Procesando…' : value ? 'Cambiar logo' : 'Subir logo'}
          </button>
          {value && !bloqueada && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(null)}>Quitar</button>
          )}
          <input ref={inputRef} type="file" accept="image/*" hidden onChange={elegir} />
        </div>
      </div>

      {bloqueada ? (
        <p className="text-sm text-muted" style={{ marginTop: 6 }}>
          El logo propio se incluye desde el <strong>Plan Full</strong>.{' '}
          <a href={LINK_AMPLIAR} target="_blank" rel="noreferrer" style={{ fontWeight: 700 }}>
            Escribinos y lo activamos
          </a>.
        </p>
      ) : (
        <p className="text-sm text-muted" style={{ marginTop: 6 }}>
          Se ve arriba de tu link público y en tu panel. PNG con fondo transparente queda mejor.
        </p>
      )}

      {error && <p className="text-sm" style={{ color: 'var(--danger)', marginTop: 4 }}>{error}</p>}
    </div>
  );
}
