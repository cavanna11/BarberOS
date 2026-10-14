// ============================================================================
// El navegador que vive adentro de otra app
// ============================================================================
// Instagram, Facebook, WhatsApp, TikTok y los clientes de mail no abren Safari
// ni Chrome: abren su propio navegador adentro de la app. Y el link de BarberOS
// se reparte JUSTO por ahí — la bio de Instagram y WhatsApp son el camino
// principal por el que llega un cliente.
//
// Ahí el login con Google se rompe, y de la peor manera:
//
//   1. Ese navegador bloquea las ventanas emergentes.
//   2. Firebase cae solo a su camino alternativo, que es redirigir.
//   3. La redirección sale a `<proyecto>.firebaseapp.com`, otro dominio.
//   4. iOS aísla el almacenamiento entre dominios, así que esa página no puede
//      leer el estado que había guardado antes de salir.
//
// El cliente termina en una pantalla blanca de Firebase que dice "Unable to
// process request due to missing initial state". No hizo nada mal, no se
// arregla reintentando, y lo más probable es que no avise: simplemente no
// reserva.
//
// Servir el ayudante de Firebase desde nuestro propio dominio arregla (3) y
// (4). Pero según el propio repositorio de Firebase hay casos de iOS dentro de
// estos navegadores que fallan igual, así que esto no sobra: es más barato
// avisarle ANTES de que toque el botón que dejarlo estrellarse contra un error
// que no explica nada.

/**
 * Las marcas que dejan en el user agent. Solo las que de verdad importan acá.
 *
 * `FBAN`/`FBAV` son de Facebook e Instagram; `Instagram` aparece aparte en
 * Android. `Line`, `WhatsApp` y `Snapchat` son explícitos. `wv` es la marca de
 * un WebView de Android (los de las apps de mail, entre otros).
 */
const MARCAS = [
  { re: /FBAN|FBAV|FB_IAB/i, nombre: 'Facebook' },
  { re: /Instagram/i, nombre: 'Instagram' },
  { re: /WhatsApp/i, nombre: 'WhatsApp' },
  { re: /\bLine\//i, nombre: 'LINE' },
  { re: /Snapchat/i, nombre: 'Snapchat' },
  { re: /TikTok|BytedanceWebview|musical_ly/i, nombre: 'TikTok' },
  { re: /Twitter/i, nombre: 'X' },
  { re: /LinkedInApp/i, nombre: 'LinkedIn' },
  { re: /; wv\)/i, nombre: null },
];

/**
 * ¿Estamos adentro del navegador de otra app? Devuelve el nombre si se puede
 * saber, `true` si se detecta pero no se sabe cuál, o `false`.
 *
 * Deliberadamente NO intenta detectar "todo navegador raro": un falso positivo
 * le muestra un cartel innecesario a alguien que iba a poder entrar igual. Solo
 * las apps donde está comprobado que no se puede.
 */
export function navegadorEmbebido(ua = typeof navigator !== 'undefined' ? navigator.userAgent : '') {
  const texto = String(ua || '');
  if (!texto) return false;

  for (const { re, nombre } of MARCAS) {
    if (re.test(texto)) return nombre || true;
  }
  return false;
}

/** ¿Es un iPhone o iPad? Ahí el aislamiento de almacenamiento es más estricto. */
export function esIOS(ua = typeof navigator !== 'undefined' ? navigator.userAgent : '') {
  return /iPad|iPhone|iPod/i.test(String(ua || ''));
}

/**
 * Cómo se sale de ahí, en las palabras de cada sistema.
 *
 * En iPhone el menú dice "Abrir en Safari"; en Android, "Abrir en el navegador"
 * o "Abrir en Chrome". Decirle "abrí esto en tu navegador" a secas no alcanza:
 * la persona está mirando algo que ya parece un navegador.
 */
export function comoAbrirlo(ua = typeof navigator !== 'undefined' ? navigator.userAgent : '') {
  return esIOS(ua)
    ? 'Tocá el botón de compartir o los tres puntitos de arriba y elegí «Abrir en Safari».'
    : 'Tocá los tres puntitos de arriba y elegí «Abrir en Chrome» o «Abrir en el navegador».';
}
