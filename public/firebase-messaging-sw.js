/* eslint-disable no-undef */
// ============================================================================
// Service worker de BarberOS
// ============================================================================
// Hace dos cosas, y nada más:
//   1. Recibe las notificaciones push (Firebase Cloud Messaging) cuando la app
//      está cerrada o en segundo plano, y las muestra.
//   2. Al tocar la notificación, abre (o trae al frente) la agenda.
//
// NO cachea la app a propósito: un service worker que guarda el bundle es la
// forma más fácil de que un barbero quede pegado a una versión vieja. La app
// se sigue bajando de Vercel como siempre.
//
// La configuración de Firebase (pública) llega por la query string con la que
// lo registra src/lib/push.js — así no hay que duplicar las claves acá.

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

if (config.apiKey && config.projectId) {
  firebase.initializeApp(config);
  const messaging = firebase.messaging();

  // Mensajes de datos (los manda el trigger de Functions sin bloque
  // `notification`, para decidir acá cómo se muestran).
  messaging.onBackgroundMessage((payload) => {
    const d = payload.data || {};
    const title = d.title || 'BarberOS';
    const options = {
      body: d.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-72.png',
      tag: d.notificationId || undefined, // dos pushes del mismo aviso no se duplican
      data: { url: d.url || '/admin/citas' },
      vibrate: [120, 60, 120],
    };
    // Puntito en el ícono de la app (Android, iOS instalada). El número
    // exacto lo pone la app al abrirse, acá solo se marca que hay algo.
    if (self.navigator && 'setAppBadge' in self.navigator) {
      self.navigator.setAppBadge().catch(() => {});
    }
    return self.registration.showNotification(title, options);
  });
}

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
