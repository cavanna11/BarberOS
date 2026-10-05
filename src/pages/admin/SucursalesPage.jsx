import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useBusiness } from '../../contexts/BusinessContext';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../hooks/useTenantData';
import { obtenerSubcoleccion, isSlugAvailable } from '../../lib/repository';
import { crearSucursal } from '../../lib/functions';
import { limitesDelNegocio } from '../../config/plans';
import { formatPrice } from '../../utils/dateUtils';
import { slugify } from '../../utils/slug';
import {
  ingresosDelMes,
  ingresosHistoricos,
  mesActual,
  nombreDeMes,
} from '../../utils/ingresos';

// ============================================================================
// Mis sucursales — la capa de arriba de una cuenta empresarial
// ============================================================================
// Lo que resuelve: con cuatro locales, el dueño necesita dos cosas que el panel
// de una barbería no puede darle. Una, los números de las cuatro juntas sin
// entrar a cada una. Dos, cambiar de sucursal sin cerrar sesión.
//
// Lo que NO hace, a propósito: mezclar datos. Cada sucursal tiene su equipo, sus
// servicios, sus horarios y su agenda, y acá se muestran por separado. El total
// consolidado es una SUMA de números ya calculados por sucursal, no una consulta
// que junte turnos de todas en una misma bolsa — así no hay forma de que un turno
// de una aparezca en la agenda de la otra.
//
// Los datos se leen una vez al entrar (no con suscripciones vivas): mantener
// cuatro agendas escuchando en todas las pantallas del panel sería pagar cuatro
// veces lo mismo todo el tiempo. Hay un botón para releer.

const LINK_AMPLIAR = 'https://wa.me/5492257529684?text=' +
  encodeURIComponent('Hola! Quiero sumar una sucursal más a mi cuenta de BarberOS.');

/** Los números de UNA sucursal. */
function numerosDe(datos, mes) {
  const turnos = datos?.appointments || [];
  const delMes = ingresosDelMes(turnos, mes);
  const total = ingresosHistoricos(turnos);
  return {
    barberos: (datos?.professionals || []).filter((p) => p.isActive !== false).length,
    servicios: (datos?.services || []).filter((s) => s.isActive !== false).length,
    turnosDelMes: turnos.filter((a) => (a.appointmentDate || '').startsWith(mes)).length,
    // Clientes distintos que alguna vez reservaron en ESTA sucursal.
    clientes: new Set(turnos.map((a) => a.userId).filter(Boolean)).size,
    ingresosDelMes: delMes.total,
    ingresosTotales: total.total,
    completados: total.count,
  };
}

