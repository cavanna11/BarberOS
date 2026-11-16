import { useMemo, useState } from 'react';
import { useTenant } from '../../hooks/useTenantData';
import { cerrarLocal, abrirLocal } from '../../lib/repository';
import { cierresProximos, fechasEntre, esFecha } from '../../utils/ausencias';
import { toDateString, formatDate } from '../../utils/dateUtils';

// ============================================================================
// Días que cierra el local (feriados)
// ============================================================================
// Pedido de Franlook (16/11/2026). El lunes feriado no había cómo cerrar: o se
// marcaba la ausencia de cada barbero de a uno, o se apagaba el lunes en el
// horario de la sucursal. Hicieron lo segundo, que apaga TODOS los lunes, y el
// lunes siguiente nadie pudo reservar hasta que se dieron cuenta.
//
// Acá se elige una fecha (o varias seguidas) y ese día no se toman turnos con
// ningún barbero. El horario semanal no se toca: al día siguiente sigue todo
// igual, sin acordarse de nada. Se guarda al toque, aparte del botón "Guardar
// cambios" de Configuración, igual que las ausencias de cada barbero.
//
// Los turnos que ya estaban reservados ese día NO se cancelan solos: a cada
// cliente hay que avisarle, y eso lo decide una persona desde Citas.

const VIVOS = ['pendiente', 'confirmada'];

export default function CierresDelLocal({ businessId, sucursales = [] }) {
  const { ausencias, appointments } = useTenant();
  const hoy = toDateString(new Date());

  const [fecha, setFecha] = useState('');
  const [varios, setVarios] = useState(false);
  const [hasta, setHasta] = useState('');
  const [enTodas, setEnTodas] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  const otras = sucursales.filter((s) => s && s.id !== businessId);
  const todas = [businessId, ...otras.map((s) => s.id)];
  const destinos = enTodas && otras.length ? todas : [businessId];
  const enVarias = destinos.length > 1;

  const lista = useMemo(() => cierresProximos(ausencias, hoy), [ausencias, hoy]);

  const fechas = useMemo(() => {
    if (!esFecha(fecha)) return [];
    if (!varios) return [fecha];
    return esFecha(hasta) ? fechasEntre(fecha, hasta, 31) : [];
  }, [fecha, varios, hasta]);

  // Los turnos que ya tiene ESTA sucursal en esos días. Los de las otras no
  // están cargados acá; el aviso lo dice.
  const turnosAfectados = useMemo(() => (appointments || []).filter(
    (a) => a && fechas.includes(a.appointmentDate) && VIVOS.includes(a.status)
  ), [appointments, fechas]);

  const limpiarAvisos = () => { setError(''); setOk(''); };

  const cerrar = async () => {
    limpiarAvisos();
    if (!fechas.length) { setError(varios ? 'Elegí desde y hasta qué día.' : 'Elegí el día.'); return; }
    if (fechas[0] < hoy) { setError('Ese día ya pasó.'); return; }
    setGuardando(true);
    try {
      await cerrarLocal(destinos, fechas);
      const donde = enVarias ? ' en ninguna sucursal' : '';
      setOk(fechas.length === 1
        ? `Listo: el ${formatDate(fechas[0])} no se toman turnos${donde}.`
        : `Listo: del ${formatDate(fechas[0])} al ${formatDate(fechas[fechas.length - 1])} no se toman turnos${donde}.`);
      setFecha(''); setHasta(''); setVarios(false);
    } catch (e) {
      console.error('[cierres] No se pudo cerrar:', e);
      setError('No se pudo guardar: ' + e.message);
    } finally {
      setGuardando(false);
    }
  };

  const abrir = async (f) => {
    limpiarAvisos();
    const enCuales = otras.length && window.confirm(
      `¿Abrir el ${formatDate(f)} también en las otras sucursales?\n\nAceptar: en todas.  Cancelar: solo en esta.`
    ) ? todas : [businessId];
    try {
      await abrirLocal(enCuales, f);
    } catch (e) {
      setError('No se pudo abrir: ' + e.message);
    }
  };

  return (
    <div className="card mt-md">
      <h3 className="mb-sm">Días que cierra el local</h3>
      <p className="text-secondary text-sm mb-md">
        Para un feriado o un día que no abren. Ese día nadie puede reservar con ningún barbero, y al
        día siguiente todo sigue igual: el horario semanal no se toca. Se guarda apenas tocás
        &quot;Cerrar ese día&quot;, sin el botón de Guardar cambios.
      </p>

      {lista.length > 0 && (
        <ul className="ausencias-lista">
          {lista.map((a) => (
            <li key={a.id || a.fecha}>
              <span><strong>{formatDate(a.fecha)}</strong> <span className="text-muted">cerrado</span></span>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => abrir(a.fecha)}>
                Abrir ese día
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="ausencias-form">
        <div className="form-group">
          <label className="form-label">{varios ? 'Desde qué día' : '¿Qué día cierran?'}</label>
          <input
            type="date"
            className="form-input"
            min={hoy}
            value={fecha}
            onChange={(e) => { setFecha(e.target.value); limpiarAvisos(); }}
          />
        </div>

        <label className="ausencias-check">
          <input type="checkbox" checked={varios} onChange={(e) => { setVarios(e.target.checked); setHasta(''); }} />
          <span>Varios días seguidos</span>
        </label>

        {varios && (
          <div className="form-group">
            <label className="form-label">Hasta qué día</label>
            <input
              type="date"
              className="form-input"
              min={fecha || hoy}
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
            />
          </div>
        )}

        {otras.length > 0 && (
          <label className="ausencias-check">
            <input type="checkbox" checked={enTodas} onChange={(e) => setEnTodas(e.target.checked)} />
            <span>En todas las sucursales ({otras.length + 1})</span>
          </label>
        )}

        {turnosAfectados.length > 0 && (
          <div className="notice notice-warn" role="status">
            {turnosAfectados.length === 1
              ? 'Ya hay 1 turno reservado'
              : `Ya hay ${turnosAfectados.length} turnos reservados`} en esta sucursal
            {fechas.length === 1 ? ' para ese día' : ' para esos días'}. No se cancelan solos:
            avisale a cada cliente y cancelalos desde Citas.
            {enVarias && ' Revisá también las otras sucursales.'}
          </div>
        )}

        {error && <div className="notice notice-danger">{error}</div>}
        {ok && <div className="notice notice-success" role="status">{ok}</div>}

        <button type="button" className="btn btn-primary" onClick={cerrar} disabled={guardando || !fechas.length}>
          {guardando ? 'Guardando…' : fechas.length > 1 ? `Cerrar esos ${fechas.length} días` : 'Cerrar ese día'}
        </button>
      </div>
    </div>
  );
}
