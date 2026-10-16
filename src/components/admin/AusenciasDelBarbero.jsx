import { useMemo, useState } from 'react';
import { useTenant } from '../../hooks/useTenantData';
import {
  guardarAusencia,
  guardarAusencias,
  guardarHorarioEspecial,
  borrarAusencia,
} from '../../lib/repository';
import {
  errorDeAusencia,
  errorDeHorarioEspecial,
  fechasEntre,
  proximas,
  idDeAusencia,
  idDeHorarioEspecial,
  esHorarioEspecial,
} from '../../utils/ausencias';
import {
  toDateString,
  formatDate,
  getLocalDayOfWeek,
  getDayName,
  timeToMinutes,
} from '../../utils/dateUtils';

// ============================================================================
// Las excepciones de un día suelto
// ============================================================================
// El horario semanal dice lo que pasa TODAS las semanas. Acá van las dos
// excepciones de una sola vez, y existen porque la alternativa que la gente
// usaba era editar el horario semanal — y después había que acordarse de
// volver a dejarlo como estaba. El día que alguien se olvida, pierde todos los
// miércoles.
//
//   "Este miércoles no voy"        ausencia (día completo o un rato)
//   "Mañana trabajo de 10 a 13"    horario especial de ese día
//
// Lo segundo lo pidió Santiago el 16/10/2026: "mañana tengo un barbero que
// solo por la mañana va a trabajar de 10 a 1, el resto de los días normal, y
// no hay una opción para poner eso: está la de poner en qué momento no vas a
// estar, pero no la de poner tal día hago este horario".
//
// Son dos formas de decir lo mismo y por debajo se guardan en la misma
// colección (ver `utils/ausencias.js`), pero se piden distinto a propósito: la
// cuenta de "trabajo de 10 a 13" se puede hacer sola, y pedirle al barbero que
// la haga —cargar que falta de 09:00 a 10:00 y de 13:00 a 20:00— es pedirle que
// traduzca lo que quiere. Dos ausencias donde él piensa un horario.
//
// Se guarda al toque, sin botón de guardar al final: cada excepción es un
// documento propio y mezclarlas con el formulario del barbero (que sí tiene
// guardar/cancelar) haría que "Cancelar" pareciera deshacerlas.
//
// Los turnos ya reservados NO se tocan. Se muestran, con cuántos son, y los
// cancela el barbero desde Citas si corresponde: a cada cliente hay que
// avisarle, y eso lo decide una persona. Borrarlos en silencio sería lo peor
// que podría hacer esta pantalla.

const VIVOS = ['pendiente', 'confirmada'];

const FORM_VACIO = {
  fecha: '',
  variosDias: false,
  hastaFecha: '',
  soloUnRato: false,
  desde: '',
  hasta: '',
  trabajaDesde: '',
  trabajaHasta: '',
};

