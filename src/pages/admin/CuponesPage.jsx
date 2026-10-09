import { useEffect, useMemo, useState } from 'react';
import { useTenant } from '../../hooks/useTenantData';
import {
  subscribeCupones, guardarCupon, activarCupon, borrarCupon,
} from '../../lib/repository';
import {
  normalizarCodigo, codigoValido, calcularDescuento, describirCupon,
  estadoDelCupon, linkDelCupon, mensajeParaCompartir,
} from '../../utils/cupon';
import { formatPrice } from '../../utils/dateUtils';
import QrDelCupon from '../../components/admin/QrDelCupon';

// ============================================================================
// Cupones de descuento
// ============================================================================
// Un cupón es un código, un descuento y, opcionalmente, un montón de límites.
// La pantalla está armada alrededor de eso: el formulario pide las tres cosas
// que hacen falta y esconde el resto detrás de "Más condiciones", porque el
// cupón que de verdad se usa es "20% con CORTE20" y pedirle a alguien que
// complete diez campos para eso es la forma más rápida de que no cree ninguno.
//
// Los números (usos, ingresos, clientes nuevos) los escribe el servidor: acá
// solo se muestran. Las Rules rechazan la escritura si vienen en el payload.
//
// El cupón vale en ESTA barbería. En una cuenta con sucursales, cada local es
// una barbería con su equipo y sus precios, así que su promo también es suya;
// para repetirla en otra está el botón de copiar.

const VACIO = {
  codigo: '',
  tipo: 'porcentaje',
  valor: 20,
  activo: true,
  desde: '',
  hasta: '',
  serviciosIds: [],
  profesionalesIds: [],
  soloPrimeraVisita: false,
  maxUsos: 0,
  maxUsosPorCliente: 0,
};

/** Un precio de referencia para la vista previa: el servicio más caro. */
function precioDeMuestra(services) {
  const activos = services.filter((s) => s.isActive !== false);
  return activos.length ? Math.max(...activos.map((s) => Number(s.price) || 0)) : 10000;
}

