// ============================================================================
// La vista previa del link compartido (Open Graph)
// ============================================================================
// Cuando alguien manda `barberos.sacia.tech/volcadoclub` por WhatsApp, el que lo
// recibe ve una tarjeta con título, descripción e imagen. Hasta acá esa tarjeta
// decía "BarberOS — Turnos para barberías", porque es lo que está escrito en el
// `index.html` del producto: el nombre de la barbería no aparecía en ningún
// lado.
//
// Eso importa justo donde más duele. El link de una barbería se reparte por
// WhatsApp y por la bio de Instagram, y la tarjeta es lo único que se ve antes
// de decidir si se toca. Una que dice el nombre del local y qué hace se abre; una
// que nombra a su proveedor de software, no.
//
// ── Por qué hace falta un endpoint y no alcanza con el frontend ─────────────
// Los crawlers que arman la tarjeta (WhatsApp, Facebook, Twitter, Telegram,
// Slack, Discord) NO ejecutan JavaScript: leen el HTML que les llega y nada más.
// En una SPA ese HTML es siempre el mismo para todas las rutas, así que cambiar
// las etiquetas desde React no sirve para nada: el crawler ya se fue.
//
// Entonces el `vercel.json` manda a ESTOS user agents —y solo a ellos— acá, y
// esta función devuelve un HTML mínimo con las etiquetas del negocio de ese
// slug. La persona de carne y hueso sigue recibiendo la app como siempre; nadie
// que no sea un crawler pasa por este código.
//
// ── Por qué puede leer los datos ────────────────────────────────────────────
// El documento del negocio es de LECTURA PÚBLICA por diseño (la página de
// reservas necesita el nombre y los horarios antes de cualquier login), así que
// esto se lee por la API REST con la clave web, que también es pública y ya
// viaja en el bundle. No hay credencial de servidor acá, y no hace falta: lo
// único que se expone es lo que cualquiera ve abriendo el link.
//
// La facturación vive en `private/billing` y las Rules no la dejan leer, así que
// no hay forma de que se escape por acá ni por error.

// Las variables se leen DENTRO de la función y no al cargar el módulo. En
// Vercel da lo mismo —el entorno ya está puesto cuando el módulo se evalúa—,
// pero leerlas al cargar las congela, y el caso "falta la clave" queda imposible
// de probar sin reiniciar el proceso. Es el mismo problema que `VITE_*`
// congelado en el build, un escalón más arriba.
const proyecto = () => process.env.VITE_FIREBASE_PROJECT_ID || 'barberos-1d60e';
const clave = () => process.env.VITE_FIREBASE_API_KEY || '';
const docs = () =>
  `https://firestore.googleapis.com/v1/projects/${proyecto()}/databases/(default)/documents`;

const SITIO = 'https://barberos.sacia.tech';
const IMAGEN = `${SITIO}/img/og-barberos.png`;

const GENERICO = {
  titulo: 'BarberOS — Turnos para barberías',
  descripcion: 'Tu agenda no vive en WhatsApp. Vive acá.',
};

/**
 * Todo lo que entra al HTML pasa por acá.
 *
 * El nombre y la presentación los escribe el dueño de la barbería en su panel, y
 * acá terminan adentro de un atributo HTML. Sin escapar, un `">` en el nombre
 * cierra la etiqueta y lo que siga se convierte en marcado. No es teórico: es
 * exactamente el agujero que convierte un campo de texto en XSS.
 */
const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Un slug es minúsculas, números y guiones. Cualquier otra cosa no se consulta. */
const SLUG_OK = /^[a-z0-9][a-z0-9-]{0,59}$/;

/** El valor de un campo de la respuesta REST de Firestore. */
const campo = (doc, nombre) => {
  const f = doc?.fields?.[nombre];
  if (!f) return null;
  if ('stringValue' in f) return f.stringValue;
  if ('booleanValue' in f) return f.booleanValue;
  if ('integerValue' in f) return Number(f.integerValue);
  return null;
};

