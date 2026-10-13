import {
  INTERVALO_MIN, INTERVALO_MAX, normalizarIntervalo,
  diagnosticoDelIntervalo, turnosQueEntran, jornadaSemanal,
} from '../../utils/intervalo';

// ============================================================================
// "Cada cuánto se ofrece un turno" — el número y el consejo
// ============================================================================
// Antes era un desplegable con cuatro opciones (15, 30, 45, 60). Dos problemas:
// el barbero no podía poner el suyo, y sobre todo nadie le decía que el número
// que tenía puesto le estaba costando horas.
//
// El caso que lo destapó: corte clásico 20 minutos, degradé 40, grilla cada 30.
// Medido con el motor sobre una jornada de 09:00 a 20:00 con 15 turnos: con 30
// se pierden 200 minutos y el día termina 19:20; con 20 se pierde CERO y el
// mismo trabajo termina 16:00.
//
// El problema no es tener servicios de distinta duración: es que 30 no divide
// ni a 20 ni a 40. Por eso acá no alcanza con dejar escribir el número — hay
// que mostrar la cuenta. Un número suelto no se puede decidir bien.

function Aviso({ tipo, children }) {
  return <div className={`notice notice-${tipo} intervalo-aviso`}>{children}</div>;
}

export default function IntervaloDeTurnos({ valor, servicios = [], businessHours = [], onChange }) {
  const intervalo = normalizarIntervalo(valor);
  const d = diagnosticoDelIntervalo(servicios, intervalo);

  // La jornada real del local, para decir "entran X turnos" con su horario y no
  // con uno inventado. Si todavía no cargó horario, se cae a una semana típica.
  const semana = jornadaSemanal(businessHours) || 3300;
  const dia = Math.round(semana / Math.max(1, businessHours.filter((x) => x?.isActive !== false).length || 6));

  return (
    <div className="form-group">
      <label className="form-label" htmlFor="slotInterval">Cada cuánto se ofrece un turno</label>

      <div className="intervalo-campo">
        <input
          id="slotInterval"
          type="number"
          className="form-input"
          min={INTERVALO_MIN}
          max={INTERVALO_MAX}
          step={5}
          value={valor ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          // Al salir del campo se acomoda a un valor usable. Un 0 escrito acá
          // haría que el motor no termine nunca de armar la grilla.
          onBlur={(e) => onChange(normalizarIntervalo(e.target.value))}
        />
        <span className="intervalo-unidad">minutos</span>
      </div>

      <p className="text-sm text-muted" style={{ marginTop: 6 }}>
        Es el paso de la grilla que ve el cliente. Con {intervalo}, ve los horarios de a {intervalo} minutos.
        La duración de cada turno la define el servicio.
      </p>

      {d.estado === 'mejorable' && (
        <Aviso tipo="warn">
          <strong>Estás perdiendo tiempo entre turno y turno.</strong>
          <p className="text-sm" style={{ margin: '6px 0' }}>
            Tu grilla va cada {intervalo} minutos, pero tus servicios no duran múltiplos de {intervalo}.
            Cada turno termina en un minuto que no está en la grilla y el siguiente tiene que esperar:
          </p>
          <ul className="intervalo-perdidas">
            {d.perdidas.map((p) => (
              <li key={p.id}>
                <span>{p.name} <span className="text-muted">({p.duracion} min)</span></span>
                <strong>+{p.desperdicio} min muertos</strong>
              </li>
            ))}
          </ul>
          <p className="text-sm" style={{ margin: '8px 0 10px' }}>
            Con la grilla <strong>cada {d.sugerido} minutos</strong> no se pierde ninguno.
            {d.perdidas[0] && (
              <> En un día de {Math.round(dia / 60)} horas te entran{' '}
                <strong>{turnosQueEntran(d.perdidas[0].duracion, d.sugerido, dia)} turnos</strong>
                {' '}de {d.perdidas[0].name} en vez de{' '}
                {turnosQueEntran(d.perdidas[0].duracion, intervalo, dia)}.</>
            )}
          </p>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => onChange(d.sugerido)}>
            Usar {d.sugerido} minutos
          </button>
        </Aviso>
      )}

      {d.estado === 'desalineados' && (
        <Aviso tipo="warn">
          <strong>Tus servicios no se llevan bien entre ellos.</strong>
          <p className="text-sm" style={{ margin: '6px 0' }}>
            Duran {d.duraciones.join(', ')} minutos, y no hay ninguna grilla razonable que les cierre a
            todos: con {intervalo} cada turno deja minutos muertos.
          </p>
          <ul className="intervalo-perdidas">
            {d.perdidas.filter((p) => p.desperdicio > 0).map((p) => (
              <li key={p.id}>
                <span>{p.name} <span className="text-muted">({p.duracion} min)</span></span>
                <strong>+{p.desperdicio} min muertos</strong>
              </li>
            ))}
          </ul>
          <p className="text-sm" style={{ marginTop: 8 }}>
            Lo que conviene acá no es achicar la grilla —te quedarían decenas de horarios para
            elegir— sino <strong>redondear las duraciones</strong> en Servicios para que todas sean
            múltiplos de un mismo número (20, 15 o 10).
          </p>
        </Aviso>
      )}

      {d.estado === 'muy-fino' && (
        <Aviso tipo="info">
          <strong>Podés agrandar la grilla sin perder nada.</strong>
          <p className="text-sm" style={{ margin: '6px 0' }}>
            Con {intervalo} minutos no se pierde tiempo entre turnos, pero tampoco hace falta ir
            tan fino: tus servicios duran {d.duraciones.join(', ')} minutos y con{' '}
            <strong>{d.sugerido}</strong> pasa exactamente lo mismo.
          </p>
          <p className="text-sm" style={{ margin: '0 0 6px' }}>
            Dos cosas mejoran: el cliente ve{' '}
            <strong>{Math.floor(dia / d.sugerido)} horarios</strong> en vez de {Math.floor(dia / intervalo)}
            {' '}—una lista que se lee—, y se achica el riesgo de que entre turno y turno te queden
            huecos de {intervalo} minutos donde no entra ningún servicio.
          </p>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => onChange(d.sugerido)}>
            Usar {d.sugerido} minutos
          </button>
        </Aviso>
      )}

      {d.estado === 'ok' && (
        <Aviso tipo="success">
          <strong>Tu grilla aprovecha bien tus servicios.</strong>
          <p className="text-sm" style={{ marginTop: 4 }}>
            Duran {d.duraciones.join(', ')} minutos y todos son múltiplos de {intervalo}:
            un turno termina justo donde puede empezar el siguiente, sin tiempo muerto.
          </p>
        </Aviso>
      )}
    </div>
  );
}
