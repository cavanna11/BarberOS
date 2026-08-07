import { useState, useEffect } from 'react';

const STEPS_DATA = [
  {
    num: 1,
    title: 'Profesional',
    sub: 'Seleccioná tu barbero',
    actionText: 'Mateo seleccionado',
  },
  {
    num: 2,
    title: 'Servicio',
    sub: 'Elegí lo que querés hacerte',
    actionText: 'Corte + Barba',
  },
  {
    num: 3,
    title: 'Fecha',
    sub: 'Agosto 2026',
    actionText: 'Viernes 7 de Agosto',
  },
  {
    num: 4,
    title: 'Horario',
    sub: 'Slots disponibles',
    actionText: '10:15 hs',
  },
  {
    num: 5,
    title: '¡Listo!',
    sub: 'Reserva confirmada',
    actionText: 'Turno agendado',
  },
];

export default function HeroMotionMockup() {
  const [currentStep, setCurrentStep] = useState(4); // Default to Step 4 (Horario)
  const [isAutoPlaying, setIsAutoPlaying] = useState(true);
  const [showNotification, setShowNotification] = useState(false);

  // Auto-advance loop
  useEffect(() => {
    if (!isAutoPlaying) return;
    const interval = setInterval(() => {
      setCurrentStep((prev) => {
        const next = prev >= 5 ? 1 : prev + 1;
        if (next === 5) {
          setShowNotification(true);
        } else if (next === 1) {
          setShowNotification(false);
        }
        return next;
      });
    }, 3200);

    return () => clearInterval(interval);
  }, [isAutoPlaying]);

  const handleStepClick = (stepNum) => {
    setIsAutoPlaying(false);
    setCurrentStep(stepNum);
    if (stepNum === 5) {
      setShowNotification(true);
    }
  };

  return (
    <div className="landing-motion-container">
      {/* ── STAGE BACKDROP (DESKTOP BARBER DASHBOARD) ── */}
      <div className="landing-desktop-window">
        {/* Browser Top Bar */}
        <div className="landing-window-header">
          <div className="landing-window-dots">
            <span className="dot dot-red" />
            <span className="dot dot-yellow" />
            <span className="dot dot-green" />
          </div>
          <div className="landing-window-url">barberos.app/admin/dashboard</div>
          <div className="landing-window-badge">
            <span className="live-pulse" /> Panel en Vivo
          </div>
        </div>

        {/* Dashboard Content */}
        <div className="landing-desktop-body">
          {/* Header Bar */}
          <div className="landing-dash-head">
            <div>
              <h2 className="landing-dash-title">Hola, Mateo 👋</h2>
              <span className="landing-dash-date">Viernes 7 de Agosto · La Barbería Club</span>
            </div>
            <div className="landing-dash-actions">
              <span className="landing-badge-pending">⏳ 3 pendientes</span>
              <button className="landing-btn-walkin" type="button">
                ✂️ Servicio sin turno
              </button>
            </div>
          </div>

          {/* New Appointment Toast Alert */}
          {showNotification && (
            <div className="landing-dash-toast animate-slide-down">
              <div className="toast-icon">✨</div>
              <div>
                <strong>¡Nuevo turno ingresado desde el link!</strong>
                <p>Santiago Rossi · Corte + Barba · 10:15 hs</p>
              </div>
              <span className="toast-badge">RESERVADO ONLINE</span>
            </div>
          )}

          {/* Stats Bar */}
          <div className="landing-dash-stats">
            <div className="dash-stat-card">
              <span className="stat-label">TURNOS HOY</span>
              <span className="stat-val">{showNotification ? '9 confirmados' : '8 confirmados'}</span>
            </div>
            <div className="dash-stat-card">
              <span className="stat-label">RECAUDACIÓN</span>
              <span className="stat-val">{showNotification ? '$127.000' : '$112.000'}</span>
            </div>
            <div className="dash-stat-card">
              <span className="stat-label">ASISTENCIA</span>
              <span className="stat-val text-success">96%</span>
            </div>
          </div>

          {/* Appointments Table */}
          <div className="landing-dash-table-card">
            <div className="table-header">
              <h3>📋 Agenda del Día</h3>
              <span className="text-xs text-muted">Actualizado en tiempo real</span>
            </div>

            <div className="table-rows">
              {/* Highlighted Row (Santiago Rossi at 10:15) */}
              <div className={`table-row row-active ${currentStep === 4 || currentStep === 5 ? 'row-highlight' : ''}`}>
                <div className="row-time">
                  <strong>10:15</strong>
                  <span className="row-dur">45 min</span>
                </div>
                <div className="row-client">
                  <strong>Santiago Rossi</strong>
                  <span>Corte + Perfilado de Barba</span>
                </div>
                <div className="row-price">$15.000</div>
                <div className="row-status">
                  <span className="badge-status status-confirmed">• CONFIRMADO</span>
                </div>
              </div>

              {/* Row 2 */}
              <div className="table-row">
                <div className="row-time">
                  <strong>11:00</strong>
                  <span className="row-dur">30 min</span>
                </div>
                <div className="row-client">
                  <strong>Gonzalo Pérez</strong>
                  <span>Corte Clásico</span>
                </div>
                <div className="row-price">$12.000</div>
                <div className="row-status">
                  <span className="badge-status status-confirmed">• CONFIRMADO</span>
                </div>
              </div>

              {/* Row 3 */}
              <div className="table-row">
                <div className="row-time">
                  <strong>11:45</strong>
                  <span className="row-dur">45 min</span>
                </div>
                <div className="row-client">
                  <strong>Lucas Méndez</strong>
                  <span>Servicio Completo Premium</span>
                </div>
                <div className="row-price">$18.000</div>
                <div className="row-status">
                  <span className="badge-status status-pending">• PENDIENTE</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── 3D FOREGROUND SMARTPHONE MOCKUP ── */}
      <div className="landing-phone-3d-wrapper">
        <div className="landing-phone-frame">
          {/* Hardware elements */}
          <div className="phone-island" />
          <div className="phone-speaker" />

          {/* Screen Content */}
          <div className="phone-screen">
            {/* App Header */}
            <div className="phone-header">
              <div className="phone-brand">LA BARBERÍA</div>
              <div className="phone-url">barberos.app/labarberia</div>
            </div>

            {/* Stepper Indicator */}
            <div className="phone-stepper">
              {STEPS_DATA.map((s) => {
                const isCompleted = s.num < currentStep;
                const isActive = s.num === currentStep;
                return (
                  <button
                    key={s.num}
                    type="button"
                    className={`stepper-dot ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}`}
                    onClick={() => handleStepClick(s.num)}
                    title={s.title}
                  >
                    {isCompleted ? '✓' : s.num}
                  </button>
                );
              })}
            </div>

            {/* Step View Container */}
            <div className="phone-step-content">
              {/* STEP 1: PROFESIONAL */}
              {currentStep === 1 && (
                <div className="step-view animate-fade-in">
                  <h3 className="step-title">Seleccioná tu profesional</h3>
                  <p className="step-sub">Elegí con quién querés atenderte</p>
                  
                  <div className="prof-grid">
                    <div className="prof-card selected">
                      <div className="prof-avatar">M</div>
                      <div>
                        <strong>Mateo Rossi</strong>
                        <span>Barbero Master · Disponible</span>
                      </div>
                      <span className="check-mark">✓</span>
                    </div>
                    <div className="prof-card">
                      <div className="prof-avatar">J</div>
                      <div>
                        <strong>Joaquín Vega</strong>
                        <span>Especialista en Barba</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 2: SERVICIO */}
              {currentStep === 2 && (
                <div className="step-view animate-fade-in">
                  <h3 className="step-title">Elegí un servicio</h3>
                  <p className="step-sub">Servicios con Mateo</p>
                  
                  <div className="service-list">
                    <div className="service-card selected">
                      <div>
                        <strong>Corte + Perfilado de Barba</strong>
                        <span>Incluye lavado y peinado</span>
                      </div>
                      <div className="service-meta">
                        <span className="service-price">$15.000</span>
                        <span className="service-dur">⏱ 45 min</span>
                      </div>
                    </div>
                    <div className="service-card">
                      <div>
                        <strong>Corte Clásico</strong>
                        <span>Tijera o máquina</span>
                      </div>
                      <div className="service-meta">
                        <span className="service-price">$12.000</span>
                        <span className="service-dur">⏱ 30 min</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 3: FECHA */}
              {currentStep === 3 && (
                <div className="step-view animate-fade-in">
                  <h3 className="step-title">Elegí una fecha</h3>
                  <p className="step-sub">Agosto 2026</p>
                  
                  <div className="mini-calendar">
                    <div className="cal-days-head">
                      <span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span>S</span><span>D</span>
                    </div>
                    <div className="cal-days-grid">
                      <span className="off">3</span>
                      <span className="off">4</span>
                      <span className="avail">5</span>
                      <span className="avail">6</span>
                      <span className="avail selected">7</span>
                      <span className="avail">8</span>
                      <span className="off">9</span>
                    </div>
                  </div>
                  <div className="selected-date-pill">📅 Viernes 7 de Agosto seleccionado</div>
                </div>
              )}

              {/* STEP 4: HORARIO */}
              {currentStep === 4 && (
                <div className="step-view animate-fade-in">
                  <h3 className="step-title">Elegí un horario</h3>
                  <p className="step-sub">Viernes 7 de Agosto con Mateo</p>
                  
                  <div className="slots-section">
                    <span className="slots-label">Mañana</span>
                    <div className="slots-grid">
                      <button type="button" className="slot-btn">09:30</button>
                      <button type="button" className="slot-btn selected">10:15</button>
                      <button type="button" className="slot-btn">11:00</button>
                      <button type="button" className="slot-btn">11:45</button>
                    </div>

                    <span className="slots-label">Tarde</span>
                    <div className="slots-grid">
                      <button type="button" className="slot-btn">15:00</button>
                      <button type="button" className="slot-btn">15:45</button>
                      <button type="button" className="slot-btn">16:30</button>
                      <button type="button" className="slot-btn">17:15</button>
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 5: CONFIRMACIÓN Y ÉXITO */}
              {currentStep === 5 && (
                <div className="step-view animate-fade-in text-center">
                  <div className="success-icon">🎉</div>
                  <h3 className="step-title">¡Turno Reservado!</h3>
                  <p className="step-sub">Te enviamos el recordatorio por WhatsApp</p>
                  
                  <div className="summary-box">
                    <div><strong>Cliente:</strong> Santiago Rossi</div>
                    <div><strong>Servicio:</strong> Corte + Barba</div>
                    <div><strong>Fecha:</strong> Vie 7 Ago · 10:15 hs</div>
                    <div><strong>Barbero:</strong> Mateo</div>
                  </div>
                </div>
              )}
            </div>

            {/* Phone Footer Action */}
            <div className="phone-footer">
              <button
                type="button"
                className="phone-primary-btn"
                onClick={() => handleStepClick(currentStep >= 5 ? 1 : currentStep + 1)}
              >
                {currentStep === 4
                  ? 'Confirmar Reserva →'
                  : currentStep === 5
                  ? 'Reservar otro turno'
                  : 'Siguiente paso →'}
              </button>
            </div>

            <div className="phone-home-indicator" />
          </div>
        </div>
      </div>
    </div>
  );
}
