import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTenant } from '../../hooks/useTenantData';
import { getPagina } from '../../lib/repository';
import { capacidadesDelNegocio } from '../../config/plans';
import { paginaEfectiva } from '../../config/pagina';
import { useSucursalesPublicas, recordarSucursal } from '../../hooks/useSucursalesPublicas';
import VistaPagina from '../../components/client/VistaPagina';
import { recordarCupon, cuponRecordado } from '../../utils/cupon';

// ============================================================================
// La página de presentación de la barbería
// ============================================================================
// Lo primero que ve quien abre el link: el nombre, una línea de presentación y
// una lista de botones grandes. De acá se entra a reservar.
//
// Es casi todo contenido que la barbería ya tenía cargado para la reserva
// (nombre, logo, presentación, dirección, Instagram, WhatsApp, servicios). Lo
// único nuevo es la plantilla, la foto de portada y hasta dos botones libres.
// Esa es la razón por la que esto se puede prender y queda bien sin que nadie
// cargue nada: si hubiera que llenar diez campos antes de que se vea
// presentable, la mayoría de las barberías la dejaría a medio hacer.
//
// No lleva el header ni el footer de BarberOS (ver la ruta en App.jsx): es la
// página de la barbería, no una pantalla del producto. Abajo queda una línea
// chica, que es lo que corresponde.
//
// El orden de los botones no es estético: PRIMERO LAS SUCURSALES. Quien abre
// el link de una cuenta con varios locales tiene que decidir a cuál va ANTES
// de reservar, porque el equipo y los horarios son los de ese local. Por eso,
// cuando hay varias, el botón de reservar dice en cuál reserva.

export default function PaginaBarberia({ business }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { services, slug, businessId } = useTenant();
  const { sucursales } = useSucursalesPublicas(business);
  const [pagina, setPagina] = useState(null);

  // La configuración vive en un documento aparte (businesses/{id}/public/pagina)
  // porque lleva la foto de portada: sumársela al documento del negocio sería
  // bajarla en cada pantalla del panel y en cada paso de la reserva.
  useEffect(() => {
    if (!businessId) return;
    let vigente = true;
    getPagina(businessId)
      .then((datos) => { if (vigente) setPagina(datos || {}); })
      .catch((err) => {
        console.error('[pagina] No se pudo leer la página:', err);
        // Sin la configuración se muestra la plantilla simple con los datos del
        // negocio, que es una página correcta. Mejor eso que una pantalla vacía.
        if (vigente) setPagina({});
      });
    return () => { vigente = false; };
  }, [businessId]);

  // El título de la pestaña. Las etiquetas que lee WhatsApp para armar la
  // tarjeta del link las sirve `api/preview.js` del lado del servidor —un
  // crawler no ejecuta JavaScript, así que esto no las reemplaza—, pero sí es lo
  // que ve quien guarda la página en favoritos o la deja en una pestaña.
  useEffect(() => {
    if (!business?.name) return;
    const anterior = document.title;
    document.title = `${business.name} — Reservá tu turno`;
    return () => { document.title = anterior; };
  }, [business?.name]);

  const capacidades = useMemo(() => capacidadesDelNegocio(business), [business]);
  const cfg = useMemo(() => paginaEfectiva(pagina, capacidades), [pagina, capacidades]);

  const grupoId = business?.grupoId || null;
  const locales = sucursales.length > 1 ? sucursales : [];

  // El link de una promo entra por acá: `/:slug?cupon=CORTE20`. Se anota apenas
  // se ve, porque de acá hasta que el cliente confirme hay un login y
  // posiblemente un viaje a Mercado Pago, y la query string no sobrevive a
  // ninguno de los dos.
  const cuponDelLink = params.get('cupon');
  useEffect(() => {
    if (businessId && cuponDelLink) recordarCupon(businessId, cuponDelLink);
  }, [businessId, cuponDelLink]);
  const codigoPromo = cuponDelLink || (businessId ? cuponRecordado(businessId) : null);

  // Al entrar a reservar se anota la sucursal: si no, el flujo de reserva
  // vuelve a preguntar "elegí tu sucursal", y acá ya la eligió.
  const irAReservar = () => {
    if (grupoId) recordarSucursal(grupoId, businessId);
    // El cupón viaja en la URL además de en el storage: si el cliente abre la
    // reserva en otra pestaña, o el navegador le bloqueó el storage, el link
    // sigue andando. Es el mismo criterio que usa `recordarSucursal`.
    navigate(codigoPromo ? `/${slug}/reservar?cupon=${encodeURIComponent(codigoPromo)}` : `/${slug}/reservar`);
  };

  // Hasta que la configuración llegue no se pinta: la plantilla decide el fondo
  // de la pantalla entera, y arrancar en blanco para saltar a una foto a
  // pantalla completa se ve como un parpadeo.
  if (pagina === null) {
    return <div className="pagina-cargando"><p>Cargando…</p></div>;
  }

  return (
    <VistaPagina
      business={business}
      cfg={cfg}
      servicios={services}
      locales={locales}
      businessId={businessId}
      slug={slug}
      codigoPromo={codigoPromo}
      onReservar={irAReservar}
    />
  );
}
