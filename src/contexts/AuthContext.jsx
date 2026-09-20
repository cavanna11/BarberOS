import { createContext, useContext, useReducer, useEffect, useRef } from 'react';
import {
  signInWithPopup,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  getIdTokenResult,
} from 'firebase/auth';
import { auth, googleProvider } from '../lib/firebase';
import { applyPendingClaims, esFunctionNoDesplegada } from '../lib/functions';
import { useBusiness } from './BusinessContext';
import { isPlatformOwner } from '../config/platform';

const AuthContext = createContext();

/**
 * ============================================================================
 * De dónde salen los permisos
 * ============================================================================
 * De los CUSTOM CLAIMS del token de Firebase, y de ningún otro lado. Solo los
 * escribe el servidor (Cloud Functions con el Admin SDK) y son lo que
 * verifican las Security Rules.
 *
 * Hubo un fallback (lista de mails en `platform.js` + registro de admins)
 * mientras las Functions no estaban desplegadas. Se sacó: con el dueño de la
 * plataforma ya entrando con claims, era un camino de más para razonar y un
 * rol que se podía "dibujar" en la UI sin que el servidor lo respalde.
 * `platform.js` queda solo como comodidad de UI en algún redirect.
 * ============================================================================
 */

function authReducer(state, action) {
  switch (action.type) {
    case 'LOGIN':
      return { user: action.payload, isAuthenticated: true, loading: false };
    case 'LOGOUT':
      return { user: null, isAuthenticated: false, loading: false };
    case 'UPDATE_USER':
      return { ...state, user: { ...state.user, ...action.payload } };
    case 'READY':
      return { ...state, loading: false };
    default:
      return state;
  }
}

// Las sesiones reales las persiste Firebase solo (IndexedDB). Esta clave es
// únicamente para que la sesión falsa de desarrollo sobreviva a un F5.
const DEV_BYPASS_KEY = 'barberos_dev_bypass';

