import { Suspense } from 'react';
import { PAGINAS } from './index';

/**
 * Pinta la página exclusiva de `businessId` (ver `index.js`). Quien la usa
 * pregunta antes con `paginaExclusiva()`; si no hay, no pinta nada.
 */
export default function PaginaExclusiva({ businessId, ...props }) {
  const Pagina = PAGINAS[businessId];
  if (!Pagina) return null;
  return (
    <Suspense fallback={<div className="pagina-cargando"><p>Cargando…</p></div>}>
      <Pagina {...props} />
    </Suspense>
  );
}
