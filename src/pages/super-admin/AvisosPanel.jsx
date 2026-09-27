import { useEffect, useState } from 'react';
import { subscribeAvisos, publicarAviso, actualizarAviso, borrarAviso } from '../../lib/repository';
import { useAuth } from '../../contexts/AuthContext';

/**
 * Avisos para todas las barberías.
 *
 * Reemplaza el "le escribo por WhatsApp a cada uno": se publica una vez y
 * aparece arriba del panel de cada dueño y cada barbero, con un botón opcional
 * que los lleva adonde tienen que ir.
 */

const TIPOS = [
  { id: 'info', label: 'Novedad', ayuda: 'Algo nuevo que pueden usar. No hay que hacer nada.' },
  { id: 'accion', label: 'Hay que hacer algo', ayuda: 'Les pedís una acción, como volver a activar los avisos.' },
  { id: 'urgente', label: 'Urgente', ayuda: 'Algo se rompió o vence. Se muestra en rojo.' },
];

// Atajos para lo que se repite. El link es interno: la app navega sin salir.
const PLANTILLAS = [
  {
    nombre: 'Reactivar los avisos',
    titulo: 'Volvé a activar los avisos en tu celular',
    cuerpo: 'Mejoramos las notificaciones y hay que activarlas de nuevo, una sola vez por teléfono. Te toma menos de un minuto.',
    tipo: 'accion',
    ctaTexto: 'Activar ahora',
    ctaUrl: '/admin/instalar',
  },
  {
    nombre: 'Instalar la app',
    titulo: 'Instalá BarberOS en tu celular',
    cuerpo: 'Se agrega como una app más y te avisa al instante cuando te reservan un turno.',
    tipo: 'info',
    ctaTexto: 'Ver cómo',
    ctaUrl: '/admin/instalar',
  },
];

const VACIO = { titulo: '', cuerpo: '', tipo: 'info', ctaTexto: '', ctaUrl: '' };

