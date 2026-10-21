import { Component } from 'react';
import { esErrorDeCarga, recargarPorVersionNueva } from '../../utils/versionNueva';

/**
 * La red de abajo de todo. Sin esto, cualquier error al pintar —una pantalla
 * que no se pudo bajar, un dato que vino raro— desmonta la app entera y queda
 * la pantalla en blanco, sin nada que tocar. Con esto queda un mensaje y un
 * botón de recargar.
 *
 * Si el error es de una versión vieja (ver `utils/versionNueva.js`), recarga
 * solo.
 */
export default class ErrorDePantalla extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorDePantalla]', error, info?.componentStack);
    if (esErrorDeCarga(error)) recargarPorVersionNueva();
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ minHeight: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div className="card" style={{ maxWidth: 380, textAlign: 'center' }}>
          <h2 style={{ marginBottom: 8 }}>Algo no cargó bien</h2>
          <p className="text-secondary" style={{ marginBottom: 16 }}>
            Puede ser la conexión o que haya una versión nueva. Recargá y seguí donde estabas.
          </p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            Recargar
          </button>
        </div>
      </div>
    );
  }
}
