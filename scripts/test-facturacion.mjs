// Cuentas del pago del abono (src/utils/facturacion.js), sin emulador.
//   node scripts/test-facturacion.mjs
import { aplicarPago, faltaParaElAbono, sumarUnMes, hoyEnArgentina } from '../src/utils/facturacion.js';

let ok = 0, mal = 0;
function caso(nombre, obtenido, esperado) {
  const a = JSON.stringify(obtenido), b = JSON.stringify(esperado);
  if (a === b) { ok++; console.log('  ✓', nombre); }
  else { mal++; console.log('  ✗', nombre, '\n     obtuvo  ', a, '\n     esperaba', b); }
}

const r = (debt, nextBillingDate, mesesAdelantados) => ({ debt, nextBillingDate, mesesAdelantados });

console.log('aplicarPago');
// El caso de Neytan (09/11/2026): paga el día del vencimiento, con la deuda en 0.
caso('pago el día del vencimiento corre un mes',
  aplicarPago({ debt: 0, nextBillingDate: '2026-11-09', monthlyFee: 15000 }, 15000), r(0, '2026-12-09', 1));
caso('pago de la deuda justa no corre nada (ya la corrió runBilling)',
  aplicarPago({ debt: 15000, nextBillingDate: '2026-12-09', monthlyFee: 15000 }, 15000), r(0, '2026-12-09', 0));
caso('deuda más un mes adelantado',
  aplicarPago({ debt: 15000, nextBillingDate: '2026-12-09', monthlyFee: 15000 }, 30000), r(0, '2027-01-09', 1));
caso('pago parcial con deuda',
  aplicarPago({ debt: 15000, nextBillingDate: '2026-12-09', monthlyFee: 15000 }, 5000), r(10000, '2026-12-09', 0));
caso('deuda más un sobrante chico no regala un mes',
  aplicarPago({ debt: 15000, nextBillingDate: '2026-12-09', monthlyFee: 15000 }, 20000), r(0, '2026-12-09', 0));
caso('sin deuda y monto con descuento: cubre el mes que vence',
  aplicarPago({ debt: 0, nextBillingDate: '2026-11-09', monthlyFee: 15000 }, 12000), r(0, '2026-12-09', 1));
caso('tres abonos por adelantado',
  aplicarPago({ debt: 0, nextBillingDate: '2026-11-09', monthlyFee: 15000 }, 45000), r(0, '2027-02-09', 3));
caso('tope de 12 meses ante un cero de más',
  aplicarPago({ debt: 0, nextBillingDate: '2026-11-09', monthlyFee: 15000 }, 1500000), r(0, '2027-11-09', 12));
caso('cuenta de regalo no mueve nada',
  aplicarPago({ debt: 0, nextBillingDate: '2026-11-09', monthlyFee: 0 }, 1000), r(0, '2026-11-09', 0));
caso('sin vencimiento cargado no inventa uno',
  aplicarPago({ debt: 0, nextBillingDate: null, monthlyFee: 15000 }, 15000), r(0, null, 0));
caso('monto en 0 no hace nada',
  aplicarPago({ debt: 15000, nextBillingDate: '2026-12-09', monthlyFee: 15000 }, 0), r(15000, '2026-12-09', 0));

console.log('sumarUnMes');
caso('31/01 → 28/02', sumarUnMes('2026-01-31'), '2026-02-28');
caso('diciembre → enero', sumarUnMes('2026-12-09'), '2027-01-09');

console.log('faltaParaElAbono');
caso('sin deuda, $5.000 sobre $60.000: faltan $55.000', faltaParaElAbono({ debt: 0, monthlyFee: 60000 }, 5000), 55000);
caso('sin deuda, el abono entero: nada', faltaParaElAbono({ debt: 0, monthlyFee: 60000 }, 60000), 0);
caso('con deuda no se pregunta (el pago va a la deuda)', faltaParaElAbono({ debt: 15000, monthlyFee: 60000 }, 5000), 0);
caso('cuenta de regalo (abono 0): nada', faltaParaElAbono({ debt: 0, monthlyFee: 0 }, 5000), 0);

console.log('hoyEnArgentina');
caso('22:30 en Buenos Aires sigue siendo el mismo día', hoyEnArgentina(new Date('2026-11-10T01:30:00Z')), '2026-11-09');

console.log(`\n${ok} pasan, ${mal} fallan`);
process.exit(mal ? 1 : 0);
