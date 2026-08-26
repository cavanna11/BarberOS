import { useState } from 'react';
import { useBusiness } from '../../contexts/BusinessContext';
import { PLANS, DEFAULT_PLAN_ID, getPlan, DEFAULT_BUSINESS_HOURS } from '../../config/plans';
import { isPlatformOwner } from '../../config/platform';
import { slugify, isReservedSlug } from '../../utils/slug';
import { createBusiness, isSlugAvailable } from '../../lib/repository';
import { setBusinessAdmin } from '../../lib/functions';

// Onboarding manual: el cliente se contacta, se cierra la venta, y la cuenta se
// prepara desde acá. No hay registro self-service a propósito.

const EMPTY_FORM = {
  name: '',
  slug: '',
  slugEdited: false,
  ownerEmail: '',
  ownerName: '',
  phone: '',
  email: '',
  address: '',
  city: '',
  planId: DEFAULT_PLAN_ID,
  // Arranca con los colores de BarberOS; el cliente los cambia si tiene marca propia.
  primaryColor: '#e03d00',
  secondaryColor: '#ff5c1a',
  accentColor: '#ff5c1a',
  slotInterval: 30,
  minCancelHours: 2,
  welcomeMessage: 'Reservá tu turno en segundos',
  instagram: '',
  whatsapp: '',
};

/** Primer cobro un mes después del alta, para que no arranque con deuda. */
function nextMonthISO() {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().split('T')[0];
}

