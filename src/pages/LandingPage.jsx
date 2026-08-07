import { Link } from 'react-router-dom';
import { PLANS, OVERAGE_COST_USD } from '../config/plans';
import HeroMotionMockup from '../components/landing/HeroMotionMockup';
import FloatingActionWidget from '../components/landing/FloatingActionWidget';

// ============================================================================
// Landing pública de BarberOS
// ============================================================================
// Decisión que ordena todo lo demás: el onboarding es MANUAL. No hay registro
// self-service, así que el CTA no puede ser "creá tu cuenta gratis" — sería una
// promesa que la app no cumple. Todos los CTA van a WhatsApp, que además es
// donde un barbero realmente contesta.
//
// El orden de las secciones sigue el recorrido de alguien que no conoce el
// producto: primero se reconoce en el problema, después ve la solución, después
// pregunta el precio, y recién al final se le contestan las objeciones.

const WHATSAPP = '5492257529684';
const mensajeWA = encodeURIComponent(
  'Hola, vi BarberOS y quiero saber más para mi barbería.'
);
const LINK_WA = `https://wa.me/${WHATSAPP}?text=${mensajeWA}`;

const DOLORES = [
  {
    icono: '/img/icon-phone-interrupt.svg',
    alt: 'Ícono de teléfono interrumpiendo un corte de pelo',
    titulo: 'Cortás el corte para contestar',
    texto: 'Cada mensaje que entra te saca de lo que estás haciendo. Y si no contestás en el momento, el cliente se va a otro lado.',
  },
  {
    icono: '/img/icon-ghost-no-show.svg',
    alt: 'Ícono de turno cancelado y cliente ausente',
    titulo: 'Reservan y no aparecen',
    texto: 'Un turno vacío es plata que no vuelve. Sin recordatorio, entre el 20% y el 30% no se presenta.',
  },
  {
    icono: '/img/icon-notebook-agenda.svg',
    alt: 'Ícono de cuaderno impreso y agenda en papel',
    titulo: 'La agenda vive en un cuaderno',
    texto: 'Si el cuaderno no está, nadie sabe quién viene. Y averiguar cuánto facturaste el mes pasado es imposible.',
  },
];

const BENEFICIOS = [
  {
    imagen: '/img/benefit-link.svg',
    alt: 'Vista previa del enlace personalizado de la barbería',
    titulo: 'Tu link, tu agenda',
    texto: 'Cada barbería tiene su propia dirección. La ponés en el perfil de Instagram y tus clientes reservan solos, a cualquier hora, sin instalar nada.',
  },
  {
    imagen: '/img/benefit-whatsapp.svg',
    alt: 'Vista previa del mensaje de recordatorio automático por WhatsApp',
    titulo: 'Recordatorio por WhatsApp',
    texto: 'El sistema le avisa al cliente el día antes y unas horas antes. Es la función que más ausencias evita.',
    proximamente: true,
  },
  {
    imagen: '/img/benefit-schedule.svg',
    alt: 'Vista previa de la grilla de días y horarios de atención por barbero',
    titulo: 'Sabe quién trabaja cuándo',
    texto: 'Cargás el horario de cada barbero, sus descansos y qué servicios hace. La agenda no ofrece turnos que no se pueden atender.',
  },
  {
    imagen: '/img/benefit-roles.svg',
    alt: 'Vista previa de los roles de dueño y barberos',
    titulo: 'Cada uno ve lo suyo',
    texto: 'El dueño ve todo: caja, estadísticas, el equipo completo. Cada barbero ve solo sus propios turnos del día.',
  },
  {
    imagen: '/img/benefit-stats.svg',
    alt: 'Vista previa de métricas de facturación y servicios destacados',
    titulo: 'Números de verdad',
    texto: 'Cuánto facturaste, qué servicio deja más, quién tiene más ausencias. Sin planillas.',
  },
  {
    imagen: '/img/benefit-branding.svg',
    alt: 'Vista previa del encabezado personalizado con la marca de la barbería',
    titulo: 'Con tu cara, no la nuestra',
    texto: 'Tu nombre y tus colores. Para tu cliente es la agenda de tu barbería, no la de un proveedor.',
  },
];

