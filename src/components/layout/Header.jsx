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
        <div className="header-logo-icon">B</div>
        <span>{business?.name || 'BarberOS'}</span>
      </Link>

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
