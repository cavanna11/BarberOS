import { createContext, useContext, useReducer, useEffect } from 'react';
import { jwtDecode } from 'jwt-decode';
import { useBusiness } from './BusinessContext';
import { isPlatformOwner } from '../config/platform';

const AuthContext = createContext();
const AUTH_KEY = 'barberos_auth';

function loadAuth() {
  try {
    const saved = localStorage.getItem(AUTH_KEY);
    if (saved) return JSON.parse(saved);
  } catch (e) {}
  return { user: null, isAuthenticated: false };
}

function saveAuth(state) {
  try {
    localStorage.setItem(AUTH_KEY, JSON.stringify(state));
  } catch (e) {}
}

function authReducer(state, action) {
  switch (action.type) {
    case 'LOGIN':
      return { user: action.payload, isAuthenticated: true };
    case 'LOGOUT':
      return { user: null, isAuthenticated: false };
    case 'UPDATE_USER':
      return { ...state, user: { ...state.user, ...action.payload } };
    default:
      return state;
  }
}

export function AuthProvider({ children }) {
  // AuthProvider es hijo de BusinessProvider → puede usar useBusiness()
  const { state: bizState } = useBusiness();
  const [state, dispatch] = useReducer(authReducer, loadAuth());

  useEffect(() => {
    saveAuth(state);
  }, [state]);

  // Cuando cambia la lista de admins autorizados, revalidar el usuario actual
  // (ej: el dueño le quitó permisos a alguien que ya estaba logueado)
  useEffect(() => {
    if (!state.user) return;
    // Los dueños de plataforma no están en `authorizedAdmins` — su permiso sale
    // de platform.js. Sin este corte, la revalidación no los encuentra y los
    // degrada a 'client', dejándolos con la vista de peluquero en /admin.
    if (isPlatformOwner(state.user.email)) return;

    const authorizedAdmins = bizState.authorizedAdmins || [];
    const match = authorizedAdmins.find(
      (a) => a.email.toLowerCase() === state.user.email.toLowerCase()
    );
    const currentRole = match?.role || 'client';
    const currentProfessionalId = match?.professionalId || null;
    const currentBusinessId = match?.businessId || null;

    // Solo actualizar si el rol, el professionalId o el tenant cambiaron
    if (
      state.user.role !== currentRole ||
      state.user.professionalId !== currentProfessionalId ||
      state.user.businessId !== currentBusinessId
    ) {
      dispatch({
        type: 'UPDATE_USER',
        payload: {
          role: currentRole,
          professionalId: currentProfessionalId,
          businessId: currentBusinessId,
        },
      });
    }
  }, [bizState.authorizedAdmins, state.user]);

  /**
   * Login exclusivo con Google.
   * - Si el Gmail está en authorizedAdmins  → role = 'owner' | 'admin'
   * - Si no está                            → role = 'client'
   */
  const loginWithGoogle = (credential) => {
    try {
      const decoded = jwtDecode(credential);
      const { email, name, picture, sub: googleId } = decoded;

      const platformOwner = isPlatformOwner(email);
      const authorizedAdmins = bizState.authorizedAdmins || [];
      const match = authorizedAdmins.find(
        (a) => a.email.toLowerCase() === email.toLowerCase()
      );

      const user = {
        id: googleId,
        email,
        name,
        avatarUrl: picture,
        googleId,
        role: platformOwner ? 'owner' : (match?.role || 'client'),
        professionalId: platformOwner ? null : (match?.professionalId || null),
        // Tenant al que pertenece. null = cliente, o dueño de plataforma
        // (que no está atado a ningún negocio y elige cuál administrar).
        businessId: platformOwner ? null : (match?.businessId || null),
        isActive: true,
        createdAt: new Date().toISOString(),
      };

      dispatch({ type: 'LOGIN', payload: user });
      return { success: true, user };
    } catch (error) {
      console.error('Google Login Error:', error);
      return { success: false, error: 'Error al iniciar sesión con Google' };
    }
  };

  /**
   * Login sin verificar nada, para probar roles en local.
   * Segundo cerrojo además del de LoginPage: si alguna vez queda una llamada
   * suelta, en producción no hace nada.
   */
  const loginBypass = (email) => {
    if (!import.meta.env.DEV) {
      return { success: false, error: 'Iniciá sesión con Google.' };
    }
    const platformOwner = isPlatformOwner(email);
    const authorizedAdmins = bizState.authorizedAdmins || [];
    const match = authorizedAdmins.find(
      (a) => a.email.toLowerCase() === email.toLowerCase()
    );

    const user = {
      id: 'bypass-' + Date.now(),
      email,
      name: match ? match.name : email.split('@')[0],
      avatarUrl: null,
      role: platformOwner ? 'owner' : (match?.role || 'client'),
      professionalId: platformOwner ? null : (match?.professionalId || null),
      businessId: platformOwner ? null : (match?.businessId || null),
      isActive: true,
      createdAt: new Date().toISOString(),
    };

    dispatch({ type: 'LOGIN', payload: user });
    return { success: true, user };
  };

  const logout = () => {
    dispatch({ type: 'LOGOUT' });
  };

  return (
    <AuthContext.Provider value={{ ...state, loginWithGoogle, loginBypass, logout, dispatch }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
