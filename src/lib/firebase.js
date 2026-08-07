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

/**
 * Qué variables faltan. Vite congela las VITE_* en tiempo de compilación, así
 * que si el build se hizo sin ellas (por ejemplo en Vercel, sin cargarlas en
 * Environment Variables) llegan todas vacías.
 *
 * Antes esto tiraba un throw en el import y el resultado era una pantalla en
 * blanco sin explicación. Ahora se exporta el diagnóstico y main.jsx muestra
 * una pantalla que dice exactamente qué falta.
 */
export const faltanVariables = Object.entries(firebaseConfig)
  .filter(([, v]) => !v)
  .map(([k]) => `VITE_FIREBASE_${k.replace(/[A-Z]/g, (c) => '_' + c).toUpperCase()}`);

export const firebaseListo = faltanVariables.length === 0;

if (!firebaseListo) {
  console.error(
    '[firebase] Falta configuración:', faltanVariables.join(', '),
    '\nEn local: archivo .env (ver .env.example).',
    '\nEn Vercel: Settings → Environment Variables, y volver a desplegar.'
  );
}

// Sin config no se inicializa: initializeApp con valores vacíos deja un cliente
// roto que falla más tarde y con errores peores de leer.
const app = firebaseListo ? initializeApp(firebaseConfig) : null;

export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
export const storage = app ? getStorage(app) : null;
export const functions = app ? getFunctions(app, 'southamerica-east1') : null;

export const googleProvider = app ? new GoogleAuthProvider() : null;
// Fuerza el selector de cuenta: sin esto, quien tiene varias cuentas de Google
// entra siempre con la última y no puede cambiar.
if (googleProvider) googleProvider.setCustomParameters({ prompt: 'select_account' });

// ── Emuladores ─────────────────────────────────────────────────────────────
// Con VITE_USE_EMULATORS=true, todo apunta a los emuladores locales y no se
// toca la base de producción. Usalo siempre para probar Security Rules.
if (app && import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === 'true') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  console.info('[firebase] Usando emuladores locales.');
}

export default app;
