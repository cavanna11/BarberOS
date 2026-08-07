# BarberOS — Roadmap

> Documento de contexto para IDE / AI assistants. Define hacia dónde apunta el proyecto, qué decisiones técnicas están tomadas, y qué evitar.

---

## Modelo de venta: onboarding manual

**No hay registro self-service, y es a propósito.** El cliente se contacta, se
cierra la venta, y la cuenta se prepara a mano desde `/super-admin` →
"Nueva barbería": eso crea el negocio, su link público y el acceso del dueño en
un solo paso.

Consecuencias para el desarrollo:
- No construir pantallas de "crear tu cuenta", pricing público ni checkout de
  suscripción. La venta es conversada.
- El alta tiene que dejar la cuenta lista para entregar. El checklist del
  dashboard (`DashboardPage`) marca qué falta: profesionales, servicios,
  horarios y asignación servicio↔profesional.
- El dueño de plataforma puede entrar al panel de cualquier tenant
  ("Administrar esta cuenta") para configurarlo antes de entregarlo. Cuando lo
  hace, se muestra una barra de aviso permanente con el nombre del negocio.

---

## Estado actual

> **Los datos viven en Firestore** (proyecto `barberos-1d60e`). Negocios, staff,
> servicios, horarios, turnos, admins y tickets. Ya no queda nada operativo en
> `localStorage`.
> El único acceso pre-cargado es el dueño de plataforma, en
> `src/config/platform.js`, y su claim `platform: true` está puesto en Firebase.

**Funciona:**
- Frontend React 19 + Vite + Router v7
- Login con **Firebase Auth** (`signInWithPopup`). Se sacaron `@react-oauth/google` y `jwt-decode`.
- Roles: `platform owner` (platform.js) | `owner` | `admin` | `client`
- Auto-revalidación de permisos en `AuthContext` (los platform owners quedan exentos)
- CRUDs completos en panel admin
- Motor de disponibilidad (`availabilityEngine.js`) — **no tocar, ya funciona**
- Stats calculator — **no tocar, ya funciona**
- **Firestore** con Security Rules desplegadas y verificadas contra el proyecto real
- Capa única de acceso en `src/lib/repository.js` — ningún componente habla con Firestore directo
- `BusinessSync` abre las suscripciones en un solo lugar, para no pagar el mismo documento una vez por componente
- Facturación privada en `/businesses/{id}/private/billing`, fuera del documento público
- Tickets de soporte: chat por barbería + bandeja en el panel global
- Landing pública de venta en la raíz
- Sistema de temas via CSS variables (`theme.js`)

- Panel super-admin con facturación automática (deuda mensual, congelamiento y
  reactivación por pago) — **hecho, no estaba en el plan original**
- `availabilityEngine.js` extendido con `businessHours`: cruza el horario
  comercial con el del profesional
- Multi-tenancy por slug + aislamiento de datos en frontend (ver Sprint 1)
- Alta manual de barberías desde `/super-admin` con slug auto-generado, plan,
  colores y acceso del dueño (`NewBusinessModal.jsx`)
- Planes comerciales centralizados en `src/config/plans.js`
- Estados vacíos en toda la app (base sin negocios, cuenta sin staff ni catálogo)

**Pendiente:**
- **Plan Blaze + Cloud Functions** → bloquea el alta de clientes reales (ver arriba)
- Recordatorios WhatsApp
- Pagos Mercado Pago
- White-label dinámico desde DB (falta el upload de logo)
- PWA

---

## Decisiones técnicas tomadas

| Área | Stack | Notas |
|------|-------|-------|
| Frontend | React 19 + Vite + Tailwind | Migrar CSS puro a Tailwind progresivamente |
| Backend | Firebase (Firestore + Auth + Storage) | NO Supabase, NO Express custom para MVP |
| Auth | Firebase Auth + Google OAuth | Andando. Permisos por custom claims. |
| Multi-tenancy | Slug en URL path | `/:businessSlug/...`, NO subdominios |
| Automatizaciones | n8n self-hosted (Hostinger) | NO Cloud Functions excepto webhooks |
| WhatsApp | WhatsApp Cloud API (Meta directo) | NO Twilio, NO Evolution API |
| Número WhatsApp | Único de SACIA para todos los tenants | NO el número del barbero |
| Pagos | Mercado Pago Checkout Pro | Webhook validado en Cloud Function |
| Email | Resend o Brevo | Solo confirmaciones y backup |
| Hosting | Firebase Hosting | SSL automático |

---

## Estructura Firestore objetivo

