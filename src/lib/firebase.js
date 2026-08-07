// ============================================
// Inicialización de Firebase
// ============================================
// Todas las claves de este archivo son PÚBLICAS por diseño: viajan en el bundle
// y se pueden leer desde el browser. No son un secreto y no protegen nada.
// Lo que protege los datos son las Security Rules (firestore.rules).
//
// Los secretos de verdad (token de WhatsApp, access token de Mercado Pago,
// service account) NO van acá: van en las Cloud Functions.

import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getStorage, connectStorageEmulator } from 'firebase/storage';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Falla temprano y claro si falta configuración, en vez de tirar errores raros
// de red más adelante.
const missing = Object.entries(firebaseConfig)
  .filter(([, v]) => !v)
  .map(([k]) => k);

if (missing.length > 0) {
  throw new Error(
    `Falta configuración de Firebase: ${missing.join(', ')}. ` +
    'Revisá tu archivo .env.local (ver .env.example).'
  );
}

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app, 'southamerica-east1');

export const googleProvider = new GoogleAuthProvider();
// Fuerza el selector de cuenta: sin esto, quien tiene varias cuentas de Google
// entra siempre con la última y no puede cambiar.
googleProvider.setCustomParameters({ prompt: 'select_account' });

// ── Emuladores ─────────────────────────────────────────────────────────────
// Con VITE_USE_EMULATORS=true, todo apunta a los emuladores locales y no se
// toca la base de producción. Usalo siempre para probar Security Rules.
if (import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === 'true') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  console.info('[firebase] Usando emuladores locales.');
}

export default app;
