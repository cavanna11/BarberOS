import { tieneVentana } from '../../utils/ventanaServicio';

/**
 * La barbería se presenta: dónde queda (con "Cómo llegar" a Google Maps),
 * cómo contactarla y una línea de presentación. Va arriba de la reserva y en
 * la confirmación del turno, que es cuando el cliente necesita la dirección.
 *
 * `variant`: 'compacta' (arriba de los pasos) o 'completa' (confirmación).
 */

// Solo links de Google Maps de verdad: el campo lo escribe el dueño y termina
// en un href de la página pública; un `javascript:` ahí sería XSS.
const MAPS_OK = /^https:\/\/(www\.google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl\/maps)/i;

function linkMaps(business) {
  if (!business) return null;
  if (business.mapsUrl && MAPS_OK.test(String(business.mapsUrl))) return business.mapsUrl;
  const dir = [business.address, business.city].filter(Boolean).join(', ');
  return dir ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(dir)}` : null;
}

function linkWhatsApp(business) {
  const wa = String(business.socialLinks?.whatsapp || business.phone || '').replace(/\D/g, '');
  if (!wa) return null;
  return `https://wa.me/${wa.startsWith('54') ? wa : '549' + wa}`;
}

export default function FichaBarberia({ business, variant = 'compacta', services = [] }) {
  if (!business) return null;
  const maps = linkMaps(business);
  const direccion = [business.address, business.city].filter(Boolean).join(', ');
  const ig = String(business.socialLinks?.instagram || '').replace(/^@/, '').trim();
  const wa = linkWhatsApp(business);
  const promos = services.filter((s) => s.isActive !== false && tieneVentana(s));

  if (!direccion && !business.welcomeMessage && !ig && !wa) return null;

  if (variant === 'compacta') {
    return (
      <div className="ficha-barberia ficha-compacta">
        {business.welcomeMessage && <p className="ficha-presentacion">{business.welcomeMessage}</p>}
        <div className="ficha-datos">
          {direccion && (
            <span>
              📍 {direccion}
              {maps && <> · <a href={maps} target="_blank" rel="noreferrer">Cómo llegar</a></>}
            </span>
          )}
          {ig && <a href={`https://instagram.com/${ig}`} target="_blank" rel="noreferrer">📸 @{ig}</a>}
          {wa && <a href={wa} target="_blank" rel="noreferrer">💬 WhatsApp</a>}
          {promos.length > 0 && (
            <span>🏷️ {promos.length === 1 ? 'Hay una promo' : `Hay ${promos.length} promos`} en los servicios</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="card ficha-barberia">
      <h3 style={{ marginBottom: 6 }}>{business.name}</h3>
      {business.welcomeMessage && <p className="text-secondary" style={{ marginBottom: 10 }}>{business.welcomeMessage}</p>}
      {direccion && <p style={{ marginBottom: 6 }}>📍 {direccion}</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        {maps && <a className="btn btn-primary btn-sm" href={maps} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>🗺️ Cómo llegar</a>}
        {wa && <a className="btn btn-outline btn-sm" href={wa} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>💬 WhatsApp</a>}
        {ig && <a className="btn btn-outline btn-sm" href={`https://instagram.com/${ig}`} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>📸 Instagram</a>}
      </div>
    </div>
  );
}
