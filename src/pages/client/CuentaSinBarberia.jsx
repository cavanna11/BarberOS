import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { crearBarberiaDePrueba } from '../../lib/functions';
import { isSlugAvailable } from '../../lib/repository';
import { slugify, isReservedSlug } from '../../utils/slug';

// Mismo número que la landing y el panel. Si cambia, cambia en los tres.
const WHATSAPP = '5492257529684';
const LINK_WA = `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(
  'Hola! Entré a BarberOS y quiero que me ayuden a armar mi barbería.'
)}`;

const DIAS = 5;

/**
 * Adónde va alguien que inició sesión y no tiene ninguna barbería: el alta.
 *
 * Antes decía "las cuentas las activamos nosotros, escribinos por WhatsApp".
 * El barbero que entraba un sábado a la noche a curiosear se iba: querer
 * probar algo y que te contesten el lunes no es lo mismo que probarlo ahora.
 * Ahora se crea la cuenta solo, con DIAS de prueba, y si no le sirve se corta
 * sola por el mismo camino que cualquier cuenta impaga. La puerta de WhatsApp
 * sigue abajo para el que prefiere que se la dejemos lista.
 */
export default function CuentaSinBarberia() {
  const { user, refreshClaims } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    nombre: '',
    nombreDueno: user?.name || '',
    telefono: '',
    ciudad: '',
    slug: '',
    slugEditado: false,
  });
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState('');

  const editar = (patch) => setForm((f) => ({ ...f, ...patch }));

  // El link se arma solo con el nombre, hasta que la persona lo toca.
  const cambiarNombre = (nombre) => {
    editar({ nombre, ...(form.slugEditado ? {} : { slug: slugify(nombre) }) });
  };

  const crear = async (ev) => {
    ev.preventDefault();
    setError('');

    const nombre = form.nombre.trim();
    const slug = form.slug.trim().toLowerCase();
    if (nombre.length < 2) return setError('Poné el nombre de tu barbería.');
    if (slug.length < 3) return setError('El link necesita al menos 3 letras.');
    if (isReservedSlug(slug)) return setError('Ese link está reservado. Probá con otro.');
    if (form.telefono.replace(/\D/g, '').length < 8) return setError('Poné un teléfono de contacto.');

    setCreando(true);
    try {
      // Se chequea acá para poder decirlo antes de mandar el formulario; el
      // servidor lo vuelve a chequear en una transacción, que es lo que de
      // verdad evita que dos se queden con el mismo link.
      if (!(await isSlugAvailable(slug))) {
        setCreando(false);
        return setError(`El link /${slug} ya está ocupado. Probá con otro.`);
      }

      await crearBarberiaDePrueba({
        nombre,
        slug,
        telefono: form.telefono.trim(),
        ciudad: form.ciudad.trim(),
        nombreDueno: form.nombreDueno.trim(),
      });

      // El permiso viaja en la sesión: sin pedir un token nuevo, entraría al
      // panel como si siguiera sin barbería.
      await refreshClaims();
      navigate('/admin');
    } catch (err) {
      console.error('[CuentaSinBarberia] No se pudo crear la barbería:', err);
      setError(err.message || 'No se pudo crear la barbería. Probá de nuevo.');
      setCreando(false);
    }
  };

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <div className="card">
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-lg)' }}>
          <div style={{ fontSize: '2.5rem' }}>💈</div>
          <h2 style={{ marginTop: 8 }}>Armá tu barbería en un minuto</h2>
          <p className="text-secondary">
            La probás {DIAS} días sin pagar nada y sin tarjeta. Si no te sirve, no hacés
            nada: se cierra sola.
          </p>
          {user?.email && (
            <p className="text-sm text-muted" style={{ marginTop: 6 }}>
              Entraste como <strong>{user.email}</strong>.
            </p>
          )}
        </div>

        {error && <div className="notice notice-danger" style={{ marginBottom: 'var(--space-md)' }}>{error}</div>}

        <form onSubmit={crear}>
          <div className="form-group">
            <label className="form-label">Nombre de la barbería <span className="required">*</span></label>
            <input
              className="form-input"
              value={form.nombre}
              onChange={(e) => cambiarNombre(e.target.value)}
              placeholder="Barbería Don José"
              autoFocus
            />
          </div>

          <div className="form-group">
            <label className="form-label">Tu link para compartir <span className="required">*</span></label>
            <div className="alta-slug">
              <span className="text-sm text-muted">barberos.sacia.tech/</span>
              <input
                className="form-input"
                value={form.slug}
                onChange={(e) => editar({ slug: slugify(e.target.value), slugEditado: true })}
                placeholder="don-jose"
              />
            </div>
            <p className="text-sm text-muted" style={{ marginTop: 6 }}>
              Es el link que les vas a pasar a tus clientes para que reserven.
            </p>
          </div>

          <div className="form-group">
            <label className="form-label">Tu nombre</label>
            <input
              className="form-input"
              value={form.nombreDueno}
              onChange={(e) => editar({ nombreDueno: e.target.value })}
              placeholder="José"
            />
            <p className="text-sm text-muted" style={{ marginTop: 6 }}>
              Te cargamos como primer barbero, para que el link funcione desde el minuto uno.
              Después sumás a los demás.
            </p>
          </div>

          <div className="form-group">
            <label className="form-label">Teléfono <span className="required">*</span></label>
            <input
              className="form-input"
              value={form.telefono}
              onChange={(e) => editar({ telefono: e.target.value })}
              placeholder="11 2345-6789"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Ciudad</label>
            <input
              className="form-input"
              value={form.ciudad}
              onChange={(e) => editar({ ciudad: e.target.value })}
              placeholder="Mar de Ajó"
            />
          </div>

          <button type="submit" className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={creando}>
            {creando ? 'Creando tu barbería…' : `Crear mi barbería y probar ${DIAS} días`}
          </button>
        </form>

        <p className="text-sm text-muted" style={{ marginTop: 12, textAlign: 'center' }}>
          Te dejamos cargados unos servicios y un horario de ejemplo. Cambiá lo que quieras
          desde el panel.
        </p>
      </div>

      <div className="card mt-md" style={{ textAlign: 'center' }}>
        <p className="text-sm text-secondary" style={{ marginBottom: 8 }}>
          <strong>¿Preferís que te la dejemos lista?</strong> Te la armamos con tu equipo,
          tus servicios y tus horarios cargados.
        </p>
        <a href={LINK_WA} target="_blank" rel="noreferrer" className="btn btn-outline">
          Hablemos por WhatsApp →
        </a>
      </div>

      <div className="card mt-md" style={{ textAlign: 'center' }}>
        <p className="text-sm text-secondary" style={{ marginBottom: 4 }}>
          <strong>¿Venías a reservar un turno?</strong>
        </p>
        <p className="text-sm text-secondary">
          Pedile a tu barbería el link que te compartieron: cada una tiene el suyo.{' '}
          <Link to="/">Volver al inicio</Link>
        </p>
      </div>
    </div>
  );
}
