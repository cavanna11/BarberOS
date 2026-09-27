import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { subscribeAvisos } from '../../lib/repository';

// ============================================================================
// El cartel de "novedades" que ve todo el staff
// ============================================================================
// Cuando sale una actualización que pide algo de la barbería —"volvé a activar
// los avisos"— antes había que escribirle por WhatsApp a cada barbero, uno por
// uno. Esto lo publica una vez desde el panel global y lo ven todos.
//
// Se cierra por dispositivo (localStorage con el id del aviso): no vuelve a
// molestar, pero si la persona entra desde otro teléfono lo ve igual, que para
// un aviso importante es lo que querés.

const CLAVE = 'barberos:avisos-vistos';

const leerVistos = () => {
  try { return new Set(JSON.parse(localStorage.getItem(CLAVE) || '[]')); } catch { return new Set(); }
};
const guardarVisto = (id) => {
  try {
    const vistos = [...leerVistos(), id].slice(-40); // no crece para siempre
    localStorage.setItem(CLAVE, JSON.stringify(vistos));
  } catch { /* sin storage: se muestra siempre, es lo correcto */ }
};

const ESTILO = {
  info:   { clase: 'notice-info',   icono: 'ℹ️' },
  accion: { clase: 'notice-warn',   icono: '🔔' },
  urgente:{ clase: 'notice-danger', icono: '⚠️' },
};

export default function AvisoPlataforma() {
  const [avisos, setAvisos] = useState([]);
  const [vistos, setVistos] = useState(leerVistos);

  useEffect(() => {
    return subscribeAvisos(setAvisos, (err) => {
      // Que no se caiga el panel por un aviso: es lo menos importante de la pantalla.
      console.warn('[avisos] No se pudieron leer:', err.code || err.message);
    });
  }, []);

  // El más reciente que siga activo y que esta persona no haya cerrado.
  const aviso = avisos.find((a) => a.activo !== false && !vistos.has(a.id));
  if (!aviso) return null;

  const estilo = ESTILO[aviso.tipo] || ESTILO.info;
  const cerrar = () => {
    guardarVisto(aviso.id);
    setVistos(leerVistos());
  };

  const esInterno = aviso.ctaUrl && aviso.ctaUrl.startsWith('/');

  return (
    <div className={`notice ${estilo.clase} aviso-plataforma`}>
      <div className="aviso-plataforma-texto">
        <strong>{estilo.icono} {aviso.titulo}</strong>
        {aviso.cuerpo && <div className="text-sm" style={{ marginTop: 2 }}>{aviso.cuerpo}</div>}
      </div>
      <div className="aviso-plataforma-acciones">
        {aviso.ctaTexto && aviso.ctaUrl && (
          esInterno ? (
            <Link className="btn btn-primary btn-sm" to={aviso.ctaUrl} onClick={cerrar}>{aviso.ctaTexto}</Link>
          ) : (
            <a className="btn btn-primary btn-sm" href={aviso.ctaUrl} target="_blank" rel="noreferrer" onClick={cerrar}>
              {aviso.ctaTexto}
            </a>
          )
        )}
        <button className="btn btn-ghost btn-sm" onClick={cerrar} aria-label="Entendido, cerrar">Entendido</button>
      </div>
    </div>
  );
}
