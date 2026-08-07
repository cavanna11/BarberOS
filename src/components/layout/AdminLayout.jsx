import { useState } from 'react';
import { NavLink, Outlet, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useCurrentBusiness } from '../../hooks/useCurrentBusiness';

// Items visibles solo para el dueño (owner)
const ownerNavItems = [
  { to: '/admin',               icon: '📊', label: 'Dashboard',        end: true },
  { to: '/admin/profesionales', icon: '👥', label: 'Profesionales' },
  { to: '/admin/servicios',     icon: '✂️', label: 'Servicios' },
  { to: '/admin/citas',         icon: '📅', label: 'Citas' },
  { to: '/admin/admins',        icon: '🛡️', label: 'Administradores' },
  { to: '/admin/configuracion', icon: '⚙️', label: 'Configuración' },
];

// Items para el admin/peluquero → solo sus citas
const adminNavItems = [
  { to: '/admin',         icon: '📅', label: 'Mis Citas', end: true },
  { to: '/admin/ajustes', icon: '⚙️', label: 'Mi Configuración' },
];

const ROLE_LABELS = {
  owner: { text: 'Dueño',  color: 'var(--primary)' },
  admin: { text: 'Peluquero', color: 'var(--success)' },
};

export default function AdminLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { business, isPlatformOwner: platformOwner } = useCurrentBusiness();

  const isOwner = user?.role === 'owner';
  const navItems = isOwner ? ownerNavItems : adminNavItems;
  const roleInfo = ROLE_LABELS[user?.role] || ROLE_LABELS.admin;

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="admin-layout">
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`admin-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="admin-sidebar-header">
          <div className="header-logo-icon">B</div>
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
            <div className="flex items-center gap-sm">
              {user?.avatarUrl
                ? <img src={user.avatarUrl} alt={user.name} style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }} />
                : <div className="avatar avatar-sm">{user?.name?.charAt(0) || 'A'}</div>
              }
              <span className="text-sm">{user?.name || 'Admin'}</span>
            </div>
          </div>
        </div>

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
