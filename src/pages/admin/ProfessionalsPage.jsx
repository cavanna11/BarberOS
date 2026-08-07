import { useState } from 'react';
import { useTenant } from '../../hooks/useTenantData';
import {
  addToSubcollection,
  updateInSubcollection,
  removeFromSubcollection,
  replaceMatching,
} from '../../lib/repository';
import { getDayName, generateId } from '../../utils/dateUtils';

export default function ProfessionalsPage() {
  const { professionals, schedules, professionalServices, services, businessId } = useTenant();

  const [guardando, setGuardando]     = useState(false);
  const [showModal, setShowModal]     = useState(false);
  const [editing, setEditing]         = useState(null);
  const [form, setForm]               = useState({ name: '', specialty: '', phone: '', email: '', bio: '' });
  const [editSchedules, setEditSchedules] = useState([]);
  const [editServices, setEditServices]   = useState([]); // serviceIds seleccionados

  const activeServices = services.filter(s => s.isActive);

  // ── Abrir modal NUEVO ──────────────────────────────────────────────────────
  const openAdd = () => {
    setEditing(null);
    setForm({ name: '', specialty: '', phone: '', email: '', bio: '' });
    setEditSchedules(Array.from({ length: 7 }, (_, i) => ({
      id: generateId(), professionalId: '', dayOfWeek: i,
      startTime: i < 5 ? '09:00' : i === 5 ? '09:00' : '',
      endTime:   i < 5 ? '19:00' : i === 5 ? '14:00' : '',
      breakStart: i < 5 ? '13:00' : null,
      breakEnd:   i < 5 ? '14:00' : null,
      isActive: i < 6,
    })));
    // Por defecto seleccionar TODOS los servicios activos
    setEditServices(activeServices.map(s => s.id));
    setShowModal(true);
  };

  // ── Abrir modal EDITAR ─────────────────────────────────────────────────────
  const openEdit = (prof) => {
    setEditing(prof);
    setForm({ name: prof.name, specialty: prof.specialty || '', phone: prof.phone || '', email: prof.email || '', bio: prof.bio || '' });
    const profSchedules = schedules.filter(s => s.professionalId === prof.id);
    setEditSchedules(Array.from({ length: 7 }, (_, i) => {
      const existing = profSchedules.find(s => s.dayOfWeek === i);
      return existing || {
        id: generateId(), professionalId: prof.id, dayOfWeek: i,
        startTime: '', endTime: '', breakStart: null, breakEnd: null, isActive: false,
      };
    }));
    // Servicios ya asignados a este profesional
    const assigned = professionalServices
      .filter(ps => ps.professionalId === prof.id)
      .map(ps => ps.serviceId);
    setEditServices(assigned);
    setShowModal(true);
  };

  // ── Toggle servicio ────────────────────────────────────────────────────────
  const toggleService = (srvId) => {
    setEditServices(prev =>
      prev.includes(srvId) ? prev.filter(id => id !== srvId) : [...prev, srvId]
    );
  };

  // ── Guardar ────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!form.name.trim() || !businessId) return;

    setGuardando(true);
    try {
      const profId = editing
        ? editing.id
        : await addToSubcollection(businessId, 'professionals', {
            ...form,
            avatarUrl: null,
            displayOrder: professionals.length + 1,
            isActive: true,
          });

      if (editing) {
        await updateInSubcollection(businessId, 'professionals', profId, { ...form });
      }

      // Horarios y servicios asignados se reemplazan enteros: lo natural acá es
      // "estos son los que quedan", no ir agregando y borrando de a uno.
      await replaceMatching(
        businessId,
        'schedules',
        'professionalId',
        profId,
        editSchedules.map((sch) => ({ ...sch, id: undefined, professionalId: profId }))
      );

      await replaceMatching(
        businessId,
        'professionalServices',
        'professionalId',
        profId,
        editServices.map((serviceId) => ({
          professionalId: profId,
          serviceId,
          customPrice: null,
          customDuration: null,
        }))
      );

      setShowModal(false);
    } catch (err) {
      console.error('[ProfessionalsPage] No se pudo guardar:', err);
      alert('No se pudo guardar el profesional: ' + err.message);
    } finally {
      setGuardando(false);
    }
  };

  // ── Eliminar ───────────────────────────────────────────────────────────────
  const handleDelete = async (id) => {
    if (!window.confirm('¿Eliminar este profesional? También se eliminarán sus horarios y servicios asignados.')) return;
    try {
      // Firestore no borra en cascada: hay que limpiar lo que cuelga del profesional.
      await replaceMatching(businessId, 'schedules', 'professionalId', id, []);
      await replaceMatching(businessId, 'professionalServices', 'professionalId', id, []);
      await removeFromSubcollection(businessId, 'professionals', id);
    } catch (err) {
      console.error('[ProfessionalsPage] No se pudo eliminar:', err);
      alert('No se pudo eliminar: ' + err.message);
    }
  };

  // ── Horario helpers ────────────────────────────────────────────────────────
  const toggleScheduleDay = (dayIndex) => {
    setEditSchedules(prev => prev.map((s, i) => i === dayIndex ? { ...s, isActive: !s.isActive } : s));
  };

  const updateSchedule = (dayIndex, field, value) => {
    setEditSchedules(prev => prev.map((s, i) => i === dayIndex ? { ...s, [field]: value } : s));
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div>
      <div className="admin-page-header">
        <h1>Profesionales</h1>
        <button className="btn btn-primary" onClick={openAdd}>+ Agregar Profesional</button>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Profesional</th>
              <th>Especialidad</th>
              <th>Servicios</th>
              <th>Días</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {professionals.map(prof => {
              const profPS      = professionalServices.filter(ps => ps.professionalId === prof.id);
              const profSched   = schedules.filter(s => s.professionalId === prof.id && s.isActive);
              const srvNames    = profPS.map(ps => services.find(s => s.id === ps.serviceId)?.name).filter(Boolean);
              const days        = profSched.map(s => getDayName(s.dayOfWeek).substring(0, 3)).join(', ');
              return (
                <tr key={prof.id}>
                  <td>
                    <div className="flex items-center gap-sm">
                      <div className="avatar avatar-sm">{prof.name.split(' ').map(n => n[0]).join('')}</div>
                      <strong>{prof.name}</strong>
                    </div>
                  </td>
                  <td>{prof.specialty}</td>
                  <td>
                    <span className="text-sm text-secondary">
                      {srvNames.length > 0 ? `${srvNames.length} servicio${srvNames.length !== 1 ? 's' : ''}` : (
                        <span style={{ color: 'var(--danger)', fontWeight: 600 }}>⚠ Sin servicios</span>
                      )}
                    </span>
                  </td>
                  <td><span className="text-sm">{days}</span></td>
                  <td>
                    <span className={`badge ${prof.isActive ? 'badge-success' : 'badge-neutral'}`}>
                      {prof.isActive ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td>
                    <div className="table-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => openEdit(prof)}>✏️</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(prof.id)}>🗑️</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {professionals.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon">👥</div>
            <p style={{ marginBottom: 'var(--space-md)' }}>
              Todavía no hay profesionales. Sin al menos uno cargado, el link
              público no puede mostrar horarios disponibles.
            </p>
            <button className="btn btn-primary" onClick={openAdd}>+ Agregar el primero</button>
          </div>
        )}
      </div>

      {/* ── Modal ── */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" style={{ maxWidth: 620 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editing ? 'Editar Profesional' : 'Agregar Profesional'}</h2>
              <button className="modal-close" onClick={() => setShowModal(false)}>✕</button>
            </div>

            <div className="modal-body">
              <div className="flex flex-col gap-md">

                {/* ─ Datos básicos ─ */}
                <div className="form-group">
                  <label className="form-label">Nombre <span className="required">*</span></label>
                  <input
                    className="form-input"
                    value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                    placeholder="Nombre completo"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Especialidad</label>
                  <input
                    className="form-input"
                    value={form.specialty}
                    onChange={e => setForm({ ...form, specialty: e.target.value })}
                    placeholder="Ej: Barbero Senior"
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
                  <div className="form-group">
                    <label className="form-label">Teléfono</label>
                    <input className="form-input" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Email</label>
                    <input className="form-input" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
                  </div>
                </div>

                {/* ─ Servicios ─ */}
                <div>
                  <h3 style={{ marginBottom: 'var(--space-sm)' }}>Servicios que ofrece</h3>
                  {activeServices.length === 0 ? (
                    <p className="text-sm text-muted">No hay servicios activos configurados.</p>
                  ) : (
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                      gap: 'var(--space-sm)',
                    }}>
                      {activeServices.map(srv => {
                        const checked = editServices.includes(srv.id);
                        return (
                          <label
                            key={srv.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              padding: '8px 12px',
                              borderRadius: 'var(--radius-md)',
                              border: `1.5px solid ${checked ? 'var(--primary)' : 'var(--border-color)'}`,
                              background: checked ? 'var(--primary-light)' : 'var(--bg-secondary)',
                              cursor: 'pointer',
                              transition: 'all 0.15s',
                              userSelect: 'none',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleService(srv.id)}
                              style={{ accentColor: 'var(--primary)', width: 16, height: 16 }}
                            />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: checked ? 600 : 400, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {srv.name}
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                ⏱ {srv.durationMinutes} min
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                  {editServices.length === 0 && (
                    <p className="text-sm" style={{ color: 'var(--danger)', marginTop: 6 }}>
                      ⚠ Sin servicios asignados — el profesional no aparecerá como disponible para reservas.
                    </p>
                  )}
                </div>

                {/* ─ Horario ─ */}
                <div>
                  <h3 style={{ marginBottom: 'var(--space-sm)' }}>Horario de Trabajo</h3>
                  <div className="schedule-grid">
                    {editSchedules.map((sch, idx) => (
                      <div key={idx} className="schedule-row">
                        <label>{getDayName(idx).substring(0, 3)}</label>
                        <button
                          className={`schedule-toggle ${sch.isActive ? 'active' : ''}`}
                          onClick={() => toggleScheduleDay(idx)}
                        />
                        {sch.isActive ? (
                          <>
                            <input className="form-input" type="time" value={sch.startTime} onChange={e => updateSchedule(idx, 'startTime', e.target.value)} />
                            <input className="form-input" type="time" value={sch.endTime}   onChange={e => updateSchedule(idx, 'endTime',   e.target.value)} />
                          </>
                        ) : (
                          <>
                            <span className="text-muted text-sm">—</span>
                            <span className="text-muted text-sm">—</span>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setShowModal(false)}>Cancelar</button>
              <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={!form.name.trim() || guardando}
              >
                {guardando ? 'Guardando…' : '💾 Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
