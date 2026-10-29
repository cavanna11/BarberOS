// ============================================================================
// La tarjeta de fidelidad
// ============================================================================
// Una casilla por turno atendido. Lo importante no es mostrar el número: es
// que el cliente VEA que avanzó. Por eso, cuando vuelve a entrar y hay sellos
// nuevos desde la última vez, no aparecen ya marcados: se van sellando de a uno,
// con el contador subiendo, y si completa la tarjeta, una celebración corta.
//
// "La última vez" se recuerda en ESTE teléfono (localStorage): es una
// comodidad visual, no un dato. Si se borra, la tarjeta simplemente aparece
// sellada sin animación — nada se pierde.
//
// Accesible: es una lista de casillas, cada una dice si está sellada (no solo
// el color: también lleva la marca), y el progreso se anuncia una vez al final.
import { useEffect, useRef, useState } from 'react';
import { prefiereMenosMovimiento } from './movimiento';
import Celebracion from './Celebracion';
import { describirPremio } from '../../utils/recompensas';

const MARCA = { clasico: '✓', sellos: '💈', minimal: '●' };

export default function TarjetaFidelidad({
  casillas = 10, sellos = 0, desde = null, color = '#e03d00', diseno = 'clasico',
  premio = null, completaRecien = false, compacta = false, onTermino,
}) {
  const inicio = desde === null || prefiereMenosMovimiento() ? sellos : Math.min(desde, sellos);
  const [marcadas, setMarcadas] = useState(inicio);
  const [recien, setRecien] = useState(null);
  const [festejo, setFestejo] = useState(false);
  const termino = useRef(onTermino);
  useEffect(() => { termino.current = onTermino; }, [onTermino]);

  // Sella de a una casilla. Cada paso es un setState dentro de un timeout (no
  // sincrónico en el efecto), así que no hay render de más.
  useEffect(() => {
    if (marcadas >= sellos) {
      if (completaRecien && !prefiereMenosMovimiento()) {
        const t = setTimeout(() => setFestejo(true), 250);
        return () => clearTimeout(t);
      }
      termino.current?.();
      return undefined;
    }
    const t = setTimeout(() => {
      setRecien(marcadas);
      setMarcadas((m) => m + 1);
    }, marcadas === inicio ? 500 : 650);
    return () => clearTimeout(t);
  }, [marcadas, sellos, inicio, completaRecien]);

  useEffect(() => {
    if (!festejo) return undefined;
    const t = setTimeout(() => termino.current?.(), 1800);
    return () => clearTimeout(t);
  }, [festejo]);

  const faltan = Math.max(0, casillas - marcadas);
  const nombrePremio = premio ? (premio.nombre || describirPremio(premio)) : 'tu premio';
  const marca = MARCA[diseno] || MARCA.clasico;

  return (
    <div className={`tarjeta-fid diseno-${diseno} ${compacta ? 'compacta' : ''}`} style={{ '--fid-color': color }}>
      {festejo && <Celebracion />}
      <div className="tarjeta-fid-cabeza">
        <span className="tarjeta-fid-titulo">Tu tarjeta</span>
        <span className="tarjeta-fid-contador" aria-hidden="true">
          <strong key={marcadas} className="tarjeta-fid-numero">{marcadas}</strong>/{casillas}
        </span>
      </div>
      <ol className="tarjeta-fid-casillas" aria-label={`Tarjeta de ${casillas} casillas`}>
        {Array.from({ length: casillas }, (_, i) => {
          const sellada = i < marcadas;
          return (
            <li
              key={i}
              className={`fid-casilla ${sellada ? 'sellada' : ''} ${recien === i ? 'recien' : ''} ${i === casillas - 1 ? 'ultima' : ''}`}
              aria-label={`Casilla ${i + 1}: ${sellada ? 'sellada' : 'libre'}${i === casillas - 1 ? `, la del premio` : ''}`}
            >
              <span className="fid-marca" aria-hidden="true">
                {sellada ? marca : i === casillas - 1 ? '🎁' : ''}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="tarjeta-fid-texto" aria-live="polite">
        {marcadas >= casillas
          ? <>¡Completaste la tarjeta! <strong>{nombrePremio}</strong> ya está en tus premios.</>
          : faltan === 1
            ? <>Te falta <strong>1 turno</strong> para {nombrePremio}.</>
            : <>Te faltan <strong>{faltan} turnos</strong> para {nombrePremio}.</>}
      </p>
    </div>
  );
}