async function leerNegocio(slug) {
  const API_KEY = clave();
  const DOCS = docs();
  if (!API_KEY || !SLUG_OK.test(slug)) return null;

  // Dos lecturas, las mismas que hace el browser: el mapa de slugs y después el
  // negocio. Resolverlo de otra forma obligaría a permitir listar `businesses`,
  // y ahí cualquiera se baja la cartera entera de clientes.
  const mapa = await fetch(`${DOCS}/slugs/${encodeURIComponent(slug)}?key=${API_KEY}`);
  if (!mapa.ok) return null;
  const businessId = campo(await mapa.json(), 'businessId');
  if (!businessId) return null;

  const r = await fetch(`${DOCS}/businesses/${encodeURIComponent(businessId)}?key=${API_KEY}`);
  if (!r.ok) return null;
  const doc = await r.json();

  return {
    name: campo(doc, 'name'),
    welcomeMessage: campo(doc, 'welcomeMessage'),
    address: campo(doc, 'address'),
    city: campo(doc, 'city'),
    isFrozen: campo(doc, 'isFrozen') === true,
  };
}

/**
 * Qué dice la tarjeta.
 *
 * La descripción sale de la presentación que escribió la barbería; si no cargó
 * ninguna, de la dirección, que es el otro dato por el que alguien decide
 * tocar un link. Y si no hay ni eso, una línea que al menos dice qué es.
 */
function tarjeta(biz, slug) {
  if (!biz?.name) return { ...GENERICO, url: `${SITIO}/${slug}` };

  const direccion = [biz.address, biz.city].filter(Boolean).join(', ');
  const descripcion =
    (biz.welcomeMessage || '').trim() ||
    (direccion ? `Reservá tu turno online. ${direccion}` : 'Reservá tu turno online, sin llamar ni esperar.');

  return {
    titulo: `${biz.name} — Reservá tu turno`,
    descripcion: descripcion.slice(0, 200),
    url: `${SITIO}/${slug}`,
  };
}

export default async function handler(req, res) {
  const slug = String(req.query?.slug || '').toLowerCase();

  let biz = null;
  try {
    biz = await leerNegocio(slug);
  } catch (err) {
    // Que la base no conteste no puede romper el link: se cae a la tarjeta
    // genérica, que es lo que había antes de todo esto.
    console.error('[preview] No se pudo leer el negocio:', err);
  }

  const { titulo, descripcion, url } = tarjeta(biz, slug);

  // 5 minutos en el cliente y un día en el borde de Vercel. Los crawlers
  // cachean la tarjeta por su cuenta y por mucho más tiempo que esto, así que
  // ser agresivo acá no cambia nada y ahorra dos lecturas de Firestore por
  // reenvío del link.
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=86400, stale-while-revalidate=86400');
  res.setHeader('X-Robots-Tag', 'noindex');

  // El `refresh` es por si acá cae una persona y no un crawler: no debería
  // pasar —el rewrite filtra por user agent— pero quedarse en una página muda
  // sería peor que una redirección de más.
  res.status(200).send(`<!doctype html>
<html lang="es-AR">
<head>
<meta charset="utf-8" />
<title>${esc(titulo)}</title>
<meta name="description" content="${esc(descripcion)}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="BarberOS" />
<meta property="og:title" content="${esc(titulo)}" />
<meta property="og:description" content="${esc(descripcion)}" />
<meta property="og:url" content="${esc(url)}" />
<meta property="og:image" content="${IMAGEN}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(titulo)}" />
<meta name="twitter:description" content="${esc(descripcion)}" />
<meta name="twitter:image" content="${IMAGEN}" />
<link rel="canonical" href="${esc(url)}" />
<meta http-equiv="refresh" content="0; url=${esc(url)}" />
</head>
<body>
<h1>${esc(titulo)}</h1>
<p>${esc(descripcion)}</p>
<p><a href="${esc(url)}">Abrir</a></p>
</body>
</html>`);
}
