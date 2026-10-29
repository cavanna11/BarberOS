import { useState, useMemo, useEffect, useCallback } from 'react';
import { enOrden } from '../../utils/orden';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useBooking } from '../../contexts/BookingContext';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../hooks/useTenantData';
import { createAppointment, getBusySlots, miMembresia, misRecompensas } from '../../lib/functions';
import { calculateAvailableSlots, professionalWorksOnDate } from '../../utils/availabilityEngine';
import { formatDate, formatPrice, toDateString, getMonthName } from '../../utils/dateUtils';
import { servicioAplicaAlDia, servicioAplicaAlHorario, describirVentana, tieneVentana } from '../../utils/ventanaServicio';
import FichaBarberia from '../../components/client/FichaBarberia';
import ElegirSucursal from '../../components/client/ElegirSucursal';
import { useSucursalesPublicas, recordarSucursal, olvidarSucursal } from '../../hooks/useSucursalesPublicas';
import { guardarPendiente, leerPendiente, borrarPendiente } from '../../utils/reservaPendiente';
import CuponEnReserva from '../../components/client/CuponEnReserva';
import { recordarCupon, cuponRecordado, olvidarCupon, describirCupon } from '../../utils/cupon';
import MembresiaEnReserva from '../../components/client/MembresiaEnReserva';
import { coberturaDelServicio } from '../../utils/membresias';
import { obtenerSubcoleccion } from '../../lib/repository';
import { calcularPremio, premioUsableEn, enHappyHour, descuentoHappyHour } from '../../utils/recompensas';
import { RuletaJuego } from '../../components/recompensas/Juegos';
import { PremioEnReserva } from '../../components/recompensas/Premios';
import { premioRecordado, olvidarPremio } from '../../utils/premioElegido';
import {
  paraLaVenta, totalDeProductos, detalleDeProductos, seleccionParaElServidor,
  maximoAPedir, stockDe, STOCK_BAJO,
} from '../../utils/productos';

