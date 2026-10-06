import { useState, useEffect } from 'react';
import { useTenant } from '../../hooks/useTenantData';
import {
  updateInSubcollection,
  removeFromSubcollection,
  replaceMatching,
  getStaffContacts,
  saveStaffContact,
  removeStaffContact,
} from '../../lib/repository';
import { getDayName, generateId } from '../../utils/dateUtils';
import { limitesDelNegocio, puede } from '../../config/plans';
import FotoPerfil from '../../components/admin/FotoPerfil';
import HorarioSemanal from '../../components/admin/HorarioSemanal';
import { estadoPushDelEquipo, crearProfesional } from '../../lib/functions';
import { errorDeHorario } from '../../utils/horarios';
import FiltroSucursal from '../../components/admin/FiltroSucursal';
import { useDatosDeSucursales } from '../../hooks/useDatosDeSucursales';
import { useBusiness } from '../../contexts/BusinessContext';

// Mismo número que la landing y el resto del panel.
const LINK_AMPLIAR = 'https://wa.me/5492257529684?text=' +
  encodeURIComponent('Hola! Necesito sumar más barberos a mi cuenta de BarberOS.');

export default function ProfessionalsPage() {
  const { professionals, schedules, professionalServices, services, businessId, business, esMultiSucursal } = useTenant();
  const { dispatch } = useBusiness();

  // Con varias sucursales: mirar las cuatro juntas, o entrar a una.
  //
  // En "todas" la lista es de SOLO LECTURA a propósito. Editar a un barbero de
  // otra sucursal desde acá le ofrecería los servicios y los horarios de ESTA,
  // que son otros: la forma de no mezclar datos no es tener cuidado, es no
  // dejar. Cada fila trae el botón para entrar a su sucursal.
  const [sucFiltro, setSucFiltro] = useState('');
  const verTodas = esMultiSucursal && !sucFiltro;
  const deSucursales = useDatosDeSucursales(['professionals'], { activo: verTodas });
  const listaProfesionales = verTodas ? deSucursales.juntar('professionals') : professionals;

  // Límite de barberos del plan contratado. `maxBarbers: null` = sin tope.
  //
  // Se cuentan solo los activos: un barbero que se fue no debería ocuparle un
  // lugar al que entra. Y se compara al AGREGAR, no al editar, para que una
  // barbería que ya está por encima del límite —porque le bajaron el plan—
  // pueda seguir administrando a los que tiene en vez de quedar trabada.
  //
  // Esto es un límite comercial, no una barrera de seguridad: vive en la
  // interfaz. Alguien con la consola abierta podría saltearlo, igual que
  // cualquier tope de plan en una app de browser. Lo que protege los datos son
  // las Rules, y este número no es un dato a proteger.
  // Del negocio y no del plan a secas: lo que esté escrito en el documento
  // manda (campo `maxBarbers`, que solo puede escribir la plataforma). Así una
  // cuenta vieja conserva el tope que compró y se le puede hacer una excepción
  // a alguien sin cambiarle el plan. En una cuenta con sucursales el tope es
  // POR SUCURSAL: cada una tiene su propio equipo.
  const { maxBarbers: topeBarberos } = limitesDelNegocio(business);
  // La foto de perfil se habilita desde el Plan Intermedio. No es solo esconder
  // el campo: las Rules rechazan la escritura de `avatarUrl` si el plan no lo
  // incluye, así que mostrarlo sería prometer algo que la base va a rechazar.
  const puedeFoto = puede(business, 'fotoPerfil');
  const activos = professionals.filter((p) => p.isActive !== false).length;
  const llegoAlTope = topeBarberos !== null && activos >= topeBarberos;

  const [guardando, setGuardando]     = useState(false);
  const [showModal, setShowModal]     = useState(false);
  const [editing, setEditing]         = useState(null);
  const [form, setForm]               = useState({ name: '', specialty: '', phone: '', email: '', bio: '' });
  const [editSchedules, setEditSchedules] = useState([]);
  const [editServices, setEditServices]   = useState([]); // serviceIds seleccionados

  // El teléfono y el mail del staff NO viven en el documento del profesional:
  // ese es de lectura pública. Se traen aparte, del documento privado.
  const [contactos, setContactos] = useState({});
  useEffect(() => {
    if (!businessId) return;
    let vigente = true;
    getStaffContacts(businessId)
      .then((c) => { if (vigente) setContactos(c); })
      .catch((err) => console.error('[ProfessionalsPage] No se pudo leer el contacto del staff:', err));
    return () => { vigente = false; };
  }, [businessId]);

  const activeServices = services.filter(s => s.isActive);

  // Quién tiene los avisos prendidos. Sale de una función: la lista de
  // dispositivos no se puede leer desde el browser (un token de FCM sirve para
  // mandarle mensajes a ese teléfono), así que el servidor devuelve solo la
  // cuenta por perfil.
  const [avisos, setAvisos] = useState({});
  useEffect(() => {
    if (!businessId) return;
    let vigente = true;
    estadoPushDelEquipo(businessId)
      .then((r) => {
        if (!vigente) return;
        const mapa = {};
        (r?.equipo || []).forEach((e) => { mapa[e.clave] = e; });
        setAvisos(mapa);
      })
      .catch((err) => console.error('[Profesionales] No se pudo leer el estado de avisos:', err));
    return () => { vigente = false; };
  }, [businessId]);

  // ── Abrir modal NUEVO ──────────────────────────────────────────────────────
  const openAdd = () => {
    if (llegoAlTope) return;
    setEditing(null);
    setForm({ name: '', specialty: '', phone: '', email: '', bio: '', avatarUrl: null });
    setEditSchedules(Array.from({ length: 7 }, (_, i) => ({
      id: generateId(), professionalId: '', dayOfWeek: i,
      startTime: i < 5 ? '09:00' : i === 5 ? '09:00' : '',
      endTime:   i < 5 ? '19:00' : i === 5 ? '14:00' : '',
      breakStart: null,
      breakEnd: null,
      isActive: i < 6,
    })));
    // Por defecto seleccionar TODOS los servicios activos
    setEditServices(activeServices.map(s => s.id));
    setShowModal(true);
  };

  // ── Abrir modal EDITAR ─────────────────────────────────────────────────────
  const openEdit = (prof) => {
    setEditing(prof);
    const contacto = contactos[prof.id] || {};
    setForm({ name: prof.name, specialty: prof.specialty || '', phone: contacto.phone || '', email: contacto.email || '', bio: prof.bio || '', avatarUrl: prof.avatarUrl || null });
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
    const malHorario = errorDeHorario(editSchedules, getDayName);
    if (malHorario) { alert(malHorario); return; }

    setGuardando(true);
    try {
      // Se parte en dos a propósito: el documento del profesional es de lectura
      // pública (lo necesita la página de reservas), así que el teléfono y el
      // mail personales van al documento privado del negocio.
      const { phone, email, ...publico } = form;

      // El alta pasa por la Cloud Function: es la que cuenta los barberos
      // activos y hace cumplir el tope del plan. Las Rules ya no permiten crear
      // el documento desde el browser, justamente para que el tope no se pueda
      // saltear con la consola abierta.
      const profId = editing
        ? editing.id
        : (await crearProfesional({
            businessId,
            datos: { ...publico, displayOrder: professionals.length + 1 },
          })).id;

      if (editing) {
        await updateInSubcollection(businessId, 'professionals', profId, { ...publico });
      }

      await saveStaffContact(businessId, profId, { phone, email });
      setContactos((prev) => ({ ...prev, [profId]: { phone, email } }));

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
      await removeStaffContact(businessId, id);
      await removeFromSubcollection(businessId, 'professionals', id);
      setContactos((prev) => { const { [id]: _, ...resto } = prev; return resto; });
    } catch (err) {
      console.error('[ProfessionalsPage] No se pudo eliminar:', err);
      alert('No se pudo eliminar: ' + err.message);
    }
  };


  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1>Profesionales</h1>
          {topeBarberos !== null && (
            <p className="text-secondary text-sm" style={{ marginTop: 4 }}>
              {activos} de {topeBarberos} {topeBarberos === 1 ? 'lugar usado' : 'lugares usados'} en tu plan
            </p>
          )}
        </div>
        <button className="btn btn-primary" onClick={openAdd} disabled={llegoAlTope}>
          + Agregar Profesional
        </button>
      </div>

      {llegoAlTope && (
        <div className="notice notice-info" style={{ marginBottom: 'var(--space-md)' }}>
          <strong>Llegaste al tope de tu plan.</strong> Incluye{' '}
          {topeBarberos === 1 ? '1 barbero' : `${topeBarberos} barberos`} y ya los
          tenés cargados. Para sumar más,{' '}
          <a href={LINK_AMPLIAR} target="_blank" rel="noreferrer" style={{ fontWeight: 700 }}>
            escribinos y ampliamos tu cuenta
          </a>
          . Si alguien dejó de trabajar con vos, desactivalo y se libera el lugar.
        </div>
      )}

      {esMultiSucursal && (
        <div className="filters-bar">
          <FiltroSucursal valor={sucFiltro} onChange={setSucFiltro} />
          {verTodas && (
            <span className="text-sm text-muted">
              Estás viendo el equipo de las {deSucursales.sucursales.length} sucursales. Para editar,
              entrá a una.
            </span>
          )}
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Profesional</th>
              <th className="oculta-mobile">Especialidad</th>
              <th>Servicios</th>
              <th className="oculta-mobile">Días</th>
              <th className="oculta-mobile">Avisos</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {listaProfesionales.map(prof => {
              // Los servicios, los horarios y los avisos que tiene cargado el
              // contexto son los de la sucursal ACTIVA. Para una fila de otra
              // sucursal no se muestran en cero —diría algo falso—: se muestra
              // un guion y el botón para entrar a esa sucursal.
              const deOtra = Boolean(prof.__bizId && prof.__bizId !== businessId);
              const profPS      = deOtra ? [] : professionalServices.filter(ps => ps.professionalId === prof.id);
              const profSched   = deOtra ? [] : schedules.filter(s => s.professionalId === prof.id && s.isActive);
              const srvNames    = profPS.map(ps => services.find(s => s.id === ps.serviceId)?.name).filter(Boolean);
              const days        = [...profSched].sort((a, b) => a.dayOfWeek - b.dayOfWeek).map(s => getDayName(s.dayOfWeek).substring(0, 3)).join(', ');
              return (
                <tr key={`${prof.__bizId || ''}-${prof.id}`}>
                  <td>
                    <div className="flex items-center gap-sm">
                      <div className="avatar avatar-sm" style={{ overflow: 'hidden' }}>{prof.avatarUrl ? <img src={prof.avatarUrl} alt={prof.name} /> : prof.name.split(' ').map(n => n[0]).join('')}</div>
                    <strong>{prof.name}</strong>
                      {verTodas && prof.__sucursal && (
                        <span className="badge badge-neutral" style={{ fontSize: 10 }}>{prof.__sucursal}</span>
                      )}
                    </div>
                  </td>
                  <td className="oculta-mobile">{prof.specialty}</td>
                  <td className="oculta-mobile">
                    {deOtra ? <span className="text-muted">—</span> : (
                      avisos[prof.id]?.dispositivos
                        ? <span className="badge badge-success" title="Recibe los avisos en el celular">🔔 Activados</span>
                        : <span className="badge badge-neutral" title="No va a recibir avisos de turnos nuevos">— Sin activar</span>
                    )}
                  </td>
                  <td>
                    <span className="text-sm text-secondary">
                      {deOtra ? <span className="text-muted">—</span>
                        : srvNames.length > 0 ? `${srvNames.length} servicio${srvNames.length !== 1 ? 's' : ''}` : (
                          <span style={{ color: 'var(--danger)', fontWeight: 600 }}>⚠ Sin servicios</span>
                        )}
                    </span>
                  </td>
                  <td className="oculta-mobile"><span className="text-sm">{deOtra ? '—' : days}</span></td>
                  <td>
                    <span className={`badge ${prof.isActive ? 'badge-success' : 'badge-neutral'}`}>
                      {prof.isActive ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td>
                    <div className="table-actions">
                      {verTodas && prof.__bizId !== businessId ? (
                        <button
                          className="btn btn-outline btn-sm"
                          title={`Pasar a ${prof.__sucursal} para administrarlo`}
                          onClick={() => { dispatch({ type: 'SET_CURRENT_BUSINESS', payload: prof.__bizId }); setSucFiltro(prof.__bizId); }}
                        >
                          Ir a {prof.__sucursal}
                        </button>
                      ) : (
                        <>
                          <button className="btn btn-ghost btn-sm" onClick={() => openEdit(prof)}>✏️</button>
                          <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(prof.id)}>🗑️</button>
                        </>
                      )}
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
            <button className="btn btn-primary" onClick={openAdd} disabled={llegoAlTope}>
              + Agregar el primero
            </button>
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
                <FotoPerfil value={form.avatarUrl} nombre={form.name} bloqueada={!puedeFoto} onChange={(avatarUrl) => setForm({ ...form, avatarUrl })} />
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
                  <p className="text-secondary text-sm" style={{ marginBottom: 'var(--space-sm)' }}>
                    Si hace horario cortado (mañana y tarde), cargá el corte: en ese rato no se ofrecen turnos.
                  </p>
                  <HorarioSemanal dias={editSchedules} onChange={setEditSchedules} nombreCorto />
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
