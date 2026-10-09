import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCurrentBusiness } from '../../hooks/useCurrentBusiness';
import { getPagina, savePagina, updateBusiness } from '../../lib/repository';
import { puede, CAPACIDADES, capacidadesDelNegocio } from '../../config/plans';
import {
  PLANTILLAS, PAGINA_VACIA, MAX_BOTONES, linkValido, getPlantilla, paginaEfectiva,
} from '../../config/pagina';
import { useTenant } from '../../hooks/useTenantData';
import { useSucursalesPublicas } from '../../hooks/useSucursalesPublicas';
import CelularPagina from '../../components/admin/CelularPagina';
import { redimensionarPortada } from '../../utils/imagen';
import { direccionDe, instagramDe, linkWhatsApp } from '../../utils/contactoBarberia';

// ============================================================================
// "Mi página" — el editor de la página de presentación
// ============================================================================
// Lo que se edita acá es POCO a propósito: la plantilla, dos líneas de texto,
// la foto de portada y hasta dos botones libres. Todo lo demás —el nombre, el
// logo, la dirección, el Instagram, el WhatsApp, los servicios— ya está cargado
// en Configuración y la página lo usa de ahí.
//
// Esa es la decisión central y conviene no perderla: si esto fuera un editor
// libre, la barbería tendría que volver a escribir su dirección acá, y el día
// que se muda le quedaría vieja en un lugar y nueva en el otro. Un dato, un
// lugar.
//
// Por eso también abajo hay una lista de "esto sale de Configuración" con el
// link: lo que falta no se arregla acá, se arregla allá.

// Para la miniatura de la plantilla con foto cuando todavía no subió ninguna:
// un degradé oscuro que se lee como "acá va una foto", en vez de una miniatura
// idéntica a la Simple (que es justo lo que confundía).
const PORTADA_DE_MUESTRA = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="800"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
  + '<stop offset="0" stop-color="#7a5236"/><stop offset="0.5" stop-color="#3b2a20"/><stop offset="1" stop-color="#14100d"/>'
  + '</linearGradient></defs><rect width="400" height="800" fill="url(#g)"/></svg>'
);

const LINK_AMPLIAR = (que) => 'https://wa.me/5492257529684?text=' +
  encodeURIComponent(`Hola! Quiero ${que} en mi cuenta de BarberOS.`);

