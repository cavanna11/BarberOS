import VistaPagina from '../client/VistaPagina';

// ============================================================================
// La página de presentación dentro de un celular, para el editor
// ============================================================================
// La página se dibuja a su tamaño real de teléfono (390 px de ancho) y se
// achica con `transform: scale`. Dos razones para hacerlo así y no con CSS
// aparte:
//
//   - Es el MISMO componente que ve el cliente (VistaPagina): la vista previa
//     no puede mentir sobre cómo queda.
//   - El `transform` convierte al contenedor en el marco de referencia de lo
//     que tiene `position: fixed`, así que la foto de portada —que en la página
//     real está fija a la pantalla— queda fija al celular y no al editor.
//
// `miniatura`: chica, sin scroll y sin que se pueda tocar nada adentro (es
// para elegir plantilla, el click lo maneja la tarjeta que la contiene).

const ANCHO = 390;

export default function CelularPagina({ escala = 0.8, alto = 760, miniatura = false, ...vista }) {
  return (
    <div
      className={`celular ${miniatura ? 'celular-miniatura' : ''}`}
      style={{ width: ANCHO * escala, height: alto * escala }}
      aria-hidden={miniatura || undefined}
    >
      <div
        className="celular-pantalla"
        style={{ width: ANCHO, height: alto, transform: `scale(${escala})` }}
        inert={miniatura || undefined}
      >
        <VistaPagina {...vista} vistaPrevia />
      </div>
    </div>
  );
}
