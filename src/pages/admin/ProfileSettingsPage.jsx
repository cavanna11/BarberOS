import { useState } from 'react';
import { useBusiness } from '../../contexts/BusinessContext';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../hooks/useTenantData';
import { getDayName, generateId } from '../../utils/dateUtils';

export default function ProfileSettingsPage() {
  const { dispatch } = useBusiness();
  const { user } = useAuth();
  const { professionals, schedules } = useTenant();
  const [saved, setSaved] = useState(false);

  const profId = user?.professionalId;
  const professional = professionals.find(p => p.id === profId);

  // Inicializar formulario con datos del profesional
  const [form, setForm] = useState({
    name: professional?.name || '',
    specialty: professional?.specialty || '',
    phone: professional?.phone || '',
    email: professional?.email || '',
    bio: professional?.bio || ''
  });

  // Inicializar horarios del profesional
  const profSchedules = schedules.filter(s => s.professionalId === profId);
  const [editSchedules, setEditSchedules] = useState(
    Array.from({ length: 7 }, (_, i) => {
      const existing = profSchedules.find(s => s.dayOfWeek === i);
      return existing || {
        id: generateId(),
        professionalId: profId || '',
        dayOfWeek: i,
        startTime: '',
        endTime: '',
        breakStart: null,
        breakEnd: null,
        isActive: false,
      };
    })
  );

  if (!profId || !professional) {
    return (
      <div className="card" style={{ padding: 'var(--space-xl)', textAlign: 'center' }}>
        <div style={{ fontSize: '3rem', marginBottom: 'var(--space-md)' }}>⚠️</div>
        <h3>Perfil No Vinculado</h3>
        <p className="text-secondary mt-sm">
          Esta cuenta de administrador no está vinculada a ningún perfil de profesional (barbero/estilista). 
          Contacta al dueño del negocio para asociar tu correo de Google a tu perfil.
        </p>
      </div>
    );
  }

  const toggleScheduleDay = (dayIndex) => {
    setEditSchedules(prev => prev.map((s, i) => i === dayIndex ? { ...s, isActive: !s.isActive } : s));
  };

  const updateSchedule = (dayIndex, field, value) => {
    setEditSchedules(prev => prev.map((s, i) => i === dayIndex ? { ...s, [field]: value } : s));
  };

  const handleSave = () => {
    // 1. Guardar datos básicos
    dispatch({
      type: 'UPDATE_PROFESSIONAL',
      payload: { id: profId, ...form }
    });

    // 2. Guardar horarios
    dispatch({
      type: 'SET_SCHEDULES',
      payload: {
        professionalId: profId,
        schedules: editSchedules.map(s => ({ ...s, professionalId: profId }))
      }
    });

    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1>Mi Configuración</h1>
          <p className="text-secondary text-sm" style={{ marginTop: 4 }}>
            Administra tus datos personales y tus horarios de trabajo en la barbería.
          </p>
        </div>
        {saved && <span className="badge badge-success">✅ Cambios Guardados</span>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-lg)' }}>
        {/* Columna Izquierda: Información de Perfil */}
        <div>
          <div className="card">
            <h3 className="mb-lg">Datos Personales</h3>
            <div className="flex flex-col gap-md">
              <div className="form-group">
                <label className="form-label">Nombre Completo <span className="required">*</span></label>
                <input
                  className="form-input"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="Tu nombre"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Especialidad</label>
                <input
                  className="form-input"
                  value={form.specialty}
                  onChange={e => setForm({ ...form, specialty: e.target.value })}
                  placeholder="Ej: Barbero Senior / Fade Master"
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
                <div className="form-group">
                  <label className="form-label">Teléfono</label>
                  <input
                    className="form-input"
                    value={form.phone}
                    onChange={e => setForm({ ...form, phone: e.target.value })}
                    placeholder="+54 11 ..."
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Email de Contacto</label>
                  <input
                    className="form-input"
                    value={form.email}
                    onChange={e => setForm({ ...form, email: e.target.value })}
                    placeholder="email@correo.com"
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Biografía / Presentación</label>
                <textarea
                  className="form-input"
                  style={{ minHeight: 100, resize: 'vertical' }}
                  value={form.bio}
                  onChange={e => setForm({ ...form, bio: e.target.value })}
                  placeholder="Cuéntale a tus clientes sobre tu experiencia..."
                />
              </div>
            </div>
          </div>
        </div>

        {/* Columna Derecha: Mi Agenda Semanal */}
        <div>
          <div className="card">
            <h3 className="mb-lg">Mi Horario de Trabajo</h3>
            <p className="text-secondary text-sm mb-md">
              Configura los días de la semana y las horas en las que atiendes clientes.
            </p>
            <div className="schedule-grid">
              {editSchedules.map((sch, idx) => (
                <div key={idx} className="schedule-row">
                  <label style={{ textTransform: 'capitalize' }}>{getDayName(idx)}</label>
                  <button
                    type="button"
                    className={`schedule-toggle ${sch.isActive ? 'active' : ''}`}
                    onClick={() => toggleScheduleDay(idx)}
                  />
                  {sch.isActive ? (
                    <>
                      <input
                        className="form-input"
                        type="time"
                        value={sch.startTime || ''}
                        onChange={e => updateSchedule(idx, 'startTime', e.target.value)}
                      />
                      <input
                        className="form-input"
                        type="time"
                        value={sch.endTime || ''}
                        onChange={e => updateSchedule(idx, 'endTime', e.target.value)}
                      />
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

          <div className="flex gap-sm mt-lg justify-end">
            <button 
              className="btn btn-primary btn-lg" 
              onClick={handleSave}
              disabled={!form.name.trim()}
            >
              💾 Guardar Mi Configuración
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
