import { useState, useEffect, useCallback } from 'react';
import { obtenerSubcoleccion } from '../lib/repository';
import { useCurrentBusiness } from './useCurrentBusiness';

// ============================================================================
// Los datos de TODAS las sucursales de la cuenta, de una
// ============================================================================
// Para las pantallas que ofrecen "Sucursal: Todas". El panel trabaja siempre
// sobre UNA barbería (es lo que mantiene los datos separados), así que para ver
// varias juntas hay que ir a buscarlas.
//
// Se leen de UNA SOLA VEZ, no con suscripciones. Mantener cuatro agendas
// escuchando en todas las pantallas del panel sería pagar cuatro veces lo mismo
// todo el tiempo, incluso cuando el dueño está mirando una sola sucursal. Hay un
// botón para releer, y al cambiar de filtro se relee solo.
//
// (No rompe la regla de "las suscripciones viven en BusinessSync": esto no es
// una suscripción, es una lectura, como `getBusinessIdBySlug`.)
//
// Cada fila que devuelve lleva `__bizId` y `__sucursal`: sin eso, al juntar los
// turnos de cuatro locales en una sola tabla, el botón "Vino" escribiría en la
// barbería equivocada. Es el detalle que hace que esto sea seguro y no una
// mezcla de datos.

export function useDatosDeSucursales(colecciones, { activo = true } = {}) {
  const { sucursales } = useCurrentBusiness();

  const [datos, setDatos] = useState({});
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');

  // Claves estables: los arrays cambian de identidad en cada render y el efecto
  // se dispararía para siempre.
  const idsClave = sucursales.map((s) => s.id).join(',');
  const colsClave = colecciones.join(',');

  const cargar = useCallback(async () => {
    if (!activo || !idsClave) { setDatos({}); return; }
    const ids = idsClave.split(',');
    const cols = colsClave.split(',');
    setCargando(true);
    setError('');
    try {
      const leidas = await Promise.all(
        ids.map(async (id) => {
          const porColeccion = {};
          for (const col of cols) {
            porColeccion[col] = (await obtenerSubcoleccion(id, col)).map((fila) => ({
              ...fila,
              __bizId: id,
            }));
          }
          return [id, porColeccion];
        })
      );
      setDatos(Object.fromEntries(leidas));
    } catch (err) {
      console.error('[useDatosDeSucursales] No se pudieron leer los datos:', err);
      setError('No se pudieron leer los datos de todas las sucursales: ' + err.message);
    } finally {
      setCargando(false);
    }
  }, [activo, idsClave, colsClave]);

  useEffect(() => { cargar(); }, [cargar]);

  /**
   * Todas las filas de una colección, de todas las sucursales, con el nombre de
   * la sucursal pegado a cada una.
   */
  const juntar = useCallback(
    (coleccion) => {
      const salida = [];
      for (const s of sucursales) {
        for (const fila of datos[s.id]?.[coleccion] || []) {
          salida.push({ ...fila, __sucursal: s.name });
        }
      }
      return salida;
    },
    [datos, sucursales]
  );

  return { datos, juntar, cargando, error, recargar: cargar, sucursales };
}
