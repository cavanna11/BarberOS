import {
  INTERVALO_MIN, INTERVALO_MAX, normalizarIntervalo,
  diagnosticoDelIntervalo, desperdicioPorServicio, recomendacionAutomatica,
  DIAS_DE_HISTORIAL, TURNOS_MINIMOS,
} from '../../utils/intervalo';

// ============================================================================
// "Cada cuánto se ofrece un turno" — el número, y de dónde sacarlo
// ============================================================================
// Tres versiones de esta pantalla, y cada una existe por algo que pasó:
//
// 1. Un desplegable de cuatro opciones (15, 30, 45, 60). El barbero del corte
//    de 20 y el degradé de 40 no tenía su número.
// 2. Un campo libre con el consejo del MCD de las duraciones. Mejor, pero el
//    MCD trata a todos los servicios como si salieran igual — y a Volcado Club,
//    que tiene corte de 60 (el 90% de sus turnos) y barba de 30, le ofrecía el
//    botón para bajar la grilla a 30. Medido: le costaría ~22 minutos
//    vendibles por día.
// 3. Esta. El campo libre no se toca —el que ya lo configuró se queda con lo
//    suyo— y arriba se agrega el cálculo hecho con SUS turnos, que es la única
//    forma de saber qué servicio manda su día.
//
// Y una cosa más, que es la que motivó todo: el barbero no entiende qué es un
// "intervalo", y con razón, porque ya puso cuánto dura cada servicio. Así que
// acá no se le explica el concepto: se le muestra el resultado, "tus clientes
// ven 09:00, 10:00, 11:00". Eso no hay que explicarlo.

function Aviso({ tipo, children }) {
  return <div className={`notice notice-${tipo} intervalo-aviso`}>{children}</div>;
}

/** 1 de cada N, que es como un barbero cuenta. */
function unoDeCada(proporcion) {
  if (!(proporcion > 0)) return null;
  return Math.max(2, Math.round(1 / proporcion));
}

