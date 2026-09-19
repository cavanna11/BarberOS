import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useCurrentBusiness } from '../../hooks/useCurrentBusiness';
import { activarPush, estadoPush, esAppInstalada, esIOS, esAndroid } from '../../lib/push';

/**
 * Tutorial para instalar BarberOS en el celular y activar los avisos.
 *
 * Detecta el dispositivo y muestra primero lo que le corresponde a ESE
 * teléfono, pero deja las otras guías abajo por si lo está leyendo desde la
 * compu para explicárselo a un barbero.
 *
 * La parte que nadie descubre solo es la de iPhone: las notificaciones solo
 * llegan con la app agregada a la pantalla de inicio, y el permiso se pide
 * desde adentro de esa app. Por eso el botón "Activar avisos" vive acá, y en
 * un iPhone sin instalar dice "primero instalala" en vez de fallar.
 */

// El evento de Chrome/Android que permite instalar con un solo toque. Se
// guarda a nivel módulo porque se dispara una sola vez, a veces antes de que
// esta página exista.
let promptDeInstalacion = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    promptDeInstalacion = e;
  });
}

function Paso({ n, children }) {
  return (
    <li className="instalar-paso">
      <span className="instalar-paso-n">{n}</span>
      <div>{children}</div>
    </li>
  );
}

function GuiaIPhone() {
  return (
    <div className="card instalar-guia">
      <h3>📱 iPhone (Safari)</h3>
      <p className="text-secondary text-sm">
        En iPhone las notificaciones <strong>solo llegan si la app está en la pantalla
        de inicio</strong>. No es un capricho nuestro: es una regla de Apple para
        cualquier app web. Son cuatro toques, una sola vez.
      </p>
      <ol className="instalar-pasos">
        <Paso n="1">
          Abrí <strong>barberos.sacia.tech/admin</strong> en <strong>Safari</strong> (el
          navegador de la brújula azul). Si te llegó el link por WhatsApp y se abrió
          en otro lado, copialo y pegalo en Safari.
        </Paso>
        <Paso n="2">
          Tocá el botón <strong>Compartir</strong>: el cuadradito con la flecha hacia
          arriba <span className="instalar-icono">⎋</span>, abajo en el centro de la
          pantalla (en iPhones con la barra arriba, está al lado de la dirección).
        </Paso>
        <Paso n="3">
          Deslizá la lista hacia abajo y tocá <strong>"Agregar a inicio"</strong>
          (o "Añadir a pantalla de inicio"). Dejá el nombre <strong>BarberOS</strong> y
          tocá <strong>Agregar</strong>.
        </Paso>
        <Paso n="4">
          Cerrá Safari y abrí BarberOS <strong>desde el ícono nuevo</strong> de tu
          pantalla de inicio. Entrá con tu cuenta.
        </Paso>
        <Paso n="5">
          Adentro de la app, vení a esta misma pantalla (menú → <strong>Instalar la
          app</strong>) y tocá <strong>Activar avisos</strong>. El iPhone te pregunta si
          permitís las notificaciones: <strong>Permitir</strong>.
        </Paso>
      </ol>
      <div className="notice notice-info" style={{ marginTop: 12 }}>
        <strong>Ojo:</strong> si abrís BarberOS desde Safari en vez de desde el ícono,
        no van a llegar avisos. Usá siempre el ícono. Necesitás iOS 16.4 o más nuevo
        (cualquier iPhone de 2018 en adelante, actualizado).
      </div>
      <details className="instalar-detalle">
        <summary>¿Y si uso Chrome en el iPhone?</summary>
        <p className="text-sm text-secondary">
          Desde iOS 16.4 también se puede: en Chrome tocá los tres puntos <strong>⋯</strong> →
          <strong> Agregar a la pantalla de inicio</strong>. Pero Safari es el camino seguro:
          si algo no anda, probá con Safari antes que nada.
        </p>
      </details>
    </div>
  );
}

