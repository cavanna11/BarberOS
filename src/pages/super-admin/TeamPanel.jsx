import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { subscribePlatformTeam } from '../../lib/repository';
import { setPlatformModerator } from '../../lib/functions';

/**
 * Equipo de la plataforma. Dos roles:
 *
 *   moderator → entra al panel global, ve todo y atiende soporte. No toca
 *               plata, cuentas ni suspensiones.
 *   admin     → acceso total: altas, cobros, planes, suspensiones, borrar
 *               barberías y nombrar a otros del equipo. Lo mismo que vos.
 *
 * Quien manda es el claim (`platform: true` o `'moderator'`): las Rules y las
 * Cloud Functions se apoyan en eso, no en esta lista. Solo un administrador
 * puede nombrar, ascender o quitar; un moderador no.
 */

const ROLES = {
  moderator: {
    etiqueta: 'Moderador',
    clase: 'badge-warning',
    resumen: 'Ve todo y atiende soporte. No toca plata, cuentas ni suspensiones.',
  },
  admin: {
    etiqueta: 'Administrador',
    clase: 'badge-primary',
    resumen: 'Acceso total: altas, cobros, planes, suspensiones y borrar barberías.',
  },
};

const rolDe = (m) => (m.role === 'admin' ? 'admin' : 'moderator');

export default function TeamPanel() {
  const { user } = useAuth();
  const [miembros, setMiembros] = useState([]);
  const [form, setForm] = useState({ email: '', name: '', rol: 'moderator' });
  const [guardando, setGuardando] = useState(false);
  const [trabajando, setTrabajando] = useState('');
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
    if (form.rol === 'admin' && !window.confirm(
      `${email} va a tener ACCESO TOTAL al panel global: dar de alta y borrar barberías, ` +
      'cobrar, cambiar planes, suspender cuentas y nombrar a otros del equipo.\n\n¿Seguimos?'
    )) return;

    setGuardando(true);
    setError('');
    setAviso('');
    try {
      const res = await setPlatformModerator({ email, name: form.name.trim(), enabled: true, rol: form.rol });
      const etiqueta = ROLES[form.rol].etiqueta.toLowerCase();
      setAviso(
        res?.status === 'pending'
          ? `${email} todavía no entró nunca. El rol de ${etiqueta} queda anotado y se activa en su primer login.`
          : `${email} ya es ${etiqueta}. Tiene que volver a iniciar sesión para que le tome.`
      );
      setForm({ email: '', name: '', rol: 'moderator' });
    } catch (err) {
      console.error('[TeamPanel] No se pudo nombrar:', err);
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  };

  /** Ascender a administrador o bajar a moderador, sin volver a cargar nada. */
  const cambiarRol = async (m) => {
    const actual = rolDe(m);
    const nuevo = actual === 'admin' ? 'moderator' : 'admin';
    const pregunta = nuevo === 'admin'
      ? `Dejar a ${m.email} con ACCESO TOTAL: altas, cobros, planes, suspensiones, borrar barberías y nombrar a otros.\n\n¿Seguimos?`
      : `Bajar a ${m.email} a moderador: va a poder mirar y atender soporte, nada más.\n\n¿Seguimos?`;
    if (!window.confirm(pregunta)) return;

    setTrabajando(m.email);
    setError('');
    setAviso('');
    try {
      await setPlatformModerator({ email: m.email, name: m.name || '', enabled: true, rol: nuevo });
      setAviso(`${m.email} ahora es ${ROLES[nuevo].etiqueta.toLowerCase()}. Se le cerró la sesión: al volver a entrar le toma el rol nuevo.`);
    } catch (err) {
      console.error('[TeamPanel] No se pudo cambiar el rol:', err);
      setError(err.message);
    } finally {
      setTrabajando('');
    }
  };

  const quitar = async (m) => {
    if (!window.confirm(`¿Quitarle el acceso al panel a ${m.email}?`)) return;
    setError('');
    setAviso('');
    setTrabajando(m.email);
    try {
      await setPlatformModerator({ email: m.email, enabled: false });
      setAviso(`${m.email} ya no tiene acceso. Sus sesiones abiertas se cortaron.`);
    } catch (err) {
      console.error('[TeamPanel] No se pudo quitar el acceso:', err);
      setError(err.message);
    } finally {
      setTrabajando('');
    }
  };

  return (
    <div>
      <div className="card" style={{ marginBottom: 'var(--space-lg)' }}>
        <h3 style={{ marginBottom: 6 }}>Sumar a alguien al equipo</h3>
        <p className="text-secondary text-sm" style={{ marginBottom: 'var(--space-md)' }}>
          Si entra con Google, poné su Gmail; si va a entrar con contraseña, creale la cuenta
          primero desde una barbería o pedímelo. Si nunca usó BarberOS, el rol queda anotado y
          se activa solo en su primer login.
        </p>

        {error && (
          <div className="badge badge-danger" style={{ display: 'block', padding: '8px 12px', borderRadius: 8, marginBottom: 'var(--space-md)' }}>
            {error}
          </div>
        )}
        {aviso && (
          <div className="notice notice-info" style={{ marginBottom: 'var(--space-md)' }}>{aviso}</div>
        )}

        <form onSubmit={agregar} className="equipo-form">
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
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Rol</label>
            <select
              className="form-input"
              value={form.rol}
              onChange={(e) => setForm((f) => ({ ...f, rol: e.target.value }))}
            >
              <option value="moderator">Moderador</option>
              <option value="admin">Administrador</option>
            </select>
          </div>
          <button type="submit" className="btn btn-primary" disabled={guardando}>
            {guardando ? 'Guardando…' : 'Nombrar'}
          </button>
        </form>

        <p className="text-sm text-muted" style={{ marginTop: 10 }}>
          <strong>{ROLES[form.rol].etiqueta}:</strong> {ROLES[form.rol].resumen}
        </p>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Email</th>
              <th className="oculta-mobile">Nombre</th>
              <th>Rol</th>
              <th className="oculta-mobile">Desde</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {miembros.map((m) => {
              const rol = rolDe(m);
              const ocupado = trabajando === m.email;
              return (
                <tr key={m.id}>
                  <td>{m.email}</td>
                  <td className="oculta-mobile">{m.name || '—'}</td>
                  <td><span className={`badge ${ROLES[rol].clase}`}>{ROLES[rol].etiqueta}</span></td>
                  <td className="text-sm text-secondary oculta-mobile">
                    {m.addedAt?.toDate ? m.addedAt.toDate().toLocaleDateString('es-AR') : '—'}
                  </td>
                  <td>
                    <div className="table-actions">
                      <button className="btn btn-outline btn-sm" disabled={ocupado} onClick={() => cambiarRol(m)}>
                        {rol === 'admin' ? 'Pasar a moderador' : 'Hacer administrador'}
                      </button>
                      <button className="btn btn-ghost btn-sm" disabled={ocupado} onClick={() => quitar(m)}>
                        Quitar acceso
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {miembros.length === 0 && (
          <div className="empty-state">
            <p>Todavía no hay nadie en el equipo. Sos el único con acceso al panel.</p>
          </div>
        )}
      </div>
    </div>
  );
}
