// ============================================
// Utilidades de Fechas
// ============================================

const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const DAYS_SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export function getDayName(dayOfWeek) {
  return DAYS[dayOfWeek];
}

export function getDayShort(dayOfWeek) {
  return DAYS_SHORT[dayOfWeek];
}

export function getMonthName(monthIndex) {
  return MONTHS[monthIndex];
}

// Convierte Date a day_of_week (0=Lunes, 6=Domingo)
export function getLocalDayOfWeek(date) {
  const d = date.getDay(); // 0=Domingo, 6=Sábado
  return d === 0 ? 6 : d - 1;
}

export function formatDate(dateStr) {
  const date = new Date(dateStr + 'T00:00:00');
  const day = date.getDate();
  const month = MONTHS[date.getMonth()];
  const year = date.getFullYear();
  const dayName = DAYS[getLocalDayOfWeek(date)];
  return `${dayName} ${day} de ${month}, ${year}`;
}

export function formatDateShort(dateStr) {
  const date = new Date(dateStr + 'T00:00:00');
  const day = date.getDate();
  const month = MONTHS[date.getMonth()].substring(0, 3);
  return `${day} ${month}`;
}

export function formatPrice(price, currency = 'ARS') {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
}

export function toDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addMinutes(timeStr, minutes) {
  const [h, m] = timeStr.split(':').map(Number);
  const totalMinutes = h * 60 + m + minutes;
  const newH = Math.floor(totalMinutes / 60);
  const newM = totalMinutes % 60;
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
}

export function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

export function isToday(dateStr) {
  return dateStr === toDateString(new Date());
}

export function isPast(dateStr) {
  const today = toDateString(new Date());
  return dateStr < today;
}

export function generateId() {
  return 'id-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9);
}