const PASOS = [
  { n: '01', img: '/img/step-talk.svg', alt: 'Charla inicial de asesoramiento', t: 'Hablamos', d: 'Nos contás cómo trabajás: cuántos barberos, qué servicios, qué horarios.' },
  { n: '02', img: '/img/step-setup.svg', alt: 'Configuración llave en mano', t: 'Te la dejamos lista', d: 'Configuramos todo nosotros: tu equipo, tus precios, tus horarios. Vos no tocás nada.' },
  { n: '03', img: '/img/step-share.svg', alt: 'Publicación del link en Instagram', t: 'Compartís el link', d: 'Lo ponés en Instagram y en tu estado de WhatsApp. Esa misma tarde entra el primer turno.' },
];

const FAQ = [
  {
    q: '¿Mis clientes tienen que bajarse una app?',
    a: 'No. Abren el link, entran con su cuenta de Google y reservan. Funciona en cualquier celular, desde el navegador.',
  },
  {
    q: 'Mis clientes son grandes, ¿lo van a poder usar?',
    a: 'Son cuatro pasos: barbero, servicio, día y hora. Nada de formularios ni contraseñas nuevas. Y el que prefiere llamarte, te sigue llamando: vos cargás ese turno a mano en dos toques.',
  },
  {
    q: '¿Y si ya tengo turnos anotados?',
    a: 'Los pasamos nosotros en el armado. No arrancás con la agenda vacía.',
  },
  {
    q: '¿Tengo que firmar algo?',
    a: 'No hay permanencia. Es mes a mes: si no te sirve, avisás y listo.',
  },
  {
    q: '¿Cuánto tarda en estar andando?',
    a: 'Si tenemos tus datos, el mismo día. Lo que más tarda sos vos decidiendo los precios.',
  },
  {
    q: '¿Qué pasa con la información de mis clientes?',
    a: 'Es tuya. Cada barbería está separada de las demás y nadie ve tus turnos. Si algún día te vas, te la exportamos.',
  },
];

function CTAWhatsApp({ children = 'Hablemos por WhatsApp', clase = 'btn-primary btn-lg' }) {
  return (
    <a href={LINK_WA} target="_blank" rel="noreferrer" className={`btn ${clase}`} style={{ textDecoration: 'none' }}>
      {children} →
    </a>
  );
}

