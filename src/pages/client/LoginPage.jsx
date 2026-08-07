import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';
import { useAuth } from '../../contexts/AuthContext';
import { isPlatformOwner, PLATFORM_OWNERS } from '../../config/platform';

export default function LoginPage() {
  const [error, setError] = useState('');
  const [bypassEmail, setBypassEmail] = useState('');
  const { loginWithGoogle, loginBypass } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Si el usuario venía de un link de negocio (`/barberia-sacia`) y lo mandamos
  // a loguearse, después lo devolvemos ahí en vez de tirarlo a la raíz.
  const from = location.state?.from;

  const redirectAfterLogin = (user) => {
    if (isPlatformOwner(user.email)) {
      navigate('/super-admin');
    } else if (user.role === 'owner' || user.role === 'admin') {
      navigate('/admin');
    } else {
      navigate(from || '/');
    }
  };

  const handleGoogleSuccess = (credentialResponse) => {
    const result = loginWithGoogle(credentialResponse.credential);
    if (result.success) {
      redirectAfterLogin(result.user);
    } else {
      setError(result.error);
    }
  };

  const handleGoogleError = () => {
    setError('Error al iniciar sesión con Google. Intentá de nuevo.');
  };

  const handleBypass = (email) => {
    const result = loginBypass(email);
    if (result.success) {
      redirectAfterLogin(result.user);
    } else {
      setError(result.error);
    }
  };

  const handleDevBypass = () => {
    const email = bypassEmail.trim().toLowerCase();
    if (email) handleBypass(email);
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1>Reservar turno</h1>
        <p className="auth-subtitle">Iniciá sesión con tu cuenta de Google para continuar</p>

        {error && (
          <div className="badge badge-danger mb-md" style={{ display: 'block', textAlign: 'center', padding: '8px 16px', borderRadius: '8px' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 'var(--space-lg)' }}>
          <GoogleLogin
            onSuccess={handleGoogleSuccess}
            onError={handleGoogleError}
            useOneTap
            theme="filled_blue"
            shape="pill"
            text="signin_with"
          />
        </div>

        {/*
          ACCESO RÁPIDO — SOLO DESARROLLO.
          `loginBypass` entra sin verificar nada contra Google: con un botón se
          obtiene sesión como dueño de la plataforma. Por eso está detrás de
          `import.meta.env.DEV`, que Vite reemplaza por `false` en `npm run build`
          y elimina el bloque entero del bundle de producción.
          NO sacar este guard.
        */}
        {import.meta.env.DEV && (
          <div style={{ marginTop: 'var(--space-xl)', borderTop: '1px dashed var(--border-color)', paddingTop: 'var(--space-md)' }}>
            <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, fontWeight: 600 }}>
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
