import { createContext, useContext, useReducer, useEffect, useRef } from 'react';
import {
  signInWithPopup,
  getRedirectResult,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  updateProfile,
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

/** La promesa, o un error si tarda más de `ms`. */
function conReloj(promesa, ms) {
  return Promise.race([
    promesa,
    new Promise((_, rechazar) => setTimeout(() => rechazar(new Error('tardó demasiado')), ms)),
  ]);
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
      // Cuenta con sucursales (Plan Empresarial): el dueño lleva la lista entera
      // en el claim `businessIds`, además del `businessId` suelto que apunta a la
      // principal. Para una cuenta de una sola barbería la lista es esa misma
      // barbería, así que el resto del código no tiene que preguntar si es un
      // grupo o no: siempre hay una lista.
      //
      // Un barbero NUNCA la lleva: su claim nombra una sola sucursal.
      businessIds: platformOwner || moderator
        ? []
        : Array.isArray(claims.businessIds) && claims.businessIds.length > 0
          ? claims.businessIds
          : (claims.businessId ? [claims.businessId] : []),
      grupoId: platformOwner || moderator ? null : (claims.grupoId || null),
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
    // Recoger el resultado de una vuelta por redirección.
    //
    // La app inicia sesión con `signInWithPopup`, pero en el navegador de
    // adentro de otra app (Instagram, WhatsApp) las ventanas emergentes están
    // bloqueadas y Firebase cae SOLO a redirigir. Hasta ahora nadie llamaba a
    // esto, así que de ese camino no se recogía ni el usuario ni el error: la
    // persona volvía a la pantalla de login como si no hubiera pasado nada.
    //
    // `onAuthStateChanged` igual termina viendo al usuario, así que esto no
    // reemplaza nada: sirve para que el ERROR del camino de redirección llegue
    // a la consola en vez de perderse.
    getRedirectResult(auth).catch((err) => {
      console.error('[auth] Falló la vuelta de la redirección de Google:', err?.code || err);
    });

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
        //
        // Cada intento con su reloj: con la red colgada (no caída) la lectura
        // del token no falla, se queda esperando, y toda la app espera con ella
        // en "Cargando…" — la pantalla en blanco que se arreglaba cerrando.
        let claims = null;
        for (let intento = 0; intento < 3; intento++) {
          try {
            ({ claims } = await conReloj(getIdTokenResult(fbUser), 8000));
            break;
          } catch (err) {
            if (intento === 2) throw err;
            await new Promise((r) => setTimeout(r, 1500 * (intento + 1)));
          }
        }

        dispatch({ type: 'LOGIN', payload: buildUser(fbUser, claims) });

        // Red de seguridad: si el reclamo del login se cortó a mitad (se cerró
        // la pestaña, falló la red), sin esto la persona queda como cliente
        // para siempre y solo se arregla cerrando y abriendo sesión.
        //
        // Va DESPUÉS de dejar entrar, no antes: es una Cloud Function, y casi
        // todos los que llegan acá son clientes que vienen a reservar y no
        // tienen nada pendiente. Antes la app entera esperaba esa llamada (con
        // la function fría, varios segundos de pantalla en blanco) para nada.
        if (!claims.platform && !claims.businessId && tocaReintentar(fbUser.uid)) {
          const nuevos = await reclamarPendientes(fbUser, claims);
          if (nuevos !== claims) dispatch({ type: 'LOGIN', payload: buildUser(fbUser, nuevos) });
        }
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
      // Las tres formas en que Firebase dice "esa combinación no entra". Cuál
      // llega depende de si está prendida la protección de enumeración
      // (`invalid-credential` con ella, `wrong-password` / `user-not-found`
      // sin ella), así que las tres tienen que estar: con `wrong-password`
      // afuera de esta lista, el mensaje caía en el genérico "No se pudo
      // iniciar sesión", que no le dice nada a nadie.
      //
      // Y las tres llevan la misma coletilla, por el caso que de verdad pasa:
      // la cuenta del dueño es SOLO de Google (la mayoría lo son) y él prueba
      // acá porque le dijimos "entrá a tu panel". Firebase no deja distinguir
      // "contraseña mal" de "esta cuenta no tiene contraseña" —con la
      // protección de enumeración prendida, a propósito—, así que la salida se
      // nombra en el mensaje en vez de mandarlo a buscar una contraseña que
      // nunca existió.
      const noEntra = 'El mail o la contraseña no coinciden. Si abriste tu cuenta con Google, entrá con el botón de arriba; si no tenés cuenta, tocá "Crear cuenta".';
      const mensajes = {
        'auth/invalid-credential': noEntra,
        'auth/wrong-password': noEntra,
        'auth/user-not-found': noEntra,
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
      // El código va en el genérico a propósito: "no se pudo" sin más no le
      // sirve a nadie para diagnosticar desde una captura. Es lo mismo que ya
      // hace el login con Google.
      return { success: false, error: mensajes[error.code] || `No se pudo iniciar sesión (${error.code || 'error desconocido'}).` };
    }
  };

  /**
   * Cuenta de CLIENTE con mail y contraseña, sin Google.
   *
   * Existe por el cliente que no puede entrar con Google: el iPhone donde la
   * ventana de Google no abre o vuelve a cualquier lado, el navegador de
   * Instagram donde Google directamente se niega, o el que no quiere usar su
   * Gmail. Esto no abre ventanas ni redirige: funciona en cualquier navegador.
   *
   * No da ningún permiso: sin claims, es un cliente. Lo que pide un mail
   * VERIFICADO (reclamar un permiso pendiente, atar una membresía cargada a
   * mano) sigue pidiéndolo en el servidor, así que se manda el mail de
   * verificación y mientras tanto reserva igual que cualquiera.
   */
  const registerWithPassword = async (email, password, nombre = '') => {
    try {
      const { user: fbUser } = await createUserWithEmailAndPassword(auth, email.trim(), password);
      if (nombre.trim()) {
        try { await updateProfile(fbUser, { displayName: nombre.trim().slice(0, 60) }); } catch { /* el nombre se pide igual al reservar */ }
      }
      sendEmailVerification(fbUser).catch((err) => console.error('[auth] No se pudo mandar la verificación:', err?.code));
      const user = buildUser(fbUser, {});
      dispatch({ type: 'LOGIN', payload: user });
      return { success: true, user };
    } catch (error) {
      console.error('[auth] Error al crear la cuenta:', error);
      const mensajes = {
        'auth/email-already-in-use': 'Ya hay una cuenta con ese mail. Tocá "Ya tengo cuenta" para entrar (o "Me olvidé la contraseña").',
        'auth/invalid-email': 'Ese mail no parece válido.',
        'auth/weak-password': 'La contraseña es muy corta: usá al menos 8 caracteres.',
        'auth/password-does-not-meet-requirements': 'La contraseña necesita al menos 8 caracteres, con una mayúscula y un número.',
        'auth/network-request-failed': 'Falló la conexión. Revisá tu internet.',
        'auth/too-many-requests': 'Demasiados intentos. Esperá unos minutos.',
        'auth/operation-not-allowed': 'El ingreso con mail todavía no está disponible. Probá con Google, o escribinos.',
        'auth/admin-restricted-operation': 'Ahora no se pueden crear cuentas nuevas. Escribinos y lo resolvemos en el momento.',
      };
      return { success: false, error: mensajes[error.code] || `No se pudo crear la cuenta (${error.code || 'error desconocido'}).` };
    }
  };

  /** Manda el mail para elegir una contraseña nueva. */
  const resetPassword = async (email) => {
    try {
      await sendPasswordResetEmail(auth, email.trim());
      return { success: true };
    } catch (error) {
      // Con la protección de enumeración prendida, un mail que no existe NO da
      // error (a propósito: si no, esto diría qué mails tienen cuenta).
      const mensajes = {
        'auth/invalid-email': 'Ese mail no parece válido.',
        'auth/missing-email': 'Escribí tu mail arriba.',
        'auth/network-request-failed': 'Falló la conexión. Revisá tu internet.',
        'auth/too-many-requests': 'Demasiados intentos. Esperá unos minutos.',
      };
      return { success: false, error: mensajes[error.code] || `No se pudo mandar el mail (${error.code || 'error desconocido'}).` };
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
      value={{ ...state, loginWithGoogle, loginWithPassword, registerWithPassword, resetPassword, loginBypass, logout, refreshClaims, dispatch }}
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
