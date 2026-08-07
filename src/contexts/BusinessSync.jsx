import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useBusiness } from './BusinessContext';
import { useAuth } from './AuthContext';
import {
  subscribeAllBusinesses,
  subscribeBusiness,
  subscribeBilling,
  getBusinessIdBySlug,
} from '../lib/repository';

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
  const { dispatch } = useBusiness();
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

  return null;
}