/** Los primeros horarios que va a ver el cliente, con el horario real del local. */
function horariosDeMuestra(businessHours = [], paso, cuantos = 4) {
  const dia = businessHours.find((d) => d && d.isActive !== false && d.startTime);
  const [h, m] = String(dia?.startTime || '09:00').split(':').map(Number);
  let t = (Number.isFinite(h) ? h : 9) * 60 + (Number.isFinite(m) ? m : 0);
  const salida = [];
  for (let i = 0; i < cuantos; i += 1) {
    salida.push(`${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
    t += paso;
  }
  return salida;
}

/**
 * Quién está tirando la grilla para abajo.
 *
 * El MCD lo decide el conjunto: basta UN servicio corto para que la grilla sana
 * baje de 30 a 10, y el barbero no tiene cómo saber cuál fue. Caso real: un
 * "Perfilado de cejas con navaja" de 10 minutos cargado como servicio suelto
 * entre cortes de 30 y 60. Casi siempre es algo que en la práctica se hace
 * JUNTO con el corte, o sea un adicional mal cargado.
 */
function Culpables({ culpables }) {
  if (!culpables?.length) return null;
  return (
    <p className="text-sm intervalo-culpables">
      {culpables.length === 1 ? 'El que te obliga a una grilla tan chica es ' : 'Los que te obligan a una grilla tan chica son '}
      {culpables.map((c, i) => (
        <span key={c.id}>
          {i > 0 && (i === culpables.length - 1 ? ' y ' : ', ')}
          <strong>{c.name}</strong> <span className="text-muted">({c.duracion} min)</span>
        </span>
      ))}
      . Sin {culpables.length === 1 ? 'ese' : 'esos'}, tu grilla sana sería de{' '}
      <strong>{culpables[0].grillaSinEl} minutos</strong>.{' '}
      Si {culpables.length === 1 ? 'es algo que hacés' : 'son cosas que hacés'} junto con el corte y no
      {culpables.length === 1 ? ' un turno aparte' : ' turnos aparte'}, marcalo como{' '}
      <strong>adicional</strong> en Servicios y deja de contar para la grilla.
    </p>
  );
}

/** Cómo llega el automático a su número. Cerrado por defecto: es la letra chica. */
function ComoLoCalcula() {
  return (
    <details className="intervalo-como">
      <summary>¿Cómo lo calcula?</summary>
      <div className="intervalo-como-cuerpo">
        <p className="text-sm">
          Cuenta cuántos turnos salieron de cada servicio en los últimos {DIAS_DE_HISTORIAL} días
          y pone la grilla en la duración del <strong>servicio que más te piden</strong>. Ese es
          la mayor parte de tu día, así que uno entra justo detrás del otro y no quedan minutos
          sueltos en el medio.
        </p>
        <p className="text-sm">
          Los que duran el doble o el triple también encajan solos: en una grilla de 30 minutos
          entra uno de 60 sin perder nada.
        </p>
        <p className="text-sm">
          Si hay un servicio que <em>no</em> encaja ahí y te sale <strong>más de 1 de cada 5
          turnos</strong>, baja la grilla a un número que les cierre a todos. Debajo de 1 de
          cada 5 no conviene: partir el día en pedazos más chicos para ese servicio te hace
          perder más horarios de los que te ahorra. Ese límite está medido simulando miles de
          días de reservas, no elegido a ojo.
        </p>
        <p className="text-sm text-muted">
          Hacen falta al menos {TURNOS_MINIMOS} turnos cargados. Con menos, un turno solo cambia
          la cuenta y no serviría de nada.
        </p>
      </div>
    </details>
  );
}

/**
 * El panel de arriba: el número que sale de los turnos reales.
 *
 * Cuando esto puede opinar, es lo ÚNICO que opina. El diagnóstico por MCD queda
 * para la barbería sin historial: si hablaran los dos a la vez se contradicen
 * —en Volcado uno diría 60 y el otro 30— y dos consejos opuestos en la misma
 * pantalla no son más información, son ninguna.
 */
function PanelAutomatico({ auto, intervalo, servicios, onChange }) {
  if (auto.motivo === 'sin-servicios') return null;

  if (!auto.hay) {
    const faltaHistorial = auto.motivo === 'sin-historial';
    return (
      <div className="intervalo-auto intervalo-auto-mudo">
        <p className="text-sm">
          <strong>Calcularlo con tus turnos:</strong>{' '}
          {faltaHistorial ? (
            <>
              todavía no se puede. Tenés {auto.turnos} turno{auto.turnos === 1 ? '' : 's'} en los
              últimos {auto.dias} días y hacen falta {TURNOS_MINIMOS} para saber qué servicio
              manda tu día. Cuando los tengas, acá te va a decir el número que te conviene.
            </>
          ) : (
            <>
              tus servicios duran números que no se llevan bien entre ellos, así que no hay una
              grilla que les cierre a todos. Mirá el aviso de abajo.
            </>
          )}
        </p>
        <ComoLoCalcula />
      </div>
    );
  }

  const yaEsta = normalizarIntervalo(intervalo) === auto.intervalo;
  const { masPedido, noEncajan, mezcla } = auto;
  // Lo que cuesta la grilla recomendada, para no vendérsela como gratis.
  // Lo que cuesta la grilla recomendada, para no vendersela como gratis. Solo
  // los servicios que de verdad se piden: avisar por el tiempo suelto de uno
  // que nadie reserva es ruido, y encima debilita el resto del cartel.
  const seVenden = new Set(mezcla.grupos.map((g) => g.duracion));
  const sueltos = desperdicioPorServicio(servicios, auto.intervalo)
    .filter((x) => x.desperdicio > 0 && seVenden.has(x.duracion));

  return (
    <div className={`intervalo-auto ${yaEsta ? 'intervalo-auto-ok' : 'intervalo-auto-cambio'}`}>
      <div className="intervalo-auto-titulo">
        {yaEsta ? (
          <strong>Ya lo tenés en el que te conviene: cada {auto.intervalo} minutos.</strong>
        ) : (
          <strong>Según tus turnos te conviene cada {auto.intervalo} minutos.</strong>
        )}
        {!yaEsta && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => onChange(auto.intervalo)}>
            Usar {auto.intervalo} minutos
          </button>
        )}
      </div>

      <p className="text-sm intervalo-auto-cuenta">
        De tus últimos <strong>{mezcla.total} turnos</strong>, el que más te piden es{' '}
        <strong>{masPedido.nombre}</strong>{' '}
        <span className="text-muted">({masPedido.duracion} min)</span>: {masPedido.turnos} de{' '}
        {mezcla.total}.
      </p>

      {auto.motivo === 'mas-pedido' && noEncajan.length > 0 && (
        <p className="text-sm intervalo-auto-cuenta">
          {noEncajan.map((x, i) => (
            <span key={x.duracion}>
              {i > 0 && ', '}
              <strong>{x.nombre}</strong> <span className="text-muted">({x.duracion} min)</span>
            </span>
          ))}
          {' '}no entra{noEncajan.length === 1 ? '' : 'n'} redondo en esa grilla, pero sale
          {noEncajan.length === 1 ? '' : 'n'}{' '}
          <strong>1 de cada {unoDeCada(auto.pesoQueNoEncaja)}</strong> turnos. Por tan poco no
          conviene partirle el día al que más sale.
        </p>
      )}

      {auto.motivo === 'mcd' && (
        <p className="text-sm intervalo-auto-cuenta">
          Pero{' '}
          {noEncajan.map((x, i) => (
            <span key={x.duracion}>
              {i > 0 && ' y '}
              <strong>{x.nombre}</strong> <span className="text-muted">({x.duracion} min)</span>
            </span>
          ))}
          {' '}sale{noEncajan.length === 1 ? '' : 'n'}{' '}
          <strong>1 de cada {unoDeCada(auto.pesoQueNoEncaja)}</strong> turnos, que ya es seguido.
          Con la grilla de {auto.intervalo} minutos entran todos sin dejar tiempo muerto.
        </p>
      )}

      {sueltos.length > 0 && (
        <p className="text-sm text-muted intervalo-auto-cuenta">
          Con esta grilla, cada{' '}
          {sueltos.map((s, i) => (
            <span key={s.id}>
              {i > 0 && (i === sueltos.length - 1 ? ' y cada ' : ', ')}
              {s.name} deja {s.desperdicio} min sueltos
            </span>
          ))}
          . Ya está contado: igual te conviene.
        </p>
      )}

      <ComoLoCalcula />
    </div>
  );
}

export default function IntervaloDeTurnos({ valor, servicios = [], turnos = [], businessHours = [], onChange }) {
  const intervalo = normalizarIntervalo(valor);
  const auto = recomendacionAutomatica(servicios, turnos);
  // Con historial manda el automático; sin él, el consejo por MCD de siempre.
  const d = auto.hay ? { estado: 'callado' } : diagnosticoDelIntervalo(servicios, intervalo);

  const muestra = horariosDeMuestra(businessHours, intervalo);

  return (
    <div className="form-group">
      <label className="form-label" htmlFor="slotInterval">Cada cuánto se ofrece un turno</label>

      <PanelAutomatico auto={auto} intervalo={intervalo} servicios={servicios} onChange={onChange} />

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
        Tus clientes ven <strong>{muestra.join(' · ')}</strong>… La duración de cada turno la
        sigue definiendo el servicio que elijan.
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
          </p>
          <Culpables culpables={d.culpables} />
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
          <Culpables culpables={d.culpables} />
        </Aviso>
      )}

      {d.estado === 'muy-fino' && (
        <Aviso tipo="info">
          <strong>Podés agrandar la grilla sin perder nada.</strong>
          <p className="text-sm" style={{ margin: '6px 0' }}>
            Con {intervalo} minutos no se pierde tiempo entre turnos, pero tampoco hace falta ir
            tan fino: tus servicios duran {d.duraciones.join(', ')} minutos y con{' '}
            <strong>{d.sugerido}</strong> pasa exactamente lo mismo, con una lista de horarios que
            se lee.
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
