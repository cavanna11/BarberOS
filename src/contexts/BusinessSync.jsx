import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { reconectarFirestore } from '../lib/firebase';
import { slugify } from '../utils/slug';
import { useBusiness } from './BusinessContext';
import { useAuth } from './AuthContext';
import {
  subscribeAllBusinesses,
  subscribeBusiness,
  subscribeBusinesses,
  subscribeBilling,
  subscribeSubcollection,
  subscribeAppointmentsDeProfesional,
  subscribeMyAppointments,
  subscribeNotifications,
  subscribePlatformNotifications,
  subscribeCobros,
  obtenerSlug,
} from '../lib/repository';

// Subcolecciones del negocio que la app mantiene en vivo.
const COLECCIONES = [
  'professionals',
  'services',
  'schedules',
  'professionalServices',
  // El dia suelto que un barbero no va. Publica: la grilla del cliente la
  // necesita antes de que haya sesion.
  'ausencias',
  'appointments',
  'admins',
];

// Lo que puede leer cualquiera sin estar logueado: lo que la página de reservas
// necesita para armar la grilla.
const PUBLICAS = ['professionals', 'services', 'schedules', 'professionalServices', 'ausencias'];

// `listas` dice qué colecciones ya contestaron. Sin eso, "todavía no llegó" y
// "no hay" se ven iguales (un array vacío), y la reserva le decía al cliente
// "Todavía no hay turnos disponibles" mientras los barberos venían en camino.
const VACIO = { ...Object.fromEntries(COLECCIONES.map((c) => [c, []])), notifications: [], listas: {} };

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
const RUTAS_RESERVADAS = new Set(['login', 'admin', 'super-admin', 'cuenta', '']);

/**
 * El link como lo escribió la barbería. Instagram y los teclados del celular
 * lo cambian sin preguntar: "/NeytanBarber777", "/franlook-olivos." al final de
 * una oración, un espacio pegado. Los ids de Firestore distinguen mayúsculas,
 * así que cualquiera de esos era "No encontramos este negocio" en un link que
 * existe. Los slugs se crean con `slugify`, así que pasarlos por lo mismo es
 * volver al original.
 */
function slugDeLaUrl(segmento) {
  let crudo = segmento;
  try { crudo = decodeURIComponent(segmento); } catch { /* queda como vino */ }
  return slugify(crudo);
}

