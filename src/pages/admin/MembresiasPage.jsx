import { useState, useMemo, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../hooks/useTenantData';
import { useDatosDeSucursales } from '../../hooks/useDatosDeSucursales';
import { formatPrice } from '../../utils/dateUtils';
import { mesActual, mesDe, nombreDeMes } from '../../utils/ingresos';
import {
  ESTADOS_MEMBRESIA, ESTADOS_USO, ORIGENES_USO,
  resumenDeMembresias, cobradoPorMembresias, consumidoPorMembresias,
  usosAgrupados, filtrarUsos, fechaCorta, fechaLarga, usoVivo,
} from '../../utils/membresias';
import { obtenerPlanesMembresia, obtenerDatosDeMembresias, obtenerPeriodosDeMembresia, updateBusiness } from '../../lib/repository';
import {
  guardarPlanMembresia, cargarMembresia, renovarMembresia, cancelarMembresia,
  revertirUsoMembresia, buscarSuscripcionesMP,
} from '../../lib/functions';

// ============================================================================
// Membresías — planes mensuales de la barbería a sus clientes
// ============================================================================
// Solo el dueño. El barbero no tiene esta pantalla: ni ve la cartera, ni carga,
// ni aplica. Lo único que ve de una membresía es el cartel en el turno.
//
// Todo lo que cambia algo va por las Functions (las Rules no dejan escribir
// nada de membresías desde el browser, ni al dueño): planes, carga, renovación,
// baja y reversión. Esta pantalla solo lee — de una vez, al entrar, con botón
// para releer, como Reseñas.
//
// Viven en la barbería PRINCIPAL de la cuenta: una membresía se usa en
// cualquier sucursal. Por eso todo se lee de `cuentaId`, no del negocio activo.

const PESTANAS = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'clientes', label: 'Clientes' },
  { id: 'planes', label: 'Planes' },
  { id: 'auditoria', label: 'Auditoría' },
];

const hoyLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function Estado({ estado, mapa = ESTADOS_MEMBRESIA }) {
  const e = mapa[estado] || { label: estado, clase: 'badge-neutral' };
  return <span className={`badge ${e.clase}`}>{e.label}</span>;
}

