// Cuentas del abono que BarberOS le cobra a cada barbería.
//
// Funciones puras: reciben los datos y devuelven el resultado, sin Firestore.
// `sumarUnMes` y `hoyEnArgentina` son copia de las de functions/index.js
// (las Functions no pueden importar del bundle de Vite); si cambia una, la otra.

/** 'YYYY-MM-DD' de hoy en Buenos Aires (no UTC: a las 21 h en UTC ya es mañana). */
export function hoyEnArgentina(ahora = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(ahora);
}

/** Suma un mes recortando el día al último del mes destino (31/01 → 28/02). */
export function sumarUnMes(fechaISO) {
  const [y, m, d] = fechaISO.split('-').map(Number);
  const anio = m === 12 ? y + 1 : y;
  const mes = m === 12 ? 1 : m + 1;
  const ultimoDia = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const dia = Math.min(d, ultimoDia);
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/**
 * Qué pasa con la facturación cuando entra un pago.
 *
 * `runBilling` es "mes vencido": recién el día DESPUÉS del vencimiento suma el
 * abono a la deuda y corre la fecha un mes. Entonces el que paga EL DÍA del
 * vencimiento (o antes) paga con deuda en 0: antes eso solo bajaba una deuda
 * que no existía, la fecha quedaba igual, y a las 3 AM siguientes se le cargaba
 * el mes que ya había pagado y la cuenta se congelaba.
 *
 * Regla: el pago cancela primero la deuda. Lo que sobra paga meses por
 * adelantado, uno por cada abono entero, y cada mes pagado corre el
 * vencimiento. Si no había deuda y el monto no llega a un abono entero (un
 * precio acordado distinto, un descuento), igual se toma como el mes que vence:
 * nadie paga por adelantado para no cubrir nada.
 */
export function aplicarPago({ debt = 0, nextBillingDate = null, monthlyFee = 0 }, monto) {
  const deudaAntes = Math.max(0, Number(debt) || 0);
  const pago = Math.max(0, Number(monto) || 0);
  const abono = Math.max(0, Number(monthlyFee) || 0);

  const nuevaDeuda = Math.max(0, deudaAntes - pago);
  const sobrante = Math.max(0, pago - deudaAntes);

  let meses = 0;
  if (abono > 0 && sobrante > 0) {
    meses = Math.floor(sobrante / abono);
    if (meses === 0 && deudaAntes === 0) meses = 1;
  }
  // Red por si alguien tipea un cero de más: más de un año adelantado no es un pago.
  meses = Math.min(meses, 12);

  let vencimiento = nextBillingDate;
  if (vencimiento) {
    for (let i = 0; i < meses; i++) vencimiento = sumarUnMes(vencimiento);
  }

  return { debt: nuevaDeuda, nextBillingDate: vencimiento, mesesAdelantados: vencimiento ? meses : 0 };
}
