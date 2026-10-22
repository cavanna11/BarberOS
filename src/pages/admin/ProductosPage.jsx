import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTenant } from '../../hooks/useTenantData';
import {
  obtenerSubcoleccion,
  addToSubcollection,
  updateInSubcollection,
  removeFromSubcollection,
  guardarOrden,
} from '../../lib/repository';
import { formatPrice, fechaDMA } from '../../utils/dateUtils';
import { mover, puedeMover, ordenados } from '../../utils/orden';
import { redimensionarImagen, FOTO_MAX_BYTES } from '../../utils/imagen';
import {
  errorDeProducto,
  normalizarProducto,
  controlaStock,
  stockDe,
  STOCK_BAJO,
} from '../../utils/productos';

// ============================================================================
// Productos: la mercadería que el barbero vende al lado del corte
// ============================================================================
// "Los barberos quieren subir una cera para el pelo que venden." Es una
// pantalla de catálogo, no de agenda: nombre, precio, stock y foto.
//
// ── Por qué se lee de UNA vez y no con una suscripción ─────────────────────
// Los productos llevan foto, y la foto va adentro del documento (data URL,
// igual que la del barbero y el logo). Si entraran en la suscripción
// permanente de `BusinessSync`, esas imágenes se bajarían en TODAS las
// pantallas del panel, todo el tiempo, incluso para el barbero que nunca abre
// esta. Se leen al entrar, y hay un botón para volver a leer. Mismo criterio
// que "Mis sucursales" y las reseñas.
//
// (No rompe la regla de "las suscripciones viven en BusinessSync": esto no es
// una suscripción, es una lectura.)
//
// ── El stock que se ve acá puede estar un minuto viejo, y está bien ────────
// La autoridad es el servidor: `createAppointment` lee el stock adentro de su
// transacción y rechaza con el motivo exacto. Lo de acá es para reponer, no
// para decidir una venta.

const VACIO = {
  name: '',
  price: '',
  stock: '',
  descripcion: '',
  imagenUrl: null,
  isActive: true,
};

