import { useRef, useState } from 'react';
import { redimensionarImagen } from '../../utils/imagen';

/**
 * Selector de foto de perfil: muestra la actual (o las iniciales), y un botón
 * para cambiarla o quitarla. Devuelve por `onChange` el data URL listo para
 * guardar en `avatarUrl`, o null para quitarla.
 */
export default function FotoPerfil({ value, nombre = '', onChange }) {
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
      onChange(await redimensionarImagen(file));
    } catch (err) {
      setError(err.message);
    } finally {
      setProcesando(false);
    }
  };

  const iniciales = nombre.trim().split(/\s+/).map((n) => n[0]).join('').slice(0, 2).toUpperCase() || '?';

  return (
    <div className="form-group">
      <label className="form-label">Foto de perfil</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div className="avatar avatar-lg" style={{ overflow: 'hidden' }}>
          {value ? <img src={value} alt={nombre} /> : iniciales}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => inputRef.current?.click()} disabled={procesando}>
            {procesando ? 'Procesando…' : value ? 'Cambiar foto' : 'Subir foto'}
          </button>
          {value && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(null)}>Quitar</button>
          )}
          <input ref={inputRef} type="file" accept="image/*" hidden onChange={elegir} />
        </div>
      </div>
      <p className="text-sm text-muted" style={{ marginTop: 6 }}>
        Se ve en la página de reserva. Cuadrada y con la cara bien visible queda mejor.
      </p>
      {error && <p className="text-sm" style={{ color: 'var(--danger)', marginTop: 4 }}>{error}</p>}
    </div>
  );
}
