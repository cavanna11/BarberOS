import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

// Inline SVGs for professional icons
const DashboardIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" /><rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" /></svg>
);

const LogoutIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
);

const navItems = [
  { to: '/super-admin', icon: <DashboardIcon />, label: 'Super Dashboard', end: true },
];

export default function SuperAdminLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, logout } = useAuth();
  const navigate = useNavigate();

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
          <img src="/img/barberos-logo-icon.svg" alt="BarberOS" width="32" height="32" />
          <span>BarberOS Global</span>
        </div>

        {/* Badge de rol */}
        <div style={{ padding: '0 var(--space-md) var(--space-md)', textAlign: 'center' }}>
          <span
            className="badge"
            style={{ background: 'var(--primary-light)', color: 'var(--primary)', fontSize: '11px', fontWeight: 700 }}
          >
            Dueño de Solución
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
              <span className="nav-icon" style={{ display: 'inline-flex', alignItems: 'center' }}>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="admin-sidebar-footer">
          <button className="admin-nav-item" onClick={handleLogout} style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center' }}>
            <span className="nav-icon" style={{ display: 'inline-flex', alignItems: 'center' }}><LogoutIcon /></span>
            Cerrar Sesión
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="admin-main">
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
                : <div className="avatar avatar-sm" style={{ backgroundColor: 'var(--primary)', color: '#fff' }}>{user?.name?.charAt(0) || 'S'}</div>
              }
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span className="text-sm font-semibold">{user?.name || 'Administrador Global'}</span>
                <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{user?.email}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="admin-content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
