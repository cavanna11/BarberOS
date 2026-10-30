import { useEffect, useId, useState } from 'react';
import { useTenant } from '../../hooks/useTenantData';
import { obtenerCampanas, obtenerTarjetasCompletas } from '../../lib/repository';
import { guardarCampana, reiniciarTarjeta } from '../../lib/functions';
import { validarCampana, restoSinPremio, segmentosDelJuego, describirPremio, repartirProbabilidades, COLORES } from '../../utils/recompensas';
import { diasEnTexto } from '../../components/recompensas/movimiento';
import Rueda from '../../components/recompensas/Rueda';
import TarjetaFidelidad from '../../components/recompensas/TarjetaFidelidad';

// ============================================================================
// Recompensas: las campañas de fidelización de la barbería
// ============================================================================
// Siete campañas, TODAS apagadas hasta que el dueño las configura y prende.
// La pantalla es una grilla: cada tarjeta dice qué es, si está andando y cuánto
// dio, con Configurar y Activar/Desactivar a mano.
//
// Nada de esto se escribe desde acá: el editor arma la configuración y la manda
// a `guardarCampana`, que la valida de nuevo en el servidor. La validación en
// vivo de abajo es el MISMO motor (`utils/recompensas.js` es copia generada de
// `functions/recompensasMotor.js`), así que lo que el panel acepta es lo que el
// servidor acepta.
//
// Las campañas son de ESTA barbería. En una cuenta con sucursales cada local
// tiene las suyas, como los cupones: sus servicios y sus clientes son otros.

const CAMPANAS = [
  { tipo: 'ruleta', icono: '🎡', nombre: 'Ruleta', desc: 'El cliente gira antes de confirmar su turno y se lleva un descuento. Genera ganas de reservar.' },
  { tipo: 'fidelidad', icono: '🎟️', nombre: 'Tarjeta de fidelidad', desc: 'Una casilla por cada turno atendido. Al completarla, gana la recompensa que elijas.' },
  { tipo: 'caja', icono: '🎁', nombre: 'Caja sorpresa', desc: 'Una caja para abrir desde "Tus premios" cada tantos días. Lo trae de vuelta a mirar.' },
  { tipo: 'rasca', icono: '🎫', nombre: 'Rasca y ganá', desc: 'Después de cada turno atendido, una tarjeta para raspar con el dedo.' },
  { tipo: 'happyHour', icono: '⏰', nombre: 'Happy hour', desc: 'Descuento automático en los días y horarios flojos. El cliente no tiene que hacer nada.' },
  { tipo: 'racha', icono: '🔥', nombre: 'Racha', desc: 'Volver antes de cierta cantidad de días mantiene la racha. Más racha, mejor premio.' },
  { tipo: 'cumpleanos', icono: '🎂', nombre: 'Cumpleaños', desc: 'Un regalo automático en el cumpleaños del cliente.' },
];

const premioBase = (extra = {}) => ({ tipo: 'porcentaje', valor: 10, nombre: '', serviceIds: [], icono: '🎁', color: COLORES[0], ...extra });

// Lo que propone el editor la primera vez. Nunca se guarda solo: es el punto de
// partida del formulario. La ruleta arranca con el ejemplo del pedido original.
const POR_DEFECTO = {
  ruleta: {
    premios: [
      premioBase({ valor: 5, probabilidad: 40, icono: '💸', color: COLORES[2] }),
      premioBase({ valor: 10, probabilidad: 25, icono: '✂️', color: COLORES[0] }),
      premioBase({ valor: 15, probabilidad: 15, icono: '⭐', color: COLORES[3] }),
      premioBase({ valor: 20, probabilidad: 8, icono: '🔥', color: COLORES[1] }),
      premioBase({ tipo: 'gratis', valor: 0, nombre: 'Corte gratis', probabilidad: 2, icono: '💈', color: COLORES[6] }),
    ],
    frecuenciaDias: 30, diasVencimiento: 30, textoSinPremio: 'Seguí participando',
  },
  caja: {
    premios: [
      premioBase({ valor: 10, probabilidad: 60, icono: '💸', color: COLORES[2] }),
      premioBase({ valor: 20, probabilidad: 30, icono: '🔥', color: COLORES[0] }),
      premioBase({ tipo: 'gratis', valor: 0, nombre: 'Corte gratis', probabilidad: 10, icono: '💈', color: COLORES[1] }),
    ],
    frecuenciaDias: 15, diasVencimiento: 30, textoSinPremio: 'Esta vez no',
  },
  rasca: {
    premios: [
      premioBase({ valor: 10, probabilidad: 50, icono: '💸', color: COLORES[2] }),
      premioBase({ tipo: 'personalizado', valor: 0, nombre: 'Café de regalo', probabilidad: 20, icono: '☕', color: COLORES[5] }),
    ],
    diasVencimiento: 30, textoSinPremio: 'Esta vez no',
  },
  fidelidad: {
    casillas: 10, premio: premioBase({ tipo: 'gratis', valor: 0, nombre: 'Corte gratis', icono: '💈' }),
    reinicio: 'automatico', color: '#e03d00', diseno: 'clasico', diasVencimiento: 60,
  },
  happyHour: { dias: [0, 1, 2], desde: '14:00', hasta: '17:00', porcentaje: 15, serviceIds: [] },
  racha: {
    diasMax: 30,
    niveles: [
      { racha: 3, premio: premioBase({ valor: 10 }) },
      { racha: 5, premio: premioBase({ tipo: 'gratis', valor: 0, nombre: 'Corte gratis', icono: '💈' }) },
    ],
    diasVencimiento: 60,
  },
  cumpleanos: { premio: premioBase({ valor: 20, nombre: 'Regalo de cumpleaños', icono: '🎂' }), diasAntes: 7, diasDespues: 15 },
};