export default function CuponesPage() {
  const { business, businessId, services, professionals } = useTenant();

  // `cargando` se deriva de QUÉ barbería tienen los datos que están en
  // memoria, en vez de ponerse a mano al arrancar el efecto: un setState
  // sincrónico adentro del efecto dispara un render de más en cada cambio de
  // sucursal (y el lint lo marca, con razón). Mismo criterio que
  // `useSucursalesPublicas`.
  const [datos, setDatos] = useState({ businessId: null, filas: [] });
  const [editando, setEditando] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!businessId) return;
    return subscribeCupones(businessId, (filas) => {
      setDatos({
        businessId,
        filas: filas.sort((a, b) => String(a.codigo).localeCompare(String(b.codigo))),
      });
    }, (err) => {
      console.error('[cupones] No se pudieron leer:', err);
      setError('No se pudieron leer tus cupones.');
      setDatos({ businessId, filas: [] });
    });
  }, [businessId]);

  const cargando = datos.businessId !== businessId;
  const cupones = cargando ? [] : datos.filas;

  const precioMuestra = useMemo(() => precioDeMuestra(services), [services]);

  const guardar = async (datos) => {
    const codigo = normalizarCodigo(datos.codigo);
    if (!codigoValido(codigo)) {
      setError('El código tiene que tener entre 3 y 24 letras o números, sin espacios.');
      return false;
    }
    const valor = Number(datos.valor);
    if (!(valor > 0)) { setError('El descuento tiene que ser mayor a cero.'); return false; }
    if (datos.tipo === 'porcentaje' && valor > 100) { setError('Un porcentaje no puede pasar de 100.'); return false; }
    if (datos.desde && datos.hasta && datos.desde >= datos.hasta) {
      setError('La fecha de fin tiene que ser posterior a la de inicio.');
      return false;
    }
    // Cambiar el código de un cupón que ya existe sería otro cupón: el código
    // ES el id del documento. Se avisa en vez de crear un duplicado en silencio.
    if (editando?.existente && editando.codigoOriginal !== codigo) {
      setError('El código no se puede cambiar. Creá uno nuevo y apagá este.');
      return false;
    }

    setError('');
    try {
      await guardarCupon(businessId, codigo, {
        codigo,
        tipo: datos.tipo,
        valor,
        activo: datos.activo === true,
        desde: datos.desde || null,
        hasta: datos.hasta || null,
        serviciosIds: datos.serviciosIds || [],
        profesionalesIds: datos.profesionalesIds || [],
        soloPrimeraVisita: datos.soloPrimeraVisita === true,
        maxUsos: Number(datos.maxUsos) || 0,
        maxUsosPorCliente: Number(datos.maxUsosPorCliente) || 0,
      });
      setEditando(null);
      return true;
    } catch (err) {
      console.error('[cupones] No se pudo guardar:', err);
      setError('No se pudo guardar: ' + err.message);
      return false;
    }
  };

  const eliminar = async (c) => {
    if (!window.confirm(`¿Borrar el cupón ${c.codigo}? Los turnos que ya lo usaron no cambian.`)) return;
    try {
      await borrarCupon(businessId, c.codigo);
    } catch (err) {
      setError('No se pudo borrar: ' + err.message);
    }
  };

  if (!business) return null;

  return (
    <div>
      <div className="admin-page-header">
        <h1>Cupones</h1>
        {!editando && (
          <button className="btn btn-primary" onClick={() => setEditando({ ...VACIO, existente: false })}>
            + Nuevo cupón
          </button>
        )}
      </div>

      {error && <div className="notice notice-danger" style={{ marginBottom: 'var(--space-md)' }}>{error}</div>}

      {editando && (
        <FormularioCupon
          valor={editando}
          services={services}
          professionals={professionals}
          precioMuestra={precioMuestra}
          currency={business.currency}
          onCancelar={() => { setEditando(null); setError(''); }}
          onGuardar={guardar}
        />
      )}

      {cargando && <div className="empty-state"><p>Cargando…</p></div>}

      {!cargando && cupones.length === 0 && !editando && (
        <div className="card empty-state" style={{ padding: 'var(--space-2xl)' }}>
          <div className="empty-state-icon">🎟️</div>
          <h3>Todavía no tenés cupones</h3>
          <p className="text-secondary">
            Un cupón es un código con descuento que compartís por Instagram o pegás en el
            mostrador con un QR. Cuando alguien lo usa, vas a ver acá cuántos turnos trajo
            y cuánta plata.
          </p>
          <button className="btn btn-primary mt-lg" onClick={() => setEditando({ ...VACIO, existente: false })}>
            Crear el primero
          </button>
        </div>
      )}

      <div className="cupones-lista">
        {cupones.map((c) => (
          <TarjetaCupon
            key={c.id}
            cupon={c}
            slug={business.slug}
            nombre={business.name}
            currency={business.currency}
            services={services}
            professionals={professionals}
            onEditar={() => setEditando({ ...VACIO, ...c, existente: true, codigoOriginal: c.codigo })}
            onActivar={(v) => activarCupon(businessId, c.codigo, v).catch((e) => setError(e.message))}
            onBorrar={() => eliminar(c)}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function FormularioCupon({ valor, services, professionals, precioMuestra, currency, onCancelar, onGuardar }) {
  const [f, setF] = useState(valor);
  const [masCondiciones, setMasCondiciones] = useState(
    Boolean(valor.desde || valor.hasta || valor.maxUsos || valor.maxUsosPorCliente
            || valor.soloPrimeraVisita || valor.serviciosIds?.length || valor.profesionalesIds?.length)
  );
  const [guardando, setGuardando] = useState(false);
  const set = (patch) => setF((x) => ({ ...x, ...patch }));

  const alternar = (campo, id) => {
    const actual = f[campo] || [];
    set({ [campo]: actual.includes(id) ? actual.filter((x) => x !== id) : [...actual, id] });
  };

  // Lo que le va a pasar a un cliente, con el servicio más caro. Sin esto, el
  // dueño escribe "20" en un cupón fijo creyendo que son 20% y lo descubre con
  // el primer turno cobrado de menos.
  const muestra = calcularDescuento({ tipo: f.tipo, valor: Number(f.valor) || 0 }, precioMuestra);

  return (
    <div className="card mb-md">
      <h3 className="mb-md">{f.existente ? `Editar ${f.codigo}` : 'Nuevo cupón'}</h3>

      <div className="cupon-form-grid">
        <div className="form-group">
          <label className="form-label">Código</label>
          <input
            className="form-input"
            value={f.codigo}
            disabled={f.existente}
            maxLength={24}
            placeholder="CORTE20"
            onChange={(e) => set({ codigo: normalizarCodigo(e.target.value) })}
          />
          <p className="text-sm text-muted" style={{ marginTop: 4 }}>
            {f.existente
              ? 'El código no se puede cambiar.'
              : 'Lo que el cliente escribe. Sin espacios; da igual si lo pone en minúscula.'}
          </p>
        </div>

        <div className="form-group">
          <label className="form-label">Tipo</label>
          <select className="form-input" value={f.tipo} onChange={(e) => set({ tipo: e.target.value })}>
            <option value="porcentaje">Porcentaje (%)</option>
            <option value="fijo">Monto fijo ($)</option>
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">{f.tipo === 'porcentaje' ? 'Cuánto descuenta (%)' : 'Cuánto descuenta ($)'}</label>
          <input
            type="number"
            min="1"
            max={f.tipo === 'porcentaje' ? 100 : undefined}
            className="form-input"
            value={f.valor}
            onChange={(e) => set({ valor: e.target.value })}
          />
        </div>
      </div>

      <div className="cupon-muestra">
        En un servicio de {formatPrice(precioMuestra, currency)} el cliente paga{' '}
        <strong>{formatPrice(muestra.precioFinal, currency)}</strong>{' '}
        (−{formatPrice(muestra.descuento, currency)})
      </div>

      <label className="pagina-check" style={{ marginTop: 'var(--space-md)' }}>
        <input type="checkbox" checked={f.activo === true} onChange={(e) => set({ activo: e.target.checked })} />
        <span>Está andando (los clientes lo pueden usar)</span>
      </label>

      <button
        type="button"
        className="btn btn-ghost btn-sm"
        style={{ marginTop: 'var(--space-md)' }}
        onClick={() => setMasCondiciones((v) => !v)}
      >
        {masCondiciones ? '− Menos condiciones' : '+ Más condiciones'}
      </button>

      {masCondiciones && (
        <div className="cupon-condiciones">
          <div className="cupon-form-grid">
            <div className="form-group">
              <label className="form-label">Desde</label>
              <input type="datetime-local" className="form-input" value={f.desde || ''} onChange={(e) => set({ desde: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Hasta</label>
              <input type="datetime-local" className="form-input" value={f.hasta || ''} onChange={(e) => set({ hasta: e.target.value })} />
            </div>
          </div>

          <div className="cupon-form-grid">
            <div className="form-group">
              <label className="form-label">Máximo de usos</label>
              <input type="number" min="0" className="form-input" value={f.maxUsos || ''} placeholder="sin tope" onChange={(e) => set({ maxUsos: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Máximo por cliente</label>
              <input type="number" min="0" className="form-input" value={f.maxUsosPorCliente || ''} placeholder="sin tope" onChange={(e) => set({ maxUsosPorCliente: e.target.value })} />
            </div>
          </div>

          <label className="pagina-check">
            <input type="checkbox" checked={f.soloPrimeraVisita === true} onChange={(e) => set({ soloPrimeraVisita: e.target.checked })} />
            <span>Solo para clientes que nunca vinieron</span>
          </label>

          <div className="form-group" style={{ marginTop: 'var(--space-md)' }}>
            <label className="form-label">Servicios</label>
            <p className="text-sm text-muted" style={{ marginBottom: 6 }}>Sin tildar ninguno, vale para todos.</p>
            <div className="cupon-chips">
              {services.filter((s) => s.isActive !== false).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`cupon-chip ${(f.serviciosIds || []).includes(s.id) ? 'activo' : ''}`}
                  onClick={() => alternar('serviciosIds', s.id)}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Barberos</label>
            <p className="text-sm text-muted" style={{ marginBottom: 6 }}>Sin tildar ninguno, vale con todos.</p>
            <div className="cupon-chips">
              {professionals.filter((p) => p.isActive !== false).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`cupon-chip ${(f.profesionalesIds || []).includes(p.id) ? 'activo' : ''}`}
                  onClick={() => alternar('profesionalesIds', p.id)}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-lg)' }}>
        <button
          className="btn btn-primary"
          disabled={guardando}
          onClick={async () => { setGuardando(true); await onGuardar(f); setGuardando(false); }}
        >
          {guardando ? 'Guardando…' : 'Guardar cupón'}
        </button>
        <button className="btn btn-ghost" onClick={onCancelar}>Cancelar</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function TarjetaCupon({ cupon, slug, nombre, currency, services, professionals, onEditar, onActivar, onBorrar }) {
  const [copiado, setCopiado] = useState('');
  const [verQr, setVerQr] = useState(false);
  const estado = estadoDelCupon(cupon);
  const link = linkDelCupon(slug, cupon.codigo);

  const copiar = async (texto, que) => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(que);
      setTimeout(() => setCopiado(''), 2000);
    } catch {
      // Sin permiso de portapapeles (pasa en algunos navegadores sin HTTPS):
      // se le muestra el texto para que lo copie a mano en vez de no hacer nada.
      window.prompt('Copiá esto:', texto);
    }
  };

  const nombresDe = (ids, lista) => (ids || [])
    .map((id) => lista.find((x) => x.id === id)?.name)
    .filter(Boolean)
    .join(', ');

  const condiciones = [
    cupon.soloPrimeraVisita && 'solo primera visita',
    cupon.maxUsos > 0 && `${cupon.maxUsos} usos en total`,
    cupon.maxUsosPorCliente > 0 && `${cupon.maxUsosPorCliente} por cliente`,
    cupon.serviciosIds?.length > 0 && `solo ${nombresDe(cupon.serviciosIds, services)}`,
    cupon.profesionalesIds?.length > 0 && `solo con ${nombresDe(cupon.profesionalesIds, professionals)}`,
    cupon.hasta && `hasta el ${new Date(cupon.hasta).toLocaleDateString('es-AR')}`,
  ].filter(Boolean);

  return (
    <div className="card cupon-tarjeta">
      <div className="cupon-tarjeta-head">
        <div>
          <div className="cupon-codigo">{cupon.codigo}</div>
          <div className="text-sm text-secondary">{describirCupon(cupon)}</div>
        </div>
        <span className={`badge ${estado.clase}`}>{estado.label}</span>
      </div>

      {condiciones.length > 0 && (
        <p className="text-sm text-muted cupon-condiciones-resumen">{condiciones.join(' · ')}</p>
      )}

      {/* Los tres números por los que se crea un cupón. `usos` son los
          reservados (incluye los que todavía no pasaron); los otros dos cuentan
          lo que de verdad ocurrió. */}
      <div className="cupon-numeros">
        <div>
          <strong>{cupon.usosConfirmados || 0}</strong>
          <span>turnos</span>
        </div>
        <div>
          <strong>{formatPrice(cupon.ingresos || 0, currency)}</strong>
          <span>facturado</span>
        </div>
        <div>
          <strong>{cupon.clientesNuevos || 0}</strong>
          <span>clientes nuevos</span>
        </div>
      </div>

      {(cupon.usos || 0) > (cupon.usosConfirmados || 0) && (
        <p className="text-sm text-muted">
          {(cupon.usos || 0) - (cupon.usosConfirmados || 0)} turno(s) reservado(s) todavía sin atender.
        </p>
      )}

      <div className="cupon-acciones">
        <button className="btn btn-sm btn-outline" onClick={() => copiar(link, 'link')}>
          {copiado === 'link' ? '✅ Copiado' : 'Copiar link'}
        </button>
        <button
          className="btn btn-sm btn-outline"
          onClick={() => copiar(mensajeParaCompartir(cupon, nombre, link), 'mensaje')}
        >
          {copiado === 'mensaje' ? '✅ Copiado' : 'Copiar mensaje'}
        </button>
        <button className="btn btn-sm btn-outline" onClick={() => setVerQr((v) => !v)}>
          {verQr ? 'Ocultar QR' : 'Ver QR'}
        </button>
        <button className="btn btn-sm btn-ghost" onClick={onEditar}>Editar</button>
        <button className="btn btn-sm btn-ghost" onClick={() => onActivar(cupon.activo !== true)}>
          {cupon.activo ? 'Apagar' : 'Prender'}
        </button>
        <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={onBorrar}>
          Borrar
        </button>
      </div>

      {verQr && <QrDelCupon link={link} codigo={cupon.codigo} />}
    </div>
  );
}
