import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTenant } from '../../hooks/useTenantData';
import { getPagina } from '../../lib/repository';
import { capacidadesDelNegocio } from '../../config/plans';
import { paginaEfectiva, getPlantilla } from '../../config/pagina';
import { formatPrice } from '../../utils/dateUtils';
import {
  direccionDe, instagramDe, linkInstagram, linkMaps, linkWhatsApp, inicialesDe,
} from '../../utils/contactoBarberia';
import { useSucursalesPublicas, recordarSucursal } from '../../hooks/useSucursalesPublicas';
import TemaNegocio from '../../components/client/TemaNegocio';
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
  const [verServicios, setVerServicios] = useState(false);

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
  const direccion = direccionDe(business);
  const maps = linkMaps(business);
  const wa = linkWhatsApp(business);
  const ig = linkInstagram(business);
  const activos = services.filter((s) => s.isActive !== false);

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

  const plantilla = getPlantilla(cfg.plantilla);
  const conFoto = plantilla.id === 'foto' && Boolean(cfg.coverUrl);

  return (
    <TemaNegocio business={business}>
      <div className={`pagina-barberia pagina-${plantilla.id} ${conFoto ? 'pagina-con-foto' : ''}`}>
        {conFoto && (
          <div className="pagina-portada" aria-hidden="true" style={{ backgroundImage: `url(${cfg.coverUrl})` }} />
        )}

        <main className="pagina-contenido">
          <header className="pagina-cabecera">
            {business.logoUrl
              ? <img src={business.logoUrl} alt={business.name} className="pagina-logo" />
              : <div className="pagina-iniciales" aria-hidden="true">{inicialesDe(business.name)}</div>}

            <h1 className="pagina-nombre">{cfg.titular?.trim() || business.name}</h1>

            {(cfg.bajada?.trim() || business.welcomeMessage) && (
              <p className="pagina-bajada">{cfg.bajada?.trim() || business.welcomeMessage}</p>
            )}

            {direccion && <p className="pagina-direccion">📍 {direccion}</p>}

            {/* Vino por un link de promoción: es lo que lo hizo tocar, así que
                va arriba y no escondido entre los botones. El porcentaje no se
                muestra acá porque el cupón todavía no se validó —eso pasa en la
                reserva, con el servicio elegido— y prometer un número que
                después no entra es peor que no prometerlo. */}
            {codigoPromo && (
              <p className="pagina-promo">🎉 Tenés un descuento con el código <strong>{codigoPromo}</strong></p>
            )}
          </header>

          <nav className="pagina-botones">
            {/* Primero los locales: a cuál va se decide antes de reservar. */}
            {locales.length > 0 && (
              <>
                <p className="pagina-grupo">Nuestros locales</p>
                {locales.map((s) => {
                  const dir = direccionDe(s);
                  if (s.id === businessId) {
                    return (
                      <div key={s.id} className="pagina-boton pagina-boton-aqui">
                        <span className="pagina-boton-texto">{s.name}</span>
                        <span className="pagina-boton-nota">estás acá</span>
                      </div>
                    );
                  }
                  // Una sucursal suspendida se muestra igual —existe, y el
                  // cliente puede estar buscándola— pero sin poder entrar.
                  if (s.isFrozen || s.onlineBookingEnabled === false) {
                    return (
                      <div key={s.id} className="pagina-boton pagina-boton-cerrado">
                        <span className="pagina-boton-texto">{s.name}</span>
                        <span className="pagina-boton-nota">no toma turnos</span>
                      </div>
                    );
                  }
                  return (
                    <Link key={s.id} to={`/${s.slug}`} className="pagina-boton">
                      <span className="pagina-boton-texto">{s.name}</span>
                      {dir && <span className="pagina-boton-nota">{dir}</span>}
                    </Link>
                  );
                })}
              </>
            )}

            <button type="button" className="pagina-boton pagina-boton-principal" onClick={irAReservar}>
              <span className="pagina-boton-texto">
                {locales.length > 0 ? `Reservar en ${business.name}` : 'Reservar un turno'}
              </span>
            </button>

            {cfg.mostrarServicios !== false && activos.length > 0 && (
              <>
                <button
                  type="button"
                  className="pagina-boton"
                  aria-expanded={verServicios}
                  onClick={() => setVerServicios((v) => !v)}
                >
                  <span className="pagina-boton-texto">Servicios y precios</span>
                  <span className="pagina-boton-nota">
                    {verServicios ? 'ocultar' : `${activos.length} ${activos.length === 1 ? 'servicio' : 'servicios'}`}
                  </span>
                </button>
                {verServicios && (
                  <ul className="pagina-servicios">
                    {activos.map((s) => (
                      <li key={s.id}>
                        <span>{s.name}</span>
                        <span className="pagina-servicio-precio">{formatPrice(s.price)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}

            {maps && (
              <a className="pagina-boton" href={maps} target="_blank" rel="noreferrer">
                <span className="pagina-boton-texto">Cómo llegar</span>
              </a>
            )}
            {wa && (
              <a className="pagina-boton" href={wa} target="_blank" rel="noreferrer">
                <span className="pagina-boton-texto">WhatsApp</span>
              </a>
            )}
            {ig && (
              <a className="pagina-boton" href={ig} target="_blank" rel="noreferrer">
                <span className="pagina-boton-texto">Instagram</span>
                <span className="pagina-boton-nota">@{instagramDe(business)}</span>
              </a>
            )}

            {/* Los botones libres: lo que no entra en ninguna categoría de
                arriba (la carta, un sorteo, el formulario para trabajar ahí).
                Van al final porque lo que el cliente viene a hacer es reservar.
                `nofollow` porque son links que escribe el dueño. */}
            {cfg.botones.map((b, i) => (
              <a key={i} className="pagina-boton" href={b.url} target="_blank" rel="noreferrer nofollow">
                <span className="pagina-boton-texto">{b.texto}</span>
              </a>
            ))}
          </nav>

          <footer className="pagina-pie">
            <Link to={`/${slug}/mis-citas`}>Mis turnos</Link>
            <span className="pagina-marca">Hecho con BarberOS</span>
          </footer>
        </main>
      </div>
    </TemaNegocio>
  );
}
