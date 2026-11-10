// ============================================================================
// Cupones — el cálculo del lado del cliente
// ============================================================================
// Espejo de `functions/cupones.js`. Está duplicado a propósito y por la misma
// razón que `config/plans.js` ↔ `functions/planes.js`: las Cloud Functions no
// pueden importar del bundle de Vite.
//
// Si tocás uno, tocá el otro. `scripts/test-cupones.mjs` compara los dos con
// los mismos casos, así que una diferencia se ve ahí y no en producción.
//
// Lo que se calcula acá es una VISTA PREVIA: sirve para mostrarle al cliente el
// desglose antes de confirmar, y al dueño cómo le queda el cupón mientras lo
// arma. El precio que se cobra lo decide `createAppointment` con el precio del
// documento del servicio.

/** El código, como se guarda y como se compara. Ver functions/cupones.js. */
export function normalizarCodigo(codigo) {
  return String(codigo ?? '').replace(/\s+/g, '').toUpperCase();
}

export const CODIGO_OK = /^[A-Z0-9][A-Z0-9-]{2,23}$/;

export function codigoValido(codigo) {
  return CODIGO_OK.test(normalizarCodigo(codigo));
}

/**
 * Cuánto descuenta este cupón sobre este precio.
 *
 * Nunca negativo, nunca mayor al precio, siempre entero. Un fijo más grande que
 * el precio se recorta al precio.
 */
export function calcularDescuento(cupon, precio) {
  const base = Math.max(0, Math.round(Number(precio) || 0));
  const valor = Number(cupon?.valor) || 0;

  let descuento = 0;
  if (cupon?.tipo === 'porcentaje') {
    const pct = Math.min(100, Math.max(0, valor));
    descuento = Math.round((base * pct) / 100);
  } else if (cupon?.tipo === 'fijo') {
    descuento = Math.max(0, Math.round(valor));
  }

  descuento = Math.min(descuento, base);
  return { descuento, precioFinal: base - descuento };
}

/** '20% OFF' o '$3.000 OFF'. */
export function describirCupon(cupon) {
  if (!cupon) return '';
  if (cupon.tipo === 'porcentaje') return `${Number(cupon.valor) || 0}% OFF`;
  return `$${(Number(cupon.valor) || 0).toLocaleString('es-AR')} OFF`;
}

// ── Días de la semana (copia de functions/cupones.js) ──────────────────────
// 0 = Lunes … 6 = Domingo. Vacío = todos. Cuenta el día del TURNO.

export const NOMBRES_DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

export function diaDeLaSemana(fechaISO) {
  const d = new Date(`${fechaISO}T12:00:00Z`).getUTCDay();
  return d === 0 ? 6 : d - 1;
}

