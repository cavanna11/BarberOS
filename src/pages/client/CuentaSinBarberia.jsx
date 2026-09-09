import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

// Mismo número que la landing y el panel. Si cambia, cambia en los tres.
const WHATSAPP = '5492257529684';
const mensaje = encodeURIComponent(
  'Hola! Entré a BarberOS con mi cuenta y me dice que todavía no tengo barbería. Quiero saber cómo activarla.'
);
const LINK_WA = `https://wa.me/${WHATSAPP}?text=${mensaje}`;

/**
 * Adónde va alguien que inició sesión y no tiene ninguna barbería asociada.
 *
 * Antes se lo devolvía a la landing sin decirle nada: entraba, se logueaba bien,
 * y volvía al mismo lugar. Quedaba pensando que no había funcionado — y es
 * justamente el barbero curioso que entró a probar, o sea el lead que menos
 * conviene perder en silencio.
 *
 * No hay registro self-service y es a propósito (ver CLAUDE.md): la cuenta la
 * prepara la plataforma con el equipo, los servicios y los horarios ya cargados.
 * Así que esto no es un error, es el paso siguiente de la venta.
 */
export default function CuentaSinBarberia() {
  const { user } = useAuth();

  return (
    <div className="empty-state" style={{ maxWidth: 560, margin: '0 auto' }}>
      <div className="empty-state-icon">💈</div>
      <h2>Tu cuenta todavía no tiene una barbería</h2>

      {user?.email && (
        <p className="text-secondary" style={{ marginBottom: 'var(--space-md)' }}>
          Entraste como <strong>{user.email}</strong>.
        </p>
      )}

      <p>
        Las cuentas de BarberOS las activamos nosotros: te la dejamos andando con
        tu equipo, tus servicios y tus horarios ya cargados. No tenés que
        configurar nada.
      </p>

      <div style={{ marginTop: 'var(--space-lg)' }}>
        <a href={LINK_WA} target="_blank" rel="noreferrer" className="btn btn-primary btn-lg">
          Hablemos por WhatsApp →
        </a>
      </div>

      <div
        style={{
          marginTop: 'var(--space-xl)',
          paddingTop: 'var(--space-md)',
          borderTop: '1px solid var(--border-color)',
        }}
      >
        <p className="text-sm text-secondary" style={{ marginBottom: 4 }}>
          <strong>¿Venías a reservar un turno?</strong>
        </p>
        <p className="text-sm text-secondary">
          Pedile a tu barbería el link que te compartieron: cada una tiene su
          propia dirección.
        </p>
      </div>

      <div style={{ marginTop: 'var(--space-lg)' }}>
        <Link to="/" className="btn btn-ghost btn-sm">
          ← Volver al inicio
        </Link>
      </div>
    </div>
  );
}