function GuiaAndroid({ onInstalar, puedeUnToque }) {
  return (
    <div className="card instalar-guia">
      <h3>🤖 Android (Chrome)</h3>
      {puedeUnToque && (
        <div style={{ marginBottom: 12 }}>
          <button className="btn btn-primary" onClick={onInstalar}>⬇️ Instalar BarberOS ahora</button>
          <p className="text-sm text-muted" style={{ marginTop: 6 }}>Un toque y listo. Si no aparece nada, seguí los pasos de abajo.</p>
        </div>
      )}
      <ol className="instalar-pasos">
        <Paso n="1">
          Abrí <strong>barberos.sacia.tech/admin</strong> en <strong>Chrome</strong>.
        </Paso>
        <Paso n="2">
          Tocá los <strong>tres puntos ⋮</strong> arriba a la derecha.
        </Paso>
        <Paso n="3">
          Tocá <strong>"Instalar app"</strong> o <strong>"Agregar a la pantalla
          principal"</strong> (el nombre cambia según la versión) y confirmá.
        </Paso>
        <Paso n="4">
          Abrí BarberOS desde el ícono nuevo, entrá con tu cuenta, y en esta pantalla
          tocá <strong>Activar avisos</strong> → <strong>Permitir</strong>.
        </Paso>
      </ol>
      <details className="instalar-detalle">
        <summary>¿Samsung Internet u otro navegador?</summary>
        <p className="text-sm text-secondary">
          En Samsung Internet: menú <strong>☰</strong> → <strong>Agregar página a</strong> →
          <strong> Pantalla de inicio</strong>. En cualquier caso, si algo no anda, Chrome es
          el que probamos nosotros.
        </p>
      </details>
    </div>
  );
}

function GuiaEscritorio() {
  return (
    <div className="card instalar-guia">
      <h3>💻 Computadora</h3>
      <p className="text-secondary text-sm">
        En Chrome o Edge, en la barra de dirección aparece un ícono de
        instalar <span className="instalar-icono">⊕</span> a la derecha. Tocalo y BarberOS
        queda como un programa más, con su ventana. Los avisos llegan igual que en el
        celular mientras la compu esté prendida.
      </p>
    </div>
  );
}

const TEXTO_ESTADO = {
  'activo':           { clase: 'notice-success', texto: '✅ Los avisos están activados en este dispositivo. Cuando un cliente reserve o cancele, te va a llegar aunque tengas la app cerrada.' },
  'disponible':       { clase: 'notice-info',    texto: 'Este dispositivo puede recibir avisos. Tocá el botón para activarlos.' },
  'ios-sin-instalar': { clase: 'notice-warn',    texto: 'Estás en un iPhone, pero desde Safari. Para recibir avisos primero tenés que instalar la app (pasos de abajo) y abrirla desde el ícono.' },
  'sin-soporte':      { clase: 'notice-warn',    texto: 'Este navegador no soporta notificaciones. Probá con Chrome (Android) o Safari (iPhone) siguiendo los pasos de abajo.' },
  'bloqueado':        { clase: 'notice-danger',  texto: 'Las notificaciones están bloqueadas para BarberOS en este dispositivo. Hay que permitirlas desde la configuración del teléfono: Ajustes → Notificaciones → BarberOS.' },
  'sin-vapid':        { clase: 'notice-warn',    texto: 'Los avisos push todavía no están configurados en el servidor. Escribinos.' },
  'rechazado':        { clase: 'notice-warn',    texto: 'No se dio el permiso. Cuando quieras, volvé a tocar el botón.' },
  'sin-token':        { clase: 'notice-warn',    texto: 'No se pudo registrar el dispositivo. Probá de nuevo en un rato.' },
};