export default function SucursalesPage() {
  const { business, businessId, sucursales, esMultiSucursal } = useTenant();
  const { dispatch } = useBusiness();
  const { user, refreshClaims } = useAuth();

  const mes = mesActual();
  const [datos, setDatos] = useState({});
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [creando, setCreando] = useState(false);
  // La sucursal recién creada, hasta que llegue por la suscripción.
  const [reciente, setReciente] = useState(null);

  // Las sucursales del grupo, en el orden en que llegaron (la principal primero).
  const principalId = user?.grupoId || businessId;
  const ordenadas = [...sucursales].sort((a, b) => {
    if (a.id === principalId) return -1;
    if (b.id === principalId) return 1;
    return (a.name || '').localeCompare(b.name || '');
  });

  const idsClave = ordenadas.map((s) => s.id).join(',');

  const cargar = useCallback(async () => {
    if (!idsClave) return;
    setCargando(true);
    setError('');
    const ids = idsClave.split(',');
    try {
      const leidas = await Promise.all(
        ids.map(async (id) => [
          id,
          {
            appointments: await obtenerSubcoleccion(id, 'appointments'),
            professionals: await obtenerSubcoleccion(id, 'professionals'),
            services: await obtenerSubcoleccion(id, 'services'),
          },
        ])
      );
      setDatos(Object.fromEntries(leidas));
    } catch (err) {
      console.error('[Sucursales] No se pudieron leer los datos:', err);
      setError('No se pudieron leer los datos de todas las sucursales: ' + err.message);
    } finally {
      setCargando(false);
    }
  }, [idsClave]);

  useEffect(() => { cargar(); }, [cargar]);

  // Entrar a la sucursal recién creada no se puede hacer en el mismo momento de
  // crearla: el cambio de negocio activo se valida contra la lista de negocios
  // que tiene la app, y esa lista llega por la suscripción un instante después
  // (primero el token nuevo con la sucursal adentro, después los datos). Sin
  // esto el dispatch se descartaba en silencio y uno quedaba parado en la
  // sucursal anterior sin entender por qué.
  useEffect(() => {
    if (!reciente) return;
    if (sucursales.some((s) => s.id === reciente)) {
      dispatch({ type: 'SET_CURRENT_BUSINESS', payload: reciente });
      cargar();
      setReciente(null);
    }
  }, [reciente, sucursales, dispatch, cargar]);

  const { maxSucursales } = limitesDelNegocio(
    sucursales.find((s) => s.id === principalId) || business
  );
  const puedeAbrirMas = maxSucursales === null || ordenadas.length < maxSucursales;

  // El consolidado es la suma de los números de cada una.
  const porSucursal = ordenadas.map((s) => ({ sucursal: s, n: numerosDe(datos[s.id], mes) }));
  const totalEs = (campo) => porSucursal.reduce((suma, f) => suma + f.n[campo], 0);

  const entrarA = (id) => dispatch({ type: 'SET_CURRENT_BUSINESS', payload: id });

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1>Mis sucursales</h1>
          <span className="text-secondary text-sm">
            {ordenadas.length} {ordenadas.length === 1 ? 'barbería' : 'barberías'} en esta cuenta
            {maxSucursales !== null && ` · hasta ${maxSucursales} con tu plan`}
          </span>
        </div>
        <div className="flex items-center gap-md">
          <button className="btn btn-outline" onClick={cargar} disabled={cargando}>
            {cargando ? 'Leyendo…' : '↻ Actualizar'}
          </button>
          {puedeAbrirMas ? (
            <button className="btn btn-primary" onClick={() => setCreando(true)}>
              + Nueva sucursal
            </button>
          ) : (
            <a href={LINK_AMPLIAR} target="_blank" rel="noreferrer" className="btn btn-outline">
              Sumar una sucursal más
            </a>
          )}
        </div>
      </div>

      {error && <div className="notice notice-danger">{error}</div>}

      {reciente && (
        <div className="notice notice-info">
          Creando la sucursal… en un momento aparece en la lista y el panel se pasa a ella.
        </div>
      )}

      {!esMultiSucursal && (
        <div className="notice notice-info">
          Todavía tenés una sola barbería. Con el <strong>Plan Empresarial</strong> podés abrir
          hasta cuatro, cada una con su equipo, sus servicios y su agenda, administradas desde
          esta misma cuenta.
        </div>
      )}

      {/* Consolidado de todas */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: 'var(--primary-light)', color: 'var(--primary)' }}>🏠</div>
          <div className="stat-card-value">{ordenadas.length}</div>
          <div className="stat-card-label">Sucursales</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: 'var(--success-light)', color: 'var(--success)' }}>💵</div>
          <div className="stat-card-value">{formatPrice(totalEs('ingresosDelMes'), business?.currency)}</div>
          <div className="stat-card-label">Ingresos de {nombreDeMes(mes)}</div>
          <div className="stat-card-change positive">Todas las sucursales juntas</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: 'var(--primary-light)', color: 'var(--primary)' }}>💰</div>
          <div className="stat-card-value">{formatPrice(totalEs('ingresosTotales'), business?.currency)}</div>
          <div className="stat-card-label">Ingresos históricos</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: 'var(--primary-light)', color: 'var(--primary)' }}>📅</div>
          <div className="stat-card-value">{totalEs('turnosDelMes')}</div>
          <div className="stat-card-label">Turnos del mes</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: 'var(--bg-secondary)', color: 'var(--text)' }}>👥</div>
          <div className="stat-card-value">{totalEs('barberos')}</div>
          <div className="stat-card-label">Barberos activos</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: 'var(--bg-secondary)', color: 'var(--text)' }}>🙋</div>
          <div className="stat-card-value">{totalEs('clientes')}</div>
          <div className="stat-card-label">Clientes distintos</div>
          <div className="stat-card-change positive">Sumados por sucursal</div>
        </div>
      </div>

      {/* Una por una */}
      <h3 style={{ marginBottom: 'var(--space-md)' }}>Sucursal por sucursal</h3>
      <div className="sucursales-grid">
        {porSucursal.map(({ sucursal, n }) => {
          const activa = sucursal.id === businessId;
          const principal = sucursal.id === principalId;
          return (
            <div
              key={sucursal.id}
              className="card"
              style={{
                padding: 'var(--space-md)',
                borderColor: activa ? 'var(--primary)' : undefined,
                borderWidth: activa ? 2 : 1,
                borderStyle: 'solid',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'start' }}>
                <div>
                  <strong style={{ fontSize: 15 }}>{sucursal.name}</strong>
                  <div className="text-muted" style={{ fontSize: 12 }}>/{sucursal.slug}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'end' }}>
                  {principal && <span className="badge badge-primary" style={{ fontSize: 10 }}>principal</span>}
                  {activa && <span className="badge badge-success" style={{ fontSize: 10 }}>estás acá</span>}
                  {sucursal.isFrozen && <span className="badge badge-danger" style={{ fontSize: 10 }}>suspendida</span>}
                </div>
              </div>

              <div className="sucursal-numeros">
                <div>
                  <span className="text-muted">{nombreDeMes(mes)}</span>
                  <strong>{formatPrice(n.ingresosDelMes, business?.currency)}</strong>
                </div>
                <div>
                  <span className="text-muted">Histórico</span>
                  <strong>{formatPrice(n.ingresosTotales, business?.currency)}</strong>
                </div>
                <div>
                  <span className="text-muted">Turnos del mes</span>
                  <strong>{n.turnosDelMes}</strong>
                </div>
                <div>
                  <span className="text-muted">Barberos</span>
                  <strong>{n.barberos}</strong>
                </div>
                <div>
                  <span className="text-muted">Servicios</span>
                  <strong>{n.servicios}</strong>
                </div>
                <div>
                  <span className="text-muted">Clientes</span>
                  <strong>{n.clientes}</strong>
                </div>
              </div>

              {/* Aviso de cuenta a medio armar: una sucursal sin barberos o sin
                  servicios no puede tomar un turno, y eso no se ve desde acá si
                  no se dice. */}
              {(n.barberos === 0 || n.servicios === 0) && (
                <div className="notice notice-warn" style={{ marginTop: 10, fontSize: 12 }}>
                  Falta cargar {n.barberos === 0 ? 'el equipo' : ''}
                  {n.barberos === 0 && n.servicios === 0 ? ' y ' : ''}
                  {n.servicios === 0 ? 'los servicios' : ''}: el link todavía no puede tomar turnos.
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 'var(--space-md)', flexWrap: 'wrap' }}>
                {activa ? (
                  <Link to="/admin" className="btn btn-primary btn-sm">Ir al panel</Link>
                ) : (
                  <Link to="/admin" className="btn btn-outline btn-sm" onClick={() => entrarA(sucursal.id)}>
                    Entrar a esta sucursal
                  </Link>
                )}
                <a
                  href={`/${sucursal.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-ghost btn-sm"
                  style={{ textDecoration: 'none' }}
                >
                  Ver link público
                </a>
              </div>
            </div>
          );
        })}
      </div>

      {creando && (
        <NuevaSucursalModal
          sucursales={ordenadas}
          onClose={() => setCreando(false)}
          onCreada={async (id) => {
            setCreando(false);
            // El permiso vive en el token: sin pedirlo de nuevo, la sucursal que
            // acaba de crear no existe para él hasta dentro de una hora.
            await refreshClaims().catch(() => {});
            setReciente(id);
          }}
        />
      )}
    </div>
  );
}

// ─── Alta de una sucursal ───────────────────────────────────────────────────
function NuevaSucursalModal({ sucursales, onClose, onCreada }) {
  const [form, setForm] = useState({
    nombre: '', slug: '', telefono: '', direccion: '', ciudad: '', copiarServiciosDe: '',
  });
  const [slugTocado, setSlugTocado] = useState(false);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  const set = (cambios) => setForm((f) => ({ ...f, ...cambios }));

  // El link se propone solo a partir del nombre, hasta que lo editen a mano.
  const cambiarNombre = (nombre) => {
    set({ nombre, ...(slugTocado ? {} : { slug: slugify(nombre) }) });
  };

  const guardar = async (ev) => {
    ev.preventDefault();
    if (guardando) return;
    setError('');

    if (form.nombre.trim().length < 2) return setError('Poné el nombre de la sucursal.');
    if (form.slug.length < 3) return setError('El link tiene que tener al menos 3 caracteres.');

    setGuardando(true);
    try {
      // Se chequea antes para dar un error claro en el campo; la function lo
      // vuelve a chequear en una transacción, que es lo que de verdad decide.
      if (!(await isSlugAvailable(form.slug))) {
        setError('Ese link ya está ocupado. Probá con otro.');
        setGuardando(false);
        return;
      }
      const r = await crearSucursal({
        nombre: form.nombre.trim(),
        slug: form.slug,
        telefono: form.telefono.trim(),
        direccion: form.direccion.trim(),
        ciudad: form.ciudad.trim(),
        copiarServiciosDe: form.copiarServiciosDe || null,
      });
      onCreada(r.businessId);
    } catch (err) {
      console.error('[Sucursales] No se pudo crear:', err);
      setError(err.message);
      setGuardando(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <form onSubmit={guardar}>
          <div className="modal-header">
            <h3>Nueva sucursal</h3>
            <button type="button" className="modal-close" onClick={onClose}>✕</button>
          </div>

          <div className="modal-body">
            <p className="text-secondary" style={{ fontSize: 13, marginBottom: 'var(--space-md)' }}>
              Nace con tus colores y el horario del local principal, y vacía de equipo y
              servicios: son datos de esta sucursal, no de la cuenta. El abono no cambia —
              las sucursales van adentro de tu plan.
            </p>

            {error && <div className="notice notice-danger">{error}</div>}

            <div className="form-group">
              <label className="form-label">Nombre de la sucursal</label>
              <input
                className="form-input"
                value={form.nombre}
                onChange={(e) => cambiarNombre(e.target.value)}
                placeholder="Barbería Centro"
                maxLength={60}
                autoFocus
              />
            </div>

            <div className="form-group">
              <label className="form-label">Su link público</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span className="text-muted" style={{ fontSize: 13 }}>{window.location.origin}/</span>
                <input
                  className="form-input"
                  style={{ flex: 1, minWidth: 160 }}
                  value={form.slug}
                  onChange={(e) => { setSlugTocado(true); set({ slug: slugify(e.target.value) }); }}
                  placeholder="barberia-centro"
                  maxLength={30}
                />
              </div>
              <p className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
                Cada sucursal tiene su propio link: el cliente reserva en la que le queda cerca.
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
              <div className="form-group">
                <label className="form-label">Teléfono (opcional)</label>
                <input
                  className="form-input"
                  value={form.telefono}
                  onChange={(e) => set({ telefono: e.target.value })}
                  maxLength={40}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Ciudad (opcional)</label>
                <input
                  className="form-input"
                  value={form.ciudad}
                  onChange={(e) => set({ ciudad: e.target.value })}
                  maxLength={60}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Dirección (opcional)</label>
              <input
                className="form-input"
                value={form.direccion}
                onChange={(e) => set({ direccion: e.target.value })}
                maxLength={120}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Copiar los servicios de</label>
              <select
                className="form-input"
                value={form.copiarServiciosDe}
                onChange={(e) => set({ copiarServiciosDe: e.target.value })}
              >
                <option value="">No copiar nada (los cargo a mano)</option>
                {sucursales.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <p className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
                Se copian como servicios nuevos de esta sucursal. Si después le cambiás el
                precio acá, en la otra no cambia nada.
              </p>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-outline" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={guardando}>
              {guardando ? 'Creando…' : 'Crear sucursal'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