export default function NewBusinessModal({ onClose, onCreated }) {
  const { state } = useBusiness();
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [guardando, setGuardando] = useState(false);
  // Al crear, en vez de cerrar mostramos los datos para entregarle al cliente.
  const [created, setCreated] = useState(null);

  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  // El slug se genera del nombre hasta que el usuario lo edita a mano.
  const handleNameChange = (name) => {
    if (form.slugEdited) {
      set({ name });
    } else {
      set({ name, slug: slugify(name) });
    }
  };

  const handleSlugChange = (slug) => {
    set({ slug: slugify(slug), slugEdited: true });
  };

  const validate = async () => {
    const e = {};
    const email = form.ownerEmail.trim().toLowerCase();

    if (!form.name.trim()) e.name = 'Poné el nombre del negocio.';

    if (!form.slug) {
      e.slug = 'Hace falta un slug para la URL pública.';
    } else if (isReservedSlug(form.slug)) {
      e.slug = `"${form.slug}" es una ruta interna de la app. Elegí otro.`;
    } else if (!(await isSlugAvailable(form.slug))) {
      // Se consulta contra Firestore, no contra la lista en memoria: el slug es
      // la URL pública del cliente y no puede pisarse.
      e.slug = 'Ya hay un negocio con este slug.';
    }

    if (!email) {
      e.ownerEmail = 'Hace falta el Gmail del dueño para que pueda entrar.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      e.ownerEmail = 'Ese mail no parece válido.';
    } else if (isPlatformOwner(email)) {
      e.ownerEmail = 'Ese mail ya es dueño de la plataforma; no puede ser admin de un negocio.';
    } else if (
      state.authorizedAdmins.some((a) => a.email.toLowerCase() === email)
    ) {
      e.ownerEmail = 'Ese Gmail ya administra otro negocio.';
    }

    if (!form.ownerName.trim()) e.ownerName = 'Poné el nombre del dueño.';

    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (ev) => {
    ev.preventDefault();
    if (guardando) return;
    if (!(await validate())) return;

    const plan = getPlan(form.planId);
    const now = new Date().toISOString();

    // El id lo asigna Firestore al crear el documento.
    const business = {
      name: form.name.trim(),
      slug: form.slug,
      logoUrl: null,
      primaryColor: form.primaryColor,
      secondaryColor: form.secondaryColor,
      accentColor: form.accentColor,
      phone: form.phone.trim(),
      email: form.email.trim(),
      address: form.address.trim(),
      city: form.city.trim(),
      country: 'Argentina',
      currency: 'ARS',
      timezone: 'America/Argentina/Buenos_Aires',
      slotInterval: Number(form.slotInterval) || 30,
      minCancelHours: Number(form.minCancelHours) || 2,
      onlineBookingEnabled: true,
      welcomeMessage: form.welcomeMessage.trim(),
      socialLinks: {
        instagram: form.instagram.trim(),
        whatsapp: form.whatsapp.trim(),
      },
      // Público: la UI del negocio muestra el plan y su cuota de mensajes.
      planId: plan.id,
      whatsappQuota: plan.whatsappQuota,
      isFrozen: false,
      businessHours: DEFAULT_BUSINESS_HOURS.map((h) => ({ ...h })),
    };

    // Privado: la plata va en /businesses/{id}/private/billing, no en el
    // documento público. El doc público lo puede leer cualquier cliente.
    const billing = {
      planId: plan.id,
      monthlyFee: plan.monthlyFee,
      debt: 0,
      lastPaymentDate: null,
      nextBillingDate: nextMonthISO(),
    };

    const ownerAdmin = {
      email: form.ownerEmail.trim().toLowerCase(),
      name: form.ownerName.trim(),
      role: 'owner',
      professionalId: null,
      addedAt: now,
    };

    setGuardando(true);
    setErrors({});
    try {
      const businessId = await createBusiness({ business, billing, ownerAdmin });

      // El permiso REAL del dueño son los custom claims, y solo los escribe la
      // Cloud Function. `createBusiness` ya dejó el registro que muestra la UI,
      // así que si esto falla el negocio queda creado igual — pero el dueño no
      // va a poder entrar, y eso hay que decirlo en la pantalla de entrega en
      // vez de dejar que lo descubra el cliente.
      let claims = { ok: false, status: null, error: null };
      try {
        const res = await setBusinessAdmin({
          email: ownerAdmin.email,
          businessId,
          role: 'owner',
          name: ownerAdmin.name,
        });
        claims = { ok: true, status: res?.status ?? null, error: null };
      } catch (err) {
        console.error('[NewBusinessModal] No se pudieron asignar los permisos:', err);
        claims = { ok: false, status: null, error: err.message };
      }

      setCreated({ business: { ...business, id: businessId, ...billing }, ownerAdmin, claims });
    } catch (err) {
      console.error('[NewBusinessModal] No se pudo crear el negocio:', err);
      setErrors({
        general:
          err.code === 'permission-denied'
            ? 'Firestore rechazó la operación. Verificá que tu cuenta tenga el permiso de plataforma.'
            : `No se pudo crear la cuenta: ${err.message}`,
      });
    } finally {
      setGuardando(false);
    }
  };

  // ── Pantalla de entrega: qué pasarle al cliente ──────────────────────────
  if (created) {
    const publicUrl = `${window.location.origin}/${created.business.slug}`;
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
          <div className="modal-header">
            <h3>Cuenta creada</h3>
            <button className="modal-close" onClick={onClose}>✕</button>
          </div>
          <div className="modal-body">
            <p className="text-secondary" style={{ fontSize: 13, marginBottom: 'var(--space-md)' }}>
              <strong>{created.business.name}</strong> ya está activa. Esto es lo que
              tenés que pasarle al cliente:
            </p>

            <div className="form-group">
              <label className="form-label">Link público para sus clientes</label>
              <div
                className="form-input"
                style={{ background: 'var(--bg-secondary)', fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all' }}
              >
                {publicUrl}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Acceso al panel</label>
              <div className="form-input" style={{ background: 'var(--bg-secondary)', fontSize: 13 }}>
                Entra en <strong>/login</strong> con Google usando{' '}
                <strong>{created.ownerAdmin.email}</strong>
              </div>
              {created.claims?.ok && created.claims.status === 'pending' && (
                <p className="text-xs text-muted" style={{ marginTop: 4 }}>
                  Esa cuenta nunca entró a BarberOS. El permiso queda anotado y se
                  activa solo, en su primer login con Google.
                </p>
              )}
            </div>

            {!created.claims?.ok && (
              <div className="notice notice-warn">
                <strong>El dueño todavía no puede entrar.</strong> La cuenta y el
                link quedaron creados, pero no se le pudieron asignar los permisos:
                sin ellos, Firestore lo trata como un cliente más y el panel le va
                a aparecer vacío.
                <br />
                {created.claims?.error}
              </div>
            )}

            <div className="notice notice-info">
              <strong>Falta configurar</strong> antes de entregarla: cargar los
              profesionales con sus horarios y el catálogo de servicios. Sin eso
              el link público no puede tomar turnos.
              <br />
              Abono: {created.business.monthlyFee.toLocaleString('es-AR')} ARS/mes ·
              primer vencimiento {created.business.nextBillingDate}.
            </div>
          </div>
          <div className="modal-footer">
            <button className="btn btn-outline" onClick={onClose}>Cerrar</button>
            <button className="btn btn-primary" onClick={() => onCreated(created.business)}>
              Configurar ahora →
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Formulario de alta ───────────────────────────────────────────────────
  return (
    <div className="modal-overlay" onClick={onClose}>
      <form
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        style={{ maxWidth: 640 }}
      >
        <div className="modal-header">
          <h3>Nueva barbería</h3>
          <button type="button" className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {errors.general && (
            <div className="notice notice-danger" style={{ marginBottom: 'var(--space-md)' }}>
              {errors.general}
            </div>
          )}

          {/* Identidad */}
          <div className="form-group">
            <label className="form-label">Nombre del negocio <span className="required">*</span></label>
            <input
              className={`form-input ${errors.name ? 'error' : ''}`}
              value={form.name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Barbería Don José"
              autoFocus
            />
            {errors.name && <div className="form-error">{errors.name}</div>}
          </div>

          <div className="form-group">
            <label className="form-label">URL pública <span className="required">*</span></label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                /{''}
              </span>
              <input
                className={`form-input ${errors.slug ? 'error' : ''}`}
                value={form.slug}
                onChange={(e) => handleSlugChange(e.target.value)}
                placeholder="barberia-don-jose"
                style={{ margin: 0, fontFamily: 'monospace' }}
              />
            </div>
            {errors.slug
              ? <div className="form-error">{errors.slug}</div>
              : <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  Este es el link que el negocio le comparte a sus clientes. Se genera del nombre, podés cambiarlo.
                </div>}
          </div>

          {/* Dueño */}
          <h4 style={{ marginTop: 'var(--space-lg)', borderBottom: '1px solid var(--border-color)', paddingBottom: 6 }}>
            Dueño de la barbería
          </h4>
          <p className="text-secondary" style={{ fontSize: 12, marginBottom: 'var(--space-md)' }}>
            Tiene que ser una cuenta de Google: es con la que va a entrar al panel.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">Gmail <span className="required">*</span></label>
              <input
                className={`form-input ${errors.ownerEmail ? 'error' : ''}`}
                value={form.ownerEmail}
                onChange={(e) => set({ ownerEmail: e.target.value })}
                placeholder="donjose@gmail.com"
              />
              {errors.ownerEmail && <div className="form-error">{errors.ownerEmail}</div>}
            </div>
            <div className="form-group">
              <label className="form-label">Nombre <span className="required">*</span></label>
              <input
                className={`form-input ${errors.ownerName ? 'error' : ''}`}
                value={form.ownerName}
                onChange={(e) => set({ ownerName: e.target.value })}
                placeholder="José Pérez"
              />
              {errors.ownerName && <div className="form-error">{errors.ownerName}</div>}
            </div>
          </div>

          {/* Plan */}
          <h4 style={{ marginTop: 'var(--space-lg)', borderBottom: '1px solid var(--border-color)', paddingBottom: 6 }}>
            Plan contratado
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 'var(--space-md)' }}>
            {PLANS.map((plan) => (
              <label
                key={plan.id}
                className="card card-selectable"
                style={{
                  padding: '10px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  cursor: 'pointer',
                  border: form.planId === plan.id ? '2px solid var(--primary)' : '1px solid var(--border-color)',
                  margin: 0,
                }}
              >
                <input
                  type="radio"
                  name="planId"
                  checked={form.planId === plan.id}
                  onChange={() => set({ planId: plan.id })}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 'bold', fontSize: 13 }}>{plan.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {plan.description} · ${plan.monthlyFee.toLocaleString('es-AR')} ARS/mes
                  </div>
                </div>
              </label>
            ))}
          </div>

          {/* Contacto */}
          <h4 style={{ marginTop: 'var(--space-lg)', borderBottom: '1px solid var(--border-color)', paddingBottom: 6 }}>
            Datos del local
          </h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 'var(--space-md)' }}>
            <div className="form-group">
              <label className="form-label">Teléfono</label>
              <input
                className="form-input"
                value={form.phone}
                onChange={(e) => set({ phone: e.target.value })}
                placeholder="+54 11 1234-5678"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Email de contacto</label>
              <input
                className="form-input"
                value={form.email}
                onChange={(e) => set({ email: e.target.value })}
                placeholder="hola@barberia.com"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Dirección</label>
              <input
                className="form-input"
                value={form.address}
                onChange={(e) => set({ address: e.target.value })}
                placeholder="Av. Corrientes 1234"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Ciudad</label>
              <input
                className="form-input"
                value={form.city}
                onChange={(e) => set({ city: e.target.value })}
                placeholder="Buenos Aires"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Instagram</label>
              <input
                className="form-input"
                value={form.instagram}
                onChange={(e) => set({ instagram: e.target.value })}
                placeholder="@barberiadonjose"
              />
            </div>
            <div className="form-group">
              <label className="form-label">WhatsApp</label>
              <input
                className="form-input"
                value={form.whatsapp}
                onChange={(e) => set({ whatsapp: e.target.value })}
                placeholder="+5411..."
              />
            </div>
          </div>

          {/* Operación y marca */}
          <h4 style={{ marginTop: 'var(--space-lg)', borderBottom: '1px solid var(--border-color)', paddingBottom: 6 }}>
            Operación y marca
          </h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 'var(--space-md)' }}>
            <div className="form-group">
              <label className="form-label">Intervalo entre turnos (min)</label>
              <select
                className="form-input"
                value={form.slotInterval}
                onChange={(e) => set({ slotInterval: e.target.value })}
              >
                <option value={15}>15 minutos</option>
                <option value={30}>30 minutos</option>
                <option value={45}>45 minutos</option>
                <option value={60}>60 minutos</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Antelación mínima para cancelar (hs)</label>
              <input
                type="number"
                min="0"
                className="form-input"
                value={form.minCancelHours}
                onChange={(e) => set({ minCancelHours: e.target.value })}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Mensaje de bienvenida</label>
            <input
              className="form-input"
              value={form.welcomeMessage}
              onChange={(e) => set({ welcomeMessage: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Colores de marca</label>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              {[
                { key: 'primaryColor', label: 'Principal' },
                { key: 'secondaryColor', label: 'Secundario' },
                { key: 'accentColor', label: 'Acento' },
              ].map(({ key, label }) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                  <input
                    type="color"
                    value={form[key]}
                    onChange={(e) => set({ [key]: e.target.value })}
                    style={{ width: 40, height: 32, padding: 0, border: '1px solid var(--border-color)', borderRadius: 6, cursor: 'pointer' }}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div className="notice" style={{ marginTop: 'var(--space-md)' }}>
            Los horarios de atención arrancan de lunes a viernes de 9 a 20 y
            sábados de 9 a 18. Se ajustan después en Configuración, junto con los
            profesionales y los servicios.
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={guardando}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={guardando}>
            {guardando ? 'Creando…' : 'Crear cuenta'}
          </button>
        </div>
      </form>
    </div>
  );
}
