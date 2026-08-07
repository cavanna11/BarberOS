import { useMemo } from 'react';
import { useBusiness } from '../contexts/BusinessContext';
import { useCurrentBusiness, useResolvedBusiness } from './useCurrentBusiness';

// ============================================================================
// Capa de acceso a datos por tenant.
//
// Ningún componente debe leer `state.professionals` / `state.services` / etc.
// directamente: siempre a través de estos hooks, que filtran por el negocio
// activo. Cuando migremos a Firestore, el cambio queda contenido acá adentro
// (cada hook pasa a ser una suscripción con where('businessId','==',id)) y los
// componentes no se tocan.
// ============================================================================

/** Profesionales del negocio activo. */
export function useProfessionals() {
  const { state } = useBusiness();
  const { businessId } = useResolvedBusiness();
  return useMemo(() => {
    if (!businessId) return [];
    return (state.professionals || []).filter((p) => p.businessId === businessId);
  }, [state.professionals, businessId]);
}

/** Servicios del negocio activo. */
export function useServices() {
  const { state } = useBusiness();
  const { businessId } = useResolvedBusiness();
  return useMemo(() => {
    if (!businessId) return [];
    return (state.services || []).filter((s) => s.businessId === businessId);
  }, [state.services, businessId]);
}

/** Citas del negocio activo. */
export function useAppointments() {
  const { state } = useBusiness();
  const { businessId } = useResolvedBusiness();
  return useMemo(() => {
    if (!businessId) return [];
    return (state.appointments || []).filter((a) => a.businessId === businessId);
  }, [state.appointments, businessId]);
}

/**
 * Horarios del negocio activo.
 * `schedules` no lleva businessId propio: pertenece al tenant a través del
 * profesional, así que filtramos de forma transitiva.
 */
export function useSchedules() {
  const { state } = useBusiness();
  const professionals = useProfessionals();
  return useMemo(() => {
    const ids = new Set(professionals.map((p) => p.id));
    return (state.schedules || []).filter((s) => ids.has(s.professionalId));
  }, [state.schedules, professionals]);
}

/** Relación profesional↔servicio del negocio activo (filtrada transitivamente). */
export function useProfessionalServices() {
  const { state } = useBusiness();
  const professionals = useProfessionals();
  return useMemo(() => {
    const ids = new Set(professionals.map((p) => p.id));
    return (state.professionalServices || []).filter((ps) => ids.has(ps.professionalId));
  }, [state.professionalServices, professionals]);
}

/** Admins autorizados del negocio activo. */
export function useAuthorizedAdmins() {
  const { state } = useBusiness();
  const { businessId } = useResolvedBusiness();
  return useMemo(() => {
    if (!businessId) return [];
    return (state.authorizedAdmins || []).filter((a) => a.businessId === businessId);
  }, [state.authorizedAdmins, businessId]);
}

/**
 * Agregado de conveniencia: devuelve la misma forma que antes exponía `state`,
 * pero ya filtrado por tenant. Permite migrar los componentes existentes
 * cambiando una sola línea:
 *
 *   const { professionals, services } = state;   // ❌ ve todos los negocios
 *   const { professionals, services } = useTenant();  // ✅ solo el activo
 */
export function useTenant() {
  const { business, businessId, slug, isPlatformOwner, resolved } = useCurrentBusiness();
  const professionals = useProfessionals();
  const services = useServices();
  const appointments = useAppointments();
  const schedules = useSchedules();
  const professionalServices = useProfessionalServices();
  const authorizedAdmins = useAuthorizedAdmins();

  return {
    business,
    businessId,
    slug,
    isPlatformOwner,
    resolved,
    professionals,
    services,
    appointments,
    schedules,
    professionalServices,
    authorizedAdmins,
  };
}
