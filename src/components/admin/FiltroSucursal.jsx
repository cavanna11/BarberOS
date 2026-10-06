import { useBusiness } from '../../contexts/BusinessContext';
import { useCurrentBusiness } from '../../hooks/useCurrentBusiness';

/**
 * El selector de sucursal que aparece en las pantallas de gestión.
 *
 * Tiene dos modos, y la diferencia importa:
 *
 *   - Una sucursal puntual → además de filtrar, pasa a ser la sucursal ACTIVA.
 *     Todo lo que el panel escribe (un turno nuevo, un servicio, un barbero) va
 *     a esa. Es lo mismo que "Gestionar sucursal", pero sin salir de la pantalla.
 *   - "Todas" → se juntan los datos de las cuatro para MIRARLOS. Lo que se
 *     escribe sigue yendo a la sucursal activa, y cada fila se acuerda de cuál
 *     es la suya (`__bizId`), así que las acciones de un turno de Centro tocan
 *     Centro aunque la lista los muestre a todos juntos.
 *
 * En una cuenta de una sola barbería no se muestra nada.
 */
export default function FiltroSucursal({ valor, onChange, incluirTodas = true }) {
  const { sucursales, businessId, esMultiSucursal } = useCurrentBusiness();
  const { dispatch } = useBusiness();

  if (!esMultiSucursal) return null;

  const cambiar = (v) => {
    // Al elegir una puntual, se vuelve la activa: si no, "agregar" en esa
    // pantalla crearía el dato en la sucursal anterior, que es el peor error
    // posible acá.
    if (v && v !== businessId) dispatch({ type: 'SET_CURRENT_BUSINESS', payload: v });
    onChange(v);
  };

  return (
    <select
      className="form-input"
      value={valor}
      onChange={(e) => cambiar(e.target.value)}
      style={{ maxWidth: 230 }}
      title="Sucursal"
    >
      {incluirTodas && <option value="">Todas las sucursales</option>}
      {sucursales.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}{s.id === businessId ? ' (acá estás)' : ''}
        </option>
      ))}
    </select>
  );
}
