// ============================================================================
// "¿A qué sucursal querés ir?" — el paso cero de la reserva
// ============================================================================
// Una cuenta empresarial tiene hasta cuatro barberías, y cada una tiene su
// propio link. Pero el cliente que recibe UN link por Instagram no sabe que hay
// otras tres, y el que recibe el de la sucursal equivocada reservaba ahí sin
// enterarse: los barberos, los servicios y los horarios son los de ESE local.
//
// Entonces, antes de elegir barbero, se pregunta a qué sucursal va. Con el
// nombre y la dirección, que es lo que decide: "la que me queda cerca".
//
// Se pregunta UNA vez por visita (queda anotado en el navegador, ver
// `useSucursalesPublicas`): el que ya eligió sigue reservando sin que se le
// pregunte de nuevo, y tiene "cambiar de sucursal" a mano en el primer paso.

function direccionDe(s) {
  return [s.address, s.city].filter(Boolean).join(', ');
}

export default function ElegirSucursal({ sucursales, actualId, onElegir }) {
  // Una sucursal suspendida por falta de pago no toma turnos: se muestra igual
  // —existe, y el cliente puede estar buscándola— pero sin poder elegirla.
  const abierta = (s) => !s.isFrozen && s.onlineBookingEnabled !== false;

  return (
    <div className="elegir-sucursal">
      <h2 className="booking-step-title">Elegí tu sucursal</h2>
      <p className="booking-step-subtitle">
        Esta barbería tiene {sucursales.length} locales. Cada uno con su equipo y sus horarios.
      </p>

      <div className="sucursales-publicas">
        {sucursales.map((s) => {
          const direccion = direccionDe(s);
          const disponible = abierta(s);
          return (
            <button
              key={s.id}
              type="button"
              className={`card card-selectable sucursal-publica ${s.id === actualId ? 'card-selected' : ''}`}
              onClick={() => disponible && onElegir(s)}
              disabled={!disponible}
              title={disponible ? `Reservar en ${s.name}` : 'Esta sucursal no está tomando turnos'}
            >
              <div className="sucursal-publica-nombre">
                {s.logoUrl && <img src={s.logoUrl} alt="" className="sucursal-publica-logo" />}
                <strong>{s.name}</strong>
                {s.id === actualId && <span className="badge badge-neutral" style={{ fontSize: 10 }}>estás acá</span>}
              </div>

              {direccion ? (
                <div className="sucursal-publica-dato">📍 {direccion}</div>
              ) : (
                <div className="sucursal-publica-dato text-muted">Sin dirección cargada</div>
              )}

              {s.phone && <div className="sucursal-publica-dato">📞 {s.phone}</div>}

              {!disponible && (
                <div className="sucursal-publica-cerrada">No está tomando turnos</div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
