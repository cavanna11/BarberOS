import { useState } from 'react';
import { formatPrice } from '../../utils/dateUtils';
import { historialPorMes, nombreDeMes, mesActual } from '../../utils/ingresos';

/**
 * Lo facturado mes por mes, del más nuevo al más viejo.
 *
 * Arranca mostrando los últimos seis y se despliega: el dueño que entra quiere
 * ver cómo viene el mes y cómo venía el anterior, no una tabla de dos años que
 * le empuja la agenda abajo del pliegue.
 *
 * El total histórico que el panel ya mostraba no se va a ningún lado: queda en
 * el pie de esta misma tarjeta, que es donde se entiende de qué suma sale.
 */
export default function HistorialIngresos({ appointments = [], currency, titulo = 'Historial de ingresos' }) {
  const [todos, setTodos] = useState(false);
  const historial = historialPorMes(appointments);
  const esteMes = mesActual();

  if (historial.length === 0) {
    return (
      <div className="card" style={{ padding: 'var(--space-md)' }}>
        <h3>{titulo}</h3>
        <p className="text-secondary" style={{ fontSize: 13, marginTop: 8 }}>
          Todavía no hay turnos completados. Cuando marques el primero como
          <strong> Vino</strong>, el mes empieza a sumar acá.
        </p>
      </div>
    );
  }

  const maximo = Math.max(...historial.map((m) => m.total), 1);
  const visibles = todos ? historial : historial.slice(0, 6);
  const total = historial.reduce((suma, m) => suma + m.total, 0);
  const turnos = historial.reduce((suma, m) => suma + m.count, 0);

  return (
    <div className="card" style={{ padding: 'var(--space-md)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <h3>{titulo}</h3>
        <span className="text-muted" style={{ fontSize: 12 }}>
          {historial.length} {historial.length === 1 ? 'mes' : 'meses'} con movimiento
        </span>
      </div>

      <div style={{ marginTop: 'var(--space-md)' }}>
        {visibles.map((m) => (
          <div key={m.mes} className="revenue-bar-item">
            <div className="revenue-bar-header">
              <span style={{ fontWeight: m.mes === esteMes ? 700 : 400 }}>
                {nombreDeMes(m.mes)}
                {m.mes === esteMes && (
                  <span className="badge badge-primary" style={{ fontSize: 10, marginLeft: 6 }}>en curso</span>
                )}
              </span>
              <span className="text-secondary">
                {formatPrice(m.total, currency)} ({m.count} {m.count === 1 ? 'turno' : 'turnos'})
              </span>
            </div>
            <div className="revenue-bar-track">
              <div className="revenue-bar-fill" style={{ width: `${(m.total / maximo) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>

      {historial.length > 6 && (
        <button className="btn btn-outline btn-sm" onClick={() => setTodos(!todos)} style={{ marginTop: 4 }}>
          {todos ? 'Ver solo los últimos 6 meses' : `Ver los ${historial.length} meses`}
        </button>
      )}

      <div
        style={{
          marginTop: 'var(--space-md)',
          paddingTop: 'var(--space-sm)',
          borderTop: '1px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'space-between',
          gap: 8,
          flexWrap: 'wrap',
          fontSize: 13,
        }}
      >
        <span className="text-secondary">Total histórico</span>
        <strong>
          {formatPrice(total, currency)} · {turnos} {turnos === 1 ? 'turno' : 'turnos'}
        </strong>
      </div>
    </div>
  );
}