export default function LandingPage() {
  return (
    <div className="landing">
      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="landing-hero" id="inicio">
        <span className="eyebrow">• Turnos para barberías · Argentina</span>

        <h1 className="landing-title">
          Tu agenda no vive
          <br />
          <span className="acento">en WhatsApp.</span>
          <br />
          Vive acá.
        </h1>

        <p className="landing-lead">
          Tus clientes reservan solos desde un link. Vos cortás el pelo. El
          sistema se acuerda del resto.
        </p>

        <div className="landing-cta-row">
          <CTAWhatsApp />
          <a href="#precios" className="btn btn-outline btn-lg" style={{ textDecoration: 'none' }}>
            Ver precios
          </a>
        </div>

        <ul className="landing-checks">
          <li>✓ Lo configuramos nosotros</li>
          <li>✓ Sin permanencia</li>
          <li>✓ Andando el mismo día</li>
        </ul>

        {/* Dynamic 3D HTML Motion Hero Mockup */}
        <HeroMotionMockup />
      </section>

      {/* ── PROBLEMA ─────────────────────────────────────────────────────── */}
      <section className="landing-section" id="problema">
        <span className="eyebrow">• El día a día</span>
        <h2 className="landing-h2">Esto ya lo viviste</h2>
        <div className="landing-grid-3">
          {DOLORES.map((d) => (
            <div key={d.titulo} className="card landing-card">
              <div className="landing-card-icon">
                <img src={d.icono} alt={d.alt} width="48" height="48" className="landing-icon-img" />
              </div>
              <h3>{d.titulo}</h3>
              <p>{d.texto}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── SOLUCIÓN ─────────────────────────────────────────────────────── */}
      <section className="landing-section landing-section-alt" id="funciones">
        <span className="eyebrow">• Lo que hace</span>
        <h2 className="landing-h2">Una agenda que trabaja sola</h2>
        <div className="landing-grid-3">
          {BENEFICIOS.map((b) => (
            <div key={b.titulo} className="card landing-card landing-card-benefit">
              <div className="landing-benefit-img-wrapper">
                <img
                  src={b.imagen}
                  alt={b.alt}
                  width="280"
                  height="120"
                  className="landing-benefit-img"
                  loading="lazy"
                />
              </div>
              <h3>
                {b.titulo}
                {b.proximamente && <span className="badge badge-warning landing-soon">pronto</span>}
              </h3>
              <p>{b.texto}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── CÓMO EMPIEZA ─────────────────────────────────────────────────── */}
      <section className="landing-section" id="como-arranca">
        <span className="eyebrow">• Cómo arranca</span>
        <h2 className="landing-h2">No tenés que configurar nada</h2>
        <p className="landing-sub">
          No es un sistema que te bajás y peleás solo. Lo dejamos andando nosotros.
        </p>
        <div className="landing-grid-3">
          {PASOS.map((p) => (
            <div key={p.n} className="landing-step">
              <div className="landing-step-header">
                <span className="landing-step-num">{p.n}</span>
                <img
                  src={p.img}
                  alt={p.alt}
                  width="160"
                  height="80"
                  className="landing-step-img"
                  loading="lazy"
                />
              </div>
              <h3>{p.t}</h3>
              <p>{p.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── PRECIOS ──────────────────────────────────────────────────────── */}
      <section className="landing-section landing-section-alt" id="precios">
        <span className="eyebrow">• Precios</span>
        <h2 className="landing-h2">Sin letra chica</h2>
        <p className="landing-sub">
          Mes a mes, sin permanencia. La diferencia entre planes es cuántos
          recordatorios de WhatsApp manda el sistema y la capacidad de tu barbería.
        </p>

        <div className="landing-grid-3">
          {PLANS.map((plan, i) => (
            <div key={plan.id} className={`card landing-price ${i === 1 ? 'destacado' : ''}`}>
              {i === 1 && <span className="landing-price-tag">El más elegido</span>}
              <h3>{plan.label.replace('Plan ', '')}</h3>
              <div className="landing-price-amount">
                ${plan.monthlyFee.toLocaleString('es-AR')}
                <span>/mes</span>
              </div>
              <p className="landing-price-desc">{plan.description}</p>
              <ul className="landing-price-list">
                {plan.features.map((feat) => (
                  <li key={feat}>✓ {feat}</li>
                ))}
              </ul>
              <CTAWhatsApp clase={i === 1 ? 'btn-primary btn-full' : 'btn-outline btn-full'}>
                Lo quiero
              </CTAWhatsApp>
            </div>
          ))}
        </div>

        <p className="landing-fineprint">
          Precios en pesos argentinos. Los mensajes por encima del plan se cobran
          USD {OVERAGE_COST_USD.toFixed(2)} cada uno — te avisamos antes de que
          pase, nunca hay sorpresas en la factura.
        </p>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────────── */}
      <section className="landing-section" id="dudas">
        <span className="eyebrow">• Dudas</span>
        <h2 className="landing-h2">Lo que siempre nos preguntan</h2>
        <div className="landing-faq">
          {FAQ.map((f) => (
            <details key={f.q} className="card landing-faq-item">
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ── CIERRE ───────────────────────────────────────────────────────── */}
      <section className="landing-final">
        <h2 className="landing-h2">¿Cuántos turnos perdiste este mes?</h2>
        <p className="landing-lead" style={{ margin: '0 auto var(--space-lg)' }}>
          Contanos cómo trabajás y te decimos en cinco minutos si te sirve. Si no
          te sirve, te lo decimos igual.
        </p>
        <CTAWhatsApp />
        <p className="landing-login">
          ¿Ya sos cliente? <Link to="/login">Entrá a tu panel</Link>
        </p>
      </section>

      {/* Floating Action Buttons & AI Chat Assistant */}
      <FloatingActionWidget />
    </div>
  );
}
