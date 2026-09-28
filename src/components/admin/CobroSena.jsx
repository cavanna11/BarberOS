import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { urlConectarMercadoPago, desconectarMercadoPago } from '../../lib/functions';

/**
 * Cobro de seña con Mercado Pago, en Configuración.
 *
 * El dueño conecta SU cuenta: la seña entra directo a él y la plataforma nunca
 * toca esa plata. Es la diferencia que importa — el cobro figura a su nombre,
 * como si lo hubiera cobrado con su QR en el mostrador.
 *
 * `business.mpConectado` lo escribe la Cloud Function del callback; el dueño
 * no lo puede tocar (está en las Rules). Acá solo se lee.
 */
export default function CobroSena({ business, form, editar }) {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [yendo, setYendo] = useState(false);
  const [error, setError] = useState('');

  const conectado = business?.mpConectado === true;
  const sena = form.sena || {};

  // La vuelta del callback de Mercado Pago llega por la URL.
  const resultado = params.get('mp');
  const detalle = params.get('detalle');
  const limpiarResultado = () => {
    params.delete('mp'); params.delete('detalle');
    setParams(params, { replace: true });
  };

  const conectar = async () => {
    setYendo(true);
    setError('');
    try {
      const { url } = await urlConectarMercadoPago(business?.id);
      window.location.assign(url);
    } catch (err) {
      console.error('[CobroSena] No se pudo empezar la conexión:', err);
      setError(err.message || 'No se pudo abrir Mercado Pago.');
      setYendo(false);
    }
  };

  const desconectar = async () => {
    if (!window.confirm('¿Desconectar tu cuenta de Mercado Pago? Se deja de pedir seña en las reservas.')) return;
    setYendo(true);
    setError('');
    try {
      await desconectarMercadoPago(business?.id);
    } catch (err) {
      console.error('[CobroSena] No se pudo desconectar:', err);
      setError(err.message || 'No se pudo desconectar.');
    } finally {
      setYendo(false);
    }
  };

  return (
    <div className="card mt-md">
      <h3 className="mb-lg">Seña para reservar</h3>

      {resultado === 'ok' && (
        <div className="notice notice-success" style={{ marginBottom: 'var(--space-md)' }}>
          ✅ Tu cuenta de Mercado Pago quedó conectada.
          <button className="btn btn-ghost btn-sm" onClick={limpiarResultado} style={{ marginLeft: 8 }}>Entendido</button>
        </div>
      )}
      {resultado === 'error' && (
        <div className="notice notice-danger" style={{ marginBottom: 'var(--space-md)' }}>
          No se pudo conectar. {detalle}
          <button className="btn btn-ghost btn-sm" onClick={limpiarResultado} style={{ marginLeft: 8 }}>Cerrar</button>
        </div>
      )}
      {error && <div className="notice notice-danger" style={{ marginBottom: 'var(--space-md)' }}>{error}</div>}

      <p className="text-secondary text-sm" style={{ marginBottom: 'var(--space-md)' }}>
        Podés pedirle al cliente que deje una seña para confirmar el turno. <strong>La plata
        entra directo a tu cuenta de Mercado Pago</strong>: nosotros no la tocamos ni te
        cobramos comisión por eso. El cobro queda a tu nombre, igual que si lo hubieras
        cobrado con tu QR en el local.
      </p>

      {/* La plata va a la cuenta de QUIEN autoriza. Si el que está sentado acá
          es la plataforma ayudando a configurar, tiene que quedar clarísimo. */}
      {user?.isPlatformOwner && !conectado && (
        <div className="notice notice-warn" style={{ marginBottom: 'var(--space-md)' }}>
          ⚠️ Estás como plataforma. La cuenta de Mercado Pago que autorices es la que va a
          <strong> recibir la plata de esta barbería</strong>. Si no es una cuenta de prueba,
          que autorice el dueño desde su propia sesión.
        </div>
      )}

      {!conectado ? (
        <>
          <button className="btn btn-primary" onClick={conectar} disabled={yendo}>
            {yendo ? 'Abriendo Mercado Pago…' : 'Conectar con Mercado Pago'}
          </button>
          <p className="text-sm text-muted" style={{ marginTop: 10 }}>
            Te lleva a Mercado Pago para que autorices con tu cuenta. Volvés solo.
          </p>
        </>
      ) : (
        <>
          <div className="notice notice-success" style={{ marginBottom: 'var(--space-md)' }}>
            🟢 Conectado con tu cuenta de Mercado Pago.
          </div>

          <div className="form-group">
            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={sena.activa === true}
                onChange={(e) => editar({ sena: { ...sena, activa: e.target.checked, monto: sena.monto || 0 } })}
              />
              Pedir seña para reservar online
            </label>
          </div>

          {sena.activa && (
            <div className="form-group">
              <label className="form-label">¿Es obligatoria?</label>
              <select
                className="form-input"
                style={{ maxWidth: 320 }}
                value={sena.modo === 'obligatoria' ? 'obligatoria' : 'opcional'}
                onChange={(e) => editar({ sena: { ...sena, activa: true, modo: e.target.value } })}
              >
                <option value="opcional">El cliente elige: seña o pagar todo en el local</option>
                <option value="obligatoria">Obligatoria: sin seña no hay turno</option>
              </select>
              <p className="text-sm text-muted" style={{ marginTop: 6 }}>
                {sena.modo === 'obligatoria'
                  ? 'Cuidado: el que no tiene Mercado Pago o no tiene plata en la cuenta no va a poder reservar online. Te asegura el turno, pero perdés a esa gente.'
                  : 'El cliente ve las dos opciones y elige. La mayoría de las barberías arranca así.'}
              </p>
            </div>
          )}

          {sena.activa && (
            <div className="form-group">
              <label className="form-label">¿Cuánto? <span className="required">*</span></label>
              <input
                className="form-input"
                type="number"
                min="0"
                step="100"
                value={sena.monto ?? ''}
                onChange={(e) => editar({ sena: { ...sena, activa: true, monto: Number(e.target.value) || 0 } })}
                placeholder="3000"
                style={{ maxWidth: 200 }}
              />
              <p className="text-sm text-muted" style={{ marginTop: 6 }}>
                El mismo monto para todos tus servicios. Se lo descontás del precio cuando
                atiende. Si el cliente no paga en 15 minutos, el horario se libera solo.
              </p>
            </div>
          )}

          {sena.activa && (
            <div className="form-group">
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={sena.permiteTotal === true}
                  onChange={(e) => editar({ sena: { ...sena, permiteTotal: e.target.checked } })}
                />
                Dejar que el cliente pague el turno completo
              </label>
              <p className="text-sm text-muted" style={{ marginTop: 6 }}>
                Suma una opción más: en vez de la seña, paga todo ahora y llega con la
                cuenta saldada. Cobrás el precio del servicio que eligió.
              </p>
            </div>
          )}

          <button className="btn btn-ghost btn-sm" onClick={desconectar} disabled={yendo} style={{ marginTop: 8 }}>
            Desconectar mi cuenta
          </button>
        </>
      )}
    </div>
  );
}
