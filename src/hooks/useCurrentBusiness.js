import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useBusiness } from '../contexts/BusinessContext';
import { useAuth } from '../contexts/AuthContext';
import { isPlatformOwner } from '../config/platform';

/**
 * Resuelve cuál es el negocio (tenant) activo para el usuario actual.
 *
 * Orden de resolución:
 *   1. Dueño de plataforma → el negocio que esté "impersonando" (currentBusinessId),
 *      o el slug de la URL, o el primero de la lista.
 *   2. Admin / owner de un negocio → SIEMPRE su propio businessId.
 *      El slug de la URL se ignora a propósito: un admin no puede espiar otro
 *      tenant cambiando la URL a mano.
 *   3. Cliente (o visitante) → el slug de la URL.
 *
 * Devuelve { business, businessId, slug, isPlatformOwner, resolved }.
 * `resolved` es false cuando no se pudo determinar ningún negocio (ej: cliente
 * que entró a "/" sin link de barbería).
 */
export function useResolvedBusiness() {
  const { state } = useBusiness();
  const { businessSlug } = useParams();
  const { user } = useAuth();

  const businesses = state.businesses || [];
  const platformOwner = isPlatformOwner(user?.email);

  // Sin useMemo a propósito: la lista de negocios es chica y el resultado se
  // consume por `businessId` (string estable), así que recalcular por render
  // no propaga renders de más aguas abajo.
  const bySlug = businessSlug
    ? businesses.find((b) => b.slug === businessSlug)
    : null;

  let business;
  if (platformOwner) {
    business =
      businesses.find((b) => b.id === state.currentBusinessId) ||
      bySlug ||
      businesses[0] ||
      null;
  } else if (user?.businessId) {
    business = businesses.find((b) => b.id === user.businessId) || null;
  } else {
    business = bySlug || null;
  }

  return {
    business,
    businessId: business?.id || null,
    slug: business?.slug || businessSlug || null,
    isPlatformOwner: platformOwner,
    resolved: Boolean(business),
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
