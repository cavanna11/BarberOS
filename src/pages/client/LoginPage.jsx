import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { isPlatformOwner, PLATFORM_OWNERS } from '../../config/platform';

export default function LoginPage() {
  const [error, setError] = useState('');
  const [entrando, setEntrando] = useState(false);
  const [bypassEmail, setBypassEmail] = useState('');
  // Las cuentas que crea la plataforma entran con mail y contraseña; el resto,
  // con Google. El formulario aparece solo si lo piden, para no complicarle la
  // pantalla al cliente que viene a reservar un turno.
  const [verFormulario, setVerFormulario] = useState(false);
  const [cred, setCred] = useState({ email: '', password: '' });
  const { loginWithGoogle, loginWithPassword, loginBypass } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Si el usuario venía de un link de negocio (`/barberia-sacia`) y lo mandamos
  // a loguearse, después lo devolvemos ahí en vez de tirarlo a la raíz.
  const from = location.state?.from;

  const redirectAfterLogin = (user) => {
    if (user.isPlatformOwner || isPlatformOwner(user.email)) {
      navigate('/super-admin');
    } else if (user.role === 'owner' || user.role === 'admin') {
      navigate('/admin');
    } else {
      navigate(from || '/');
    }
  };

  /**
   * Abre el popup de Firebase Auth.
   * Antes esto usaba el widget de @react-oauth/google, que solo decodificaba
   * el token en el cliente: no creaba sesión de servidor, y sin eso las
   * Security Rules de Firestore no tienen contra qué validar.
   */
  const handleGoogle = async () => {
    setError('');
    setEntrando(true);
    const result = await loginWithGoogle();
    setEntrando(false);

    if (result.success) redirectAfterLogin(result.user);
    else if (!result.cancelled) setError(result.error);
  };

  const handlePassword = async (ev) => {
    ev.preventDefault();
    if (!cred.email.trim() || !cred.password) return;
    setError('');
    setEntrando(true);
    const result = await loginWithPassword(cred.email, cred.password);
    setEntrando(false);
    if (result.success) redirectAfterLogin(result.user);
    else setError(result.error);
  };

  const handleBypass = (email) => {
    const result = loginBypass(email);
    if (result.success) redirectAfterLogin(result.user);
    else setError(result.error);
  };

  const handleDevBypass = () => {
    const email = bypassEmail.trim().toLowerCase();
    if (email) handleBypass(email);
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-md)' }}>
          <img src="/img/barberos-logo-full.svg" alt="BarberOS Logo" width="200" height="48" style={{ margin: '0 auto' }} />
        </div>
        <h1>Reservar turno</h1>
        <p className="auth-subtitle">Iniciá sesión para continuar</p>

        {error && (
          <div
            className="badge badge-danger mb-md"
            style={{ display: 'block', textAlign: 'center', padding: '8px 16px', borderRadius: '8px' }}
          >
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 'var(--space-lg)' }}>
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={handleGoogle}
            disabled={entrando}
            style={{ width: '100%', gap: 10 }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M12 11v3.2h5.3c-.2 1.4-1.6 4-5.3 4a5.7 5.7 0 0 1 0-11.4c1.7 0 2.9.7 3.6 1.4l2.4-2.4A9.1 9.1 0 0 0 12 3a9 9 0 1 0 0 18c5.2 0 8.6-3.6 8.6-8.7 0-.6 0-1-.1-1.4H12z"
              />
            </svg>
            {entrando ? 'Abriendo Google…' : 'Continuar con Google'}
          </button>
        </div>

        {!verFormulario ? (
          <div style={{ textAlign: 'center', marginTop: 'var(--space-md)' }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => { setVerFormulario(true); setError(''); }}
            >
              Tengo un usuario y contraseña
            </button>
          </div>
        ) : (
          <form onSubmit={handlePassword} style={{ marginTop: 'var(--space-lg)' }}>
            <div
              style={{
                borderTop: '1px solid var(--border-color)',
                paddingTop: 'var(--space-md)',
                marginBottom: 'var(--space-md)',
                textAlign: 'center',
              }}
            >
              <span className="text-xs text-muted">O CON TU USUARIO</span>
            </div>

            <div className="form-group">
              <label className="form-label">Email</label>
              <input
                className="form-input"
                type="email"
                autoComplete="username"
                value={cred.email}
                onChange={(e) => setCred((c) => ({ ...c, email: e.target.value }))}
                autoFocus
              />
            </div>

            <div className="form-group">
              <label className="form-label">Contraseña</label>
              <input
                className="form-input"
                type="password"
                autoComplete="current-password"
                value={cred.password}
                onChange={(e) => setCred((c) => ({ ...c, password: e.target.value }))}
              />
            </div>

            <button
              type="submit"
              className="btn btn-outline"
              disabled={entrando}
              style={{ width: '100%' }}
            >
              {entrando ? 'Entrando…' : 'Entrar'}
            </button>

            <p className="text-xs text-muted" style={{ marginTop: 'var(--space-sm)', textAlign: 'center' }}>
              ¿Te olvidaste la contraseña? Escribinos y te pasamos una nueva.
            </p>
          </form>
        )}

        {/*
          ACCESO RÁPIDO — SOLO DESARROLLO.
          `loginBypass` entra sin verificar nada contra Google: con un botón se
          obtiene sesión como dueño de la plataforma. Por eso está detrás de
          `import.meta.env.DEV`, que Vite reemplaza por `false` en `npm run build`
          y elimina el bloque entero del bundle de producción.
          NO sacar este guard.

          Ojo: esta sesión NO es de Firebase. Sirve para probar la UI mientras
          los datos sigan en localStorage; cuando estén en Firestore, las Rules
          la van a rechazar y no va a poder leer nada.
        */}
        {import.meta.env.DEV && (
          <div
            style={{
              marginTop: 'var(--space-xl)',
              borderTop: '1px dashed var(--border-color)',
              paddingTop: 'var(--space-md)',
            }}
          >
            <p
              style={{
                textAlign: 'center',
                fontSize: 12,
                color: 'var(--text-muted)',
                marginBottom: 12,
                fontWeight: 600,
              }}
            >
              🛠️ ACCESO RÁPIDO (SOLO EN DESARROLLO)
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {PLATFORM_OWNERS.map((email) => (
                <button
                  key={email}
                  className="btn btn-outline"
                  onClick={() => handleBypass(email)}
                  style={{ fontSize: 13, justifyContent: 'center', width: '100%', padding: '10px' }}
                >
                  👑 Entrar como dueño de plataforma
                </button>
              ))}
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  className="form-input"
                  placeholder="otro mail (dueño de barbería, cliente...)"
                  style={{ fontSize: 13, margin: 0 }}
                  value={bypassEmail}
                  onChange={(e) => setBypassEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleDevBypass();
                  }}
                />
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={handleDevBypass}
                  disabled={!bypassEmail.trim()}
                  style={{ fontSize: 13, whiteSpace: 'nowrap' }}
                >
                  Entrar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
