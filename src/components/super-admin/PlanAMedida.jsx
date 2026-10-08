import { camposDeLaMedida } from '../../utils/planMedida';

// ============================================================================
// Los campos del Plan Personalizado
// ============================================================================
// Lo que se acuerda con el cliente cuando no entra en ningún plan de la lista:
// cuántas sucursales, cuántos barberos y qué funciones le habilitamos.
//
// Antes acá solo se preguntaba la cuota de WhatsApp y el abono, que es lo que
// diferenciaba a los planes de la escalera vieja. Hoy lo que separa un plan de
// otro es la CAPACIDAD, así que preguntar por mensajes —de una integración que
// todavía no está— y no por sucursales dejaba al Personalizado sin forma de
// configurarse: se creaba con los topes del Básico.
//
// Vacío = sin límite, a propósito: "ilimitado" es un acuerdo normal en un plan a
// medida, y escribir 999 sería inventar un número que después alguien lee como
// límite real.

const CAPACIDADES = [
  { campo: 'fotoPerfil', titulo: 'Foto de perfil de los barberos', detalle: 'Se ve en la página de reservas' },
  { campo: 'colores', titulo: 'Colores propios', detalle: 'Su paleta en todo su link público' },
  { campo: 'logo', titulo: 'Logo propio', detalle: 'Arriba de su link público' },
  { campo: 'pagina', titulo: 'Página de presentación', detalle: 'Su mini landing antes de la reserva' },
  { campo: 'paginaFoto', titulo: 'Foto de portada en la página', detalle: 'La plantilla con la foto a pantalla completa' },
];

export default function PlanAMedida({ valor, onChange }) {
  const set = (patch) => onChange({ ...valor, ...patch });
  const resumen = camposDeLaMedida(valor);

  return (
    <div style={{ marginTop: 'var(--space-md)' }}>
      <h4 style={{ fontSize: 13, marginBottom: 8 }}>Qué incluye este plan a medida</h4>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div className="form-group">
          <label className="form-label">Sucursales</label>
          <input
            type="number"
            min="1"
            className="form-input"
            value={valor.maxSucursales}
            onChange={(e) => set({ maxSucursales: e.target.value })}
            placeholder="sin límite"
          />
          <p className="text-muted" style={{ fontSize: 11, marginTop: 3 }}>
            {resumen.maxSucursales === null ? 'Sin límite' : `Hasta ${resumen.maxSucursales}`}
          </p>
        </div>

        <div className="form-group">
          <label className="form-label">Barberos por sucursal</label>
          <input
            type="number"
            min="1"
            className="form-input"
            value={valor.maxBarbers}
            onChange={(e) => set({ maxBarbers: e.target.value })}
            placeholder="sin límite"
          />
          <p className="text-muted" style={{ fontSize: 11, marginTop: 3 }}>
            {resumen.maxBarbers === null ? 'Sin límite' : `Hasta ${resumen.maxBarbers}`}
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
        {CAPACIDADES.map((c) => (
          <label
            key={c.campo}
            className="card card-selectable"
            style={{ padding: '9px 12px', display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', margin: 0 }}
          >
            <input
              type="checkbox"
              checked={valor[c.campo] === true}
              onChange={(e) => set({ [c.campo]: e.target.checked })}
              style={{ marginTop: 3 }}
            />
            <span>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{c.titulo}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.detalle}</div>
            </span>
          </label>
        ))}
      </div>

      <div className="form-group" style={{ marginTop: 'var(--space-md)' }}>
        <label className="form-label">Cuota de avisos por WhatsApp (opcional)</label>
        <input
          type="number"
          min="0"
          className="form-input"
          value={valor.whatsappQuota}
          onChange={(e) => set({ whatsappQuota: e.target.value })}
          placeholder="0"
        />
        <p className="text-muted" style={{ fontSize: 11, marginTop: 3 }}>
          Para cuando esté la integración con la API de WhatsApp. Hoy no se usa: los
          mensajes los manda el barbero desde su propio teléfono.
        </p>
      </div>
    </div>
  );
}
