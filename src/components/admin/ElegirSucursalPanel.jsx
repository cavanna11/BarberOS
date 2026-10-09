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

export default function ElegirSucursalPanel({ sucursales, grupoId, nombreCuenta = '', esPlataforma = false, onElegir }) {
  // Todas iguales: por nombre. La que factura la cuenta va primera solo para la
  // plataforma, que es a quien le importa dónde se cobra.
  const ordenadas = [...sucursales].sort((a, b) => (esPlataforma && a.id === grupoId ? -1 : esPlataforma && b.id === grupoId ? 1 : String(a.name).localeCompare(String(b.name))));

  return (
    <div className="elegir-sucursal-panel">
      <div className="admin-page-header">
        <div>
          <h1>{esPlataforma ? '¿Qué sucursal querés administrar?' : '¿En qué sucursal vas a trabajar?'}</h1>
          <span className="text-secondary text-sm">
            {nombreCuenta ? <><strong>{nombreCuenta}</strong> tiene {sucursales.length} sucursales. </> : null}
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
                {esPlataforma && s.id === grupoId && <span className="badge badge-neutral">Factura la cuenta</span>}
                {s.isFrozen && <span className="badge badge-danger">Suspendida</span>}
              </div>
              <div className="text-sm text-secondary">{dir ? `📍 ${dir}` : '📍 sin dirección'}</div>
              <div className="text-sm text-secondary">{s.phone ? `📞 ${s.phone}` : '📞 sin teléfono'}</div>
              <div className="text-xs text-muted">barberos.sacia.tech/{s.slug}</div>
              {esPlataforma && s.id === grupoId && (
                <div className="text-xs text-muted">El plan y el abono de toda la cuenta se cobran acá.</div>
              )}
              {falta.length > 0
                ? <div className="elegir-sucursal-falta">⚠️ Falta: {falta.join(', ')}</div>
                : <div className="elegir-sucursal-ok">✅ Datos básicos cargados</div>}
              <span className="btn btn-primary btn-sm elegir-sucursal-boton">{esPlataforma ? 'Administrar esta sucursal →' : 'Entrar →'}</span>
            </button>
          );
        })}
      </div>

      {esPlataforma && (
        <p className="text-sm text-muted" style={{ marginTop: 'var(--space-lg)' }}>
          <Link to="/super-admin">← Volver al panel global</Link>
        </p>
      )}
    </div>
  );
}
