// Saca la paleta real del logo y valida los contrastes.
//
// No es para "ver qué lindo queda": el único color que una barbería elige en
// BarberOS es el de sus botones, y el texto de esos botones se calcula por
// luminancia. Un verde mal elegido es un botón que no se lee, y eso no se ve
// hasta que un cliente no encuentra dónde reservar.
import sharp from 'sharp';

const ARCHIVO = process.argv[2];

const { data, info } = await sharp(ARCHIVO)
  .resize(240, 240, { fit: 'inside' })
  .removeAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

const px = [];
for (let i = 0; i < data.length; i += info.channels) {
  px.push([data[i], data[i + 1], data[i + 2]]);
}

const hex = ([r, g, b]) =>
  '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

// Luminancia relativa de WCAG: es la misma fórmula que usa `textoSobre()` en
// src/config/theme.js para decidir si el texto del botón va blanco o negro.
const lineal = (v) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const lum = ([r, g, b]) => 0.2126 * lineal(r) + 0.7152 * lineal(g) + 0.0722 * lineal(b);
const contraste = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const aRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

// ── 1. Qué colores hay de verdad en el logo ────────────────────────────────
// Se agrupan en cubos de 32 para que mil verdes casi iguales no salgan como
// mil colores distintos.
const cubos = new Map();
for (const p of px) {
  const k = p.map((v) => Math.round(v / 32) * 32).join(',');
  if (!cubos.has(k)) cubos.set(k, { n: 0, suma: [0, 0, 0] });
  const c = cubos.get(k);
  c.n++;
  c.suma[0] += p[0]; c.suma[1] += p[1]; c.suma[2] += p[2];
}
const total = px.length;
const dominantes = [...cubos.values()]
  .map((c) => ({ n: c.n, color: c.suma.map((s) => s / c.n) }))
  .sort((a, b) => b.n - a.n)
  .slice(0, 8);

console.log('\nLos 8 colores que más ocupan el logo:\n');
for (const d of dominantes) {
  const pct = ((d.n / total) * 100).toFixed(1).padStart(5);
  console.log(`  ${pct}%  ${hex(d.color)}   rgb(${d.color.map((v) => Math.round(v)).join(', ')})`);
}

// ── 2. El verde de la marca ────────────────────────────────────────────────
// El fondo es casi todo negro, así que el verde de la marca no es el color más
// frecuente: es el más frecuente ENTRE los que de verdad son verdes y tienen
// algo de brillo. Eso es lo que hay que buscar.
const verdes = px.filter(([r, g, b]) => g > 90 && g > r * 1.15 && g > b * 1.6);
console.log(`\nPíxeles verdes de marca: ${verdes.length} de ${total} (${((verdes.length / total) * 100).toFixed(1)}%)`);

const prom = verdes.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0])
  .map((v) => v / verdes.length);

// El más saturado y brillante: es el que el ojo lee como "el verde del logo".
const vivos = [...verdes].sort((a, b) => (b[1] - b[2]) - (a[1] - a[2])).slice(0, Math.ceil(verdes.length * 0.1));
const vivo = vivos.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0])
  .map((v) => v / vivos.length);

console.log(`  promedio de todos los verdes:  ${hex(prom)}`);
console.log(`  el 10% más vivo (el que se lee como "el" verde): ${hex(vivo)}`);

// ── 3. Los candidatos, contra la regla que de verdad se aplica ─────────────
const BLANCO = [255, 255, 255], NEGRO = [10, 10, 10];
const candidatos = [
  ['#A8E600', 'el que propuso ChatGPT'],
  [hex(vivo), 'el verde vivo del logo (medido)'],
  [hex(prom), 'el promedio de los verdes del logo'],
  ['#3ce000', 'el que Neytan tiene cargado hoy'],
];

console.log('\nContraste del texto sobre el botón (WCAG AA pide 4.5:1; 3:1 para texto grande):\n');
console.log('  color      contra blanco   contra negro   el sistema elige   ¿sirve?');
for (const [h, por] of candidatos) {
  const c = aRgb(h);
  const cb = contraste(c, BLANCO), cn = contraste(c, NEGRO);
  const elige = lum(c) > 0.179 ? 'negro' : 'blanco';
  const r = elige === 'negro' ? cn : cb;
  const veredicto = r >= 4.5 ? 'AA' : r >= 3 ? 'solo texto grande' : 'NO SE LEE';
  console.log(`  ${h}      ${cb.toFixed(2).padStart(5)}:1        ${cn.toFixed(2).padStart(5)}:1        ${elige.padEnd(7)}         ${veredicto}   ${por}`);
}

// ── 4. El verde sobre el negro de la marca ─────────────────────────────────
// La plantilla Simple va sobre fondo claro, pero el logo vive sobre negro y
// conviene saber si el verde aguanta también ahí.
console.log('\nEl verde como TEXTO, no como fondo:\n');
for (const [h, por] of candidatos) {
  const c = aRgb(h);
  console.log(`  ${h}  sobre blanco ${contraste(c, BLANCO).toFixed(2)}:1   sobre #111111 ${contraste(c, aRgb('#111111')).toFixed(2)}:1   ${por}`);
}
console.log('');