```
/businesses/{businessId}
  - name, slug, logoUrl, colors, settings, isFrozen, ...
  /professionals/{profId}
  /services/{srvId}
  /schedules/{schId}
  /appointments/{aptId}
  /admins/{adminId}  // reemplaza authorizedAdmins
  /notifications/{notifId}  // log de WhatsApp/email enviados

/users/{userId}
  - email, name, role, businessId (null si client), linkedBusinesses[]

/superAdmin/{config}  // solo accesible para owner global
```

**Regla de oro:** toda query lleva `where('businessId', '==', userBusinessId)`. Security Rules verifican lo mismo a nivel DB.

---

## ⛔ Bloqueante para vender: plan Blaze

**Sin esto no se puede dar de alta al dueño de una barbería real.**

Los permisos de verdad son los custom claims del token, y solo se pueden
escribir con el Admin SDK desde una Cloud Function. Las Cloud Functions
requieren plan Blaze (pago por uso).

Qué queda trabado mientras tanto:

- Un dueño de barbería puede tener su ficha en `/admin/admins`, pero **no puede
  entrar**: sin claim, Firestore lo trata como cliente.
- Tampoco puede abrir tickets de soporte (la regla compara contra su claim).
- La facturación mensual no corre sola: el motor del navegador se retiró y su
  reemplazo es la función programada `runBilling`.
- Los recordatorios de WhatsApp no se pueden enviar: el token de Meta no puede
  vivir en el browser.

El dueño de plataforma sí funciona: su claim se puso a mano con
`scripts/bootstrap-platform-owner.mjs`. Alcanza para construir y probar todo
solo, no para entregarle la cuenta a un cliente.

Costo real esperado: **cercano a $0**. La capa gratuita de Blaze es la misma que
la de Spark; la diferencia es que Blaze permite pasarse pagando. Conviene poner
un presupuesto con alerta en Google Cloud al activarlo.

Pasos: activar Blaze → `cd functions && npm install` → `firebase deploy --only functions`
→ conectar `setBusinessAdmin` desde el alta de barbería.

---

## Roadmap por sprints

### Sprint 0 — Fundación Firebase `[1-2 semanas]`

> **Guía paso a paso completa: [`FIREBASE_SETUP.md`](FIREBASE_SETUP.md).**
> Archivos ya escritos y listos para usar: `firestore.rules`,
> `src/lib/firebase.js`, `functions/index.js`,
> `scripts/bootstrap-platform-owner.mjs`, `.env.example`.
> Ninguno está probado contra un proyecto real todavía — el Paso 8 de la guía es
> cómo verificarlos con los emuladores.

- [ ] Crear proyecto Firebase
- [ ] Configurar Firestore + Auth + Storage
- [ ] Migrar `mockData.js` como seed inicial
- [ ] Reemplazar persistencia de `BusinessContext` (localStorage → Firestore)
- [ ] Reemplazar `AuthContext` (login Google ya existe, solo falta atarlo a Firebase Auth con custom claims `{ businessId, role }`)
- [ ] **Mantener intactos** `availabilityEngine.js` y `statsCalculator.js`
- [ ] Iniciar trámite Meta WhatsApp (en paralelo, demora 1-2 semanas)

### Sprint 1 — Multi-tenancy `[1-2 semanas]`

> **Orden invertido respecto del plan original**: se hizo la capa de acceso a
> datos por tenant ANTES de Firebase. Motivo: con los componentes leyendo
> `state.X` a pelo, migrar a Firestore obligaba a tocarlos dos veces (una para
> Firestore, otra para el filtro por tenant). Con los hooks en el medio, la
> migración queda contenida adentro de `src/hooks/useTenantData.js`.

- [x] Routing `/:businessSlug/...` en `App.jsx` (+ `TenantRoute` valida slug y `isFrozen`)
- [x] Hook `useCurrentBusiness()` resuelve slug → businessId
- [x] Capa `useTenantData.js`: `useProfessionals/useServices/useAppointments/useSchedules/useProfessionalServices/useAuthorizedAdmins` + agregado `useTenant()`
- [x] `businessId` en `authorizedAdmins` y en el usuario logueado (`AuthContext`)
- [x] `PLATFORM_OWNERS` centralizado en `src/config/platform.js` (estaba duplicado en 4 lugares)
- [x] Todos los componentes de cliente y admin migrados a los hooks
- [ ] Security Rules estrictas + tests con emulador *(requiere Firebase)*
- [ ] Migrar `authorizedAdmins` a subcolección `/businesses/{id}/admins` *(requiere Firebase)*
- [ ] Onboarding mínimo: crear barbería + slug auto-generado
- [ ] Selector de tenant en el super-admin (hoy el dueño de plataforma cae siempre en `biz-001` al entrar a `/admin`; falta el botón "administrar este negocio" que despache `SET_CURRENT_BUSINESS`)

