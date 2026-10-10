import { useState } from 'react';
import { useBusiness } from '../../contexts/BusinessContext';
import { PLANS, DEFAULT_PLAN_ID, getPlan, DEFAULT_BUSINESS_HOURS, precioLindo } from '../../config/plans';
import { isPlatformOwner } from '../../config/platform';
import { slugify, isReservedSlug } from '../../utils/slug';
import { createBusiness, isSlugAvailable, guardarLinkDeCuenta } from '../../lib/repository';
import { setBusinessAdmin, createOwnerWithPassword, crearSucursal } from '../../lib/functions';
import PlanAMedida from '../../components/super-admin/PlanAMedida';
import { medidaDesdeNegocio, camposDeLaMedida } from '../../utils/planMedida';

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
  // El abono acordado, en pesos. Se propone el del plan cuando tiene precio de
  // lista; los planes nuevos todavía no lo tienen definido (y el Personalizado
  // nunca va a tenerlo), así que se tipea. Vacío lo rechaza la validación: con
  // abono 0 la cuenta no acumula deuda, no se suspende nunca y la prueba no
  // corta — es una cuenta gratis para siempre sin querer.
  monthlyFee: String(getPlan(DEFAULT_PLAN_ID)?.monthlyFee ?? ''),
  // Arranca con los colores de BarberOS; el cliente los cambia si tiene marca propia.
  primaryColor: '#e03d00',
  secondaryColor: '#ff5c1a',
  accentColor: '#ff5c1a',
  slotInterval: 30,
  minCancelHours: 2,
  welcomeMessage: 'Reservá tu turno en segundos',
  instagram: '',
  whatsapp: '',
  // 0 = cuenta que se cobra desde el arranque. Mayor a 0 = cuenta de prueba.
  trialDays: 0,
  // 'google' = entra con su Gmail. 'password' = le creamos usuario y contraseña,
  // para el barbero que no usa Gmail o no quiere mezclarlo con lo personal.
  accesoPor: 'google',
  // Vacío = la genera el servidor. Si la escribís, se usa esa.
  passwordElegida: '',
};

// Una sucursal en el alta de una cuenta con varias. Cada local tiene SU
// teléfono, SU WhatsApp y SU dirección: no hay datos "de la cuenta" que se
// repitan en todas (era lo que confundía: el alta pedía un teléfono, y la
// cuenta tiene tres).
const SUCURSAL_VACIA = { nombre: '', slug: '', slugEditado: false, telefono: '', whatsapp: '', direccion: '', ciudad: '' };
const BARRIOS = ['Centro', 'Norte', 'Sur', 'Oeste'];

/** Primer cobro un mes después del alta, para que no arranque con deuda. */
function nextMonthISO() {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().split('T')[0];
}

/** Hoy más N días, como 'YYYY-MM-DD'. */
function enDiasISO(dias) {
  const d = new Date();
  d.setDate(d.getDate() + Number(dias));
  return d.toISOString().split('T')[0];
}