export function diasDelCupon(cupon) {
  const dias = Array.isArray(cupon?.dias) ? cupon.dias : [];
  const limpios = [...new Set(dias.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
  return limpios.length === 7 ? [] : limpios;
}

export function textoDeDias(dias) {
  const d = diasDelCupon({ dias });
  if (d.length === 0) return 'todos los días';
  if (d.length === 1) return d[0] === 5 || d[0] === 6 ? `los ${NOMBRES_DIAS[d[0]]}s` : `los ${NOMBRES_DIAS[d[0]]}`;
  const seguidos = d.every((x, i) => i === 0 || x === d[i - 1] + 1);
  if (seguidos && d.length >= 3) return `de ${NOMBRES_DIAS[d[0]]} a ${NOMBRES_DIAS[d[d.length - 1]]}`;
  const nombres = d.map((x) => NOMBRES_DIAS[x]);
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
}

/** ¿Sirve este cupón (ya validado) para un turno en esta fecha? */
export function cuponValeElDia(cupon, fechaISO) {
  const dias = diasDelCupon(cupon);
  if (dias.length === 0) return true;
  return Boolean(fechaISO) && dias.includes(diaDeLaSemana(fechaISO));
}

/** Lo único que se le dice al cliente cuando un cupón no entra. */
export const MENSAJE_AL_CLIENTE = 'El código no es válido o ya no está disponible.';

/**
 * ¿Este cupón está vigente HOY, mirando solo lo que el panel puede saber?
 *
 * Es para la lista de cupones del dueño: activo, dentro de fechas y con cupo.
 * No sabe de clientes ni de primera visita — eso depende de quién reserve.
 */
export function estadoDelCupon(cupon, ahora = new Date()) {
  if (!cupon) return { estado: 'no-existe', label: 'No existe', clase: 'badge-neutral' };
  if (cupon.activo !== true) return { estado: 'inactivo', label: 'Apagado', clase: 'badge-neutral' };

  const t = ahora.getTime();
  if (cupon.desde && t < new Date(cupon.desde).getTime()) {
    return { estado: 'no-vigente', label: 'Todavía no empieza', clase: 'badge-warning' };
  }
  if (cupon.hasta && t > new Date(cupon.hasta).getTime()) {
    return { estado: 'vencido', label: 'Vencido', clase: 'badge-danger' };
  }

  const max = Number(cupon.maxUsos);
  if (Number.isFinite(max) && max > 0 && Number(cupon.usos || 0) >= max) {
    return { estado: 'agotado', label: 'Agotado', clase: 'badge-danger' };
  }

  return { estado: 'activo', label: 'Andando', clase: 'badge-success' };
}

/** 'https://barberos.sacia.tech/volcadoclub?cupon=CORTE20' */
export function linkDelCupon(slug, codigo, serviceId = null) {
  const base = `${window.location.origin}/${slug}?cupon=${encodeURIComponent(normalizarCodigo(codigo))}`;
  return serviceId ? `${base}&servicio=${encodeURIComponent(serviceId)}` : base;
}

/**
 * El mensaje para pegar en una historia de Instagram.
 *
 * Con el link adentro: en Stories el link va en el sticker, pero esto también
 * se manda por WhatsApp y por el estado, y ahí el texto es todo lo que hay.
 */
export function mensajeParaCompartir(cupon, nombreNegocio, link) {
  const desc = describirCupon(cupon);
  const dias = diasDelCupon(cupon);
  const cuando = dias.length ? ` Válido para turnos ${textoDeDias(dias)}.` : '';
  return `Reservá tu turno en ${nombreNegocio} y aprovechá ${desc} con el código ${cupon.codigo}.${cuando}\n\n${link}`;
}

// ── El cupón que vino en el link ───────────────────────────────────────────
// `/:slug?cupon=CORTE20` tiene que sobrevivir a todo lo que pasa después: los
// seis pasos de la reserva, el login con Google, y la ida y vuelta a Mercado
// Pago. Nada de eso conserva la query string.
//
// Va en `sessionStorage` y no en el estado de React porque el viaje a Mercado
// Pago es una navegación de verdad: la app se desmonta y se vuelve a montar.
// Y en session y no en local porque es de ESTA visita: el que abrió el link de
// la promo el mes pasado no tiene que seguir viéndola.
//
// Por barbería, no global: en una cuenta con sucursales cada local tiene sus
// cupones, y el de una no vale en la otra.

const CLAVE_CUPON = (businessId) => `barberos:cupon:${businessId}`;

export function recordarCupon(businessId, codigo) {
  if (!businessId || !codigo) return;
  try { sessionStorage.setItem(CLAVE_CUPON(businessId), normalizarCodigo(codigo)); } catch { /* sin storage, se pierde y listo */ }
}

export function cuponRecordado(businessId) {
  if (!businessId) return null;
  try { return sessionStorage.getItem(CLAVE_CUPON(businessId)); } catch { return null; }
}

export function olvidarCupon(businessId) {
  if (!businessId) return;
  try { sessionStorage.removeItem(CLAVE_CUPON(businessId)); } catch { /* nada */ }
}
