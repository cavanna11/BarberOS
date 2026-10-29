// ============================================================================
// La rueda de la ruleta, en SVG
// ============================================================================
// La misma rueda se dibuja en la vista previa del panel (mientras el dueño la
// arma) y en el juego del cliente. Una sola, para que lo que el dueño ve sea lo
// que ve el cliente.
//
// Porciones IGUALES, no proporcionales a la probabilidad: una ruleta donde el
// corte gratis es una astilla del 2% no sorprende a nadie, y además le muestra
// al cliente las chances, que es justo lo que el espejo público no publica.
// El sorteo es del servidor; la rueda solo anima hacia lo que salió.
//
// Cada porción lleva ícono y texto (no solo color): se tiene que poder leer
// sin distinguir colores, y el lector de pantalla recibe la lista aparte.

import { textoSobre } from '../../config/theme';

const TAU = Math.PI * 2;

function punto(r, angulo) {
  // 0 rad = arriba, en sentido horario: así la porción 0 empieza en el puntero.
  return [r * Math.sin(angulo), -r * Math.cos(angulo)];
}

function porcion(r, desde, hasta) {
  const [x1, y1] = punto(r, desde);
  const [x2, y2] = punto(r, hasta);
  const grande = hasta - desde > Math.PI ? 1 : 0;
  return `M0 0 L${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${grande} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
}

/** Texto corto para la porción: lo que entra en una rueda de celular. */
function etiqueta(s) {
  const t = String(s.nombre || '');
  return t.length > 14 ? `${t.slice(0, 13)}…` : t;
}

export default function Rueda({ segmentos = [], rotacion = 0, girando = false, duracionMs = 4800, tamano = 300 }) {
  const n = Math.max(1, segmentos.length);
  const paso = TAU / n;
  const R = 100;

  return (
    <div className="rueda" style={{ width: tamano, height: tamano }}>
      <div className="rueda-puntero" aria-hidden="true" />
      <svg
        viewBox="-104 -104 208 208"
        className="rueda-svg"
        aria-hidden="true"
        style={{
          transform: `rotate(${rotacion}deg)`,
          transition: girando ? `transform ${duracionMs}ms cubic-bezier(0.12, 0.72, 0.16, 1)` : 'none',
        }}
      >
        <circle r="103" fill="var(--text)" />
        {segmentos.map((s, i) => {
          const desde = i * paso;
          const medio = desde + paso / 2;
          const color = s.color || '#e03d00';
          const tinta = textoSobre(color);
          const [tx, ty] = punto(R * 0.62, medio);
          const giro = (medio * 180) / Math.PI;
          return (
            <g key={i}>
              <path d={porcion(R, desde, desde + paso)} fill={color} stroke="var(--surface)" strokeWidth="1.2" />
              <g transform={`translate(${tx.toFixed(2)} ${ty.toFixed(2)}) rotate(${giro.toFixed(2)})`}>
                <text y="-6" textAnchor="middle" fontSize={n > 8 ? 11 : 14}>{s.icono || '🎁'}</text>
                <text y="9" textAnchor="middle" fontSize={n > 8 ? 6.5 : 8} fontWeight="700" fill={tinta}>{etiqueta(s)}</text>
              </g>
            </g>
          );
        })}
        <circle r="13" fill="var(--surface)" stroke="var(--text)" strokeWidth="3" />
      </svg>
    </div>
  );
}
