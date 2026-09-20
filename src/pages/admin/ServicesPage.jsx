import { useState } from 'react';
import { useTenant } from '../../hooks/useTenantData';
import {
  addToSubcollection,
  updateInSubcollection,
  removeFromSubcollection,
  replaceMatching,
} from '../../lib/repository';
import { formatPrice } from '../../utils/dateUtils';
import { NOMBRES_DIAS_CORTOS, describirVentana, tieneVentana } from '../../utils/ventanaServicio';

export default function ServicesPage() {
  const { services, professionals, professionalServices, business, businessId } = useTenant();
  const [guardando, setGuardando] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', description: '', durationMinutes: 30, price: 0, category: '' });
  // Promo por día y horario (ver utils/ventanaServicio.js).
  const [ventana, setVentana] = useState({ activa: false, dias: [], desde: '16:30', hasta: '19:30' });
  const [assignedProfs, setAssignedProfs] = useState([]);

  const openAdd = () => {
    setEditing(null);
    setForm({ name: '', description: '', durationMinutes: 30, price: 0, category: '' });
    setVentana({ activa: false, dias: [], desde: '16:30', hasta: '19:30' });
    setAssignedProfs([]);
    setShowModal(true);
  };

  const openEdit = (srv) => {
    setEditing(srv);
    setForm({ name: srv.name, description: srv.description || '', durationMinutes: srv.durationMinutes, price: srv.price, category: srv.category || '' });
    setVentana(srv.ventana
      ? { activa: true, dias: srv.ventana.dias || [], desde: srv.ventana.desde || '', hasta: srv.ventana.hasta || '' }
      : { activa: false, dias: [], desde: '16:30', hasta: '19:30' });
    const assigned = professionalServices.filter(ps => ps.serviceId === srv.id).map(ps => ps.professionalId);
    setAssignedProfs(assigned);
    setShowModal(true);
  };

  const toggleProf = (profId) => {
    setAssignedProfs(prev => prev.includes(profId) ? prev.filter(id => id !== profId) : [...prev, profId]);
  };

  const handleSave = async () => {
    if (!form.name || !form.price || !businessId) return;

    setGuardando(true);
    try {
      // Sin ventana activa se guarda null: "siempre". Con ventana, solo lo
      // que tiene sentido (días elegidos y/o franja completa).
      const ventanaDoc = ventana.activa && (ventana.dias.length > 0 || (ventana.desde && ventana.hasta))
        ? {
            dias: [...ventana.dias].sort((a, b) => a - b),
            desde: ventana.desde && ventana.hasta ? ventana.desde : null,
            hasta: ventana.desde && ventana.hasta ? ventana.hasta : null,
          }
        : null;
      const datos = { ...form, ventana: ventanaDoc };

      const serviceId = editing
        ? editing.id
        : await addToSubcollection(businessId, 'services', {
            ...datos,
            imageUrl: null,
            displayOrder: services.length + 1,
            isActive: true,
          });

      if (editing) {
        await updateInSubcollection(businessId, 'services', serviceId, datos);
      }

      // Reasigna qué profesionales prestan este servicio (reemplaza los anteriores).
      await replaceMatching(
        businessId,
        'professionalServices',
        'serviceId',
        serviceId,
        assignedProfs.map((professionalId) => ({
          professionalId,
          serviceId,
          customPrice: null,
          customDuration: null,
        }))
      );

      setShowModal(false);
    } catch (err) {
      console.error('[ServicesPage] No se pudo guardar:', err);
      alert('No se pudo guardar el servicio: ' + err.message);
    } finally {
      setGuardando(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('¿Eliminar este servicio?')) return;
    try {
      // Firestore no borra en cascada: primero se sueltan las asignaciones.
      await replaceMatching(businessId, 'professionalServices', 'serviceId', id, []);
      await removeFromSubcollection(businessId, 'services', id);
    } catch (err) {
      console.error('[ServicesPage] No se pudo eliminar:', err);
      alert('No se pudo eliminar: ' + err.message);
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
              <th className="oculta-mobile">Duración</th>
              <th>Precio</th>
              <th className="oculta-mobile">Profesionales</th>
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
                      {tieneVentana(srv) && <div className="text-sm" style={{ color: 'var(--warning)' }}>🏷️ {describirVentana(srv)}</div>}
                    </div>
                  </td>
                  <td className="oculta-mobile">{srv.durationMinutes} min</td>
                  <td><strong>{formatPrice(srv.price, business?.currency)}</strong></td>
                  <td className="oculta-mobile"><span className="text-sm text-secondary">{srvProfs.join(', ')}</span></td>
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

                {/* Promo por día y horario: "corte de media tarde, martes y
                    miércoles de 16:30 a 19:30". Lo hace cumplir el calendario,
                    la grilla y el servidor; acá solo se configura. */}
                <div className="form-group" style={{ background: 'var(--bg-secondary)', padding: '12px 14px', borderRadius: 8 }}>
                  <label className="flex items-center gap-sm" style={{ cursor: 'pointer', fontWeight: 600 }}>
                    <input type="checkbox" checked={ventana.activa} onChange={e => setVentana({ ...ventana, activa: e.target.checked })} />
                    Solo en ciertos días y horarios (promo)
                  </label>
                  {ventana.activa && (
                    <div style={{ marginTop: 10 }}>
                      <div className="text-sm text-secondary" style={{ marginBottom: 6 }}>Días en que se ofrece (ninguno = todos):</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                        {NOMBRES_DIAS_CORTOS.map((nombre, d) => {
                          const marcado = ventana.dias.includes(d);
                          return (
                            <button
                              key={d}
                              type="button"
                              className={`btn btn-sm ${marcado ? 'btn-primary' : 'btn-outline'}`}
                              onClick={() => setVentana({ ...ventana, dias: marcado ? ventana.dias.filter(x => x !== d) : [...ventana.dias, d] })}
                            >
                              {nombre}
                            </button>
                          );
                        })}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div>
                          <label className="form-label">Desde</label>
                          <input className="form-input" type="time" value={ventana.desde} onChange={e => setVentana({ ...ventana, desde: e.target.value })} />
                        </div>
                        <div>
                          <label className="form-label">Hasta</label>
                          <input className="form-input" type="time" value={ventana.hasta} onChange={e => setVentana({ ...ventana, hasta: e.target.value })} />
                        </div>
                      </div>
                      <p className="text-sm text-muted" style={{ marginTop: 8 }}>
                        El turno completo tiene que caer adentro de la franja. Dejá las horas vacías para que valga todo el día.
                      </p>
                    </div>
                  )}
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
              <button className="btn btn-primary" onClick={handleSave} disabled={guardando}>
                {guardando ? 'Guardando…' : '💾 Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