export default function InstalarPage() {
  const { user } = useAuth();
  const { businessId } = useCurrentBusiness();
  const [estado, setEstado] = useState(() => estadoPush().estado);
  const [activando, setActivando] = useState(false);
  const [puedeUnToque, setPuedeUnToque] = useState(Boolean(promptDeInstalacion));

  const instalada = esAppInstalada();
  const ios = esIOS();
  const android = esAndroid();

  useEffect(() => {
    const onPrompt = () => setPuedeUnToque(true);
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const instalarUnToque = async () => {
    if (!promptDeInstalacion) return;
    promptDeInstalacion.prompt();
    await promptDeInstalacion.userChoice.catch(() => {});
    promptDeInstalacion = null;
    setPuedeUnToque(false);
  };

  const activar = async () => {
    setActivando(true);
    try {
      const r = await activarPush({
        businessId,
        uid: user.id,
        professionalId: user.professionalId || null,
        role: user.role === 'owner' ? 'owner' : 'admin',
      });
      setEstado(r.estado);
    } catch (err) {
      console.error('[Instalar] No se pudieron activar los avisos:', err);
      setEstado('sin-token');
    } finally {
      setActivando(false);
    }
  };

  const info = TEXTO_ESTADO[estado] || TEXTO_ESTADO.disponible;
  const puedeActivar = ['disponible', 'rechazado', 'sin-token'].includes(estado);

  // Orden de las guías: primero la del dispositivo desde el que está leyendo.
  const guias = ios
    ? [<GuiaIPhone key="ios" />, <GuiaAndroid key="and" onInstalar={instalarUnToque} puedeUnToque={false} />, <GuiaEscritorio key="pc" />]
    : android
      ? [<GuiaAndroid key="and" onInstalar={instalarUnToque} puedeUnToque={puedeUnToque} />, <GuiaIPhone key="ios" />, <GuiaEscritorio key="pc" />]
      : [<GuiaEscritorio key="pc" />, <GuiaAndroid key="and" onInstalar={instalarUnToque} puedeUnToque={puedeUnToque} />, <GuiaIPhone key="ios" />];

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1>Instalar la app</h1>
          <p className="text-secondary" style={{ marginTop: 4 }}>
            BarberOS se instala en el celular como cualquier app, sin pasar por la
            tienda, y te avisa al instante cuando un cliente reserva o cancela.
          </p>
        </div>
      </div>

      {/* Estado de ESTE dispositivo + botón de activar. */}
      <div className="card" style={{ marginBottom: 'var(--space-lg)' }}>
        <div className="instalar-estado">
          <div>
            <div className="text-sm text-muted" style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Este dispositivo
            </div>
            <div style={{ fontWeight: 700, marginTop: 4 }}>
              {instalada ? '✅ App instalada' : '📲 Abierta en el navegador'}
              {' · '}
              {ios ? 'iPhone' : android ? 'Android' : 'Computadora'}
            </div>
          </div>
          {puedeActivar && (
            <button className="btn btn-primary" onClick={activar} disabled={activando}>
              {activando ? 'Activando…' : '🔔 Activar avisos'}
            </button>
          )}
        </div>
        <div className={`notice ${info.clase}`} style={{ marginTop: 12 }}>{info.texto}</div>
      </div>

      <h2 style={{ fontSize: '1.1rem', marginBottom: 'var(--space-md)' }}>Cómo instalarla, paso a paso</h2>
      <div className="instalar-guias">{guias}</div>

      <div className="card" style={{ marginTop: 'var(--space-lg)' }}>
        <h3>Preguntas rápidas</h3>
        <details className="instalar-detalle">
          <summary>¿Ocupa espacio? ¿Hay que actualizarla?</summary>
          <p className="text-sm text-secondary">Casi nada, y no: se actualiza sola cada vez que la abrís.</p>
        </details>
        <details className="instalar-detalle">
          <summary>¿Puedo instalarla en más de un teléfono?</summary>
          <p className="text-sm text-secondary">Sí. Cada teléfono en el que actives los avisos los recibe.</p>
        </details>
        <details className="instalar-detalle">
          <summary>¿Qué avisos llegan?</summary>
          <p className="text-sm text-secondary">
            Turno nuevo y turno cancelado por un cliente. El dueño recibe los de toda la
            barbería; cada barbero, solo los suyos. Lo que cargás vos mismo no te avisa.
          </p>
        </details>
        <details className="instalar-detalle">
          <summary>Dejaron de llegar</summary>
          <p className="text-sm text-secondary">
            Volvé a esta pantalla y tocá "Activar avisos" de nuevo. En iPhone, revisá que
            estés abriendo BarberOS desde el ícono y no desde Safari. Si sigue sin andar,
            escribinos desde Soporte.
          </p>
        </details>
      </div>
    </div>
  );
}
