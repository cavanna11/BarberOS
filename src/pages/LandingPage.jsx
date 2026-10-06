import { Link } from 'react-router-dom';
import { SeccionSlotly, FlotanteSlotly } from '../components/landing/Slotly';
import { PLANS, FEATURES_COMUNES, precioLindo } from '../config/plans';
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
    imagen: '/img/benefit-app.svg',
    alt: 'Un celular con BarberOS instalada y una notificación de turno nuevo',
    titulo: 'Se instala en tu celular',
    texto: 'Android o iPhone, sin pasar por la tienda. Te vibra en el bolsillo cuando alguien reserva o cancela, aunque tengas la app cerrada.',
  },
  {
    imagen: '/img/benefit-whatsapp.svg',
    alt: 'Vista previa del mensaje de WhatsApp ya escrito, listo para enviar',
    titulo: 'WhatsApp en un toque',
    texto: 'Al lado de cada turno tenés el botón: se abre WhatsApp con el mensaje ya escrito —recordatorio o agradecimiento— y vos decidís si lo mandás. Sale de tu número, con tu nombre. El envío automático llega más adelante.',
  },
  {
    imagen: '/img/benefit-resenas.svg',
    alt: 'El cliente puntuando con estrellas y el promedio por barbero en el panel',
    titulo: 'Reseñas de tus clientes',
    texto: 'Cuando marcás el turno como atendido, el cliente puede puntuarte de 1 a 5 estrellas y dejarte un comentario. Vos ves el promedio de la barbería, de cada barbero y de cada sucursal. Y al que te valora le ofrecemos dejar también su reseña en Google.',
  },
  {
    imagen: '/img/benefit-pago.svg',
    alt: 'El cliente eligiendo dejar una seña y el cobro acreditado en la cuenta de la barbería',
    titulo: 'Cobrá una seña al reservar',
    texto: 'Con Mercado Pago, el cliente deja una seña —o paga el corte entero— cuando saca el turno. La plata entra directo a tu cuenta, no a la nuestra. Vos elegís si es obligatoria o si la puede elegir el cliente.',
  },
  {
    imagen: '/img/benefit-schedule.svg',
    alt: 'Vista previa de la grilla de días y horarios de atención por barbero',
    titulo: 'Sabe quién trabaja cuándo',
    texto: 'Cargás el horario de cada barbero, sus descansos y qué servicios hace. La agenda no ofrece turnos que no se pueden atender.',
  },
  {
    imagen: '/img/benefit-sucursales.svg',
    alt: 'Una cuenta administrando cuatro sucursales, cada una con su equipo y sus turnos',
    titulo: 'Varias sucursales, una cuenta',
    texto: 'Si tenés más de un local, entrás con un solo usuario y cambiás de sucursal en el panel. Cada una tiene su equipo, sus servicios, sus horarios y su agenda, separados. Y ves los números de cada una o de todas juntas.',
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
    q: '¿Y yo, tengo que bajarme algo?',
    a: 'Tampoco. Pero podés instalar BarberOS en tu celular como una app —Android o iPhone, en cuatro toques, sin tienda— y te llega un aviso cada vez que un cliente reserva o cancela, aunque la tengas cerrada. Adentro del panel está el paso a paso.',
  },
  {
    q: '¿Puedo pedir una seña para que no me falten?',
    a: 'Sí. Conectás tu cuenta de Mercado Pago desde el panel y el cliente deja una seña al reservar —o paga el corte completo, si lo habilitás—. La plata va derecho a tu cuenta: nosotros no la tocamos ni te cobramos comisión por eso. Y elegís si la seña es obligatoria o si el cliente puede optar por pagar todo en el local, para no perder al que no usa Mercado Pago.',
  },
  {
    q: 'Mis clientes son grandes, ¿lo van a poder usar?',
    a: 'Son cuatro pasos: barbero, servicio, día y hora. Nada de formularios ni contraseñas nuevas. Y el que prefiere llamarte, te sigue llamando: vos cargás ese turno a mano en dos toques.',
  },
  {
    q: 'Tengo dos locales, ¿puedo manejar los dos?',
    a: 'Sí, con el Plan Empresarial: hasta cuatro sucursales con una sola cuenta. Entrás una vez y cambiás de sucursal desde el panel. Cada una es independiente de verdad — su equipo, sus servicios, sus horarios y su agenda, con su propio link para los clientes. Y tenés una pantalla que te muestra las cuatro juntas, con los ingresos del mes de cada una.',
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

// Días de prueba que se ofrecen en la landing. Tiene que coincidir con lo que
// cargues en "Días de prueba sin cargo" al dar de alta la barbería.
const DIAS_DEMO = 10;

function CTAWhatsApp({ children = 'Hablemos por WhatsApp', clase = 'btn-primary btn-lg', mensaje = null }) {
  const href = mensaje
    ? `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(mensaje)}`
    : LINK_WA;
  return (
    <a href={href} target="_blank" rel="noreferrer" className={`btn ${clase}`} style={{ textDecoration: 'none' }}>
      {children} →
    </a>
  );
}

/** 1 → "1 barbero", 3 → "Hasta 3 barberos", null → "Barberos sin límite". */
function textoBarberos(max) {
  if (max === null || max === undefined) return 'Barberos sin límite';
  return max === 1 ? '1 barbero' : `Hasta ${max} barberos`;
}

/** 1 → "1 barbería", 4 → "Hasta 4 sucursales", null → "Las que necesites". */
function textoSucursales(max) {
  if (max === null || max === undefined) return 'Las sucursales que necesites';
  return max === 1 ? '1 barbería' : `Hasta ${max} sucursales`;
}

/**
 * Una tarjeta de plan.
 *
 * El precio puede no existir todavía (`monthlyFee: null`): en ese caso dice
 * "Consultanos" y no un número inventado. Inventar un precio en la landing es
 * la clase de cosa que después hay que desdecir en la primera charla.
 */
function TarjetaPlan({ plan }) {
  const precio = precioLindo(plan.monthlyFee);
  const esEmpresarial = plan.empresarial === true;

  return (
    <div className={`card landing-price ${plan.destacado ? 'destacado' : ''} ${esEmpresarial ? 'empresarial' : ''}`}>
      {plan.destacado && <span className="landing-price-tag">El más elegido</span>}
      {esEmpresarial && <span className="landing-price-tag">Varias sucursales</span>}

      <h3>{plan.label.replace('Plan ', '')}</h3>

      {precio ? (
        <div className="landing-price-amount">
          {precio}
          <span>/mes</span>
        </div>
      ) : (
        <div className="landing-price-amount landing-price-consulta">
          Consultanos
          <span>precio según tu caso</span>
        </div>
      )}

      <p className="landing-price-desc">{plan.description}</p>

      {/* La capacidad arriba y en grande: es lo único que de verdad cambia
          entre planes, así que es lo que hay que poder comparar de un vistazo. */}
      <div className="landing-price-capacidad">
        <span>🏠 <strong>{textoSucursales(plan.maxSucursales)}</strong></span>
        <span>👤 <strong>{textoBarberos(plan.maxBarbers)}</strong></span>
      </div>

      <ul className="landing-price-list">
        {plan.features.map((feat) => {
          // Una feature puede venir como texto o como objeto con
          // `proximamente`: lo que todavía no anda se marca en vez de venderse
          // como disponible.
          const texto = typeof feat === 'string' ? feat : feat.texto;
          const pronto = typeof feat === 'object' && feat.proximamente;
          return (
            <li key={texto} style={pronto ? { opacity: 0.7 } : undefined}>
              {pronto ? '○' : '✓'} {texto}
              {pronto && <span className="badge badge-warning landing-soon">pronto</span>}
            </li>
          );
        })}
      </ul>

      <CTAWhatsApp
        clase={plan.destacado || esEmpresarial ? 'btn-primary btn-full' : 'btn-outline btn-full'}
        mensaje={`Hola, me interesa el ${plan.label} de BarberOS.`}
      >
        {precio ? 'Lo quiero' : 'Pedir precio'}
      </CTAWhatsApp>
    </div>
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
          <li>✓ Avisos en tu celular</li>
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
      {/* ── OTRO RUBRO → SLOTLY ──────────────────────────────────────────── */}
      {/* Va en el medio: el que no es barbero ya entendió qué hace el sistema
          y está justo por darse cuenta de que no es para él. */}
      <SeccionSlotly />

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
          Mes a mes, sin permanencia. Lo único que cambia entre planes es la
          capacidad: cuántas sucursales y cuántos barberos. Las funciones son
          las mismas para todos.
        </p>

        {/* La prueba sin cargo no se activa sola: la damos nosotros al preparar
            la cuenta. Por eso el llamado es a escribir, no a un botón de alta. */}
        <div className="card landing-demo">
          <h3 style={{ marginBottom: 8 }}>
            Probala {DIAS_DEMO} días sin pagar nada
          </h3>
          <p className="text-secondary" style={{ marginBottom: 16 }}>
            Te dejamos la cuenta lista con tu equipo, tus servicios y tus
            horarios cargados. Si a los {DIAS_DEMO} días no te sirve, no hacés
            nada y se cierra sola. No pedimos tarjeta.
          </p>
          <CTAWhatsApp clase="btn-primary">
            Pedir mi prueba de {DIAS_DEMO} días
          </CTAWhatsApp>
        </div>

        {/* Los cuatro planes de suscripción. El Personalizado va aparte, abajo:
            no es una suscripción con precio de lista, es una conversación. */}
        <div className="landing-grid-planes">
          {PLANS.filter((p) => !p.aMedida).map((plan) => (
            <TarjetaPlan key={plan.id} plan={plan} />
          ))}
        </div>

        {/* Plan a medida: CTA comercial, sin precio ni tarjeta de suscripción. */}
        {PLANS.filter((p) => p.aMedida).map((plan) => (
          <div key={plan.id} className="card landing-plan-medida">
            <div>
              <span className="eyebrow">• A medida</span>
              <h3 style={{ margin: '6px 0 8px' }}>{plan.label.replace('Plan ', '')}</h3>
              <p className="landing-price-desc" style={{ marginBottom: 0 }}>
                Si tu barbería necesita algo que no entra en los planes de arriba, lo
                charlamos y lo armamos. No hay precio de lista porque no hay dos casos
                iguales: depende de qué haya que construir.
              </p>
            </div>
            <div>
              <ul className="landing-price-list" style={{ marginBottom: 'var(--space-md)' }}>
                {plan.features.map((f) => (
                  <li key={typeof f === 'string' ? f : f.texto}>
                    ✓ {typeof f === 'string' ? f : f.texto}
                  </li>
                ))}
              </ul>
              <CTAWhatsApp
                clase="btn-primary btn-full"
                mensaje="Hola, necesito algo a medida para mi barbería y quiero consultar por el Plan Personalizado."
              >
                Consultanos
              </CTAWhatsApp>
            </div>
          </div>
        ))}

        {/* Lo que no cambia entre planes va una sola vez: así cada tarjeta
            muestra únicamente por qué elegirla, y no se promete como exclusivo
            lo que en realidad tienen todos. */}
        <div className="card landing-comunes">
          <strong>Todos los planes incluyen:</strong>{' '}
          {FEATURES_COMUNES.join(' · ')}
        </div>

        <p className="landing-fineprint">
          Precios en pesos argentinos, por mes. Sin permanencia y sin costo de alta:
          se paga el mes que se usa.
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
      <FlotanteSlotly />

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
