import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { subscribePlatformTeam } from '../../lib/repository';
import { setPlatformModerator } from '../../lib/functions';

/**
 * Equipo de la plataforma: moderadores.
 *
 * Un moderador entra al panel global, ve todo y atiende soporte. No toca plata,
 * cuentas ni suspensiones. Lo hacen cumplir las Rules y las Cloud Functions;
 * el panel solo le esconde lo que no puede hacer.
 *
 * Solo el dueño de la plataforma ve esta pestaña y puede nombrar o quitar
 * moderadores. Un moderador no puede nombrar a otro.
 */
export default function TeamPanel() {
  const { user } = useAuth();
  const [miembros, setMiembros] = useState([]);
  const [form, setForm] = useState({ email: '', name: '' });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

  useEffect(() => {
    return subscribePlatformTeam(setMiembros, (err) => {
      console.error('[TeamPanel] No se pudo leer el equipo:', err);
    });
  }, []);

  const agregar = async (ev) => {
    ev.preventDefault();
    const email = form.email.trim().toLowerCase();
    if (!email.includes('@')) return setError('Ingresá un email válido.');
    if (email === user?.email?.toLowerCase()) return setError('Ese sos vos.');

    setGuardando(true);
    setError('');
    setAviso('');
    try {
      const res = await setPlatformModerator({ email, name: form.name.trim(), enabled: true });
      setAviso(
        res?.status === 'pending'
          ? `${email} todavía no entró nunca. El rol queda anotado y se activa en su primer login.`
          : `${email} ya es moderador. Tiene que cerrar sesión y volver a entrar para que le tome.`
      );
      setForm({ email: '', name: '' });
    } catch (err) {
      console.error('[TeamPanel] No se pudo nombrar al moderador:', err);
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  };

  const quitar = async (m) => {
    if (!window.confirm(`¿Quitarle el acceso al panel a ${m.email}?`)) return;
    setError('');
    setAviso('');
    try {
      await setPlatformModerator({ email: m.email, enabled: false });
      setAviso(`${m.email} ya no tiene acceso. Sus sesiones abiertas se cortaron.`);
    } catch (err) {
      console.error('[TeamPanel] No se pudo quitar al moderador:', err);
      setError(err.message);
    }
  };

  return (
    <div>
      <div className="card" style={{ marginBottom: 'var(--space-lg)' }}>
        <h3 style={{ marginBottom: 6 }}>Sumar un moderador</h3>
        <p className="text-secondary text-sm" style={{ marginBottom: 'var(--space-md)' }}>
          Entra a este panel, ve todas las barberías y atiende los tickets de
          soporte. <strong>No puede</strong> dar de alta cuentas, registrar pagos,
          cambiar planes ni suspender a nadie. Si entra con Google, poné su Gmail;
          si va a entrar con contraseña, creale la cuenta primero desde una
          barbería o pedime que lo hagamos.
        </p>

        {error && (
          <div className="badge badge-danger" style={{ display: 'block', padding: '8px 12px', borderRadius: 8, marginBottom: 'var(--space-md)' }}>
            {error}
          </div>
        )}
        {aviso && (
          <div className="notice notice-info" style={{ marginBottom: 'var(--space-md)' }}>{aviso}</div>
        )}

        <form onSubmit={agregar} style={{ display: 'grid', gridTemplateColumns: '2fr 1.5fr auto', gap: 12, alignItems: 'end' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Email</label>
            <input
              className="form-input"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="soporte@gmail.com"
            />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Nombre (opcional)</label>
            <input
              className="form-input"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Juan"
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={guardando}>
            {guardando ? 'Guardando…' : 'Nombrar'}
          </button>
        </form>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Nombre</th>
              <th>Rol</th>
              <th>Desde</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {miembros.map((m) => (
              <tr key={m.id}>
                <td>{m.email}</td>
                <td>{m.name || '—'}</td>
                <td><span className="badge badge-warning">Moderador</span></td>
                <td className="text-sm text-secondary">
                  {m.addedAt?.toDate ? m.addedAt.toDate().toLocaleDateString('es-AR') : '—'}
                </td>
                <td>
                  <button className="btn btn-ghost btn-sm" onClick={() => quitar(m)}>
                    Quitar acceso
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {miembros.length === 0 && (
          <div className="empty-state">
            <p>Todavía no hay moderadores. Sos el único con acceso al panel.</p>
          </div>
        )}
      </div>
    </div>
  );
}
