import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../hooks/useTenantData';
import { obtenerTurnosFijos } from '../../lib/repository';
import { darDeBajaTurnoFijo } from '../../lib/functions';

// ============================================================================
// Los turnos fijos de la barbería (o los del barbero que mira)
// ============================================================================
// Quién viene siempre, qué día, a qué hora y cada cuánto. Se crean desde
// "Agendar turno" → Repetir. Acá se miran y se dan de baja: dar de baja
// cancela los turnos que ya estaban agendados a futuro.
//
// Se lee de una vez al abrir (no hace falta en vivo: cambia cuando alguien
// crea o da de baja uno, y eso pasa desde acá mismo).

const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const fecha = (f) => (f ? f.split('-').reverse().slice(0, 2).join('/') : '');

export default function TurnosFijosModal({ onClose, onNuevo }) {
  const { user } = useAuth();
  const { businessId } = useTenant();
  const esBarbero = user?.role === 'admin';
  const [lista, setLista] = useState(null);
  const [vuelta, setVuelta] = useState(0);
  const [error, setError] = useState('');
  const [trabajando, setTrabajando] = useState('');

  useEffect(() => {
    let vigente = true;
    obtenerTurnosFijos(businessId, esBarbero ? user?.professionalId : null)
      .then((filas) => { if (vigente) setLista(filas.sort((a, b) => a.diaSemana - b.diaSemana || a.startTime.localeCompare(b.startTime))); })
      .catch((err) => { if (vigente) { setLista([]); setError('No se pudieron leer los turnos fijos: ' + err.message); } });
    return () => { vigente = false; };
  }, [businessId, esBarbero, user?.professionalId, vuelta]);

  const baja = async (s) => {
    if (!window.confirm(`¿Dar de baja el turno fijo de ${s.clientName} (${DIAS[s.diaSemana]} ${s.startTime})?\n\nSe cancelan los turnos que ya estaban agendados de hoy en adelante.`)) return;
    setTrabajando(s.id);
    setError('');
    try {
      await darDeBajaTurnoFijo({ businessId, serieId: s.id });
      setVuelta((v) => v + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setTrabajando('');
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <h3>🔁 Turnos fijos</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <p className="text-sm text-secondary" style={{ marginTop: 0 }}>
            Los clientes que vienen siempre el mismo día y horario. Se agendan solos, con 8 semanas
            de anticipación. Para cancelar una sola fecha, cancelá ese turno en la agenda.
          </p>
          {error && <div className="notice notice-danger">{error}</div>}
          {lista === null && <p className="text-secondary">Leyendo…</p>}
          {lista?.length === 0 && (
            <div className="empty-state" style={{ padding: 'var(--space-lg)' }}>
              <p>Todavía no hay turnos fijos. Se crean desde "Agendar turno", eligiendo "Repetir".</p>
            </div>
          )}
          {lista?.map((s) => (
            <div key={s.id} className="turno-fijo-fila">
              <div>
                <strong>{s.clientName}</strong>
                <div className="text-sm">
                  {DIAS[s.diaSemana]} {s.startTime} · {s.cadaSemanas === 1 ? 'todas las semanas' : `cada ${s.cadaSemanas} semanas`}
                </div>
                <div className="text-xs text-muted">
                  {s.serviceName}{!esBarbero && s.professionalName ? ` · ✂️ ${s.professionalName}` : ''}
                  {s.generadoHasta ? ` · agendado hasta el ${fecha(s.generadoHasta)}` : ''}
                </div>
                {(s.saltados || []).length > 0 && (
                  <div className="text-xs" style={{ color: 'var(--warning)' }}>
                    Salteados: {s.saltados.slice(-3).map((x) => `${fecha(x.fecha)} (${x.motivo})`).join(' · ')}
                  </div>
                )}
              </div>
              <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)', flexShrink: 0 }} disabled={trabajando === s.id} onClick={() => baja(s)}>
                {trabajando === s.id ? 'Dando de baja…' : 'Dar de baja'}
              </button>
            </div>
          ))}
        </div>
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onClose}>Cerrar</button>
          <button className="btn btn-primary" onClick={onNuevo}>+ Nuevo turno fijo</button>
        </div>
      </div>
    </div>
  );
}
