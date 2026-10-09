import { useEffect, useMemo, useState } from 'react';
import { obtenerMembresias } from '../../lib/repository';
import { aplicarMembresia } from '../../lib/functions';
import { ESTADOS_MEMBRESIA, fechaLarga } from '../../utils/membresias';

// ============================================================================
// El dueño aplica una membresía a un turno que ya existe
// ============================================================================
// Para los dos casos reales: el cliente se olvidó de marcarla al reservar, o el
// turno lo cargó el staff a mano y no tiene la cuenta del cliente.
//
// Solo el dueño (la function lo exige; el barbero ni ve el botón). Con motivo
// obligatorio: queda en la auditoría separado de lo que eligió el cliente.
// Si el turno lo reservó un cliente con su cuenta, el servidor solo acepta la
// membresía de ESE cliente.

export default function AplicarMembresiaModal({ turno, businessId, cuentaId, onCerrar, onListo }) {
  const [membresias, setMembresias] = useState(null);
  const [elegida, setElegida] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let vivo = true;
    obtenerMembresias(cuentaId)
      .then((lista) => {
        if (!vivo) return;
        const usables = lista.filter((m) => ['activa', 'pausada', 'pago_rechazado', 'cancelada'].includes(m.estado));
        setMembresias(usables);
        // La del cliente del turno, si se la reconoce.
        const suya = usables.find((m) => (m.clienteUid && m.clienteUid === turno.userId)
          || (m.clienteEmail && m.clienteEmail === String(turno.clientEmail || '').toLowerCase()));
        if (suya) setElegida(suya.id);
      })
      .catch((err) => { if (vivo) { setMembresias([]); setError(err.message); } });
    return () => { vivo = false; };
  }, [cuentaId, turno]);

  const lista = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return (membresias || [])
      .filter((m) => !q || `${m.clienteNombre} ${m.clienteEmail}`.toLowerCase().includes(q))
      .sort((a, b) => String(a.clienteNombre).localeCompare(String(b.clienteNombre)));
  }, [membresias, busqueda]);

  const aplicar = async () => {
    setGuardando(true);
    setError('');
    try {
      await aplicarMembresia({ businessId, appointmentId: turno.id, membresiaId: elegida, motivo });
      onListo();
    } catch (err) {
      setError(err.message);
      setGuardando(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onCerrar}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 500 }}>
        <div className="modal-header">
          <h2>Aplicar membresía</h2>
          <button className="modal-close" onClick={onCerrar}>✕</button>
        </div>
        <div className="modal-body">
          <p className="text-sm text-secondary">
            {turno.clientName || 'Cliente'} · {turno.serviceName} · {fechaLarga(turno.appointmentDate)} {turno.startTime}.
            El turno pasa a no cobrarse y se descuenta un uso del plan.
          </p>
          <input className="form-input" placeholder="Buscar cliente…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
          {membresias === null && <p className="text-sm text-secondary">Leyendo…</p>}
          {membresias && lista.length === 0 && <p className="text-sm text-secondary">No hay membresías activas que coincidan.</p>}
          <div className="aplicar-membresia-lista">
            {lista.map((m) => (
              <label key={m.id} className="pago-opcion">
                <input type="radio" name="membresia" checked={elegida === m.id} onChange={() => setElegida(m.id)} />
                <span>
                  <strong>{m.clienteNombre}</strong> · {m.plan?.nombre}
                  <span className={`badge ${ESTADOS_MEMBRESIA[m.estado]?.clase || 'badge-neutral'}`} style={{ marginLeft: 6, fontSize: 10 }}>
                    {ESTADOS_MEMBRESIA[m.estado]?.label || m.estado}
                  </span>
                  <div className="text-xs text-secondary">{m.clienteEmail}</div>
                </span>
              </label>
            ))}
          </div>
          <input className="form-input" style={{ marginTop: 8 }} placeholder="Motivo (obligatorio, queda en la auditoría)"
            value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          {error && <div className="notice notice-danger" style={{ marginTop: 8 }}>{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onCerrar}>Cancelar</button>
          <button className="btn btn-primary" onClick={aplicar} disabled={guardando || !elegida || motivo.trim().length < 3}>
            {guardando ? 'Aplicando…' : 'Aplicar'}
          </button>
        </div>
      </div>
    </div>
  );
}
