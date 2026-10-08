// La vista previa del link compartido (api/preview.js), sin emulador.
//
//   node scripts/test-preview.mjs
//
// No necesita emulador ni red: lo que se prueba es el armado del HTML y el
// escapado, que es donde está el riesgo. La lectura de Firestore se reemplaza
// por un fetch de mentira, así que esto corre igual sin claves y sin internet.
//
// Lo importante: el nombre y la presentación de la barbería los escribe su
// dueño y terminan adentro de atributos HTML. Si no se escapan, un `">` en el
// nombre cierra la etiqueta y todo lo que siga se convierte en marcado. Hay un
// caso para eso y es el que justifica este archivo.

let pasaron = 0, fallaron = 0;
const fallas = [];
const chequear = (t, ok, d = '') => {
  if (ok) { pasaron++; console.log('  ok    ', t); }
  else { fallaron++; fallas.push(t); console.log('  FALLA ', t, d ? `\n           ${d}` : ''); }
};

// ── El doble de Firestore ───────────────────────────────────────────────────
// La REST de Firestore devuelve los campos envueltos por tipo; se imita eso
// para que lo que se ejercite sea el mismo lector que corre en producción.
const str = (v) => ({ stringValue: v });
const bool = (v) => ({ booleanValue: v });

const BASE = new Map();
const sembrar = (slug, id, biz) => {
  BASE.set(`slugs/${slug}`, { fields: { businessId: str(id) } });
  BASE.set(`businesses/${id}`, { fields: Object.fromEntries(
    Object.entries(biz).map(([k, v]) => [k, typeof v === 'boolean' ? bool(v) : str(v)])
  ) });
};

sembrar('volcadoclub', 'biz-1', {
  name: 'Volcado Club',
  welcomeMessage: 'Cortes clásicos y barba, en el centro.',
  address: 'Av. Colón 1234',
  city: 'Mar del Plata',
  isFrozen: false,
});

// Una barbería que no cargó presentación: la descripción tiene que caer en la
// dirección, que es el otro dato por el que alguien decide tocar un link.
sembrar('sin-presentacion', 'biz-2', {
  name: 'Barbería del Puerto',
  address: 'Rivadavia 500',
  city: 'Necochea',
  isFrozen: false,
});

// Y una sin ningún dato más que el nombre.
sembrar('pelada', 'biz-3', { name: 'Pelada', isFrozen: false });

// El caso que justifica el escapado.
sembrar('inyeccion', 'biz-4', {
  name: 'La "Mejor" <barbería> & Cía',
  welcomeMessage: '"><script>alert(1)</script>',
  isFrozen: false,
});

globalThis.fetch = async (url) => {
  const ruta = decodeURIComponent(String(url).split('/documents/')[1].split('?')[0]);
  const doc = BASE.get(ruta);
  return doc
    ? { ok: true, json: async () => doc }
    : { ok: false, status: 404, json: async () => ({}) };
};

// Con una clave puesta: si no, la función se cae a la tarjeta genérica a
// propósito y no se probaría nada.
process.env.VITE_FIREBASE_API_KEY = 'clave-de-prueba';
process.env.VITE_FIREBASE_PROJECT_ID = 'barberos-1d60e';

const { default: handler } = await import('../api/preview.js');

/** Corre el handler y devuelve `{ html, headers, status }`. */
async function pedir(slug) {
  let html = '', status = 0;
  const headers = {};
  const res = {
    setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
    status(c) { status = c; return this; },
    send: (cuerpo) => { html = cuerpo; },
  };
  await handler({ query: { slug } }, res);
  return { html, headers, status };
}

// ── 1. Una barbería con todo cargado ────────────────────────────────────────
console.log('\nLa tarjeta de una barbería:');
let r = await pedir('volcadoclub');

chequear('responde 200', r.status === 200, String(r.status));
chequear('el título es el nombre de la barbería, no "BarberOS"',
  r.html.includes('<meta property="og:title" content="Volcado Club — Reservá tu turno" />'),
  r.html.match(/og:title[^>]*/)?.[0]);
chequear('la descripción es su presentación',
  r.html.includes('content="Cortes clásicos y barba, en el centro."'),
  r.html.match(/og:description[^>]*/)?.[0]);
chequear('la url apunta a su link',
  r.html.includes('content="https://barberos.sacia.tech/volcadoclub"'), '');
chequear('lleva imagen con medidas (si no, WhatsApp no dibuja la tarjeta grande)',
  r.html.includes('/img/og-barberos.png') && r.html.includes('og:image:width" content="1200"'), '');
