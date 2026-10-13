import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatPrice } from '../../utils/dateUtils';
import {
  direccionDe, instagramDe, linkInstagram, linkMaps, linkWhatsApp, mapaIncrustado, horarioDeAtencion,
} from '../../utils/contactoBarberia';
import { textoSobre } from '../../config/theme';
import './neytan.css';

// ============================================================================
// Neytan Barber 777 — página exclusiva
// ============================================================================
// Diseño a medida (ver `paginas-exclusivas/index.js`). La idea, en una línea:
// que deje de parecer un Linktree sin perder lo que lo hace útil, que es ser
// el link de la bio para sacar turno.
//
// Por eso el orden no se negocia: lo PRIMERO que se ve, sin scrollear y en el
// celular más chico, es el botón de reservar. Todo lo demás —servicios,
// Instagram, horarios, dónde queda— está abajo para el que quiere quedarse a
// mirar, y desde cualquier punto de la página la barra de abajo lo devuelve a
// reservar con un toque.
//
// La identidad sale del logo: negro, verde ácido, letra gótica, la corona y
// "Cortes que hablan". El verde es el que la barbería tiene cargado
// (`primaryColor`), así que si lo cambia desde Configuración cambia acá también.
//
// Todos los datos (servicios, precios, horarios, WhatsApp, Instagram) se leen
// de lo que ya está cargado. Nada de esta página hay que actualizarlo a mano
// cuando sube un precio o cambia un horario.

const ZONA = 'America/Argentina/Buenos_Aires';
const DIAS_LARGOS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

/** Día (0 = lunes, como `businessHours`) y minutos desde las 00:00, en Argentina. */
function ahoraEnArgentina() {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONA, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const v = Object.fromEntries(partes.map((p) => [p.type, p.value]));
  const dia = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(v.weekday);
  return { dia, min: Number(v.hour) * 60 + Number(v.minute) };
}

const aMin = (hhmm) => {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  return h * 60 + (m || 0);
};

/** Los tramos abiertos de un día: uno, o dos si tiene horario cortado. */
function tramosDelDia(d) {
  if (!d || d.isActive === false || !d.startTime || !d.endTime) return [];
  if (d.breakStart && d.breakEnd) {
    return [[aMin(d.startTime), aMin(d.breakStart)], [aMin(d.breakEnd), aMin(d.endTime)]];
  }
  return [[aMin(d.startTime), aMin(d.endTime)]];
}

const aHora = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/**
 * "Abierto · hasta las 21:00" o "Cerrado · abre mañana 08:00".
 *
 * No es decorado: a las 22 un cliente que ve "abierto" y escribe por WhatsApp
 * espera respuesta. Y "abre mañana 08:00" le dice que igual puede reservar ya.
 */
function estadoDeAhora(business) {
  const semana = business?.businessHours || [];
  if (!semana.length) return null;
  const { dia, min } = ahoraEnArgentina();
  if (dia < 0) return null;
  const delDia = (n) => semana.find((d) => d.dayOfWeek === n);

  for (const [desde, hasta] of tramosDelDia(delDia(dia))) {
    if (min >= desde && min < hasta) return { abierto: true, texto: `hasta las ${aHora(hasta)}` };
  }
  for (let i = 0; i < 7; i++) {
    const n = (dia + i) % 7;
    const proximo = tramosDelDia(delDia(n)).find(([desde]) => i > 0 || desde > min);
    if (proximo) {
      const cuando = i === 0 ? 'hoy' : i === 1 ? 'mañana' : `el ${DIAS_LARGOS[n]}`;
      return { abierto: false, texto: `abre ${cuando} ${aHora(proximo[0])}` };
    }
  }
  return null;
}

/**
 * Aparece al llegar scrolleando. Una vez por elemento; el CSS lo apaga con
 * reduced-motion. `clave` cambia cuando llega contenido nuevo (los servicios
 * se leen después de que la página ya se pintó): sin eso, los que llegan
 * tarde nunca se observan y se quedan invisibles.
 */
