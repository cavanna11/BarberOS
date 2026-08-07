import { useState } from 'react';
import { useBusiness } from '../../contexts/BusinessContext';
import { useTenant } from '../../hooks/useTenantData';
import { formatPrice, generateId } from '../../utils/dateUtils';

export default function ServicesPage() {
  const { dispatch } = useBusiness();
  const { services, professionals, professionalServices, business } = useTenant();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', description: '', durationMinutes: 30, price: 0, category: '' });
  const [assignedProfs, setAssignedProfs] = useState([]);

  const openAdd = () => {
    setEditing(null);
    setForm({ name: '', description: '', durationMinutes: 30, price: 0, category: '' });
    setAssignedProfs([]);
    setShowModal(true);
  };

  const openEdit = (srv) => {
    setEditing(srv);
    setForm({ name: srv.name, description: srv.description || '', durationMinutes: srv.durationMinutes, price: srv.price, category: srv.category || '' });
    const assigned = professionalServices.filter(ps => ps.serviceId === srv.id).map(ps => ps.professionalId);
    setAssignedProfs(assigned);
    setShowModal(true);
  };

  const toggleProf = (profId) => {
    setAssignedProfs(prev => prev.includes(profId) ? prev.filter(id => id !== profId) : [...prev, profId]);
  };

  const handleSave = () => {
    if (!form.name || !form.price) return;
    const serviceId = editing?.id || generateId();

    if (editing) {
      dispatch({ type: 'UPDATE_SERVICE', payload: { id: serviceId, ...form } });
    } else {
      dispatch({
        type: 'ADD_SERVICE',
        payload: { id: serviceId, businessId: business.id, ...form, imageUrl: null, displayOrder: services.length + 1, isActive: true },
      });
    }

    // Reasignar qué profesionales prestan este servicio
    dispatch({
      type: 'SET_SERVICE_PROFESSIONALS',
      payload: {
        serviceId,
        assignments: assignedProfs.map(profId => ({
          id: generateId(),
          professionalId: profId,
          serviceId,
          customPrice: null,
          customDuration: null,
        })),
      },
    });

    setShowModal(false);
  };

  const handleDelete = (id) => {
    if (window.confirm('¿Eliminar este servicio?')) {
      dispatch({ type: 'DELETE_SERVICE', payload: id });
    }
  };

  return (
    <div>
      <div className="admin-page-header">
        <h1>Servicios</h1>
        <button className="btn btn-primary" onClick={openAdd}>+ Agregar Servicio</button>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Servicio</th>
              <th>Duración</th>
              <th>Precio</th>
              <th>Profesionales</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {services.map(srv => {
              const srvProfs = professionalServices
                .filter(ps => ps.serviceId === srv.id)
                .map(ps => professionals.find(p => p.id === ps.professionalId)?.name)
                .filter(Boolean);
              return (
                <tr key={srv.id}>
                  <td>
                    <div>
                      <strong>{srv.name}</strong>
                      {srv.category && <div className="text-sm text-muted">{srv.category}</div>}
                    </div>
                  </td>
                  <td>{srv.durationMinutes} min</td>
                  <td><strong>{formatPrice(srv.price, business.currency)}</strong></td>
                  <td><span className="text-sm text-secondary">{srvProfs.join(', ')}</span></td>
                  <td><span className={`badge ${srv.isActive ? 'badge-success' : 'badge-neutral'}`}>{srv.isActive ? 'Activo' : 'Inactivo'}</span></td>
                  <td>
                    <div className="table-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => openEdit(srv)}>✏️</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(srv.id)}>🗑️</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {services.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon">✂️</div>
            <p style={{ marginBottom: 'var(--space-md)' }}>
              Todavía no hay servicios en el catálogo. El cliente elige uno al
              reservar, así que sin servicios no se puede tomar ningún turno.
            </p>
            <button className="btn btn-primary" onClick={openAdd}>+ Agregar el primero</button>
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editing ? 'Editar Servicio' : 'Nuevo Servicio'}</h2>
              <button className="modal-close" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="flex flex-col gap-md">
                <div className="form-group">
                  <label className="form-label">Nombre <span className="required">*</span></label>
                  <input className="form-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ej: Corte Clásico" />
                </div>
                <div className="form-group">
                  <label className="form-label">Descripción</label>
                  <textarea className="form-input" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Descripción del servicio" />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
                  <div className="form-group">
                    <label className="form-label">Duración (min) <span className="required">*</span></label>
                    <input className="form-input" type="number" value={form.durationMinutes} onChange={e => setForm({ ...form, durationMinutes: parseInt(e.target.value) || 0 })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Precio <span className="required">*</span></label>
                    <input className="form-input" type="number" value={form.price} onChange={e => setForm({ ...form, price: parseFloat(e.target.value) || 0 })} />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Categoría</label>
                  <input className="form-input" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="Ej: Cortes, Barba, Tratamientos" />
                </div>

                <h3 style={{ marginTop: 'var(--space-sm)' }}>Asignar a Profesionales</h3>
                <div className="flex flex-col gap-sm">
                  {professionals.filter(p => p.isActive).map(prof => (
                    <label key={prof.id} className="flex items-center gap-sm" style={{ cursor: 'pointer', padding: '8px 0' }}>
                      <input type="checkbox" checked={assignedProfs.includes(prof.id)} onChange={() => toggleProf(prof.id)} />
                      <div className="avatar avatar-sm">{prof.name.split(' ').map(n => n[0]).join('')}</div>
                      <span>{prof.name}</span>
                      <span className="text-sm text-muted">({prof.specialty})</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setShowModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSave}>💾 Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
