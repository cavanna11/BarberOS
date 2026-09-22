import { useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useProfessionals } from './useTenantData';

// ============================================================================
// ¿La cuenta del barbero apunta a un perfil que existe?
// ============================================================================
// El permiso del barbero sale del claim `professionalId`, y toda su agenda se
// filtra por ese id: las Rules solo le dejan listar los turnos cuyo
// professionalId coincide. Si el claim está vacío, o apunta a un perfil que se
// borró y se volvió a crear, pasa lo peor que puede pasar en esta app:
//
//   - sin claim  → la consulta la rechazan las Rules;
//   - claim viejo → la consulta ANDA y devuelve CERO turnos.
//
// En los dos casos el panel se veía vacío, sin un solo error, mientras los
// clientes reservaban y se presentaban. Pasó en producción (22/09/2026).
// Por eso esto se calcula en un solo lugar y se muestra donde haya turnos.

export function useVinculoBarbero() {
  const { user } = useAuth();
  const professionals = useProfessionals();

  return useMemo(() => {
    const esBarbero = user?.role === 'admin';
    if (!esBarbero) return { esBarbero: false, vinculado: true, motivo: null, professionalId: null };

    const professionalId = user?.professionalId || null;
    if (!professionalId) {
      return { esBarbero: true, vinculado: false, motivo: 'sin-perfil', professionalId: null };
    }
    // Hasta que carguen los profesionales no se puede afirmar que falte: un
    // aviso en falso durante el primer segundo asusta más de lo que ayuda.
    if (professionals.length === 0) {
      return { esBarbero: true, vinculado: true, motivo: null, professionalId };
    }
    if (!professionals.some((p) => p.id === professionalId)) {
      return { esBarbero: true, vinculado: false, motivo: 'perfil-inexistente', professionalId };
    }
    return { esBarbero: true, vinculado: true, motivo: null, professionalId };
  }, [user?.role, user?.professionalId, professionals]);
}

/** Texto del aviso, igual en todas las pantallas. */
export function textoVinculo(motivo) {
  if (motivo === 'sin-perfil') {
    return 'Tu cuenta no está asociada a ningún perfil de barbero, así que NO vas a ver los turnos que te reserven.';
  }
  return 'Tu cuenta apunta a un perfil de barbero que ya no existe (se borró o se volvió a crear), así que NO vas a ver los turnos que te reserven.';
}