function useAparecer(clave) {
  const ref = useRef(null);
  useEffect(() => {
    const raiz = ref.current;
    if (!raiz || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver((entradas) => {
      for (const e of entradas) {
        if (e.isIntersecting) { e.target.classList.add('nx-visible'); obs.unobserve(e.target); }
      }
    }, { rootMargin: '0px 0px -8% 0px' });
    raiz.querySelectorAll('.nx-aparece:not(.nx-visible)').forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [clave]);
  return ref;
}

/**
 * Pinta el fondo del documento y la barra del navegador de negro mientras la
 * página está abierta. Sin esto, al estirar la página en el iPhone (el rebote
 * de arriba y de abajo) se ve el casi-blanco de BarberOS detrás del negro.
 */
function useFondoNegro() {
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    const antes = { body: document.body.style.background, html: document.documentElement.style.background, meta: meta?.content };
    document.body.style.background = '#050505';
    document.documentElement.style.background = '#050505';
    if (meta) meta.content = '#050505';
    return () => {
      document.body.style.background = antes.body;
      document.documentElement.style.background = antes.html;
      if (meta && antes.meta) meta.content = antes.meta;
    };
  }, []);
}

// Íconos en línea: son tres y no justifican una librería.
const IconoWhatsApp = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z" /></svg>
);
const IconoInstagram = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" strokeWidth="1.8" d="M7 2.9h10A4.1 4.1 0 0 1 21.1 7v10a4.1 4.1 0 0 1-4.1 4.1H7A4.1 4.1 0 0 1 2.9 17V7A4.1 4.1 0 0 1 7 2.9Z" /><circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.8" /><circle cx="17.4" cy="6.6" r="1.1" fill="currentColor" /></svg>
);
const Flecha = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="nx-flecha"><path fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m-6-6 6 6-6 6" /></svg>
);

