import { useMemo, useState } from 'react';
import { formatDate, toDateString, timeToMinutes, fechaCorta } from '../../utils/dateUtils';
import { origenTurno } from '../../utils/origenTurno';
import WhatsAppTurno from './WhatsAppTurno';
import { turnoConMembresia } from '../../utils/membresias';
import { textoAdicionales, textoMetodoPago } from '../../utils/adicionales';

/**
 * La agenda de un día, como un calendario: una fila por franja horaria, con
 * la hora bien grande a la izquierda y, a la derecha, quién viene y para qué.
 *
 * Es la pantalla que el barbero mira veinte veces por día desde el celular,
 * entre corte y corte. Por eso es una lista vertical y no una grilla de
 * columnas: en 375px una grilla no se lee. Con más de un profesional (vista
 * del dueño) cada turno lleva el nombre del barbero, y se puede filtrar.
 *
 * Recibe los arrays por props (regla de oro: nada de Firestore acá).
 */

const ESTADO = {
  pendiente:  { label: 'Pendiente',  clase: 'badge-warning' },
  confirmada: { label: 'Confirmada', clase: 'badge-success' },
  completada: { label: 'Completada', clase: 'badge-primary' },
  cancelada:  { label: 'Cancelada',  clase: 'badge-danger' },
  no_asistio: { label: 'No asistió', clase: 'badge-danger' },
};

/** 'YYYY-MM-DD' ± n días, en local. */
function sumarDias(fechaISO, n) {
  const d = new Date(`${fechaISO}T12:00:00`);
  d.setDate(d.getDate() + n);
  return toDateString(d);
}

/** Horario de apertura del local ese día, o 08:00–21:00 si no está cargado. */
function rangoDelDia(business, fechaISO) {
  const js = new Date(`${fechaISO}T12:00:00`).getDay();
  const dow = js === 0 ? 6 : js - 1; // 0=Lunes … 6=Domingo
  const dia = business?.businessHours?.find((h) => h.dayOfWeek === dow);
  if (dia?.isActive && dia.startTime && dia.endTime) {
    const corte = dia.breakStart && dia.breakEnd ? [timeToMinutes(dia.breakStart), timeToMinutes(dia.breakEnd)] : null;
    return { desde: timeToMinutes(dia.startTime), hasta: timeToMinutes(dia.endTime), cerrado: false, corte };
  }
  return { desde: 8 * 60, hasta: 21 * 60, cerrado: Boolean(dia) && !dia.isActive, corte: null };
}

/**
 * Lo que dice una franja que ocupa un turno que empezó antes: "sigue Juan", o
 * "2.º turno de Juan" si ya es el rato del que vino con él.
 */
function textoSigue(turno, min) {
  if (turno.type === 'walkin') return 'sigue servicio sin turno';
  const nombre = turno.clientName || 'cliente';
  const acomp = Number(turno.acompanante?.durationMinutes) || 0;
  if (acomp) {
    const finTitular = timeToMinutes(turno.startTime) + (Number(turno.durationMinutes) || 0) - acomp;
    if (min >= finTitular) return `2.º turno de ${nombre}`;
  }
  return `sigue ${nombre}`;
}

const pad = (n) => String(n).padStart(2, '0');
const aHora = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

