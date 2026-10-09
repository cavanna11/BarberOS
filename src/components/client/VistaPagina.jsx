import { useState } from 'react';
import { Link } from 'react-router-dom';
import { getPlantilla } from '../../config/pagina';
import { formatPrice } from '../../utils/dateUtils';
import {
  direccionDe, instagramDe, linkInstagram, linkMaps, linkWhatsApp, inicialesDe,
} from '../../utils/contactoBarberia';
import TemaNegocio from './TemaNegocio';

// ============================================================================
// Lo que se VE de la página de presentación
// ============================================================================
// Sin lecturas ni navegación propias: recibe la configuración y los datos ya
// resueltos. Existe aparte por una razón: el editor ("Mi página") muestra la
// vista previa con ESTE MISMO componente, así que lo que el dueño ve mientras
// edita es exactamente lo que va a ver el cliente — no una imitación que con el
// tiempo se separa de la página real.
//
// `vistaPrevia`: nada navega (los links son texto). Es una muestra, y un toque
// sin querer en "Reservar" no puede sacar al dueño del editor con los cambios
// sin guardar.

/** Un link, o un span inerte en la vista previa. */
function Enlace({ vistaPrevia, to, href, className, children }) {
  if (vistaPrevia) return <span className={className}>{children}</span>;
  if (to) return <Link to={to} className={className}>{children}</Link>;
  return <a className={className} href={href} target="_blank" rel="noreferrer nofollow">{children}</a>;
}

export default function VistaPagina({
  business, cfg, servicios = [], locales = [], businessId, slug,
  codigoPromo = null, onReservar = () => {}, vistaPrevia = false,
}) {
  const [verServicios, setVerServicios] = useState(false);

  const plantilla = getPlantilla(cfg.plantilla) || getPlantilla('simple');
  const conFoto = plantilla.id === 'foto' && Boolean(cfg.coverUrl);
  const direccion = direccionDe(business);
  const maps = linkMaps(business);
  const wa = linkWhatsApp(business);
  const ig = linkInstagram(business);
  const activos = servicios.filter((s) => s.isActive !== false);

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
                    <Enlace key={s.id} vistaPrevia={vistaPrevia} to={`/${s.slug}`} className="pagina-boton">
                      <span className="pagina-boton-texto">{s.name}</span>
                      {dir && <span className="pagina-boton-nota">{dir}</span>}
                    </Enlace>
                  );
                })}
              </>
            )}

            <button type="button" className="pagina-boton pagina-boton-principal" onClick={vistaPrevia ? undefined : onReservar}>
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
              <Enlace vistaPrevia={vistaPrevia} href={maps} className="pagina-boton">
                <span className="pagina-boton-texto">Cómo llegar</span>
              </Enlace>
            )}
            {wa && (
              <Enlace vistaPrevia={vistaPrevia} href={wa} className="pagina-boton">
                <span className="pagina-boton-texto">WhatsApp</span>
              </Enlace>
            )}
            {ig && (
              <Enlace vistaPrevia={vistaPrevia} href={ig} className="pagina-boton">
                <span className="pagina-boton-texto">Instagram</span>
                <span className="pagina-boton-nota">@{instagramDe(business)}</span>
              </Enlace>
            )}

            {/* Los botones libres: lo que no entra en ninguna categoría de
                arriba (la carta, un sorteo, el formulario para trabajar ahí).
                Van al final porque lo que el cliente viene a hacer es reservar.
                `nofollow` porque son links que escribe el dueño. */}
            {cfg.botones.map((b, i) => (
              <Enlace key={i} vistaPrevia={vistaPrevia} href={b.url} className="pagina-boton">
                <span className="pagina-boton-texto">{b.texto}</span>
              </Enlace>
            ))}
          </nav>

          <footer className="pagina-pie">
            {vistaPrevia
              ? <span>Mis turnos</span>
              : <Link to={`/${slug}/mis-citas`}>Mis turnos</Link>}
            <span className="pagina-marca">Hecho con BarberOS</span>
          </footer>
        </main>
      </div>
    </TemaNegocio>
  );
}