export default function PaginaNeytan({ business, pagina, servicios = [], slug, codigoPromo, onReservar }) {
  useFondoNegro();
  const heroCta = useRef(null);
  const [barra, setBarra] = useState(false);
  // El "abierto / cerrado" se recalcula cada minuto: la página puede quedar
  // abierta en una pestaña, y a las 21:01 ya no está abierto. El intervalo
  // solo fuerza el redibujo; el estado se calcula en cada render.
  const [, setMinuto] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setMinuto((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  const estado = estadoDeAhora(business);

  // La barra de abajo aparece recién cuando el botón grande de la portada se
  // fue de pantalla, y se va cuando llega el del cierre: dos botones de
  // reservar a la vista a la vez es ruido.
  const cierreCta = useRef(null);
  useEffect(() => {
    const arriba = heroCta.current;
    const abajo = cierreCta.current;
    if (!arriba || typeof IntersectionObserver === 'undefined') return;
    const vista = { pasoArriba: false, llegoAbajo: false };
    const obs = new IntersectionObserver((entradas) => {
      for (const e of entradas) {
        if (e.target === arriba) vista.pasoArriba = !e.isIntersecting && e.boundingClientRect.top < 0;
        else vista.llegoAbajo = e.isIntersecting;
      }
      setBarra(vista.pasoArriba && !vista.llegoAbajo);
    });
    obs.observe(arriba);
    if (abajo) obs.observe(abajo);
    return () => obs.disconnect();
  }, []);

  const verde = business?.primaryColor || '#3ce000';
  const tinta = textoSobre(verde);
  const estilo = { '--nx-verde': verde, '--nx-tinta': tinta };

  const activos = useMemo(
    () => servicios.filter((s) => s.isActive !== false).sort((a, b) => (a.price || 0) - (b.price || 0)),
    [servicios]
  );
  // El servicio más caro va aparte, como la experiencia de la casa. Solo si
  // hay de dónde elegir: con un servicio solo, destacarlo es destacar la lista.
  const estrella = activos.length > 2 ? activos[activos.length - 1] : null;
  const carta = estrella ? activos.filter((s) => s.id !== estrella.id) : activos;

  const wa = linkWhatsApp(business);
  const ig = linkInstagram(business);
  const usuarioIg = instagramDe(business);
  // Sin la calle, el mapa es Santa Teresita entera desde arriba: no ayuda a
  // llegar y ocupa media pantalla. Aparece solo cuando cargue la dirección.
  //
  // Para el mapa se saca el "entre 5 y 6": en la costa es como se da una
  // dirección y en el texto se queda, pero a Google lo confunde y termina
  // marcando la esquina equivocada. Se le pasa la misma barbería con la
  // dirección limpia, así que el dominio y el armado del src siguen siendo
  // los de `mapaIncrustado`.
  // Lo mismo con el "N°": "Calle 46 N° 555" no lo encuentra, "Calle 46 555" sí.
  const calle = String(business?.address || '')
    .replace(/[,(]?\s*entre\s.*$/i, '')
    .replace(/\s+n(ro\.?|°|º|\.)\s*/i, ' ')
    .trim();
  const mapa = calle ? mapaIncrustado({ ...business, address: calle }) : null;
  const maps = calle ? linkMaps({ ...business, address: calle }) : null;
  const direccion = direccionDe(business);
  const horarios = horarioDeAtencion(business);
  const hoy = ahoraEnArgentina().dia;
  const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const esHoy = (dias) => {
    // "Lun a Jue" contiene a hoy si hoy cae en el rango.
    const [a, b] = dias.split(' a ').map((d) => DIAS.indexOf(d));
    return b === undefined ? a === hoy : hoy >= a && hoy <= b;
  };

  const sobreMi = String(pagina?.sobreMi || '').split(/\n+/).map((x) => x.trim()).filter(Boolean);
  const ref = useAparecer(`${activos.length}-${sobreMi.length}-${horarios.length}`);
  const reservar = () => onReservar();

  const cinta = ['Cortes que hablan', business?.name || 'Neytan Barber 777', business?.city || 'Santa Teresita', 'Reservá online'];

  return (
    <div className="nx" style={estilo} ref={ref}>
      {/* ───── Portada ───── */}
      <header className="nx-hero">
        <div className="nx-hero-fondo" aria-hidden="true">
          <div className="nx-halo" />
          <div className="nx-grano" />
        </div>

        <div className="nx-topbar">
          <span className="nx-etiqueta">{business?.city || 'Santa Teresita'} · AR</span>
          <div className="nx-topbar-redes">
            {ig && <a href={ig} target="_blank" rel="noreferrer" aria-label="Instagram"><IconoInstagram /></a>}
            {wa && <a href={wa} target="_blank" rel="noreferrer" aria-label="WhatsApp"><IconoWhatsApp /></a>}
          </div>
        </div>

        <div className="nx-hero-cuerpo">
          {business?.logoUrl
            ? <img src={business.logoUrl} alt="" className="nx-logo" />
            : <p className="nx-logo-texto" aria-hidden="true">Neytan</p>}
          <h1 className="nx-oculto">{business?.name}</h1>

          {estado && (
            <p className={`nx-estado ${estado.abierto ? 'nx-estado-abierto' : ''}`}>
              <span className="nx-punto" aria-hidden="true" />
              {estado.abierto ? 'Abierto' : 'Cerrado'} · {estado.texto}
            </p>
          )}

          {codigoPromo && (
            <p className="nx-promo">Tenés un descuento con el código <strong>{codigoPromo}</strong></p>
          )}

          <button type="button" ref={heroCta} className="nx-cta nx-cta-grande" onClick={reservar}>
            Reservá tu turno <Flecha />
          </button>
          <p className="nx-cta-nota">Elegís día y hora, y listo. Sin llamar.</p>
        </div>

        <a href="#servicios" className="nx-bajar">
          <span>Conocé más</span>
          <span className="nx-bajar-linea" aria-hidden="true" />
        </a>
      </header>

      {/* ───── Cinta ───── */}
      <div className="nx-cinta" aria-hidden="true">
        <div className="nx-cinta-pista">
          {[0, 1].map((k) => (
            <span key={k}>{cinta.map((t) => <span key={t}>{t} <i>✦</i> </span>)}</span>
          ))}
        </div>
      </div>

      <main className="nx-cuerpo">
        {/* ───── Sobre mí (solo si lo cargó en "Mi página") ───── */}
        {sobreMi.length > 0 && (
          <section className="nx-seccion nx-aparece">
            <p className="nx-etiqueta nx-num">01 — El barbero</p>
            <h2 className="nx-titulo">Neytan</h2>
            <div className="nx-texto">{sobreMi.map((t, i) => <p key={i}>{t}</p>)}</div>
          </section>
        )}

        {/* ───── Servicios ───── */}
        {activos.length > 0 && (
          <section className="nx-seccion" id="servicios">
            <div className="nx-aparece">
              <p className="nx-etiqueta nx-num">La carta</p>
              <h2 className="nx-titulo">Servicios</h2>
              <p className="nx-bajada">Tocá uno y entrás a reservar con ese ya elegido.</p>
            </div>

            {estrella && (
              <button type="button" className="nx-estrella nx-aparece" onClick={() => onReservar(estrella.id)}>
                <span className="nx-corona" aria-hidden="true">♛</span>
                <span className="nx-etiqueta">La experiencia de la casa</span>
                <span className="nx-estrella-nombre">{estrella.name}</span>
                <span className="nx-estrella-pie">
                  <span>{estrella.durationMinutes ? `${estrella.durationMinutes} min` : ''}</span>
                  <span className="nx-estrella-precio">{formatPrice(estrella.price)}</span>
                </span>
                <span className="nx-estrella-cta">Reservar este <Flecha /></span>
              </button>
            )}

            <ul className="nx-carta">
              {carta.map((s) => (
                <li key={s.id} className="nx-aparece">
                  <button type="button" className="nx-item" onClick={() => onReservar(s.id)}>
                    <span className="nx-item-nombre">{s.name}</span>
                    <span className="nx-item-puntos" aria-hidden="true" />
                    <span className="nx-item-precio">{formatPrice(s.price)}</span>
                    <span className="nx-item-min">{s.durationMinutes ? `${s.durationMinutes} min` : ''}</span>
                    <span className="nx-item-ir" aria-hidden="true"><Flecha /></span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ───── El trabajo: Instagram ───── */}
        {ig && (
          <section className="nx-seccion nx-aparece">
            <a href={ig} target="_blank" rel="noreferrer" className="nx-ig">
              <span className="nx-etiqueta">El trabajo</span>
              <span className="nx-ig-frase">Los cortes<br />hablan solos.</span>
              <span className="nx-ig-pie">
                <IconoInstagram />
                <span>Mirá los trabajos en <strong>@{usuarioIg}</strong></span>
                <Flecha />
              </span>
            </a>
          </section>
        )}

        {/* ───── Horarios ───── */}
        {horarios.length > 0 && (
          <section className="nx-seccion nx-aparece">
            <p className="nx-etiqueta nx-num">Cuándo</p>
            <h2 className="nx-titulo">Horarios</h2>
            <ul className="nx-horarios">
              {horarios.map((h) => (
                <li key={h.dias} className={esHoy(h.dias) ? 'nx-hoy' : ''}>
                  <span>{h.dias}{esHoy(h.dias) && <em>hoy</em>}</span>
                  {/* El horario cortado va en dos renglones, uno por tramo: partido
                      donde cae, "14:00–" queda colgando de un renglón y "21:00"
                      del siguiente. */}
                  <span className="nx-horas">
                    {h.horas.split(' y ').map((t) => <span key={t}>{t}</span>)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ───── Dónde ───── */}
        {(mapa || wa) && (
          <section className="nx-seccion nx-aparece">
            <p className="nx-etiqueta nx-num">Dónde</p>
            <h2 className="nx-titulo">{business?.address ? 'Encontranos' : business?.city || 'Encontranos'}</h2>
            {business?.address && <p className="nx-bajada">{direccion}</p>}
            {mapa && (
              <div className="nx-mapa">
                <iframe src={mapa} title={`Mapa de ${business?.name}`} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
              </div>
            )}
            <div className="nx-acciones">
              {maps && (
                <a href={maps} target="_blank" rel="noreferrer nofollow" className="nx-boton">Cómo llegar</a>
              )}
              {wa && (
                <a href={wa} target="_blank" rel="noreferrer" className="nx-boton"><IconoWhatsApp /> Escribime por WhatsApp</a>
              )}
            </div>
          </section>
        )}

        {/* ───── Cierre ───── */}
        <section className="nx-cierre nx-aparece">
          <p className="nx-cierre-frase">¿Te toca<br /><span>el corte?</span></p>
          <button type="button" ref={cierreCta} className="nx-cta nx-cta-grande" onClick={reservar}>
            Reservá tu turno <Flecha />
          </button>
        </section>
      </main>

      <footer className="nx-pie">
        <Link to={`/${slug}/mis-citas`}>Mis turnos</Link>
        <span>{business?.name}</span>
        <span className="nx-marca">Hecho con BarberOS</span>
      </footer>

      {/* La barra de abajo: desde cualquier punto de la página, reservar está a un toque. */}
      <div className={`nx-barra ${barra ? 'nx-barra-visible' : ''}`} aria-hidden={!barra}>
        <button type="button" className="nx-cta" onClick={reservar} tabIndex={barra ? 0 : -1}>
          Reservá tu turno <Flecha />
        </button>
      </div>
    </div>
  );
}