/** Una línea con lo esencial de la campaña, para la tarjeta de la grilla. */
function resumen(tipo, c) {
  if (!c) return null;
  if (tipo === 'ruleta' || tipo === 'caja' || tipo === 'rasca') {
    const sin = restoSinPremio(c.premios) / 100;
    const partes = [`${c.premios.length} ${c.premios.length === 1 ? 'premio' : 'premios'}`];
    if (sin > 0) partes.push(`${sin.toLocaleString('es-AR')}% sin premio`);
    if (c.frecuenciaDias) partes.push(c.frecuenciaDias === 1 ? 'una vez por día' : `una vez cada ${c.frecuenciaDias} días`);
    if (tipo === 'rasca') partes.push('una por turno atendido');
    return partes.join(' · ');
  }
  if (tipo === 'fidelidad') return `${c.casillas} casillas → ${c.premio?.nombre || describirPremio(c.premio)} · reinicio ${c.reinicio === 'manual' ? 'manual' : 'automático'}`;
  if (tipo === 'happyHour') return `${diasEnTexto(c.dias)} ${c.desde}–${c.hasta} · ${c.porcentaje}% menos`;
  if (tipo === 'racha') return `${c.niveles.map((n) => `${n.racha} visitas → ${n.premio.nombre || describirPremio(n.premio)}`).join(' · ')} · volver antes de ${c.diasMax} días`;
  if (tipo === 'cumpleanos') return `${c.premio?.nombre || describirPremio(c.premio)} · de ${c.diasAntes} días antes a ${c.diasDespues} después`;
  return null;
}

