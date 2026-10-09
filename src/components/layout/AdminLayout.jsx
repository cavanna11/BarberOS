import { useState, useEffect, useRef } from 'react';
import CampanaNotificaciones from '../admin/CampanaNotificaciones';
import { NavLink, Outlet, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useBusiness } from '../../contexts/BusinessContext';
import { useCurrentBusiness } from '../../hooks/useCurrentBusiness';
import { permiteSucursales } from '../../config/plans';
import { refrescarPush, desactivarPush, esAppInstalada, esIOS, esAndroid, escucharEnPrimerPlano } from '../../lib/push';
import { useVinculoBarbero, textoVinculo } from '../../hooks/useVinculoBarbero';
import AvisoPlataforma from '../admin/AvisoPlataforma';
import ElegirSucursalPanel from '../admin/ElegirSucursalPanel';
import { sucursalElegidaEnPanel, elegirSucursalEnPanel, olvidarSucursalEnPanel } from '../../utils/sucursalEnPanel';

// Items visibles solo para el dueño (owner)
const ownerNavItems = [
  { to: '/admin',               icon: '📊', label: 'Dashboard',        end: true },
  // Citas va segundo a propósito: es la pantalla que más se abre en el día.
  { to: '/admin/citas',         icon: '📅', label: 'Citas' },
  // Solo para las cuentas que pueden tener más de una barbería: al que tiene
  // una sola, una sección llamada "Sucursales" no le dice nada.
  { to: '/admin/sucursales',    icon: '🏠', label: 'Mis sucursales', soloSucursales: true },
  { to: '/admin/profesionales', icon: '👥', label: 'Profesionales' },
  { to: '/admin/servicios',     icon: '✂️', label: 'Servicios' },
  { to: '/admin/resenas',       icon: '⭐', label: 'Reseñas' },
  { to: '/admin/admins',        icon: '🛡️', label: 'Administradores' },
  // La página de presentación de la barbería. No se filtra por plan a
  // propósito: el que no la tiene entra y ve qué es y desde qué plan está.
  // Esconderla lo deja creyendo que el sistema no la tiene.
  { to: '/admin/pagina',        icon: '🔗', label: 'Mi página' },
  { to: '/admin/cupones',       icon: '🎟️', label: 'Cupones' },
  // Solo en las cuentas donde la plataforma las habilitó (y para la plataforma,
  // que es la que las prende desde esa misma pantalla).
  { to: '/admin/membresias',    icon: '🪪', label: 'Membresías', soloMembresias: true },
  { to: '/admin/configuracion', icon: '⚙️', label: 'Configuración' },
  { to: '/admin/soporte',       icon: '💬', label: 'Soporte' },
  { to: '/admin/instalar',      icon: '📲', label: 'Instalar la app' },
];

// Items para el admin/peluquero → solo sus citas
const adminNavItems = [
  { to: '/admin',         icon: '🏠', label: 'Hoy', end: true },
  // La lista del día, con confirmar / vino / no vino / cancelar y "Agendar
  // turno". Es la que más se abre; la agenda como calendario vive abajo del
  // dashboard, que para eso alcanza.
  { to: '/admin/citas',   icon: '📅', label: 'Citas' },
  // El barbero ve las reseñas de SUS turnos: las Rules le filtran por su
  // perfil, así que no puede ver las de los demás ni pidiéndolas.
  { to: '/admin/resenas', icon: '⭐', label: 'Mis reseñas' },
  { to: '/admin/ajustes', icon: '⚙️', label: 'Mi Configuración' },
  { to: '/admin/soporte', icon: '💬', label: 'Soporte' },
  { to: '/admin/instalar', icon: '📲', label: 'Instalar la app' },
];

const ROLE_LABELS = {
  owner: { text: 'Dueño',  color: 'var(--primary)' },
  admin: { text: 'Peluquero', color: 'var(--success)' },
};

// Mismo número que la landing y el widget flotante. Si cambia, cambia en los tres.
const LINK_SOPORTE = 'https://wa.me/5492257529684?text=' +
  encodeURIComponent('Hola! Te escribo por mi cuenta de BarberOS.');

