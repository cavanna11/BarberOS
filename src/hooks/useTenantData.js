import { useMemo } from 'react';
import { useBusiness } from '../contexts/BusinessContext';
import { useCurrentBusiness, useResolvedBusiness } from './useCurrentBusiness';

// ============================================================================
// Datos del negocio activo
// ============================================================================
// Las suscripciones a Firestore viven en un solo lugar (BusinessSync) y dejan
// los datos en el contexto. Estos hooks solo los leen.
//
// El aislamiento entre negocios ya no depende de filtrar acá: los datos llegan
// de /businesses/{id}/… y las Security Rules deciden qué puede leer cada uno.
// Estos hooks son comodidad de UI, no seguridad.
// ============================================================================

/** Profesionales del negocio activo. */
export function useProfessionals() {
  const { state } = useBusiness();
  return state.professionals || [];
}

/** Servicios del negocio activo. */
export function useServices() {
  const { state } = useBusiness();
  return state.services || [];
}

/** Turnos del negocio activo. */
export function useAppointments() {
  const { state } = useBusiness();
  return state.appointments || [];
}

/** Horarios de trabajo del staff. */
export function useSchedules() {
  const { state } = useBusiness();
  return state.schedules || [];
}

/** Relación profesional↔servicio, con precio y duración propios. */
export function useProfessionalServices() {
  const { state } = useBusiness();
  return state.professionalServices || [];
}

/**
 * Admins del negocio activo.
 * Es el registro que muestra la UI: el permiso real son los custom claims.
 */
export function useAuthorizedAdmins() {
  const { state } = useBusiness();
  return state.admins || [];
}

/**
 * Agregado de conveniencia. Devuelve la misma forma que antes exponía `state`,
 * para que los componentes no tengan que cambiar.
 */
export function useTenant() {
  const { business, businessId, slug, isPlatformOwner, resolved } = useCurrentBusiness();
  const professionals = useProfessionals();
  const services = useServices();
  const appointments = useAppointments();
  const schedules = useSchedules();
  const professionalServices = useProfessionalServices();
  const authorizedAdmins = useAuthorizedAdmins();

  return useMemo(
    () => ({
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
    }),
    [
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
    ]
  );
}

// Se re-exporta para los componentes que solo necesitan saber el negocio activo
// sin arrastrar todos sus datos.
export { useResolvedBusiness };
