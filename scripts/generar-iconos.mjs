// Genera los PNG que piden Android (manifest) e iOS (apple-touch-icon) a partir
// del logo SVG. Correr cuando cambie el logo: node scripts/generar-iconos.mjs
import sharp from 'sharp';
import { readFileSync } from 'fs';

const svg = readFileSync('public/img/barberos-logo-icon.svg');
const FONDO = '#fafafa';

// Ícono "normal": el logo sobre casi-blanco con margen, esquinas las pone el SO.
async function icono(tam, salida, margen = 0.12) {
  const interior = Math.round(tam * (1 - margen * 2));
  const logo = await sharp(svg).resize(interior, interior, { fit: 'contain', background: FONDO }).png().toBuffer();
  await sharp({ create: { width: tam, height: tam, channels: 4, background: FONDO } })
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toFile(salida);
  console.log('ok', salida);
}

await icono(192, 'public/icons/icon-192.png');
await icono(512, 'public/icons/icon-512.png');
// Maskable: Android recorta un círculo/forma; el logo tiene que quedar en el
// 80% central ("safe zone"), así que más margen.
await icono(512, 'public/icons/icon-512-maskable.png', 0.2);
// iOS: 180x180, sin transparencia, esquinas las redondea el sistema.
await icono(180, 'public/icons/apple-touch-icon.png', 0.14);
// Badge monocromo para la notificación en Android (barra de estado).
const badge = await sharp(svg).resize(72, 72, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png().toBuffer();
await sharp(badge).greyscale().png().toFile('public/icons/badge-72.png');
console.log('ok public/icons/badge-72.png');
