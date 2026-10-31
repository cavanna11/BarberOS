import { Link } from 'react-router-dom';
import { useBusiness } from '../../contexts/BusinessContext';

/**
 * Pantalla para cuando no se pudo resolver un negocio desde la URL.
 *
 * Por decisión de producto NO hay un selector público de barberías: cada
 * cliente entra por el link directo de su negocio (`/barberia-sacia`).
 * En desarrollo sí listamos los tenants para poder probar el aislamiento.
 */
export default function NoBusinessPage({ reason = 'not-found' }) {
  const { state } = useBusiness();
  const businesses = state.businesses || [];

  const messages = {
    'not-found': {
      icon: '🔍',
      title: 'No encontramos este negocio',
      text: 'Revisá el link que te compartieron. Cada negocio tiene su propia dirección.',
    },
    frozen: {
      icon: '⏸️',
      title: 'Reservas no disponibles',
      text: 'Este negocio tiene las reservas online pausadas temporalmente. Escribinos por otro medio para coordinar tu turno.',
    },
    // No es lo mismo "no existe" que "no pude averiguarlo", y el cliente no
    // tiene por que pagar la diferencia. Este cartel NO acusa al link: dice que
    // el problema es de conexion y da un boton. Antes, una lectura que no
    // llegaba se mostraba como "no encontramos este negocio" — la barberia
    // quedaba como inexistente por un segundo de mala senial.
    'sin-conexion': {
      icon: '📶',
      title: 'No pudimos cargar la barbería',
      text: 'Parece que la conexión se cortó. El link está bien: lo estamos reintentando solo, y aparece apenas vuelva la señal.',
    },
    'no-slug': {
      icon: '📅',
      title: 'Necesitás el link de tu negocio',
      text: 'Para reservar un turno entrá con el link que te compartió tu barbería o salón.',
    },
  };

  const { icon, title, text } = messages[reason] || messages['not-found'];

  return (
    <div className="empty-state" style={{ maxWidth: 560, margin: '0 auto' }}>
      <div className="empty-state-icon">{icon}</div>
      <h2>{title}</h2>
      <p>{text}</p>

      {reason === 'sin-conexion' && (
        <button className="btn btn-primary mt-md" onClick={() => window.location.reload()}>
          Reintentar
        </button>
      )}

      {import.meta.env.DEV && businesses.length > 0 && (
        <div className="card" style={{ marginTop: '2rem', textAlign: 'left' }}>
          <strong>Negocios de prueba (solo en desarrollo)</strong>
          <ul style={{ marginTop: '0.75rem', paddingLeft: '1.25rem' }}>
            {businesses.map((b) => (
              <li key={b.id} style={{ marginBottom: '0.35rem' }}>
                <Link to={`/${b.slug}`}>/{b.slug}</Link> — {b.name}
                {b.isFrozen && ' (congelado)'}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
