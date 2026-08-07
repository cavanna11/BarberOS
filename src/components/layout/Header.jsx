import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useCurrentBusiness } from '../../hooks/useCurrentBusiness';

export default function Header() {
  const { isAuthenticated, logout } = useAuth();
  const { business, slug } = useCurrentBusiness();

  // Los links del cliente siempre viven bajo el slug del negocio actual.
  const home = slug ? `/${slug}` : '/';

  return (
    <header className="header">
      <Link to={home} className="header-logo">
        <img src="/img/barberos-logo-icon.svg" alt="BarberOS Logo" width="32" height="32" className="header-logo-img" />
        <span>{business?.name || 'BarberOS'}</span>
      </Link>

      {!slug && (
        <nav className="header-nav">
          <a href="#inicio">Inicio</a>
          <a href="#problema">El día a día</a>
          <a href="#funciones">Funciones</a>
          <a href="#como-arranca">Cómo arranca</a>
          <a href="#precios">Precios</a>
          <a href="#dudas">Dudas</a>
        </nav>
      )}

      <div className="header-actions">
        {isAuthenticated ? (
          <>
            {slug && (
              <Link to={`${home}/mis-citas`} className="btn btn-ghost btn-sm">
                📅 Mis Citas
              </Link>
            )}
            <button onClick={logout} className="btn btn-ghost btn-sm">
              Salir
            </button>
          </>
        ) : (
          <Link to="/login" className="btn btn-secondary btn-sm">
            Iniciar Sesión
          </Link>
        )}
      </div>
    </header>
  );
}