function loadDevBypass() {
  if (!import.meta.env.DEV) return null;
  try {
    const raw = localStorage.getItem(DEV_BYPASS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Reclama un permiso que quedó anotado en /pendingAdmins antes del primer
 * login. Devuelve los claims ya actualizados, o los que había si no había nada
 * pendiente.
 *
 * Solo se llama cuando el token viene SIN claims: alguien que ya los tiene no
 * puede tener nada pendiente (setBusinessAdmin los aplica en el acto cuando el
 * UID ya existe), así que llamar siempre sería pagar una invocación de más.
 */
async function reclamarPendientes(fbUser, claimsActuales) {
  try {
    const res = await applyPendingClaims();
    if (res?.status !== 'applied') return claimsActuales;
    // Los claims recién escritos no están en el token que ya teníamos: sin
    // forzar el refresh, el permiso nuevo tarda hasta una hora en verse.
    const { claims } = await getIdTokenResult(fbUser, true);
    return claims;
  } catch (err) {
    // Mientras no haya Blaze esto falla en todos los logins. No puede romper el
    // ingreso: el fallback local sigue resolviendo permisos mientras tanto.
    if (!esFunctionNoDesplegada(err)) {
      console.error('[auth] No se pudieron aplicar los permisos pendientes:', err);
    }
    return claimsActuales;
  }
}

/**
 * ¿Corresponde reintentar el reclamo para este uid? Marca y responde.
 *
 * Una vez por sesión del navegador, no por carga de página: casi todos los
 * usuarios sin claims son clientes reservando un turno, y llamar en cada
 * navegación sería pagar una invocación por pantalla.
 */
function tocaReintentar(uid) {
  const clave = `barberos_claims_check_${uid}`;
  try {
    if (sessionStorage.getItem(clave)) return false;
    sessionStorage.setItem(clave, '1');
  } catch { /* sin sessionStorage se reintenta igual; no es crítico */ }
  return true;
}

function initialState() {
  const bypass = loadDevBypass();
  return bypass
    ? { user: bypass, isAuthenticated: true, loading: false }
    : { user: null, isAuthenticated: false, loading: true };
}

export function AuthProvider({ children }) {
  // AuthProvider es hijo de BusinessProvider → puede usar useBusiness()
  const { state: bizState } = useBusiness();
  const [state, dispatch] = useReducer(authReducer, undefined, initialState);

  // En un ref y no en el state: el callback de onAuthStateChanged se suscribe
  // una sola vez y capturaría un `state` viejo, borrando la sesión de
  // desarrollo cuando Firebase reporta "sin usuario".
  const bypassActivo = useRef(Boolean(state.user?.isBypass));

  const authorizedAdmins = bizState.authorizedAdmins || [];

  /**
   * Arma el objeto de usuario de la app a partir de la cuenta de Firebase.
   * Prioridad de permisos: claims del token > fallback local.
   */
  const buildUser = (fbUser, claims = {}) => {
    const email = (fbUser.email || '').toLowerCase();

    // Única fuente: claims firmados por el servidor.
    const hasClaims = Boolean(claims.platform || claims.businessId);
    const platformOwner = claims.platform === true;

    // Moderador: equipo de soporte de la plataforma. Entra al panel global, ve
    // todo y atiende tickets, pero no toca plata, cuentas ni suspensiones. Va
    // como `platform: 'moderator'` y no como `true`, así todo lo que exige
    // `platform === true` lo deja afuera por defecto.
    const moderator = claims.platform === 'moderator';

    return {
      id: fbUser.uid,
      email: fbUser.email,
      name: fbUser.displayName || email.split('@')[0],
      avatarUrl: fbUser.photoURL,
      role: platformOwner
        ? 'owner'
        : moderator
          ? 'moderator'
          : (hasClaims ? claims.role : null) || 'client',
      businessId: platformOwner || moderator ? null : (claims.businessId || null),
      professionalId: platformOwner || moderator ? null : (claims.professionalId || null),
      isPlatformOwner: platformOwner,
      isModerator: moderator,
      // Dueño o moderador: quien puede entrar al panel global.
      isPlatformTeam: platformOwner || moderator,
      permissionSource: hasClaims ? 'claims' : 'none',
      isActive: true,
    };
  };

  // Firebase mantiene la sesión entre recargas. Este listener la rehidrata.
  useEffect(() => {
    return onAuthStateChanged(auth, async (fbUser) => {
      // Las sesiones de desarrollo (loginBypass) no son de Firebase: no las pisa.
      if (!fbUser) {
        if (bypassActivo.current) dispatch({ type: 'READY' });
        else dispatch({ type: 'LOGOUT' });
        return;
      }
      bypassActivo.current = false;
      try {
        // Con la red a medio volver (la notebook despierta, cambia el wifi),
        // leer el token puede fallar una vez. Sin reintento, la sesión se
        // rehidrataba SIN claims: el dueño de la plataforma pasaba a ser
        // "cliente", el panel quedaba en cero y solo se arreglaba cerrando y
        // abriendo sesión.
        let claims = null;
        for (let intento = 0; intento < 3; intento++) {
          try {
            ({ claims } = await getIdTokenResult(fbUser));
            break;
          } catch (err) {
            if (intento === 2) throw err;
            await new Promise((r) => setTimeout(r, 1500 * (intento + 1)));
          }
        }

        // Red de seguridad: si el reclamo del login se cortó a mitad (se cerró
        // la pestaña, falló la red), sin esto la persona queda como cliente
        // para siempre y solo se arregla cerrando y abriendo sesión.
        if (!claims.platform && !claims.businessId && tocaReintentar(fbUser.uid)) {
          claims = await reclamarPendientes(fbUser, claims);
        }

        dispatch({ type: 'LOGIN', payload: buildUser(fbUser, claims) });
      } catch (err) {
        console.error('[auth] No se pudieron leer los claims:', err);
        dispatch({ type: 'LOGIN', payload: buildUser(fbUser) });
      }
    });
    // Se suscribe una sola vez.
  }, []);

  /** Login real con Google, vía Firebase. */
  const loginWithGoogle = async () => {
    try {
      const { user: fbUser } = await signInWithPopup(auth, googleProvider);
      let { claims } = await getIdTokenResult(fbUser);

      // Token sin claims: puede ser alguien a quien le dejaron el permiso
      // anotado antes de que existiera su cuenta. Es su primer login.
      if (!claims.platform && !claims.businessId) {
        claims = await reclamarPendientes(fbUser, claims);
      }

      const user = buildUser(fbUser, claims);
      dispatch({ type: 'LOGIN', payload: user });
      return { success: true, user };
    } catch (error) {
      // El usuario cerró el popup: no es un error que haya que mostrar.
      if (
        error.code === 'auth/popup-closed-by-user' ||
        error.code === 'auth/cancelled-popup-request'
      ) {
        return { success: false, cancelled: true };
      }
      console.error('[auth] Error de login con Google:', error);
      const mensajes = {
        'auth/popup-blocked': 'El navegador bloqueó la ventana de Google. Permitila y probá de nuevo.',
        'auth/unauthorized-domain': 'Este dominio no está autorizado en Firebase Authentication.',
        'auth/operation-not-allowed': 'El proveedor de Google no está habilitado en Firebase.',
        'auth/network-request-failed': 'Falló la conexión. Revisá tu internet.',
        // Firebase → Authentication → Settings → User actions → "Enable
        // create (sign-up)" apagado. Bloquea el PRIMER login de cualquiera
        // (barbero nuevo o cliente que viene a reservar), no solo el registro
        // con contraseña. Tiene que estar prendido.
        'auth/admin-restricted-operation': 'Tu cuenta todavía no puede entrar: la creación de cuentas está desactivada en el servidor. Escribinos y lo resolvemos en el momento.',
      };
      // El código va en el mensaje genérico a propósito: "no se pudo" sin más
      // no le sirve a nadie para diagnosticar desde una captura.
      return { success: false, error: mensajes[error.code] || `No se pudo iniciar sesión con Google (${error.code || 'error desconocido'}).` };
    }
  };

  /**
   * Login con email y contraseña, para las cuentas que crea la plataforma desde
   * `/super-admin`. El resto del modelo no cambia: los permisos siguen siendo
   * los custom claims del token, que no saben ni les importa con qué proveedor
   * entró la persona.
   */
  const loginWithPassword = async (email, password) => {
    try {
      const { user: fbUser } = await signInWithEmailAndPassword(auth, email.trim(), password);
      let { claims } = await getIdTokenResult(fbUser);
      if (!claims.platform && !claims.businessId) {
        claims = await reclamarPendientes(fbUser, claims);
      }
      const user = buildUser(fbUser, claims);
      dispatch({ type: 'LOGIN', payload: user });
      return { success: true, user };
    } catch (error) {
      console.error('[auth] Error de login con contraseña:', error);
      const mensajes = {
        'auth/invalid-credential': 'El mail o la contraseña no coinciden.',
        'auth/invalid-email': 'Ese mail no parece válido.',
        'auth/user-disabled': 'Esta cuenta está deshabilitada.',
        'auth/too-many-requests': 'Demasiados intentos. Esperá unos minutos.',
        'auth/network-request-failed': 'Falló la conexión. Revisá tu internet.',
        // Aparece si el proveedor de email/contraseña no está habilitado en
        // Firebase → Authentication → Sign-in method. Es un error de
        // configuración nuestro, no algo que la persona pueda resolver: se le
        // da una salida en vez de un diagnóstico que no le sirve. El detalle
        // real queda en el console.error de arriba.
        'auth/operation-not-allowed': 'El ingreso con contraseña todavía no está disponible. Probá con Google, o escribinos.',
      };
      return { success: false, error: mensajes[error.code] || 'No se pudo iniciar sesión.' };
    }
  };

  /**
   * Login sin verificar nada, para probar roles en local.
   * Ojo: NO crea una sesión de Firebase, así que en cuanto los datos estén en
   * Firestore este usuario no va a poder leer nada (las Rules lo van a
   * rechazar). Sirve solo para la UI mientras la base siga en localStorage.
   */
  const loginBypass = (email) => {
    if (!import.meta.env.DEV) {
      return { success: false, error: 'Iniciá sesión con Google.' };
    }
    const platformOwner = isPlatformOwner(email);
    const match = authorizedAdmins.find((a) => a.email.toLowerCase() === email.toLowerCase());

    const user = {
      id: 'bypass-' + Date.now(),
      email,
      name: match ? match.name : email.split('@')[0],
      avatarUrl: null,
      role: platformOwner ? 'owner' : (match?.role || 'client'),
      professionalId: platformOwner ? null : (match?.professionalId || null),
      businessId: platformOwner ? null : (match?.businessId || null),
      isPlatformOwner: platformOwner,
      permissionSource: 'local',
      isBypass: true,
      isActive: true,
    };

    bypassActivo.current = true;
    try {
      localStorage.setItem(DEV_BYPASS_KEY, JSON.stringify(user));
    } catch { /* sin persistencia, se pierde al recargar; no es crítico */ }

    dispatch({ type: 'LOGIN', payload: user });
    return { success: true, user };
  };

  const logout = async () => {
    bypassActivo.current = false;
    try {
      localStorage.removeItem(DEV_BYPASS_KEY);
    } catch { /* ignorar */ }
    try {
      await signOut(auth);
    } catch (err) {
      console.error('[auth] Error al cerrar sesión:', err);
    }
    dispatch({ type: 'LOGOUT' });
  };

  /**
   * Vuelve a pedir el token para traer claims recién asignados.
   * Sin esto, un permiso nuevo tarda hasta una hora en verse.
   */
  const refreshClaims = async () => {
    if (!auth.currentUser) return null;
    const { claims } = await getIdTokenResult(auth.currentUser, true);
    const user = buildUser(auth.currentUser, claims);
    dispatch({ type: 'LOGIN', payload: user });
    return claims;
  };

  return (
    <AuthContext.Provider
      value={{ ...state, loginWithGoogle, loginWithPassword, loginBypass, logout, refreshClaims, dispatch }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
