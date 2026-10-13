import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getPlantilla } from '../../config/pagina';
import { formatPrice } from '../../utils/dateUtils';
import {
  direccionDe, instagramDe, linkInstagram, linkMaps, linkWhatsApp, inicialesDe,
  mapaIncrustado, horarioDeAtencion,
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

/**
 * Un botón, o un span que se ve igual en la vista previa. Las miniaturas del
 * editor son botones (se tocan para elegir el diseño), y un <button> adentro
 * de otro es HTML inválido: React lo avisa y el navegador lo arma mal.
 */
function Boton({ vistaPrevia, className, onClick, children, ...resto }) {
  if (vistaPrevia) return <span className={className} onClick={onClick}>{children}</span>;
  return <button type="button" className={className} onClick={onClick} {...resto}>{children}</button>;
}

/**
 * Las secciones aparecen al llegar scrolleando.
 *
 * Es el único efecto de la plantilla Sitio y está puesto con pinzas: una
 * transición de opacidad y 12 px de desplazamiento, una sola vez por sección.
 * Lo que se busca es que la página se sienta hecha, no que llame la atención —
 * una barbería no necesita una web que se mueva, necesita una que se entienda.
 *
 * `IntersectionObserver` y no una librería: son veinte líneas y no suma un
 * kilobyte al bundle del cliente.
 *
 * Apagado en la vista previa del editor: ahí todo tiene que verse de una, sin
 * que el dueño tenga que scrollear adentro de un celular de 390 px para
 * descubrir que su texto está. Y en `prefers-reduced-motion` lo apaga el CSS.
 */
function useAparecer(activo) {
  const ref = useRef(null);
  useEffect(() => {
    if (!activo || !ref.current) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver((entradas) => {
      for (const e of entradas) {
        if (e.isIntersecting) {
          e.target.classList.add('sitio-visible');
          obs.unobserve(e.target);
        }
      }
    }, { rootMargin: '0px 0px -10% 0px' });
    for (const el of ref.current.querySelectorAll('.sitio-aparece')) obs.observe(el);
    return () => obs.disconnect();
  }, [activo]);
  return ref;
}

/**
 * La plantilla "Sitio": una página que se baja, no una pantalla de botones.
 *
 * Comparte TODO con las otras tres —los mismos datos, los mismos helpers de
 * contacto, el mismo `TemaNegocio`— y vive en este archivo a propósito: el
 * editor muestra la vista previa con este mismo componente, así que lo que el
 * dueño ve mientras edita es exactamente lo que ve el cliente.
 */
/** El botón de reservar del Sitio. Aparece dos veces: en la portada y en la barra. */
function BotonReservar({ vistaPrevia, clase, onReservar, locales, business }) {
  return (
    <Boton vistaPrevia={vistaPrevia} className={clase} onClick={vistaPrevia ? undefined : onReservar}>
      {locales.length > 0 ? `Reservar en ${business.name}` : 'Reservar un turno'}
    </Boton>
  );
}

function Sitio({
  business, cfg, activos, locales, businessId, slug,
  codigoPromo, onReservar, vistaPrevia, direccion, maps, wa, ig, conFoto,
}) {
  const ref = useAparecer(!vistaPrevia);
  // La clase que arranca en opacidad 0 se pone SOLO si el observer va a correr
  // para sacarla. En la vista previa del editor no corre, asi que sin esto el
  // dueno veria su pagina en blanco mientras la edita: un efecto que esconde
  // contenido cuando no se ejecuta no es un efecto, es una pagina rota.
  const aparece = vistaPrevia ? '' : ' sitio-aparece';
  const mapa = cfg.mostrarMapa !== false ? mapaIncrustado(business) : null;
  const horarios = cfg.mostrarHorarios !== false ? horarioDeAtencion(business) : [];
  // Los saltos de línea que escribió el dueño son párrafos. Sin esto, tres
  // ideas separadas le quedan en un bloque único e ilegible.
  const parrafos = String(cfg.sobreMi || '').split(/\n+/).map((x) => x.trim()).filter(Boolean);

  return (
    <div className={`pagina-barberia pagina-sitio ${conFoto ? 'sitio-con-foto' : ''}`} ref={ref}>
      <header className="sitio-hero">
        {conFoto && (
          <div className="sitio-hero-foto" aria-hidden="true" style={{ backgroundImage: `url(${cfg.coverUrl})` }} />
        )}
        <div className="sitio-hero-contenido">
          {business.logoUrl
            ? <img src={business.logoUrl} alt={business.name} className="sitio-logo" />
            : <div className="pagina-iniciales" aria-hidden="true">{inicialesDe(business.name)}</div>}

          <h1 className="sitio-nombre">{cfg.titular?.trim() || business.name}</h1>

          {(cfg.bajada?.trim() || business.welcomeMessage) && (
            <p className="sitio-bajada">{cfg.bajada?.trim() || business.welcomeMessage}</p>
          )}

          {codigoPromo && (
            <p className="pagina-promo">🎉 Tenés un descuento con el código <strong>{codigoPromo}</strong></p>
          )}

          <BotonReservar
            vistaPrevia={vistaPrevia} clase="btn btn-primary btn-lg sitio-cta"
            onReservar={onReservar} locales={locales} business={business}
          />

          {direccion && <p className="sitio-direccion">📍 {direccion}</p>}
        </div>
      </header>

      <main className="sitio-cuerpo">
        {parrafos.length > 0 && (
          <section className={`sitio-seccion${aparece}`}>
            <h2 className="sitio-titulo">Sobre mí</h2>
            <div className="sitio-texto">
              {parrafos.map((t, i) => <p key={i}>{t}</p>)}
            </div>
          </section>
        )}

        {cfg.mostrarServicios !== false && activos.length > 0 && (
          <section className={`sitio-seccion${aparece}`}>
            <h2 className="sitio-titulo">Servicios</h2>
            <ul className="sitio-servicios">
              {activos.map((s) => (
                <li key={s.id}>
                  <span className="sitio-servicio-nombre">
                    {s.name}
                    {s.durationMinutes ? <span className="sitio-servicio-min">{s.durationMinutes} min</span> : null}
                  </span>
                  <span className="sitio-servicio-precio">{formatPrice(s.price)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {horarios.length > 0 && (
          <section className={`sitio-seccion${aparece}`}>
            <h2 className="sitio-titulo">Horarios</h2>
            <ul className="sitio-horarios">
              {horarios.map((h) => (
                <li key={h.dias}>
                  <span>{h.dias}</span>
                  <span className="sitio-horario-horas">{h.horas}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {locales.length > 0 && (
          <section className={`sitio-seccion${aparece}`}>
            <h2 className="sitio-titulo">Nuestros locales</h2>
            <div className="sitio-locales">
              {locales.map((l) => {
                const dir = direccionDe(l);
                const aqui = l.id === businessId;
                const cerrado = l.isFrozen || l.onlineBookingEnabled === false;
                const contenido = (
                  <>
                    <strong>{l.name}</strong>
                    {dir && <span className="sitio-local-dir">{dir}</span>}
                    {aqui && <span className="sitio-local-nota">estás acá</span>}
                    {cerrado && !aqui && <span className="sitio-local-nota">no toma turnos</span>}
                  </>
                );
                if (aqui || cerrado) return <div key={l.id} className="sitio-local">{contenido}</div>;
                return (
                  <Enlace key={l.id} vistaPrevia={vistaPrevia} to={`/${l.slug}`} className="sitio-local sitio-local-link">
                    {contenido}
                  </Enlace>
                );
              })}
            </div>
          </section>
        )}

        {mapa && (
          <section className={`sitio-seccion${aparece}`}>
            <h2 className="sitio-titulo">Dónde estamos</h2>
            {/* El `src` lo arma `mapaIncrustado()` desde la dirección cargada,
                nunca desde una URL que escriba el dueño: un src de iframe que
                sale de un campo de texto es una puerta abierta. `lazy` para que
                el mapa (y la conexión a Google) recién pase cuando alguien
                llega scrolleando hasta acá. */}
            {/* En el editor va un marcador, no el mapa de verdad. La vista
                previa se dibuja dos veces (la miniatura de la plantilla y el
                celular grande) y se vuelve a dibujar con cada tecla que toca el
                dueño: serían dos pedidos a Google por apertura del panel, para
                mostrar un mapa que él ya sabe dónde queda. */}
            <div className="sitio-mapa">
              {vistaPrevia ? (
                <div className="sitio-mapa-muestra">
                  <span>🗺️</span>
                  <span>{direccion}</span>
                </div>
              ) : (
                <iframe
                  src={mapa}
                  title={`Mapa de ${business.name}`}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  allowFullScreen
                />
              )}
            </div>
            {maps && (
              <Enlace vistaPrevia={vistaPrevia} href={maps} className="btn btn-outline sitio-boton-ancho">
                Cómo llegar
              </Enlace>
            )}
          </section>
        )}

        <section className={`sitio-seccion${aparece}`}>
          <h2 className="sitio-titulo">Escribinos</h2>
          <div className="sitio-contacto">
            {wa && (
              <Enlace vistaPrevia={vistaPrevia} href={wa} className="btn btn-outline sitio-boton-ancho">
                WhatsApp
              </Enlace>
            )}
            {ig && (
              <Enlace vistaPrevia={vistaPrevia} href={ig} className="btn btn-outline sitio-boton-ancho">
                Instagram · @{instagramDe(business)}
              </Enlace>
            )}
            {cfg.botones.map((b, i) => (
              <Enlace key={i} vistaPrevia={vistaPrevia} href={b.url} className="btn btn-outline sitio-boton-ancho">
                {b.texto}
              </Enlace>
            ))}
          </div>
        </section>
      </main>

      {/* La barra de abajo. Es el "efecto" que de verdad sirve: en una página
          larga, el botón de reservar queda arriba de todo y el que terminó de
          leer tiene que volver a buscarlo. Acá lo tiene siempre. */}
      {!vistaPrevia && (
        <div className="sitio-barra">
          <BotonReservar
            vistaPrevia={vistaPrevia} clase="btn btn-primary sitio-barra-btn"
            onReservar={onReservar} locales={locales} business={business}
          />
        </div>
      )}

      <footer className="pagina-pie sitio-pie">
        {vistaPrevia
          ? <span>Mis turnos</span>
          : <Link to={`/${slug}/mis-citas`}>Mis turnos</Link>}
        <span className="pagina-marca">Hecho con BarberOS</span>
      </footer>
    </div>
  );
}

export default function VistaPagina({
  business, cfg, servicios = [], locales = [], businessId, slug,
  codigoPromo = null, onReservar = () => {}, vistaPrevia = false,
}) {
  const [verServicios, setVerServicios] = useState(false);

  const plantilla = getPlantilla(cfg.plantilla) || getPlantilla('simple');
  // La foto de portada la usan dos plantillas: la de pantalla completa y el
  // Sitio, donde va de fondo del encabezado.
  const conFoto = ['foto', 'landing'].includes(plantilla.id) && Boolean(cfg.coverUrl);
  const direccion = direccionDe(business);
  const maps = linkMaps(business);
  const wa = linkWhatsApp(business);
  const ig = linkInstagram(business);
  const activos = servicios.filter((s) => s.isActive !== false);

  if (plantilla.id === 'landing') {
    return (
      <TemaNegocio business={business}>
        <Sitio
          business={business} cfg={cfg} activos={activos} locales={locales}
          businessId={businessId} slug={slug} codigoPromo={codigoPromo}
          onReservar={onReservar} vistaPrevia={vistaPrevia}
          direccion={direccion} maps={maps} wa={wa} ig={ig} conFoto={conFoto}
        />
      </TemaNegocio>
    );
  }

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

            <Boton vistaPrevia={vistaPrevia} className="pagina-boton pagina-boton-principal" onClick={vistaPrevia ? undefined : onReservar}>
              <span className="pagina-boton-texto">
                {locales.length > 0 ? `Reservar en ${business.name}` : 'Reservar un turno'}
              </span>
            </Boton>

            {cfg.mostrarServicios !== false && activos.length > 0 && (
              <>
                <Boton
                  vistaPrevia={vistaPrevia}
                  className="pagina-boton"
                  aria-expanded={verServicios}
                  onClick={() => setVerServicios((v) => !v)}
                >
                  <span className="pagina-boton-texto">Servicios y precios</span>
                  <span className="pagina-boton-nota">
                    {verServicios ? 'ocultar' : `${activos.length} ${activos.length === 1 ? 'servicio' : 'servicios'}`}
                  </span>
                </Boton>
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
