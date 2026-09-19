import { useState, useEffect } from 'react';
import CampanaNotificaciones from '../admin/CampanaNotificaciones';
import { NavLink, Outlet, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useCurrentBusiness } from '../../hooks/useCurrentBusiness';
import { refrescarPush, desactivarPush, esAppInstalada, esIOS, esAndroid } from '../../lib/push';

// Items visibles solo para el dueño (owner)
const ownerNavItems = [
  { to: '/admin',               icon: '📊', label: 'Dashboard',        end: true },
  { to: '/admin/profesionales', icon: '👥', label: 'Profesionales' },
  { to: '/admin/servicios',     icon: '✂️', label: 'Servicios' },
  { to: '/admin/citas',         icon: '📅', label: 'Citas' },
  { to: '/admin/admins',        icon: '🛡️', label: 'Administradores' },
  { to: '/admin/configuracion', icon: '⚙️', label: 'Configuración' },
  { to: '/admin/soporte',       icon: '💬', label: 'Soporte' },
  { to: '/admin/instalar',      icon: '📲', label: 'Instalar la app' },
];

// Items para el admin/peluquero → solo sus citas
const adminNavItems = [
  { to: '/admin',         icon: '🏠', label: 'Hoy', end: true },
  // La tabla con confirmar / completar / no asistió / cancelar y "Agendar
  // turno". Sin esta entrada el barbero no tenía forma de llegar.
  { to: '/admin/citas',   icon: '📅', label: 'Mi Agenda' },
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
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { business, businessId, isPlatformOwner: platformOwner } = useCurrentBusiness();

  const isOwner = user?.role === 'owner';
  const navItems = isOwner ? ownerNavItems : adminNavItems;
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
          <img src="/img/barberos-logo-icon.svg" alt="BarberOS" width="32" height="32" />
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

        <nav className="admin-nav">
          {navItems.map((item) => (
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
              Estás administrando <strong>{business.name}</strong> como dueño de la plataforma.
            </span>
            <Link to="/super-admin" style={{ color: 'inherit', fontWeight: 700 }}>
              ← Volver al panel global
            </Link>
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

        {mostrarAvisoInstalar && business && (
          <div className="notice notice-info aviso-instalar">
            <span>📲 <strong>Instalá BarberOS en tu celular</strong> para recibir un aviso cuando te reserven un turno.</span>
            <span className="aviso-instalar-acciones">
              <Link to="/admin/instalar" className="btn btn-primary btn-sm">Ver cómo</Link>
              <button className="btn btn-ghost btn-sm" onClick={ocultarAvisoInstalar} aria-label="Cerrar">✕</button>
            </span>
          </div>
        )}

        <div className="admin-content">
          {business ? (
            <Outlet />
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
