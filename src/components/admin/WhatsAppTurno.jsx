import { linkWhatsApp, mensajesDelTurno } from '../../utils/whatsapp';

/**
 * Los dos botones de WhatsApp de un turno: recordatorio y agradecimiento.
 *
 * Lo único que hacen es abrir WhatsApp con el mensaje YA ESCRITO, en el teléfono
 * del barbero, apuntando al número que el cliente dejó al reservar. El mensaje
 * no se manda solo: lo manda el barbero, desde su número, cuando quiere. No hay
 * API de Meta, ni bot, ni costo por mensaje, ni nada corriendo del lado del
 * servidor.
 *
 * Si el turno no tiene un teléfono que sirva, no se muestra nada: un botón que
 * abre WhatsApp en un número inventado es peor que no tener botón.
 */
export default function WhatsAppTurno({ turno, business, servicio = null, compacto = false }) {
  const mensajes = mensajesDelTurno(turno, {
    nombreNegocio: business?.name || '',
    nombreServicio: servicio?.name || '',
  });

  const recordatorio = linkWhatsApp(turno?.clientPhone, mensajes.recordatorio);
  const gracias = linkWhatsApp(turno?.clientPhone, mensajes.gracias);

  // Sin teléfono válido (o un walk-in, que no tiene cliente cargado) no hay a
  // quién escribirle.
  if (!recordatorio) return null;

  // Después del turno, lo que se manda es el agradecimiento; antes, el
  // recordatorio. Se ofrecen los dos igual —el barbero sabrá—, pero el que
  // corresponde va primero y resaltado.
  const yaPaso = turno?.status === 'completada' || turno?.status === 'no_asistio';

  // El orden: primero el que corresponde al momento del turno.
  const botones = yaPaso
    ? [{ href: gracias, texto: 'Gracias', principal: true }, { href: recordatorio, texto: 'Recordatorio' }]
    : [{ href: recordatorio, texto: 'Recordatorio', principal: true }, { href: gracias, texto: 'Gracias' }];

  return (
    <div className={`whatsapp-turno ${compacto ? 'compacto' : ''}`}>
      {!compacto && <span className="whatsapp-turno-label">WhatsApp</span>}
      {botones.map((b) => (
        <a
          key={b.texto}
          href={b.href}
          target="_blank"
          rel="noreferrer"
          className={`btn btn-sm ${b.principal ? 'btn-whatsapp' : 'btn-ghost'}`}
          title="Abre WhatsApp con el mensaje escrito. Lo mandás vos."
          style={{ textDecoration: 'none' }}
          onClick={(e) => e.stopPropagation()}
        >
          {b.texto}
        </a>
      ))}
    </div>
  );
}