// ---- STEPPER ----
function Stepper({ step }) {
  const labels = ['Profesional', 'Servicio', 'Fecha', 'Horario', 'Datos', 'Confirmar'];
  return (
    <div className="stepper">
      {labels.map((label, idx) => {
        const num = idx + 1;
        const completed = num < step;
        const active = num === step;
        return (
          <div key={num} className="stepper-step">
            {idx > 0 && <div className={`stepper-line ${completed ? 'completed' : ''}`} />}
            <div>
              <div className={`stepper-circle ${active ? 'active' : ''} ${completed ? 'completed' : ''}`}>
                {completed ? '✓' : num}
              </div>
              <div className={`stepper-label ${active ? 'active' : ''}`}>{label}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Lo que se manda cuando al cliente le da igual quién lo atienda. El servidor
// resuelve a QUIÉN adentro de su transacción: si lo eligiera esta pantalla, dos
// personas mirando la misma grilla mandarían el mismo barbero y la segunda se
// comería "ese horario ya fue tomado" con el otro libre al lado.
// `functions/index.js` tiene su propia copia de este valor, como todo lo que
// cruza esa frontera.
export const CUALQUIERA = 'cualquiera';

// ---- PROFESSIONAL SELECT ----
function ProfessionalSelect({ professionals, selectedId, onSelect }) {
  return (
    <div>
      <h2 className="booking-step-title">Seleccioná tu profesional</h2>
      <p className="booking-step-subtitle">Elegí con quién querés atenderte</p>
      <div className="professionals-grid">
        {/* Primero, y a lo ancho: el que no conoce a ninguno no tiene por qué
            elegir a ciegas, y es el caso más común de un cliente nuevo. */}
        {professionals.filter((p) => p.isActive).length > 1 && (
          <div
            className={`card card-selectable professional-card prof-cualquiera ${selectedId === CUALQUIERA ? 'card-selected' : ''}`}
            onClick={() => onSelect(CUALQUIERA)}
          >
            <div className="avatar avatar-lg">💈</div>
            <h3>Cualquiera</h3>
            <p className="specialty">El primero que esté libre</p>
          </div>
        )}
        {professionals.filter(p => p.isActive).map((prof) => (
          <div
            key={prof.id}
            className={`card card-selectable professional-card ${selectedId === prof.id ? 'card-selected' : ''}`}
            onClick={() => onSelect(prof.id)}
          >
            <div className="avatar avatar-lg">
              {prof.avatarUrl ? <img src={prof.avatarUrl} alt={prof.name} /> : prof.name.split(' ').map(n => n[0]).join('')}
            </div>
            <h3>{prof.name}</h3>
            <p className="specialty">{prof.specialty}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// El orden en que la barbería cargó sus servicios (`displayOrder`), y si no
// tiene, por nombre: es el de su lista de precios, no el alfabético.
// El comparador vive en utils/orden.js: lo comparten esta pantalla, la página
// de presentación y el modal del staff. Tres copias del mismo criterio es la
// forma de que un día dejen de coincidir.

// ---- SERVICE SELECT ----
function ServiceSelect({ services, professionalServices, profIds = [], selectedId, onSelect, currency, incluido = () => false }) {
  const available = useMemo(() => {
    const psIds = new Set(
      professionalServices.filter((ps) => profIds.includes(ps.professionalId)).map((ps) => ps.serviceId)
    );
    // Con más de un barbero en juego, el precio y la duración son los del
    // SERVICIO y no los de uno en particular: es lo que va a usar el servidor
    // igual, y mostrar el de uno sería prometer el de otro.
    const uno = profIds.length === 1 ? profIds[0] : null;
    // Los adicionales (cejas, lavado…) no se reservan solos: van abajo, para sumar.
    return services.filter(s => s.isActive && !s.adicional && psIds.has(s.id)).map(s => {
      const ps = uno ? professionalServices.find(p => p.professionalId === uno && p.serviceId === s.id) : null;
      return { ...s, finalPrice: ps?.customPrice || s.price, finalDuration: ps?.customDuration || s.durationMinutes };
    }).sort(enOrden);
  }, [services, professionalServices, profIds]);

  return (
    <div>
      <h2 className="booking-step-title">Elegí un servicio</h2>
      <p className="booking-step-subtitle">Servicios disponibles</p>
      <div className="services-list">
        {available.map((service) => (
          <div
            key={service.id}
            className={`card card-selectable service-card ${tieneVentana(service) ? 'service-promo' : ''} ${selectedId === service.id ? 'card-selected' : ''}`}
            onClick={() => onSelect(service.id)}
          >
            <div className="service-info">
              {/* Las promos se destacan con el color de la barbería: es lo
                  que el barbero quiere que se lleven. */}
              {tieneVentana(service) && <span className="service-promo-etiqueta">🔥 Promo</span>}
              <h3>{service.name}</h3>
              <p>{service.description}</p>
              {tieneVentana(service) && (
                <span className="service-promo-ventana">
                  {describirVentana(service)}
                </span>
              )}
              {incluido(service.id) && (
                <span className="badge badge-success" style={{ marginTop: 6, display: 'inline-block' }}>
                  🪪 Incluido en tu membresía
                </span>
              )}
            </div>
            <div className="service-meta">
              <div className="service-price">{formatPrice(service.finalPrice, currency)}</div>
              <div className="service-duration">⏱ {service.finalDuration} min</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- ADICIONALES ----
// Cejas, lavado, café, mascarilla: se suman al servicio elegido y al precio.
// No son un turno aparte ni agregan tiempo (se hacen durante el corte).
function AdicionalesSelect({ adicionales, elegidos, onCambiar, currency }) {
  if (adicionales.length === 0) return null;
  const alternar = (id) => onCambiar(elegidos.includes(id) ? elegidos.filter((x) => x !== id) : [...elegidos, id]);
  return (
    <div className="adicionales-reserva">
      <h3>¿Querés agregar algo?</h3>
      <p className="text-sm text-secondary">Se hace en el mismo turno y se suma al precio.</p>
      <div className="adicionales-lista">
        {adicionales.map((a) => (
          <label key={a.id} className={`adicional-opcion ${elegidos.includes(a.id) ? 'activa' : ''}`}>
            <input type="checkbox" checked={elegidos.includes(a.id)} onChange={() => alternar(a.id)} />
            <span className="adicional-nombre">{a.name}</span>
            <span className="adicional-precio">+ {formatPrice(a.price, currency)}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

// ---- PRODUCTOS ----
// La cera, el shampoo, la pomada: mercadería, no trabajo. No agregan tiempo al
// turno y se pagan en el local junto con el corte.
//
// Con cantidad y no con un casillero como los adicionales: de un adicional se
// pide uno (nadie pide dos lavados), de una cera se pueden pedir dos.
//
// El "+" se apaga en la última unidad. Es a propósito y no es decoración: el
// servidor igual lo rechazaría, pero recién después de que el cliente eligió
// día y horario y apretó Confirmar, y ahí ya le arruinamos la reserva por algo
// que se sabía antes.
function ProductosSelect({ productos, seleccion, onCambiar, currency }) {
  if (!productos.length) return null;

  const cambiar = (id, delta, tope) => {
    const actual = Number(seleccion[id]) || 0;
    const nueva = Math.max(0, Math.min(actual + delta, tope));
    const copia = { ...seleccion };
    if (nueva === 0) delete copia[id];
    else copia[id] = nueva;
    onCambiar(copia);
  };

  return (
    <div className="productos-reserva">
      <h3>¿Te llevás algo?</h3>
      <p className="text-sm text-secondary">
        Lo pagás en la barbería, junto con el turno. No te cambia el horario.
      </p>
      <div className="productos-lista">
        {productos.map((p) => {
          const cantidad = Number(seleccion[p.id]) || 0;
          const tope = maximoAPedir(p);
          const quedan = stockDe(p);
          return (
            <div key={p.id} className={`producto-opcion ${cantidad > 0 ? 'activa' : ''}`}>
              {p.imagenUrl
                ? <img src={p.imagenUrl} alt="" className="producto-foto" />
                : <span className="producto-foto producto-miniatura-vacia">🧴</span>}
              <div className="producto-datos">
                <span className="producto-nombre">{p.name}</span>
                {p.descripcion && <span className="producto-desc">{p.descripcion}</span>}
                <span className="producto-precio">{formatPrice(p.price, currency)}</span>
                {quedan !== null && quedan <= STOCK_BAJO && (
                  <span className="producto-ultimas">
                    {quedan === 1 ? 'Queda 1' : `Quedan ${quedan}`}
                  </span>
                )}
              </div>
              <div className="producto-cantidad">
                <button type="button" className="btn btn-outline btn-sm"
                  disabled={cantidad === 0} aria-label={`Quitar ${p.name}`}
                  onClick={() => cambiar(p.id, -1, tope)}>−</button>
                <span className="producto-numero">{cantidad}</span>
                <button type="button" className="btn btn-outline btn-sm"
                  disabled={cantidad >= tope} aria-label={`Agregar ${p.name}`}
                  onClick={() => cambiar(p.id, 1, tope)}>＋</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- CUÁNTOS TURNOS ----
// El que viene con alguien (un padre con el hijo) saca dos turnos seguidos del
// mismo servicio: el suyo y el que le sigue. No se calcula el tiempo de la otra
// persona: si el turno siguiente está libre, es suyo; si no, ese horario no se
// ofrece y elige otro. Dos es el máximo.
//
// Por dentro es el mismo `acompanante` que ya valida createAppointment, con el
// servicio del titular: un solo cupo del tope de turnos y un solo cobro.
function CantidadTurnos({ dos, onCambiar, service, currency }) {
  return (
    <div className="card mb-md" style={{ textAlign: 'left' }}>
      <strong>¿Cuántos turnos querés?</strong>
      <label className="pago-opcion">
        <input type="radio" name="cantidad-turnos" checked={!dos} onChange={() => onCambiar(false)} />
        <span><strong>1 turno</strong></span>
      </label>
      <label className="pago-opcion">
        <input type="radio" name="cantidad-turnos" checked={dos} onChange={() => onCambiar(true)} />
        <span>
          <strong>2 turnos seguidos</strong>
          <div className="text-sm text-secondary">
            Si venís con alguien: el segundo es el que sigue al tuyo
            {service ? ` (+ ${formatPrice(Number(service.price) || 0, currency)})` : ''}.
            Solo te mostramos los horarios que tienen el siguiente libre.
          </div>
        </span>
      </label>
    </div>
  );
}

// ---- DATE PICKER ----
function DatePicker({ selectedDate, onSelect, profIds = [], schedules: allSchedules, businessHours, service, ausencias = [] }) {
  const [viewDate, setViewDate] = useState(() => {
    if (selectedDate) return new Date(selectedDate + 'T00:00:00');
    return new Date();
  });

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
  const today = toDateString(new Date());

  const days = [];
  for (let i = 0; i < startOffset; i++) days.push(null);
  for (let d = 1; d <= lastDay.getDate(); d++) days.push(d);

  const prevMonth = () => setViewDate(new Date(year, month - 1, 1));
  const nextMonth = () => setViewDate(new Date(year, month + 1, 1));

  return (
    <div>
      <h2 className="booking-step-title">Elegí una fecha</h2>
      <p className="booking-step-subtitle">
        {tieneVentana(service) ? `${service.name}: ${describirVentana(service).toLowerCase()}` : 'Seleccioná el día de tu turno'}
      </p>
      <div className="calendar">
        <div className="calendar-header">
          <button className="calendar-nav" onClick={prevMonth}>◀</button>
          <h3>{getMonthName(month)} {year}</h3>
          <button className="calendar-nav" onClick={nextMonth}>▶</button>
        </div>
        <div className="calendar-grid">
          {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(d => (
            <div key={d} className="calendar-day-header">{d}</div>
          ))}
          {days.map((day, idx) => {
            if (day === null) return <div key={`empty-${idx}`} className="calendar-day empty" />;
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const isPastDate = dateStr < today;
            // Con "Cualquiera", alcanza con que trabaje UNO.
            const works = profIds.some((pid) => professionalWorksOnDate(pid, dateStr, allSchedules, businessHours, ausencias))
              && servicioAplicaAlDia(service, dateStr);
            const isSelected = dateStr === selectedDate;
            const isToday = dateStr === today;

            return (
              <button
                key={dateStr}
                className={`calendar-day ${isSelected ? 'selected' : ''} ${isToday ? 'today' : ''}`}
                disabled={isPastDate || !works}
                onClick={() => onSelect(dateStr)}
              >
                {day}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---- TIME SLOT GRID ----
function TimeSlotGrid({ slots, selectedSlot, onSelect, date, cargando, destacar = null }) {
  const morning = slots.filter(s => parseInt(s.startTime.split(':')[0]) < 13);
  const afternoon = slots.filter(s => parseInt(s.startTime.split(':')[0]) >= 13);

  if (cargando) {
    return (
      <div>
        <h2 className="booking-step-title">Horarios disponibles</h2>
        <p className="booking-step-subtitle">{formatDate(date)}</p>
        <div className="empty-state">
          <p>Buscando horarios libres…</p>
        </div>
      </div>
    );
  }

  if (slots.length === 0) {
    return (
      <div>
        <h2 className="booking-step-title">Horarios disponibles</h2>
        <p className="booking-step-subtitle">{formatDate(date)}</p>
        <div className="empty-state">
          <div className="empty-state-icon">📅</div>
          <p>No hay horarios disponibles para este día</p>
          <p className="text-sm text-muted mt-sm">Probá seleccionando otra fecha</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="booking-step-title">Elegí un horario</h2>
      <p className="booking-step-subtitle">{formatDate(date)}</p>
      <div className="timeslots-container">
        {morning.length > 0 && (
          <div className="timeslots-section">
            <h3>Mañana</h3>
            <div className="timeslots-grid">
              {morning.map(slot => (
                <button
                  key={slot.startTime}
                  className={`timeslot ${selectedSlot?.startTime === slot.startTime ? 'selected' : ''} ${destacar?.(slot) ? 'timeslot-promo' : ''}`}
                  onClick={() => onSelect(slot)}
                  aria-label={destacar?.(slot) ? `${slot.startTime}, ${destacar(slot)}` : undefined}
                >
                  {slot.startTime}
                  {destacar?.(slot) && <span className="timeslot-promo-texto" aria-hidden="true">{destacar(slot)}</span>}
                </button>
              ))}
            </div>
          </div>
        )}
        {afternoon.length > 0 && (
          <div className="timeslots-section">
            <h3>Tarde</h3>
            <div className="timeslots-grid">
              {afternoon.map(slot => (
                <button
                  key={slot.startTime}
                  className={`timeslot ${selectedSlot?.startTime === slot.startTime ? 'selected' : ''} ${destacar?.(slot) ? 'timeslot-promo' : ''}`}
                  onClick={() => onSelect(slot)}
                  aria-label={destacar?.(slot) ? `${slot.startTime}, ${destacar(slot)}` : undefined}
                >
                  {slot.startTime}
                  {destacar?.(slot) && <span className="timeslot-promo-texto" aria-hidden="true">{destacar(slot)}</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- PERSONAL INFO (solo teléfono — nombre y email vienen de Google) ----

/**
 * ¿Parece un teléfono? Se cuentan solo los dígitos: "+54 9 11 1234-5678" y
 * "1123456789" son los dos válidos. Entre 10 y 13 cubre un número argentino
 * con o sin código de país. La function lo vuelve a validar del lado del
 * servidor; esto es para que el error se vea antes de mandar.
 */
const VOLVER_DEL_LOGIN = 'barberos:volverAlPaso5';

function telefonoValido(tel) {
  const digitos = String(tel || '').replace(/\D/g, '');
  return digitos.length >= 10 && digitos.length <= 13;
}

function PersonalInfoStep({ user, phone, onPhoneChange }) {
  const tocado = phone.length > 0;
  const valido = telefonoValido(phone);
  return (
    <div>
      <h2 className="booking-step-title">Tu número de teléfono</h2>
      <p className="booking-step-subtitle">Solo necesitamos tu móvil para confirmar la reserva</p>

      <div className="card" style={{ marginBottom: 'var(--space-lg)', display: 'flex', alignItems: 'center', gap: 'var(--space-md)', padding: 'var(--space-md)' }}>
        {user.avatarUrl
          ? <img src={user.avatarUrl} alt={user.name} style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover' }} />
          : <div className="avatar avatar-md">{user.name.split(' ').map(n => n[0]).join('')}</div>
        }
        {/* minWidth 0: sin esto un mail largo no se corta y empuja la fila
            (y la página entera) fuera de los 375 px del celular. */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{user.name}</div>
          <div className="text-sm text-secondary" style={{ overflowWrap: 'anywhere' }}>{user.email}</div>
        </div>
        <span className="badge badge-success" style={{ flexShrink: 0 }}>✓ Verificado</span>
      </div>

      <div className="personal-form">
        <div className="form-group">
          <label className="form-label">Teléfono móvil <span className="required">*</span></label>
          <input
            className="form-input"
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={e => onPhoneChange(e.target.value)}
            placeholder="+54 11 1234-5678"
            autoFocus
            style={tocado && !valido ? { borderColor: 'var(--danger)' } : undefined}
          />
          {tocado && !valido && (
            <p className="text-xs" style={{ color: 'var(--danger)', marginTop: 4 }}>
              Ingresá el número con código de área, por ejemplo 11 1234-5678.
            </p>
          )}
          <p className="text-xs text-muted" style={{ marginTop: 4 }}>
            Es por donde te va a contactar la barbería si hace falta.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Los premios que trajo `misRecompensas` más los que ganó recién en la ruleta
 * (sin repetir): el recién ganado tiene que poder elegirse sin volver a pedir
 * todo al servidor.
 */
function juntarPremios(ganados, delServidor = []) {
  return [...ganados, ...(delServidor || []).filter((p) => !ganados.some((g) => g.id === p.id))];
}

// ---- SUMMARY ----
function BookingSummary({ professional, service, date, timeSlot, price, precioLista, currency, clientName, clientPhone, conMembresia = false, adicionales = [], productos = [], acompanante = null, recargoTarjeta = 0, beneficio = null }) {
  return (
    <div>
      <h2 className="booking-step-title">Confirmar tu reserva</h2>
      <p className="booking-step-subtitle">Revisá los datos antes de confirmar</p>
      <div className="booking-summary">
        <div className="summary-card">
          <div className="summary-header">
            <div className="avatar avatar-lg" style={{ margin: '0 auto var(--space-sm)', overflow: 'hidden' }}>
              {professional.avatarUrl ? <img src={professional.avatarUrl} alt={professional.name} /> : professional.name.split(' ').map(n => n[0]).join('')}
            </div>
            <h3>{professional.name}</h3>
            <p className="text-sm" style={{ opacity: 0.8 }}>{professional.specialty}</p>
          </div>
          <div className="summary-body">
            <div className="summary-row">
              <span className="summary-label">✂️ Servicio</span>
              <span className="summary-value">{service.name}</span>
            </div>
            {adicionales.length > 0 && (
              <div className="summary-row">
                <span className="summary-label">➕ Adicionales</span>
                <span className="summary-value">{adicionales.map((a) => a.name).join(', ')}</span>
              </div>
            )}
            {productos.length > 0 && (
              <div className="summary-row">
                <span className="summary-label">🧴 Te llevás</span>
                <span className="summary-value">
                  {productos.map((x) => (x.cantidad > 1 ? `${x.cantidad}× ${x.name}` : x.name)).join(', ')}
                </span>
              </div>
            )}
            {acompanante && (
              <div className="summary-row">
                <span className="summary-label">👥 Turnos</span>
                <span className="summary-value">2 seguidos · + {formatPrice(acompanante.price, currency)}</span>
              </div>
            )}
            {beneficio && (
              <div className="summary-row">
                <span className="summary-label">{beneficio.icono} {beneficio.titulo}</span>
                <span className="summary-value">{beneficio.texto}</span>
              </div>
            )}
            {recargoTarjeta > 0 && (
              <div className="summary-row">
                <span className="summary-label">💳 Tarjeta o QR</span>
                <span className="summary-value">+ {formatPrice(recargoTarjeta, currency)}</span>
              </div>
            )}
            <div className="summary-row">
              <span className="summary-label">📅 Fecha</span>
              <span className="summary-value">{formatDate(date)}</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">🕐 Horario</span>
              <span className="summary-value">{timeSlot.startTime} — {timeSlot.endTime}</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">⏱ Duración</span>
              <span className="summary-value">{(service.finalDuration || service.durationMinutes) + (acompanante ? acompanante.durationMinutes : 0)} min</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">💰 Total</span>
              <span className="summary-value">
                {precioLista != null && precioLista !== price && (
                  <span className="cupon-tachado" style={{ marginRight: 6 }}>{formatPrice(precioLista, currency)}</span>
                )}
                {conMembresia
                  ? (price > 0 ? `Membresía + ${formatPrice(price, currency)}` : 'Incluido en tu membresía')
                  : formatPrice(price, currency)}
              </span>
            </div>
            <div className="summary-row" style={{ borderTop: '1px solid var(--border-color)', marginTop: 'var(--space-sm)', paddingTop: 'var(--space-sm)' }}>
              <span className="summary-label">👤 Cliente</span>
              <span className="summary-value">{clientName}</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">📱 Teléfono</span>
              <span className="summary-value">{clientPhone}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- AVISO: el negocio no puede tomar turnos ----
// 'frozen'    → cuenta suspendida por falta de pago
// 'not-ready' → cuenta nueva, todavía sin profesionales o sin servicios
function BookingUnavailable({ reason, business }) {
  const isFrozen = reason === 'frozen';
  return (
    <div className="booking-container" style={{ textAlign: 'center', padding: 'var(--space-xl) var(--space-md)' }}>
      <div
        className="card"
        style={{
          padding: 'var(--space-xl)',
          maxWidth: 500,
          margin: '0 auto',
          borderTop: isFrozen ? '4px solid var(--danger)' : '4px solid var(--primary)',
        }}
      >
        <div style={{ fontSize: 60, marginBottom: 'var(--space-md)' }}>{isFrozen ? '❄️' : '🛠️'}</div>
        <h2 style={{ marginBottom: 'var(--space-md)', color: isFrozen ? 'var(--danger)' : 'inherit' }}>
          {isFrozen ? 'Reservas suspendidas' : 'Todavía no hay turnos disponibles'}
        </h2>
        <p className="text-secondary" style={{ marginBottom: 'var(--space-lg)', lineHeight: 1.5 }}>
          {isFrozen
            ? <>Las reservas online de <strong>{business.name}</strong> están temporalmente suspendidas.</>
            : <><strong>{business.name}</strong> está terminando de configurar su agenda online. Volvé a entrar en un rato.</>}
        </p>
        {business.phone && (
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Si necesitás un turno ahora, escribiles al <strong>{business.phone}</strong>.
          </p>
        )}
      </div>
    </div>
  );
}

// ============================================
// BOOKING PAGE (Main Component)
// ============================================

export default function BookingPage() {
  const { booking, dispatch } = useBooking();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [reservando, setReservando] = useState(false);
  // Con seña opcional, el cliente elige cómo paga. Arranca con la seña marcada
  // porque es lo que le conviene a la barbería, pero se puede cambiar.
  // 'sena' | 'total' | 'local'
  const [comoPaga, setComoPaga] = useState('sena');

  // Datos ya filtrados por el negocio del slug de la URL.
  const { professionals, services, professionalServices, schedules, appointments, ausencias, business, slug, businessId } =
    useTenant();

  // ¿Esta barbería es parte de una cuenta con varias sucursales? Si lo es, lo
  // primero es preguntarle al cliente a cuál va: cada local tiene su equipo, sus
  // servicios y sus horarios, y el link que le llegó puede ser el de otra.
  // El cupón del link. Se anota apenas se ve y se lee de ahí en adelante: la
  // query string no sobrevive al login ni al viaje a Mercado Pago, y el estado
  // de React tampoco (esa navegación desmonta la app entera).
  const [params, setParams] = useSearchParams();
  const [cupon, setCupon] = useState(null);
  // Los adicionales que sumó al servicio (ids). Se vacían si cambia de servicio
  // en el paso 2 (ver abajo), no a mitad del flujo.
  const [extras, setExtras] = useState([]);
  // Los productos elegidos: `{ idDelProducto: cantidad }`.
  const [prodElegidos, setProdElegidos] = useState({});
  // El catálogo se lee UNA vez, no con una suscripción: los productos llevan
  // foto adentro del documento, y dejarlos en la suscripción permanente los
  // bajaría en todas las pantallas del panel. Acá alcanza con leerlos al abrir
  // la reserva. Si la lectura falla, la sección no aparece y el turno se saca
  // igual: un producto que no se pudo leer no puede impedir reservar un corte.
  const [catalogo, setCatalogo] = useState([]);
  // Si saca 2 turnos seguidos. Se guarda junto con el barbero y el servicio con
  // los que se eligió: si cambia cualquiera de los dos, vuelve a 1 solo, sin un
  // setState dentro de un efecto.
  const [dosTurnos, setDosTurnos] = useState({ clave: null, dos: false });
  // Cómo paga en el local, si la barbería cobra recargo por tarjeta o QR.
  const [metodoPago, setMetodoPago] = useState('efectivo');

  // La membresía del cliente en esta cuenta (si tiene). Se pide una vez, cuando
  // ya entró: antes no hay a quién preguntarle. Es una vista previa; el que
  // decide es createAppointment.
  const [membresia, setMembresia] = useState(null);
  const [usarMembresia, setUsarMembresia] = useState(true);
  const uidCliente = user?.id || null;
  useEffect(() => {
    if (!uidCliente || !businessId) return;
    let vigente = true;
    miMembresia(businessId)
      .then((r) => { if (vigente) setMembresia(r.membresia || null); })
      .catch((err) => console.warn('[BookingPage] No se pudo leer la membresía:', err.message));
    return () => { vigente = false; };
  }, [uidCliente, businessId]);

  // ── Recompensas ──────────────────────────────────────────────────────────
  // Los premios del cliente y si tiene tirada de ruleta. Una llamada, cuando
  // ya entró y solo si la barbería tiene alguna campaña prendida (el espejo
  // público lo dice sin leer nada más). Vista previa; decide createAppointment.
  const campanas = business?.recompensas || {};
  const hayRecompensas = Object.keys(campanas).length > 0;
  const [recomp, setRecomp] = useState({ clave: null, r: null });
  const claveRecomp = `${businessId}|${uidCliente}`;
  useEffect(() => {
    if (!uidCliente || !businessId || !hayRecompensas) return undefined;
    let vigente = true;
    misRecompensas(businessId)
      .then((r) => { if (vigente) setRecomp({ clave: claveRecomp, r }); })
      .catch((err) => console.warn('[BookingPage] No se pudieron leer tus premios:', err.message));
    return () => { vigente = false; };
  }, [uidCliente, businessId, hayRecompensas, claveRecomp]);
  const datosRecomp = recomp.clave === claveRecomp ? recomp.r : null;
  // Los que ganó recién en la ruleta, sin volver a pedir todo.
  const [ganados, setGanados] = useState([]);
  const misPremios = juntarPremios(ganados, datosRecomp?.premios);
  // El premio elegido. Arranca con el que tocó "Usar" en Tus premios.
  const [premioElegido, setPremioElegido] = useState(() => (businessId ? premioRecordado(businessId) : null));
  const [ruletaCerrada, setRuletaCerrada] = useState(false);
  // Ya giró en esta visita (ganara o no): el servidor no le deja otra tirada,
  // así que la invitación se va. Es estado aparte del resultado a propósito:
  // si la apertura dependiera de "tiene tirada", ganar la cerraría en el acto
  // y el cliente no vería qué ganó.
  const [yaGiro, setYaGiro] = useState(false);
  const alJugar = useCallback(() => setYaGiro(true), []);
  const alGanar = useCallback((premio) => {
    setGanados((g) => [premio, ...g]);
    setPremioElegido(premio.id);
  }, []);

  const { sucursales, cargando: cargandoSucursales } = useSucursalesPublicas(business);
  const grupoId = business?.grupoId || null;
  // El link de una SUCURSAL entra directo a esa sucursal: el que lo abrió ya
  // eligió (para preguntar está el link de la cuenta, `/franlook`). El selector
  // aparece solo si toca "Cambiar de sucursal".
  const [yaEligio, setYaEligio] = useState(true);
  const { step, professionalId, serviceId, date, timeSlot, personalInfo } = booking;

  // Seña: solo si el dueño conectó Mercado Pago y la activó con un monto.
  const infoSena = business?.mpConectado === true && business?.sena?.activa === true && Number(business?.sena?.monto) > 0
    ? {
        monto: Number(business.sena.monto),
        opcional: business.sena.modo === 'opcional',
        permiteTotal: business.sena.permiteTotal === true,
      }
    : null;
  const senaOpcional = Boolean(infoSena?.opcional);
  // Hay algo que elegir si se puede pagar el total, o si se puede no pagar.
  const hayQueElegir = Boolean(infoSena) && (senaOpcional || infoSena.permiteTotal);

  // Motivos por los que este negocio no puede tomar turnos ahora mismo.
  // Se calcula acá pero se renderiza recién después de todos los hooks: cortar
  // el render antes rompe las reglas de hooks si el motivo cambia en vivo.
  const blockedReason = business?.isFrozen
    ? 'frozen'
    : (professionals.length === 0 || services.length === 0)
      ? 'not-ready'
      : null;

  // Check if user already has an appointment on this day
  const hasAppointmentToday = useMemo(() => {
    if (!user || !date) return false;
    return appointments.some(app => 
      app.userId === user.id && 
      app.appointmentDate === date &&
      // El estado es 'cancelada'. Con 'cancelado' (que no existe) la comparación
      // nunca era falsa, así que un turno ya cancelado seguía bloqueando la
      // reserva de otro el mismo día.
      app.status !== 'cancelada'
    );
  }, [user, date, appointments]);

  // Con "Cualquiera" todavía no hay a quién mostrar —lo elige el servidor al
  // confirmar—, pero el resumen tiene que poder pintarse igual. Sin esto el
  // paso 6 queda en blanco y la reserva no se puede terminar.
  const selectedProfessional = professionalId === CUALQUIERA
    ? { id: CUALQUIERA, name: 'Cualquiera', specialty: 'Te asignamos el primero que esté libre' }
    : professionals.find(p => p.id === professionalId);
  const selectedService = services.find(s => s.id === serviceId);

  // Get customized price
  const ps = professionalServices.find(p => p.professionalId === professionalId && p.serviceId === serviceId);
  const finalPrice = ps?.customPrice || selectedService?.price || 0;
  // Lo que de verdad va a pagar. Todo lo que muestra un total —el resumen, la
  // opción de pagar entero, el botón de confirmar— usa este, no `finalPrice`:
  // si no, el cliente ve el descuento en el desglose y el precio de lista en el
  // botón que tiene que apretar.
  // Con la membresía no paga nada acá: ni seña, ni total, ni cupón.
  const cobertura = coberturaDelServicio(membresia, { businessId, serviceId, fecha: date });
  const conMembresia = usarMembresia && Boolean(cobertura) && !cobertura.fueraDeFecha && cobertura.restantes !== 0;
  const adicionalesDisponibles = services.filter((s) => s.adicional && s.isActive !== false).sort(enOrden);
  const adicionalesElegidos = adicionalesDisponibles.filter((s) => extras.includes(s.id));
  const totalAdicionales = adicionalesElegidos.reduce((t, s) => t + (Number(s.price) || 0), 0);
  const claveTurnos = `${professionalId}|${serviceId}`;
  const sacaDos = dosTurnos.dos && dosTurnos.clave === claveTurnos;
  // El segundo turno es del mismo servicio: viaja como `acompanante` con el id
  // del servicio del titular.
  const acompServicio = sacaDos && selectedService && !selectedService.adicional ? selectedService : null;
  const acompId = acompServicio ? acompServicio.id : null;
  const acompDuracion = acompServicio ? Number(acompServicio.durationMinutes) || 0 : 0;
  // El servicio de la otra persona se paga siempre, igual que los adicionales:
  // la membresía y el cupón son del titular y cubren SU servicio.
  const totalAcompanante = acompServicio ? Number(acompServicio.price) || 0 : 0;
  // Los adicionales se pagan siempre: la membresía cubre el servicio y el cupón
  // descuenta el servicio, no los extras (igual que en el servidor).
  // Los productos se pagan SIEMPRE y enteros: la membresía cubre el servicio y
  // el cupón descuenta el servicio. Una membresía que además regalara la cera
  // sería la barbería regalando mercadería que compró. Igual que en el
  // servidor, que es el que manda.
  const productosDisponibles = useMemo(() => paraLaVenta(catalogo), [catalogo]);
  const productosDetalle = useMemo(
    () => detalleDeProductos(productosDisponibles, prodElegidos),
    [productosDisponibles, prodElegidos]
  );
  const totalProductos = totalDeProductos(productosDisponibles, prodElegidos);

  // Un beneficio por turno: membresía, cupón o premio, en ese orden de
  // precedencia (el que ya está puesto bloquea a los otros en pantalla). El
  // happy hour es automático y solo corre si no hay ninguno de los tres.
  // Mismo orden que createAppointment, que es el que manda.
  const hoyLocal = toDateString(new Date());
  // Un número de verdad: `finalPrice` sale del documento del servicio, y si se
  // le pasa tal cual a una función importada, el compilador de React supone
  // que lo puede mutar y deja de memoizar todo lo que depende del servicio.
  const precioBase = Number(finalPrice) || 0;
  const premioSel = misPremios.find((p) => p.id === premioElegido && p.estado === 'disponible') || null;
  const calcPremio = premioSel && !conMembresia && !cupon && premioUsableEn(premioSel, { fecha: date, hoy: hoyLocal }).usable
    ? calcularPremio(premioSel, { precio: precioBase, serviceId })
    : null;
  const conPremio = Boolean(calcPremio?.aplica);
  const cfgHappy = campanas.happyHour || null;
  const happy = !conMembresia && !cupon && !conPremio && timeSlot
    && enHappyHour(cfgHappy, { fecha: date, startTime: timeSlot.startTime, serviceId })
    ? descuentoHappyHour(cfgHappy, precioBase)
    : null;
  const precioServicio = conMembresia ? 0
    : cupon ? cupon.precioFinal
      : conPremio ? calcPremio.precioFinal
        : happy ? happy.precioFinal
          : finalPrice;
  const beneficio = conPremio
    ? { icono: premioSel.icono || '🎁', titulo: 'Premio', texto: premioSel.nombre }
    : happy && happy.descuento > 0
      ? { icono: '⏰', titulo: 'Happy hour', texto: `${cfgHappy.porcentaje}% menos` }
      : null;
  const precioSinRecargo = precioServicio
    + totalAdicionales + totalAcompanante + totalProductos;
  // Recargo por tarjeta o QR: solo si la barbería lo cobra, si hay algo que
  // pagar y si NO paga todo online (ahí no paga nada en el local).
  const montoRecargo = Number(business?.recargoTarjeta) || 0;
  const preguntaMetodo = montoRecargo > 0 && precioSinRecargo > 0;
  const recargoTarjeta = preguntaMetodo && metodoPago === 'tarjeta' ? montoRecargo : 0;
  const precioAPagar = precioSinRecargo + recargoTarjeta;
  // Tarjeta o QR con Mercado Pago conectado: se paga AHORA y entero (con el
  // recargo), y el turno queda pago. Mismo criterio que createAppointment.
  const tarjetaOnline = recargoTarjeta > 0 && Boolean(infoSena);
  // Con recargo, "pagar todo ahora" es el camino de la tarjeta: no hay otro.
  const ofreceTotal = Boolean(infoSena?.permiteTotal) && !(montoRecargo > 0);
  const finalDuration = ps?.customDuration || selectedService?.durationMinutes || 30;
  // La ruleta aparece sola al llegar a confirmar, una vez. Derivado, no un
  // efecto: si la cierra ("Ahora no"), queda el botón para abrirla otra vez.
  const tieneTirada = Boolean(campanas.ruleta && datosRecomp?.puede?.ruleta) && !yaGiro;
  const ruletaAbierta = step === 6 && !ruletaCerrada && (tieneTirada || yaGiro);

  // El cupón del link se anota y se saca de la URL. Sacarlo no es cosmética:
  // el cliente copia la dirección de la barra para mandársela a un amigo, y
  // así le manda su propio cupón de un uso. Queda anotado igual, en esta visita.
  // El catálogo de productos, una sola lectura por visita.
  useEffect(() => {
    if (!businessId) return;
    let vivo = true;
    obtenerSubcoleccion(businessId, 'productos')
      .then((ps) => { if (vivo) setCatalogo(ps || []); })
      // Sin cartel: la barbería que no vende nada tiene esta colección vacía, y
      // un error acá no puede frenar la reserva de un corte. Queda en la consola
      // para poder diagnosticarlo.
      .catch((e) => console.warn('no se pudieron leer los productos', e));
    return () => { vivo = false; };
  }, [businessId]);

  const codigoDelLink = params.get('cupon');
  useEffect(() => {
    if (!businessId || !codigoDelLink) return;
    recordarCupon(businessId, codigoDelLink);
    const limpios = new URLSearchParams(params);
    limpios.delete('cupon');
    setParams(limpios, { replace: true });
  }, [businessId, codigoDelLink, params, setParams]);

  const codigoGuardado = businessId ? cuponRecordado(businessId) : null;

  // Un servicio preseleccionado por el link de la promo ('?servicio=').
  const servicioDelLink = params.get('servicio');
  useEffect(() => {
    if (!servicioDelLink || serviceId) return;
    if (!services.some((x) => x.id === servicioDelLink)) return;
    dispatch({ type: 'SET_SERVICE', payload: servicioDelLink });
  }, [servicioDelLink, serviceId, services, dispatch]);

  // Lo que ya eligió queda guardado en su teléfono desde que elige el día y
  // la hora: si cierra la pestaña en el paso del login —creyendo que ya
  // reservó— al volver se le ofrece seguir donde estaba.
  useEffect(() => {
    if (!businessId || !professionalId || !serviceId || !date || !timeSlot) return;
    guardarPendiente({
      businessId, slug, professionalId, serviceId, date,
      startTime: timeSlot.startTime, endTime: timeSlot.endTime,
    });
  }, [businessId, slug, professionalId, serviceId, date, timeSlot]);

  // El aviso se muestra solo mientras no eligió nada en esta visita: apenas
  // retoma (o empieza de cero), se va solo.
  const [pendienteDescartado, setPendienteDescartado] = useState(false);
  const eligiendo = Boolean(professionalId || serviceId || date);
  const pendiente = useMemo(() => {
    if (!businessId || pendienteDescartado || eligiendo) return null;
    return leerPendiente(businessId);
  }, [businessId, pendienteDescartado, eligiendo]);

  const retomarPendiente = () => {
    if (!pendiente) return;
    dispatch({ type: 'SET_PROFESSIONAL', payload: pendiente.professionalId });
    dispatch({ type: 'SET_SERVICE', payload: pendiente.serviceId });
    dispatch({ type: 'SET_DATE', payload: pendiente.date });
    dispatch({ type: 'SET_TIMESLOT', payload: { startTime: pendiente.startTime, endTime: pendiente.endTime } });
    dispatch({ type: 'SET_STEP', payload: user ? 5 : 4 });
  };

  const descartarPendiente = () => {
    borrarPendiente();
    setPendienteDescartado(true);
  };

  // Volvió del login con el horario ya elegido: seguir al paso 5 solo, sin
  // pedirle que aprete "Siguiente" otra vez.
  useEffect(() => {
    if (!user || step !== 4 || !timeSlot) return;
    let volvio = false;
    try { volvio = sessionStorage.getItem(VOLVER_DEL_LOGIN) === '1'; sessionStorage.removeItem(VOLVER_DEL_LOGIN); } catch { /* nada */ }
    if (volvio) dispatch({ type: 'NEXT_STEP' });
  }, [user, step, timeSlot, dispatch]);

  // Con quién se calcula la grilla. Con "Cualquiera" son todos los que hacen
  // ese servicio: los horarios que ve el cliente son la UNIÓN de los de todos,
  // porque si uno está ocupado a las 10 y el otro no, las 10 están libres.
  const idsBase = useMemo(() => {
    const activos = professionals.filter((p) => p.isActive).map((p) => p.id);
    if (professionalId !== CUALQUIERA) return professionalId ? [professionalId] : [];
    if (!serviceId) return activos;
    const hacen = new Set(
      professionalServices.filter((ps) => ps.serviceId === serviceId).map((ps) => ps.professionalId)
    );
    return activos.filter((id) => hacen.has(id));
  }, [professionals, professionalServices, professionalId, serviceId]);

  // Con acompañante, solo sirven los que hacen LOS DOS servicios.
  const idsElegibles = useMemo(() => {
    if (!acompId) return idsBase;
    const hacen = new Set(
      professionalServices.filter((ps) => ps.serviceId === acompId).map((ps) => ps.professionalId)
    );
    return idsBase.filter((id) => hacen.has(id));
  }, [idsBase, professionalServices, acompId]);

  // Qué está ocupado ese día para ese profesional. No sale de `appointments`
  // del contexto: para un cliente esa lista trae SOLO sus propios turnos (las
  // Rules no le dejan ver los de los demás, y está bien), así que con ella la
  // grilla mostraría como libre lo que ya tomó otro y cada reserva moriría en
  // "ese horario ya fue tomado". Se le pide al servidor solo las horas.
  //
  // La respuesta se guarda junto con la clave que la pidió: si cambia el
  // profesional o el día, la que hay deja de valer sola, sin un setState
  // sincrónico en el efecto (que el compilador de React rechaza).
  const claveOcupados = `${businessId}|${idsElegibles.join(',')}|${date}`;
  const [ocupados, setOcupados] = useState({ clave: '', lista: [] });
  useEffect(() => {
    if (!businessId || !idsElegibles.length || !date) return;
    let vigente = true;
    // Una consulta por barbero elegible. Con uno elegido es la de siempre; con
    // "Cualquiera" son tantas como barberos hagan ese servicio, que es un
    // puñado. Cada respuesta se marca con SU profesional: el motor necesita
    // saber de quién es cada turno ocupado.
    Promise.all(idsElegibles.map((pid) =>
      getBusySlots({ businessId, professionalId: pid, appointmentDate: date })
        .then(({ ocupados }) => ocupados.map((o) => ({
          ...o, professionalId: pid, appointmentDate: date, status: 'confirmada',
        })))
    ))
      .then((porProfesional) => {
        if (!vigente) return;
        setOcupados({ clave: claveOcupados, lista: porProfesional.flat() });
      })
      .catch((err) => {
        console.error('[BookingPage] No se pudieron leer los horarios ocupados:', err);
        // Mejor una grilla optimista que ninguna: la transacción del servidor
        // sigue frenando el solapamiento.
        if (vigente) setOcupados({ clave: claveOcupados, lista: [] });
      });
    return () => { vigente = false; };
  }, [businessId, idsElegibles, date, claveOcupados]);
  const cargandoOcupados = ocupados.clave !== claveOcupados;

  // Calculate available slots
  const availableSlots = useMemo(() => {
    if (!idsElegibles.length || !serviceId || !date || cargandoOcupados) return [];
    const servicio = services.find((s) => s.id === serviceId);
    // Con acompañante el turno dura los dos servicios seguidos. El motor toma
    // la duración del servicio, así que se le pasa una copia con el total en
    // vez de tocarlo.
    const serviciosMotor = acompDuracion
      ? services.map((s) => (s.id === serviceId ? { ...s, durationMinutes: (Number(s.durationMinutes) || 0) + acompDuracion } : s))
      : services;
    const vinculosMotor = acompDuracion
      ? professionalServices.map((ps) => (ps.serviceId === serviceId && ps.customDuration
        ? { ...ps, customDuration: Number(ps.customDuration) + acompDuracion }
        : ps))
      : professionalServices;
    // La UNIÓN de los horarios de todos los elegibles, sin repetir. Si a las 10
    // uno está ocupado y el otro no, las 10 se ofrecen: quién la toma lo decide
    // el servidor al confirmar.
    const porHora = new Map();
    for (const pid of idsElegibles) {
      for (const slot of calculateAvailableSlots({
        professionalId: pid,
        serviceId,
        date,
        schedules,
        appointments: ocupados.lista,
        services: serviciosMotor,
        professionalServices: vinculosMotor,
        slotInterval: business.slotInterval,
        businessHours: business.businessHours,
        ausencias,
      })) {
        if (!porHora.has(slot.startTime)) porHora.set(slot.startTime, slot);
      }
    }
    return [...porHora.values()]
      .sort((a, b) => a.startMinutes - b.startMinutes)
      .filter((s) => servicioAplicaAlHorario(servicio, s.startTime)); // promo por franja
  }, [idsElegibles, serviceId, date, schedules, ocupados, cargandoOcupados, services, professionalServices, business, ausencias, acompDuracion]);

  // Paso cero: a qué sucursal va. Antes de elegir barbero, porque el equipo,
  // los servicios y los horarios son los de ESE local — y el link que le llegó
  // por Instagram puede ser el de otro.
  //
  // (Una sucursal suspendida no llega hasta acá: `TenantRoute` corta antes con
  // "no está tomando turnos". No es un problema en la práctica porque la
  // suspensión por deuda es de la cuenta entera: si cae una, caen las cuatro.)
  // Mientras se averigua si la cuenta tiene sucursales, no se pinta el paso 1:
  // si no, el cliente ve "elegí tu profesional" y medio segundo después se lo
  // reemplaza por "elegí tu sucursal". Misma razón por la que el link de una
  // barbería no muestra "no existe" hasta saberlo.
  if (grupoId && cargandoSucursales) {
    return (
      <div className="booking-container">
        <div className="empty-state" style={{ padding: 'var(--space-2xl)' }}><p>Cargando…</p></div>
      </div>
    );
  }

  const hayVariasSucursales = sucursales.length > 1;
  if (hayVariasSucursales && !yaEligio) {
    return (
      <div className="booking-container">
        <ElegirSucursal
          sucursales={sucursales}
          actualId={businessId}
          onElegir={(suc) => {
            recordarSucursal(grupoId, suc.id);
            if (suc.id === businessId) {
              setYaEligio(true);
            } else {
              // Cada sucursal tiene su propio link: navegar ahí deja la reserva
              // entera (equipo, servicios, horarios, agenda) apuntando al local
              // correcto, sin ningún caso especial en el medio.
              //
              // A `/reservar` y no a la raíz del slug: el que está acá ya decidió
              // que viene a sacar un turno, y la raíz puede ser la página de
              // presentación de esa sucursal. Volver a empezar sería un paso de
              // más que él no pidió.
              navigate(`/${suc.slug}/reservar`);
            }
          }}
        />
      </div>
    );
  }

  if (blockedReason) {
    return <BookingUnavailable reason={blockedReason} business={business} />;
  }

  const canGoNext = () => {
    switch (step) {
      case 1: return !!professionalId;
      case 2: return !!serviceId;
      case 3: return !!date && !hasAppointmentToday;
      case 4: return !!timeSlot;
      case 5: return telefonoValido(personalInfo.phone);
      default: return false;
    }
  };

  const handleNext = () => {
    if (step === 3 && hasAppointmentToday) {
      setError('Ya tenés un turno reservado para este día.');
      return;
    }
    // Hasta acá se puede mirar sin cuenta. Para poner sus datos y confirmar,
    // tiene que entrar. Lo elegido queda en BookingContext (vive en la raíz),
    // así que al volver del login sigue en el paso 5 con todo cargado.
    if (step === 4 && !user) {
      setError('');
      try { sessionStorage.setItem(VOLVER_DEL_LOGIN, '1'); } catch { /* sin storage, vuelve al paso 4 */ }
      navigate('/login', { state: { from: `/${slug}/reservar` } });
      return;
    }
    setError('');
    dispatch({ type: 'NEXT_STEP' });
  };

  const handleBack = () => {
    setError('');
    dispatch({ type: 'PREV_STEP' });
  };

  const handleConfirm = async () => {
    if (reservando) return;
    setReservando(true);
    setError('');

    const datos = {
      userId: user.id,
      clientName: user.name,
      clientEmail: user.email,
      clientPhone: personalInfo.phone,
      professionalId,
      serviceId,
      appointmentDate: date,
      startTime: timeSlot.startTime,
      endTime: timeSlot.endTime,
      price: finalPrice,
      notes: '',
      adminNotes: '',
    };

    try {
      // El turno se escribe en Firestore: desde este momento lo ve el barbero
      // en su panel, en su propio dispositivo.
      //
      // Va por la Cloud Function, que revalida todo del lado del servidor: el
      // motor de disponibilidad de acá arriba pinta la grilla, pero cualquiera
      // con la consola abierta lo saltea. El precio sale del servicio, no de
      // este formulario.
      const res = await createAppointment({
        pagar: tarjetaOnline ? 'total' : infoSena && !conMembresia ? (comoPaga === 'total' && !ofreceTotal ? 'sena' : comoPaga) : undefined,
        // Lo marcó el cliente. El servidor revalida y descuenta el uso.
        usarMembresia: conMembresia,
        businessId,
        professionalId,
        serviceId,
        appointmentDate: date,
        startTime: timeSlot.startTime,
        clientName: user.name,
        clientPhone: personalInfo.phone,
        clientEmail: user.email,
        // SOLO el código. El descuento lo recalcula el servidor sobre el precio
        // del documento del servicio; lo que se mostró acá es una vista previa.
        cuponCodigo: conMembresia || conPremio ? null : cupon?.codigo || null,
        // El premio elegido: solo el id. El servidor revalida y lo reserva.
        premioId: conPremio ? premioSel.id : null,
        adicionales: adicionalesElegidos.map((s) => s.id),
        // Solo ids y cantidades: el precio y el stock los resuelve el servidor.
        productos: seleccionParaElServidor(prodElegidos),
        acompanante: acompServicio ? { serviceId: acompServicio.id } : null,
        metodoPago: preguntaMetodo ? metodoPago : null,
      });
      const id = res.id;
      // A QUIÉN le tocó lo decidió el servidor. Con "Cualquiera" es la primera
      // vez que se sabe, así que sin esto la confirmación mostraría el
      // centinela y el cliente no se enteraría nunca de con quién va.
      if (res.professionalId) datos.professionalId = res.professionalId;
      datos.professionalName = res.professionalName || '';
      datos.price = res.price;
      datos.endTime = res.endTime;
      datos.membresia = res.membresia || null;
      datos.premio = res.premio || null;
      datos.happyHour = res.happyHour || null;
      datos.adicionales = adicionalesElegidos.map((s) => ({ id: s.id, name: s.name, price: s.price }));
      datos.acompanante = acompServicio
        ? { serviceId: acompServicio.id, name: acompServicio.name, price: acompServicio.price, durationMinutes: acompDuracion }
        : null;
      datos.recargoTarjeta = recargoTarjeta;
      datos.metodoPago = preguntaMetodo ? metodoPago : null;

      // Con seña, el turno queda GUARDADO (no reservado) y hay que ir a pagar.
      // Lo pendiente no se borra todavía: si abandona el pago, al volver le
      // ofrecemos retomarlo en vez de que pierda todo lo que eligió.
      if (res.status === 'esperando_pago' && res.pagoUrl) {
        window.location.assign(res.pagoUrl);
        return;
      }

      borrarPendiente();
      // El cupón ya se usó: que no se aplique solo en la reserva siguiente.
      olvidarCupon(businessId);
      olvidarPremio(businessId);
      dispatch({ type: 'RESET' });
      navigate(`/${slug}/confirmacion`, {
        state: { appointment: { ...datos, id, businessId, status: 'pendiente' } },
      });
    } catch (err) {
      console.error('[BookingPage] No se pudo reservar:', err);
      // La Cloud Function devuelve mensajes ya escritos para el cliente
      // ("Ese horario ya fue tomado. Elegí otro."), así que se muestran tal
      // cual en vez de envolverlos en otra frase.
      const esDeNegocio = [
        'functions/already-exists',
        'functions/failed-precondition',
        'functions/invalid-argument',
        'functions/not-found',
      ].includes(err.code);
      setError(
        esDeNegocio
          ? err.message
          : 'No se pudo confirmar la reserva. Actualizá la página e intentá de nuevo.'
      );
      setReservando(false);
    }
  };

  return (
    <div className="booking-container">
      {/* La barbería se presenta antes del primer paso: dónde queda, cómo
          llegar, cómo contactarla. */}
      {/* Vino por un link de promoción: que lo vea desde el primer paso, no
          recién al final. Es lo que lo hizo tocar el link. */}
      {codigoGuardado && step < 6 && (
        <div className="cupon-aviso">
          🎉 Tenés {cupon ? describirCupon(cupon) : 'un descuento'} con el código <strong>{codigoGuardado}</strong>
          <span className="cupon-aviso-nota">Se aplica al confirmar</span>
        </div>
      )}

      {/* En qué sucursal está reservando, con la puerta de salida a la vista:
          el que entró por el link equivocado se da cuenta acá y no cuando ya
          eligió día y hora. */}
      {step === 1 && hayVariasSucursales && (
        <div className="sucursal-elegida">
          <span>
            Reservando en <strong>{business.name}</strong>
            {business.address ? ` · ${business.address}` : ''}
          </span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => { olvidarSucursal(grupoId); setYaEligio(false); }}
          >
            Cambiar de sucursal
          </button>
        </div>
      )}

      {step === 1 && <FichaBarberia business={business} services={services} />}
      {/* "Me faltó confirmar": lo más probable es que se haya ido en el paso
          del login creyendo que el turno ya estaba. */}
      {pendiente && (
        <div className="notice notice-warn reserva-pendiente">
          <div>
            <strong>Te quedó un turno sin confirmar.</strong>{' '}
            {professionals.find((p) => p.id === pendiente.professionalId)?.name || 'Tu barbero'} ·{' '}
            {formatDate(pendiente.date)} a las {pendiente.startTime}.
            <div className="text-sm">Ese horario todavía no está reservado a tu nombre.</div>
          </div>
          <div className="reserva-pendiente-acciones">
            <button className="btn btn-primary btn-sm" onClick={retomarPendiente}>Seguir con ese turno</button>
            <button className="btn btn-ghost btn-sm" onClick={descartarPendiente}>Empezar de nuevo</button>
          </div>
        </div>
      )}

      <Stepper step={step} />

      {error && (
        <div className="badge badge-danger mb-md" style={{ display: 'block', textAlign: 'center', padding: '12px', borderRadius: '8px', fontSize: '14px' }}>
          {error}
        </div>
      )}

      {step === 1 && (
        <ProfessionalSelect
          professionals={professionals}
          selectedId={professionalId}
          onSelect={id => dispatch({ type: 'SET_PROFESSIONAL', payload: id })}
        />
      )}

      {step === 2 && (
        <ServiceSelect
          services={services}
          professionalServices={professionalServices}
          profIds={idsElegibles}
          selectedId={serviceId}
          onSelect={id => { if (id !== serviceId) setExtras([]); dispatch({ type: 'SET_SERVICE', payload: id }); }}
          currency={business.currency}
          incluido={(id) => Boolean(coberturaDelServicio(membresia, { businessId, serviceId: id }))}
        />
      )}

      {/* Los adicionales, recién cuando eligió el servicio al que se suman. */}
      {step === 2 && serviceId && (
        <AdicionalesSelect
          adicionales={adicionalesDisponibles}
          elegidos={extras}
          onCambiar={setExtras}
          currency={business.currency}
        />
      )}

      {/* Y los productos, en el mismo paso: ya eligió qué se va a hacer, y es
          el momento en que está pensando en lo que se lleva. Después, cuando
          está eligiendo horario, interrumpirlo con una vidriera es ruido. */}
      {step === 2 && serviceId && (
        <ProductosSelect
          productos={productosDisponibles}
          seleccion={prodElegidos}
          onCambiar={setProdElegidos}
          currency={business.currency}
        />
      )}

      {step === 3 && (
        <DatePicker
          selectedDate={date}
          onSelect={d => dispatch({ type: 'SET_DATE', payload: d })}
          profIds={idsElegibles}
          schedules={schedules}
          businessHours={business.businessHours}
          service={selectedService}
          ausencias={ausencias}
        />
      )}

      {step === 4 && selectedService && (
        <CantidadTurnos
          dos={sacaDos}
          service={selectedService}
          currency={business.currency}
          onCambiar={(dos) => {
            setDosTurnos({ clave: claveTurnos, dos });
            // El horario elegido puede no tener el siguiente libre: que vuelva a elegir.
            dispatch({ type: 'SET_TIMESLOT', payload: null });
          }}
        />
      )}

      {step === 4 && (
        <TimeSlotGrid
          slots={availableSlots}
          selectedSlot={timeSlot}
          onSelect={s => dispatch({ type: 'SET_TIMESLOT', payload: s })}
          date={date}
          cargando={cargandoOcupados}
          destacar={cfgHappy ? (slot) => (enHappyHour(cfgHappy, { fecha: date, startTime: slot.startTime, serviceId }) ? `⏰ -${cfgHappy.porcentaje}%` : null) : null}
        />
      )}

      {step === 5 && (
        <PersonalInfoStep
          user={user}
          phone={personalInfo.phone}
          onPhoneChange={phone => dispatch({ type: 'SET_PERSONAL_INFO', payload: { phone } })}
        />
      )}

      {step === 6 && (
        <div className="notice notice-warn" style={{ marginBottom: 'var(--space-md)' }}>
          ⏳ <strong>Falta un paso:</strong> tocá <strong>Confirmar Reserva</strong> acá abajo. Hasta entonces el horario no es tuyo.
        </div>
      )}

      {/* Cómo paga. Solo aparece si la barbería dejó elegir: si la seña es
          obligatoria no hay nada que decidir, y si no cobra seña tampoco. */}
      {/* La membresía, antes de cómo paga: si la usa, no paga nada. */}
      {step === 6 && selectedService && (
        <MembresiaEnReserva
          membresia={membresia}
          cobertura={cobertura}
          usar={usarMembresia}
          onUsar={setUsarMembresia}
        />
      )}

      {/* La ruleta: justo antes de confirmar, nunca después de pagar. Lo que
          gane queda elegido abajo y se ve en el total. */}
      {step === 6 && tieneTirada && (
        <div className="ruleta-invitacion">
          <span aria-hidden="true">🎡</span>
          <span><strong>¡Tenés una tirada!</strong> Girá la ruleta antes de confirmar.</span>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setRuletaCerrada(false)}>
            Girar
          </button>
        </div>
      )}
      {ruletaAbierta && (
        <RuletaJuego
          businessId={businessId}
          segmentos={campanas.ruleta.segmentos || []}
          onGanado={alGanar}
          onJugado={alJugar}
          onCerrar={() => setRuletaCerrada(true)}
        />
      )}

      {step === 6 && selectedService && (
        <PremioEnReserva
          premios={misPremios}
          elegido={conPremio ? premioSel.id : null}
          onElegir={setPremioElegido}
          serviceId={serviceId}
          fecha={date}
          hoy={hoyLocal}
          precio={finalPrice}
          currency={business.currency}
          services={services}
          bloqueadoPor={conMembresia ? 'tu membresía' : cupon ? `el cupón ${cupon.codigo}` : null}
        />
      )}

      {/* Cómo paga, cuando la barbería cobra recargo con tarjeta o QR: que lo
          vea ANTES de confirmar, no en el mostrador. Con Mercado Pago
          conectado, tarjeta = paga ya el total ahí y el turno queda pago. */}
      {step === 6 && preguntaMetodo && (
        <div className="card mb-md" style={{ textAlign: 'left' }}>
          <strong>¿Cómo vas a pagar?</strong>
          <label className="pago-opcion">
            <input type="radio" name="metodo" checked={metodoPago === 'efectivo'} onChange={() => setMetodoPago('efectivo')} />
            <span>
              <strong>Efectivo o transferencia</strong>
              <div className="text-sm text-secondary">En el local.</div>
            </span>
          </label>
          <label className="pago-opcion">
            <input type="radio" name="metodo" checked={metodoPago === 'tarjeta'} onChange={() => setMetodoPago('tarjeta')} />
            <span>
              <strong>Tarjeta o QR</strong>
              <div className="text-sm text-secondary">
                {infoSena
                  ? <>Pagás ahora el total por Mercado Pago y llegás con el turno pago. Incluye {formatPrice(montoRecargo, business.currency)} de recargo.</>
                  : <>En el local, con {formatPrice(montoRecargo, business.currency)} de recargo.</>}
              </div>
            </span>
          </label>
        </div>
      )}

      {step === 6 && tarjetaOnline && (
        <div className="notice notice-info" style={{ marginBottom: 'var(--space-md)' }}>
          💳 Vas a pagar <strong>{formatPrice(precioAPagar, business.currency)}</strong> ahora por Mercado Pago, con
          tarjeta o QR. No pagás nada en el local.
        </div>
      )}

      {step === 6 && hayQueElegir && !conMembresia && !tarjetaOnline && (senaOpcional || ofreceTotal) && (
        <div className="card mb-md" style={{ textAlign: 'left' }}>
          <strong>¿Cómo querés pagar?</strong>

          <label className="pago-opcion">
            <input type="radio" name="pago" checked={comoPaga === 'sena'} onChange={() => setComoPaga('sena')} />
            <span>
              <strong>Dejo una seña de {formatPrice(Math.min(infoSena.monto, precioAPagar), business.currency)}</strong>
              <div className="text-sm text-secondary">
                La pagás ahora por Mercado Pago y se te descuenta del total. El resto, en la barbería.
              </div>
            </span>
          </label>

          {ofreceTotal && (
            <label className="pago-opcion">
              <input type="radio" name="pago" checked={comoPaga === 'total'} onChange={() => setComoPaga('total')} />
              <span>
                <strong>Pago todo ahora: {formatPrice(precioAPagar, business.currency)}</strong>
                <div className="text-sm text-secondary">
                  Llegás con la cuenta saldada y no pagás nada en el local.
                </div>
              </span>
            </label>
          )}

          {senaOpcional && (
            <label className="pago-opcion">
              <input type="radio" name="pago" checked={comoPaga === 'local'} onChange={() => setComoPaga('local')} />
              <span>
                <strong>Pago todo en la barbería</strong>
                <div className="text-sm text-secondary">
                  Reservás sin pagar nada ahora. Si no vas, avisá con tiempo.
                </div>
              </span>
            </label>
          )}
        </div>
      )}

      {step === 6 && infoSena && !conMembresia && !tarjetaOnline && !(senaOpcional || ofreceTotal) && (
        <div className="notice notice-info" style={{ marginBottom: 'var(--space-md)' }}>
          💳 Esta barbería pide una seña de <strong>{formatPrice(infoSena.monto, business.currency)}</strong> para
          confirmar el turno. Se paga ahora por Mercado Pago y se descuenta del total.
        </div>
      )}

      {step === 6 && selectedProfessional && selectedService && (
        <BookingSummary
          professional={selectedProfessional}
          service={{ ...selectedService, finalDuration }}
          date={date}
          timeSlot={timeSlot}
          price={precioAPagar}
          precioLista={(cupon || conPremio || happy) && !conMembresia ? finalPrice : null}
          conMembresia={conMembresia}
          beneficio={beneficio}
          adicionales={adicionalesElegidos}
          productos={productosDetalle}
          acompanante={acompServicio ? { name: acompServicio.name, price: acompServicio.price, durationMinutes: acompDuracion } : null}
          recargoTarjeta={recargoTarjeta}
          currency={business.currency}
          clientName={user.name}
          clientPhone={personalInfo.phone}
        />
      )}

      {/* El cupón va DESPUÉS del resumen: primero que vea qué está reservando.
          Arranca cerrado, salvo que el cupón haya venido en el link. */}
      {step === 6 && selectedService && !conMembresia && !conPremio && (
        <CuponEnReserva
          businessId={businessId}
          serviceId={serviceId}
          professionalId={professionalId}
          precio={finalPrice}
          currency={business.currency}
          cupon={cupon}
          onCupon={setCupon}
          codigoDelLink={codigoGuardado}
        />
      )}

      <div className="booking-nav">
        {step > 1 ? (
          <button className="btn btn-outline" onClick={handleBack}>← Atrás</button>
        ) : <div />}

        {step < 6 ? (
          <button className="btn btn-primary" disabled={!canGoNext()} onClick={handleNext}>
            Siguiente →
          </button>
        ) : step === 6 ? (
          <button className="btn btn-primary btn-lg" onClick={handleConfirm} disabled={reservando}>
            {reservando
              ? 'Confirmando…'
              // Con membresía, el texto de siempre: el recuadro y el total ya
              // dicen que no se paga, y uno más largo no entra en 375 px.
              : tarjetaOnline
                ? `💳 Pagar ${formatPrice(precioAPagar, business.currency)}`
                : conMembresia || !infoSena || comoPaga === 'local'
                ? '✅ Confirmar Reserva'
                : comoPaga === 'total' && ofreceTotal
                  ? `💳 Pagar ${formatPrice(precioAPagar, business.currency)}`
                  : `💳 Pagar seña de ${formatPrice(Math.min(infoSena.monto, precioAPagar), business.currency)}`}
          </button>
        ) : null}
      </div>
    </div>
  );
}
