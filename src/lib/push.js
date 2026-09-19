// ============================================================================
// Notificaciones push (Firebase Cloud Messaging) para el staff
// ============================================================================
// El barbero toca "Activar avisos en este dispositivo"; acá se registra el
// service worker, se pide el permiso, se obtiene el token del dispositivo y se
// guarda en Firestore (repository.saveDevice). El trigger de Functions que
// crea la notificación in-app le manda el push a esos tokens.
//
// Cómo se comporta según el dispositivo:
//   - Android (Chrome): anda desde el navegador y, mejor, con la app instalada.
//   - iPhone: SOLO con la app agregada a la pantalla de inicio (iOS 16.4+), y
//     el permiso se tiene que pedir desde un toque del usuario adentro de esa
//     app. Desde Safari "suelto" no hay push, y `Notification` ni existe.
//   - Escritorio: anda en Chrome/Edge/Firefox.
//
// `firebase/messaging` se importa de forma diferida: pesa y solo lo necesita
// quien activa los avisos, no toda la app.

import app from './firebase';
import { saveDevice, removeDevice, savePlatformDevice, removePlatformDevice } from './repository';

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY || '';
const TOKEN_KEY = 'barberos:pushToken';

/** ¿La app está abierta como app instalada (pantalla de inicio)? */
export function esAppInstalada() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

export function esIOS() {
  const ua = navigator.userAgent || '';
  // iPadOS se hace pasar por Mac; el touch lo delata.
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Mac') && navigator.maxTouchPoints > 1);
}

export function esAndroid() {
  return /Android/i.test(navigator.userAgent || '');
}

/**
 * Qué puede hacer este dispositivo hoy. Sirve para que la UI diga la verdad
 * en vez de fallar: en un iPhone sin instalar, la respuesta correcta es
 * "primero instalala", no "tu navegador no soporta notificaciones".
 */
export function estadoPush() {
  const soportaSW = 'serviceWorker' in navigator;
  const soportaPush = 'PushManager' in window;
  const soportaNotif = 'Notification' in window;
  const permiso = soportaNotif ? Notification.permission : 'unsupported';
  const ios = esIOS();
  const instalada = esAppInstalada();

  if (ios && !instalada) return { estado: 'ios-sin-instalar', permiso };
  if (!soportaSW || !soportaPush || !soportaNotif) return { estado: 'sin-soporte', permiso };
  if (!VAPID_KEY) return { estado: 'sin-vapid', permiso };
  if (permiso === 'denied') return { estado: 'bloqueado', permiso };
  if (permiso === 'granted' && localStorage.getItem(TOKEN_KEY)) return { estado: 'activo', permiso };
  return { estado: 'disponible', permiso };
}

async function registrarServiceWorker() {
  const cfg = app.options;
  const qs = new URLSearchParams({
    apiKey: cfg.apiKey,
    authDomain: cfg.authDomain,
    projectId: cfg.projectId,
    messagingSenderId: cfg.messagingSenderId,
    appId: cfg.appId,
  });
  const reg = await navigator.serviceWorker.register(`/firebase-messaging-sw.js?${qs}`, { scope: '/' });
  await navigator.serviceWorker.ready;
  return reg;
}

/**
 * Pide el permiso y registra este dispositivo. Llamar SIEMPRE desde un
 * handler de click: iOS y Chrome ignoran el pedido si no viene de un gesto.
 * Devuelve { ok, estado, mensaje }.
 */
export async function activarPush({ businessId = null, uid, professionalId = null, role = 'admin', plataforma = false }) {
  const s = estadoPush();
  if (['ios-sin-instalar', 'sin-soporte', 'sin-vapid', 'bloqueado'].includes(s.estado)) {
    return { ok: false, estado: s.estado };
  }

  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') return { ok: false, estado: permiso === 'denied' ? 'bloqueado' : 'rechazado' };

  const { getMessaging, getToken } = await import('firebase/messaging');
  const reg = await registrarServiceWorker();
  const messaging = getMessaging(app);
  const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
  if (!token) return { ok: false, estado: 'sin-token' };

  await guardar({ plataforma, businessId, token, uid, professionalId, role });
  try { localStorage.setItem(TOKEN_KEY, token); } catch { /* sin storage */ }
  return { ok: true, estado: 'activo' };
}

/**
 * Si este dispositivo ya estaba activado, refresca el registro (el token
 * puede rotar) sin pedir nada. Llamar al entrar al panel.
 */
export async function refrescarPush({ businessId = null, uid, professionalId = null, role = 'admin', plataforma = false }) {
  if (estadoPush().estado !== 'activo') return;
  try {
    const { getMessaging, getToken } = await import('firebase/messaging');
    const reg = await registrarServiceWorker();
    const token = await getToken(getMessaging(app), { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
    if (!token) return;
    const viejo = localStorage.getItem(TOKEN_KEY);
    if (viejo && viejo !== token) await borrar({ plataforma, businessId, token: viejo }).catch(() => {});
    await guardar({ plataforma, businessId, token, uid, professionalId, role });
    localStorage.setItem(TOKEN_KEY, token);
  } catch (err) {
    console.warn('[push] No se pudo refrescar el registro:', err);
  }
}

/** Da de baja este dispositivo (por ejemplo, al cerrar sesión). */
export async function desactivarPush(businessId = null, { plataforma = false } = {}) {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return;
  try { await borrar({ plataforma, businessId, token }); } catch { /* ya no estaba */ }
  try {
    const { getMessaging, deleteToken } = await import('firebase/messaging');
    await deleteToken(getMessaging(app));
  } catch { /* nada */ }
  localStorage.removeItem(TOKEN_KEY);
}

// Dónde se guarda el token: en el negocio (staff) o en la colección del
// equipo de la plataforma (panel global).
function guardar({ plataforma, businessId, token, uid, professionalId, role }) {
  const datos = {
    uid, professionalId, role,
    plataforma: esIOS() ? 'ios' : esAndroid() ? 'android' : 'desktop',
    instalada: esAppInstalada(),
    userAgent: (navigator.userAgent || '').slice(0, 200),
  };
  return plataforma ? savePlatformDevice(token, datos) : saveDevice(businessId, token, datos);
}

function borrar({ plataforma, businessId, token }) {
  return plataforma ? removePlatformDevice(token) : removeDevice(businessId, token);
}

/** Numerito sobre el ícono de la app instalada (Android e iOS instalada). */
export function ponerBadge(n) {
  if (!('setAppBadge' in navigator)) return;
  (n > 0 ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
}
