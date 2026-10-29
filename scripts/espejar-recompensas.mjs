// Regenera `src/utils/recompensas.js` desde `functions/recompensasMotor.js`.
//
//   node scripts/espejar-recompensas.mjs
//
// El motor vive duplicado (las Functions no pueden importar del bundle de
// Vite). En vez de mantener la copia a mano, se genera: mismo código, con
// `export { … }` en lugar de `module.exports`. `test-recompensas.mjs` falla si
// alguien edita uno y se olvida de correr esto.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const fuente = readFileSync(`${raiz}functions/recompensasMotor.js`, 'utf8').replace(/\r\n/g, '\n');

export function cuerpoDelMotor(texto) {
  const desde = texto.indexOf('const TIPOS_CAMPANA');
  const cuerpo = texto.slice(desde);
  return cuerpo.replace('module.exports = {', 'export {');
}

const CABECERA = `// ============================================================================
// Recompensas — el motor del lado del cliente
// ============================================================================
// GENERADO por \`scripts/espejar-recompensas.mjs\` desde
// \`functions/recompensasMotor.js\`. No editar a mano: editá el motor y corré
// el script. Está duplicado por la misma razón que \`utils/cupon.js\` ↔
// \`functions/cupones.js\`: las Cloud Functions no pueden importar del bundle
// de Vite. \`scripts/test-recompensas.mjs\` falla si las dos copias difieren.
//
// Lo que se calcula acá es una VISTA PREVIA (el desglose antes de confirmar, la
// validación en vivo del panel). Lo que vale es lo que calcula el servidor.

`;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(`${raiz}src/utils/recompensas.js`, CABECERA + cuerpoDelMotor(fuente));
  console.log('src/utils/recompensas.js regenerado.');
}