export default function AgendaDelDia({
  // Mientras la agenda no contestó, el día no está "libre": no se sabe.
  cargando = false,
  appointments,
  professionals,
  services,
  business,
  /** Si viene, la agenda es de un solo profesional (vista del barbero). */
  professionalId = null,
  /** Qué hacer al tocar un turno (opcional). */
  onSelect = null,
  /** Acciones opcionales por turno: (apt) => ReactNode. */
  renderAcciones = null,
  /** Si viene, la agenda dibuja sola los botones: (apt, status) => void. */
  onCambiarEstado = null,
  /** Si viene, se puede mover el turno a otro barbero: (apt, profId) => Promise. */
  onCambiarProfesional = null,
}) {
  // Qué turno está cambiando de barbero, y el último error. No es un modal a
  // propósito: esto pasa con el cliente parado adelante, y abrir una ventana
  // para elegir entre dos nombres es una pantalla de más.
  const [moviendo, setMoviendo] = useState(null);
  const [errorMover, setErrorMover] = useState('');
  const hoy = toDateString(new Date());
  const [fecha, setFecha] = useState(hoy);
  const [filtroProf, setFiltroProf] = useState('');

  const profActivo = professionalId || filtroProf || null;
  const varios = !professionalId && professionals.length > 1;

  const { desde, hasta, cerrado, corte } = rangoDelDia(business, fecha);
  const paso = Number(business?.slotInterval) || 30;

  const delDia = useMemo(() => {
    return appointments
      .filter((a) => a.appointmentDate === fecha)
      .filter((a) => !profActivo || a.professionalId === profActivo)
      .filter((a) => a.status !== 'cancelada')
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  }, [appointments, fecha, profActivo]);

  // Franjas: desde la apertura hasta el cierre, en pasos del intervalo. Si
  // hay un turno fuera de ese rango (walk-in tarde, horario viejo), se
  // extiende para que no desaparezca.
  const franjas = useMemo(() => {
    let ini = desde, fin = hasta;
    for (const a of delDia) {
      ini = Math.min(ini, Math.floor(timeToMinutes(a.startTime) / paso) * paso);
      fin = Math.max(fin, a.endTime ? timeToMinutes(a.endTime) : timeToMinutes(a.startTime) + paso);
    }
    const out = [];
    for (let m = ini; m < fin; m += paso) out.push(m);
    return out;
  }, [desde, hasta, paso, delDia]);

  const ahoraMin = (() => {
    if (fecha !== hoy) return null;
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  })();

  const nombreProf = (id) => professionals.find((p) => p.id === id)?.name || '—';
  const nombreSrv = (a) => (a.serviceName || services.find((s) => s.id === a.serviceId)?.name || (a.type === 'walkin' ? 'Servicio sin turno' : '—')) + textoAdicionales(a) + textoMetodoPago(a);

  const activos = delDia.filter((a) => a.status === 'pendiente' || a.status === 'confirmada');

  // A quién se le puede pasar un turno. Los inactivos no: el que se fue de la
  // barbería no puede quedar con turnos nuevos.
  const activosDelEquipo = (professionals || []).filter((p) => p && p.isActive !== false);

  // Turnos que ya terminaron y siguen abiertos: son los que hay que cerrar al
  // final del día. Tenerlos contados permite hacerlo de una vez en lugar de
  // turno por turno.
  const ahoraReal = new Date();
  const yaTermino = (a) => new Date(`${a.appointmentDate}T${a.endTime || a.startTime}:00`) <= ahoraReal;
  const sinCerrar = activos.filter(yaTermino);

  const cerrarElDia = () => {
    if (!onCambiarEstado) return;
    const n = sinCerrar.length;
    if (!window.confirm(
      `¿Marcar ${n === 1 ? 'el turno que ya pasó' : `los ${n} turnos que ya pasaron`} como atendidos?\n\n` +
      'Si alguien no vino, marcalo primero con "No vino" y después cerrá el día.'
    )) return;
    sinCerrar.forEach((a) => onCambiarEstado(a, 'completada'));
  };

  // Un solo lugar decide qué botones tiene un turno, para que la agenda del
  // dashboard y la de la sección propia no se vayan separando.
  const accionesPropias = (a) => {
    if (a.status !== 'pendiente' && a.status !== 'confirmada') return null;
    const termino = yaTermino(a);
    return (
      <>
        {/* No hay "Confirmar" (22/10/2026). El turno nace confirmado: apretar
            ese botón no decidía nada —un turno pendiente ocupaba el horario,
            se cancelaba y contaba exactamente igual— y era un toque por turno
            en la pantalla que más se abre en el día. Los turnos viejos que
            quedaron en 'pendiente' se siguen viendo y se siguen cerrando
            igual: nunca hubo diferencia de comportamiento entre los dos. */}
        {termino && (
          <>
            <button className="btn btn-sm btn-primary" onClick={() => onCambiarEstado(a, 'completada')}>Vino</button>
            <button className="btn btn-sm btn-outline" onClick={() => onCambiarEstado(a, 'no_asistio')}>No vino</button>
          </>
        )}
        <button className="btn btn-sm btn-ghost" title="Cancelar el turno" onClick={() => onCambiarEstado(a, 'cancelada')}>✕</button>
      </>
    );
  };
  const acciones = renderAcciones || (onCambiarEstado ? accionesPropias : null);

  return (
    <div className="agenda">
      {/* El motivo por el que no se pudo mover un turno. Va arriba y no al lado
          del select: el servidor contesta frases largas ("Nicolas ese dia
          atiende de 14:00 a 20:00") y adentro de la fila no se leen. */}
      {errorMover && (
        <div className="notice notice-danger" style={{ marginBottom: 'var(--space-md)' }}>
          {errorMover}
        </div>
      )}
      <div className="agenda-cabecera">
        <div className="agenda-nav">
          <button className="btn btn-ghost btn-sm" onClick={() => setFecha(sumarDias(fecha, -1))} aria-label="Día anterior">‹</button>
          <button
            className={`btn btn-sm ${fecha === hoy ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setFecha(hoy)}
          >
            Hoy
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setFecha(sumarDias(fecha, 1))} aria-label="Día siguiente">›</button>
          <input
            type="date"
            className="form-input agenda-fecha"
            value={fecha}
            onChange={(e) => e.target.value && setFecha(e.target.value)}
          />
        </div>
        {/* El día que se está mirando, grande: antes el título de la pantalla
            decía siempre la fecha de hoy y al moverse de día seguía diciendo
            "hoy", que es justo lo que uno viene a chequear. */}
        <div className="agenda-titulo">
          <strong className="agenda-dia">{fechaCorta(fecha)}</strong>
          <span className="agenda-fecha-larga">{formatDate(fecha)}</span>
          <span className="text-secondary text-sm">
            {activos.length === 0 ? 'sin turnos' : activos.length === 1 ? '1 turno' : `${activos.length} turnos`}
          </span>
        </div>
        {onCambiarEstado && sinCerrar.length > 0 && (
          <button className="btn btn-sm btn-primary agenda-cerrar" onClick={cerrarElDia}>
            ✅ Cerrar el día ({sinCerrar.length})
          </button>
        )}
        {varios && (
          <select className="form-input agenda-filtro" value={filtroProf} onChange={(e) => setFiltroProf(e.target.value)}>
            <option value="">Todos los barberos</option>
            {professionals.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
      </div>

      {cargando && delDia.length === 0 ? (
        <div className="empty-state" style={{ padding: 'var(--space-xl)' }}>
          <p>Cargando los turnos…</p>
        </div>
      ) : cerrado && delDia.length === 0 ? (
        <div className="empty-state" style={{ padding: 'var(--space-xl)' }}>
          <p>La barbería está cerrada este día.</p>
        </div>
      ) : (
        <div className="agenda-franjas">
          {franjas.map((m) => {
            const turnos = delDia.filter((a) => {
              const ini = timeToMinutes(a.startTime);
              return ini >= m && ini < m + paso;
            });
            // Un turno largo (60 min con paso de 30) ocupa también las franjas
            // siguientes: no están libres, sigue el mismo cliente.
            const enCurso = turnos.length === 0 ? delDia.find((a) => {
              const ini = timeToMinutes(a.startTime);
              const fin = a.endTime ? timeToMinutes(a.endTime) : ini + paso;
              return ini < m && fin > m;
            }) : null;
            const esAhora = ahoraMin !== null && ahoraMin >= m && ahoraMin < m + paso;
            const yaPaso = ahoraMin !== null && m + paso <= ahoraMin;
            const enCorte = Boolean(corte) && m >= corte[0] && m < corte[1];
            return (
              <div key={m} className={`agenda-franja ${turnos.length ? 'con-turno' : enCurso ? 'ocupada' : enCorte ? 'cerrada' : 'libre'} ${esAhora ? 'ahora' : ''} ${yaPaso ? 'pasada' : ''}`}>
                <div className="agenda-hora">{aHora(m)}</div>
                <div className="agenda-celda">
                  {turnos.length === 0 ? (
                    enCurso
                      ? <span className="agenda-libre agenda-sigue">↑ {textoSigue(enCurso, m)}</span>
                      : enCorte
                        ? <span className="agenda-libre agenda-cerrada">cerrado</span>
                        : <span className="agenda-libre">libre</span>
                  ) : turnos.map((a) => {
                    const est = ESTADO[a.status] || { label: a.status, clase: 'badge-neutral' };
                    const walkin = a.type === 'walkin';
                    return (
                      <div
                        key={a.id}
                        className={`agenda-turno estado-${a.status} ${onSelect ? 'clickeable' : ''}`}
                        onClick={onSelect ? () => onSelect(a) : undefined}
                        role={onSelect ? 'button' : undefined}
                      >
                        <div className="agenda-turno-principal">
                          <div className="agenda-turno-cliente">
                            {walkin ? '✂️ Servicio sin turno' : (a.clientName || 'Cliente')}
                          </div>
                          <div className="agenda-turno-detalle">
                            {a.startTime}–{a.endTime || '?'} · {nombreSrv(a)}
                            {varios && !profActivo && <> · <strong>{nombreProf(a.professionalId)}</strong></>}
                          </div>

                          {/* Vino por "Cualquiera": el cliente no pidió a nadie.
                              Sin esto el turno se ve igual que uno pedido a
                              dedo, y el barbero cree que lo eligieron a él. */}
                          {a.pidioCualquiera && (
                            <div className="agenda-turno-cualquiera">
                              👥 Pidió <strong>cualquiera</strong> — lo atiende el que esté libre
                            </div>
                          )}

                          {/* Cambiar de barbero. Aparece solo si hay a quién
                              mover el turno: en una barbería de uno, elegir
                              entre un nombre no es una decisión. */}
                          {onCambiarProfesional && activosDelEquipo.length > 1
                            && ['pendiente', 'confirmada', 'completada'].includes(a.status) && (
                            <div className="agenda-turno-mover">
                              <label>
                                <span className="text-sm text-muted">Lo atiende</span>
                                <select
                                  className="form-input"
                                  value={a.professionalId || ''}
                                  disabled={moviendo === a.id}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={async (e) => {
                                    e.stopPropagation();
                                    const destino = e.target.value;
                                    if (!destino || destino === a.professionalId) return;
                                    setMoviendo(a.id);
                                    setErrorMover('');
                                    try {
                                      await onCambiarProfesional(a, destino);
                                    } catch (err) {
                                      // El motivo se MUESTRA. El servidor contesta
                                      // "Nicolás no trabaja ese día" o "ya tiene un
                                      // turno a las 18:00", y eso es justo lo que
                                      // hay que leer para resolverlo en el momento.
                                      setErrorMover(err?.message || 'No se pudo cambiar el profesional.');
                                    } finally {
                                      setMoviendo(null);
                                    }
                                  }}
                                >
                                  {activosDelEquipo.map((p) => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                  ))}
                                </select>
                              </label>
                              {moviendo === a.id && <span className="text-sm text-muted">Cambiando…</span>}
                            </div>
                          )}
                          {/* Lo cubre la membresía del cliente: no se cobra. Lo
                              marcó el cliente al reservar (o el dueño); el
                              barbero no lo puede poner ni sacar. */}
                          {turnoConMembresia(a) && (
                            <div className="agenda-turno-membresia">
                              🪪 Membresía{a.membresia.planNombre ? ` · ${a.membresia.planNombre}` : ''} — no se cobra
                            </div>
                          )}
                          {/* Un premio de recompensas o el happy hour: el barbero
                              tiene que saberlo antes de cobrar (y el regalo
                              "personalizado" lo tiene que entregar él). */}
                          {a.premio && (
                            <div className="agenda-turno-membresia">
                              🎁 Premio: {a.premio.nombre}{a.premio.descuento > 0 ? ` — ya descontado` : a.premio.tipo === 'personalizado' ? ' — entregáselo' : ''}
                            </div>
                          )}
                          {a.happyHour && (
                            <div className="agenda-turno-membresia">⏰ Happy hour −{a.happyHour.porcentaje}% — ya descontado</div>
                          )}
                          {!walkin && (
                            <div className="agenda-turno-origen" title={origenTurno(a).detalle}>
                              {origenTurno(a).icono} {origenTurno(a).etiqueta}
                            </div>
                          )}
                          {a.clientPhone && !walkin && (
                            <a className="agenda-turno-tel" href={`tel:${a.clientPhone}`} onClick={(e) => e.stopPropagation()}>
                              📞 {a.clientPhone}
                            </a>
                          )}
                          {/* Recordarle el turno al que viene en un rato, sin
                              salir de la agenda ni buscar el número a mano. */}
                          {!walkin && (
                            <WhatsAppTurno
                              turno={a}
                              business={business}
                              servicio={services.find((s) => s.id === a.serviceId) || null}
                              compacto
                            />
                          )}
                        </div>
                        <div className="agenda-turno-lateral">
                          <span className={`badge ${est.clase}`}>{est.label}</span>
                          {acciones && <div className="agenda-turno-acciones" onClick={(e) => e.stopPropagation()}>{acciones(a)}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