chequear('lleva twitter:card grande', r.html.includes('name="twitter:card" content="summary_large_image"'), '');
chequear('se cachea en el borde', /s-maxage=86400/.test(r.headers['cache-control'] || ''), r.headers['cache-control']);
chequear('no se indexa (es para crawlers de tarjetas, no para Google)',
  r.headers['x-robots-tag'] === 'noindex', r.headers['x-robots-tag']);

// ── 2. Sin presentación ─────────────────────────────────────────────────────
console.log('\nCuando falta algún dato:');
r = await pedir('sin-presentacion');
chequear('sin presentación, la descripción usa la dirección',
  r.html.includes('Reservá tu turno online. Rivadavia 500, Necochea'),
  r.html.match(/og:description[^>]*/)?.[0]);

r = await pedir('pelada');
chequear('sin presentación ni dirección, una línea que al menos dice qué es',
  r.html.includes('Reservá tu turno online, sin llamar ni esperar.'),
  r.html.match(/og:description[^>]*/)?.[0]);
chequear('y el título sigue siendo el de la barbería',
  r.html.includes('content="Pelada — Reservá tu turno"'), '');

// ── 3. Slugs que no son de nadie ────────────────────────────────────────────
console.log('\nSlugs que no resuelven:');
for (const [slug, por] of [
  ['no-existe', 'un slug que no está en la base'],
  ['login', 'una ruta del producto, no una barbería'],
  ['', 'sin slug'],
  ['../../etc/passwd', 'un slug con path traversal'],
  ['MAYUSCULAS', 'un slug con mayúsculas'],
  ['a'.repeat(200), 'un slug absurdamente largo'],
]) {
  r = await pedir(slug);
  chequear(`${por}: cae en la tarjeta de BarberOS`,
    r.status === 200 && r.html.includes('BarberOS — Turnos para barberías'),
    `${r.status} ${r.html.slice(0, 120)}`);
}

// Un slug raro no puede terminar crudo adentro del HTML.
r = await pedir('"><h1>x');
chequear('un slug con comillas y etiquetas sale escapado',
  !r.html.includes('<h1>x') && r.html.includes('&quot;&gt;&lt;h1&gt;x'),
  r.html.match(/og:url[^>]*/)?.[0]);

// ── 4. El escapado, que es lo que no puede fallar ───────────────────────────
console.log('\nEscapado (el nombre lo escribe el dueño y termina en un atributo):');
r = await pedir('inyeccion');

chequear('no sale ni una etiqueta <script> del contenido del negocio',
  !/<script/i.test(r.html), r.html.match(/.{0,60}<script.{0,60}/i)?.[0]);
chequear('las comillas del nombre salen como &quot;',
  r.html.includes('La &quot;Mejor&quot; &lt;barbería&gt; &amp; Cía'),
  r.html.match(/og:title[^>]*/)?.[0]);
chequear('el < y el > de la presentación salen escapados',
  r.html.includes('&quot;&gt;&lt;script&gt;'), r.html.match(/og:description[^>]*/)?.[0]);
// Lo que cuenta de verdad: que ningún atributo quede cerrado antes de tiempo.
// Con una comilla cruda, el `content="…"` termina ahí y lo que sigue pasa a ser
// marcado. Si eso pasara, habría más `<meta` abiertos que etiquetas completas.
chequear('ningún atributo se cierra antes de tiempo',
  (r.html.match(/<meta /g) || []).length === (r.html.match(/<meta [^<>]*\/>/g) || []).length,
  `${(r.html.match(/<meta /g) || []).length} metas, ${(r.html.match(/<meta [^<>]*\/>/g) || []).length} bien cerradas`);

// ── 5. Sin clave configurada ────────────────────────────────────────────────
// En un preview de Vercel sin las variables puestas, esto no puede tirar un 500
// en el link de una barbería.
console.log('\nSin VITE_FIREBASE_API_KEY en el entorno:');
process.env.VITE_FIREBASE_API_KEY = '';
r = await pedir('volcadoclub');
chequear('sin clave, responde la tarjeta genérica y no un error',
  r.status === 200 && r.html.includes('BarberOS — Turnos para barberías'), String(r.status));

// ── 6. Si Firestore se cae ──────────────────────────────────────────────────
console.log('\nSi la base no contesta:');
process.env.VITE_FIREBASE_API_KEY = 'clave-de-prueba';
globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
r = await pedir('volcadoclub');
chequear('la base caída no rompe el link',
  r.status === 200 && r.html.includes('BarberOS — Turnos para barberías'), String(r.status));

console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
if (fallas.length) console.log('Fallaron:\n  - ' + fallas.join('\n  - '));
console.log('');
process.exit(fallaron ? 1 : 0);