export default function BusinessSync() {
  const { state, dispatch } = useBusiness();
  const { user, loading } = useAuth();
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();

  const primerSegmento = pathname.split('/')[1] || '';
  const slugNormal = RUTAS_RESERVADAS.has(primerSegmento) ? null : slugDeLaUrl(primerSegmento);
  // Mientras la URL no esté en su forma normal no se resuelve nada: el efecto de
  // abajo la corrige y recién ahí se busca.
  const slug = slugNormal && slugNormal === primerSegmento ? slugNormal : null;

  useEffect(() => {
    if (!slugNormal || slugNormal === primerSegmento) return;
    const resto = pathname.split('/').slice(2).join('/');
    navigate(`/${slugNormal}${resto ? `/${resto}` : ''}${search}${hash}`, { replace: true });
  }, [slugNormal, primerSegmento, pathname, search, hash, navigate]);

  // Cada vez que cambia, se vuelve a intentar resolver el link. Lo sube un
  // reloj cuando la pantalla quedó en "no pudimos cargar": el cliente no tiene
  // que tocar nada para que se arregle solo cuando vuelve la señal.
  const [vuelta, setVuelta] = useState(0);
  const slugEstadoActual = state.slugEstado?.slug;

  const esPlataforma = user?.isPlatformTeam === true;
  const businessIdPropio = user?.businessId || null;
  // Como string y no como array: el array cambia de identidad en cada LOGIN
  // aunque tenga los mismos ids, y eso volvería a suscribir todo. Mismo criterio
  // que con `uid`, `rol` y `profId` más abajo.
  const idsPropios = (user?.businessIds || []).join(',');

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

      // La campanita del panel global.
      const desuscribirNotifs = subscribePlatformNotifications(
        (filas) => dispatch({ type: 'SET_TENANT_DATA', payload: { platformNotifications: filas } }),
        onError
      );

      // Los cobros registrados: de ahí sale "cuánto facturó la plataforma este
      // mes" y el historial por mes. Son pocos documentos (uno por pago).
      const desuscribirCobros = subscribeCobros(
        (filas) => dispatch({ type: 'SET_TENANT_DATA', payload: { cobros: filas } }),
        onError
      );

      const desuscribirLista = subscribeAllBusinesses((lista) => {
        negocios = lista;
        // Para que la página pública no diga "no existe" mientras la lista
        // todavía no llegó.
        dispatch({ type: 'SET_TENANT_DATA', payload: { negociosCargados: true } });

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
        desuscribirNotifs();
        desuscribirCobros();
        desuscribirLista();
        for (const off of subsBilling.values()) off();
      };
    }

    // 2. Staff de un negocio, en su panel: solo el suyo. Si está parado en el
    //    link público de OTRA barbería (/:slug), va por el camino 3 como
    //    cualquier visitante: la página pública muestra lo que dice la URL.
    //
    //    Una cuenta con sucursales escucha las suyas, que son las que dice su
    //    claim `businessIds` (hasta cuatro). El barbero nunca lleva esa lista,
    //    así que para él esto es exactamente lo de antes: un solo negocio.
    if (businessIdPropio && !slug) {
      const ids = idsPropios ? idsPropios.split(',') : [businessIdPropio];

      if (ids.length === 1) {
        return subscribeBusiness(
          ids[0],
          (negocio) => dispatch({ type: 'SET_BUSINESSES', payload: negocio ? [negocio] : [] }),
          onError
        );
      }

      return subscribeBusinesses(
        ids,
        (lista) => dispatch({ type: 'SET_BUSINESSES', payload: lista }),
        onError
      );
    }

    // 3. Cliente entrando por el link público: resolver slug → id → escuchar.
    if (slug) {
      let cancelado = false;
      let desuscribir = null;
      // Si el documento del negocio llegó alguna vez, y el reloj que vigila que
      // llegue.
      let llego = false;
      let temporizador = null;
      let otraVuelta = null;

      // "No pudimos cargar" no es un final: a los 5 segundos se vuelve a
      // probar solo, y así hasta que ande. Es lo que el cliente hacía a mano
      // cerrando y abriendo la app.
      const sinConexion = () => {
        dispatch({ type: 'SET_TENANT_DATA', payload: { slugEstado: { slug, estado: 'sin-conexion' } } });
        clearTimeout(otraVuelta);
        // Canal nuevo antes de volver a preguntar: reintentar sobre el que se
        // colgó es esperar a que el SDK se dé cuenta solo, y eso tarda.
        otraVuelta = setTimeout(async () => {
          if (cancelado) return;
          await reconectarFirestore('reintento automático del link');
          if (!cancelado) setVuelta((v) => v + 1);
        }, 4000);
      };

      // Mientras se resuelve, la página pública muestra "cargando" y no "no
      // existe": ese destello de error en cada apertura del link era lo
      // primero que veía el cliente. En los reintentos automáticos no: la
      // pantalla quedaría saltando entre "cargando" y "no pudimos".
      if (vuelta === 0 || slugEstadoActual !== slug) {
        dispatch({ type: 'SET_TENANT_DATA', payload: { slugEstado: { slug, estado: 'resolviendo' } } });
      }

      (async () => {
        try {
          // Se reintenta antes de decir nada. Una sola lectura fallida no puede
          // ser la diferencia entre "tu barberia" y "no encontramos este
          // negocio": adentro del navegador de Instagram, con 4G, la primera
          // lectura falla seguido.
          //
          // Después del primer fallo se reconecta Firestore: si el SDK quedó
          // "offline" (canal muerto, celular que volvió de estar bloqueado),
          // `getDocFromServer` falla en el acto en cada intento, y reintentar
          // sin reconectar es preguntarle tres veces a alguien que no oye.
          const leerSlug = async () => {
            let ultimo = null;
            for (let intento = 0; intento < 3; intento++) {
              if (cancelado) return null;
              const r = await obtenerSlug(slug);
              if (r.confiable) return r;
              ultimo = r;
              if (intento === 0) await reconectarFirestore('no se pudo leer el link');
              await new Promise((res) => setTimeout(res, 700 * (intento + 1)));
            }
            return ultimo;
          };

          const cache = slugResuelto.current;
          // El cache guarda SOLO resultados buenos. Antes guardaba tambien el
          // null de una lectura fallida, y entonces el error se volvia
          // permanente: el resto de la visita seguia contestando "no existe"
          // desde la memoria, sin volver a preguntar nunca. Por eso cerrar y
          // abrir la pagina no siempre lo arreglaba.
          const r = cache.slug === slug && cache.datos
            ? { datos: cache.datos, confiable: true }
            : await leerSlug();

          if (cancelado || !r) return;

          // No se pudo averiguar. NO es "no existe": se dice lo que pasa y se
          // ofrece reintentar.
          if (!r.confiable) {
            console.error('[BusinessSync] no se pudo resolver el slug', slug, r.error?.code);
            sinConexion();
            return;
          }

          const datos = r.datos;
          const businessId = datos?.businessId || null;
          if (datos) slugResuelto.current = { slug, businessId, datos };
          // El link de la CUENTA (no de una sucursal): no hay una barbería que
          // escuchar, la pantalla pregunta a qué sucursal va.
          if (datos?.esCuenta && datos.grupoId) {
            dispatch({ type: 'SET_TENANT_DATA', payload: { slugEstado: { slug, estado: 'cuenta', grupoId: datos.grupoId } } });
            dispatch({ type: 'SET_BUSINESSES', payload: [] });
            return;
          }
          if (!businessId) {
            dispatch({ type: 'SET_TENANT_DATA', payload: { slugEstado: { slug, estado: 'no-existe' } } });
            dispatch({ type: 'SET_BUSINESSES', payload: [] });
            return;
          }
          dispatch({ type: 'SET_TENANT_DATA', payload: { slugEstado: { slug, estado: 'ok', businessId } } });

          // El slug resolvió, pero el documento del negocio todavía no llegó.
          // Si no llega nunca —el listener muere y no vuelve— la pantalla se
          // quedaría cargando para siempre. A los 12 segundos se dice que no se
          // pudo, con el botón para reintentar.
          //
          // El listener sigue vivo y reconectándose (`escuchar`): si el negocio
          // llega después, la pantalla vuelve sola (ver abajo).
          const seColgo = setTimeout(() => {
            if (!cancelado && !llego) {
              dispatch({ type: 'SET_TENANT_DATA', payload: { slugEstado: { slug, estado: 'sin-conexion' } } });
            }
          }, 12000);
          temporizador = seColgo;

          desuscribir = subscribeBusiness(
            businessId,
            (negocio) => {
              llego = true;
              clearTimeout(seColgo);
              clearTimeout(otraVuelta);
              // Si el negocio se borró con el link abierto, que diga que no
              // existe. Y si llegó después de que la pantalla dijera "no
              // pudimos cargar", se saca ese cartel: antes quedaba puesto con
              // los datos ya en la mano.
              dispatch({ type: 'SET_TENANT_DATA', payload: { slugEstado: { slug, estado: negocio ? 'ok' : 'no-existe', businessId } } });
              dispatch({ type: 'SET_BUSINESSES', payload: negocio ? [negocio] : [] });
            },
            (err) => {
              clearTimeout(seColgo);
              onError(err);
              // El listener murió y `escuchar()` ya reintenta solo. Si todavía
              // no habíamos mostrado nada, igual hay que decir algo: una
              // pantalla cargando sin fin es peor que un error con un botón.
              if (!llego && !cancelado) {
                dispatch({ type: 'SET_TENANT_DATA', payload: { slugEstado: { slug, estado: 'sin-conexion' } } });
              }
            }
          );
        } catch (err) {
          // Un catch que solo loguea dejaba la pantalla en "Cargando…" para
          // siempre. Lo que no se pudo hacer se dice.
          onError(err);
          if (!cancelado) sinConexion();
        }
      })();

      return () => {
        cancelado = true;
        clearTimeout(otraVuelta);
        if (temporizador) clearTimeout(temporizador);
        if (desuscribir) desuscribir();
      };
    }

    // Link a medio corregir (ver slugDeLaUrl): en un instante vuelve con el slug.
    if (slugNormal) return;

    // 4. Nadie logueado y sin slug: no hay nada que mostrar.
    dispatch({ type: 'SET_BUSINESSES', payload: [] });
    // `slugEstadoActual` se lee pero no dispara: cambia adentro de este mismo
    // efecto y volvería a correrlo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, esPlataforma, businessIdPropio, idsPropios, slug, slugNormal, vuelta, user?.isBypass, dispatch]);

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
    // El cajero ve la agenda ENTERA del local: es su trabajo. Lo que no ve
    // son los números del negocio, y eso no se decide acá sino en qué
    // pantallas puede abrir y, sobre todo, en las Rules.
    const esStaffCompleto = esPlataforma || rol === 'owner' || rol === 'cajero';
    // Ojo con la condición: antes era `rol === 'admin' && Boolean(profId)`, y
    // un barbero sin perfil vinculado caía en `esCliente`. Se le pedían SUS
    // turnos como cliente (ninguno) y el panel quedaba vacío sin un error:
    // los clientes reservaban, se presentaban, y la barbería no se enteraba.
    // Un admin es staff aunque el vínculo esté roto; lo que falta se avisa en
    // pantalla (useVinculoBarbero), no se disfraza de agenda vacía.
    const esBarbero = rol === 'admin';
    const esCliente = Boolean(uid) && !esStaffCompleto && !esBarbero;

    // `escuchar()` ya descarta los vacíos que vienen del caché, así que cada
    // llamada acá es una respuesta de verdad: la colección queda lista.
    const cb = (col) => (filas) => dispatch({ type: 'SET_COLECCION', col, filas });

    const colecciones = esStaffCompleto ? COLECCIONES
      : esBarbero ? COLECCIONES.filter((c) => c !== 'appointments')
      : PUBLICAS;

    const offs = colecciones.map((col) =>
      subscribeSubcollection(businessId, col, cb(col), onError(col))
    );

    // La campanita: el dueño ve todas las del negocio, el barbero las suyas.
    if (esStaffCompleto) {
      offs.push(subscribeNotifications(businessId, {}, cb('notifications'), onError('notifications')));
    } else if (esBarbero && profId) {
      offs.push(subscribeNotifications(businessId, { professionalId: profId }, cb('notifications'), onError('notifications')));
    }

    // Sin profId no hay consulta posible (las Rules la rechazan, y `undefined`
    // en un where revienta): no se pide, y la pantalla explica por qué.
    if (esBarbero && profId) {
      offs.push(subscribeAppointmentsDeProfesional(businessId, profId, cb('appointments'), onError('appointments')));
    } else if (esCliente) {
      offs.push(subscribeMyAppointments(businessId, uid, cb('appointments'), onError('appointments')));
    }

    // Al cambiar de negocio, vaciar antes de que lleguen los datos nuevos:
    // así no se ve por un instante el staff del tenant anterior.
    dispatch({ type: 'SET_TENANT_DATA', payload: VACIO });

    // Sin consulta de agenda posible (anónimo, o barbero sin perfil vinculado)
    // no hay nada que esperar: la agenda vacía ES la respuesta, y lo que falta
    // lo explica la pantalla (useVinculoBarbero).
    const pideAgenda = esStaffCompleto || (esBarbero && profId) || esCliente;
    if (!pideAgenda) dispatch({ type: 'SET_COLECCION', col: 'appointments', filas: [] });

    return () => offs.forEach((off) => off());
  }, [businessId, esBypass, uid, rol, profId, esPlataforma, dispatch]);

  return null;
}
