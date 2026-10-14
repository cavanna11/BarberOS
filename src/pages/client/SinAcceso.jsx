import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { applyPendingClaims } from '../../lib/functions';

// ============================================================================
// Inició sesión, pero su cuenta no tiene acceso a ningún panel
// ============================================================================
// Antes esto era un `<Navigate to="/" replace />` y terminaba en la landing de
// venta. Sin cartel, sin error, sin nada: el barbero entraba bien, veía la
// página de "BarberOS, turnos para barberías" y no tenía forma de saber qué
// había pasado — porque desde su lado no pasó nada.
//
// Es el mismo error que ya habíamos corregido para el que entra sin barbería
// (hoy cae en /cuenta y se la crea), pero que seguía vivo en ProtectedRoute.
//
// Dos casos reales, los dos iguales desde afuera:
//
//   Neytan   — tenía cuenta de Google y probaba con el formulario de contraseña.
//   Franco   — cargado como DUEÑO con francorodriguez92@gmail.com, pero ese mail
//              no existía en Firebase Auth: estaba entrando con otra cuenta de
//              Google, la que su teléfono ya tenía abierta. El permiso quedó
//              esperando a una cuenta que nunca aparecía.
//
// Por eso lo primero y más grande de la pantalla es CON QUÉ MAIL ENTRÓ. En los
// dos casos, verlo escrito habría alcanzado para resolverlo solo. El permiso se
// busca por el mail exacto del que inicia sesión: si no coincide, no hay error
// que mostrar, simplemente no hay nada anotado para esa cuenta.

export default function SinAcceso() {
  const { user, logout, refreshClaims } = useAuth();
  const navigate = useNavigate();
  const [probando, setProbando] = useState(false);
  const [sinNovedad, setSinNovedad] = useState(false);

  // "Ya me dieron el acceso". Son dos cosas distintas y hacen falta las dos:
  // applyPendingClaims escribe el permiso que estaba anotado esperándolo, y
  // refreshClaims trae el token nuevo. Sin lo segundo, un permiso recién dado
  // tarda hasta una hora en verse.
  const reintentar = async () => {
    setProbando(true);
    setSinNovedad(false);
    try {
      await applyPendingClaims().catch(() => null);
      const claims = await refreshClaims();
      if (claims?.platform || claims?.businessId) {
        navigate(claims.platform ? '/super-admin' : '/admin', { replace: true });
        return;
      }
      setSinNovedad(true);
    } finally {
      setProbando(false);
    }
  };

  const entrarConOtra = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <div className="card">
        <h1 style={{ marginTop: 0 }}>Tu cuenta todavía no tiene acceso al panel</h1>

        <p className="text-secondary">Iniciaste sesión como:</p>
        <p className="sin-acceso-mail">{user?.email || 'una cuenta sin mail'}</p>

        <p className="text-secondary">
          El acceso se busca por el mail <strong>exacto</strong> con el que entrás. Si tu barbería
          te dio de alta con otro, para el sistema sos una persona distinta y no hay nada anotado
          para esta cuenta.
        </p>

        <ol className="sin-acceso-pasos">
          <li>
            <strong>¿Te dieron de alta con otro mail?</strong> Es lo más común, sobre todo en el
            celular: Google entra solo con la cuenta que ya tenías abierta y ni te pregunta.
            Entrá con la otra y listo.
          </li>
          <li>
            <strong>¿Te acaban de dar el acceso?</strong> Tocá <em>Ya me dieron el acceso</em> acá
            abajo.
          </li>
          <li>
            <strong>¿Ninguna de las dos?</strong> Pedile al dueño de la barbería que te agregue en{' '}
            <strong>Administradores</strong> con este mail, tal cual está escrito arriba.
          </li>
        </ol>

        {sinNovedad && (
          <div className="notice notice-warn" style={{ marginBottom: 'var(--space-md)' }}>
            Sigue sin haber ningún acceso para <strong>{user?.email}</strong>. Si tu barbería te dio
            de alta, fijate que haya sido con este mail y no con otro.
          </div>
        )}

        <div className="sin-acceso-acciones">
          <button type="button" className="btn btn-primary" onClick={reintentar} disabled={probando}>
            {probando ? 'Buscando…' : 'Ya me dieron el acceso'}
          </button>
          <button type="button" className="btn btn-outline" onClick={entrarConOtra} disabled={probando}>
            Entrar con otro mail
          </button>
        </div>

        <p className="text-sm text-muted" style={{ marginTop: 'var(--space-lg)' }}>
          ¿No trabajás en ninguna barbería y querés armar la tuya?{' '}
          <Link to="/cuenta">Creá tu cuenta acá</Link>.
        </p>
      </div>
    </div>
  );
}
