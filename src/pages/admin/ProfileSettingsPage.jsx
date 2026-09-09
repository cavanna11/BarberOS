import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  updateInSubcollection,
  replaceMatching,
  getStaffContacts,
  saveStaffContact,
} from '../../lib/repository';
import { useTenant } from '../../hooks/useTenantData';
import { getDayName, generateId } from '../../utils/dateUtils';

export default function ProfileSettingsPage() {
  const { user } = useAuth();
  const { professionals, schedules, businessId } = useTenant();
  const [guardando, setGuardando] = useState(false);
  const [saved, setSaved] = useState(false);

  const profId = user?.professionalId;
  const professional = professionals.find(p => p.id === profId);

  // Mismo criterio que SettingsPage: no se guarda una copia del profesional en
  // el estado, solo LOS CAMBIOS superpuestos sobre el dato vivo. Con una copia,
  // si el dueño editaba el perfil mientras el barbero lo tenía abierto, Guardar
  // revertía el cambio del dueño sin avisar.
  const [cambios, setCambios] = useState({});
  // El teléfono y el mail no están en el documento del profesional (ese es de
  // lectura pública): se traen del privado.
  const [contacto, setContacto] = useState({ phone: '', email: '' });

  const form = {
    name: professional?.name || '',
    specialty: professional?.specialty || '',
    bio: professional?.bio || '',
    ...contacto,
    ...cambios,
  };
  const editar = (patch) => setCambios((c) => ({ ...c, ...patch }));

  useEffect(() => {
    if (!businessId || !profId) return;
    let vigente = true;
    getStaffContacts(businessId)
      .then((c) => {
        if (!vigente) return;
        const mio = c[profId] || {};
        setContacto({ phone: mio.phone || '', email: mio.email || '' });
      })
      .catch((err) => console.error('[ProfileSettings] No se pudo leer el contacto:', err));
    return () => { vigente = false; };
  }, [businessId, profId]);

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

  const handleSave = async () => {
    if (!businessId || !profId) return;
    setGuardando(true);
    try {
      // El contacto va aparte: el documento del profesional es público.
      const { phone, email, ...publico } = form;
      await updateInSubcollection(businessId, 'professionals', profId, { ...publico });
      await saveStaffContact(businessId, profId, { phone, email });
      // El contacto ya está guardado: pasa a ser el valor de base, y el overlay
      // de cambios se vacía para que el formulario siga el dato vivo otra vez.
      setContacto({ phone, email });
      setCambios({});
      // Los horarios se reemplazan enteros: lo natural es "estos son los que
      // quedan", no ir agregando y borrando día por día.
      await replaceMatching(
        businessId,
        'schedules',
        'professionalId',
        profId,
        editSchedules.map((s) => ({ ...s, id: undefined, professionalId: profId }))
      );
    } catch (err) {
      console.error('[ProfileSettings] No se pudo guardar:', err);
      alert('No se pudieron guardar los cambios: ' + err.message);
      setGuardando(false);
      return;
    }
    setGuardando(false);
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
                  onChange={e => editar({ name: e.target.value })}
                  placeholder="Tu nombre"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Especialidad</label>
                <input
                  className="form-input"
                  value={form.specialty}
                  onChange={e => editar({ specialty: e.target.value })}
                  placeholder="Ej: Barbero Senior / Fade Master"
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
                <div className="form-group">
                  <label className="form-label">Teléfono</label>
                  <input
                    className="form-input"
                    value={form.phone}
                    onChange={e => editar({ phone: e.target.value })}
                    placeholder="+54 11 ..."
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Email de Contacto</label>
                  <input
                    className="form-input"
                    value={form.email}
                    onChange={e => editar({ email: e.target.value })}
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
                  onChange={e => editar({ bio: e.target.value })}
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
              disabled={!form.name.trim() || guardando}
            >
              💾 Guardar Mi Configuración
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
