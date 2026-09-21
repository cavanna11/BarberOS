import { getDayName } from '../../utils/dateUtils';
import { avisoDelDia, corteSugerido, tieneCorte } from '../../utils/horarios';

/**
 * Editor de horario semanal, el mismo para el local (Configuración), para el
 * dueño cargando barberos (Profesionales) y para el barbero (Mi Configuración).
 *
 * Por día: prendido/apagado, desde, hasta, y opcionalmente "horario cortado":
 * "de 8 a 16 y de 19 a 22" es 08:00–22:00 con cierre 16:00 y vuelta 19:00.
 * Se guarda en breakStart/breakEnd, que el motor y el servidor ya respetan.
 *
 * `dias`: los 7 días en orden (0=Lunes). `onChange` recibe el array entero.
 */
export default function HorarioSemanal({ dias, onChange, nombreCorto = false }) {
  const cambiar = (idx, patch) => onChange(dias.map((d, i) => (i === idx ? { ...d, ...patch } : d)));

  return (
    <div className="schedule-grid">
      {dias.map((d, idx) => {
        const nombre = getDayName(d.dayOfWeek ?? idx);
        const aviso = avisoDelDia(d);
        const cortado = d.isActive && tieneCorte(d);
        return (
          <div key={idx} className={`schedule-day ${aviso ? 'con-aviso' : ''}`}>
            <div className="schedule-row">
              <label style={{ textTransform: 'capitalize' }}>{nombreCorto ? nombre.substring(0, 3) : nombre}</label>
              <button
                type="button"
                className={`schedule-toggle ${d.isActive ? 'active' : ''}`}
                onClick={() => cambiar(idx, { isActive: !d.isActive })}
                aria-label={`${d.isActive ? 'No atender' : 'Atender'} los ${nombre}`}
              />
              {d.isActive ? (
                <>
                  <input className="form-input" type="time" value={d.startTime || ''} onChange={(e) => cambiar(idx, { startTime: e.target.value })} aria-label={`${nombre}: abre`} />
                  <input className="form-input" type="time" value={d.endTime || ''} onChange={(e) => cambiar(idx, { endTime: e.target.value })} aria-label={`${nombre}: cierra`} />
                </>
              ) : (
                <>
                  <span className="text-muted text-sm">—</span>
                  <span className="text-muted text-sm">—</span>
                </>
              )}
            </div>

            {d.isActive && (cortado ? (
              <div className="schedule-corte">
                <span className="text-sm text-secondary">cierra</span>
                <input className="form-input" type="time" value={d.breakStart || ''} onChange={(e) => cambiar(idx, { breakStart: e.target.value })} aria-label={`${nombre}: cierra al mediodía`} />
                <span className="text-sm text-secondary">vuelve</span>
                <input className="form-input" type="time" value={d.breakEnd || ''} onChange={(e) => cambiar(idx, { breakEnd: e.target.value })} aria-label={`${nombre}: vuelve a abrir`} />
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => cambiar(idx, { breakStart: null, breakEnd: null })} aria-label={`Quitar el corte del ${nombre}`}>✕</button>
              </div>
            ) : (
              <button type="button" className="schedule-corte-agregar" onClick={() => cambiar(idx, corteSugerido(d))}>
                + Horario cortado
              </button>
            ))}

            {aviso && <p className="schedule-aviso">{aviso}</p>}
          </div>
        );
      })}
    </div>
  );
}
