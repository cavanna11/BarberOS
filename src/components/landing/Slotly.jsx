import { useEffect, useState } from 'react';

// ============================================================================
// Slotly: el turnero hermano, para los rubros que no son barbería
// ============================================================================
// BarberOS es de barberías y así se queda: todo lo que dice la web —el "cortás
// el pelo", los planes por barbero, el link de la barbería— está escrito para
// ese oficio. Pero a la landing entra gente de otros rubros: una cosmetóloga,
// un psicólogo, un estudio. A esa gente no le sirve BarberOS y hoy se iba sin
// nada.
//
// Slotly, del mismo equipo, es el turnero que se adapta a cada rubro. Así que
// en vez de perder la visita, se la pasa. Se muestra con SUS colores a
// propósito: tiene que leerse como otra marca, no como una sección de BarberOS.
//
// Ojo con cómo se lo nombra: NO es "el mismo sistema" ni "esto mismo con otro
// nombre". Se vende como un producto propio, del mismo equipo, que se adapta
// al rubro de cada uno. Decir que es lo mismo lo abarata y confunde: el que
// llega tiene que sentir que hay algo hecho para él, no una barbería
// disfrazada.

export const SLOTLY_URL = 'https://slotly-turnos.vercel.app/';

/** Para no perseguir a nadie: una vez que lo cierra, no vuelve por un tiempo. */
const guardar = (clave, dias) => {
  try { localStorage.setItem(clave, String(Date.now() + dias * 86400000)); } catch { /* sin storage */ }
};
const sigueOculto = (clave) => {
  try {
    const hasta = Number(localStorage.getItem(clave) || 0);
    return hasta > Date.now();
  } catch { return false; }
};

const LINK = `${SLOTLY_URL}?ref=barberos`;

/**
 * Barra fina arriba de todo. Es lo primero que se ve, así que dice lo justo:
 * esto es de barberías, si sos de otro rubro andá acá.
 */
export function BarraSlotly() {
  const [oculta, setOculta] = useState(() => sigueOculto('slotly:barra'));
  if (oculta) return null;

  return (
    <div className="slotly-barra">
      <span>
        ¿No tenés una barbería? <strong>Slotly</strong> adapta el turnero a tu rubro.
      </span>
      <a className="slotly-barra-link" href={LINK} target="_blank" rel="noreferrer">
        Conocer Slotly →
      </a>
      <button
        className="slotly-barra-cerrar"
        onClick={() => { guardar('slotly:barra', 30); setOculta(true); }}
        aria-label="Cerrar este aviso"
      >
        ✕
      </button>
    </div>
  );
}

/**
 * La sección del medio de la landing. Va después de "lo que hace" y antes de
 * "cómo arranca": justo cuando el que no es barbero ya entendió para qué sirve
 * y está por darse cuenta de que no es para él.
 */
export function SeccionSlotly() {
  return (
    <section className="slotly-seccion" id="otros-rubros">
      <div className="slotly-caja">
        <span className="slotly-eyebrow">• Otro rubro, mismo sistema</span>
        <h2 className="slotly-titulo">
          ¿Lo tuyo no es una barbería?
          <br />
          Está <span className="slotly-marca">Slotly</span>.
        </h2>
        <p className="slotly-texto">
          BarberOS está hecho para barberías y así se queda: por eso habla de
          barberos, de cortes y de sillas. <strong>Slotly</strong> es el sistema de
          turnos del mismo equipo, adaptado a cada rubro: tus servicios, tus
          tiempos y tu manera de trabajar.
        </p>

        <ul className="slotly-rubros">
          <li>Estética y cosmetología</li>
          <li>Consultorios y terapias</li>
          <li>Uñas y pestañas</li>
          <li>Tatuajes</li>
          <li>Kinesiología</li>
          <li>Y cualquier otro que dé turnos</li>
        </ul>

        <a className="slotly-boton" href={LINK} target="_blank" rel="noreferrer">
          Ver Slotly →
        </a>
        <p className="slotly-pie">
          Mismo equipo, misma forma de trabajar. Si no sabés cuál te sirve, escribinos
          y te lo decimos.
        </p>
      </div>
    </section>
  );
}

/**
 * El flotante. Aparece una sola vez, después de un rato leyendo, abajo a la
 * izquierda para no taparle nada al CTA principal. Si lo cierra, no vuelve por
 * dos semanas.
 */
export function FlotanteSlotly({ segundos = 25 }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (sigueOculto('slotly:flotante')) return;
    const t = setTimeout(() => setVisible(true), segundos * 1000);
    return () => clearTimeout(t);
  }, [segundos]);

  if (!visible) return null;

  const cerrar = () => { guardar('slotly:flotante', 14); setVisible(false); };

  return (
    <aside className="slotly-flotante" role="complementary">
      <button className="slotly-flotante-cerrar" onClick={cerrar} aria-label="Cerrar">✕</button>
      <strong className="slotly-marca">Slotly</strong>
      <p>
        ¿Buscabas un turnero pero lo tuyo no es una barbería? Slotly lo adapta a tu
        rubro. Lo hace el mismo equipo.
      </p>
      <a className="slotly-boton slotly-boton-sm" href={LINK} target="_blank" rel="noreferrer" onClick={cerrar}>
        Conocer Slotly →
      </a>
    </aside>
  );
}
