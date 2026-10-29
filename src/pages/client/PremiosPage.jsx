// ============================================================================
// Tus premios — /:slug/premios
// ============================================================================
// Lo que tiene que transmitir esta pantalla es PROGRESO: la tarjeta que se
// sella sola cuando volvés, el premio que ya podés usar, la racha que no
// querés cortar. El orden sigue esa idea: primero lo que se puede hacer ya
// (abrir la caja, raspar, usar un premio), después lo que viene, al final el
// historial.
//
// Todo sale de UNA llamada (`misRecompensas`) al entrar. No hay suscripción:
// nada de esto cambia mientras se mira, salvo lo que hace el propio cliente
// (jugar), y eso se vuelve a pedir.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../hooks/useTenantData';
import { misRecompensas, guardarCumpleanos } from '../../lib/functions';
import { describirPremio } from '../../utils/recompensas';
import TarjetaFidelidad from '../../components/recompensas/TarjetaFidelidad';
import { CajaJuego, RascaJuego } from '../../components/recompensas/Juegos';
import { TarjetaPremio } from '../../components/recompensas/Premios';
import { recordarPremio } from '../../utils/premioElegido';
import Celebracion from '../../components/recompensas/Celebracion';
import { fechaCorta, paraQueServicios, diasEnTexto, leerVisto, guardarVisto, desdeDondeAnimar } from '../../components/recompensas/movimiento';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function FormCumple({ businessId, premio, onGuardado }) {
  const [dia, setDia] = useState('');
  const [mes, setMes] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  const guardar = async (e) => {
    e.preventDefault();
    if (!dia || !mes) return;
    setGuardando(true);
    setError('');
    try {
      await guardarCumpleanos({ businessId, fecha: `${mes}-${dia}` });
      onGuardado();
    } catch (err) {
      setError(err.message);
      setGuardando(false);
    }
  };

  return (
    <form className="card recompensa-bloque" onSubmit={guardar}>
      <h2 className="recompensa-bloque-titulo">🎂 ¿Cuándo es tu cumpleaños?</h2>
      <p className="text-sm text-secondary">
        Para tu cumple te regalamos <strong>{premio ? premio.nombre || describirPremio(premio) : 'un premio'}</strong>.
        Se carga una sola vez.
      </p>
      <div className="cumple-campos">
        <label className="form-group">
          <span className="form-label">Día</span>
          <select className="form-input" value={dia} onChange={(e) => setDia(e.target.value)} required>
            <option value="">—</option>
            {Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0')).map((d) => <option key={d} value={d}>{Number(d)}</option>)}
          </select>
        </label>
        <label className="form-group">
          <span className="form-label">Mes</span>
          <select className="form-input" value={mes} onChange={(e) => setMes(e.target.value)} required>
            <option value="">—</option>
            {MESES.map((m, i) => <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>)}
          </select>
        </label>
        <button type="submit" className="btn btn-primary" disabled={guardando || !dia || !mes}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
      {error && <div className="notice notice-danger" role="alert">{error}</div>}
    </form>
  );
}

export default function PremiosPage() {
  const { user } = useAuth();
  const { business, businessId, slug, services } = useTenant();
  const navigate = useNavigate();
  const uid = user?.id || null;

  // La respuesta se guarda con la barbería que la pidió: si cambia, la que hay
  // deja de valer sola (mismo criterio que la grilla de horarios ocupados).
  const [datos, setDatos] = useState({ clave: null, r: null, error: '' });
  const [vuelta, setVuelta] = useState(0);
  const [jugando, setJugando] = useState(null); // { tipo: 'caja' } | { tipo: 'rasca', ref }
  const clave = `${businessId}|${uid}|${vuelta}`;

  useEffect(() => {
    if (!businessId || !uid) return undefined;
    let vigente = true;
    misRecompensas(businessId)
      .then((r) => { if (vigente) setDatos({ clave, r, error: '' }); })
      .catch((err) => { if (vigente) setDatos({ clave, r: null, error: err.message }); });
    return () => { vigente = false; };
  }, [businessId, uid, clave]);

  const recargar = useCallback(() => setVuelta((v) => v + 1), []);
  const cargando = datos.clave !== clave && !datos.r;
  const r = datos.r;

  // Desde dónde se anima la tarjeta: lo que se vio la última vez en este
  // teléfono. Se calcula UNA vez por respuesta (no en cada render: si se
  // recalculara después de guardar lo visto, la animación se cortaría).
  const animacion = useMemo(() => {
    if (!r?.fidelidad || !businessId || !uid) return null;
    const visto = leerVisto(businessId, uid);
    const f = r.fidelidad;
    return {
      desde: desdeDondeAnimar(visto, f.ciclo, f.sellos),
      // Completó una tarjeta desde la última vez que entró.
      completoUna: Boolean(visto) && Number(visto.ciclo) < f.ciclo,
      // Con reinicio manual, la tarjeta llena sigue en pantalla.
      llenaRecien: f.completa && (!visto || Number(visto.sellos) < f.sellos || Number(visto.ciclo) !== f.ciclo),
    };
  }, [r, businessId, uid]);

  const marcarVisto = useCallback(() => {
    if (r?.fidelidad) guardarVisto(businessId, uid, { ciclo: r.fidelidad.ciclo, sellos: r.fidelidad.sellos });
  }, [r, businessId, uid]);

  if (!business) return null;

  const campanas = r?.campanas || business.recompensas || {};
  const hay = Object.keys(campanas).length > 0;
  const premios = r?.premios || [];
  const disponibles = premios.filter((p) => p.estado === 'disponible' || p.estado === 'reservado');
  const historial = premios.filter((p) => p.estado === 'usado' || p.estado === 'vencido');
  const nuevos = premios.filter((p) => p.nuevo);

  const usar = (premio) => {
    recordarPremio(businessId, premio.id);
    navigate(`/${slug}/reservar`);
  };

  const proximoNivel = r?.racha && campanas.racha
    ? (campanas.racha.niveles || []).find((n) => n.racha > (r.racha.cortada ? 0 : r.racha.actual))
    : null;

  return (
    <div className="premios-pagina">
      <h1>Tus premios</h1>
      <p className="text-secondary">en {business.name}</p>

      {cargando && <div className="empty-state"><p>Cargando tus premios…</p></div>}

      {datos.error && (
        <div className="notice notice-danger" role="alert">
          No pudimos cargar tus premios. <button type="button" className="btn btn-ghost btn-sm" onClick={recargar}>Reintentar</button>
        </div>
      )}

      {!cargando && !hay && (
        <div className="card empty-state">
          <div className="empty-state-icon">🎁</div>
          <p>{business.name} todavía no tiene recompensas.</p>
          <Link to={`/${slug}/reservar`} className="btn btn-primary mt-lg">Reservar un turno</Link>
        </div>
      )}

      {r && hay && (
        <>
          {nuevos.length > 0 && (
            <div className="notice notice-success premio-aviso-nuevo" role="status">
              <Celebracion cantidad={16} />
              🎉 Tenés un regalo nuevo: <strong>{nuevos[0].nombre}</strong>
            </div>
          )}

          {/* Lo que se puede hacer YA. */}
          {(campanas.caja || r.rascas.length > 0) && (
            <section className="recompensa-jugar" aria-label="Para jugar">
              {/* Una sola tarjeta aunque haya varias: se raspa la más vieja y
                  el contador baja. Cinco botones iguales apilados es ruido. */}
              {r.rascas.length > 0 && (
                <button type="button" className="card jugar-card" onClick={() => setJugando({ tipo: 'rasca', ref: r.rascas[0].ref })}>
                  <span className="jugar-icono" aria-hidden="true">🎫</span>
                  <span>
                    <strong>{r.rascas.length === 1 ? 'Tenés una tarjeta para raspar' : `Tenés ${r.rascas.length} tarjetas para raspar`}</strong>
                    <span className="text-sm text-secondary"> Por tu turno del {fechaCorta(r.rascas[0].fecha)}</span>
                  </span>
                  <span className="jugar-accion">Raspar</span>
                </button>
              )}
              {campanas.caja && (
                r.puede?.caja ? (
                  <button type="button" className="card jugar-card" onClick={() => setJugando({ tipo: 'caja' })}>
                    <span className="jugar-icono latido" aria-hidden="true">🎁</span>
                    <span><strong>Tu caja sorpresa está lista</strong></span>
                    <span className="jugar-accion">Abrir</span>
                  </button>
                ) : (
                  <div className="card jugar-card apagada">
                    <span className="jugar-icono" aria-hidden="true">🎁</span>
                    <span>
                      <strong>Caja sorpresa</strong>
                      <span className="text-sm text-secondary"> La próxima se abre el {fechaCorta(r.puede?.cajaProxima)}</span>
                    </span>
                  </div>
                )
              )}
            </section>
          )}

          {r.fidelidad && campanas.fidelidad && animacion && (
            <section className="recompensa-bloque" aria-label="Tarjeta de fidelidad">
              {animacion.completoUna && (
                <div className="notice notice-success" role="status">
                  🎉 ¡Completaste una tarjeta! Tu premio ya está abajo, en <strong>Disponibles</strong>.
                </div>
              )}
              <TarjetaFidelidad
                key={`${r.fidelidad.ciclo}-${r.fidelidad.sellos}`}
                casillas={r.fidelidad.casillas}
                sellos={r.fidelidad.sellos}
                desde={animacion.desde}
                color={campanas.fidelidad.color}
                diseno={campanas.fidelidad.diseno}
                premio={campanas.fidelidad.premio}
                completaRecien={animacion.llenaRecien}
                onTermino={marcarVisto}
              />
              {r.fidelidad.completa && (
                <p className="text-sm text-secondary">La barbería te arranca una tarjeta nueva la próxima vez que vayas.</p>
              )}
            </section>
          )}

          {disponibles.length > 0 && (
            <section className="recompensa-bloque">
              <h2 className="recompensa-bloque-titulo">Disponibles</h2>
              <div className="premios-lista">
                {disponibles.map((p) => <TarjetaPremio key={p.id} premio={p} services={services} onUsar={usar} />)}
              </div>
            </section>
          )}

          {/* En progreso: lo que todavía no se ganó pero se está ganando. */}
          {(r.racha || campanas.happyHour || campanas.ruleta || campanas.cumpleanos) && (
            <section className="recompensa-bloque">
              <h2 className="recompensa-bloque-titulo">En progreso</h2>
              <ul className="progreso-lista">
                {r.racha && (
                  <li>
                    <span aria-hidden="true">🔥</span>
                    <span>
                      {r.racha.cortada || !r.racha.actual
                        ? <>Arrancá una racha: volvé antes de {campanas.racha.diasMax} días entre turno y turno.</>
                        : <>Racha de <strong>{r.racha.actual} {r.racha.actual === 1 ? 'visita' : 'visitas'}</strong>. Volvé antes del <strong>{fechaCorta(r.racha.venceEn)}</strong> para no cortarla.</>}
                      {proximoNivel && <> A las {proximoNivel.racha} visitas: <strong>{proximoNivel.premio.nombre}</strong>.</>}
                    </span>
                  </li>
                )}
                {campanas.ruleta && (
                  <li>
                    <span aria-hidden="true">🎡</span>
                    <span>
                      {r.puede?.ruleta
                        ? <>Tenés una tirada de la ruleta: aparece cuando confirmás tu próximo turno.</>
                        : <>Tu próxima tirada de la ruleta es desde el <strong>{fechaCorta(r.puede?.ruletaProxima)}</strong>.</>}
                    </span>
                  </li>
                )}
                {campanas.happyHour && (
                  <li>
                    <span aria-hidden="true">⏰</span>
                    <span>
                      <strong>Happy hour</strong>: {diasEnTexto(campanas.happyHour.dias)} de {campanas.happyHour.desde} a {campanas.happyHour.hasta},{' '}
                      {campanas.happyHour.porcentaje}% menos {campanas.happyHour.serviceIds?.length ? paraQueServicios({ serviceIds: campanas.happyHour.serviceIds }, services).toLowerCase().replace('para ', 'en ') : 'en todos los servicios'}. Se aplica solo.
                    </span>
                  </li>
                )}
                {campanas.cumpleanos && r.cumple?.fecha && (
                  <li>
                    <span aria-hidden="true">🎂</span>
                    <span>Tu cumpleaños: <strong>{fechaCorta(`2000-${r.cumple.fecha}`)}</strong>. Ese día te espera {campanas.cumpleanos.premio?.nombre || 'un regalo'}.</span>
                  </li>
                )}
              </ul>
            </section>
          )}

          {campanas.cumpleanos && !r.cumple?.fecha && (
            <FormCumple businessId={businessId} premio={campanas.cumpleanos.premio} onGuardado={recargar} />
          )}

          {historial.length > 0 && (
            <details className="recompensa-bloque historial">
              <summary className="recompensa-bloque-titulo">Historial ({historial.length})</summary>
              <div className="premios-lista">
                {historial.map((p) => <TarjetaPremio key={p.id} premio={p} services={services} />)}
              </div>
            </details>
          )}
        </>
      )}

      {jugando?.tipo === 'caja' && (
        <CajaJuego businessId={businessId} onCerrar={() => { setJugando(null); recargar(); }} />
      )}
      {jugando?.tipo === 'rasca' && (
        <RascaJuego businessId={businessId} refTurno={jugando.ref} onCerrar={() => { setJugando(null); recargar(); }} />
      )}
    </div>
  );
}