export default function AusenciasDelBarbero({ professionalId, businessId, compacto = false }) {
  const { ausencias, appointments, schedules } = useTenant();
  const hoy = toDateString(new Date());

  const [modo, setModo] = useState('falta'); // 'falta' | 'horario'
  const [form, setForm] = useState(FORM_VACIO);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  const editar = (patch) => { setForm((f) => ({ ...f, ...patch })); setError(''); };
  const cambiarModo = (m) => { setModo(m); setForm(FORM_VACIO); setError(''); };

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

  // ── Lo que ese día dice su horario semanal ────────────────────────────────
  // Hace falta para no dejarlo guardar algo que no abre un solo turno: el
  // horario especial RECORTA el semanal, nunca lo agranda.
  const horarioSemanal = useMemo(() => {
    if (!form.fecha) return null;
    const dow = getLocalDayOfWeek(new Date(`${form.fecha}T00:00:00`));
    const s = (schedules || []).find(
      (x) => x && x.professionalId === professionalId && x.dayOfWeek === dow && x.isActive
    );
    return { dow, dia: getDayName(dow), schedule: s || null };
  }, [schedules, professionalId, form.fecha]);

  /** ¿Ya marcó que ese día no viene? El horario especial no le gana a eso. */
  const faltaTodoEseDia = useMemo(() => (ausencias || []).some(
    (a) => a && a.professionalId === professionalId && a.fecha === form.fecha
      && !esHorarioEspecial(a) && (!a.desde || !a.hasta)
  ), [ausencias, professionalId, form.fecha]);

  /**
   * Qué va a pasar de verdad si guarda este horario especial.
   *
   * Se calcula y se muestra ANTES de guardar. Un día prendido en el calendario
   * sin un solo horario adentro es el síntoma más mudo que tiene este sistema:
   * el cliente entra, lo encuentra vacío y nadie se enteró de nada.
   */
  const avisoHorario = useMemo(() => {
    if (modo !== 'horario' || !form.fecha || !horarioSemanal) return null;
    const { dia, schedule } = horarioSemanal;

    if (!schedule || !schedule.startTime || !schedule.endTime) {
      return {
        tono: 'danger',
        texto: `Los ${dia.toLowerCase()} no tenés horario cargado, así que esto no va a abrir ningún turno. Para trabajar un día que normalmente librás, cargá ese día en tu horario semanal.`,
      };
    }
    if (!form.trabajaDesde || !form.trabajaHasta) return null;

    const abre = timeToMinutes(form.trabajaDesde);
    const cierra = timeToMinutes(form.trabajaHasta);
    if (!Number.isFinite(abre) || !Number.isFinite(cierra) || cierra <= abre) return null;

    const desde = Math.max(abre, timeToMinutes(schedule.startTime));
    const hasta = Math.min(cierra, timeToMinutes(schedule.endTime));

    if (desde >= hasta) {
      return {
        tono: 'danger',
        texto: `Los ${dia.toLowerCase()} atendés de ${schedule.startTime} a ${schedule.endTime}. De ${form.trabajaDesde} a ${form.trabajaHasta} no se cruza con eso, así que ese día no quedaría ni un turno. Si ese día vas a trabajar en otra franja, cambialo en tu horario semanal.`,
      };
    }
    if (desde > abre || hasta < cierra) {
      return {
        tono: 'warn',
        texto: `Los ${dia.toLowerCase()} atendés de ${schedule.startTime} a ${schedule.endTime}, así que ese día tus clientes van a ver turnos entre ${minutosAHora(desde)} y ${minutosAHora(hasta)}. Un horario especial solo recorta el semanal.`,
      };
    }
    return {
      tono: 'info',
      texto: `Ese día tus clientes van a ver turnos entre ${form.trabajaDesde} y ${form.trabajaHasta}. El último tiene que terminar antes de las ${form.trabajaHasta}, así que a esa hora ya estás libre.`,
    };
  }, [modo, form.fecha, form.trabajaDesde, form.trabajaHasta, horarioSemanal]);

  /** Los turnos ya reservados que quedarían afuera del horario especial. */
  const turnosAfuera = useMemo(() => {
    if (modo !== 'horario' || !form.trabajaDesde || !form.trabajaHasta) return [];
    const abre = timeToMinutes(form.trabajaDesde);
    const cierra = timeToMinutes(form.trabajaHasta);
    if (!Number.isFinite(abre) || !Number.isFinite(cierra) || cierra <= abre) return [];
    return turnosEseDia.filter((a) => {
      const i = timeToMinutes(a.startTime);
      const f = timeToMinutes(a.endTime || a.startTime);
      return !Number.isFinite(i) || i < abre || f > cierra;
    });
  }, [modo, turnosEseDia, form.trabajaDesde, form.trabajaHasta]);

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
      setForm(FORM_VACIO);
    } catch (e) {
      setError(e?.message || 'No se pudo guardar.');
    } finally {
      setGuardando(false);
    }
  };

  const guardarHorario = async () => {
    const malo = errorDeHorarioEspecial({
      fecha: form.fecha,
      trabajaDesde: form.trabajaDesde,
      trabajaHasta: form.trabajaHasta,
    });
    if (malo) return setError(malo);

    setGuardando(true);
    try {
      await guardarHorarioEspecial(businessId, {
        professionalId,
        fecha: form.fecha,
        trabajaDesde: form.trabajaDesde,
        trabajaHasta: form.trabajaHasta,
      });
      setForm(FORM_VACIO);
    } catch (e) {
      setError(e?.message || 'No se pudo guardar.');
    } finally {
      setGuardando(false);
    }
  };

  const sacar = async (a) => {
    try {
      const id = a.id || (esHorarioEspecial(a)
        ? idDeHorarioEspecial(a.professionalId, a.fecha)
        : idDeAusencia(a.professionalId, a.fecha, a.desde));
      await borrarAusencia(businessId, id);
    } catch (e) {
      setError(e?.message || 'No se pudo borrar.');
    }
  };

  return (
    <div className="ausencias">
      {!compacto && (
        <p className="text-secondary text-sm mb-md">
          Para el día suelto en que no vas a estar, o en que vas a hacer otro horario. Tu horario
          semanal no se toca: la semana que viene seguís trabajando igual, sin tener que acordarte
          de volver a dejarlo como estaba.
        </p>
      )}

      {lista.length > 0 && (
        <ul className="ausencias-lista">
          {lista.map((a) => (
            <li key={a.id || (esHorarioEspecial(a)
              ? idDeHorarioEspecial(a.professionalId, a.fecha)
              : idDeAusencia(a.professionalId, a.fecha, a.desde))}>
              <span>
                <strong>{formatDate(a.fecha)}</strong>{' '}
                {esHorarioEspecial(a) ? (
                  <span className="text-muted">
                    trabaja de {a.trabajaDesde} a {a.trabajaHasta}
                  </span>
                ) : (
                  <span className="text-muted">
                    {a.desde && a.hasta ? `no está de ${a.desde} a ${a.hasta}` : 'no viene'}
                  </span>
                )}
              </span>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => sacar(a)}>
                {esHorarioEspecial(a) ? 'Horario de siempre' : 'Vuelvo ese día'}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="ausencias-modos" role="group">
        <button
          type="button"
          className={`btn btn-sm ${modo === 'falta' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => cambiarModo('falta')}
        >
          No voy a estar
        </button>
        <button
          type="button"
          className={`btn btn-sm ${modo === 'horario' ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => cambiarModo('horario')}
        >
          Ese día hago otro horario
        </button>
      </div>

      <div className="ausencias-form">
        <div className="form-group">
          <label className="form-label">
            {modo === 'falta' ? '¿Qué día no vas a estar?' : '¿Qué día vas a hacer otro horario?'}
          </label>
          <input
            type="date"
            className="form-input"
            min={hoy}
            value={form.fecha}
            onChange={(e) => editar({ fecha: e.target.value })}
          />
        </div>

        {modo === 'falta' ? (
          <>
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
          </>
        ) : (
          <>
            <div className="ausencias-franja">
              <div className="form-group">
                <label className="form-label">Ese día trabajás desde</label>
                <input type="time" className="form-input" value={form.trabajaDesde}
                  onChange={(e) => editar({ trabajaDesde: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Hasta</label>
                <input type="time" className="form-input" value={form.trabajaHasta}
                  onChange={(e) => editar({ trabajaHasta: e.target.value })} />
              </div>
            </div>

            {faltaTodoEseDia && (
              <div className="notice notice-danger">
                <strong>Ese día ya está marcado como que no vas.</strong>
                <p className="text-sm" style={{ margin: '6px 0 0' }}>
                  Mientras esté marcado no se ofrece ningún turno, aunque cargues un horario
                  especial. Si ese día sí vas a ir, tocá <strong>Vuelvo ese día</strong> en la lista
                  de arriba.
                </p>
              </div>
            )}

            {avisoHorario && (
              <div className={`notice notice-${avisoHorario.tono}`}>{avisoHorario.texto}</div>
            )}

            {turnosAfuera.length > 0 && (
              <div className="notice notice-warn">
                <strong>
                  {turnosAfuera.length} de tus {turnosEseDia.length} turno
                  {turnosEseDia.length === 1 ? '' : 's'} de ese día quedan fuera de ese horario
                  ({turnosAfuera.map((a) => a.startTime).join(', ')}).
                </strong>
                <p className="text-sm" style={{ margin: '6px 0 0' }}>
                  No se cancelan solos: el horario especial saca los horarios LIBRES de la grilla,
                  pero los que ya reservaron siguen ahí. Avisales y cancelalos desde{' '}
                  <strong>Turnos</strong>.
                </p>
              </div>
            )}
          </>
        )}

        {error && <div className="notice notice-danger">{error}</div>}

        {modo === 'falta' ? (
          <button type="button" className="btn btn-primary" onClick={marcar} disabled={guardando || !form.fecha}>
            {guardando ? 'Guardando…' : 'Marcar que no voy'}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            onClick={guardarHorario}
            disabled={guardando || !form.fecha || !form.trabajaDesde || !form.trabajaHasta}
          >
            {guardando ? 'Guardando…' : 'Guardar el horario de ese día'}
          </button>
        )}
      </div>
    </div>
  );
}

/** Minutos desde medianoche → 'HH:MM'. Para los avisos, no para guardar. */
function minutosAHora(min) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}
