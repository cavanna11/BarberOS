import { useMemo, useState } from 'react';
import { useTenant } from '../../hooks/useTenantData';
import { guardarAusencia, guardarAusencias, borrarAusencia } from '../../lib/repository';
import { errorDeAusencia, fechasEntre, proximas, idDeAusencia } from '../../utils/ausencias';
import { toDateString, formatDate } from '../../utils/dateUtils';

// ============================================================================
// "Este miércoles no voy"
// ============================================================================
// El horario semanal dice lo que pasa TODAS las semanas. Esto es la excepción
// de una sola vez, y existe porque la alternativa que la gente usaba era apagar
// el miércoles en su horario — y después había que acordarse de volver a
// prenderlo. El día que alguien se olvida, pierde todos los miércoles.
//
// Se guarda al toque, sin botón de guardar al final: cada ausencia es un
// documento propio y mezclarlas con el formulario del barbero (que sí tiene
// guardar/cancelar) haría que "Cancelar" pareciera deshacerlas.
//
// Los turnos ya reservados NO se tocan. Se muestran, con cuántos son, y los
// cancela el barbero desde Citas si corresponde: a cada cliente hay que
// avisarle, y eso lo decide una persona. Borrarlos en silencio sería lo peor
// que podría hacer esta pantalla.

const VIVOS = ['pendiente', 'confirmada'];

export default function AusenciasDelBarbero({ professionalId, businessId, compacto = false }) {
  const { ausencias, appointments } = useTenant();
  const hoy = toDateString(new Date());

  const [form, setForm] = useState({ fecha: '', variosDias: false, hastaFecha: '', soloUnRato: false, desde: '', hasta: '' });
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  const editar = (patch) => { setForm((f) => ({ ...f, ...patch })); setError(''); };

  const lista = useMemo(
    () => proximas(ausencias, professionalId, hoy),
    [ausencias, professionalId, hoy]
  );

  // Los turnos vivos que ya tiene en el día que está por marcar. Es el dato que
  // evita el "marqué que no voy y me olvidé de los tres que tenía".
  const turnosEseDia = useMemo(() => {
    if (!form.fecha) return [];
    return (appointments || []).filter(
      (a) => a && a.professionalId === professionalId && a.appointmentDate === form.fecha && VIVOS.includes(a.status)
    );
  }, [appointments, professionalId, form.fecha]);

  const marcar = async () => {
    const franja = form.soloUnRato ? { desde: form.desde, hasta: form.hasta } : { desde: null, hasta: null };
    const malo = errorDeAusencia({ fecha: form.fecha, ...franja });
    if (malo) return setError(malo);

    const fechas = form.variosDias && form.hastaFecha
      ? fechasEntre(form.fecha, form.hastaFecha)
      : [form.fecha];
    if (!fechas.length) return setError('La fecha de fin tiene que ser posterior a la de inicio.');

    setGuardando(true);
    try {
      if (fechas.length === 1) {
        await guardarAusencia(businessId, { professionalId, fecha: fechas[0], ...franja });
      } else {
        await guardarAusencias(businessId, professionalId, fechas, franja);
      }
      setForm({ fecha: '', variosDias: false, hastaFecha: '', soloUnRato: false, desde: '', hasta: '' });
    } catch (e) {
      setError(e?.message || 'No se pudo guardar.');
    } finally {
      setGuardando(false);
    }
  };

  const sacar = async (a) => {
    try {
      await borrarAusencia(businessId, a.id || idDeAusencia(a.professionalId, a.fecha, a.desde));
    } catch (e) {
      setError(e?.message || 'No se pudo borrar.');
    }
  };

  return (
    <div className="ausencias">
      {!compacto && (
        <p className="text-secondary text-sm mb-md">
          Para el día suelto que no vas a estar. Tu horario semanal no se toca: la semana que
          viene seguís trabajando igual, sin tener que acordarte de volver a prenderlo.
        </p>
      )}

      {lista.length > 0 && (
        <ul className="ausencias-lista">
          {lista.map((a) => (
            <li key={a.id || idDeAusencia(a.professionalId, a.fecha, a.desde)}>
              <span>
                <strong>{formatDate(a.fecha)}</strong>{' '}
                <span className="text-muted">
                  {a.desde && a.hasta ? `de ${a.desde} a ${a.hasta}` : 'todo el día'}
                </span>
              </span>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => sacar(a)}>
                Vuelvo ese día
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="ausencias-form">
        <div className="form-group">
          <label className="form-label">¿Qué día no vas a estar?</label>
          <input
            type="date"
            className="form-input"
            min={hoy}
            value={form.fecha}
            onChange={(e) => editar({ fecha: e.target.value })}
          />
        </div>

        <label className="ausencias-check">
          <input
            type="checkbox"
            checked={form.variosDias}
            onChange={(e) => editar({ variosDias: e.target.checked, hastaFecha: '' })}
          />
          <span>Varios días seguidos (vacaciones)</span>
        </label>

        {form.variosDias && (
          <div className="form-group">
            <label className="form-label">Hasta qué día</label>
            <input
              type="date"
              className="form-input"
              min={form.fecha || hoy}
              value={form.hastaFecha}
              onChange={(e) => editar({ hastaFecha: e.target.value })}
            />
          </div>
        )}

        <label className="ausencias-check">
          <input
            type="checkbox"
            checked={form.soloUnRato}
            onChange={(e) => editar({ soloUnRato: e.target.checked, desde: '', hasta: '' })}
          />
          <span>Falto solo un rato, no todo el día</span>
        </label>

        {form.soloUnRato && (
          <div className="ausencias-franja">
            <div className="form-group">
              <label className="form-label">Desde</label>
              <input type="time" className="form-input" value={form.desde}
                onChange={(e) => editar({ desde: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Hasta</label>
              <input type="time" className="form-input" value={form.hasta}
                onChange={(e) => editar({ hasta: e.target.value })} />
            </div>
          </div>
        )}

        {turnosEseDia.length > 0 && (
          <div className="notice notice-warn">
            <strong>Ya tenés {turnosEseDia.length} turno{turnosEseDia.length === 1 ? '' : 's'} ese día.</strong>
            <p className="text-sm" style={{ margin: '6px 0 0' }}>
              No se cancelan solos: marcar la ausencia saca los horarios LIBRES de la grilla, pero
              los que ya reservaron siguen ahí. Avisales y cancelalos desde <strong>Turnos</strong>.
            </p>
          </div>
        )}

        {error && <div className="notice notice-danger">{error}</div>}

        <button type="button" className="btn btn-primary" onClick={marcar} disabled={guardando || !form.fecha}>
          {guardando ? 'Guardando…' : 'Marcar que no voy'}
        </button>
      </div>
    </div>
  );
}
