import { ESTADOS_MEMBRESIA, ESTADOS_USO, fechaCorta, fechaLarga } from '../../utils/membresias';

// ============================================================================
// "Mi membresía", arriba de Mis Citas
// ============================================================================
// Plan, estado, hasta cuándo está pago, cuántos usos le quedan y los últimos
// usos. Que el cliente vea sus usos no es un detalle: es el control natural
// contra un uso que él no hizo. Si le aparece un corte que no se cortó, lo va a
// decir.

export default function MiMembresia({ membresia, usos = [] }) {
  if (!membresia) return null;
  const estado = ESTADOS_MEMBRESIA[membresia.estado] || { label: membresia.estado, clase: 'badge-neutral' };
  const p = membresia.periodo;

  return (
    <div className="card mi-membresia">
      <div className="mi-membresia-cabecera">
        <div>
          <div className="text-xs text-muted">MI MEMBRESÍA</div>
          <h3>{membresia.planNombre}</h3>
        </div>
        <span className={`badge ${estado.clase}`}>{estado.label}</span>
      </div>

      {membresia.usable && p ? (
        <>
          <p className="text-sm text-secondary">
            {membresia.estado === 'activa' ? 'Tenés una membresía activa.' : 'Tu membresía no se renueva, pero lo que pagaste lo usás igual.'}
            {' '}Cubre turnos hasta el <strong>{fechaLarga(membresia.periodosPagos?.at(-1)?.hasta || p.hasta)}</strong>.
          </p>
          <div className="mi-membresia-beneficios">
            {p.beneficios.map((b) => (
              <div key={b.id} className="mi-membresia-beneficio">
                <span>{b.nombre}</span>
                <strong>
                  {b.usos == null
                    ? 'Ilimitado'
                    : `Te quedan ${Math.max(0, b.usos - b.usados)} de ${b.usos}`}
                </strong>
              </div>
            ))}
            {p.usosTotales != null && (
              <div className="mi-membresia-beneficio">
                <span>En total este mes</span>
                <strong>{p.usados} de {p.usosTotales}</strong>
              </div>
            )}
          </div>
          <p className="text-xs text-muted">Este mes: del {fechaCorta(p.desde)} al {fechaCorta(p.hasta)}.</p>
        </>
      ) : (
        <p className="text-sm text-secondary">
          {membresia.estado === 'pendiente'
            ? 'Todavía no se registró el primer pago.'
            : membresia.estado === 'pago_rechazado'
              ? 'No se pudo cobrar la cuota de este mes. Si ya lo resolviste, se activa sola cuando entre el pago.'
              : 'Tu membresía no está activa. Consultá en la barbería para renovarla.'}
        </p>
      )}

      {usos.length > 0 && (
        <details className="mi-membresia-usos">
          <summary className="text-sm">Últimos usos</summary>
          {usos.map((u) => (
            <div key={u.appointmentId} className="text-sm membresia-uso">
              <span>{fechaCorta(u.appointmentDate)} · {u.serviceName}</span>
              <span className="text-muted">{ESTADOS_USO[u.estado]?.label || u.estado}</span>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
