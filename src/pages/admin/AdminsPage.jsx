import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useBusiness } from '../../contexts/BusinessContext';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../hooks/useTenantData';

const ROLE_OPTIONS = [
  { value: 'owner', label: '👑 Dueño — acceso total' },
  { value: 'admin', label: '✂️ Peluquero — solo sus citas' },
];

const EMPTY_FORM = { email: '', role: 'admin', professionalId: '', name: '' };

export default function AdminsPage() {
  const { user } = useAuth();
  const { dispatch } = useBusiness();
  const { authorizedAdmins, professionals, businessId } = useTenant();

  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState(null); // null = nuevo, id = editar
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');

  // Solo el dueño entra acá. El corte va DESPUÉS de los hooks: si va antes,
  // React ve una cantidad distinta de hooks entre renders y explota cuando el
  // rol cambia en vivo (pasa al revocar permisos con la sesión abierta).
  if (user?.role !== 'owner') return <Navigate to="/admin" replace />;

  const openNew = () => {
    setForm(EMPTY_FORM);
    setEditTarget(null);
    setError('');
    setShowModal(true);
  };

  const openEdit = (admin) => {
    setForm({ email: admin.email, role: admin.role, professionalId: admin.professionalId || '', name: admin.name || '' });
    setEditTarget(admin.id);
    setError('');
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setError('');
  };

  const handleSave = () => {
    if (!form.email.trim()) return setError('El email es obligatorio.');
    if (!form.email.includes('@')) return setError('Ingresá un email válido.');
    if (form.role === 'admin' && !form.professionalId) return setError('Los peluqueros deben tener un profesional asignado.');

    // Verificar duplicado de email (solo en creación nueva)
    if (!editTarget) {
      const exists = authorizedAdmins.some(
        a => a.email.toLowerCase() === form.email.trim().toLowerCase()
      );
      if (exists) return setError('Ese email ya está registrado como administrador.');
    }

    if (editTarget) {
      dispatch({
        type: 'UPDATE_AUTHORIZED_ADMIN',
        payload: {
          id: editTarget,
          email: form.email.trim().toLowerCase(),
          role: form.role,
          professionalId: form.role === 'admin' ? form.professionalId : null,
          name: form.name.trim(),
        },
      });
    } else {
      dispatch({
        type: 'ADD_AUTHORIZED_ADMIN',
        payload: {
          id: 'auth-' + Date.now(),
          email: form.email.trim().toLowerCase(),
          role: form.role,
          businessId, // el admin nuevo pertenece al negocio activo
          professionalId: form.role === 'admin' ? form.professionalId : null,
          name: form.name.trim(),
          addedAt: new Date().toISOString(),
        },
      });
    }
    closeModal();
  };

  const handleRemove = (admin) => {
    // No permitir que el dueño se elimine a sí mismo
    if (admin.email.toLowerCase() === user.email.toLowerCase()) {
      alert('No podés eliminarte a vos mismo como dueño.');
      return;
    }
    if (window.confirm(`¿Quitar acceso a ${admin.email}?`)) {
      dispatch({ type: 'REMOVE_AUTHORIZED_ADMIN', payload: admin.id });
    }
  };

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1>Administradores</h1>
          <p className="text-secondary text-sm" style={{ marginTop: 4 }}>
            Gestioná quién puede acceder al panel. Solo los Gmail de esta lista tendrán acceso.
          </p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>+ Agregar</button>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Gmail autorizado</th>
              <th>Nombre</th>
              <th>Rol</th>
              <th>Profesional vinculado</th>
              <th>Agregado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {authorizedAdmins.map(admin => {
              const prof = professionals.find(p => p.id === admin.professionalId);
              const isMe = admin.email.toLowerCase() === user.email.toLowerCase();
              return (
                <tr key={admin.id}>
                  <td>
                    <div className="flex items-center gap-sm">
                      <span style={{ fontSize: 20 }}>{admin.role === 'owner' ? '👑' : '✂️'}</span>
                      <span>{admin.email}</span>
                      {isMe && <span className="badge badge-primary" style={{ fontSize: 10 }}>Vos</span>}
                    </div>
                  </td>
                  <td>{admin.name || '—'}</td>
                  <td>
                    <span className={`badge ${admin.role === 'owner' ? 'badge-primary' : 'badge-success'}`}>
                      {admin.role === 'owner' ? 'Dueño' : 'Peluquero'}
                    </span>
                  </td>
                  <td>{prof?.name || (admin.role === 'owner' ? '—' : <span className="text-muted">Sin asignar</span>)}</td>
                  <td className="text-sm text-secondary">
                    {admin.addedAt ? new Date(admin.addedAt).toLocaleDateString('es-AR') : '—'}
                  </td>
                  <td>
                    <div className="table-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => openEdit(admin)}>✏️</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => handleRemove(admin)} disabled={isMe}>🗑️</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {authorizedAdmins.length === 0 && (
          <div className="empty-state"><p>No hay administradores configurados.</p></div>
        )}
      </div>

      {/* Info box */}
      <div className="card" style={{ marginTop: 'var(--space-lg)', background: 'var(--primary-light)', border: '1px solid var(--primary)' }}>
        <h4 style={{ color: 'var(--primary)', marginBottom: 'var(--space-sm)' }}>ℹ️ ¿Cómo funciona?</h4>
        <ul style={{ paddingLeft: 'var(--space-lg)', color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.8 }}>
          <li>Cuando alguien inicia sesión con Google, su Gmail se compara contra esta lista.</li>
          <li><strong>Si está en la lista</strong> → accede al panel de administración con su rol.</li>
          <li><strong>Si no está</strong> → va al flujo normal de reserva de clientes.</li>
          <li><strong>Dueño</strong>: ve todas las citas, estadísticas globales y puede modificar todo.</li>
          <li><strong>Peluquero</strong>: solo ve las citas asignadas a su perfil de profesional.</li>
        </ul>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div className="modal-header">
              <h3>{editTarget ? 'Editar administrador' : 'Agregar administrador'}</h3>
              <button className="modal-close" onClick={closeModal}>✕</button>
            </div>
            <div className="modal-body">
              {error && (
                <div className="badge badge-danger mb-md" style={{ display: 'block', padding: '8px 12px', borderRadius: 8, marginBottom: 'var(--space-md)' }}>
                  {error}
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Gmail autorizado <span className="required">*</span></label>
                <input
                  className="form-input"
                  type="email"
                  placeholder="peluquero@gmail.com"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  autoFocus
                />
                <p className="text-xs text-muted" style={{ marginTop: 4 }}>
                  Debe ser el Gmail exacto con el que inicia sesión.
                </p>
              </div>

              <div className="form-group">
                <label className="form-label">Nombre (opcional)</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="Carlos Gómez"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Rol <span className="required">*</span></label>
                <select
                  className="form-input"
                  value={form.role}
                  onChange={e => setForm(f => ({ ...f, role: e.target.value, professionalId: '' }))}
                >
                  {ROLE_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              {form.role === 'admin' && (
                <div className="form-group">
                  <label className="form-label">Profesional vinculado <span className="required">*</span></label>
                  <select
                    className="form-input"
                    value={form.professionalId}
                    onChange={e => setForm(f => ({ ...f, professionalId: e.target.value }))}
                  >
                    <option value="">— Seleccioná un profesional —</option>
                    {professionals.filter(p => p.isActive).map(p => (
                      <option key={p.id} value={p.id}>{p.name} — {p.specialty}</option>
                    ))}
                  </select>
                  <p className="text-xs text-muted" style={{ marginTop: 4 }}>
                    El peluquero solo verá las citas asignadas a este perfil.
                  </p>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={closeModal}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSave}>
                {editTarget ? 'Guardar cambios' : 'Agregar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
