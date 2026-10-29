// ============================================================================
// Los premios del cliente: la tarjeta de cada uno y el selector en la reserva
// ============================================================================
import { calcularPremio, describirPremio, premioUsableEn } from '../../utils/recompensas';
import { formatPrice } from '../../utils/dateUtils';
import { fechaCorta, paraQueServicios } from './movimiento';

const ESTADOS = {
  disponible: { label: 'Disponible', clase: 'badge-success' },
  reservado: { label: 'Reservado para un turno', clase: 'badge-warning' },
  usado: { label: 'Usado', clase: 'badge-neutral' },
  vencido: { label: 'Vencido', clase: 'badge-danger' },
};

const ORIGEN = {
  ruleta: 'Ganado en la ruleta',
  caja: 'De la caja sorpresa',
  rasca: 'De rasca y ganá',
  fidelidad: 'Por completar tu tarjeta',
  racha: 'Por tu racha',
  cumpleanos: 'Regalo de cumpleaños',
};

export function TarjetaPremio({ premio, services, onUsar }) {
  const est = ESTADOS[premio.estado] || ESTADOS.disponible;
  const apagado = premio.estado !== 'disponible';
  return (
    <article className={`premio-card ${apagado ? 'apagado' : ''} ${premio.nuevo ? 'nuevo' : ''}`}>
      <div className="premio-icono" style={{ background: apagado ? 'var(--bg-secondary)' : premio.color }} aria-hidden="true">
        {premio.icono || '🎁'}
      </div>
      <div className="premio-info">
        <h3 className="premio-nombre">{premio.nombre}</h3>
        <p className="premio-detalle">
          {premio.tipo === 'personalizado' ? 'Te lo dan en la barbería' : describirPremio(premio)}
          {' · '}{paraQueServicios(premio, services)}
        </p>
        <p className="premio-meta">
          <span className={`badge ${est.clase}`}>{est.label}</span>
          {premio.venceEn && premio.estado === 'disponible' && <span>Vence el {fechaCorta(premio.venceEn)}</span>}
          {ORIGEN[premio.campana] && <span>{ORIGEN[premio.campana]}</span>}
        </p>
      </div>
      {premio.estado === 'disponible' && onUsar && (
        <button type="button" className="btn btn-primary btn-sm premio-usar" onClick={() => onUsar(premio)}>
          Usar
        </button>
      )}
    </article>
  );
}

// ── El selector en la reserva ───────────────────────────────────────────────

/**
 * "Aplicar: ( ) Sin premio  (x) 10%" con el total que cambia en el momento.
 *
 * Muestra TODOS los premios disponibles, también los que no sirven para este
 * turno, apagados y con el motivo: si el corte gratis no aparece, el cliente
 * piensa que lo perdió.
 *
 * Es una vista previa; el que decide es `createAppointment`.
 */
export function PremioEnReserva({ premios = [], elegido, onElegir, serviceId, fecha, hoy, precio, currency, bloqueadoPor = null, services }) {
  const disponibles = premios.filter((p) => p.estado === 'disponible');
  if (!disponibles.length) return null;

  const filas = disponibles.map((p) => {
    const uso = premioUsableEn(p, { fecha, hoy });
    const calculo = calcularPremio(p, { precio, serviceId });
    let motivo = null;
    if (!uso.usable && uso.motivo === 'vence-antes') motivo = `Vale para turnos hasta el ${fechaCorta(p.venceEn)}`;
    else if (!uso.usable) motivo = 'No disponible';
    else if (!calculo.aplica) motivo = paraQueServicios(p, services);
    return { p, calculo, motivo };
  });

  return (
    <fieldset className="card mb-md premio-reserva">
      <legend className="premio-reserva-titulo">🎁 Tus premios</legend>
      {bloqueadoPor && (
        <p className="text-sm text-secondary" style={{ marginTop: 0 }}>
          Ya estás usando {bloqueadoPor}. Se usa un beneficio por turno.
        </p>
      )}
      <label className="pago-opcion">
        <input type="radio" name="premio" checked={!elegido} onChange={() => onElegir(null)} disabled={Boolean(bloqueadoPor)} />
        <span>
          <strong>Sin premio</strong>
          <div className="text-sm text-secondary">Lo guardás para otra vez. El servicio: {formatPrice(precio, currency)}</div>
        </span>
      </label>
      {filas.map(({ p, calculo, motivo }) => (
        <label key={p.id} className={`pago-opcion ${motivo ? 'deshabilitada' : ''}`}>
          <input
            type="radio"
            name="premio"
            checked={elegido === p.id}
            onChange={() => onElegir(p.id)}
            disabled={Boolean(motivo) || Boolean(bloqueadoPor)}
          />
          <span>
            <strong>{p.icono} {p.nombre}</strong>
            <div className="text-sm text-secondary">
              {motivo
                ? motivo
                : p.tipo === 'personalizado'
                  ? 'Te lo dan en la barbería ese día.'
                  : <>El servicio: <span className="cupon-tachado">{formatPrice(precio, currency)}</span> {formatPrice(calculo.precioFinal, currency)}</>}
            </div>
          </span>
        </label>
      ))}
      <p className="text-sm text-muted" style={{ margin: 'var(--space-sm) 0 0' }}>
        El premio se usa cuando te atienden. Si cancelás el turno, vuelve a tus premios.
      </p>
    </fieldset>
  );
}