export default function PaginaPage() {
  const { business, businessId } = useCurrentBusiness();
  const { services, slug } = useTenant();
  const { sucursales } = useSucursalesPublicas(business);
  const inputFoto = useRef(null);
  // En el celular la vista previa no entra al costado: se abre con un botón.
  const [verVistaPrevia, setVerVistaPrevia] = useState(false);

  const puedePagina = puede(business, CAPACIDADES.pagina);
  const puedeFoto = puede(business, CAPACIDADES.paginaFoto);

  const [cfg, setCfg] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);
  const [error, setError] = useState('');
  const [procesandoFoto, setProcesandoFoto] = useState(false);

  // La configuración se lee de una vez. No va por suscripción: es una pantalla
  // de edición, y un snapshot entrando en medio de un formulario a medio
  // escribir le pisaría lo que está tipeando.
  useEffect(() => {
    if (!businessId) return;
    let vigente = true;
    getPagina(businessId)
      .then((datos) => { if (vigente) setCfg({ ...PAGINA_VACIA, ...(datos || {}) }); })
      .catch((err) => {
        console.error('[pagina] No se pudo leer la configuración:', err);
        if (vigente) { setCfg({ ...PAGINA_VACIA }); setError('No se pudo leer tu página. Probá recargar.'); }
      });
    return () => { vigente = false; };
  }, [businessId]);

  const editar = (patch) => { setCfg((c) => ({ ...c, ...patch })); setGuardado(false); };

  const editarBoton = (i, patch) => {
    const botones = [...(cfg.botones || [])];
    botones[i] = { ...botones[i], ...patch };
    editar({ botones });
  };

  const guardar = async () => {
    setError('');
    // Un botón a medio llenar no se guarda, pero tampoco frena el guardado del
    // resto: lo más común es que alguien escriba el texto, se arrepienta del
    // link y toque Guardar. Se descarta y listo.
    const botones = (cfg.botones || []).filter((b) => String(b.texto || '').trim() && linkValido(b.url));
    const malos = (cfg.botones || []).filter((b) => String(b.url || '').trim() && !linkValido(b.url));
    if (malos.length) {
      setError('Revisá los links de tus botones: tienen que empezar con https://');
      return;
    }
    setGuardando(true);
    try {
      await savePagina(businessId, {
        plantilla: cfg.plantilla,
        titular: String(cfg.titular || '').trim(),
        bajada: String(cfg.bajada || '').trim(),
        coverUrl: puedeFoto ? cfg.coverUrl || null : null,
        mostrarServicios: cfg.mostrarServicios !== false,
        botones,
      });
      setCfg((c) => ({ ...c, botones }));
      setGuardado(true);
      setTimeout(() => setGuardado(false), 3000);
    } catch (err) {
      console.error('[pagina] No se pudo guardar:', err);
      setError('No se pudo guardar: ' + err.message);
    } finally {
      setGuardando(false);
    }
  };

  // El interruptor se guarda SOLO, en el acto, y aparte de lo demás.
  //
  // Vive en el documento del negocio y no en el de la página: la ruta pública
  // tiene que saber si hay una página que buscar sin hacer una lectura de más,
  // y el documento del negocio lo lee igual para resolver el slug. La barbería
  // que no tiene página no paga ni una lectura por esto.
  const prender = async (activa) => {
    setError('');
    try {
      await updateBusiness(businessId, { paginaActiva: activa });
    } catch (err) {
      console.error('[pagina] No se pudo cambiar el interruptor:', err);
      setError('No se pudo cambiar: ' + err.message);
    }
  };

  const elegirFoto = async (ev) => {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file) return;
    setError('');
    setProcesandoFoto(true);
    try {
      editar({ coverUrl: await redimensionarPortada(file) });
    } catch (err) {
      setError(err.message);
    } finally {
      setProcesandoFoto(false);
    }
  };

  if (!business) return null;

  if (!puedePagina) {
    return (
      <div>
        <div className="admin-page-header"><h1>Mi página</h1></div>
        <div className="card">
          <h3 className="mb-md">Tu página de presentación</h3>
          <p className="text-secondary mb-md">
            Es lo primero que ve quien abre tu link: tu nombre, tu presentación y botones
            grandes para reservar, llegar, escribirte por WhatsApp y ver tu Instagram.
            Como un Linktree, pero con tu turnero adentro.
          </p>
          <div className="notice notice-info">
            Se incluye desde el <strong>Plan Intermedio</strong>.{' '}
            <a href={LINK_AMPLIAR('activar mi página de presentación')} target="_blank" rel="noreferrer" style={{ fontWeight: 700 }}>
              Escribinos y la activamos
            </a>.
          </div>
        </div>
      </div>
    );
  }

  if (!cfg) {
    return (
      <div>
        <div className="admin-page-header"><h1>Mi página</h1></div>
        <div className="empty-state"><p>Cargando…</p></div>
      </div>
    );
  }

  const activa = business.paginaActiva === true;
  const plantilla = getPlantilla(cfg.plantilla);
  const necesitaFoto = plantilla?.id === 'foto';
  const botones = cfg.botones || [];

  // Lo que la página arma sola. Se lista con el estado real para que se vea de
  // una qué le falta: un botón que no aparece porque el dato no está cargado es
  // la pregunta de soporte más fácil de evitar.
  // Lo que se muestra en la vista previa: lo que hay en el formulario AHORA,
  // sin guardar, resuelto igual que en la página real (plan, plantilla
  // permitida). Los botones libres se muestran apenas tienen texto, aunque el
  // link todavía esté a medio escribir: si no, el dueño agrega uno y no lo ve.
  const cfgVista = {
    ...paginaEfectiva(cfg, capacidadesDelNegocio(business)),
    botones: botones.filter((b) => String(b.texto || '').trim()).map((b) => ({ texto: b.texto, url: '#' })),
  };
  const vista = {
    business,
    servicios: services,
    locales: sucursales.length > 1 ? sucursales : [],
    businessId,
    slug: slug || business.slug,
  };
  const celular = (escala) => <CelularPagina {...vista} cfg={cfgVista} escala={escala} />;

  const automaticos = [
    { que: 'Tu nombre y tu logo', ok: Boolean(business.name), falta: 'Cargalo en Configuración' },
    { que: 'Tu presentación', ok: Boolean(business.welcomeMessage), falta: 'Escribila en Configuración, o poné una bajada acá' },
    { que: 'Cómo llegar', ok: Boolean(direccionDe(business)), falta: 'Cargá tu dirección en Configuración' },
    { que: 'WhatsApp', ok: Boolean(linkWhatsApp(business)), falta: 'Cargá tu WhatsApp en Configuración' },
    { que: 'Instagram', ok: Boolean(instagramDe(business)), falta: 'Cargá tu Instagram en Configuración' },
  ];

  return (
    <div>
      <div className="admin-page-header">
        <h1>Mi página</h1>
        {guardado && <span className="badge badge-success">✅ Guardado</span>}
      </div>

      {error && <div className="notice notice-danger" style={{ marginBottom: 'var(--space-md)' }}>{error}</div>}

      {/* ── El interruptor ───────────────────────────────────────────────── */}
      <div className="card">
        <div className="pagina-switch">
          <div>
            <h3 style={{ marginBottom: 4 }}>
              {activa ? 'Tu página está prendida' : 'Tu página está apagada'}
            </h3>
            <p className="text-sm text-secondary">
              {activa
                ? <>Quien abre <code>/{business.slug}</code> ve tu página, y de ahí entra a reservar.</>
                : <>Quien abre <code>/{business.slug}</code> entra directo a reservar, como hasta ahora.</>}
            </p>
          </div>
          <button
            type="button"
            className={activa ? 'btn btn-outline' : 'btn btn-primary'}
            onClick={() => prender(!activa)}
          >
            {activa ? 'Apagarla' : 'Prenderla'}
          </button>
        </div>

        <div className="pagina-links">
          <a href={`/${business.slug}`} target="_blank" rel="noreferrer" className="btn btn-sm btn-outline">
            Ver mi página
          </a>
          <a href={`/${business.slug}/reservar`} target="_blank" rel="noreferrer" className="btn btn-sm btn-ghost">
            Ver la reserva
          </a>
        </div>
      </div>

      <div className="pagina-editor">
      <div className="pagina-editor-form">
      {/* ── Plantilla ────────────────────────────────────────────────────── */}
      <div className="card mt-md">
        <h3 className="mb-md">Elegí tu diseño</h3>
        <div className="pagina-plantillas">
          {PLANTILLAS.map((p) => {
            const bloqueada = p.requiere === CAPACIDADES.paginaFoto && !puedeFoto;
            return (
              <button
                key={p.id}
                type="button"
                className={`card card-selectable pagina-plantilla ${cfg.plantilla === p.id ? 'card-selected' : ''}`}
                onClick={() => !bloqueada && editar({ plantilla: p.id })}
                disabled={bloqueada}
              >
                {/* La plantilla de verdad, en chiquito, con TUS datos: antes eran
                    tres barras abstractas casi iguales entre sí y no se
                    entendía qué cambiaba. */}
                <CelularPagina
                  {...vista}
                  miniatura
                  escala={0.3}
                  alto={700}
                  cfg={{
                    ...cfgVista,
                    plantilla: p.id,
                    coverUrl: p.id === 'foto' ? (cfg.coverUrl || PORTADA_DE_MUESTRA) : null,
                  }}
                />
                <strong>{p.label}</strong>
                <span className="text-sm text-muted">{p.descripcion}</span>
                {bloqueada && <span className="badge badge-neutral" style={{ fontSize: 10 }}>Plan Full</span>}
              </button>
            );
          })}
        </div>
        {!puedeFoto && (
          <p className="text-sm text-muted" style={{ marginTop: 'var(--space-sm)' }}>
            La plantilla con foto de portada se incluye desde el <strong>Plan Full</strong>.{' '}
            <a href={LINK_AMPLIAR('poner mi foto de portada')} target="_blank" rel="noreferrer" style={{ fontWeight: 700 }}>
              Escribinos y la activamos
            </a>.
          </p>
        )}
      </div>

      {/* ── Foto de portada ──────────────────────────────────────────────── */}
      {necesitaFoto && puedeFoto && (
        <div className="card mt-md">
          <h3 className="mb-md">Foto de portada</h3>
          <div className="pagina-portada-editor">
            <div className="pagina-portada-muestra">
              {cfg.coverUrl
                ? <img src={cfg.coverUrl} alt="" />
                : <span className="text-muted" style={{ fontSize: 12 }}>sin foto</span>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => inputFoto.current?.click()}
                disabled={procesandoFoto}
              >
                {procesandoFoto ? 'Procesando…' : cfg.coverUrl ? 'Cambiar foto' : 'Subir foto'}
              </button>
              {cfg.coverUrl && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => editar({ coverUrl: null })}>
                  Quitar
                </button>
              )}
              <input ref={inputFoto} type="file" accept="image/*" hidden onChange={elegirFoto} />
            </div>
          </div>
          <p className="text-sm text-muted" style={{ marginTop: 6 }}>
            Va de fondo, a pantalla completa, con un velo oscuro para que se lea el texto.
            Una foto apaisada del local queda mejor que una vertical. Se achica sola.
          </p>
          {!cfg.coverUrl && (
            <p className="text-sm" style={{ marginTop: 6, color: 'var(--warning)' }}>
              Sin foto, esta plantilla se ve igual que la Simple.
            </p>
          )}
        </div>
      )}

      {/* ── Textos ───────────────────────────────────────────────────────── */}
      <div className="card mt-md">
        <h3 className="mb-md">Qué dice</h3>
        <div className="form-group">
          <label className="form-label">Título</label>
          <input
            className="form-input"
            value={cfg.titular || ''}
            placeholder={business.name || ''}
            maxLength={60}
            onChange={(e) => editar({ titular: e.target.value })}
          />
          <p className="text-sm text-muted" style={{ marginTop: 6 }}>
            Vacío usa el nombre de tu barbería, que es lo que casi siempre conviene.
          </p>
        </div>
        <div className="form-group">
          <label className="form-label">Bajada</label>
          <textarea
            className="form-input"
            rows={2}
            value={cfg.bajada || ''}
            placeholder={business.welcomeMessage || 'Una línea: qué hacés y para quién.'}
            maxLength={160}
            onChange={(e) => editar({ bajada: e.target.value })}
          />
          <p className="text-sm text-muted" style={{ marginTop: 6 }}>
            Vacía usa tu presentación de Configuración.
          </p>
        </div>
        <label className="pagina-check">
          <input
            type="checkbox"
            checked={cfg.mostrarServicios !== false}
            onChange={(e) => editar({ mostrarServicios: e.target.checked })}
          />
          <span>Mostrar mis servicios y precios en la página</span>
        </label>
      </div>

      {/* ── Botones libres ───────────────────────────────────────────────── */}
      <div className="card mt-md">
        <h3 className="mb-sm">Tus propios botones</h3>
        <p className="text-sm text-secondary mb-md">
          Hasta {MAX_BOTONES}, para lo que no entra en los de siempre: la carta de productos,
          un sorteo, el formulario para trabajar con vos. Van al final, debajo de reservar.
        </p>

        {botones.map((b, i) => (
          <div key={i} className="pagina-boton-editor">
            <input
              className="form-input"
              placeholder="Qué dice el botón"
              value={b.texto || ''}
              maxLength={40}
              onChange={(e) => editarBoton(i, { texto: e.target.value })}
            />
            <input
              className="form-input"
              placeholder="https://…"
              value={b.url || ''}
              onChange={(e) => editarBoton(i, { url: e.target.value })}
            />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => editar({ botones: botones.filter((_, j) => j !== i) })}
            >
              Quitar
            </button>
          </div>
        ))}

        {botones.length < MAX_BOTONES && (
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => editar({ botones: [...botones, { texto: '', url: '' }] })}
          >
            + Agregar un botón
          </button>
        )}
      </div>

      {/* ── Lo que sale de Configuración ─────────────────────────────────── */}
      <div className="card mt-md">
        <h3 className="mb-sm">Esto lo arma sola</h3>
        <p className="text-sm text-secondary mb-md">
          No hace falta cargarlo de nuevo acá: sale de lo que ya tenés en{' '}
          <Link to="/admin/configuracion">Configuración</Link>. Si algo no te aparece en la
          página, es porque falta ese dato.
        </p>
        <ul className="pagina-automaticos">
          {automaticos.map((a) => (
            <li key={a.que}>
              <span>{a.ok ? '✅' : '⚠️'} {a.que}</span>
              {!a.ok && <span className="text-sm text-muted">{a.falta}</span>}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-md" style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' }}>
        <button className="btn btn-primary" onClick={guardar} disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar cambios'}
        </button>
        {guardado && <span className="text-sm text-muted">Listo. Mirá tu página para verlo.</span>}
      </div>
      </div>

      {/* ── La vista previa, en vivo ─────────────────────────────────────────
          Lo que hay en el formulario ahora, antes de guardar. Al costado en la
          compu; en el celular, con el botón flotante. */}
      <aside className="pagina-editor-vista">
        <div className="pagina-editor-vista-titulo">
          <strong>Así se ve</strong>
          <span className="text-xs text-muted">{guardado ? 'guardado' : 'con lo que editaste, sin guardar todavía'}</span>
        </div>
        {celular(0.8)}
      </aside>
      </div>

      {!verVistaPrevia && (
        <button type="button" className="btn btn-primary pagina-vista-flotante" onClick={() => setVerVistaPrevia(true)}>
          👁 Ver cómo queda
        </button>
      )}
      {verVistaPrevia && (
        <div className="modal-overlay pagina-vista-modal" onClick={() => setVerVistaPrevia(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            {/* Que entre entero, a lo ancho y a lo alto (con el botón de abajo). */}
            {celular(Math.min(0.85, (window.innerWidth - 48) / 390, (window.innerHeight - 110) / 760))}
            <button type="button" className="btn btn-outline" style={{ width: '100%', marginTop: 12, background: '#fff' }} onClick={() => setVerVistaPrevia(false)}>
              Volver a editar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
