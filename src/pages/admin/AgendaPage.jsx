import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../hooks/useTenantData';
import { updateAppointment } from '../../lib/repository';
import AgendaDelDia from '../../components/admin/AgendaDelDia';
import NuevoTurnoModal from '../../components/admin/NuevoTurnoModal';
import { useVinculoBarbero, textoVinculo } from '../../hooks/useVinculoBarbero';

/**
 * La agenda del día a pantalla completa, como sección propia.
 *
 * Estaba al pie del dashboard, abajo de las estadísticas: es lo que el barbero
 * mira entre cliente y cliente y había que bajar hasta el final para verla.
 */
export default function AgendaPage() {
  const { user } = useAuth();
  const { appointments, professionals, services, business, businessId } = useTenant();
  const [agendando, setAgendando] = useState(false);
  const vinculo = useVinculoBarbero();

  const isOwner = user?.role === 'owner';
  const visibles = isOwner
    ? appointments
    : user?.professionalId
      ? appointments.filter((a) => a.professionalId === user.professionalId)
      : [];

  const cambiarEstado = (apt, status) => {
    if (status === 'cancelada' && !window.confirm('¿Cancelar este turno?')) return;
    updateAppointment(businessId, apt.id, { status }).catch((err) => {
      console.error('[AgendaPage] No se pudo actualizar el turno:', err);
      alert('No se pudo actualizar el turno: ' + err.message);
    });
  };

  return (
    <div>
      <div className="admin-page-header">
        <h1>Agenda</h1>
        <button className="btn btn-primary" onClick={() => setAgendando(true)}>📅 Agendar turno</button>
      </div>

      {agendando && <NuevoTurnoModal onClose={() => setAgendando(false)} />}

      {vinculo.esBarbero && !vinculo.vinculado && (
        <div className="notice notice-danger mb-md">⚠️ {textoVinculo(vinculo.motivo)}</div>
      )}

      <div className="card">
        <AgendaDelDia
          appointments={visibles}
          professionals={professionals}
          services={services}
          business={business}
          professionalId={isOwner ? null : user?.professionalId}
          onCambiarEstado={cambiarEstado}
        />
      </div>
    </div>
  );
}
