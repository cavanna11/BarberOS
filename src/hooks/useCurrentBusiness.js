import { useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useBusiness } from '../contexts/BusinessContext';
import { useAuth } from '../contexts/AuthContext';
import { isPlatformOwner } from '../config/platform';

/**
 * Resuelve cuál es el negocio (tenant) activo para el usuario actual.
 *
 * Orden de resolución:
 *   0. Hay un slug en la URL (/:businessSlug, la página pública de reserva)
 *      → ESE negocio, sea quien sea el que mira. Antes el slug perdía contra
 *      el negocio "administrado" del dueño de plataforma y contra el negocio
 *      propio del staff: el link barberos.sacia.tech/volcadoclub, abierto por
 *      la plataforma con otra barbería activa en el panel, mostraba la otra
 *      barbería. Para el cliente del link eso es "me mandaron a otro lado".
 *      (No es espiar: la página pública es pública, y las Rules siguen
 *      decidiendo qué se puede leer.)
 *   1. Dueño de plataforma → el negocio que esté "impersonando" (currentBusinessId),
 *      o el primero de la lista.
 *   2. Dueño de una cuenta con SUCURSALES → la sucursal que tenga elegida
 *      (currentBusinessId), si es una de las suyas; si no, la principal. Es el
 *      mismo mecanismo que usa la plataforma para administrar una barbería, que
 *      ya estaba construido y probado: "elegí uno de los negocios que podés ver
 *      y operá sobre ese".
 *   3. Admin / owner de un negocio → su propio businessId.
 *   4. Nadie → null.
 *
 * Devuelve { business, businessId, slug, isPlatformOwner, resolved }.
 * `resolved` es false cuando no se pudo determinar ningún negocio (ej: cliente
 * que entró a "/" sin link de barbería).
 */
// Constante de módulo y no `|| []` adentro del hook: un array nuevo en cada
// render invalidaría el useMemo de abajo siempre, que es justo lo que ese useMemo
// viene a evitar.
const SIN_NEGOCIOS = [];

export function useResolvedBusiness() {
  const { state } = useBusiness();
  const { businessSlug } = useParams();
  const { user } = useAuth();

  const businesses = state.businesses || SIN_NEGOCIOS;
  // Por el claim (dueño o moderador); la lista de mails queda de respaldo.
  const platformOwner = user?.isPlatformTeam === true || isPlatformOwner(user?.email);

  // Sin useMemo a propósito: la lista de negocios es chica y el resultado se
  // consume por `businessId` (string estable), así que recalcular por render
  // no propaga renders de más aguas abajo.
  const bySlug = businessSlug
    ? businesses.find((b) => b.slug === businessSlug)
    : null;

  // Las barberías de esta cuenta. Para una cuenta común es una sola; para una
  // cuenta con sucursales, hasta cuatro.
  //
  // Con useMemo, y acá sí hace falta: esto se devuelve como array y `useTenant`
  // lo mete en su lista de dependencias. Un array nuevo en cada render haría
  // que useTenant() devuelva un objeto nuevo siempre, y con eso se vuelve a
  // renderizar medio panel por nada. La clave es un string (los ids pegados),
  // que sí es estable.
  const idsPropios = (user?.businessIds || []).join(',');
  const propias = useMemo(
    () => (idsPropios ? businesses.filter((b) => idsPropios.split(',').includes(b.id)) : []),
    [businesses, idsPropios]
  );

  let business;
  if (businessSlug) {
    business = bySlug || null;
  } else if (platformOwner) {
    business =
      businesses.find((b) => b.id === state.currentBusinessId) ||
      businesses[0] ||
      null;
  } else if (propias.length > 1) {
    // Cuenta con sucursales: manda la que eligió en el selector. Se verifica
    // contra SUS negocios y no contra la lista entera: `currentBusinessId` es
    // estado de UI y no un permiso.
    business =
      propias.find((b) => b.id === state.currentBusinessId) ||
      propias.find((b) => b.id === user.businessId) ||
      propias[0];
  } else if (user?.businessId) {
    business = businesses.find((b) => b.id === user.businessId) || null;
  } else {
    business = null;
  }

  return {
    business,
    businessId: business?.id || null,
    slug: business?.slug || businessSlug || null,
    isPlatformOwner: platformOwner,
    resolved: Boolean(business),
    /** Las barberías de esta cuenta (1 si no es una cuenta con sucursales). */
    sucursales: propias,
    /** ¿Esta cuenta administra más de una barbería? */
    esMultiSucursal: propias.length > 1,
  };
}

/**
 * Igual que useResolvedBusiness, pero además sincroniza el negocio activo del
 * contexto con el resuelto acá, para que los dispatch de escritura
 * (UPDATE_BUSINESS, etc.) apunten al tenant correcto.
 *
 * Es el que usan los componentes. Los hooks de lectura de `useTenantData` usan
 * la variante pura para no disparar N veces el mismo dispatch en un solo commit.
 */
export function useCurrentBusiness() {
  const { state, dispatch } = useBusiness();
  const resolved = useResolvedBusiness();

  useEffect(() => {
    if (resolved.businessId && resolved.businessId !== state.currentBusinessId) {
      dispatch({ type: 'SET_CURRENT_BUSINESS', payload: resolved.businessId });
    }
  }, [resolved.businessId, state.currentBusinessId, dispatch]);

  return resolved;
}