export default function AvisosPanel() {
  const { user } = useAuth();
  const [avisos, setAvisos] = useState([]);
  const [form, setForm] = useState(VACIO);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

  useEffect(() => {
    return subscribeAvisos(setAvisos, (err) => console.error('[AvisosPanel] No se pudo leer:', err));
  }, []);

  const editar = (patch) => setForm((f) => ({ ...f, ...patch }));

  const publicar = async (ev) => {
    ev.preventDefault();
    if (!form.titulo.trim()) return setError('Poné un título: es lo único que seguro van a leer.');
    if (form.ctaTexto.trim() && !form.ctaUrl.trim()) return setError('Si ponés botón, poné adónde lleva.');

    setGuardando(true);
    setError('');
    setAviso('');
    try {
      await publicarAviso({
        titulo: form.titulo.trim(),
        cuerpo: form.cuerpo.trim(),
        tipo: form.tipo,
        ctaTexto: form.ctaTexto.trim(),
        ctaUrl: form.ctaUrl.trim(),
        creadoPor: user?.email || '',
      });
      setForm(VACIO);
      setAviso('Publicado. Lo van a ver la próxima vez que abran el panel.');
    } catch (err) {
      console.error('[AvisosPanel] No se pudo publicar:', err);
      setError('No se pudo publicar: ' + err.message);
    } finally {
      setGuardando(false);
    }
  };

  const alternar = async (a) => {
    try { await actualizarAviso(a.id, { activo: a.activo === false }); }
    catch (err) { setError('No se pudo cambiar: ' + err.message); }
  };

  const eliminar = async (a) => {
    if (!window.confirm(`¿Borrar el aviso "${a.titulo}"?`)) return;
    try { await borrarAviso(a.id); }
    catch (err) { setError('No se pudo borrar: ' + err.message); }
  };

  const activos = avisos.filter((a) => a.activo !== false).length;

  return (
    <div>
      <div className="card" style={{ marginBottom: 'var(--space-lg)' }}>
        <h3 style={{ marginBottom: 6 }}>Avisar a todas las barberías</h3>
        <p className="text-secondary text-sm" style={{ marginBottom: 'var(--space-md)' }}>
          Aparece arriba del panel de cada dueño y cada barbero, con un botón opcional.
          Cada uno lo cierra cuando lo leyó. Sirve para lo que hoy mandás por WhatsApp uno por uno.
          {activos > 0 && <> Hay <strong>{activos}</strong> activo{activos !== 1 && 's'}: se muestra el más reciente.</>}
        </p>

        {error && <div className="notice notice-danger" style={{ marginBottom: 'var(--space-md)' }}>{error}</div>}
        {aviso && <div className="notice notice-info" style={{ marginBottom: 'var(--space-md)' }}>{aviso}</div>}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 'var(--space-md)' }}>
          <span className="text-sm text-muted" style={{ alignSelf: 'center' }}>Atajos:</span>
          {PLANTILLAS.map((p) => (
            <button key={p.nombre} type="button" className="btn btn-outline btn-sm"
              onClick={() => { const { nombre, ...datos } = p; void nombre; setForm({ ...VACIO, ...datos }); }}>
              {p.nombre}
            </button>
          ))}
        </div>

        <form onSubmit={publicar}>
          <div className="form-group">
            <label className="form-label">Título <span className="required">*</span></label>
            <input className="form-input" value={form.titulo} maxLength={90}
              onChange={(e) => editar({ titulo: e.target.value })}
              placeholder="Volvé a activar los avisos en tu celular" />
          </div>

          <div className="form-group">
            <label className="form-label">Detalle</label>
            <textarea className="form-input" value={form.cuerpo} maxLength={300} rows={3}
              onChange={(e) => editar({ cuerpo: e.target.value })}
              placeholder="Mejoramos las notificaciones y hay que activarlas de nuevo, una sola vez por teléfono." />
          </div>

          <div className="form-group">
            <label className="form-label">Tipo</label>
            <select className="form-input" value={form.tipo} onChange={(e) => editar({ tipo: e.target.value })} style={{ maxWidth: 260 }}>
              {TIPOS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            <p className="text-sm text-muted" style={{ marginTop: 6 }}>
              {TIPOS.find((t) => t.id === form.tipo)?.ayuda}
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">Texto del botón (opcional)</label>
              <input className="form-input" value={form.ctaTexto} maxLength={30}
                onChange={(e) => editar({ ctaTexto: e.target.value })} placeholder="Activar ahora" />
            </div>
            <div className="form-group">
              <label className="form-label">Adónde lleva</label>
              <input className="form-input" value={form.ctaUrl}
                onChange={(e) => editar({ ctaUrl: e.target.value })} placeholder="/admin/instalar" />
            </div>
          </div>

          <button type="submit" className="btn btn-primary" disabled={guardando}>
            {guardando ? 'Publicando…' : 'Publicar para todas las barberías'}
          </button>
        </form>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Aviso</th>
              <th className="oculta-mobile">Tipo</th>
              <th className="oculta-mobile">Publicado</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {avisos.map((a) => (
              <tr key={a.id}>
                <td>
                  <strong>{a.titulo}</strong>
                  {a.cuerpo && <div className="text-sm text-secondary">{a.cuerpo}</div>}
                </td>
                <td className="oculta-mobile">{TIPOS.find((t) => t.id === a.tipo)?.label || 'Novedad'}</td>
                <td className="text-sm text-secondary oculta-mobile">
                  {a.createdAt?.toDate ? a.createdAt.toDate().toLocaleDateString('es-AR') : '—'}
                </td>
                <td>
                  <span className={`badge ${a.activo === false ? 'badge-neutral' : 'badge-success'}`}>
                    {a.activo === false ? 'Apagado' : 'Mostrándose'}
                  </span>
                </td>
                <td>
                  <div className="table-actions">
                    <button className="btn btn-outline btn-sm" onClick={() => alternar(a)}>
                      {a.activo === false ? 'Volver a mostrar' : 'Dejar de mostrar'}
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => eliminar(a)}>🗑️</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {avisos.length === 0 && (
          <div className="empty-state"><p>Todavía no publicaste ningún aviso.</p></div>
        )}
      </div>
    </div>
  );
}