### Sprint 1.5 — Limpieza para producción `[hecho]`
- [x] Seed vacío (`seedData.js`) — se eliminó todo el dato de demostración
- [x] Un solo dueño de plataforma: `cavannaprogramacion@gmail.com`
- [x] Alta manual de barberías con pantalla de entrega (link público + acceso del dueño)
- [x] "Administrar esta cuenta" desde el panel global + barra de aviso de tenant
- [x] Checklist de configuración en el dashboard del dueño
- [x] Bypass de login encerrado en `import.meta.env.DEV` (no queda en el bundle)
- [x] `.env` sacado del control de versiones
- [x] Fix: los platform owners ya no se degradan a `client`
- [x] Fix: `ServicesPage` no escribe más `localStorage` a mano ni recarga la página
- [x] Fix: scroll horizontal del panel admin en pantallas medianas

### Sprint 2 — Super-admin `[3-5 días]`
- [ ] Ruta `/super-admin` accesible solo para email hardcodeado
- [ ] Listado de tenants con métricas básicas
- [ ] Acción "congelar cuenta" → flag `isFrozen` bloquea booking público

### Sprint 3 — White-label dinámico `[3-5 días]`
- [ ] Upload de logo a Firebase Storage
- [ ] `theme.js` lee colores/branding desde Firestore por slug
- [ ] Preview en vivo en `/admin/configuracion`

### Sprint 4 — Recordatorios WhatsApp `[1-2 semanas]` ⭐
- [ ] Workflow n8n con cron cada 30 min
- [ ] Buscar citas en T-24h y T-2h (status `pendiente`/`confirmada`)
- [ ] POST a WhatsApp Cloud API con template aprobado
- [ ] Log en `/businesses/{id}/notifications`
- [ ] Plantillas configurables por barbería

### Sprint 5 — Pagos y seña `[1-2 semanas]`
- [ ] Mercado Pago Checkout Pro
- [ ] Campos `requiresDeposit`, `depositPercent` en servicios
- [ ] Cloud Function `/webhook/mp` valida firma
- [ ] Estado `pendiente_pago` → `confirmada` al recibir pago

### Sprint 6 — Polish `[continuo]`
- [ ] PWA (manifest + service worker)
- [ ] Reportes mejorados
- [ ] Onboarding self-service end-to-end
- [ ] Landing pública de SaciaTurno (captación de barberos)

---

## Lo que NO hay que hacer

- ❌ NO escribir backend custom con Express. Firebase resuelve todo lo del MVP.
- ❌ NO crear subdominios por tenant. Slug en path es suficiente.
- ❌ NO usar Twilio para WhatsApp. WhatsApp Cloud API directo de Meta es más barato.
- ❌ NO permitir que cada barbero conecte su propio WhatsApp. Un número único SACIA.
- ❌ NO leer `db.collection()` directo desde componentes. Abstraer en hooks (`useProfessionals`, `useAppointments`, etc.) para poder migrar de Firebase en el futuro.
- ❌ NO romper `availabilityEngine.js` ni `statsCalculator.js`. Solo cambia la fuente de datos.
- ❌ NO mezclar lógica de tenants en queries. SIEMPRE filtrar por `businessId`.
- ❌ NO confiar solo en filtros en frontend. Security Rules son la red de seguridad real.
- ❌ NO crear UI de "elegir barbería" para clientes. Vienen por link directo (`/barberia-x`).
- ❌ NO storage de contraseñas. Solo Google OAuth.

---

## Convenciones de código

- **Componentes**: PascalCase, una responsabilidad
- **Hooks**: prefijo `use*`, retornan objeto o array tipado
- **Estado global**: solo lo que es realmente global (auth, business actual, booking wizard)
- **Estado local**: `useState` directo en el componente
- **Estilos**: Tailwind para nuevos componentes, CSS puro existente se mantiene hasta migración progresiva
- **Strings de IDs**: kebab-case (`biz-001`, `prof-001`)
- **Fechas**: ISO `YYYY-MM-DD` para fechas, `HH:MM` para horas

---

## Variables de entorno necesarias

```env
VITE_GOOGLE_CLIENT_ID=
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=

# n8n (no expuesto al cliente)
N8N_WEBHOOK_URL=
WHATSAPP_PHONE_ID=
WHATSAPP_TOKEN=

# Mercado Pago
MP_ACCESS_TOKEN=
MP_WEBHOOK_SECRET=
```

---

## Prioridad actual

**→ Sprint 0**: arrancar por la migración a Firebase. Antes de escribir feature nueva, mover la persistencia.