export default function NewBusinessModal({ onClose, onCreated }) {
  const { state } = useBusiness();
  const [form, setForm] = useState(EMPTY_FORM);
  // Lo que se acuerda cuando el plan es a medida. Arranca con todo habilitado y
  // sin topes: es lo que se espera de un plan que se negocia uno por uno.
  const [medida, setMedida] = useState(() => medidaDesdeNegocio(null));
  const [errors, setErrors] = useState({});
  const [guardando, setGuardando] = useState(false);
  // Al crear, en vez de cerrar mostramos los datos para entregarle al cliente.
  const [created, setCreated] = useState(null);
  // Las sucursales, cuando el plan permite más de una.
  const [sucs, setSucs] = useState([{ ...SUCURSAL_VACIA }]);
  // El link de la CUENTA (`/franlook`): pregunta a qué sucursal va. Se propone
  // del nombre de la marca hasta que se lo edita a mano.
  const [linkCuenta, setLinkCuenta] = useState({ slug: '', editado: false });

  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  // ¿Cuántas sucursales permite el plan elegido? null = sin límite.
  const planElegido = getPlan(form.planId);
  const topeSucursales = planElegido?.aMedida === true
    ? camposDeLaMedida(medida).maxSucursales
    : (planElegido?.maxSucursales ?? 1);
  // Con más de una posible, el alta es "una cuenta con N sucursales": los datos
  // del local se cargan por sucursal, no una vez para todas.
  const multi = topeSucursales === null || topeSucursales > 1;
  const setSuc = (i, patch) => setSucs((prev) => prev.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  // El slug se genera del nombre hasta que el usuario lo edita a mano.
  const handleNameChange = (name) => {
    if (form.slugEdited) {
      set({ name });
    } else {
      set({ name, slug: slugify(name) });
    }
    if (!linkCuenta.editado) setLinkCuenta({ slug: slugify(name), editado: false });
  };

  const handleSlugChange = (slug) => {
    set({ slug: slugify(slug), slugEdited: true });
  };

  const validate = async () => {
    const e = {};
    const email = form.ownerEmail.trim().toLowerCase();

    if (!form.name.trim()) e.name = multi ? 'Poné el nombre de la cuenta (la marca).' : 'Poné el nombre del negocio.';

    if (multi) {
      // Cada sucursal con su nombre y su link, sin repetir entre ellas.
      const vistos = new Set();
      for (const [i, x] of sucs.entries()) {
        const clave = 'suc' + i;
        if (x.nombre.trim().length < 2) e[clave] = 'Poné el nombre de esta sucursal.';
        else if (!x.slug || x.slug.length < 3) e[clave] = 'Falta el link (mínimo 3 letras).';
        else if (isReservedSlug(x.slug)) e[clave] = 'Ese link es una ruta interna de la app. Elegí otro.';
        else if (vistos.has(x.slug)) e[clave] = 'Dos sucursales no pueden tener el mismo link.';
        else if (!(await isSlugAvailable(x.slug))) e[clave] = 'Ya hay una barbería con el link /' + x.slug + '.';
        vistos.add(x.slug);
      }
      // El link de la cuenta, solo si hay más de una sucursal (con una sola no
      // hay nada que elegir).
      if (sucs.length > 1) {
        const l = linkCuenta.slug;
        if (!l || l.length < 3) e.linkCuenta = 'Falta el link de la cuenta (mínimo 3 letras).';
        else if (isReservedSlug(l)) e.linkCuenta = 'Ese link es una ruta interna de la app. Elegí otro.';
        else if (vistos.has(l)) e.linkCuenta = 'Tiene que ser distinto del link de cada sucursal.';
        else if (!(await isSlugAvailable(l))) e.linkCuenta = 'Ya hay una barbería con el link /' + l + '.';
      }
    } else if (!form.slug) {
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

    // El abono en cero es válido: una cuenta de regalo. Lo que se rechaza es el
    // campo VACÍO, que también vale 0 y es la forma de regalar una cuenta sin
    // querer. El cero tipeado a mano se confirma al guardar (handleSubmit).
    const escrito = String(form.monthlyFee).trim();
    const abono = Number(escrito);
    if (!escrito || !Number.isFinite(abono) || abono < 0) {
      e.monthlyFee = 'Poné el abono mensual acordado. Si la cuenta es de regalo, escribí 0.';
    }

    const pass = form.passwordElegida.trim();
    if (form.accesoPor === 'password' && pass && pass.length < 8) {
      e.passwordElegida = 'Si la elegís vos, tiene que tener al menos 8 caracteres.';
    }

    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (ev) => {
    ev.preventDefault();
    if (guardando) return;
    if (!(await validate())) return;

    // Regalar una cuenta es una decisión comercial, pero tiene una consecuencia
    // que conviene decir en voz alta: sin abono no hay deuda, y sin deuda la
    // cuenta no se suspende nunca — ni cuando se termine la prueba.
    if (Number(form.monthlyFee) === 0 && !window.confirm(
      `Abono $0: esta cuenta no va a acumular deuda y NUNCA se va a suspender por ` +
      `falta de pago, tenga o no días de prueba.

¿Es una cuenta de regalo?`
    )) return;

    const plan = getPlan(form.planId);
    // A medida: los topes y las funciones salen del formulario, no del plan.
    const aMedida = plan?.aMedida === true;
    const campos = aMedida ? camposDeLaMedida(medida) : null;
    const now = new Date().toISOString();
    const trialDays = Number(form.trialDays) || 0;

    // El id lo asigna Firestore al crear el documento.
    // En una cuenta con sucursales, el documento que se crea acá ES la primera
    // sucursal (con sus datos); las demás se abren después con crearSucursal.
    const primera = multi ? sucs[0] : null;
    const business = {
      name: multi ? primera.nombre.trim() : form.name.trim(),
      slug: multi ? primera.slug : form.slug,
      // El nombre de la MARCA, que agrupa a las sucursales: lo muestran la
      // pantalla de "elegí sucursal" y el panel global.
      ...(multi ? { nombreCuenta: form.name.trim() } : {}),
      logoUrl: null,
      primaryColor: form.primaryColor,
      secondaryColor: form.secondaryColor,
      accentColor: form.accentColor,
      phone: multi ? primera.telefono.trim() : form.phone.trim(),
      email: form.email.trim(),
      address: multi ? primera.direccion.trim() : form.address.trim(),
      city: multi ? primera.ciudad.trim() : form.city.trim(),
      country: 'Argentina',
      currency: 'ARS',
      timezone: 'America/Argentina/Buenos_Aires',
      slotInterval: Number(form.slotInterval) || 30,
      minCancelHours: Number(form.minCancelHours) || 2,
      onlineBookingEnabled: true,
      welcomeMessage: form.welcomeMessage.trim(),
      socialLinks: {
        instagram: form.instagram.trim(),
        whatsapp: multi ? primera.whatsapp.trim() : form.whatsapp.trim(),
      },
      // Público: la UI del negocio muestra el plan y su cuota de mensajes.
      planId: plan.id,
      whatsappQuota: (aMedida ? campos.whatsappQuota : plan.whatsappQuota) ?? 0,
      // Los topes quedan ESCRITOS en el documento y no solo implícitos en el
      // plan: así una cuenta conserva lo que compró aunque el plan cambie de
      // topes más adelante, y se le puede hacer una excepción sin inventar un
      // plan nuevo. Solo la plataforma los puede tocar (Rules).
      maxBarbers: aMedida ? campos.maxBarbers : (plan.maxBarbers ?? null),
      maxSucursales: aMedida ? campos.maxSucursales : (plan.maxSucursales ?? 1),
      // Qué funciones habilita el plan (foto del barbero, colores, logo). Las
      // Rules leen ESTE campo: sin escribirlo, el plan no restringe nada.
      capacidades: aMedida ? campos.capacidades : { ...(plan.capacidades || {}) },
      // Sin sucursales todavía. Lo escribe `crearSucursal` cuando se abre la
      // primera, y de ahí salen los permisos del dueño: el dueño NO lo puede
      // tocar.
      grupoId: null,
      isFrozen: false,
      // Va en el documento público para que el panel pueda mostrar los días que
      // quedan sin una lectura extra. No es dato sensible.
      trialEndsAt: trialDays > 0 ? enDiasISO(trialDays) : null,
      businessHours: DEFAULT_BUSINESS_HOURS.map((h) => ({ ...h })),
    };

    // Privado: la plata va en /businesses/{id}/private/billing, no en el
    // documento público. El doc público lo puede leer cualquier cliente.
    const billing = {
      planId: plan.id,
      monthlyFee: Number(form.monthlyFee) || 0,
      debt: 0,
      lastPaymentDate: null,
      // Con prueba, el primer vencimiento cae el día que termina: runBilling no
      // cobra hasta entonces y al día siguiente congela sola la cuenta.
      nextBillingDate: trialDays > 0 ? enDiasISO(trialDays) : nextMonthISO(),
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
      let claims = { ok: false, status: null, error: null, password: null };
      try {
        const res = form.accesoPor === 'password'
          ? await createOwnerWithPassword({
              email: ownerAdmin.email,
              businessId,
              name: ownerAdmin.name,
              role: 'owner',
              password: form.passwordElegida.trim() || null,
            })
          : await setBusinessAdmin({
              email: ownerAdmin.email,
              businessId,
              role: 'owner',
              name: ownerAdmin.name,
            });
        // La contraseña llega UNA sola vez: Firebase guarda el hash, no el texto.
        claims = { ok: true, status: res?.status ?? null, error: null, password: res?.password ?? null };
      } catch (err) {
        console.error('[NewBusinessModal] No se pudieron asignar los permisos:', err);
        claims = { ok: false, status: null, error: err.message, password: null };
      }

      // Las demás sucursales. Después del dueño a propósito: crearSucursal le
      // pasa el permiso de cada una a los dueños de la cuenta.
      const sucursalesCreadas = [{ nombre: business.name, slug: business.slug, ok: true }];
      if (multi) {
        for (const x of sucs.slice(1)) {
          try {
            await crearSucursal({
              businessId,
              nombre: x.nombre.trim(),
              slug: x.slug,
              telefono: x.telefono.trim(),
              whatsapp: x.whatsapp.trim(),
              direccion: x.direccion.trim(),
              ciudad: x.ciudad.trim(),
            });
            sucursalesCreadas.push({ nombre: x.nombre.trim(), slug: x.slug, ok: true });
          } catch (err) {
            console.error('[NewBusinessModal] No se pudo crear una sucursal:', err);
            sucursalesCreadas.push({ nombre: x.nombre.trim(), slug: x.slug, ok: false, error: err.message });
          }
        }
      }

      // El link de la cuenta, cuando quedaron al menos dos sucursales.
      let linkDeCuenta = null;
      if (multi && sucursalesCreadas.filter((x) => x.ok).length > 1) {
        try {
          await guardarLinkDeCuenta({ grupoId: businessId, slug: linkCuenta.slug });
          linkDeCuenta = { slug: linkCuenta.slug, ok: true };
        } catch (err) {
          linkDeCuenta = { slug: linkCuenta.slug, ok: false, error: err.message };
        }
      }

      setCreated({ business: { ...business, id: businessId, ...billing }, ownerAdmin, claims, sucursalesCreadas, linkDeCuenta });
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
              <strong>{created.business.nombreCuenta || created.business.name}</strong> ya está activa. Esto es lo que
              tenés que pasarle al cliente:
            </p>

            <div className="form-group">
              <label className="form-label">
                {created.sucursalesCreadas?.length > 1 ? 'Link de cada sucursal' : 'Link público para sus clientes'}
              </label>
              {created.linkDeCuenta && (
                <div className="form-input" style={{ background: 'var(--bg-secondary)', fontSize: 13, wordBreak: 'break-all', marginBottom: 6, borderColor: 'var(--primary)' }}>
                  <strong>Link de la cuenta</strong> (pregunta a qué sucursal va):{' '}
                  <span style={{ fontFamily: 'monospace' }}>{window.location.origin}/{created.linkDeCuenta.slug}</span>
                  {!created.linkDeCuenta.ok && <div className="form-error">No se pudo crear: {created.linkDeCuenta.error} Definilo desde la tarjeta de la cuenta.</div>}
                </div>
              )}
              {created.sucursalesCreadas?.length > 1 ? (
                created.sucursalesCreadas.map((x) => (
                  <div key={x.slug} className="form-input" style={{ background: 'var(--bg-secondary)', fontSize: 13, wordBreak: 'break-all', marginBottom: 6 }}>
                    <strong>{x.nombre}</strong>: <span style={{ fontFamily: 'monospace' }}>{window.location.origin}/{x.slug}</span>
                    {!x.ok && <div className="form-error">No se pudo crear: {x.error} Creala desde Mis sucursales.</div>}
                  </div>
                ))
              ) : (
                <div
                  className="form-input"
                  style={{ background: 'var(--bg-secondary)', fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all' }}
                >
                  {publicUrl}
                </div>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">Acceso al panel</label>
              <div className="form-input" style={{ background: 'var(--bg-secondary)', fontSize: 13 }}>
                Entra en <strong>/login</strong> con Google usando{' '}
                <strong>{created.ownerAdmin.email}</strong>
              </div>
              {created.claims?.password && (
                <div
                  style={{
                    marginTop: 8,
                    padding: '10px 12px',
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--primary)',
                    borderRadius: 8,
                  }}
                >
                  <div className="text-xs text-muted" style={{ marginBottom: 4 }}>
                    CONTRASEÑA — se muestra una sola vez
                  </div>
                  <div style={{ fontFamily: 'monospace', fontSize: 18, letterSpacing: 1 }}>
                    {created.claims.password}
                  </div>
                  <p className="text-xs text-muted" style={{ marginTop: 6, marginBottom: 0 }}>
                    Copiala ahora: no queda guardada en ningún lado. Si se pierde
                    hay que generar otra.
                  </p>
                </div>
              )}

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

            {created.business.trialEndsAt && (
              <div className="notice notice-info">
                <strong>Cuenta de prueba</strong> hasta el{' '}
                <strong>{created.business.trialEndsAt}</strong>. Hasta esa fecha no
                se le cobra nada. Al día siguiente se genera el vencimiento y, si
                no paga, la cuenta se suspende sola.
              </div>
            )}

            <div className="notice notice-info">
              <strong>Falta configurar</strong> antes de entregarla: cargar los
              profesionales con sus horarios y el catálogo de servicios
              {created.sucursalesCreadas?.length > 1 ? ' de CADA sucursal' : ''}. Sin eso
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
            <label className="form-label">{multi ? 'Nombre de la cuenta (la marca)' : 'Nombre del negocio'} <span className="required">*</span></label>
            <input
              className={`form-input ${errors.name ? 'error' : ''}`}
              value={form.name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Barbería Don José"
              autoFocus
            />
            {errors.name && <div className="form-error">{errors.name}</div>}
          </div>

          {!multi && (
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
          )}

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
                  onChange={() => set({
                    planId: plan.id,
                    // Se propone el precio de lista del plan; si no tiene, se
                    // deja el campo vacío para que se tipee el acordado.
                    monthlyFee: String(plan.monthlyFee ?? ''),
                  })}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 'bold', fontSize: 13 }}>{plan.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {plan.description} ·{' '}
                    {plan.maxSucursales === null
                      ? 'sucursales a convenir'
                      : plan.maxSucursales === 1 ? '1 barbería' : `hasta ${plan.maxSucursales} sucursales`}
                    {' · '}
                    {plan.maxBarbers === null
                      ? 'barberos sin límite'
                      : plan.maxBarbers === 1 ? '1 barbero' : `hasta ${plan.maxBarbers} barberos`}
                    {' · '}
                    {precioLindo(plan.monthlyFee)
                      ? `${precioLindo(plan.monthlyFee)} ARS/mes`
                      : 'precio a convenir'}
                  </div>
                </div>
              </label>
            ))}
          </div>

          {/* El Plan Personalizado se configura: cuántas sucursales, cuántos
              barberos y qué funciones. Sin esto nacía con los topes del Básico. */}
          {getPlan(form.planId)?.aMedida === true && (
            <PlanAMedida valor={medida} onChange={setMedida} />
          )}

          <div className="form-group" style={{ marginTop: 'var(--space-md)' }}>
            <label className="form-label">Abono mensual acordado (ARS)</label>
            <input
              type="number"
              min="0"
              className="form-input"
              value={form.monthlyFee}
              onChange={(e) => set({ monthlyFee: e.target.value })}
              placeholder="25000"
            />
            {errors.monthlyFee && <div className="form-error">{errors.monthlyFee}</div>}
            <p className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
              Es lo que se le va a cobrar por mes. Los planes nuevos todavía no tienen
              precio de lista, así que se escribe el que acordaste. Va en la facturación
              privada, no en el documento público.
            </p>
          </div>

          {/* Cómo entra el dueño */}
          <div className="form-group" style={{ marginTop: 'var(--space-md)' }}>
            <label className="form-label">Cómo entra al panel</label>
            <select
              className="form-input"
              value={form.accesoPor}
              onChange={(e) => set({ accesoPor: e.target.value })}
              style={{ maxWidth: 320 }}
            >
              <option value="google">Con su cuenta de Google</option>
              <option value="password">Con usuario y contraseña que le damos</option>
            </select>
            <p className="text-xs text-muted" style={{ marginTop: 4 }}>
              {form.accesoPor === 'password'
                ? 'La contraseña se muestra una sola vez al crear la cuenta, así que copiala antes de cerrar.'
                : 'Entra con el Gmail de arriba. No hace falta que le pasemos nada.'}
            </p>

            {form.accesoPor === 'password' && (
              <div style={{ marginTop: 'var(--space-md)' }}>
                <label className="form-label">Contraseña temporal (opcional)</label>
                <input
                  className="form-input"
                  type="text"
                  value={form.passwordElegida}
                  onChange={(e) => set({ passwordElegida: e.target.value })}
                  placeholder="Dejalo vacío y la generamos nosotros"
                  style={{ maxWidth: 320, fontFamily: 'monospace' }}
                />
                {errors.passwordElegida && (
                  <p className="text-xs" style={{ color: 'var(--danger)', marginTop: 4 }}>
                    {errors.passwordElegida}
                  </p>
                )}
                <p className="text-xs text-muted" style={{ marginTop: 4 }}>
                  Mínimo 6 caracteres. Se muestra en texto plano a propósito: la
                  vas a tener que dictar. Decile que la cambie cuando entre.
                </p>
              </div>
            )}
          </div>

          {/* Prueba gratis */}
          <div className="form-group" style={{ marginTop: 'var(--space-md)' }}>
            <label className="form-label">Días de prueba sin cargo</label>
            <input
              className="form-input"
              type="number"
              min="0"
              max="365"
              value={form.trialDays}
              onChange={(e) => set({ trialDays: e.target.value })}
              style={{ maxWidth: 160 }}
            />
            <p className="text-xs text-muted" style={{ marginTop: 4 }}>
              {Number(form.trialDays) > 0 ? (
                <>
                  No se le cobra hasta el <strong>{enDiasISO(Number(form.trialDays))}</strong>.
                  Ese día se genera el primer vencimiento y, si no paga, la cuenta
                  se suspende sola y el link deja de tomar turnos.
                </>
              ) : (
                <>0 = se cobra desde el arranque, con el primer vencimiento a un mes.</>
              )}
            </p>
          </div>

          {/* Cuenta con sucursales: los datos van POR LOCAL. */}
          {multi && (
            <>
              <h4 style={{ marginTop: 'var(--space-lg)', borderBottom: '1px solid var(--border-color)', paddingBottom: 6 }}>
                Sucursales
              </h4>
              <p className="text-secondary" style={{ fontSize: 12, marginBottom: 'var(--space-md)' }}>
                Cada sucursal es una barbería completa, con su link, su teléfono, su WhatsApp y su
                dirección. El equipo, los servicios y los horarios se cargan después, adentro de cada una.
                {topeSucursales !== null && ` El plan permite hasta ${topeSucursales}.`}
              </p>
              {sucs.map((x, i) => (
                <div key={i} className="card alta-sucursal">
                  <div className="alta-sucursal-cabecera">
                    <strong>Sucursal {i + 1}</strong>
                    {sucs.length > 1 && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSucs((p) => p.filter((_, j) => j !== i))}>
                        Quitar
                      </button>
                    )}
                  </div>
                  <div className="alta-sucursal-grilla">
                    <div className="form-group">
                      <label className="form-label">Nombre <span className="required">*</span></label>
                      <input
                        className="form-input"
                        value={x.nombre}
                        placeholder={`${form.name.trim() || 'Barbería'} ${BARRIOS[i] || i + 1}`}
                        onChange={(e) => setSuc(i, { nombre: e.target.value, ...(x.slugEditado ? {} : { slug: slugify(e.target.value) }) })}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Link <span className="required">*</span></label>
                      <input
                        className="form-input"
                        style={{ fontFamily: 'monospace' }}
                        value={x.slug}
                        placeholder="barberia-centro"
                        onChange={(e) => setSuc(i, { slug: slugify(e.target.value), slugEditado: true })}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Teléfono</label>
                      <input className="form-input" value={x.telefono} onChange={(e) => setSuc(i, { telefono: e.target.value })} placeholder="+54 11 1234-5678" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">WhatsApp</label>
                      <input className="form-input" value={x.whatsapp} onChange={(e) => setSuc(i, { whatsapp: e.target.value })} placeholder="si es otro que el teléfono" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Dirección</label>
                      <input className="form-input" value={x.direccion} onChange={(e) => setSuc(i, { direccion: e.target.value })} placeholder="Av. Corrientes 1234" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Ciudad</label>
                      <input className="form-input" value={x.ciudad} onChange={(e) => setSuc(i, { ciudad: e.target.value })} />
                    </div>
                  </div>
                  {errors['suc' + i] && <div className="form-error">{errors['suc' + i]}</div>}
                </div>
              ))}
              {(topeSucursales === null || sucs.length < topeSucursales) && (
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setSucs((p) => [...p, { ...SUCURSAL_VACIA }])}>
                  + Agregar otra sucursal
                </button>
              )}
              {sucs.length > 1 && (
                <div className="form-group" style={{ marginTop: 'var(--space-md)' }}>
                  <label className="form-label">Link de la cuenta <span className="required">*</span></label>
                  <input
                    className="form-input"
                    style={{ fontFamily: 'monospace' }}
                    value={linkCuenta.slug}
                    placeholder="franlook"
                    onChange={(e) => setLinkCuenta({ slug: slugify(e.target.value), editado: true })}
                  />
                  {errors.linkCuenta
                    ? <div className="form-error">{errors.linkCuenta}</div>
                    : <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                        El que va en la bio de Instagram de la marca: le pregunta al cliente a qué sucursal va.
                        El link de cada sucursal entra directo a esa sucursal.
                      </div>}
                </div>
              )}
            </>
          )}

          {/* Contacto */}
          <h4 style={{ marginTop: 'var(--space-lg)', borderBottom: '1px solid var(--border-color)', paddingBottom: 6 }}>
            {multi ? 'Datos de la cuenta (iguales en todas las sucursales)' : 'Datos del local'}
          </h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 'var(--space-md)' }}>
            {!multi && (
            <div className="form-group">
              <label className="form-label">Teléfono</label>
              <input
                className="form-input"
                value={form.phone}
                onChange={(e) => set({ phone: e.target.value })}
                placeholder="+54 11 1234-5678"
              />
            </div>
            )}
            <div className="form-group">
              <label className="form-label">Email de contacto</label>
              <input
                className="form-input"
                value={form.email}
                onChange={(e) => set({ email: e.target.value })}
                placeholder="hola@barberia.com"
              />
            </div>
            {!multi && (
              <>
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
              </>
            )}
            <div className="form-group">
              <label className="form-label">Instagram</label>
              <input
                className="form-input"
                value={form.instagram}
                onChange={(e) => set({ instagram: e.target.value })}
                placeholder="@barberiadonjose"
              />
            </div>
            {!multi && (
              <div className="form-group">
                <label className="form-label">WhatsApp</label>
                <input
                  className="form-input"
                  value={form.whatsapp}
                  onChange={(e) => set({ whatsapp: e.target.value })}
                  placeholder="+5411..."
                />
              </div>
            )}
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
            {guardando ? 'Creando…' : multi && sucs.length > 1 ? `Crear cuenta con ${sucs.length} sucursales` : 'Crear cuenta'}
          </button>
        </div>
      </form>
    </div>
  );
}
