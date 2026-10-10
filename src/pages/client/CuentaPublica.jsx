import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { obtenerSucursalesDelGrupo } from '../../lib/repository';
import ElegirSucursal from '../../components/client/ElegirSucursal';
import NoBusinessPage from './NoBusinessPage';
import { recordarSucursal } from '../../hooks/useSucursalesPublicas';

// ============================================================================
// El link de la CUENTA (`/franlook`): "¿a qué sucursal vas?"
// ============================================================================
// Una cuenta con sucursales tiene un link por local (`/franlook-olivos`, que
// entra directo a ese local) y, si se lo dimos, un link de la cuenta, que no es
// ninguna sucursal: es el que se pone en la bio de Instagram de la marca.
// Ese link pregunta a cuál va y lo manda al link de esa sucursal, respetando lo
// que venía después (`/franlook/reservar` → `/franlook-olivos/reservar`).

export default function CuentaPublica({ grupoId }) {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const { businessSlug } = useParams();
  const [sucursales, setSucursales] = useState(null);

  useEffect(() => {
    let vigente = true;
    obtenerSucursalesDelGrupo(grupoId)
      .then((filas) => { if (vigente) setSucursales(filas); })
      .catch((err) => {
        console.error('[cuenta] No se pudieron leer las sucursales:', err);
        if (vigente) setSucursales([]);
      });
    return () => { vigente = false; };
  }, [grupoId]);

  if (sucursales === null) {
    return <div className="empty-state" style={{ padding: 'var(--space-2xl)' }}><p>Cargando…</p></div>;
  }
  if (sucursales.length === 0) return <NoBusinessPage reason="not-found" />;

  // Lo que venía después del link de la cuenta: /reservar, /mis-citas…
  const resto = pathname.slice(`/${businessSlug}`.length);

  return (
    <div className="booking-container">
      <ElegirSucursal
        sucursales={sucursales}
        actualId={null}
        onElegir={(s) => {
          recordarSucursal(grupoId, s.id);
          navigate(`/${s.slug}${resto}${search}`);
        }}
      />
    </div>
  );
}
