import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { BusinessProvider } from './contexts/BusinessContext';
import { AuthProvider } from './contexts/AuthContext';
import { BookingProvider } from './contexts/BookingContext';

// Ya no hace falta <GoogleOAuthProvider>: el login pasa por Firebase Auth
// (signInWithPopup), que además crea la sesión de servidor que necesitan las
// Security Rules. La config de Firebase se inicializa en src/lib/firebase.js.

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BusinessProvider>
      <AuthProvider>
        <BookingProvider>
          <App />
        </BookingProvider>
      </AuthProvider>
    </BusinessProvider>
  </StrictMode>
);
