// Confetti discreto: veinte papelitos que caen una vez y se van. Solo CSS
// (transform + opacity, que corren en el compositor y no traban la página),
// sin librería, sin canvas, y nada si el cliente pidió menos movimiento.
import { useState } from 'react';
import { prefiereMenosMovimiento } from './movimiento';

const COLORES = ['#e03d00', '#ff5c1a', '#f2b705', '#0f9960', '#0a0a0a'];

export default function Celebracion({ cantidad = 22 }) {
  // Las posiciones se sortean UNA vez, al montar (inicializador de useState):
  // si se recalcularan en cada render, el confetti saltaría de lugar con
  // cualquier cambio de estado.
  const [piezas] = useState(() => Array.from({ length: cantidad }, (_, i) => ({
    izquierda: Math.random() * 100,
    demora: Math.random() * 350,
    duracion: 1400 + Math.random() * 900,
    giro: Math.round(Math.random() * 720 - 360),
    deriva: Math.round(Math.random() * 80 - 40),
    color: COLORES[i % COLORES.length],
    ancho: 6 + Math.round(Math.random() * 4),
  })));

  if (prefiereMenosMovimiento()) return null;

  return (
    <div className="celebracion" aria-hidden="true">
      {piezas.map((p, i) => (
        <span
          key={i}
          className="celebracion-pieza"
          style={{
            left: `${p.izquierda}%`,
            width: p.ancho,
            background: p.color,
            animationDelay: `${p.demora}ms`,
            animationDuration: `${p.duracion}ms`,
            '--giro': `${p.giro}deg`,
            '--deriva': `${p.deriva}px`,
          }}
        />
      ))}
    </div>
  );
}
