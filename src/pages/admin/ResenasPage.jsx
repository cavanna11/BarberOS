import { useState, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../hooks/useTenantData';
import { useDatosDeSucursales } from '../../hooks/useDatosDeSucursales';
import { fechaCorta, formatDate } from '../../utils/dateUtils';
import {
  PERIODOS,
  filtrarResenas,
  estadisticasDeResenas,
  promedioPorBarbero,
  promedioPorSucursal,
  estrellasDe,
  linkGoogle,
} from '../../utils/resenas';

// ============================================================================
// Reseñas de la barbería
// ============================================================================
// Lo que dejan los clientes después de un turno atendido: estrellas y, si
// quieren, un comentario.
//
// Se leen de una sola vez al entrar y no con una suscripción viva: son datos que
// se consultan de vez en cuando, no la agenda del día. Hay botón para releer.
//
// El barbero ve SOLO las suyas: las Rules le filtran por su professionalId, así
// que si pide las de todos la consulta se rechaza entera. Por eso la pantalla
// también le esconde los filtros que no le sirven.

function Estrellas({ n }) {
  const { llenas, vacias } = estrellasDe(n);
  return (
    <span className="estrellas-resumen" title={`${n} de 5`}>
      {llenas}<span className="estrella-apagada">{vacias}</span>
    </span>
  );
}

export default function ResenasPage() {
  const { user } = useAuth();
  const { business, businessId, professionals, services, sucursales, esMultiSucursal } = useTenant();

  const isOwner = user?.role === 'owner' || user?.isPlatformTeam === true;
  const profIdPropio = user?.professionalId ?? null;

  // Las reseñas de todas las sucursales de la cuenta (una sola si no es
  // empresarial). Los profesionales y servicios también, porque los nombres de
  // una sucursal no están en el contexto de la otra.
  const { juntar, cargando, error, recargar } = useDatosDeSucursales(
    ['reviews', 'professionals', 'services'],
    { activo: Boolean(businessId) }
  );

  const [periodo, setPeriodo] = useState('todo');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [profFiltro, setProfFiltro] = useState('');
  const [sucFiltro, setSucFiltro] = useState('');
  const [estrellasFiltro, setEstrellasFiltro] = useState(0);

  const todas = useMemo(() => juntar('reviews'), [juntar]);
  const todosLosProfes = useMemo(() => {
    const delContexto = professionals.map((p) => ({ ...p, __bizId: businessId }));
    const deSucursales = juntar('professionals');
    // Por id: el contexto y la lectura traen los mismos del negocio activo.
    const porId = new Map(deSucursales.map((p) => [p.id, p]));
    for (const p of delContexto) if (!porId.has(p.id)) porId.set(p.id, p);
    return [...porId.values()];
  }, [juntar, professionals, businessId]);

  const todosLosServicios = useMemo(() => {
    const porId = new Map(juntar('services').map((s) => [s.id, s]));
    for (const s of services) if (!porId.has(s.id)) porId.set(s.id, s);
    return [...porId.values()];
  }, [juntar, services]);

  const filtradas = useMemo(() => {
    let base = todas;
    // El barbero solo ve las de sus propios turnos. Redundante con las Rules,
    // que son las que de verdad lo impiden; acá es para que la pantalla no
    // prometa un filtro que el servidor va a rechazar.
    if (!isOwner) base = profIdPropio ? base.filter((r) => r.professionalId === profIdPropio) : [];

    return filtrarResenas(base, {
      periodo,
      desde,
      hasta,
      professionalId: isOwner ? profFiltro : profIdPropio || '',
      businessId: sucFiltro,
      estrellas: estrellasFiltro,
    }).sort((a, b) => String(b.appointmentDate || '').localeCompare(String(a.appointmentDate || '')));
  }, [todas, isOwner, profIdPropio, periodo, desde, hasta, profFiltro, sucFiltro, estrellasFiltro]);

  const stats = useMemo(() => estadisticasDeResenas(filtradas), [filtradas]);
  const porBarbero = useMemo(() => promedioPorBarbero(filtradas, todosLosProfes), [filtradas, todosLosProfes]);
  const porSucursal = useMemo(() => promedioPorSucursal(filtradas, sucursales), [filtradas, sucursales]);

  const nombreProf = (id) => todosLosProfes.find((p) => p.id === id)?.name || '—';
  const nombreSrv = (id) => todosLosServicios.find((s) => s.id === id)?.name || '—';
  const nombreSuc = (id) => sucursales.find((s) => s.id === id)?.name || '';

  const google = linkGoogle(business);
  // Con Boolean() y `> 0`: `estrellasFiltro` es un NÚMERO, y `a || b || 0`
  // devuelve 0, que React dibuja como un "0" suelto al lado de los filtros.
  const hayFiltros = periodo !== 'todo' || Boolean(profFiltro) || Boolean(sucFiltro) || estrellasFiltro > 0;

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1>Reseñas</h1>
          <span className="text-secondary text-sm">
            {isOwner ? 'Lo que dicen tus clientes después de cada turno' : 'Lo que dicen tus clientes de tus turnos'}
          </span>
        </div>
        <button className="btn btn-outline" onClick={recargar} disabled={cargando}>
          {cargando ? 'Leyendo…' : '↻ Actualizar'}
        </button>
      </div>

      {error && <div className="notice notice-danger">{error}</div>}

      {/* Resumen */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: 'var(--warning-light)', color: '#f5a623' }}>★</div>
          <div className="stat-card-value">{stats.total ? stats.promedio.toFixed(1) : '—'}</div>
          <div className="stat-card-label">Promedio</div>
          {stats.total > 0 && (
            <div className="stat-card-change positive"><Estrellas n={Math.round(stats.promedio)} /></div>
          )}
        </div>
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: 'var(--primary-light)', color: 'var(--primary)' }}>💬</div>
          <div className="stat-card-value">{stats.total}</div>
          <div className="stat-card-label">Reseñas</div>
          <div className="stat-card-change positive">{stats.conComentario} con comentario</div>
        </div>
        <div className="stat-card" style={{ gridColumn: 'span 2', minWidth: 240 }}>
          <div className="stat-card-label" style={{ marginBottom: 8 }}>Distribución</div>
          {[5, 4, 3, 2, 1].map((n) => {
            const cuantas = stats.distribucion[n];
            const porcentaje = stats.total ? (cuantas / stats.total) * 100 : 0;
            return (
              <div key={n} className="distribucion-fila">
                <span><Estrellas n={n} /></span>
                <span className="distribucion-barra">
                  <span className="distribucion-relleno" style={{ width: `${porcentaje}%` }} />
                </span>
                <span className="text-muted">{cuantas}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Filtros */}
      <div className="filters-bar">
        <select className="form-input" value={periodo} onChange={(e) => setPeriodo(e.target.value)} style={{ maxWidth: 190 }}>
          {PERIODOS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>

        {periodo === 'rango' && (
          <>
            <input type="date" className="form-input" value={desde} onChange={(e) => setDesde(e.target.value)} style={{ maxWidth: 170 }} />
            <input type="date" className="form-input" value={hasta} onChange={(e) => setHasta(e.target.value)} style={{ maxWidth: 170 }} />
          </>
        )}

        {esMultiSucursal && (
          <select className="form-input" value={sucFiltro} onChange={(e) => setSucFiltro(e.target.value)} style={{ maxWidth: 220 }}>
            <option value="">Todas las sucursales</option>
            {sucursales.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}

        {isOwner && (
          <select className="form-input" value={profFiltro} onChange={(e) => setProfFiltro(e.target.value)} style={{ maxWidth: 200 }}>
            <option value="">Todos los barberos</option>
            {todosLosProfes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}

        <select className="form-input" value={estrellasFiltro} onChange={(e) => setEstrellasFiltro(Number(e.target.value))} style={{ maxWidth: 170 }}>
          <option value={0}>Todas las estrellas</option>
          {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} {n === 1 ? 'estrella' : 'estrellas'}</option>)}
        </select>

        {hayFiltros && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => { setPeriodo('todo'); setDesde(''); setHasta(''); setProfFiltro(''); setSucFiltro(''); setEstrellasFiltro(0); }}
          >
            ✕ Limpiar
          </button>
        )}
      </div>

      {/* Promedios por barbero y por sucursal */}
      {isOwner && (porBarbero.length > 1 || porSucursal.length > 1) && (
        <div className="revenue-section">
          {porBarbero.length > 1 && (
            <div className="revenue-card">
              <h3>Promedio por barbero</h3>
              {porBarbero.map((p) => (
                <div key={p.id} className="revenue-bar-item">
                  <div className="revenue-bar-header">
                    <span>{p.name}</span>
                    <span className="text-secondary">
                      {p.promedio.toFixed(1)} · {p.total} {p.total === 1 ? 'reseña' : 'reseñas'}
                    </span>
                  </div>
                  <div className="revenue-bar-track">
                    <div className="revenue-bar-fill" style={{ width: `${(p.promedio / 5) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
          {porSucursal.length > 1 && (
            <div className="revenue-card">
              <h3>Promedio por sucursal</h3>
              {porSucursal.map((s) => (
                <div key={s.id} className="revenue-bar-item">
                  <div className="revenue-bar-header">
                    <span>{s.name}</span>
                    <span className="text-secondary">
                      {s.promedio.toFixed(1)} · {s.total} {s.total === 1 ? 'reseña' : 'reseñas'}
                    </span>
                  </div>
                  <div className="revenue-bar-track">
                    <div className="revenue-bar-fill" style={{ width: `${(s.promedio / 5) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* El listado */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <h3>{filtradas.length} {filtradas.length === 1 ? 'reseña' : 'reseñas'}</h3>
          {google && (
            <a href={google} target="_blank" rel="noreferrer" className="text-sm" style={{ fontWeight: 600 }}>
              Ver tu ficha de Google →
            </a>
          )}
        </div>

        {cargando && filtradas.length === 0 && (
          <p className="text-secondary" style={{ marginTop: 10 }}>Leyendo…</p>
        )}

        {!cargando && filtradas.length === 0 && (
          <div className="empty-state" style={{ padding: 'var(--space-xl)' }}>
            <div className="empty-state-icon">★</div>
            <p>
              {hayFiltros
                ? 'No hay reseñas con estos filtros.'
                : 'Todavía no hay reseñas. Aparecen cuando marcás un turno como atendido y el cliente lo valora desde "Mis citas".'}
            </p>
          </div>
        )}

        {filtradas.map((r) => (
          <div key={`${r.__bizId}-${r.id}`} className="resena-item">
            <div className="resena-cabecera">
              <span>
                <Estrellas n={r.stars} />
                <strong style={{ marginLeft: 8 }}>{r.clientName || 'Cliente'}</strong>
              </span>
              <span className="text-muted" style={{ fontSize: 12 }} title={formatDate(r.appointmentDate)}>
                {fechaCorta(r.appointmentDate)}
              </span>
            </div>

            {r.comment && <p className="resena-comentario">“{r.comment}”</p>}

            <div className="resena-meta">
              <span>✂️ {nombreProf(r.professionalId)}</span>
              <span>{nombreSrv(r.serviceId)}</span>
              {esMultiSucursal && <span>🏠 {nombreSuc(r.__bizId || r.businessId)}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
