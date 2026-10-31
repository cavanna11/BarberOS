import { useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { isPlatformOwner, PLATFORM_OWNERS } from '../../config/platform';
import { entraAlPanel } from '../../config/roles';
import { navegadorEmbebido, comoAbrirlo } from '../../utils/navegadorEmbebido';
import { recordarVuelta, leerVuelta, usarVuelta } from '../../utils/vueltaDelLogin';

export default function LoginPage() {
  const [error, setError] = useState('');
  const [entrando, setEntrando] = useState(false);
  const [bypassEmail, setBypassEmail] = useState('');
  // Las cuentas que crea la plataforma entran con mail y contraseña; el resto,
  // con Google. El formulario aparece solo si lo piden, para no complicarle la
  // pantalla al cliente que viene a reservar un turno.
  const [verFormulario, setVerFormulario] = useState(false);
  const [cred, setCred] = useState({ email: '', password: '', nombre: '' });
  // 'entrar' con una cuenta que ya existe, o 'crear' una de cliente.
  const [modo, setModo] = useState('entrar');
  const [aviso, setAviso] = useState('');
  const { loginWithGoogle, loginWithPassword, registerWithPassword, resetPassword, loginBypass } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Si el usuario venía de un link de negocio (`/barberia-sacia`) y lo mandamos
  // a loguearse, después lo devolvemos ahí en vez de tirarlo a la raíz.
  // '/' y '/login' no sirven como destino: volver ahí es justo lo que dejaba
  // al barbero curioso sin entender qué pasó.
  // Se calcula una sola vez: el user agent no cambia mientras la página vive.
  const embebido = useMemo(() => navegadorEmbebido(), []);
  // Si Google no pudo abrir su ventana y redirigió (pasa en iPhone), al volver
  // la página arranca de cero y `location.state` ya no existe: sin la copia en
  // sessionStorage el cliente volvía logueado a cualquier lado y no a su
  // reserva. Ver utils/vueltaDelLogin.js.
  const origen = location.state?.from || leerVuelta();
  const from = origen && origen !== '/' && origen !== '/login' ? origen : null;
  if (location.state?.from) recordarVuelta(location.state.from);
  // "Reservar turno" solo si venía del link de una barbería. Si venía del
  // panel (cerró sesión, o le venció el token), es alguien del staff y el
  // título de reserva lo confunde.
  const vieneDeReserva = Boolean(from) && !/^\/(admin|super-admin|cuenta)(\/|$)/.test(from);

  const redirectAfterLogin = (user) => {
    usarVuelta();
    if (user.isPlatformTeam || isPlatformOwner(user.email)) {
      navigate('/super-admin');
    } else if (entraAlPanel(user)) {
      navigate('/admin');
    } else if (from) {
      // Venía del link de una barbería: se lo devuelve ahí a terminar de reservar.
      navigate(from);
    } else {
      // Entró por "Iniciar Sesión" desde la landing y no tiene barbería. Antes
      // se lo mandaba de vuelta a la landing sin decirle nada, y quedaba
      // pensando que no había funcionado.
      navigate('/cuenta');
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
    setAviso('');
    setEntrando(true);
    const result = modo === 'crear'
      ? await registerWithPassword(cred.email, cred.password, cred.nombre)
      : await loginWithPassword(cred.email, cred.password);
    setEntrando(false);
    if (result.success) return redirectAfterLogin(result.user);
    setError(result.error);
  };

  const handleOlvido = async () => {
    setError('');
    setAviso('');
    if (!cred.email.trim()) { setError('Escribí tu mail arriba y volvé a tocar "Me olvidé la contraseña".'); return; }
    const r = await resetPassword(cred.email);
    if (r.success) setAviso(`Si hay una cuenta con ${cred.email.trim()}, te llegó un mail para elegir una contraseña nueva. Mirá también en spam.`);
    else setError(r.error);
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
        <h1>{vieneDeReserva ? 'Reservar turno' : 'Iniciar sesión'}</h1>
        <p className="auth-subtitle">
          {vieneDeReserva
            ? 'Tu turno todavía NO está reservado: entrá con Google y lo confirmás en un toque.'
            : 'Entrá a tu panel, o al link de tu barbería para reservar'}
        </p>

        {/* El navegador de adentro de otra app (Instagram, WhatsApp, Facebook)
            bloquea las ventanas emergentes. Firebase cae solo a redirigir, la
            redirección sale a otro dominio, iOS aísla el almacenamiento entre
            dominios, y la persona termina en una pantalla blanca de Firebase
            que dice "missing initial state". Avisarle ANTES de que toque el
            botón es más barato que dejarla estrellarse contra un error que no
            explica nada — y el link de una barbería se reparte justo por ahí:
            la bio de Instagram y WhatsApp son el camino principal. */}
        {embebido && (
          <div className="notice notice-warn" style={{ marginBottom: 'var(--space-md)' }}>
            <strong>Abrilo en tu navegador para poder entrar.</strong>
            <p className="text-sm" style={{ margin: '6px 0 0' }}>
              Estás viendo esto dentro de {typeof embebido === 'string' ? embebido : 'otra aplicación'},
              y ahí Google no deja iniciar sesión. {comoAbrirlo()}
              {vieneDeReserva && ' O, sin salir de acá, entrá con tu mail (abajo).'}
            </p>
          </div>
        )}

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

        {/* Con mail y contraseña entran el equipo (cuentas que damos nosotros) y
            el CLIENTE que no puede o no quiere usar Google: el iPhone donde la
            ventana de Google no abre, el navegador de Instagram, el que no usa
            Gmail. El cliente que viene a reservar puede crearse la cuenta acá. */}
        {!verFormulario ? (
          <div style={{ textAlign: 'center', marginTop: 'var(--space-md)' }}>
            {vieneDeReserva && (
              <button
                type="button"
                className="btn btn-outline"
                style={{ width: '100%', marginBottom: 8 }}
                onClick={() => { setVerFormulario(true); setModo('crear'); setError(''); }}
              >
                ✉️ ¿Google no te deja? Entrá con tu mail
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => { setVerFormulario(true); setModo('entrar'); setError(''); }}
            >
              {vieneDeReserva
                ? 'Ya tengo cuenta con mail y contraseña'
                : 'Soy del equipo: tengo usuario y contraseña'}
            </button>
            {!vieneDeReserva && (
              <p className="text-sm text-secondary" style={{ marginTop: 10 }}>
                ¿Todavía no tenés cuenta? Entrá con Google y armás tu barbería en un
                minuto, con 5 días de prueba.
              </p>
            )}
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
              <span className="text-xs text-muted">
                {modo === 'crear' ? 'CREAR CUENTA CON TU MAIL' : vieneDeReserva ? 'ENTRAR CON TU MAIL' : 'CUENTA DEL EQUIPO DE LA BARBERÍA'}
              </span>
            </div>

            {vieneDeReserva && (
              <div className="tabs" style={{ marginBottom: 'var(--space-md)' }}>
                <button type="button" className={`tab ${modo === 'crear' ? 'active' : ''}`} onClick={() => { setModo('crear'); setError(''); }}>
                  Crear cuenta
                </button>
                <button type="button" className={`tab ${modo === 'entrar' ? 'active' : ''}`} onClick={() => { setModo('entrar'); setError(''); }}>
                  Ya tengo cuenta
                </button>
              </div>
            )}

            {modo === 'crear' && (
              <div className="form-group">
                <label className="form-label">Tu nombre</label>
                <input
                  className="form-input"
                  autoComplete="name"
                  value={cred.nombre}
                  onChange={(e) => setCred((c) => ({ ...c, nombre: e.target.value }))}
                />
              </div>
            )}

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
                autoComplete={modo === 'crear' ? 'new-password' : 'current-password'}
                value={cred.password}
                onChange={(e) => setCred((c) => ({ ...c, password: e.target.value }))}
              />
              {modo === 'crear' && (
                <p className="text-xs text-muted" style={{ marginTop: 4 }}>
                  Al menos 8 caracteres, con una mayúscula y un número.
                </p>
              )}
            </div>

            {aviso && <div className="notice mb-md">{aviso}</div>}

            <button
              type="submit"
              className="btn btn-outline"
              disabled={entrando}
              style={{ width: '100%' }}
            >
              {entrando ? 'Entrando…' : modo === 'crear' ? 'Crear cuenta y seguir' : 'Entrar'}
            </button>

            {modo === 'entrar' && (
              <div style={{ textAlign: 'center', marginTop: 'var(--space-sm)' }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={handleOlvido}>
                  Me olvidé la contraseña
                </button>
              </div>
            )}
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
