import { useState, useEffect } from 'react';
import { obtenerSucursalesDelGrupo } from '../lib/repository';

// ============================================================================
// Las sucursales de una cuenta, para la página pública de reservas
// ============================================================================
// Se lee una vez, al abrir el link. No hace falta una suscripción: que una
// barbería cambie de dirección mientras alguien está eligiendo sucursal no es
// un caso que valga un listener abierto en todas las reservas.
//
// Para una barbería sin grupo (el caso normal) no va a la base ni una vez.

/** Dónde se recuerda la elección. Por cuenta, no global: cada grupo es otro. */
export const claveSucursal = (grupoId) => `barberos:sucursal:${grupoId}`;

export function recordarSucursal(grupoId, businessId) {
  try { sessionStorage.setItem(claveSucursal(grupoId), businessId); } catch { /* sin storage se vuelve a preguntar */ }
}

export function sucursalRecordada(grupoId) {
  try { return sessionStorage.getItem(claveSucursal(grupoId)); } catch { return null; }
}

export function olvidarSucursal(grupoId) {
  try { sessionStorage.removeItem(claveSucursal(grupoId)); } catch { /* nada */ }
}

/**
 * Devuelve `{ sucursales, cargando }` de la cuenta a la que pertenece este
 * negocio.
 *
 * `cargando` se deriva de qué grupo tienen los datos que están en memoria, en
 * vez de ponerse a mano al arrancar el efecto: un setState sincrónico adentro
 * del efecto dispara un render de más en cada cambio.
 */
export function useSucursalesPublicas(business) {
  const grupoId = business?.grupoId || null;
  const [datos, setDatos] = useState({ grupoId: null, sucursales: [] });

  useEffect(() => {
    if (!grupoId) return;
    let vigente = true;
    obtenerSucursalesDelGrupo(grupoId)
      .then((filas) => { if (vigente) setDatos({ grupoId, sucursales: filas }); })
      .catch((err) => {
        console.error('[sucursales] No se pudieron leer las sucursales:', err);
        // Si falla, se sigue como una barbería sola: es preferible que reserve
        // en la que abrió a dejarlo mirando una pantalla rota.
        if (vigente) setDatos({ grupoId, sucursales: [] });
      });
    return () => { vigente = false; };
  }, [grupoId]);

  return {
    sucursales: datos.grupoId === grupoId ? datos.sucursales : [],
    cargando: Boolean(grupoId) && datos.grupoId !== grupoId,
  };
}
