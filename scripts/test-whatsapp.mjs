// Los links de wa.me. No necesita emulador: es una función pura.
//
//   node scripts/test-whatsapp.mjs
//
// Por qué tiene su propia suite: el número sale de lo que escribió el cliente al
// reservar, a mano, en el formato que se le ocurrió. Un link mal armado abre
// WhatsApp con un número que no existe —o peor, con el de otra persona—, y eso
// el barbero lo descubre recién cuando manda el mensaje.
import { normalizarTelefono, linkWhatsApp, mensajesDelTurno } from '../src/utils/whatsapp.js';

let ok = 0, mal = 0;
const chequear = (t, cond, detalle = '') => {
  if (cond) { ok++; console.log('  ok    ', t); }
  else { mal++; console.log('  FALLA ', t, detalle ? `\n          ${detalle}` : ''); }
};

console.log('\nNúmeros que tienen que andar:');
const buenos = [
  ['11 2345-6789', '5491123456789', 'celular de Buenos Aires con guion'],
  ['(0223) 15 456-7890', '5492234567890', 'Mar del Plata con 0, 15 y paréntesis'],
  ['+54 9 11 2345 6789', '5491123456789', 'ya en formato internacional'],
  ['02257 15-529684', '5492257529684', 'código de área de 4 dígitos con 15'],
  ['2257529684', '5492257529684', 'pelado, sin 0 ni 15'],
  ['5492257529684', '5492257529684', 'ya normalizado'],
  ['0351 155-123456', '5493515123456', 'Córdoba'],
  ['  11  2345  6789  ', '5491123456789', 'con espacios de más'],
];
for (const [entrada, esperado, caso] of buenos) {
  const real = normalizarTelefono(entrada);
  chequear(`${caso}: "${entrada}"`, real === esperado, `esperado ${esperado}, dio ${real}`);
}

console.log('\nLo que NO tiene que generar un link:');
const malos = [
  ['', 'vacío'],
  [null, 'nulo'],
  [undefined, 'sin definir'],
  ['no tiene', 'texto'],
  ['123', 'muy corto'],
  ['12345678901234567890', 'muy largo'],
  ['-', 'solo separadores'],
];
for (const [entrada, caso] of malos) {
  chequear(`${caso}: ${JSON.stringify(entrada)}`, normalizarTelefono(entrada) === null, `dio ${normalizarTelefono(entrada)}`);
}

console.log('\nEl link:');
const link = linkWhatsApp('11 2345-6789', 'Hola Juan!');
chequear('arma la URL de wa.me', link === 'https://wa.me/5491123456789?text=Hola%20Juan!', link);
chequear('sin teléfono no hay link', linkWhatsApp('', 'Hola') === null);
chequear('escapa el texto', (linkWhatsApp('1123456789', 'Hola & chau') || '').includes('%26'));

console.log('\nLos mensajes:');
const turno = {
  clientName: 'Juan Pérez', appointmentDate: '2026-10-07', startTime: '15:30', status: 'confirmada',
};
const m = mensajesDelTurno(turno, { nombreNegocio: 'Barbería Central', nombreServicio: 'Corte' });
chequear('el recordatorio usa el nombre de pila', m.recordatorio.startsWith('Hola Juan!'), m.recordatorio);
chequear('el recordatorio dice día y hora', m.recordatorio.includes('7/10') && m.recordatorio.includes('15:30'), m.recordatorio);
chequear('el recordatorio nombra la barbería', m.recordatorio.includes('Barbería Central'), m.recordatorio);
chequear('el agradecimiento no promete un horario', !m.gracias.includes('15:30'), m.gracias);

// Un turno a medio cargar no puede generar un mensaje con huecos: "a las
// undefined" es lo que hace que el barbero no use más el botón.
const flojo = mensajesDelTurno({ clientName: '', appointmentDate: '', startTime: '' }, {});
chequear('sin datos, la frase sigue teniendo sentido',
  !/undefined|null|NaN/.test(flojo.recordatorio) && flojo.recordatorio.startsWith('Hola!'),
  flojo.recordatorio);

console.log(`\n${ok} pasaron, ${mal} fallaron\n`);
process.exit(mal ? 1 : 0);