/**
 * Días que faltan para que termine la prueba. Negativo si ya venció, null si la
 * cuenta no es de prueba.
 *
 * Se compara en 'YYYY-MM-DD' y no con Date para no arrastrar la zona horaria del
 * browser: si el barbero tiene el reloj en otro huso, un turno de diferencia no
 * puede cambiarle el cartel.
 */
function diasDePruebaRestantes(trialEndsAt) {
  if (!trialEndsAt) return null;
  const hoy = new Date();
  const hoyISO = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
  const ms = new Date(`${trialEndsAt}T00:00:00`) - new Date(`${hoyISO}T00:00:00`);
  return Math.round(ms / 86400000);
}

export default function AdminLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, logout, refreshClaims } = useAuth();
  const navigate = useNavigate();
  const { business, businessId, isPlatformOwner: platformOwner, sucursales, esMultiSucursal } = useCurrentBusiness();
  const { state: bizState, dispatch } = useBusiness();

  // Al recargar la página, los negocios todavía no llegaron de Firestore (no se
  // guardan en el navegador a propósito: una copia vieja taparía la real). En
  // ese hueco `business` es null, y hasta ahora se mostraba "No hay ningún
  // negocio asignado a tu cuenta" — un cartel que dice justo lo contrario de lo
  // que pasa, y que el dueño ve cada vez que aprieta F5. Mismo criterio que
  // TenantRoute con el slug: el error, recién cuando se SABE.
  const esperandoNegocios = !business && (
    platformOwner ? bizState.negociosCargados !== true : (user?.businessIds?.length || 0) > 0
  );
  const vinculo = useVinculoBarbero();
  const [revisandoVinculo, setRevisandoVinculo] = useState(false);
  const [vinculoSigueRoto, setVinculoSigueRoto] = useState(false);

  // El permiso vive en el token, así que cuando el dueño vincula la cuenta el
  // barbero no se entera hasta que el token se renueva (hasta una hora) o
  // cierra sesión. Con el vínculo roto se pide un token nuevo al entrar: si ya
  // lo arreglaron, el panel se repara solo y el aviso desaparece.
  const yaRevisado = useRef(false);
  useEffect(() => {
    if (!vinculo.esBarbero || vinculo.vinculado || yaRevisado.current) return;
    yaRevisado.current = true;
    refreshClaims().catch((err) => console.error('[AdminLayout] No se pudo refrescar el permiso:', err));
  }, [vinculo.esBarbero, vinculo.vinculado, refreshClaims]);

  const revisarVinculo = async () => {
    setRevisandoVinculo(true);
    setVinculoSigueRoto(false);
    try {
      const claims = await refreshClaims();
      // Si el dueño acaba de vincular, el claim nuevo ya viene en este token y
      // el aviso se va solo; si no, hay que decirlo y no dejarlo en la duda.
      if (!claims?.professionalId) setVinculoSigueRoto(true);
    } catch (err) {
      console.error('[AdminLayout] No se pudo revisar el vínculo:', err);
      setVinculoSigueRoto(true);
    } finally {
      setRevisandoVinculo(false);
    }
  };

  const isOwner = user?.role === 'owner';

  // La plataforma entrando a una cuenta con varias sucursales: lo primero es
  // ELEGIR cuál administrar, y hasta entonces no se muestra ni el menú ni
  // ninguna pantalla. Antes caía directo en la principal y era fácil cargarle
  // el WhatsApp o el equipo de otro local.
  const grupoCuenta = business?.grupoId || null;
  const [, setEligio] = useState(0); // solo para repintar al elegir / cambiar
  const debeElegirSucursal = platformOwner && esMultiSucursal && !sucursalElegidaEnPanel(grupoCuenta);
  const elegirSucursal = (s) => {
    elegirSucursalEnPanel(grupoCuenta, s.id);
    dispatch({ type: 'SET_CURRENT_BUSINESS', payload: s.id });
    setEligio((n) => n + 1);
    navigate('/admin');
  };
  const cambiarDeSucursal = () => {
    olvidarSucursalEnPanel(grupoCuenta);
    setEligio((n) => n + 1);
    setSidebarOpen(false);
  };
  // Una sucursal es un negocio del grupo que NO es el principal. El plan, el
  // abono y la prueba viven en el principal.
  const esSucursal = Boolean(business?.grupoId) && business.grupoId !== business.id;
  const principalDelGrupo = esSucursal ? sucursales.find((s) => s.id === business.grupoId) : null;
  // "Mis sucursales" aparece si la cuenta ya tiene más de una, o si el plan las
  // permite (así el del Plan Empresarial encuentra dónde abrir la primera).
  const muestraSucursales = isOwner && (esMultiSucursal || permiteSucursales(business));
  const navItems = (isOwner ? ownerNavItems : adminNavItems)
    .filter((item) => !item.soloSucursales || muestraSucursales)
    .filter((item) => !item.soloMembresias || platformOwner
      || (sucursales.find((s) => s.id === (business?.grupoId || businessId)) || business)?.membresiasHabilitadas === true);
  const roleInfo = ROLE_LABELS[user?.role] || ROLE_LABELS.admin;

  const handleLogout = async () => {
    // Que el próximo que entre en este teléfono no reciba los avisos de este.
    if (businessId) await desactivarPush(businessId).catch(() => {});
    logout();
    navigate('/login');
  };

  // Si este dispositivo ya tenía los avisos activados, se renueva el registro
  // al entrar (el token de FCM puede rotar). No pide nada si no estaban.
  useEffect(() => {
    if (!businessId || !user?.id) return;
    refrescarPush({
      businessId,
      uid: user.id,
      professionalId: user.professionalId || null,
      role: user.role === 'owner' ? 'owner' : 'admin',
    });
  }, [businessId, user?.id, user?.professionalId, user?.role]);

  // Con la app abierta, Firebase no dibuja nada: le pasa el aviso a la página y
  // espera que la página lo muestre. Nadie escuchaba, así que al dueño con el
  // celular en la mano no le sonaba nada. Esto lo escucha.
  useEffect(() => {
    let cortar = () => {};
    escucharEnPrimerPlano().then((f) => { cortar = f; });
    return () => cortar();
  }, []);

  // Invitación a instalar, solo en el celular y solo si no está instalada.
  const [avisoInstalarOculto, setAvisoInstalarOculto] = useState(() => {
    try { return localStorage.getItem('barberos:avisoInstalar') === 'no'; } catch { return false; }
  });
  const mostrarAvisoInstalar = (esIOS() || esAndroid()) && !esAppInstalada() && !avisoInstalarOculto;
  const ocultarAvisoInstalar = () => {
    setAvisoInstalarOculto(true);
    try { localStorage.setItem('barberos:avisoInstalar', 'no'); } catch { /* nada */ }
  };

  return (
    <div className="admin-layout">
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`admin-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="admin-sidebar-header">
          {business?.logoUrl
            ? <img src={business.logoUrl} alt={business.name || 'Logo'} className="header-logo-propio" />
            : <img src="/img/barberos-logo-icon.svg" alt="BarberOS" width="32" height="32" />}
          <span>{business?.name || 'BarberOS'}</span>
        </div>

        {/* Badge de rol */}
        <div style={{ padding: '0 var(--space-md) var(--space-md)', textAlign: 'center' }}>
          <span
            className="badge"
            style={{ background: roleInfo.color + '22', color: roleInfo.color, fontSize: '11px', fontWeight: 700 }}
          >
            {roleInfo.text}
          </span>
        </div>

        {/* Cambiar de sucursal sin cerrar sesión. Va arriba del menú porque
            define sobre QUÉ barbería opera todo lo de abajo: si estuviera al
            final, se toca la pantalla equivocada. */}
        {esMultiSucursal && !debeElegirSucursal && (
          <div className="selector-sucursal">
            <label htmlFor="selector-sucursal">Sucursal</label>
            <select
              id="selector-sucursal"
              value={businessId || ''}
              onChange={(e) => {
                dispatch({ type: 'SET_CURRENT_BUSINESS', payload: e.target.value });
                if (platformOwner) elegirSucursalEnPanel(grupoCuenta, e.target.value);
                setSidebarOpen(false);
              }}
            >
              {sucursales.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.isFrozen ? ' (suspendida)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        <nav className="admin-nav">
          {!debeElegirSucursal && navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `admin-nav-item ${isActive ? 'active' : ''}`}
              onClick={() => setSidebarOpen(false)}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="admin-sidebar-footer">
          <button className="admin-nav-item" onClick={handleLogout}>
            <span className="nav-icon">🚪</span>
            Cerrar Sesión
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="admin-main">
        {/* Prueba gratis: los días que quedan, y qué hacer cuando se termina. */}
        {(() => {
          // Solo al dueño: el barbero no decide si se paga ni a quién escribir.
          if (!isOwner) return null;
          // Y solo en la barbería PRINCIPAL de la cuenta: el plan y el abono son
          // de la cuenta, no de cada local. Una sucursal mostrando "se terminó
          // tu prueba" por su cuenta hace pensar que cada una se paga aparte —
          // y encima el dato era el de la principal, copiado al crearla.
          if (esSucursal) return null;
          const dias = diasDePruebaRestantes(business?.trialEndsAt);
          if (dias === null) return null;
          const vencida = dias < 0;
          return (
            <div
              className={vencida ? 'notice notice-danger' : 'notice notice-info'}
              style={{
                borderRadius: 0,
                borderLeft: 'none',
                borderTop: 'none',
                borderRight: 'none',
                borderBottomWidth: '2px',
                borderBottomStyle: 'solid',
                padding: '8px 16px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <span>
                {vencida ? (
                  <>
                    <strong>Se terminó tu prueba.</strong> Para seguir usando la
                    agenda, escribinos y activamos tu plan.
                  </>
                ) : dias === 0 ? (
                  <><strong>Hoy es el último día de prueba.</strong> Escribinos para seguir.</>
                ) : (
                  <>
                    Estás usando una <strong>cuenta de prueba</strong>: te
                    {dias === 1 ? ' queda 1 día' : ` quedan ${dias} días`}.
                  </>
                )}
              </span>
              <a
                href={LINK_SOPORTE}
                target="_blank"
                rel="noreferrer"
                style={{ color: 'inherit', fontWeight: 700, whiteSpace: 'nowrap' }}
              >
                Hablar por WhatsApp →
              </a>
            </div>
          );
        })()}

        {/* En qué sucursal estás parado y dónde se maneja el plan. Sin esto, el
            dueño abre una sucursal, no ve ningún dato de plan ni de abono, y no
            sabe si es que no tiene o si es que se maneja en otro lado. */}
        {/* La plataforma tiene su propia barra (abajo), que ya dice en qué
            sucursal está y deja cambiarla: este aviso es para el dueño. */}
        {isOwner && esSucursal && !platformOwner && (
          <div className="notice notice-info aviso-sucursal">
            <span>
              Estás en <strong>{business.name}</strong>, una sucursal de{' '}
              <strong>{principalDelGrupo?.name || 'tu cuenta'}</strong>. El plan y el abono se
              manejan en la principal.
            </span>
            <Link to="/admin/sucursales" style={{ color: 'inherit', fontWeight: 700, whiteSpace: 'nowrap' }}>
              Ver mis sucursales →
            </Link>
          </div>
        )}

        {/* Aviso permanente: si sos dueño de la plataforma, estás editando la
            cuenta de un cliente. Sin esto es fácil tocar el negocio equivocado. */}
        {platformOwner && business && (
          <div
            className="notice notice-warn"
            style={{
              borderRadius: 0,
              borderLeft: 'none',
              borderTop: 'none',
              borderRight: 'none',
              borderBottomWidth: '2px',
              borderBottomStyle: 'solid',
              borderBottomColor: 'var(--warning)',
              padding: '8px 16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <span>
              {esMultiSucursal && debeElegirSucursal
                ? <>Elegí qué sucursal de <strong>{sucursales.find((s) => s.id === grupoCuenta)?.name || business.name}</strong> vas a administrar.</>
                : esMultiSucursal
                  ? <>Estás administrando la sucursal <strong>{business.name}</strong>
                      {business.id !== grupoCuenta && <> de {sucursales.find((s) => s.id === grupoCuenta)?.name || 'la cuenta'}</>}
                      {' '}como dueño de la plataforma.</>
                  : <>Estás administrando <strong>{business.name}</strong> como dueño de la plataforma.</>}
            </span>
            <span style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              {esMultiSucursal && !debeElegirSucursal && (
                <button type="button" className="btn btn-sm btn-outline" onClick={cambiarDeSucursal}>
                  🏠 Cambiar de sucursal
                </button>
              )}
              <Link to="/super-admin" style={{ color: 'inherit', fontWeight: 700, alignSelf: 'center' }}>
                ← Volver al panel global
              </Link>
            </span>
          </div>
        )}

        <div className="admin-topbar">
          <div className="admin-topbar-left">
            <button className="hamburger" onClick={() => setSidebarOpen(!sidebarOpen)}>
              ☰
            </button>
          </div>
          <div className="admin-topbar-right">
            <CampanaNotificaciones />
            <div className="flex items-center gap-sm">
              {user?.avatarUrl
                ? <img src={user.avatarUrl} alt={user.name} style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }} />
                : <div className="avatar avatar-sm">{user?.name?.charAt(0) || 'A'}</div>
              }
              <span className="text-sm">{user?.name || 'Admin'}</span>
            </div>
          </div>
        </div>

        {/* Vínculo roto: sin esto el barbero ve una agenda vacía y cree que no
            tiene turnos. Es el aviso más importante del panel. */}
        {vinculo.esBarbero && !vinculo.vinculado && business && (
          <div className="notice notice-danger aviso-vinculo">
            <span>
              ⚠️ <strong>Avisale al dueño de la barbería.</strong> {textoVinculo(vinculo.motivo)}{' '}
              Lo arregla en <strong>Administradores</strong>: tocar ✏️ en tu cuenta, elegir tu nombre en
              "Profesional vinculado" y guardar.
              {vinculoSigueRoto && <> <strong>Todavía no está hecho:</strong> probá de nuevo cuando te avisen.</>}
            </span>
            <button className="btn btn-sm btn-outline" onClick={revisarVinculo} disabled={revisandoVinculo}>
              {revisandoVinculo ? 'Revisando…' : 'Ya me vincularon'}
            </button>
          </div>
        )}

        {mostrarAvisoInstalar && business && (
          <div className="notice notice-info aviso-instalar">
            <span>📲 <strong>Instalá BarberOS en tu celular</strong> para recibir un aviso cuando te reserven un turno.</span>
            <span className="aviso-instalar-acciones">
              <Link to="/admin/instalar" className="btn btn-primary btn-sm">Ver cómo</Link>
              <button className="btn btn-ghost btn-sm" onClick={ocultarAvisoInstalar} aria-label="Cerrar">✕</button>
            </span>
          </div>
        )}

        {/* Novedades de la plataforma para todas las barberías. Va adentro del
            contenido para que no empuje la barra ni el aviso de vínculo roto. */}
        <div className="admin-content">
          <AvisoPlataforma />
          {business && debeElegirSucursal ? (
            <ElegirSucursalPanel sucursales={sucursales} grupoId={grupoCuenta} onElegir={elegirSucursal} />
          ) : business ? (
            <Outlet />
          ) : esperandoNegocios ? (
            <div className="empty-state" style={{ padding: 'var(--space-2xl)' }}>
              <p>Cargando…</p>
            </div>
          ) : (
            // Punto único de control: ninguna página de admin se renderiza sin
            // un negocio resuelto, así no hay que defenderse de `business` nulo
            // en cada pantalla.
            <div className="card empty-state" style={{ padding: 'var(--space-2xl)' }}>
              <div className="empty-state-icon">🏪</div>
              <h3 style={{ marginBottom: 8 }}>No hay ningún negocio asignado a tu cuenta</h3>
              <p style={{ maxWidth: 460, margin: '0 auto var(--space-lg)' }}>
                {platformOwner
                  ? 'Todavía no diste de alta ninguna barbería. Creá la primera desde el panel global.'
                  : 'Tu usuario tiene acceso al panel pero no está vinculado a ningún negocio. Contactate con BarberOS para que lo asocien.'}
              </p>
              {platformOwner && (
                <Link to="/super-admin" className="btn btn-primary">
                  Ir al panel global
                </Link>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
