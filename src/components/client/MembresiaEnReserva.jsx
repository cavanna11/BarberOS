import { fechaLarga } from '../../utils/membresias';

// ============================================================================
// La membresía del cliente, en el último paso de la reserva
// ============================================================================
// El cliente que tiene un plan decide ACÁ, desde su cuenta, si este turno lo
// cubre la membresía. Es la única forma de usarla al reservar: el barbero no
// tiene un botón para hacerlo por él (y el servidor lo vuelve a validar todo).
//
// Lo que se muestra es una vista previa con los datos del mes de hoy. Si algo
// cambió en el medio (se le acabaron los usos en otra reserva, se cayó el
// pago), `createAppointment` rechaza con el motivo y no reserva a precio de
// lista sin avisarle.

export default function MembresiaEnReserva({ membresia, cobertura, usar, onUsar }) {
  if (!membresia) return null;

  if (!membresia.usable) {
    return (
      <div className="notice notice-info membresia-reserva">
        🪪 <strong>Tu membresía {membresia.planNombre} no está activa</strong>. Este turno se reserva como un turno normal.
      </div>
    );
  }

  if (!cobertura) {
    return (
      <div className="notice notice-info membresia-reserva">
        🪪 Tenés una membresía activa, pero <strong>este servicio no está incluido en tu plan</strong>. Se reserva como un turno normal.
      </div>
    );
  }

  if (cobertura.fueraDeFecha) {
    const hasta = membresia.periodosPagos?.at(-1)?.hasta;
    return (
      <div className="notice notice-info membresia-reserva">
        🪪 Tu membresía cubre turnos hasta el <strong>{fechaLarga(hasta)}</strong>. Para esta fecha, reservá cuando se renueve o pagalo normal.
      </div>
    );
  }

  if (cobertura.restantes === 0) {
    return (
      <div className="notice notice-warn membresia-reserva">
        🪪 <strong>No quedan usos disponibles este mes</strong> de tu {membresia.planNombre}. Este turno se reserva como un turno normal.
      </div>
    );
  }

  return (
    <label className={`card membresia-reserva membresia-reserva-opcion ${usar ? 'activa' : ''}`}>
      <input type="checkbox" checked={usar} onChange={(e) => onUsar(e.target.checked)} />
      <span>
        <strong>Usar mi membresía</strong>
        <span className="badge badge-success" style={{ marginLeft: 8 }}>Membresía activa</span>
        <div className="text-sm">Este servicio está incluido en tu plan <strong>{membresia.planNombre}</strong>.</div>
        {cobertura.restantes != null && (
          <div className="text-sm text-secondary">
            {cobertura.restantes === 1 ? 'Te queda 1 uso' : `Te quedan ${cobertura.restantes} usos`} de {cobertura.beneficio.nombre} este mes
            {usar ? ' (este turno usa uno).' : '.'}
          </div>
        )}
        {cobertura.restantes == null && cobertura.beneficio.usos == null && (
          <div className="text-sm text-secondary">{cobertura.beneficio.nombre} ilimitado en tu plan.</div>
        )}
        {!usar && <div className="text-sm text-secondary">Sin marcarla, el turno se paga normalmente.</div>}
      </span>
    </label>
  );
}