export default function ProductosPage() {
  const { businessId, business, professionals } = useTenant();

  const [productos, setProductos] = useState([]);
  const [ventas, setVentas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState('');
  const [errorVentas, setErrorVentas] = useState('');

  const [editando, setEditando] = useState(null); // el producto, o 'nuevo'
  const [form, setForm] = useState(VACIO);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [subiendo, setSubiendo] = useState(false);

  const leer = useCallback(async () => {
    if (!businessId) return;
    setCargando(true);
    setErrorCarga('');
    setErrorVentas('');
    try {
      const prods = await obtenerSubcoleccion(businessId, 'productos');
      setProductos(prods);

      // Las ventas se leen aparte y el error se MUESTRA.
      //
      // Acá había un `.catch(() => [])`, y duró medio día: con la lectura
      // denegada la pantalla quedaba igualita a una barbería que no vendió
      // nada. Santiago vendió un producto, la venta estaba escrita, y esta
      // pantalla no decía ni que existía ni que no la podía leer. Un catálogo
      // que se lee no justifica esconder que las ventas no.
      try {
        setVentas(await obtenerSubcoleccion(businessId, 'ventasProductos'));
      } catch (e) {
        setVentas([]);
        setErrorVentas(e?.code === 'permission-denied'
          ? 'No se pudieron leer las ventas: esta cuenta no tiene permiso sobre ellas. Las ventas sí se están registrando.'
          : (e?.message || 'No se pudieron leer las ventas.'));
      }
    } catch (e) {
      // Un catch vacío acá dejaría la pantalla con "no hay productos" cuando lo
      // que pasó es que no se pudieron leer. Son dos cosas distintas y el dueño
      // tiene que saber cuál es.
      setErrorCarga(e?.message || 'No se pudieron leer los productos.');
    } finally {
      setCargando(false);
    }
  }, [businessId]);

  useEffect(() => { leer(); }, [leer]);

  const lista = useMemo(() => ordenados(productos), [productos]);

  // Lo vendido, por barbero. Es la pregunta que originó la pantalla: "si hay un
  // barbero que la vende, que quede registrado que la vendió ese barbero".
  //
  // Cuenta lo ENTREGADO y lo PENDIENTE por separado, pero muestra las dos
  // cosas. La primera versión contaba solo lo entregado —o sea, solo los turnos
  // ya marcados como atendidos— y la tabla no aparecía hasta entonces: el dueño
  // vendía una cera, venía a ver quién la vendió, y encontraba la pantalla
  // vacía. La pregunta "¿quién vendió?" se contesta cuando la venta ocurre, no
  // cuando alguien se acuerda de cerrar el turno.
  //
  // Lo devuelto (turno cancelado o cliente que no vino) NO cuenta: esa
  // mercadería nunca salió del estante.
  const porBarbero = useMemo(() => {
    const acc = new Map();
    for (const v of ventas) {
      if (!v || (v.estado !== 'vendido' && v.estado !== 'reservado')) continue;
      const id = v.professionalId || 'sin-barbero';
      const prev = acc.get(id) || {
        id,
        nombre: v.professionalName || professionals.find((p) => p.id === id)?.name || 'Sin barbero',
        unidades: 0,
        total: 0,
        pendientes: 0,
        ultima: null,
      };
      const u = (v.items || []).reduce((t, i) => t + (Number(i.cantidad) || 0), 0);
      prev.unidades += u;
      prev.total += Number(v.total) || 0;
      if (v.estado === 'reservado') prev.pendientes += u;
      if (!prev.ultima || String(v.fecha || '') > prev.ultima) prev.ultima = v.fecha || null;
      acc.set(id, prev);
    }
    return [...acc.values()].sort((a, b) => b.total - a.total);
  }, [ventas, professionals]);

  const pendientes = useMemo(
    () => ventas.filter((v) => v && v.estado === 'reservado'),
    [ventas]
  );

  const abrir = (p) => {
    setEditando(p || 'nuevo');
    setForm(p ? {
      name: p.name || '',
      price: p.price ?? '',
      stock: controlaStock(p) ? String(p.stock) : '',
      descripcion: p.descripcion || '',
      imagenUrl: p.imagenUrl || null,
      isActive: p.isActive !== false,
    } : VACIO);
    setError('');
  };

  const cerrar = () => { setEditando(null); setForm(VACIO); setError(''); };

  const elegirImagen = async (file) => {
    if (!file) return;
    setSubiendo(true);
    setError('');
    try {
      const dataUrl = await redimensionarImagen(file, 320);
      if (dataUrl.length > FOTO_MAX_BYTES) {
        setError('La foto quedó muy pesada. Probá con otra.');
        return;
      }
      setForm((f) => ({ ...f, imagenUrl: dataUrl }));
    } catch {
      setError('No se pudo leer esa imagen.');
    } finally {
      setSubiendo(false);
    }
  };

  const guardar = async () => {
    const malo = errorDeProducto(form);
    if (malo) return setError(malo);

    setGuardando(true);
    try {
      const datos = normalizarProducto({
        ...form,
        displayOrder: editando === 'nuevo' ? productos.length + 1 : editando.displayOrder,
      });
      if (editando === 'nuevo') {
        await addToSubcollection(businessId, 'productos', { ...datos, vendidos: 0 });
      } else {
        await updateInSubcollection(businessId, 'productos', editando.id, datos);
      }
      cerrar();
      await leer();
    } catch (e) {
      setError(e?.message || 'No se pudo guardar.');
    } finally {
      setGuardando(false);
    }
  };

  const borrar = async (p) => {
    // Se avisa que la venta queda: el documento de ventas es el informe y no
    // se toca. Borrar el producto saca el renglón del catálogo, no la historia.
    if (!window.confirm(`¿Sacar ${p.name} del catálogo? Las ventas que ya hizo quedan registradas.`)) return;
    try {
      await removeFromSubcollection(businessId, 'productos', p.id);
      await leer();
    } catch (e) {
      setErrorCarga(e?.message || 'No se pudo borrar.');
    }
  };

  const reordenar = async (id, direccion) => {
    const cambios = mover(lista, id, direccion);
    if (!cambios.length) return;
    // Optimista: la flecha tiene que responder al toque. Si la escritura falla,
    // la próxima lectura lo acomoda.
    setProductos((ps) => ps.map((p) => {
      const c = cambios.find((x) => x.id === p.id);
      return c ? { ...p, displayOrder: c.displayOrder } : p;
    }));
    try {
      await guardarOrden(businessId, 'productos', cambios);
    } catch (e) {
      setErrorCarga(e?.message || 'No se pudo guardar el orden.');
      await leer();
    }
  };

  const reponer = async (p, cuantas) => {
    const actual = stockDe(p) ?? 0;
    const nuevo = Math.max(0, actual + cuantas);
    setProductos((ps) => ps.map((x) => (x.id === p.id ? { ...x, stock: nuevo } : x)));
    try {
      await updateInSubcollection(businessId, 'productos', p.id, { stock: nuevo });
    } catch (e) {
      setErrorCarga(e?.message || 'No se pudo actualizar el stock.');
      await leer();
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Productos</h1>
          <p className="text-secondary">
            La mercadería que vendés: cera, shampoo, pomada. El cliente la puede sumar al
            reservar su turno y la paga en el local, junto con el corte.
          </p>
        </div>
        <div className="flex gap-sm">
          <button className="btn btn-outline" onClick={leer} disabled={cargando}>
            {cargando ? 'Leyendo…' : 'Actualizar'}
          </button>
          <button className="btn btn-primary" onClick={() => abrir(null)}>+ Agregar producto</button>
        </div>
      </div>

      {errorCarga && <div className="notice notice-danger">{errorCarga}</div>}
      {errorVentas && <div className="notice notice-danger">{errorVentas}</div>}

      {/* Lo que el cliente pidió y todavía no se entregó. Va arriba porque es
          lo único de esta pantalla que hay que HACER: el barbero tiene que
          acordarse de darle la cera cuando venga. */}
      {pendientes.length > 0 && (
        <div className="notice notice-info">
          <strong>
            {pendientes.length === 1
              ? 'Hay 1 producto pedido para entregar'
              : `Hay ${pendientes.length} productos pedidos para entregar`}
            .
          </strong>
          <p className="text-sm" style={{ margin: '6px 0 0' }}>
            Aparecen en el turno de cada cliente, en <strong>Citas</strong>. Se descuentan del
            stock al reservar y se cuentan como vendidos cuando marcás el turno como atendido.
            Si el cliente no viene o cancela, las unidades vuelven solas.
          </p>
        </div>
      )}

      {cargando && productos.length === 0 ? (
        <div className="card"><p className="text-secondary">Leyendo los productos…</p></div>
      ) : lista.length === 0 ? (
        <div className="card">
          <h3>Todavía no cargaste ningún producto</h3>
          <p className="text-secondary">
            Si vendés cera, shampoo o pomada, cargalos acá con su precio. Al reservar, el cliente
            los va a ver después de elegir el servicio y los puede sumar a su turno.
          </p>
          <button className="btn btn-primary mt-md" onClick={() => abrir(null)}>+ Agregar el primero</button>
        </div>
      ) : (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Precio</th>
                <th>Stock</th>
                <th className="oculta-mobile">Vendidos</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((p) => {
                const s = stockDe(p);
                const agotado = s !== null && s <= 0;
                const poco = s !== null && s > 0 && s <= STOCK_BAJO;
                return (
                  <tr key={p.id}>
                    <td>
                      <div className="producto-celda">
                        {p.imagenUrl
                          ? <img src={p.imagenUrl} alt="" className="producto-miniatura" />
                          : <span className="producto-miniatura producto-miniatura-vacia">🧴</span>}
                        <div>
                          <strong>{p.name}</strong>
                          {p.descripcion && <div className="text-sm text-muted">{p.descripcion}</div>}
                        </div>
                      </div>
                    </td>
                    <td><strong>{formatPrice(p.price, business?.currency)}</strong></td>
                    <td>
                      {s === null ? (
                        <span className="text-sm text-secondary">Sin control</span>
                      ) : (
                        <div className="producto-stock">
                          <span className={agotado ? 'badge badge-danger' : poco ? 'badge badge-warning' : 'badge badge-neutral'}>
                            {agotado ? 'Agotado' : `${s} u.`}
                          </span>
                          <button className="btn btn-ghost btn-sm orden-flecha" title="Sumar una unidad"
                            onClick={() => reponer(p, 1)}>＋</button>
                          <button className="btn btn-ghost btn-sm orden-flecha" title="Restar una unidad"
                            disabled={agotado} onClick={() => reponer(p, -1)}>−</button>
                        </div>
                      )}
                    </td>
                    <td className="oculta-mobile">{Number(p.vendidos) || 0}</td>
                    <td>
                      <span className={`badge ${p.isActive !== false ? 'badge-success' : 'badge-neutral'}`}>
                        {p.isActive !== false ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td>
                      <div className="table-actions">
                        <button className="btn btn-ghost btn-sm orden-flecha" title="Mostrarlo antes"
                          disabled={!puedeMover(lista, p.id).arriba} onClick={() => reordenar(p.id, 'arriba')}>▲</button>
                        <button className="btn btn-ghost btn-sm orden-flecha" title="Mostrarlo después"
                          disabled={!puedeMover(lista, p.id).abajo} onClick={() => reordenar(p.id, 'abajo')}>▼</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => abrir(p)}>✏️</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => borrar(p)}>🗑️</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Quién vendió qué. El stock es del local y cualquiera lo vende; lo que
          se registra es quién. */}
      {porBarbero.length > 0 && (
        <div className="card mt-lg">
          <h3>Quién vendió</h3>
          <p className="text-secondary text-sm mb-md">
            El stock es del local y lo vende cualquiera: lo que queda registrado es quién hizo
            cada venta. Lo que el cliente todavía no retiró se cuenta igual y se marca como
            pendiente. Lo de un turno cancelado, o de alguien que no vino, no cuenta: esa
            mercadería no salió del estante.
          </p>
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Barbero</th>
                  <th>Unidades</th>
                  <th>Total</th>
                  <th>Sin retirar</th>
                  <th className="oculta-mobile">Última venta</th>
                </tr>
              </thead>
              <tbody>
                {porBarbero.map((b) => (
                  <tr key={b.id}>
                    <td><strong>{b.nombre}</strong></td>
                    <td>{b.unidades}</td>
                    <td><strong>{formatPrice(b.total, business?.currency)}</strong></td>
                    <td>{b.pendientes > 0
                      ? <span className="badge badge-warning">{b.pendientes}</span>
                      : <span className="text-muted">—</span>}</td>
                    <td className="oculta-mobile">{b.ultima ? fechaDMA(b.ultima) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editando && (
        <div className="modal-overlay" onClick={cerrar}>
          <div className="modal-content" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editando === 'nuevo' ? 'Nuevo producto' : editando.name}</h2>
              <button className="modal-close" onClick={cerrar}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Nombre</label>
                <input className="form-input" value={form.name} autoFocus
                  placeholder="Cera mate 100 g"
                  onChange={(e) => { setForm((f) => ({ ...f, name: e.target.value })); setError(''); }} />
              </div>

              <div className="ausencias-franja">
                <div className="form-group">
                  <label className="form-label">Precio</label>
                  <input className="form-input" type="number" min="0" step="100" value={form.price}
                    onChange={(e) => { setForm((f) => ({ ...f, price: e.target.value })); setError(''); }} />
                </div>
                <div className="form-group">
                  <label className="form-label">Stock</label>
                  <input className="form-input" type="number" min="0" step="1" value={form.stock}
                    placeholder="Vacío = no lo controlo"
                    onChange={(e) => { setForm((f) => ({ ...f, stock: e.target.value })); setError(''); }} />
                </div>
              </div>
              <p className="text-sm text-secondary" style={{ marginTop: -4 }}>
                Dejá el stock <strong>vacío</strong> si no querés contar unidades: el producto se
                ofrece siempre. Con un número, cuando llega a cero deja de ofrecerse solo.
              </p>

              <div className="form-group">
                <label className="form-label">Descripción (opcional)</label>
                <input className="form-input" value={form.descripcion} maxLength={300}
                  placeholder="Fijación fuerte, sin brillo"
                  onChange={(e) => setForm((f) => ({ ...f, descripcion: e.target.value }))} />
              </div>

              <div className="form-group">
                <label className="form-label">Foto (opcional)</label>
                <div className="producto-foto-editor">
                  {form.imagenUrl
                    ? <img src={form.imagenUrl} alt="" className="producto-foto-previa" />
                    : <span className="producto-foto-previa producto-miniatura-vacia">🧴</span>}
                  <div className="flex gap-sm">
                    <label className="btn btn-outline btn-sm">
                      {subiendo ? 'Procesando…' : form.imagenUrl ? 'Cambiar' : 'Elegir foto'}
                      <input type="file" accept="image/*" hidden
                        onChange={(e) => elegirImagen(e.target.files?.[0])} />
                    </label>
                    {form.imagenUrl && (
                      <button className="btn btn-ghost btn-sm"
                        onClick={() => setForm((f) => ({ ...f, imagenUrl: null }))}>Quitar</button>
                    )}
                  </div>
                </div>
              </div>

              <label className="ausencias-check">
                <input type="checkbox" checked={form.isActive}
                  onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
                <span>Lo ofrezco a los clientes</span>
              </label>

              {error && <div className="notice notice-danger">{error}</div>}
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={cerrar}>Cancelar</button>
              <button className="btn btn-primary" onClick={guardar} disabled={guardando || subiendo}>
                {guardando ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
