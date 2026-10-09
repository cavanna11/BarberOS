import { Link } from 'react-router-dom';
import { direccionDe, linkWhatsApp } from '../../utils/contactoBarberia';

// ============================================================================
// "¿Qué sucursal querés administrar?"
// ============================================================================
// Lo primero que ve la plataforma al entrar a una cuenta con varias
// sucursales. Antes caía directo en la principal, con el menú de Profesionales,
// Servicios y Configuración a mano, y era fácil cargarle a la principal el
// WhatsApp o el equipo de otro local: cada sucursal es una barbería COMPLETA y
// separada, con su propio teléfono, equipo, servicios y horarios.
//
// Mientras no elija, el panel no deja tocar nada (AdminLayout no muestra el
// menú ni las pantallas). Cada tarjeta dice qué le falta configurar a ese
// local, que es lo que se viene a hacer cuando se prepara una cuenta nueva.

function faltantes(b) {
  const f = [];
  if (!b.phone && !linkWhatsApp(b)) f.push('teléfono / WhatsApp');
  if (!direccionDe(b)) f.push('dirección');
  if (!(b.businessHours || []).some((h) => h.isActive)) f.push('horario');
  return f;
}

export default function ElegirSucursalPanel({ sucursales, grupoId, onElegir }) {
  const ordenadas = [...sucursales].sort((a, b) => (a.id === grupoId ? -1 : b.id === grupoId ? 1 : String(a.name).localeCompare(String(b.name))));
  const principal = sucursales.find((s) => s.id === grupoId);

  return (
    <div className="elegir-sucursal-panel">
      <div className="admin-page-header">
        <div>
          <h1>¿Qué sucursal querés administrar?</h1>
          <span className="text-secondary text-sm">
            {principal ? <>La cuenta <strong>{principal.name}</strong> tiene {sucursales.length} sucursales. </> : null}
            Cada una tiene su propio equipo, servicios, horarios, teléfono y link: elegí una para configurarla.
          </span>
        </div>
      </div>

      <div className="elegir-sucursal-grilla">
        {ordenadas.map((s) => {
          const falta = faltantes(s);
          const dir = direccionDe(s);
          return (
            <button key={s.id} type="button" className="card card-selectable elegir-sucursal-tarjeta" onClick={() => onElegir(s)}>
              <div className="elegir-sucursal-cabecera">
                <h3>{s.name}</h3>
                {s.id === grupoId && <span className="badge badge-primary">Principal</span>}
                {s.isFrozen && <span className="badge badge-danger">Suspendida</span>}
              </div>
              <div className="text-sm text-secondary">{dir ? `📍 ${dir}` : '📍 sin dirección'}</div>
              <div className="text-sm text-secondary">{s.phone ? `📞 ${s.phone}` : '📞 sin teléfono'}</div>
              <div className="text-xs text-muted">barberos.sacia.tech/{s.slug}</div>
              {s.id === grupoId && (
                <div className="text-xs text-muted">Acá se manejan el plan y el abono de toda la cuenta.</div>
              )}
              {falta.length > 0
                ? <div className="elegir-sucursal-falta">⚠️ Falta: {falta.join(', ')}</div>
                : <div className="elegir-sucursal-ok">✅ Datos básicos cargados</div>}
              <span className="btn btn-primary btn-sm elegir-sucursal-boton">Administrar esta sucursal →</span>
            </button>
          );
        })}
      </div>

      <p className="text-sm text-muted" style={{ marginTop: 'var(--space-lg)' }}>
        <Link to="/super-admin">← Volver al panel global</Link>
      </p>
    </div>
  );
}