export default function MembresiasPage() {
  const { user } = useAuth();
  const { business, businessId, sucursales, esMultiSucursal } = useTenant();
  // El moderador de la plataforma no: no toca plata (igual que en las Functions).
  const isOwner = user?.role === 'owner' || user?.isPlatformOwner === true;
  const cuentaId = business?.grupoId || businessId;
  const moneda = business?.currency;

  const [pestana, setPestana] = useState('resumen');
  const [planes, setPlanes] = useState([]);
  const [datos, setDatos] = useState({ membresias: [], usos: [], pagos: [] });
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

  // Barberos y servicios de TODAS las sucursales: un plan puede incluir el corte
  // de cada una, y la auditoría nombra al barbero de cualquiera.
  const { juntar } = useDatosDeSucursales(['professionals', 'services'], { activo: Boolean(businessId) && isOwner });
  const profesionales = useMemo(() => juntar('professionals'), [juntar]);
  const servicios = useMemo(() => juntar('services'), [juntar]);

  const recargar = useCallback(async () => {
    if (!cuentaId || !isOwner) return;
    setCargando(true);
    setError('');
    try {
      const [p, d] = await Promise.all([obtenerPlanesMembresia(cuentaId), obtenerDatosDeMembresias(cuentaId)]);
      setPlanes(p);
      setDatos(d);
    } catch (err) {
      console.error('[Membresías] no se pudieron leer:', err);
      setError('No se pudieron leer las membresías. Probá de nuevo.');
    } finally {
      setCargando(false);
    }
  }, [cuentaId, isOwner]);

  useEffect(() => { recargar(); }, [recargar]);

  const hecho = (texto) => { setAviso(texto); recargar(); };

  // Las membresías se habilitan cuenta por cuenta, en la principal. Solo la
  // plataforma puede prenderlas (las Rules no le dejan ese campo al dueño).
  const principal = sucursales.find((s) => s.id === cuentaId) || business;
  const habilitadas = principal?.membresiasHabilitadas === true;
  const [cambiando, setCambiando] = useState(false);
  const alternarHabilitadas = async () => {
    setCambiando(true);
    try {
      await updateBusiness(cuentaId, { membresiasHabilitadas: !habilitadas }, { esPlataforma: true });
    } catch (err) {
      setError('No se pudo cambiar: ' + err.message);
    } finally {
      setCambiando(false);
    }
  };

  if (!isOwner) {
    return (
      <div className="card" style={{ padding: 'var(--space-xl)' }}>
        <h2>Membresías</h2>
        <p className="text-secondary">Las membresías las gestiona el dueño de la barbería.</p>
      </div>
    );
  }

  if (!habilitadas && !user?.isPlatformOwner) {
    return (
      <div className="card" style={{ padding: 'var(--space-xl)' }}>
        <h2>Membresías</h2>
        <p className="text-secondary">Las membresías no están habilitadas en tu cuenta. Escribinos por soporte para activarlas.</p>
      </div>
    );
  }

  const nombreProf = (id) => profesionales.find((p) => p.id === id)?.name || '—';
  const nombreSuc = (id) => sucursales.find((s) => s.id === id)?.name || business?.name || '';

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1>Membresías</h1>
          <span className="text-secondary text-sm">Planes mensuales de tus clientes, lo que usan y quién lo registró</span>
        </div>
        <button className="btn btn-outline" onClick={recargar} disabled={cargando}>
          {cargando ? 'Leyendo…' : '↻ Actualizar'}
        </button>
      </div>

      {user?.isPlatformOwner && (
        <div className={`notice ${habilitadas ? 'notice-success' : 'notice-warn'}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span>
            {habilitadas
              ? <>Membresías <strong>habilitadas</strong> en esta cuenta: el dueño ve esta sección y sus clientes pueden usarlas.</>
              : <>Membresías <strong>apagadas</strong> en esta cuenta: el dueño no ve la sección.</>}
          </span>
          <button className="btn btn-sm btn-outline" onClick={alternarHabilitadas} disabled={cambiando}>
            {habilitadas ? 'Deshabilitar' : 'Habilitar membresías'}
          </button>
        </div>
      )}
      {error && <div className="notice notice-danger">{error}</div>}
      {aviso && (
        <div className="notice notice-success" onClick={() => setAviso('')} role="status">
          {aviso}
        </div>
      )}

      <div className="tabs membresias-tabs">
        {PESTANAS.map((p) => (
          <button key={p.id} className={`tab ${pestana === p.id ? 'active' : ''}`} onClick={() => setPestana(p.id)}>
            {p.label}
          </button>
        ))}
      </div>

      {pestana === 'resumen' && (
        <Resumen datos={datos} moneda={moneda} nombreProf={nombreProf} nombreSuc={nombreSuc} esMultiSucursal={esMultiSucursal} />
      )}
      {pestana === 'clientes' && (
        <Clientes
          datos={datos} planes={planes} cuentaId={cuentaId} moneda={moneda}
          mpConectado={(sucursales.find((x) => x.id === cuentaId) || business)?.mpConectado === true}
          nombreProf={nombreProf} nombreSuc={nombreSuc} onHecho={hecho}
        />
      )}
      {pestana === 'planes' && (
        <Planes planes={planes} cuentaId={cuentaId} moneda={moneda} servicios={servicios} sucursales={sucursales}
          esMultiSucursal={esMultiSucursal} onHecho={hecho} />
      )}
      {pestana === 'auditoria' && (
        <Auditoria usos={datos.usos} moneda={moneda} profesionales={profesionales}
          sucursales={sucursales} esMultiSucursal={esMultiSucursal} nombreProf={nombreProf} nombreSuc={nombreSuc} onHecho={hecho} />
      )}
    </div>
  );
}

// ── Resumen ────────────────────────────────────────────────────────────────

function Resumen({ datos, moneda, nombreProf, nombreSuc, esMultiSucursal }) {
  const mes = mesActual();
  const r = useMemo(() => resumenDeMembresias(datos.membresias, mes), [datos.membresias, mes]);
  const cobrado = useMemo(() => cobradoPorMembresias(datos.pagos, mes), [datos.pagos, mes]);
  const consumido = useMemo(() => consumidoPorMembresias(datos.usos, mes), [datos.usos, mes]);
  const delMes = useMemo(() => datos.usos.filter((u) => mesDe(u.appointmentDate) === mes), [datos.usos, mes]);
  const porBarbero = useMemo(() => usosAgrupados(delMes, 'professionalId'), [delMes]);
  const porSucursal = useMemo(() => usosAgrupados(delMes, 'sucursalId'), [delMes]);
  const aRevisar = datos.usos.filter((u) => u.requiereRevision && usoVivo(u)).length;
  const conPagoRechazado = datos.membresias.filter((m) => m.estado === 'pago_rechazado').length;

  return (
    <>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-value">{r.activas}</div>
          <div className="stat-card-label">Membresías activas</div>
          <div className="stat-card-change positive">{r.altas} altas · {r.bajas} bajas este mes</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-value">{formatPrice(r.recurrente, moneda)}</div>
          <div className="stat-card-label">Ingreso recurrente</div>
          <div className="stat-card-change positive">por mes, las que están al día</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-value">{formatPrice(cobrado.total, moneda)}</div>
          <div className="stat-card-label">Cobrado en membresías</div>
          <div className="stat-card-change positive">{nombreDeMes(mes)} · {cobrado.count} cobros</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-value">{formatPrice(consumido.total, moneda)}</div>
          <div className="stat-card-label">Servicios consumidos</div>
          <div className="stat-card-change positive">{consumido.count} usos, a precio de lista</div>
        </div>
      </div>

      {(aRevisar > 0 || conPagoRechazado > 0) && (
        <div className="notice notice-warn">
          {aRevisar > 0 && <div>⚠️ <strong>{aRevisar}</strong> {aRevisar === 1 ? 'uso marcado' : 'usos marcados'} para revisar (turno atendido que después se cambió, o reprogramado fuera del mes pago). Miralos en Auditoría.</div>}
          {conPagoRechazado > 0 && <div>💳 <strong>{conPagoRechazado}</strong> {conPagoRechazado === 1 ? 'membresía' : 'membresías'} con el pago rechazado en Mercado Pago.</div>}
        </div>
      )}

      <div className="revenue-section">
        <div className="revenue-card">
          <h3>Planes activos</h3>
          {r.porPlan.length === 0 && <p className="text-secondary text-sm">Todavía no hay membresías activas.</p>}
          {r.porPlan.map((p) => (
            <div key={p.nombre} className="revenue-bar-item">
              <div className="revenue-bar-header"><span>{p.nombre}</span><span className="text-secondary">{p.cantidad}</span></div>
              <div className="revenue-bar-track"><div className="revenue-bar-fill" style={{ width: `${(p.cantidad / Math.max(r.activas, 1)) * 100}%` }} /></div>
            </div>
          ))}
        </div>
        <div className="revenue-card">
          <h3>Usos de {nombreDeMes(mes)} por barbero</h3>
          {porBarbero.length === 0 && <p className="text-secondary text-sm">Sin usos este mes.</p>}
          {porBarbero.map((g) => (
            <div key={g.clave} className="revenue-bar-item">
              <div className="revenue-bar-header">
                <span>{nombreProf(g.clave)}</span>
                <span className="text-secondary">{g.cantidad}{g.porDueno ? ` · ${g.porDueno} aplicados por vos` : ''}</span>
              </div>
              <div className="revenue-bar-track"><div className="revenue-bar-fill" style={{ width: `${(g.cantidad / porBarbero[0].cantidad) * 100}%` }} /></div>
            </div>
          ))}
        </div>
        {esMultiSucursal && porSucursal.length > 0 && (
          <div className="revenue-card">
            <h3>Por sucursal</h3>
            {porSucursal.map((g) => (
              <div key={g.clave} className="revenue-bar-item">
                <div className="revenue-bar-header"><span>{nombreSuc(g.clave)}</span><span className="text-secondary">{g.cantidad}</span></div>
                <div className="revenue-bar-track"><div className="revenue-bar-fill" style={{ width: `${(g.cantidad / porSucursal[0].cantidad) * 100}%` }} /></div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ── Clientes ───────────────────────────────────────────────────────────────

function Clientes({ datos, planes, cuentaId, moneda, mpConectado, nombreProf, nombreSuc, onHecho }) {
  const [busqueda, setBusqueda] = useState('');
  const [verFinalizadas, setVerFinalizadas] = useState(false);
  const [cargar, setCargar] = useState(null); // null | {} | { reemplaza: membresia }
  const [detalle, setDetalle] = useState(null);

  const lista = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return datos.membresias
      .filter((m) => verFinalizadas || !['vencida', 'reemplazada'].includes(m.estado))
      .filter((m) => !q || `${m.clienteNombre} ${m.clienteEmail} ${m.clienteTelefono}`.toLowerCase().includes(q))
      .sort((a, b) => String(a.clienteNombre).localeCompare(String(b.clienteNombre)));
  }, [datos.membresias, busqueda, verFinalizadas]);

  const usadosDelMes = (m) => {
    const p = m.periodoActual;
    if (!p) return 0;
    return datos.usos.filter((u) => u.membresiaId === m.id && u.periodoId === p.id && usoVivo(u)).length;
  };

  return (
    <>
      <div className="filters-bar">
        <input className="form-input" placeholder="Buscar cliente…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} style={{ maxWidth: 260 }} />
        <label className="text-sm" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={verFinalizadas} onChange={(e) => setVerFinalizadas(e.target.checked)} />
          Ver vencidas y anteriores
        </label>
        <button className="btn btn-primary" onClick={() => setCargar({})} disabled={planes.filter((p) => p.activo !== false).length === 0}>
          + Cargar membresía
        </button>
      </div>
      {planes.length === 0 && <div className="notice notice-info">Primero creá un plan en la pestaña <strong>Planes</strong>.</div>}

      <div className="card">
        {lista.length === 0 && (
          <div className="empty-state" style={{ padding: 'var(--space-xl)' }}>
            <p>{busqueda ? 'Nadie coincide con esa búsqueda.' : 'Todavía no cargaste membresías. Las que ya tenés en Mercado Pago se cargan con "Cargar membresía".'}</p>
          </div>
        )}
        {lista.map((m) => {
          const total = m.plan?.usosTotales ?? (m.plan?.beneficios?.length === 1 ? m.plan.beneficios[0].usos : null);
          return (
            <button key={m.id} className="membresia-fila" onClick={() => setDetalle(m)}>
              <span className="membresia-fila-quien">
                <strong>{m.clienteNombre}</strong>
                <span className="text-muted text-sm">{m.clienteEmail}{m.clienteUid ? '' : ' · todavía no entró'}</span>
              </span>
              <span className="membresia-fila-plan">
                <span>{m.plan?.nombre}</span>
                <span className="text-sm text-secondary">
                  {total != null ? `${usadosDelMes(m)} de ${total} usos` : `${usadosDelMes(m)} usos`}
                  {m.periodoActual?.hasta ? ` · hasta ${fechaCorta(m.periodoActual.hasta)}` : ''}
                </span>
              </span>
              <span className="membresia-fila-estado">
                <Estado estado={m.estado} />
                {m.mp?.preapprovalId && <span className="text-xs text-muted">Mercado Pago</span>}
              </span>
            </button>
          );
        })}
      </div>

      {cargar && (
        <CargarModal
          planes={planes} cuentaId={cuentaId} moneda={moneda} mpConectado={mpConectado}
          reemplaza={cargar.reemplaza || null}
          onCerrar={() => setCargar(null)}
          onListo={(t) => { setCargar(null); setDetalle(null); onHecho(t); }}
        />
      )}
      {detalle && !cargar && (
        <DetalleModal
          membresia={detalle} usos={datos.usos.filter((u) => u.membresiaId === detalle.id)} pagos={datos.pagos.filter((p) => p.membresiaId === detalle.id)}
          cuentaId={cuentaId} moneda={moneda} nombreProf={nombreProf} nombreSuc={nombreSuc}
          onCerrar={() => setDetalle(null)}
          onCambiarPlan={() => setCargar({ reemplaza: detalle })}
          onListo={(t) => { setDetalle(null); onHecho(t); }}
        />
      )}
    </>
  );
}

function CargarModal({ planes, cuentaId, moneda, mpConectado, reemplaza, onCerrar, onListo }) {
  const activos = planes.filter((p) => p.activo !== false && p.id !== reemplaza?.planId);
  const [f, setF] = useState({
    clienteNombre: reemplaza?.clienteNombre || '',
    clienteEmail: reemplaza?.clienteEmail || '',
    clienteTelefono: reemplaza?.clienteTelefono || '',
    planId: activos[0]?.id || '',
    desde: hoyLocal(),
    hasta: '',
    monto: '',
    preapprovalId: reemplaza?.mp?.preapprovalId || '',
    notas: '',
  });
  const [mp, setMp] = useState({ email: '', lista: null, buscando: false, error: '' });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const plan = planes.find((p) => p.id === f.planId);

  const buscar = async () => {
    setMp((x) => ({ ...x, buscando: true, error: '' }));
    try {
      const r = await buscarSuscripcionesMP({ businessId: cuentaId, payerEmail: mp.email });
      setMp((x) => ({ ...x, lista: r.suscripciones, buscando: false }));
    } catch (err) {
      setMp((x) => ({ ...x, buscando: false, error: err.message }));
    }
  };

  const guardar = async () => {
    setGuardando(true);
    setError('');
    try {
      const r = await cargarMembresia({
        businessId: cuentaId, ...f,
        hasta: f.hasta || null,
        monto: f.monto === '' ? null : Number(f.monto),
        preapprovalId: f.preapprovalId.trim() || null,
        reemplazaA: reemplaza?.id || null,
      });
      onListo(r.atada
        ? `Listo: ${f.clienteNombre} ya puede usar su membresía al reservar.`
        : `Listo. Cuando ${f.clienteNombre} entre a reservar con ${f.clienteEmail.trim()}, la membresía se le activa sola.`);
    } catch (err) {
      setError(err.message);
      setGuardando(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onCerrar}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <h2>{reemplaza ? `Cambiar el plan de ${reemplaza.clienteNombre}` : 'Cargar membresía'}</h2>
          <button className="modal-close" onClick={onCerrar}>✕</button>
        </div>
        <div className="modal-body">
          {reemplaza && (
            <div className="notice notice-info">
              El plan actual ({reemplaza.plan?.nombre}) termina el día antes de que arranque el nuevo. Lo que ya usó queda en su historial. Sin prorrateo.
              {reemplaza.mp?.preapprovalId && ' Si en Mercado Pago le cambiaste el monto a la misma suscripción, dejala vinculada; si le hiciste una nueva, poné su id y cancelá la vieja desde Mercado Pago.'}
            </div>
          )}
          {!reemplaza && (
            <>
              <div className="form-group">
                <label className="form-label">Nombre del cliente <span className="required">*</span></label>
                <input className="form-input" value={f.clienteNombre} onChange={set('clienteNombre')} />
              </div>
              <div className="form-group">
                <label className="form-label">Mail con el que reserva <span className="required">*</span></label>
                <input className="form-input" type="email" value={f.clienteEmail} onChange={set('clienteEmail')} placeholder="el de Google con el que entra" />
                <p className="text-xs text-muted" style={{ marginTop: 4 }}>
                  Es lo que lo identifica. Si todavía no entró nunca, la membresía queda esperando y se activa la primera vez que reserva con ese mail.
                </p>
              </div>
              <div className="form-group">
                <label className="form-label">Teléfono</label>
                <input className="form-input" type="tel" value={f.clienteTelefono} onChange={set('clienteTelefono')} />
              </div>
            </>
          )}

          <div className="form-group">
            <label className="form-label">Plan <span className="required">*</span></label>
            <select className="form-input" value={f.planId} onChange={set('planId')}>
              {activos.map((p) => <option key={p.id} value={p.id}>{p.nombre} — {formatPrice(p.precioMensual, moneda)}/mes</option>)}
            </select>
          </div>

          <div className="membresia-dos">
            <div className="form-group">
              <label className="form-label">El mes pago arranca</label>
              <input className="form-input" type="date" value={f.desde} onChange={set('desde')} />
            </div>
            <div className="form-group">
              <label className="form-label">Y termina</label>
              <input className="form-input" type="date" value={f.hasta} onChange={set('hasta')} />
              <p className="text-xs text-muted" style={{ marginTop: 4 }}>Vacío: un mes desde el inicio.</p>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Cuánto pagó este mes</label>
            <input className="form-input" type="number" min="0" value={f.monto} onChange={set('monto')} placeholder={plan ? String(plan.precioMensual) : ''} />
            <p className="text-xs text-muted" style={{ marginTop: 4 }}>Cuenta como ingreso de membresías. Vacío: el precio del plan.</p>
          </div>

          <div className="card" style={{ background: 'var(--bg-secondary)', padding: 'var(--space-md)' }}>
            <strong>Suscripción de Mercado Pago (opcional)</strong>
            <p className="text-sm text-secondary" style={{ margin: '4px 0 8px' }}>
              Si el cliente paga con una suscripción de Mercado Pago, vinculala: desde ahí los cobros, las pausas y las bajas se actualizan solos. Si paga en efectivo o por transferencia, dejalo vacío y renovala a mano cada mes.
            </p>
            {mpConectado ? (
              <>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input className="form-input" style={{ flex: 1, minWidth: 180 }} placeholder="Mail de su cuenta de Mercado Pago" value={mp.email} onChange={(e) => setMp((x) => ({ ...x, email: e.target.value }))} />
                  <button className="btn btn-outline btn-sm" onClick={buscar} disabled={mp.buscando}>{mp.buscando ? 'Buscando…' : 'Buscar'}</button>
                </div>
                {mp.error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{mp.error}</p>}
                {mp.lista && mp.lista.length === 0 && <p className="text-sm text-secondary">No hay suscripciones con ese mail.</p>}
                {mp.lista?.map((s) => (
                  <label key={s.id} className="pago-opcion">
                    <input type="radio" name="pre" disabled={s.vinculada} checked={f.preapprovalId === s.id} onChange={() => setF((x) => ({ ...x, preapprovalId: s.id }))} />
                    <span>
                      <strong>{s.motivo || 'Suscripción'}</strong> · {s.monto != null ? formatPrice(s.monto, moneda) : ''} · {s.estado}
                      <div className="text-xs text-secondary">{s.payerEmail} · {s.proximoCobro ? `próximo cobro ${fechaLarga(s.proximoCobro)}` : ''}{s.vinculada ? ' · ya vinculada' : ''}</div>
                    </span>
                  </label>
                ))}
                <input className="form-input" style={{ marginTop: 8 }} placeholder="…o pegá el id de la suscripción" value={f.preapprovalId} onChange={set('preapprovalId')} />
              </>
            ) : (
              <p className="text-sm text-muted">Conectá Mercado Pago en Configuración para vincular suscripciones.</p>
            )}
          </div>

          <div className="form-group" style={{ marginTop: 'var(--space-md)' }}>
            <label className="form-label">Notas</label>
            <input className="form-input" value={f.notas} onChange={set('notas')} placeholder="Ej.: paga por transferencia el 5 de cada mes" />
          </div>
          {error && <div className="notice notice-danger">{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onCerrar}>Cancelar</button>
          <button className="btn btn-primary" onClick={guardar} disabled={guardando || !f.planId || (!reemplaza && (!f.clienteNombre.trim() || !f.clienteEmail.trim()))}>
            {guardando ? 'Guardando…' : reemplaza ? 'Cambiar plan' : 'Cargar'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DetalleModal({ membresia: m, usos, pagos, cuentaId, moneda, nombreProf, nombreSuc, onCerrar, onCambiarPlan, onListo }) {
  const [periodos, setPeriodos] = useState(null);
  const [baja, setBaja] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let vivo = true;
    obtenerPeriodosDeMembresia(cuentaId, m.id).then((p) => { if (vivo) setPeriodos(p); }).catch(() => { if (vivo) setPeriodos([]); });
    return () => { vivo = false; };
  }, [cuentaId, m.id]);

  const accion = async (fn, texto) => {
    setTrabajando(true);
    setError('');
    try { await fn(); onListo(texto); } catch (err) { setError(err.message); setTrabajando(false); }
  };

  const conMP = Boolean(m.mp?.preapprovalId);
  const finalizada = ['vencida', 'reemplazada'].includes(m.estado);
  const historial = [...(m.historial || [])].reverse();
  const listaUsos = [...usos].sort((a, b) => String(b.appointmentDate).localeCompare(String(a.appointmentDate)));

  return (
    <div className="modal-overlay" onClick={onCerrar}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <div className="modal-header">
          <h2>{m.clienteNombre}</h2>
          <button className="modal-close" onClick={onCerrar}>✕</button>
        </div>
        <div className="modal-body">
          <div className="membresia-detalle-cabecera">
            <div>
              <div><strong>{m.plan?.nombre}</strong> · {formatPrice(m.plan?.precioMensual, moneda)}/mes</div>
              <div className="text-sm text-secondary">{m.clienteEmail}{m.clienteTelefono ? ` · ${m.clienteTelefono}` : ''}</div>
              <div className="text-sm text-secondary">
                {conMP ? `Mercado Pago (${m.mp.estadoMP || '—'})${m.mp.proximoCobro ? ` · próximo cobro ${fechaLarga(m.mp.proximoCobro)}` : ''}` : 'Pago manual'}
                {m.inicio ? ` · desde ${fechaLarga(m.inicio)}` : ''}
              </div>
              {!m.clienteUid && <div className="text-sm text-muted">Todavía no entró a reservar con este mail.</div>}
              {m.notas && <div className="text-sm text-muted">📝 {m.notas}</div>}
            </div>
            <Estado estado={m.estado} />
          </div>

          <h3 className="membresia-subtitulo">Meses</h3>
          {periodos === null && <p className="text-sm text-secondary">Leyendo…</p>}
          {periodos?.map((p) => (
            <div key={p.id} className="membresia-periodo">
              <span>{fechaLarga(p.desde)} → {fechaLarga(p.hasta)}</span>
              <span className="text-sm">
                {(p.beneficios || []).map((b) => `${b.nombre}: ${(p.usadosPorBeneficio || {})[b.id] || 0}${b.usos == null ? '' : `/${b.usos}`}`).join(' · ')}
              </span>
              <span className="text-sm text-secondary">
                {p.estado === 'vigente' ? '' : p.estado === 'revertido' ? '⚠️ cuota devuelta' : 'cerrado'}
                {p.monto ? ` ${formatPrice(p.monto, moneda)}` : ''}
              </span>
            </div>
          ))}

          <h3 className="membresia-subtitulo">Usos ({listaUsos.filter(usoVivo).length})</h3>
          {listaUsos.length === 0 && <p className="text-sm text-secondary">Todavía no la usó.</p>}
          {listaUsos.map((u) => (
            <div key={u.id} className="membresia-uso">
              <span>{fechaCorta(u.appointmentDate)} · {u.serviceName}</span>
              <span className="text-sm text-secondary">✂️ {nombreProf(u.professionalId)}{nombreSuc(u.sucursalId) ? ` · ${nombreSuc(u.sucursalId)}` : ''}</span>
              <Estado estado={u.estado} mapa={ESTADOS_USO} />
            </div>
          ))}

          {pagos.length > 0 && (
            <>
              <h3 className="membresia-subtitulo">Cobros</h3>
              {[...pagos].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).map((p) => (
                <div key={p.id} className="membresia-uso">
                  <span>{fechaLarga(p.fecha)}</span>
                  <span className="text-sm text-secondary">{p.origen === 'manual' ? 'a mano' : 'Mercado Pago'}{p.revertido ? ' · devuelto' : ''}</span>
                  <span>{formatPrice(p.monto, moneda)}</span>
                </div>
              ))}
            </>
          )}

          <h3 className="membresia-subtitulo">Historial</h3>
          {historial.map((h, i) => (
            <div key={i} className="text-sm membresia-historial">
              <span>{h.en?.toDate ? h.en.toDate().toLocaleDateString('es-AR') : ''}</span>
              <span>{ESTADOS_MEMBRESIA[h.estado]?.label || h.estado}</span>
              <span className="text-secondary">{h.causa}{h.por === 'mercadopago' ? ' (Mercado Pago)' : ''}</span>
            </div>
          ))}

          {baja && (
            <div className="card" style={{ marginTop: 'var(--space-md)' }}>
              <p className="text-sm">
                Se respeta lo que ya pagó: puede usarla hasta el {fechaLarga(m.periodoActual?.hasta)}.
                {conMP && ' La suscripción también se cancela en Mercado Pago: no se le cobra más.'}
              </p>
              <input className="form-input" placeholder="Motivo (opcional)" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            </div>
          )}
          {error && <div className="notice notice-danger">{error}</div>}
        </div>
        {!finalizada && (
          <div className="modal-footer" style={{ flexWrap: 'wrap' }}>
            {!baja && m.estado !== 'cancelada' && (
              <button className="btn btn-ghost" onClick={() => setBaja(true)} disabled={trabajando}>Dar de baja</button>
            )}
            {baja && (
              <button className="btn btn-danger" disabled={trabajando}
                onClick={() => accion(() => cancelarMembresia({ businessId: cuentaId, membresiaId: m.id, motivo }), `Membresía de ${m.clienteNombre} dada de baja.`)}>
                Confirmar baja
              </button>
            )}
            <button className="btn btn-outline" onClick={onCambiarPlan} disabled={trabajando}>Cambiar plan</button>
            {!conMP && (
              <button className="btn btn-primary" disabled={trabajando}
                onClick={() => accion(() => renovarMembresia({ businessId: cuentaId, membresiaId: m.id }), `Renovada: ${m.clienteNombre} tiene un mes nuevo.`)}>
                Registrar pago del mes
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Planes ─────────────────────────────────────────────────────────────────

function Planes({ planes, cuentaId, moneda, servicios, sucursales, esMultiSucursal, onHecho }) {
  const [editando, setEditando] = useState(null);
  return (
    <>
      <div className="filters-bar">
        <button className="btn btn-primary" onClick={() => setEditando({})}>+ Nuevo plan</button>
      </div>
      {planes.length === 0 && (
        <div className="card empty-state" style={{ padding: 'var(--space-xl)' }}>
          <p>Creá tu primer plan. Por ejemplo: <strong>Corte Mensual</strong>, $25.000 por mes, 4 cortes.</p>
        </div>
      )}
      <div className="membresia-planes">
        {planes.map((p) => (
          <div key={p.id} className="card membresia-plan">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <h3>{p.nombre}</h3>
              {p.activo === false && <span className="badge badge-neutral">Desactivado</span>}
            </div>
            <div className="membresia-plan-precio">{formatPrice(p.precioMensual, moneda)}<span>/mes</span></div>
            {p.descripcion && <p className="text-sm text-secondary">{p.descripcion}</p>}
            <ul className="membresia-plan-beneficios">
              {(p.beneficios || []).map((b) => (
                <li key={b.id}>{b.usos == null ? `${b.nombre} ilimitado` : `${b.usos} × ${b.nombre}`}</li>
              ))}
              {p.usosTotales != null && <li>Hasta {p.usosTotales} usos en total por mes</li>}
            </ul>
            <button className="btn btn-outline btn-sm" onClick={() => setEditando(p)}>Editar</button>
          </div>
        ))}
      </div>
      {editando && (
        <PlanModal plan={editando} cuentaId={cuentaId} servicios={servicios} sucursales={sucursales} esMultiSucursal={esMultiSucursal}
          onCerrar={() => setEditando(null)} onListo={(t) => { setEditando(null); onHecho(t); }} />
      )}
    </>
  );
}

function PlanModal({ plan, cuentaId, servicios, sucursales, esMultiSucursal, onCerrar, onListo }) {
  const [f, setF] = useState({
    nombre: plan.nombre || '',
    descripcion: plan.descripcion || '',
    precioMensual: plan.precioMensual ?? '',
    usosTotales: plan.usosTotales ?? '',
    activo: plan.activo !== false,
    beneficios: plan.beneficios?.length
      ? plan.beneficios.map((b) => ({ ...b, usos: b.usos ?? '' }))
      : [{ nombre: '', usos: '', servicios: [] }],
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  const setB = (i, cambios) => setF((x) => ({ ...x, beneficios: x.beneficios.map((b, j) => (j === i ? { ...b, ...cambios } : b)) }));
  const tiene = (b, s) => b.servicios.some((x) => x.businessId === s.__bizId && x.serviceId === s.id);
  const alternar = (i, s) => {
    const b = f.beneficios[i];
    const servs = tiene(b, s)
      ? b.servicios.filter((x) => !(x.businessId === s.__bizId && x.serviceId === s.id))
      : [...b.servicios, { businessId: s.__bizId, serviceId: s.id }];
    setB(i, { servicios: servs, nombre: b.nombre || s.name });
  };
  const nombreSuc = (id) => sucursales.find((x) => x.id === id)?.name || '';
  const activos = servicios.filter((s) => s.isActive !== false);

  const guardar = async () => {
    setGuardando(true);
    setError('');
    try {
      await guardarPlanMembresia({
        businessId: cuentaId,
        planId: plan.id || null,
        ...f,
        precioMensual: Number(f.precioMensual),
        usosTotales: f.usosTotales === '' ? null : Number(f.usosTotales),
        beneficios: f.beneficios.map((b) => ({ ...b, usos: b.usos === '' ? null : Number(b.usos) })),
      });
      onListo(`Plan "${f.nombre}" guardado.`);
    } catch (err) {
      setError(err.message);
      setGuardando(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onCerrar}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 600 }}>
        <div className="modal-header">
          <h2>{plan.id ? 'Editar plan' : 'Nuevo plan'}</h2>
          <button className="modal-close" onClick={onCerrar}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Nombre <span className="required">*</span></label>
            <input className="form-input" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} placeholder="Corte Mensual" />
          </div>
          <div className="form-group">
            <label className="form-label">Descripción</label>
            <input className="form-input" value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} />
          </div>
          <div className="membresia-dos">
            <div className="form-group">
              <label className="form-label">Precio por mes <span className="required">*</span></label>
              <input className="form-input" type="number" min="1" value={f.precioMensual} onChange={(e) => setF({ ...f, precioMensual: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Tope total de usos por mes</label>
              <input className="form-input" type="number" min="1" value={f.usosTotales} onChange={(e) => setF({ ...f, usosTotales: e.target.value })} placeholder="sin tope" />
            </div>
          </div>

          <h3 className="membresia-subtitulo">Qué incluye</h3>
          <p className="text-xs text-muted">
            Cada beneficio es un grupo de servicios que comparten el cupo.{esMultiSucursal ? ' Marcá el mismo servicio en cada sucursal para que se pueda usar en cualquiera.' : ''} Usos vacío = ilimitado.
          </p>
          {f.beneficios.map((b, i) => (
            <div key={i} className="card membresia-beneficio">
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input className="form-input" style={{ flex: 2, minWidth: 140 }} placeholder="Nombre (Corte)" value={b.nombre} onChange={(e) => setB(i, { nombre: e.target.value })} />
                <input className="form-input" style={{ flex: 1, minWidth: 90 }} type="number" min="1" placeholder="ilimitado" value={b.usos} onChange={(e) => setB(i, { usos: e.target.value })} />
                {f.beneficios.length > 1 && (
                  <button className="btn btn-ghost btn-sm" onClick={() => setF((x) => ({ ...x, beneficios: x.beneficios.filter((_, j) => j !== i) }))}>Quitar</button>
                )}
              </div>
              <div className="membresia-servicios">
                {activos.map((s) => (
                  <label key={`${s.__bizId}-${s.id}`} className="text-sm">
                    <input type="checkbox" checked={tiene(b, s)} onChange={() => alternar(i, s)} />
                    {s.name}{esMultiSucursal ? <span className="text-muted"> · {nombreSuc(s.__bizId)}</span> : ''}
                  </label>
                ))}
              </div>
            </div>
          ))}
          <button className="btn btn-ghost btn-sm" onClick={() => setF((x) => ({ ...x, beneficios: [...x.beneficios, { nombre: '', usos: '', servicios: [] }] }))}>
            + Otro beneficio
          </button>

          {plan.id && (
            <label className="text-sm" style={{ display: 'flex', gap: 6, marginTop: 'var(--space-md)' }}>
              <input type="checkbox" checked={f.activo} onChange={(e) => setF({ ...f, activo: e.target.checked })} />
              Plan activo (desactivado: no se carga a clientes nuevos; los que lo tienen siguen igual)
            </label>
          )}
          {plan.id && <p className="text-xs text-muted">Los cambios corren desde la próxima renovación de cada cliente: el mes que ya pagaron sigue con lo que contrataron.</p>}
          {error && <div className="notice notice-danger">{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onCerrar}>Cancelar</button>
          <button className="btn btn-primary" onClick={guardar} disabled={guardando || !f.nombre.trim() || !f.precioMensual}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Auditoría ──────────────────────────────────────────────────────────────

function Auditoria({ usos, moneda, profesionales, sucursales, esMultiSucursal, nombreProf, nombreSuc, onHecho }) {
  const [filtros, setFiltros] = useState({ mes: mesActual(), professionalId: '', sucursalId: '', origen: '', estado: '', revision: false });
  const [revirtiendo, setRevirtiendo] = useState(null);
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');
  const set = (k) => (e) => setFiltros((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const meses = useMemo(() => [...new Set(usos.map((u) => mesDe(u.appointmentDate)).filter(Boolean))].sort().reverse(), [usos]);
  const lista = useMemo(() => filtrarUsos(usos, filtros), [usos, filtros]);
  const porBarbero = useMemo(() => usosAgrupados(lista, 'professionalId'), [lista]);
  const porServicio = useMemo(() => usosAgrupados(lista, 'serviceName'), [lista]);

  const revertir = async () => {
    setError('');
    try {
      await revertirUsoMembresia({ businessId: revirtiendo.sucursalId, appointmentId: revirtiendo.appointmentId, motivo });
      setRevirtiendo(null);
      setMotivo('');
      onHecho('Uso revertido: el turno vuelve a cobrarse y el uso vuelve al cupo del cliente.');
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <div className="filters-bar">
        <select className="form-input" value={filtros.mes} onChange={set('mes')} style={{ maxWidth: 180 }}>
          <option value="todos">Todos los meses</option>
          {[...new Set([mesActual(), ...meses])].map((m) => <option key={m} value={m}>{nombreDeMes(m)}</option>)}
        </select>
        <select className="form-input" value={filtros.professionalId} onChange={set('professionalId')} style={{ maxWidth: 190 }}>
          <option value="">Todos los barberos</option>
          {profesionales.map((p) => <option key={`${p.__bizId}-${p.id}`} value={p.id}>{p.name}</option>)}
        </select>
        {esMultiSucursal && (
          <select className="form-input" value={filtros.sucursalId} onChange={set('sucursalId')} style={{ maxWidth: 200 }}>
            <option value="">Todas las sucursales</option>
            {sucursales.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        <select className="form-input" value={filtros.origen} onChange={set('origen')} style={{ maxWidth: 200 }}>
          <option value="">Cualquier origen</option>
          {Object.entries(ORIGENES_USO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="form-input" value={filtros.estado} onChange={set('estado')} style={{ maxWidth: 170 }}>
          <option value="">Cualquier estado</option>
          {Object.entries(ESTADOS_USO).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <label className="text-sm" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={filtros.revision} onChange={set('revision')} /> Para revisar
        </label>
      </div>

      <div className="revenue-section">
        <div className="revenue-card">
          <h3>Por barbero</h3>
          {porBarbero.length === 0 && <p className="text-sm text-secondary">Sin usos con estos filtros.</p>}
          {porBarbero.map((g) => (
            <div key={g.clave} className="revenue-bar-item">
              <div className="revenue-bar-header">
                <span>{nombreProf(g.clave)}</span>
                <span className="text-secondary">{g.cantidad} · {formatPrice(g.valor, moneda)}</span>
              </div>
              <div className="revenue-bar-track"><div className="revenue-bar-fill" style={{ width: `${(g.cantidad / porBarbero[0].cantidad) * 100}%` }} /></div>
            </div>
          ))}
        </div>
        <div className="revenue-card">
          <h3>Por servicio</h3>
          {porServicio.map((g) => (
            <div key={g.clave} className="revenue-bar-item">
              <div className="revenue-bar-header"><span>{g.clave}</span><span className="text-secondary">{g.cantidad}</span></div>
              <div className="revenue-bar-track"><div className="revenue-bar-fill" style={{ width: `${(g.cantidad / porServicio[0].cantidad) * 100}%` }} /></div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>{lista.length} {lista.length === 1 ? 'uso' : 'usos'}</h3>
        {lista.map((u) => (
          <div key={u.id} className="membresia-auditoria-fila">
            <div>
              <strong>{u.clienteNombre}</strong> · {u.serviceName}
              <div className="text-sm text-secondary">
                {fechaLarga(u.appointmentDate)} · ✂️ {nombreProf(u.professionalId)}
                {esMultiSucursal ? ` · ${nombreSuc(u.sucursalId)}` : ''} · {formatPrice(u.valorServicio, moneda)}
              </div>
              <div className="text-xs text-muted">
                {ORIGENES_USO[u.origen] || u.origen}
                {u.creadoEn?.toDate ? ` · registrado ${u.creadoEn.toDate().toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}` : ''}
                {u.motivo ? ` · “${u.motivo}”` : ''}
              </div>
              {(u.eventos || []).length > 1 && (
                <div className="text-xs text-muted">
                  {(u.eventos || []).map((e) => `${ESTADOS_USO[e.estado]?.label || e.estado}${e.motivo ? ` (${e.motivo})` : ''}`).join(' → ')}
                </div>
              )}
              {u.requiereRevision && <div className="text-xs" style={{ color: 'var(--warning)' }}>⚠️ {u.requiereRevision}</div>}
            </div>
            <div className="membresia-auditoria-acciones">
              <Estado estado={u.estado} mapa={ESTADOS_USO} />
              {usoVivo(u) && <button className="btn btn-ghost btn-sm" onClick={() => { setRevirtiendo(u); setMotivo(''); setError(''); }}>Revertir</button>}
            </div>
          </div>
        ))}
      </div>

      {revirtiendo && (
        <div className="modal-overlay" onClick={() => setRevirtiendo(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <div className="modal-header">
              <h2>Revertir uso</h2>
              <button className="modal-close" onClick={() => setRevirtiendo(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p className="text-sm">
                {revirtiendo.clienteNombre} · {revirtiendo.serviceName} · {fechaLarga(revirtiendo.appointmentDate)}.
                El turno vuelve a ser un turno normal ({formatPrice(revirtiendo.valorServicio, moneda)}) y el uso vuelve al cupo del cliente.
              </p>
              <input className="form-input" placeholder="Motivo (queda en la auditoría)" value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus />
              {error && <div className="notice notice-danger">{error}</div>}
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setRevirtiendo(null)}>Cancelar</button>
              <button className="btn btn-danger" onClick={revertir} disabled={motivo.trim().length < 3}>Revertir</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
