import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useNotifications, usePlatformNotifications } from '../../hooks/useTenantData';
import { useCurrentBusiness } from '../../hooks/useCurrentBusiness';
import { markNotificationRead, markPlatformNotificationRead } from '../../lib/repository';
import { activarPush, estadoPush, ponerBadge } from '../../lib/push';
import { Link } from 'react-router-dom';

/**
 * La campanita del panel. Muestra las notificaciones del negocio (o las del
 * barbero) con un contador de no leídas, y avisa con una notificación del
 * navegador cuando entra una nueva mientras el panel está abierto.
 *
 * Las notificaciones las crea un trigger de Functions al entrar o cancelarse
 * un turno; acá solo se leen y se marcan leídas. Cuando llegue WhatsApp, el
 * aviso por mensaje sale del mismo trigger.
 */

const ICONO = { nuevo_turno: '📅', turno_cancelado: '❌', ticket_nuevo: '💬', ticket_mensaje: '💬', cuenta_suspendida: '🔴' };

function hace(ts) {
  const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null;
  if (!d) return '';
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
}

/**
 * `modo`: 'negocio' (panel de la barbería) o 'plataforma' (panel global).
 * Cambia de dónde salen las notificaciones, dónde se marca leída, dónde se
 * registra el push y a qué pantalla lleva cada aviso.
 */
export default function CampanaNotificaciones({ modo = 'negocio' }) {
  const plataforma = modo === 'plataforma';
  const { user } = useAuth();
  const { businessId } = useCurrentBusiness();
  const delNegocio = useNotifications();
  const deLaPlataforma = usePlatformNotifications();
  const notificaciones = plataforma ? deLaPlataforma : delNegocio;
  const marcarLeida = (id) => (plataforma ? markPlatformNotificationRead(id, uid) : markNotificationRead(businessId, id, uid));
  const navigate = useNavigate();
  const [abierta, setAbierta] = useState(false);
  const [permiso, setPermiso] = useState(() => (typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'));
  const [push, setPush] = useState(() => estadoPush().estado);
  const panelRef = useRef(null);

  const uid = user?.id;
  const noLeidas = notificaciones.filter((n) => !n.leidaPor?.[uid]);

  // Numerito sobre el ícono de la app instalada.
  useEffect(() => { ponerBadge(noLeidas.length); }, [noLeidas.length]);

  // Cerrar al hacer clic afuera.
  useEffect(() => {
    if (!abierta) return;
    const onClick = (e) => { if (panelRef.current && !panelRef.current.contains(e.target)) setAbierta(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [abierta]);

  // Aviso del navegador cuando entra una nueva. Se recuerdan los ids ya vistos
  // para no avisar por las que ya estaban al abrir el panel.
  const vistas = useRef(null);
  useEffect(() => {
    if (vistas.current === null) {
      vistas.current = new Set(notificaciones.map((n) => n.id));
      return;
    }
    const nuevas = notificaciones.filter((n) => !vistas.current.has(n.id));
    nuevas.forEach((n) => vistas.current.add(n.id));
    if (!nuevas.length) return;
    if (permiso !== 'granted') return;
    try {
      nuevas.slice(0, 3).forEach((n) => new Notification(n.title, { body: n.body, tag: n.id }));
    } catch { /* algunos navegadores móviles no dejan crear Notification desde la página */ }
  }, [notificaciones, permiso]);

  // Activa el push de verdad (service worker + token), no solo el permiso del
  // navegador: así el aviso llega aunque la app esté cerrada.
  const pedirPermiso = async () => {
    try {
      const r = await activarPush({
        plataforma,
        businessId: plataforma ? null : businessId,
        uid,
        professionalId: user?.professionalId || null,
        role: plataforma ? 'platform' : user?.role === 'owner' ? 'owner' : 'admin',
      });
      setPush(r.estado);
    } catch (err) {
      console.error('[Campana] No se pudo activar el push:', err);
      setPush('sin-token');
    }
    if (typeof Notification !== 'undefined') setPermiso(Notification.permission);
  };

  const abrir = async (n) => {
    setAbierta(false);
    if (!n.leidaPor?.[uid] && uid && (plataforma || businessId)) {
      marcarLeida(n.id).catch((err) => console.error('[Campana] No se pudo marcar leída:', err));
    }
    navigate(n.url || (plataforma ? '/super-admin?tab=soporte' : '/admin/citas'));
  };

  const marcarTodas = () => {
    noLeidas.forEach((n) => marcarLeida(n.id).catch(() => {}));
  };

  return (
    <div className="campana" ref={panelRef}>
      <button
        className="campana-boton"
        onClick={() => setAbierta((v) => !v)}
        aria-label={noLeidas.length ? `${noLeidas.length} notificaciones sin leer` : 'Notificaciones'}
        title="Notificaciones"
      >
        🔔
        {noLeidas.length > 0 && <span className="campana-contador">{noLeidas.length > 9 ? '9+' : noLeidas.length}</span>}
      </button>

      {abierta && (
        <div className="campana-panel">
          <div className="campana-panel-cabecera">
            <strong>Notificaciones</strong>
            {noLeidas.length > 0 && (
              <button className="btn btn-ghost btn-sm" onClick={marcarTodas}>Marcar todas leídas</button>
            )}
          </div>

          {push === 'disponible' && (
            <button className="campana-permiso" onClick={pedirPermiso}>
              🔕 Activar avisos en este dispositivo
            </button>
          )}
          {push === 'ios-sin-instalar' && (
            <Link className="campana-permiso" to={plataforma ? '/admin/instalar' : '/admin/instalar'} onClick={() => setAbierta(false)} style={{ display: 'block', textDecoration: 'none' }}>
              📲 Instalá la app en tu iPhone para recibir avisos →
            </Link>
          )}
          {(push === 'bloqueado' || push === 'sin-soporte' || push === 'sin-token' || push === 'rechazado') && (
            <Link className="campana-permiso" to="/admin/instalar" onClick={() => setAbierta(false)} style={{ display: 'block', textDecoration: 'none' }}>
              🔕 Los avisos no están activos en este dispositivo. Ver cómo →
            </Link>
          )}

          {notificaciones.length === 0 ? (
            <div className="campana-vacia">
              {plataforma
                ? 'Cuando entre un ticket, una barbería responda, o una cuenta se suspenda por deuda, te avisamos acá.'
                : 'Cuando un cliente reserve o cancele un turno, te avisamos acá.'}
            </div>
          ) : (
            <ul className="campana-lista">
              {notificaciones.slice(0, 30).map((n) => {
                const leida = Boolean(n.leidaPor?.[uid]);
                return (
                  <li key={n.id} className={`campana-item ${leida ? '' : 'no-leida'}`} onClick={() => abrir(n)}>
                    <span className="campana-icono">{ICONO[n.type] || '🔔'}</span>
                    <div className="campana-texto">
                      <div className="campana-titulo">{n.title}</div>
                      <div className="campana-cuerpo">{n.body}</div>
                      <div className="campana-hace">{hace(n.createdAt)}</div>
                    </div>
                    {!leida && <span className="campana-punto" />}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
