import { useMemo, useState } from 'react';
import { formatDate, toDateString, timeToMinutes } from '../../utils/dateUtils';

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

const pad = (n) => String(n).padStart(2, '0');
const aHora = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

export default function AgendaDelDia({
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
}) {
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
  const nombreSrv = (a) => a.serviceName || services.find((s) => s.id === a.serviceId)?.name || (a.type === 'walkin' ? 'Servicio sin turno' : '—');

  const activos = delDia.filter((a) => a.status === 'pendiente' || a.status === 'confirmada');

  return (
    <div className="agenda">
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
        <div className="agenda-titulo">
          <strong>{formatDate(fecha)}</strong>
          <span className="text-secondary text-sm">
            {' '}· {activos.length === 0 ? 'sin turnos' : activos.length === 1 ? '1 turno' : `${activos.length} turnos`}
          </span>
        </div>
        {varios && (
          <select className="form-input agenda-filtro" value={filtroProf} onChange={(e) => setFiltroProf(e.target.value)}>
            <option value="">Todos los barberos</option>
            {professionals.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
      </div>

      {cerrado && delDia.length === 0 ? (
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
                      ? <span className="agenda-libre agenda-sigue">↑ sigue {enCurso.type === 'walkin' ? 'servicio sin turno' : (enCurso.clientName || 'cliente')}</span>
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
                          {a.clientPhone && !walkin && (
                            <a className="agenda-turno-tel" href={`tel:${a.clientPhone}`} onClick={(e) => e.stopPropagation()}>
                              📞 {a.clientPhone}
                            </a>
                          )}
                        </div>
                        <div className="agenda-turno-lateral">
                          <span className={`badge ${est.clase}`}>{est.label}</span>
                          {renderAcciones && <div className="agenda-turno-acciones" onClick={(e) => e.stopPropagation()}>{renderAcciones(a)}</div>}
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