export default function RecompensasPage() {
  const { business, businessId, services } = useTenant();
  const [datos, setDatos] = useState({ businessId: null, campanas: {} });
  const [vuelta, setVuelta] = useState(0);
  const [editando, setEditando] = useState(null);
  const [ocupado, setOcupado] = useState(null);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

  useEffect(() => {
    if (!businessId) return undefined;
    let vigente = true;
    obtenerCampanas(businessId)
      .then((campanas) => { if (vigente) setDatos({ businessId, campanas }); })
      .catch((err) => { if (vigente) { setDatos({ businessId, campanas: {} }); setError(`No se pudieron leer las campañas: ${err.message}`); } });
    return () => { vigente = false; };
  }, [businessId, vuelta]);

  const cargando = datos.businessId !== businessId;
  const campanas = datos.campanas;
  const recargar = () => setVuelta((v) => v + 1);

  if (!business) return null;
  const serviciosReservables = services.filter((s) => s.isActive !== false && !s.adicional);

  const activar = async (tipo, activa) => {
    const c = campanas[tipo];
    // Nunca configurada: "Activar" abre el editor. Prender algo a medio armar
    // es justo lo que "nada activado por defecto" quiere evitar.
    if (activa && !c?.config) {
      setEditando({ tipo, config: c?.config || POR_DEFECTO[tipo] });
      return;
    }
    setOcupado(tipo);
    setError('');
    setAviso('');
    try {
      await guardarCampana({ businessId, tipo, activa });
      setAviso(activa
        ? `${CAMPANAS.find((x) => x.tipo === tipo).nombre} está activa. Tus clientes ya la ven.`
        : `${CAMPANAS.find((x) => x.tipo === tipo).nombre} quedó desactivada. Los premios que ya se ganaron siguen valiendo hasta su vencimiento.`);
      recargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setOcupado(null);
    }
  };

  const guardar = async (tipo, config, activa) => {
    await guardarCampana({ businessId, tipo, activa, config });
    setEditando(null);
    setAviso('Guardado.');
    recargar();
  };

  return (
    <div>
      <div className="admin-page-header">
        <h1>Recompensas</h1>
      </div>
      <p className="text-secondary" style={{ marginTop: 0, maxWidth: 720 }}>
        Campañas para que tus clientes vuelvan: cada una se configura y se prende por separado.
        Están todas apagadas hasta que vos decidas. Los premios se aplican solos al reservar y
        se descuentan cuando marcás el turno como atendido.
      </p>

      {error && <div className="notice notice-danger" role="alert" style={{ marginBottom: 'var(--space-md)' }}>{error}</div>}
      {aviso && <div className="notice notice-success" role="status" style={{ marginBottom: 'var(--space-md)' }}>{aviso}</div>}

      {cargando ? (
        <div className="empty-state"><p>Cargando…</p></div>
      ) : (
        <div className="campanas-grilla">
          {CAMPANAS.map((meta) => {
            const c = campanas[meta.tipo];
            const activa = c?.activa === true;
            const stats = c?.stats || {};
            return (
              <article key={meta.tipo} className={`card campana-card ${activa ? 'activa' : ''}`}>
                <div className="campana-cabeza">
                  <span className="campana-icono" aria-hidden="true">{meta.icono}</span>
                  <div>
                    <h2 className="campana-nombre">{meta.nombre}</h2>
                    <span className={`badge ${activa ? 'badge-success' : 'badge-neutral'}`}>
                      Estado: {activa ? 'Activada' : 'Desactivada'}
                    </span>
                  </div>
                </div>
                <p className="campana-desc">{meta.desc}</p>
                {c?.config ? (
                  <p className="campana-resumen">{resumen(meta.tipo, c.config)}</p>
                ) : (
                  <p className="campana-resumen text-muted">Sin configurar.</p>
                )}
                {(stats.entregados > 0 || stats.usados > 0 || stats.jugadas > 0) && (
                  <dl className="campana-numeros">
                    {stats.jugadas > 0 && <div><dt>Jugadas</dt><dd>{stats.jugadas}</dd></div>}
                    {meta.tipo !== 'happyHour' && <div><dt>Premios dados</dt><dd>{stats.entregados || 0}</dd></div>}
                    {meta.tipo !== 'happyHour' && <div><dt>Usados</dt><dd>{stats.usados || 0}</dd></div>}
                  </dl>
                )}
                <div className="campana-acciones">
                  <button
                    type="button"
                    className="btn btn-sm btn-outline"
                    onClick={() => setEditando({ tipo: meta.tipo, config: c?.config || POR_DEFECTO[meta.tipo], activa })}
                  >
                    Configurar
                  </button>
                  {activa ? (
                    <button type="button" className="btn btn-sm btn-ghost" disabled={ocupado === meta.tipo} onClick={() => activar(meta.tipo, false)}>
                      {ocupado === meta.tipo ? '…' : 'Desactivar'}
                    </button>
                  ) : (
                    <button type="button" className="btn btn-sm btn-primary" disabled={ocupado === meta.tipo} onClick={() => activar(meta.tipo, true)}>
                      {ocupado === meta.tipo ? '…' : 'Activar'}
                    </button>
                  )}
                </div>
                {meta.tipo === 'fidelidad' && c?.config?.reinicio === 'manual' && (
                  <TarjetasLlenas businessId={businessId} vuelta={vuelta} onReiniciada={recargar} />
                )}
              </article>
            );
          })}
        </div>
      )}

      {editando && (
        <EditorCampana
          key={editando.tipo}
          tipo={editando.tipo}
          inicial={editando.config}
          activa={editando.activa === true}
          services={serviciosReservables}
          onCerrar={() => setEditando(null)}
          onGuardar={guardar}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tarjetas llenas esperando reinicio (solo con reinicio manual)

function TarjetasLlenas({ businessId, vuelta, onReiniciada }) {
  const [filas, setFilas] = useState({ clave: null, lista: [] });
  const [error, setError] = useState('');
  const clave = `${businessId}|${vuelta}`;
  useEffect(() => {
    let vigente = true;
    obtenerTarjetasCompletas(businessId)
      .then((lista) => { if (vigente) setFilas({ clave, lista }); })
      .catch(() => { if (vigente) setFilas({ clave, lista: [] }); });
    return () => { vigente = false; };
  }, [businessId, clave]);

  if (!filas.lista.length) return null;
  return (
    <div className="tarjetas-llenas">
      <strong className="text-sm">Tarjetas completas esperando reinicio</strong>
      {error && <div className="notice notice-danger">{error}</div>}
      <ul>
        {filas.lista.map((f) => (
          <li key={f.id}>
            <span>{f.nombre || f.email || 'Cliente'}</span>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => reiniciarTarjeta({ businessId, userId: f.id }).then(onReiniciada).catch((e) => setError(e.message))}
            >
              Reiniciar
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// El editor de cada campaña

function EditorCampana({ tipo, inicial, activa, services, onCerrar, onGuardar }) {
  const meta = CAMPANAS.find((c) => c.tipo === tipo);
  const [cfg, setCfg] = useState(() => structuredClone(inicial));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const set = (patch) => setCfg((c) => ({ ...c, ...patch }));

  // El MISMO validador que corre el servidor: lo que acá dice "listo" es lo
  // que allá se acepta.
  const v = validarCampana(tipo, cfg);

  const enviar = async (prender) => {
    if (!v.ok) return;
    setGuardando(true);
    setError('');
    try {
      await onGuardar(tipo, v.config, prender);
    } catch (err) {
      setError(err.message);
      setGuardando(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onCerrar}>
      <div
        className="modal-content editor-campana"
        role="dialog"
        aria-modal="true"
        aria-labelledby="editor-campana-titulo"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') onCerrar(); }}
      >
        <div className="modal-header">
          <h2 id="editor-campana-titulo">{meta.icono} {meta.nombre}</h2>
          <button type="button" className="modal-close" onClick={onCerrar} aria-label="Cerrar">✕</button>
        </div>
        <div className="modal-body">
          {(tipo === 'ruleta' || tipo === 'caja' || tipo === 'rasca') && (
            <EditorSorteo tipo={tipo} cfg={cfg} set={set} services={services} />
          )}
          {tipo === 'fidelidad' && <EditorFidelidad cfg={cfg} set={set} services={services} />}
          {tipo === 'happyHour' && <EditorHappyHour cfg={cfg} set={set} services={services} />}
          {tipo === 'racha' && <EditorRacha cfg={cfg} set={set} services={services} />}
          {tipo === 'cumpleanos' && <EditorCumple cfg={cfg} set={set} services={services} />}

          {!v.ok && (
            <div className="notice notice-warn editor-errores" role="status" aria-live="polite">
              <strong>Antes de guardar:</strong>
              <ul>{v.errores.map((e) => <li key={e}>{e}</li>)}</ul>
            </div>
          )}
          {error && <div className="notice notice-danger" role="alert">{error}</div>}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="btn btn-outline" disabled={!v.ok || guardando} onClick={() => enviar(activa)}>
            {guardando ? 'Guardando…' : activa ? 'Guardar cambios' : 'Guardar sin activar'}
          </button>
          {!activa && (
            <button type="button" className="btn btn-primary" disabled={!v.ok || guardando} onClick={() => enviar(true)}>
              Guardar y activar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Un premio ───────────────────────────────────────────────────────────────

const ICONOS = ['🎁', '✂️', '💈', '💸', '⭐', '🔥', '☕', '🧴', '🎉', '🎂'];

function EditorPremio({ premio, onCambio, services, conProbabilidad = false, onQuitar = null, titulo, aviso = null }) {
  const p = premio || {};
  const cambiar = (patch) => onCambio({ ...p, ...patch });
  const ids = p.serviceIds || [];
  const alternar = (id) => cambiar({ serviceIds: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id] });
  const idIconos = useId();

  return (
    <fieldset className="editor-premio">
      {titulo && <legend className="editor-premio-titulo">{titulo}</legend>}
      <div className="editor-premio-fila">
        <label className="form-group">
          <span className="form-label">Tipo</span>
          <select className="form-input" value={p.tipo || 'porcentaje'} onChange={(e) => cambiar({ tipo: e.target.value, valor: e.target.value === 'porcentaje' ? 10 : e.target.value === 'monto' ? 2000 : 0 })}>
            <option value="porcentaje">% de descuento</option>
            <option value="monto">$ de descuento</option>
            <option value="gratis">Servicio gratis</option>
            <option value="personalizado">Otro regalo</option>
          </select>
        </label>
        {(p.tipo === 'porcentaje' || p.tipo === 'monto' || !p.tipo) && (
          <label className="form-group">
            <span className="form-label">{p.tipo === 'monto' ? 'Pesos' : 'Porcentaje'}</span>
            <input type="number" inputMode="numeric" className="form-input" value={p.valor ?? ''} onChange={(e) => cambiar({ valor: e.target.value })} />
          </label>
        )}
        <label className="form-group crece">
          <span className="form-label">Nombre {p.tipo !== 'personalizado' && <span className="text-muted">(opcional)</span>}</span>
          <input
            type="text"
            className="form-input"
            maxLength={40}
            value={p.nombre || ''}
            placeholder={p.tipo === 'personalizado' ? 'Ej.: Café de regalo' : describirPremio({ ...p, valor: Number(p.valor) || 0 })}
            onChange={(e) => cambiar({ nombre: e.target.value })}
          />
        </label>
        {conProbabilidad && (
          <label className="form-group angosto">
            <span className="form-label">Probabilidad %</span>
            <input type="number" inputMode="decimal" step="0.01" min="0" max="100" className="form-input" value={p.probabilidad ?? ''} onChange={(e) => cambiar({ probabilidad: e.target.value })} />
          </label>
        )}
      </div>
      <div className="editor-premio-fila">
        <div className="form-group">
          <span className="form-label" id={idIconos}>Ícono</span>
          <div className="iconos-rapidos" role="group" aria-labelledby={idIconos}>
            {ICONOS.map((ic) => (
              <button
                key={ic}
                type="button"
                className={`icono-opcion ${p.icono === ic ? 'activo' : ''}`}
                aria-pressed={p.icono === ic}
                aria-label={`Ícono ${ic}`}
                onClick={() => cambiar({ icono: ic })}
              >
                {ic}
              </button>
            ))}
          </div>
        </div>
        <label className="form-group angosto">
          <span className="form-label">Color</span>
          <input type="color" className="form-input color-input" value={p.color || '#e03d00'} onChange={(e) => cambiar({ color: e.target.value })} />
        </label>
      </div>
      {p.tipo !== 'personalizado' && services.length > 0 && (
        <details className="editor-servicios" open={ids.length > 0}>
          <summary className="text-sm">Para qué servicios vale: {ids.length ? `${ids.length} elegidos` : 'todos'}</summary>
          <div className="cupon-chips">
            {services.map((s) => (
              <button key={s.id} type="button" className={`cupon-chip ${ids.includes(s.id) ? 'activo' : ''}`} aria-pressed={ids.includes(s.id)} onClick={() => alternar(s.id)}>
                {s.name}
              </button>
            ))}
          </div>
        </details>
      )}
      {aviso}
      {onQuitar && (
        <button type="button" className="btn btn-sm btn-ghost editor-quitar" onClick={onQuitar}>Quitar</button>
      )}
    </fieldset>
  );
}

// ── Ruleta, caja y rasca ────────────────────────────────────────────────────

function EditorSorteo({ tipo, cfg, set, services }) {
  const premios = cfg.premios || [];
  const cambiarPremio = (i, p) => set({ premios: premios.map((x, j) => (j === i ? p : x)) });
  const quitar = (i) => set({ premios: premios.filter((_, j) => j !== i) });
  const agregar = () => set({ premios: [...premios, premioBase({ probabilidad: 5, color: COLORES[premios.length % COLORES.length] })] });

  // La vista previa se arma con lo que haya, aunque todavía no valide.
  const normalizados = premios.map((p) => ({ ...p, valor: Number(p.valor) || 0, probabilidad: Number(p.probabilidad) || 0, nombre: p.nombre || describirPremio({ ...p, valor: Number(p.valor) || 0 }) }));
  const sumaPremios = (10000 - restoSinPremio(normalizados)) / 100;
  const sinPremio = restoSinPremio(normalizados) / 100;

  // "Sin premio" no es un premio más: es lo que sobra para llegar a 100. Por
  // eso no se guarda (el servidor lo deriva), pero se MUESTRA como una fila con
  // su porcentaje, porque un barbero cargó "0% de descuento" al 40% buscando
  // justamente esto y no lo encontró.
  //
  // Editar esa fila reacomoda los premios en proporción para que todo sume
  // 100: con "Sin premio" en 40, los premios pasan a sumar 60 y conservan su
  // peso entre ellos. Lo tipeado se guarda aparte mientras se escribe (con
  // "4" camino a "40" no hay que repartir dos veces sobre algo a medias).
  const [sinPremioTexto, setSinPremioTexto] = useState(null);
  const valorSinPremio = sinPremioTexto ?? (sinPremio >= 0 ? String(Math.round(sinPremio * 100) / 100) : '0');
  const fijarSinPremio = (texto) => {
    setSinPremioTexto(texto);
    const n = Number(String(texto).replace(',', '.'));
    if (texto === '' || !Number.isFinite(n) || n < 0 || n >= 100 || !premios.length) return;
    set({ premios: repartirProbabilidades(premios, 100 - n) });
  };
  // Lo que el dueño quiere de "sin premio" cuando la suma se pasó: lo último
  // que escribió ahí, o nada.
  const objetivoSinPremio = Math.min(99, Math.max(0, Number(String(sinPremioTexto ?? '0').replace(',', '.')) || 0));
  const ajustar = () => {
    setSinPremioTexto(null);
    set({ premios: repartirProbabilidades(premios, 100 - objetivoSinPremio) });
  };
  // Un "0% de descuento" cargado como premio: se convierte en la fila de
  // "Sin premio" con su probabilidad, y los demás se reacomodan.
  const convertirEnSinPremio = (i) => {
    const prob = Math.min(99, Math.max(0, Number(premios[i].probabilidad) || 0));
    const resto = premios.filter((_, j) => j !== i);
    setSinPremioTexto(null);
    set({
      premios: resto.length ? repartirProbabilidades(resto, 100 - prob) : resto,
      textoSinPremio: premios[i].nombre && premios[i].nombre !== '0% OFF' ? premios[i].nombre : cfg.textoSinPremio,
    });
  };

  return (
    <>
      {tipo === 'ruleta' && (
        <div className="editor-preview-ruleta">
          <Rueda segmentos={segmentosDelJuego({ premios: normalizados, textoSinPremio: cfg.textoSinPremio })} tamano={220} />
          <p className="text-sm text-secondary">Así la ve tu cliente. Todas las porciones son del mismo tamaño: las chances no se muestran.</p>
        </div>
      )}

      <div className="barra-probabilidades" aria-label="Reparto de probabilidades">
        {normalizados.map((p, i) => (
          <span key={i} style={{ width: `${Math.max(0, Math.min(100, p.probabilidad))}%`, background: p.color }} title={`${p.nombre}: ${p.probabilidad}%`} />
        ))}
        {sinPremio > 0 && <span className="sin-premio" style={{ width: `${sinPremio}%` }} title={`Sin premio: ${sinPremio}%`} />}
      </div>
      <p className={`text-sm ${sinPremio < 0 ? 'texto-error' : 'text-secondary'}`} aria-live="polite">
        {sinPremio < 0
          ? <>Los premios suman {sumaPremios.toLocaleString('es-AR')}%: no pueden pasar de 100.{' '}
              <button type="button" className="btn btn-sm btn-outline" onClick={ajustar}>
                Acomodar para que sume 100%{objetivoSinPremio > 0 ? ` (con ${objetivoSinPremio}% sin premio)` : ''}
              </button></>
          : <>Premios: {sumaPremios.toLocaleString('es-AR')}% · Sin premio: {sinPremio.toLocaleString('es-AR')}% · Total: 100%</>}
      </p>

      {premios.map((p, i) => (
        <EditorPremio
          key={i}
          titulo={`Premio ${i + 1}`}
          premio={p}
          onCambio={(np) => { setSinPremioTexto(null); cambiarPremio(i, np); }}
          services={services}
          conProbabilidad
          onQuitar={premios.length > 1 ? () => { setSinPremioTexto(null); quitar(i); } : null}
          aviso={p.tipo === 'porcentaje' && String(p.valor) !== '' && Number(p.valor) === 0 ? (
            <div className="notice notice-info editor-aviso-cero">
              Un 0% no es un premio. Si querés un <strong>"Seguí participando"</strong>, va en la fila de abajo, <strong>Sin premio</strong>.{' '}
              <button type="button" className="btn btn-sm btn-primary" onClick={() => convertirEnSinPremio(i)}>
                Convertir en "Sin premio"
              </button>
            </div>
          ) : null}
        />
      ))}

      {/* La fila de "Sin premio": no se guarda como premio, es lo que sobra. */}
      <fieldset className="editor-premio editor-sin-premio">
        <legend className="editor-premio-titulo">🙂 Sin premio</legend>
        <div className="editor-premio-fila">
          <label className="form-group crece">
            <span className="form-label">Lo que ve el cliente</span>
            <input type="text" maxLength={40} className="form-input" value={cfg.textoSinPremio || ''} placeholder="Seguí participando" onChange={(e) => set({ textoSinPremio: e.target.value })} />
          </label>
          <label className="form-group angosto">
            <span className="form-label">Probabilidad %</span>
            <input
              type="number" inputMode="decimal" step="0.01" min="0" max="99" className="form-input"
              value={valorSinPremio}
              onChange={(e) => fijarSinPremio(e.target.value)}
              onBlur={() => setSinPremioTexto(null)}
              aria-describedby="sin-premio-ayuda"
            />
          </label>
        </div>
        <p id="sin-premio-ayuda" className="text-sm text-muted" style={{ margin: 0 }}>
          Si la cambiás, los premios de arriba se acomodan solos para que todo sume 100%, sin perder la proporción entre ellos.
        </p>
      </fieldset>

      {premios.length < (tipo === 'ruleta' ? 11 : 12) && (
        <button type="button" className="btn btn-sm btn-outline" onClick={agregar}>+ Agregar premio</button>
      )}

      <div className="editor-grilla mt-md">
        {tipo !== 'rasca' && (
          <label className="form-group">
            <span className="form-label">Cada cuántos días puede jugar</span>
            <input type="number" min="1" max="365" className="form-input" value={cfg.frecuenciaDias ?? ''} onChange={(e) => set({ frecuenciaDias: e.target.value })} />
          </label>
        )}
        <label className="form-group">
          <span className="form-label">El premio vence a los (días)</span>
          <input type="number" min="1" max="365" className="form-input" value={cfg.diasVencimiento ?? ''} onChange={(e) => set({ diasVencimiento: e.target.value })} />
        </label>
      </div>
      {tipo === 'rasca' && <p className="text-sm text-secondary">Se gana una tarjeta para raspar por cada turno que marcás como atendido.</p>}
      {tipo === 'ruleta' && <p className="text-sm text-secondary">Aparece justo antes de confirmar la reserva, nunca después de pagar.</p>}
    </>
  );
}

// ── Tarjeta de fidelidad ────────────────────────────────────────────────────

function EditorFidelidad({ cfg, set, services }) {
  const casillas = Number(cfg.casillas) || 0;
  return (
    <>
      <div className="editor-preview-tarjeta">
        <TarjetaFidelidad
          casillas={Math.min(20, Math.max(3, casillas || 10))}
          sellos={Math.min(3, Math.max(0, (casillas || 10) - 1))}
          color={cfg.color}
          diseno={cfg.diseno}
          premio={{ ...cfg.premio, valor: Number(cfg.premio?.valor) || 0 }}
          compacta
        />
      </div>
      <div className="form-group">
        <span className="form-label" id="fid-casillas">Cantidad de casillas</span>
        <div className="cupon-chips" role="group" aria-labelledby="fid-casillas">
          {[5, 8, 10, 12].map((n) => (
            <button key={n} type="button" className={`cupon-chip ${casillas === n ? 'activo' : ''}`} aria-pressed={casillas === n} onClick={() => set({ casillas: n })}>{n}</button>
          ))}
          <input type="number" min="3" max="20" className="form-input casillas-libre" aria-label="Otra cantidad de casillas" value={cfg.casillas ?? ''} onChange={(e) => set({ casillas: e.target.value })} />
        </div>
        <p className="text-sm text-muted">Si la cambiás, vale para las tarjetas nuevas: el que ya empezó termina la suya.</p>
      </div>
      <EditorPremio titulo="Recompensa al completarla" premio={cfg.premio} onCambio={(p) => set({ premio: p })} services={services} />
      <div className="editor-grilla">
        <div className="form-group">
          <span className="form-label">Al completarla</span>
          <label className="pago-opcion">
            <input type="radio" name="reinicio" checked={cfg.reinicio !== 'manual'} onChange={() => set({ reinicio: 'automatico' })} />
            <span><strong>Empieza otra sola</strong><div className="text-sm text-secondary">Reinicio automático.</div></span>
          </label>
          <label className="pago-opcion">
            <input type="radio" name="reinicio" checked={cfg.reinicio === 'manual'} onChange={() => set({ reinicio: 'manual' })} />
            <span><strong>La reinicio yo</strong><div className="text-sm text-secondary">Queda llena hasta que la reinicies desde acá. Mientras tanto, los turnos no suman.</div></span>
          </label>
        </div>
        <div className="form-group">
          <span className="form-label">Diseño</span>
          {[['clasico', 'Clásico ✓'], ['sellos', 'Sellos 💈'], ['minimal', 'Minimal ●']].map(([v, t]) => (
            <label key={v} className="pago-opcion">
              <input type="radio" name="diseno" checked={(cfg.diseno || 'clasico') === v} onChange={() => set({ diseno: v })} />
              <span>{t}</span>
            </label>
          ))}
        </div>
        <label className="form-group">
          <span className="form-label">Color de la tarjeta</span>
          <input type="color" className="form-input color-input" value={cfg.color || '#e03d00'} onChange={(e) => set({ color: e.target.value })} />
        </label>
        <label className="form-group">
          <span className="form-label">El premio vence a los (días)</span>
          <input type="number" min="1" max="365" className="form-input" value={cfg.diasVencimiento ?? ''} onChange={(e) => set({ diasVencimiento: e.target.value })} />
        </label>
      </div>
      <p className="text-sm text-secondary">Suma una casilla cada turno que marcás como atendido, solo si el cliente reservó con su cuenta. Un turno suma una sola vez.</p>
    </>
  );
}

// ── Happy hour ──────────────────────────────────────────────────────────────

const NOMBRES_DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

function EditorHappyHour({ cfg, set, services }) {
  const dias = cfg.dias || [];
  const ids = cfg.serviceIds || [];
  return (
    <>
      <div className="form-group">
        <span className="form-label" id="hh-dias">Días</span>
        <div className="cupon-chips" role="group" aria-labelledby="hh-dias">
          {NOMBRES_DIAS.map((n, i) => (
            <button key={n} type="button" className={`cupon-chip ${dias.includes(i) ? 'activo' : ''}`} aria-pressed={dias.includes(i)}
              onClick={() => set({ dias: dias.includes(i) ? dias.filter((d) => d !== i) : [...dias, i] })}>
              {n}
            </button>
          ))}
        </div>
      </div>
      <div className="editor-grilla">
        <label className="form-group">
          <span className="form-label">Desde</span>
          <input type="time" className="form-input" value={cfg.desde || ''} onChange={(e) => set({ desde: e.target.value })} />
        </label>
        <label className="form-group">
          <span className="form-label">Hasta</span>
          <input type="time" className="form-input" value={cfg.hasta || ''} onChange={(e) => set({ hasta: e.target.value })} />
        </label>
        <label className="form-group">
          <span className="form-label">Descuento %</span>
          <input type="number" min="1" max="90" className="form-input" value={cfg.porcentaje ?? ''} onChange={(e) => set({ porcentaje: e.target.value })} />
        </label>
      </div>
      <div className="form-group">
        <span className="form-label" id="hh-serv">Servicios ({ids.length ? `${ids.length} elegidos` : 'todos'})</span>
        <div className="cupon-chips" role="group" aria-labelledby="hh-serv">
          {services.map((s) => (
            <button key={s.id} type="button" className={`cupon-chip ${ids.includes(s.id) ? 'activo' : ''}`} aria-pressed={ids.includes(s.id)}
              onClick={() => set({ serviceIds: ids.includes(s.id) ? ids.filter((x) => x !== s.id) : [...ids, s.id] })}>
              {s.name}
            </button>
          ))}
        </div>
      </div>
      <p className="text-sm text-secondary">
        Se aplica solo a los turnos que EMPIEZAN dentro de la franja, y no se suma a un cupón, un premio o una membresía:
        si el cliente usa uno de esos, vale ese.
      </p>
    </>
  );
}

// ── Racha ───────────────────────────────────────────────────────────────────

function EditorRacha({ cfg, set, services }) {
  const niveles = cfg.niveles || [];
  const cambiar = (i, patch) => set({ niveles: niveles.map((n, j) => (j === i ? { ...n, ...patch } : n)) });
  return (
    <>
      <label className="form-group">
        <span className="form-label">Para mantener la racha, volver antes de (días)</span>
        <input type="number" min="7" max="120" className="form-input" value={cfg.diasMax ?? ''} onChange={(e) => set({ diasMax: e.target.value })} />
      </label>
      {niveles.map((n, i) => (
        <div key={i} className="nivel-racha">
          <label className="form-group angosto">
            <span className="form-label">Visitas seguidas</span>
            <input type="number" min="2" max="50" className="form-input" value={n.racha ?? ''} onChange={(e) => cambiar(i, { racha: e.target.value })} />
          </label>
          <EditorPremio
            titulo={`Nivel ${i + 1}`}
            premio={n.premio}
            onCambio={(p) => cambiar(i, { premio: p })}
            services={services}
            onQuitar={niveles.length > 1 ? () => set({ niveles: niveles.filter((_, j) => j !== i) }) : null}
          />
        </div>
      ))}
      {niveles.length < 6 && (
        <button type="button" className="btn btn-sm btn-outline" onClick={() => set({ niveles: [...niveles, { racha: (Number(niveles[niveles.length - 1]?.racha) || 1) + 2, premio: premioBase() }] })}>
          + Agregar nivel
        </button>
      )}
      <label className="form-group mt-md">
        <span className="form-label">El premio vence a los (días)</span>
        <input type="number" min="1" max="365" className="form-input" value={cfg.diasVencimiento ?? ''} onChange={(e) => set({ diasVencimiento: e.target.value })} />
      </label>
      <p className="text-sm text-secondary">Cuenta los turnos atendidos. Si tarda más de lo que pusiste, la racha vuelve a 1 y los niveles se pueden ganar de nuevo.</p>
    </>
  );
}

// ── Cumpleaños ──────────────────────────────────────────────────────────────

function EditorCumple({ cfg, set, services }) {
  return (
    <>
      <EditorPremio titulo="El regalo" premio={cfg.premio} onCambio={(p) => set({ premio: p })} services={services} />
      <div className="editor-grilla">
        <label className="form-group">
          <span className="form-label">Aparece desde (días antes)</span>
          <input type="number" min="0" max="30" className="form-input" value={cfg.diasAntes ?? ''} onChange={(e) => set({ diasAntes: e.target.value })} />
        </label>
        <label className="form-group">
          <span className="form-label">Vale hasta (días después)</span>
          <input type="number" min="0" max="60" className="form-input" value={cfg.diasDespues ?? ''} onChange={(e) => set({ diasDespues: e.target.value })} />
        </label>
      </div>
      <p className="text-sm text-secondary">El cliente carga su cumpleaños una sola vez en "Tus premios". El regalo se genera solo, uno por año.</p>
    </>
  );
}
