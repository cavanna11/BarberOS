import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { updateBusiness } from '../../lib/repository';
import { useCurrentBusiness } from '../../hooks/useCurrentBusiness';
import { getDayName } from '../../utils/dateUtils';

const defaultHours = [
  { dayOfWeek: 0, startTime: '09:00', endTime: '20:00', isActive: true },
  { dayOfWeek: 1, startTime: '09:00', endTime: '20:00', isActive: true },
  { dayOfWeek: 2, startTime: '09:00', endTime: '20:00', isActive: true },
  { dayOfWeek: 3, startTime: '09:00', endTime: '20:00', isActive: true },
  { dayOfWeek: 4, startTime: '09:00', endTime: '20:00', isActive: true },
  { dayOfWeek: 5, startTime: '09:00', endTime: '18:00', isActive: true },
  { dayOfWeek: 6, startTime: '', endTime: '', isActive: false },
];

export default function SettingsPage() {
  const { user } = useAuth();
  const { business, businessId } = useCurrentBusiness();
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  // No se guarda una copia del negocio en el estado, solo LOS CAMBIOS del
  // usuario superpuestos sobre el dato vivo.
  //
  // Con una copia (`useState({...business})`) el formulario quedaba clavado en
  // el valor del primer render: si el negocio cambiaba por snapshot mientras
  // estaba abierto —lo edita otro admin, o vos desde el panel global—, Guardar
  // mandaba el estado viejo y revertía el cambio del otro sin que nadie se
  // entere. Así, los campos que el usuario no tocó se actualizan solos y los
  // que tocó ganan.
  const [cambios, setCambios] = useState({});
  const form = {
    ...business,
    businessHours: business?.businessHours || defaultHours,
    ...cambios,
  };
  const editar = (patch) => setCambios((c) => ({ ...c, ...patch }));

  const handleSave = async () => {
    if (!businessId) return;
    setGuardando(true);
    setError('');
    try {
      // Las Rules no dejan que el dueño toque su facturación ni se descongele
      // solo; el repositorio filtra esos campos antes de mandar.
      await updateBusiness(businessId, form, { esPlataforma: user?.isPlatformOwner });
    } catch (err) {
      console.error('[SettingsPage] No se pudo guardar:', err);
      setError('No se pudieron guardar los cambios: ' + err.message);
      setGuardando(false);
      return;
    }
    setGuardando(false);
    // Guardado: los cambios ya son parte del negocio, así que el overlay se
    // vacía y el formulario vuelve a seguir el dato vivo.
    setCambios({});
    // Apply colors
    document.documentElement.style.setProperty('--primary', form.primaryColor);
    document.documentElement.style.setProperty('--secondary', form.secondaryColor || form.primaryColor);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const toggleScheduleDay = (dayIndex) => {
    const hours = form.businessHours || defaultHours;
    const updatedHours = hours.map((h, i) =>
      i === dayIndex ? { ...h, isActive: !h.isActive } : h
    );
    editar({ businessHours: updatedHours });
  };

  const updateSchedule = (dayIndex, field, value) => {
    const hours = form.businessHours || defaultHours;
    const updatedHours = hours.map((h, i) =>
      i === dayIndex ? { ...h, [field]: value } : h
    );
    editar({ businessHours: updatedHours });
  };

  return (
    <div>
      <div className="admin-page-header">
        <h1>Configuración</h1>
        {saved && <span className="badge badge-success">✅ Guardado</span>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-lg)' }}>
        {/* Left: Form */}
        <div>
          <div className="card">
            <h3 className="mb-lg">Identidad del Negocio</h3>
            <div className="flex flex-col gap-md">
              <div className="form-group">
                <label className="form-label">Nombre del negocio</label>
                <input className="form-input" value={form.name} onChange={e => editar({ name: e.target.value })} />
              </div>
              {/*
                El slug NO es editable desde acá. `updateBusiness` lo filtra para
                quien no es plataforma, así que el campo se veía editable, decía
                "guardado" y no cambiaba nada. Y cambiarlo de verdad tampoco es
                un `update`: hay que mover /slugs/{viejo} a /slugs/{nuevo} en un
                batch, o el link público queda roto. Se muestra como dato.
              */}
              <div className="form-group">
                <label className="form-label">Link público</label>
                <div
                  className="form-input"
                  style={{ background: 'var(--bg-secondary)', fontFamily: 'monospace', fontSize: 13 }}
                >
                  /{form.slug}
                </div>
                <p className="text-xs text-muted" style={{ marginTop: 4 }}>
                  Para cambiar tu dirección escribinos: hay que redirigir el link
                  viejo para no dejar afuera a quien ya lo tenga guardado.
                </p>
              </div>
              <div className="form-group">
                <label className="form-label">Mensaje de bienvenida</label>
                <textarea className="form-input" value={form.welcomeMessage || ''} onChange={e => editar({ welcomeMessage: e.target.value })} />
              </div>
            </div>
          </div>

          <div className="card mt-md">
            <h3 className="mb-lg">Colores</h3>
            <div className="flex flex-col gap-md">
              <div className="form-group">
                <label className="form-label">Color primario</label>
                <div className="flex items-center gap-sm">
                  <input type="color" value={form.primaryColor} onChange={e => editar({ primaryColor: e.target.value })} style={{ width: 48, height: 40, border: 'none', cursor: 'pointer' }} />
                  <input className="form-input" value={form.primaryColor} onChange={e => editar({ primaryColor: e.target.value })} style={{ maxWidth: 140 }} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Color secundario</label>
                <div className="flex items-center gap-sm">
                  <input type="color" value={form.secondaryColor} onChange={e => editar({ secondaryColor: e.target.value })} style={{ width: 48, height: 40, border: 'none', cursor: 'pointer' }} />
                  <input className="form-input" value={form.secondaryColor} onChange={e => editar({ secondaryColor: e.target.value })} style={{ maxWidth: 140 }} />
                </div>
              </div>
            </div>
          </div>

          <div className="card mt-md">
            <h3 className="mb-lg">Configuración operativa</h3>
            <div className="flex flex-col gap-md">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
                <div className="form-group">
                  <label className="form-label">Moneda</label>
                  <select className="form-input" value={form.currency} onChange={e => editar({ currency: e.target.value })}>
                    <option value="ARS">ARS - Peso Argentino</option>
                    <option value="USD">USD - Dólar</option>
                    <option value="CLP">CLP - Peso Chileno</option>
                    <option value="MXN">MXN - Peso Mexicano</option>
                    <option value="COP">COP - Peso Colombiano</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Intervalo de slots (min)</label>
                  <select className="form-input" value={form.slotInterval} onChange={e => editar({ slotInterval: parseInt(e.target.value) })}>
                    <option value={15}>15 minutos</option>
                    <option value={30}>30 minutos</option>
                    <option value={45}>45 minutos</option>
                    <option value={60}>60 minutos</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Horas mínimas para cancelar</label>
                <select className="form-input" value={form.minCancelHours} onChange={e => editar({ minCancelHours: parseInt(e.target.value) })}>
                  <option value={1}>1 hora</option>
                  <option value={2}>2 horas</option>
                  <option value={4}>4 horas</option>
                  <option value={12}>12 horas</option>
                  <option value={24}>24 horas</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Teléfono</label>
                <input className="form-input" value={form.phone || ''} onChange={e => editar({ phone: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Dirección</label>
                <input className="form-input" value={form.address || ''} onChange={e => editar({ address: e.target.value })} />
              </div>
            </div>
          </div>

          <div className="card mt-md">
            <h3 className="mb-lg">Horarios de la Barbería</h3>
            <p className="text-secondary text-sm mb-md">Configura los días y horarios en los que la barbería se encuentra abierta al público.</p>
            <div className="schedule-grid">
              {(form.businessHours || defaultHours).map((sch, idx) => (
                <div key={idx} className="schedule-row">
                  <label style={{ textTransform: 'capitalize' }}>{getDayName(idx)}</label>
                  <button
                    type="button"
                    className={`schedule-toggle ${sch.isActive ? 'active' : ''}`}
                    onClick={() => toggleScheduleDay(idx)}
                  />
                  {sch.isActive ? (
                    <>
                      <input className="form-input" type="time" value={sch.startTime || ''} onChange={e => updateSchedule(idx, 'startTime', e.target.value)} />
                      <input className="form-input" type="time" value={sch.endTime || ''}   onChange={e => updateSchedule(idx, 'endTime',   e.target.value)} />
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

          {error && (
            <div className="notice notice-danger mt-md">{error}</div>
          )}

          {/* Se quitó "Restaurar datos demo": ya no hay datos demo, y la base
              vive en Firestore — no se restaura desde el navegador. */}
          <div className="flex gap-sm mt-lg">
            <button className="btn btn-primary btn-lg" onClick={handleSave} disabled={guardando}>
              {guardando ? 'Guardando…' : '💾 Guardar Cambios'}
            </button>
          </div>
        </div>

        {/* Right: Preview */}
        <div>
          <div className="card" style={{ position: 'sticky', top: 80 }}>
            <h3 className="mb-lg">Vista Previa</h3>
            <div style={{ background: 'var(--bg)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-lg)', border: '1px solid var(--border)' }}>
              <div className="flex items-center gap-sm mb-lg" style={{ padding: 'var(--space-sm)' }}>
                <div style={{ width: 32, height: 32, borderRadius: 'var(--radius-sm)', background: `linear-gradient(135deg, ${form.primaryColor}, ${form.secondaryColor})`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '0.75rem', fontWeight: 700 }}>S</div>
                <strong>{form.name}</strong>
              </div>
              <p className="text-secondary text-sm mb-md">{form.welcomeMessage}</p>
              <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                <button className="btn btn-sm" style={{ background: form.primaryColor, color: 'white', borderColor: form.primaryColor }}>Reservar</button>
                <button className="btn btn-outline btn-sm">Ver Más</button>
              </div>
              <div className="mt-md">
                <div className="badge" style={{ background: form.primaryColor + '20', color: form.primaryColor }}>Activo</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
