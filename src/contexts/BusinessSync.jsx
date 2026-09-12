import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useBusiness } from './BusinessContext';
import { useAuth } from './AuthContext';
import {
  subscribeAllBusinesses,
  subscribeBusiness,
  subscribeBilling,
  subscribeSubcollection,
  subscribeAppointmentsDeProfesional,
  subscribeMyAppointments,
  getBusinessIdBySlug,
} from '../lib/repository';

// Subcolecciones del negocio que la app mantiene en vivo.
const COLECCIONES = [
  'professionals',
  'services',
  'schedules',
  'professionalServices',
  'appointments',
  'admins',
];

// Lo que puede leer cualquiera sin estar logueado: lo que la página de reservas
// necesita para armar la grilla.
const PUBLICAS = ['professionals', 'services', 'schedules', 'professionalServices'];

const VACIO = Object.fromEntries(COLECCIONES.map((c) => [c, []]));

/**
 * Puente entre Firestore y el estado de negocios de la app.
 *
 * Vive acá y no dentro de BusinessProvider porque necesita saber quién está
 * logueado, y BusinessProvider es el padre de AuthProvider (no puede usar
 * useAuth). Se renderiza adentro del router, sin pintar nada.
 *
 * A qué se suscribe, según quién mira:
 *   - dueño de plataforma → a todos los negocios (las Rules solo lo permiten a él)
 *   - staff de un negocio → solo al suyo
 *   - cliente en /:slug    → resuelve el slug y escucha ese negocio
 */

// Primeros segmentos de URL que son rutas de la app, no slugs de negocio.
const RUTAS_RESERVADAS = new Set(['login', 'admin', 'super-admin', '']);

