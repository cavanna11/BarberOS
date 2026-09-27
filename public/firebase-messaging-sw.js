/* eslint-disable no-undef */
// ============================================================================
// Service worker de BarberOS
// ============================================================================
// Hace dos cosas, y nada más:
//   1. Recibe las notificaciones push (Firebase Cloud Messaging) y las muestra.
//   2. Al tocar la notificación, abre (o trae al frente) la agenda.
//
// NO cachea la app a propósito: un service worker que guarda el bundle es la
// forma más fácil de que un barbero quede pegado a una versión vieja. La app
// se sigue bajando de Vercel como siempre.
//
// La configuración de Firebase (pública) llega por la query string con la que
// lo registra src/lib/push.js — así no hay que duplicar las claves acá.
//
// ── Por qué hay DOS caminos para mostrar el aviso ──────────────────────────
// El servidor manda `notification` además de `data`, así que en segundo plano
// el navegador dibuja el aviso solo, sin depender de que este archivo corra.
// Eso arregla el caso peor: si `importScripts` falla (sin red, gstatic
// bloqueado, cuota), antes el push llegaba y no se veía NADA.
//
// El listener de `push` de abajo es el respaldo para los mensajes que vengan
// sin `notification` (los viejos, o si algún día volvemos a mandar solo datos).
// Los dos usan el MISMO `tag`, así que si por una carrera se dibujaran dos, el
// segundo reemplaza al primero y la persona ve uno.

importScripts('https://www.gstatic.com/firebasejs/12.17.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.17.1/firebase-messaging-compat.js');

const params = new URLSearchParams(self.location.search);
const config = {
  apiKey: params.get('apiKey'),
  authDomain: params.get('authDomain'),
  projectId: params.get('projectId'),
  messagingSenderId: params.get('messagingSenderId'),
  appId: params.get('appId'),
};

function mostrar(d) {
  const title = d.title || 'BarberOS';
  const options = {
    body: d.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    tag: d.notificationId || undefined, // dos pushes del mismo aviso no se duplican
    data: { url: d.url || '/admin/citas' },
    vibrate: [120, 60, 120],
  };
  // Puntito en el ícono de la app (Android, iOS instalada). El número exacto
  // lo pone la app al abrirse, acá solo se marca que hay algo.
  if (self.navigator && 'setAppBadge' in self.navigator) {
    self.navigator.setAppBadge().catch(() => {});
  }
  return self.registration.showNotification(title, options);
}

if (config.apiKey && config.projectId) {
  firebase.initializeApp(config);
  const messaging = firebase.messaging();

  // Solo para los mensajes de SOLO datos: si el mensaje trae `notification`,
  // el navegador ya lo dibujó y volver a dibujarlo es trabajo de más.
  messaging.onBackgroundMessage((payload) => {
    if (payload.notification) return;
    return mostrar(payload.data || {});
  });
}

// Respaldo: si el SDK no llegó a inicializarse, acá igual se muestra algo. Sin
// esto, un fallo al cargar Firebase dejaba el push mudo.
self.addEventListener('push', (event) => {
  if (config.apiKey && config.projectId) return; // ya lo maneja el SDK
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { /* texto suelto */ }
  const d = payload.data || payload.notification || payload || {};
  event.waitUntil(mostrar(d));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/admin/citas';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ventanas) => {
      // Si la app ya está abierta, traerla al frente y navegar; si no, abrirla.
      for (const w of ventanas) {
        if ('focus' in w) {
          w.focus();
          if ('navigate' in w) w.navigate(url).catch(() => {});
          return;
        }
      }
      return self.clients.openWindow(url);
    })
  );
});

// Tomar el control apenas se instala, sin esperar a que se cierren las pestañas.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
