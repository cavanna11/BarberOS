import { useEffect, useRef, useState } from 'react';
import { validarCupon } from '../../lib/functions';
import { normalizarCodigo, MENSAJE_AL_CLIENTE, textoDeDias } from '../../utils/cupon';
import { formatPrice } from '../../utils/dateUtils';

// ============================================================================
// "¿Tenés un código de descuento?" — el paso del cupón, en la confirmación
// ============================================================================
// Va en el último paso, al lado del resumen, y arranca CERRADO: un campo de
// cupón abierto le dice a todo el mundo que hay descuentos que no tiene, y el
// que no tiene código siente que está pagando de más. El que tiene uno lo
// busca.
//
// La única excepción es cuando el cupón vino en el link (`?cupon=`): ahí ya
// sabe que tiene el descuento, así que se aplica solo y se muestra aplicado.
//
// Lo que se ve acá es una VISTA PREVIA. El descuento que se cobra lo recalcula
// la Cloud Function sobre el precio del documento del servicio. Si el cupón
// dejó de servir entre que se aplicó y se confirmó, la reserva sigue sin él en
// vez de romperse — y por eso el aviso de abajo dice "podés reservar igual".

export default function CuponEnReserva({
  businessId, serviceId, professionalId, fecha, precio, currency,
  cupon, onCupon, codigoDelLink,
  // El cupón ya se aceptó, pero vale otros días y el cliente cambió la fecha.
  cuponFueraDeDia = null,
}) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState('');
  const [error, setError] = useState('');
  const [probando, setProbando] = useState(false);
  // El del link se intenta UNA vez. Sin esto, cada render que cambie el
  // servicio o el profesional lo vuelve a mandar y se come el límite de
  // intentos del propio cliente.
  const intentado = useRef(null);

  const probar = async (codigo, desdeElLink = false) => {
    const limpio = normalizarCodigo(codigo);
    if (!limpio) return;
    setError('');
    setProbando(true);
    try {
      const r = await validarCupon({ businessId, codigo: limpio, serviceId, professionalId, appointmentDate: fecha });
      if (r.valido) {
        onCupon({
          codigo: r.codigo, tipo: r.tipo, valor: r.valor, descuento: r.descuento,
          precioFinal: r.precioFinal, dias: r.dias || [],
        });
        setTexto('');
      } else {
        onCupon(null);
        // El que vino por el link no escribió nada: culparlo de un código malo
        // sería raro. Se le dice que la promo ya no está y que siga.
        // Salvo que sea por el día: ahí el código sirve, y con cambiar la
        // fecha le entra. Eso sí se le cuenta, venga de donde venga.
        setError(r.dias?.length
          ? r.mensaje
          : desdeElLink
            ? 'Este descuento ya no está disponible, pero podés reservar tu turno normalmente.'
            : r.mensaje || MENSAJE_AL_CLIENTE);
        if (desdeElLink) setAbierto(true);
      }
    } catch (err) {
      console.error('[cupon] No se pudo validar:', err);
      onCupon(null);
      setError(err.code === 'functions/resource-exhausted'
        ? 'Probaste muchos códigos seguidos. Esperá unos minutos.'
        : MENSAJE_AL_CLIENTE);
    } finally {
      setProbando(false);
    }
  };

  // El cupón del link se aplica solo, apenas hay servicio elegido (el descuento
  // depende del precio de ESE servicio).
  useEffect(() => {
    if (!codigoDelLink || !businessId || !serviceId) return;
    const clave = `${codigoDelLink}|${serviceId}|${professionalId}|${fecha}`;
    if (intentado.current === clave) return;
    intentado.current = clave;
    probar(codigoDelLink, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codigoDelLink, businessId, serviceId, professionalId, fecha]);

  if (cupon) {
    return (
      <div className="cupon-aplicado">
        <div className="cupon-aplicado-fila">
          <span>Precio</span>
          <span className="cupon-tachado">{formatPrice(precio, currency)}</span>
        </div>
        <div className="cupon-aplicado-fila cupon-aplicado-descuento">
          <span>{cupon.codigo}</span>
          <span>−{formatPrice(cupon.descuento, currency)}</span>
        </div>
        <div className="cupon-aplicado-fila cupon-aplicado-total">
          <span>Total</span>
          <span>{formatPrice(cupon.precioFinal, currency)}</span>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm cupon-quitar"
          onClick={() => { onCupon(null); setError(''); intentado.current = 'quitado'; }}
        >
          Quitar cupón
        </button>
      </div>
    );
  }

  if (cuponFueraDeDia) {
    return (
      <div className="cupon-caja">
        <p className="cupon-error">
          Tu cupón <strong>{cuponFueraDeDia.codigo}</strong> vale solo para turnos{' '}
          {textoDeDias(cuponFueraDeDia.dias)}. Volvé y elegí uno de esos días para usarlo,
          o reservá este turno sin descuento.
        </p>
        <button
          type="button"
          className="btn btn-ghost btn-sm cupon-quitar"
          onClick={() => { onCupon(null); setError(''); intentado.current = 'quitado'; }}
        >
          Quitar cupón
        </button>
      </div>
    );
  }

  if (!abierto) {
    return (
      <div className="cupon-caja">
        <button type="button" className="cupon-abrir" onClick={() => setAbierto(true)}>
          ¿Tenés un código de descuento?
        </button>
      </div>
    );
  }

  return (
    <div className="cupon-caja">
      <label className="form-label" htmlFor="cupon">Aplicar cupón</label>
      <div className="cupon-form">
        <input
          id="cupon"
          className="form-input"
          value={texto}
          onChange={(e) => { setTexto(e.target.value.toUpperCase()); setError(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); probar(texto); } }}
          placeholder="CORTE20"
          maxLength={24}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
        />
        <button
          type="button"
          className="btn btn-outline"
          onClick={() => probar(texto)}
          disabled={probando || !texto.trim()}
        >
          {probando ? '…' : 'Aplicar'}
        </button>
      </div>
      {error && <p className="cupon-error">{error}</p>}
    </div>
  );
}