export default function BusinessSync() {
  const { state, dispatch } = useBusiness();
  const { user, loading } = useAuth();
  const { pathname } = useLocation();

  const primerSegmento = pathname.split('/')[1] || '';
  const slug = RUTAS_RESERVADAS.has(primerSegmento) ? null : primerSegmento;

  const esPlataforma = user?.isPlatformOwner === true;
  const businessIdPropio = user?.businessId || null;

  // Evita re-suscribirse en loop cuando el slug resuelve al mismo negocio.
  const slugResuelto = useRef({ slug: null, businessId: null });

  useEffect(() => {
    // Mientras Firebase restaura la sesión no sabemos qué suscribir.
    if (loading) return;

    // La sesión de desarrollo no es de Firebase: no tiene token, así que las
    // Rules rechazan todo. Antes esto aparecía como un permission-denied
    // críptico; mejor decir qué pasa.
    if (user?.isBypass) {
      console.warn(
        '[BusinessSync] Sesión de desarrollo activa: Firestore va a rechazar todo. ' +
        'Los datos ya viven en Firestore — entrá con "Continuar con Google".'
      );
      dispatch({ type: 'SET_BUSINESSES', payload: [] });
      return;
    }

    const onError = (err) => {
      console.error('[BusinessSync] Firestore rechazó la lectura:', err.code, err.message);
    };

    // 1. Dueño de plataforma: la cartera completa, con la facturación de cada
    //    uno. El panel global muestra deuda y abono, pero eso vive en la
    //    subcolección privada /businesses/{id}/private/billing — fuera del
    //    documento público, que puede leer cualquier cliente.
    if (esPlataforma) {
      let negocios = [];
      const facturacion = new Map();
      const subsBilling = new Map();

      const emitir = () => {
        dispatch({
          type: 'SET_BUSINESSES',
          payload: negocios.map((n) => ({ ...n, ...(facturacion.get(n.id) || {}) })),
        });
      };

      const desuscribirLista = subscribeAllBusinesses((lista) => {
        negocios = lista;

        // Alta: escuchar la facturación de los negocios nuevos.
        for (const n of lista) {
          if (subsBilling.has(n.id)) continue;
          subsBilling.set(
            n.id,
            subscribeBilling(
              n.id,
              (datos) => {
                facturacion.set(n.id, datos || {});
                emitir();
              },
              onError
            )
          );
        }

        // Baja: soltar los que ya no están.
        const vigentes = new Set(lista.map((n) => n.id));
        for (const [id, off] of subsBilling) {
          if (!vigentes.has(id)) {
            off();
            subsBilling.delete(id);
            facturacion.delete(id);
          }
        }

        emitir();
      }, onError);

      return () => {
        desuscribirLista();
        for (const off of subsBilling.values()) off();
      };
    }

    // 2. Staff de un negocio: solo el suyo.
    if (businessIdPropio) {
      return subscribeBusiness(
        businessIdPropio,
        (negocio) => dispatch({ type: 'SET_BUSINESSES', payload: negocio ? [negocio] : [] }),
        onError
      );
    }

    // 3. Cliente entrando por el link público: resolver slug → id → escuchar.
    if (slug) {
      let cancelado = false;
      let desuscribir = null;

      (async () => {
        try {
          const cache = slugResuelto.current;
          const businessId =
            cache.slug === slug ? cache.businessId : await getBusinessIdBySlug(slug);

          slugResuelto.current = { slug, businessId };

          if (cancelado) return;
          if (!businessId) {
            dispatch({ type: 'SET_BUSINESSES', payload: [] });
            return;
          }
          desuscribir = subscribeBusiness(
            businessId,
            (negocio) => dispatch({ type: 'SET_BUSINESSES', payload: negocio ? [negocio] : [] }),
            onError
          );
        } catch (err) {
          onError(err);
        }
      })();

      return () => {
        cancelado = true;
        if (desuscribir) desuscribir();
      };
    }

    // 4. Nadie logueado y sin slug: no hay nada que mostrar.
    dispatch({ type: 'SET_BUSINESSES', payload: [] });
  }, [loading, esPlataforma, businessIdPropio, slug, user?.isBypass, dispatch]);

  // ── Subcolecciones del negocio activo ────────────────────────────────────
  // Se suscriben acá, en un solo lugar, y no dentro de cada hook: si cada
  // llamada a useProfessionals() abriera su propio listener, el mismo documento
  // se cobraría una vez por componente montado.
  const businessId = state.currentBusinessId;

  // Se leen como primitivos y no como `user` entero: el objeto cambia de
  // identidad en cada LOGIN aunque no cambie nada, y eso re-suscribiría todo.
  const uid = user?.id ?? null;
  const rol = user?.role ?? null;
  const profId = user?.professionalId ?? null;
  const esBypass = Boolean(user?.isBypass);

  useEffect(() => {
    if (!businessId || esBypass) {
      dispatch({ type: 'SET_TENANT_DATA', payload: VACIO });
      return;
    }

    const onError = (col) => (err) => {
      console.error(`[BusinessSync] ${col}:`, err.code, err.message);
    };

    // Qué colecciones pedir depende de quién mira. Pedir una que las Rules van
    // a rechazar no es inocuo: la consulta falla, el dato queda vacío y encima
    // ensucia la consola con un permission-denied por cada pantalla.
    //
    //   plataforma / dueño → todo, sin filtrar
    //   barbero            → todo menos la agenda; la suya filtrada por perfil
    //   cliente            → las públicas + SUS turnos filtrados por uid
    //   anónimo            → solo las públicas
    //
    // El caso del cliente es el que estuvo roto: se le pedía la agenda entera,
    // las Rules la rechazaban (bien, es la regla que cierra la filtración de
    // datos), y "Mis citas" quedaba vacío para todos. subscribeMyAppointments
    // existía en el repositorio y nadie la llamaba.
    const esStaffCompleto = esPlataforma || rol === 'owner';
    const esBarbero = rol === 'admin' && Boolean(profId);
    const esCliente = Boolean(uid) && !esStaffCompleto && !esBarbero;

    const cb = (col) => (filas) => dispatch({ type: 'SET_TENANT_DATA', payload: { [col]: filas } });

    const colecciones = esStaffCompleto ? COLECCIONES
      : esBarbero ? COLECCIONES.filter((c) => c !== 'appointments')
      : PUBLICAS;

    const offs = colecciones.map((col) =>
      subscribeSubcollection(businessId, col, cb(col), onError(col))
    );

    if (esBarbero) {
      offs.push(subscribeAppointmentsDeProfesional(businessId, profId, cb('appointments'), onError('appointments')));
    } else if (esCliente) {
      offs.push(subscribeMyAppointments(businessId, uid, cb('appointments'), onError('appointments')));
    }

    // Al cambiar de negocio, vaciar antes de que lleguen los datos nuevos:
    // así no se ve por un instante el staff del tenant anterior.
    dispatch({ type: 'SET_TENANT_DATA', payload: VACIO });

    return () => offs.forEach((off) => off());
  }, [businessId, esBypass, uid, rol, profId, esPlataforma, dispatch]);

  return null;
}
