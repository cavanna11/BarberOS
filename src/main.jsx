import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { firebaseListo } from './lib/firebase';
import ConfigErrorPage from './pages/ConfigErrorPage';
import { BusinessProvider } from './contexts/BusinessContext';
import { AuthProvider } from './contexts/AuthContext';
import { BookingProvider } from './contexts/BookingContext';
import ErrorDePantalla from './components/layout/ErrorDePantalla';
import { recargarPorVersionNueva } from './utils/versionNueva';

// Vite avisa así cuando no pudo bajar un pedazo de la app: casi siempre es una
// pestaña abierta desde antes del último deploy. Ver utils/versionNueva.js.
window.addEventListener('vite:preloadError', (e) => {
  if (recargarPorVersionNueva()) e.preventDefault();
});

// El login pasa por Firebase Auth (signInWithPopup), que crea la sesión de
// servidor que necesitan las Security Rules. La config se inicializa en
// src/lib/firebase.js.

// Si el build salió sin las variables de entorno, no se monta la app: sus
// providers se conectarían a un Firebase inexistente. En vez de la pantalla en
// blanco, se muestra qué falta y cómo arreglarlo.
const raiz = createRoot(document.getElementById('root'));

if (!firebaseListo) {
  raiz.render(<ConfigErrorPage />);
} else {
  raiz.render(
    <StrictMode>
      <ErrorDePantalla>
        <BusinessProvider>
          <AuthProvider>
            <BookingProvider>
              <App />
            </BookingProvider>
          </AuthProvider>
        </BusinessProvider>
      </ErrorDePantalla>
    </StrictMode>
  );
}
