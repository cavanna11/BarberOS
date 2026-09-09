# BarberOS — contexto del proyecto

> Este archivo se carga automáticamente al abrir una sesión de Claude Code en
> esta carpeta. Leelo primero y no vuelvas a explorar lo que ya está acá.
>
> **La carpeta se llama `saciaTurno` por historia. El proyecto es BarberOS.**

---

## Qué es

SaaS multi-tenant de turnos para barberías. Cada barbería tiene su link público
donde los clientes reservan, su panel de administración, y todo se gestiona
desde un panel global de plataforma.

**BarberOS es el producto. SACIA es el estudio que lo desarrolla.** No mezclar.

### Modelo de venta: onboarding MANUAL

No hay registro self-service **y es a propósito**. El cliente se contacta, se
cierra la venta, y Santiago prepara la cuenta desde `/super-admin` →
"Nueva barbería".

Consecuencias que ordenan el diseño:

- No construir pantallas de "creá tu cuenta", checkout de suscripción ni
  pricing con autoservicio.
- El CTA de la landing va a **WhatsApp**, nunca a un registro.
- El alta tiene que dejar la cuenta lista para entregar.

---

## Datos clave

| | |
|---|---|
| Repo | `github.com/cavanna11/BarberOS` (rama `main`) |
| Producción | `https://barberos.sacia.tech` (Vercel, auto-deploy desde `main`) |
| Firebase | proyecto `barberos-1d60e`, región `southamerica-east1` |
| Dueño de plataforma | `cavannaprogramacion@gmail.com` — claim `platform: true` ya asignado |
| Consola Firestore | `console.firebase.google.com/project/barberos-1d60e/firestore` |

El repo viejo `cavanna11/saciaTurnos` está **abandonado** (tenía commits de un
ex socio). No pushear ahí.

---

## Levantar el proyecto en otra máquina

Git trae el código, **pero no trae lo que hace falta para que arranque**:

```bash
git clone https://github.com/cavanna11/BarberOS.git
cd BarberOS
npm install
```

Después, y esto es lo que siempre se olvida:

**1. Crear `.env` en la raíz.** Está en `.gitignore` a propósito (tiene el
client secret de Google). Sin él la app arranca, pero muestra la pantalla de
"Falta la configuración de Firebase".

- Las siete `VITE_*` están en **Vercel → Settings → Environment Variables**.
- El `GOOGLE_CLIENT_SECRET` (sin prefijo `VITE_`) está en Google Cloud Console →
  Credenciales. El frontend no lo usa; queda para cuando haga falta del lado
  del servidor.
- Estructura de referencia: `.env.example`.

**2. CLI de Firebase**, solo si vas a desplegar reglas o functions:

```bash
npm install -g firebase-tools
firebase login
```

`firebase login` abre el navegador y necesita interacción humana: **no lo puede
correr un agente**. Si `firebase projects:list` da `HTTP 401`, la credencial
guardada venció aunque `firebase login:list` siga mostrando la cuenta: se
arregla con `firebase login --reauth`.

`firebase.json` y `.firebaserc` **ya están en el repo**. No corras
`firebase init`: es interactivo y te los va a querer reescribir. `firebase.json`
declara `firestore`, `functions` y los emuladores, y **no declara Hosting a
propósito** — producción es Vercel, y con Hosting configurado un `firebase
deploy` pelado publicaría un sitio paralelo compitiendo con el de Vercel.

**3.** `npm run dev` → http://localhost:5173

**No hay estado local que migrar.** Los datos viven en Firestore, así que la
notebook ve exactamente lo mismo que la máquina de escritorio apenas entrás con
Google.

---

## Estado: qué funciona hoy

- Datos en **Firestore**. Ya no queda nada operativo en `localStorage`.
- Login con **Firebase Auth** (`signInWithPopup`). Permisos por custom claims.
- **Security Rules desplegadas y verificadas** contra el proyecto real.
- Multi-tenancy por slug: `/:businessSlug`.
- Panel global: alta de barberías, facturación, suspensión, tickets.
- Panel por barbería: staff, servicios, horarios, agenda, admins, soporte.
- Reserva pública con motor de disponibilidad.
- Sistema de tickets de soporte (chat barbería ↔ plataforma).
- Landing pública de venta en la raíz.
- Identidad visual de SACIA aplicada.

---

## ✅ Blaze activo, Functions desplegadas

Desplegadas en `southamerica-east1`: `setBusinessAdmin`, `revokeBusinessAdmin`,
`applyPendingClaims`, `createAppointment` y `runBilling` (3 AM, hora de Buenos
Aires). Quedó puesta la política que borra imágenes de contenedor de más de un
día, para que no se acumule costo de almacenamiento.

```bash
curl -s -o /dev/null -w "%{http_code}
" https://southamerica-east1-barberos-1d60e.cloudfunctions.net/setBusinessAdmin
```

`400`/`401` = desplegada y validando. `404` = se cayó el deploy.

Del checklist post-Blaze quedan hechos los pasos 1 a 3. **Falta el 4**: sacar el
fallback de permisos de `AuthContext`. Se dejó a propósito hasta que un dueño
real entre con claims de verdad — sacarlo antes es quedarse sin red por una
mejora que no cambia la seguridad (las Rules ya exigen el claim real).

### Cuentas de prueba

En el alta hay un campo **"Días de prueba sin cargo"**. Con un valor mayor a
cero, el negocio queda con `trialEndsAt` y el primer vencimiento cae ese mismo
día. Mientras dure, `runBilling` no le suma deuda ni lo suspende. Al día
siguiente entra a cobrarse por el camino normal y, si no paga, **se suspende
sola y el link deja de tomar turnos** — que es justamente lo que corta la
prueba.

El panel muestra un banner con los días restantes y, al vencer, uno que invita a
escribir por WhatsApp.

Con 0 días la cuenta se cobra desde el arranque, con el primer vencimiento a un
mes. **Nunca des una cuenta de regalo sin días de prueba**: con cualquiera de los
tres planes acumula deuda al mes y se congela sola.

```bash
node scripts/test-billing-emulador.mjs
```

11 casos: cobro, acumulación de varios vencimientos, suspensión, reactivación al
saldar, prueba vigente y prueba vencida.

### Quién puede asignar permisos

- **Plataforma**: todo. Designar dueños, mover gente entre negocios.
- **Dueño de una barbería**: solo dentro de SU `businessId` y solo rol `admin`
  (barbero). No puede designar otros dueños — el dueño es quien paga la cuenta,
  así que quién lo es es una decisión comercial y no se delega al tenant.

Lo hacen cumplir `assertCanManageAdmins` y `assertTargetEnAlcance` en
`functions/index.js`. **El segundo no es paranoia:** `setCustomUserClaims`
REEMPLAZA todos los claims, no los mergea. Sin ese chequeo, el dueño de una
barbería podía llamar `setBusinessAdmin` con el mail de la plataforma y borrarle
el claim `platform`, dejando el panel global sin nadie que pudiera entrar.

Para verificarlo sin tocar producción (20 casos, incluidos todos los rechazos):

```bash
firebase emulators:start --only auth,firestore,functions
node scripts/test-claims-emulador.mjs
```

Y para las Security Rules, 40 casos de aislamiento (dos barberías, dueño,
barbero, cliente, anónimo) contra el emulador:

```bash
node scripts/auditar-rules-emulador.mjs
```

Pasan 38. Los 2 que "fallan" son a propósito: el precio del turno (lo resuelve
`createAppointment`, y el caso queda esperando `denegado` recién después del
paso 3 del checklist) y el alcance del barbero, que sigue sin decidirse.


### Validación de turnos (`createAppointment`)

El motor de disponibilidad del browser pinta la grilla, pero no puede ser la
única autoridad: con la consola abierta se saltea. Verificado contra el
emulador, escribiendo directo a Firestore se podía crear un turno con `price: 0`,
con fecha en 2020, con un profesional inexistente y **en una barbería suspendida
por deuda** — que es justamente la palanca de cobro.

`createAppointment` revalida todo del lado del servidor. El precio y la duración
salen del documento del servicio, nunca del cliente. El solapamiento se chequea
dentro de una transacción, porque dos personas mirando la misma grilla pueden
confirmar con milisegundos de diferencia.

```bash
node scripts/test-reservas-emulador.mjs
```

18 casos: precio falsificado, fecha pasada, profesional y servicio inexistentes,
servicio que ese profesional no hace, fuera de horario, en el descanso, día que
no trabaja, doble reserva, negocio suspendido y sin sesión.

---

## Arquitectura — mapa mínimo

```
src/
├── lib/
│   ├── firebase.js       Init. Exporta firebaseListo y faltanVariables.
│   └── repository.js     ⭐ ÚNICO lugar que habla con Firestore
├── contexts/
│   ├── BusinessSync.jsx  ⭐ ÚNICO lugar que abre suscripciones onSnapshot
│   ├── BusinessContext   Estado (reducer). Ya casi no persiste nada.
│   ├── AuthContext       Login + claims, con fallback transitorio
│   └── BookingContext    Wizard de reserva (estado de UI, no datos)
├── hooks/
│   ├── useCurrentBusiness.js  Resuelve qué negocio corresponde
│   └── useTenantData.js       Lectura del contexto, sin lógica
├── config/
│   ├── platform.js       PLATFORM_OWNERS (comodidad de UI, NO seguridad)
│   ├── plans.js          Planes comerciales — fuente única de precios
│   ├── seedData.js       Estado inicial vacío
│   └── theme.js          Tema white-label por negocio
├── pages/
│   ├── LandingPage.jsx   Landing pública
│   ├── client/           Reserva en /:businessSlug
│   ├── admin/            Panel del negocio
│   └── super-admin/      Panel global
└── utils/
    ├── availabilityEngine.js   ⚠️ NO TOCAR — anda
    └── statsCalculator.js      ⚠️ NO TOCAR — anda
```

### Reglas de oro

1. **Ningún componente habla con Firestore directo.** Todo por `repository.js`.
2. **Las suscripciones viven solo en `BusinessSync`.** Si cada hook abriera su
   listener, el mismo documento se cobraría una vez por componente montado.
3. **`availabilityEngine.js` y `statsCalculator.js` reciben arrays por
   argumento y no saben de dónde salen.** Mantenerlos así.
4. **El filtro del frontend NO es seguridad.** Lo que aísla los negocios son
   las Security Rules + custom claims. Nunca presentarlo como protección.

### Modelo de datos en Firestore

```
/slugs/{slug}                     → { businessId }        ⚠️ lectura pública
/businesses/{id}                  → marca, horarios, isFrozen  ⚠️ pública
  /private/billing                → deuda, abono           🔒 solo plataforma
  /professionals /services /schedules /professionalServices   ⚠️ públicas
  /staffContacts/{profId}         🔒 teléfono y mail del staff — NO va en
                                     /professionals, que es de lectura pública
  /appointments                   🔒 staff + dueño del turno
  /admins/{email}                 🔒 registro para UI, NO otorga permiso
/tickets/{id}                     🔒 su barbería + plataforma
  /messages/{id}
/platform/{doc}                   🔒 solo plataforma
/pendingAdmins/{email}            🔒 claims de quien no entró todavía
```

**Por qué la facturación va aparte:** el documento del negocio es de lectura
pública (la página de reservas necesita nombre, colores y horarios antes del
login). Si `debt` viviera ahí, cualquier cliente la leería.

**Por qué `/slugs` existe:** resolver `/barberia-x` sin ese mapa obligaría a
permitir listar toda la colección `businesses` — y ahí cualquiera se baja la
cartera de clientes.

**Por qué `/tickets` es de primer nivel y no subcolección:** para que el panel
global los liste con una query simple, sin `collectionGroup` ni su índice.

---

## Trampas ya pagadas (no volver a descubrirlas)

- **Firestore lee del caché.** Un `getDocs` que devuelve 0 documentos NO prueba
  que la base exista ni que las reglas permitan. Verificar con
  `getDocsFromServer` o por REST.
- **Los custom claims tardan hasta 1 hora** en aparecer en el token. Después de
  asignar uno hay que llamar `getIdToken(true)` o cerrar y abrir sesión.
- **Vite congela las `VITE_*` al compilar.** Agregarlas en Vercel no alcanza:
  hace falta un build nuevo.
- **`vercel.json` valida contra un esquema estricto** y rechaza propiedades
  extra. No poner comentarios `//` como en `package.json`.
- **Es una SPA:** sin la reescritura de `vercel.json`, toda ruta que no sea la
  raíz da 404 de Vercel.
- **Firestore no borra en cascada.** Al eliminar un profesional o servicio hay
  que limpiar a mano lo que cuelga (`replaceMatching(..., [])`).
- **El bypass de login (`import.meta.env.DEV`) ya no sirve para nada** que toque
  Firestore: no es sesión de Firebase, las Rules lo rechazan.
- **La consola del navegador acumula errores entre navegaciones.** Antes de
  diagnosticar, recargar limpio.
- **La carpeta está anidada: `codesSYNC/BarberOS/BarberOS`.** `firebase.json`
  vive en la de adentro. Corrido desde la de afuera, cualquier `firebase deploy`
  falla con *"Not in a Firebase app directory"*. Verificá con `ls firebase.json`
  antes de desplegar.
- **Los reemplazos por script fallan con CRLF.** Varios archivos tienen finales
  de línea Windows; usar la herramienta Edit o verificar siempre el resultado.
- **En Rules, `request.query.limit` es `null` si la query no puso límite**, y
  `null <= 100` es un error de tipos que cuenta como denegado. Peor: condicionar
  un `list` al límite no verifica de quién son los datos. La regla de
  `appointments` tenía las dos cosas — un cliente logueado con un `limit` se
  llevaba nombre y teléfono de todos los turnos del negocio, y "Mis Citas"
  fallaba para todos. Para listados de a-uno-mismo la condición va sobre
  `resource.data`, no sobre la forma de la query.
- **Los turnos guardan la fecha en `appointmentDate`, NO en `date`.** Todo el
  código lo usa así (`BookingPage`, `AppointmentsPage`, `DashboardPage`,
  `MyAppointments`, `availabilityEngine`). Sembrar datos de prueba con `date`
  hace que el motor de disponibilidad no bloquee los slots y parezca un bug de
  doble reserva que no existe.
- **En las Functions, nunca `admin.firestore.FieldValue`.** El emulador envuelve
  `firebase-admin` en un proxy para interceptar `initializeApp` y en el camino
  pierde los namespaces perezosos: llega `undefined` y revienta recién en
  runtime, adentro del callable. Usar siempre los submódulos
  (`require('firebase-admin/firestore')`). Este bug estaba en el código desde
  el principio y no se veía porque las functions nunca se habían ejecutado.
- **Listar un módulo en `manualChunks` lo mete en el bundle aunque nadie lo
  importe.** Así entraba `firebase/storage`, para una feature que todavía no
  existe. Agregar ahí solo lo que de verdad se usa.
- **Un `npm run dev` con HMR arrastra módulos viejos.** Después de tocar
  `src/lib/firebase.js` la consola puede mostrar errores de la versión anterior
  (se reconocen por el `?t=` en la URL del stack). Abrir pestaña nueva antes de
  diagnosticar; `vite.config.js` sí reinicia el server solo.

---

## Verificación rápida sin abrir el navegador

La API key es pública por diseño (va en el bundle).

```bash
KEY=AIzaSyA2utnIdWsuBuxBhzGis_e1quOtbB11nUQ
BASE="https://firestore.googleapis.com/v1/projects/barberos-1d60e/databases/(default)/documents"

# Sin login: 404 = la regla permitió (doc no existe) | 403 = denegado
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/businesses/x?key=$KEY"
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/businesses?key=$KEY"
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/tickets/x?key=$KEY"
```

Esperado: `404`, `403`, `403`.

Qué está desplegado en producción:

```bash
B=$(curl -s https://barberos.sacia.tech/ | grep -o '/assets/index-[A-Za-z0-9_-]*\.js' | head -1)
curl -s "https://barberos.sacia.tech$B" | grep -c "TEXTO_A_BUSCAR"
```

---

## Próximos pasos, en orden

1. **Activar Blaze y desplegar Cloud Functions** ← desbloquea la venta.
   El código ya está cableado y probado: falta solo el deploy.
2. **Trámite de Meta para WhatsApp** — tarda 1-2 semanas, arrancar en paralelo
3. **⛔ CONFIRMADO ROTO: `barberos.sacia.tech` NO está en los dominios
   autorizados de Firebase Auth.** Nadie puede iniciar sesión en producción —
   el login falla con `auth/unauthorized-domain`. Firebase trae `localhost` y
   `*.firebaseapp.com` por defecto, pero un dominio propio hay que agregarlo a
   mano, y nunca se hizo. Por eso no se notaba: siempre se probó en localhost.
   Se arregla en Authentication → Settings → Authorized domains → Add domain.
   No hay comando de CLI para esto, es sí o sí por consola
4. Sacar el SDK de Firebase del camino crítico de la landing. **El split por
   rutas ya está hecho** (`vite.config.js` tiene `manualChunks` y cada página es
   su propio chunk): lo que falta es otra cosa. Hoy quien entra a ver precios
   baja 265 kB gzip, de los cuales 164 kB son Firebase, que la landing no usa.
   Sin él serían 101 kB — 62% menos. No es cambiar un import: `App.jsx` importa
   `LoginPage` eager y los tres contexts importan firebase a nivel de módulo,
   así que hay que desmontar los providers de la raíz y montarlos dentro de las
   rutas de app. Toca `main.jsx`, `App.jsx` y los contexts.
5. Revisar `src/components/landing/HeroMotionMockup.jsx` y
   `FloatingActionWidget.jsx` (generados por Antigravity, sin auditar)
6. Monitoreo global de turnos: hoy la pestaña del panel global solo muestra el
   negocio activo. Necesita `collectionGroup` + regla nueva.
7. ~~Validar el precio del turno~~ — **resuelto por `createAppointment`**, que
   además valida fecha, profesional, servicio, horario, solapamiento y negocio
   suspendido. Queda pendiente solo cerrar el `allow create` directo: es el
   paso 2 del checklist post-Blaze
8. Alcance del barbero. La landing promete "cada barbero ve solo sus propios
   turnos", pero eso lo hace **solo la UI**: las Rules dan a cualquier
   `isBusinessStaff` lectura y escritura sobre toda la agenda del negocio.
   Verificado: un barbero puede editar el turno de otro. No es fuga entre
   barberías y el empleado es de confianza, pero no es lo que se promete.
   Apretarlo exige revisar antes qué vistas del panel necesitan la agenda
   completa (`DashboardPage` calcula estadísticas sobre todos los turnos), así
   que no es un cambio de una línea
9. Subir logo por barbería (Firebase Storage)
10. PWA

---

## Qué NO hacer

- ❌ NO construir registro self-service ni checkout de suscripción
- ❌ NO leer Firestore desde un componente: siempre por `repository.js`
- ❌ NO abrir `onSnapshot` fuera de `BusinessSync`
- ❌ NO tocar `availabilityEngine.js` ni `statsCalculator.js`
- ❌ NO commitear `.env` ni `serviceAccountKey.json`
- ❌ NO presentar el filtro del frontend como aislamiento de seguridad
- ❌ NO inventar testimonios, logos de clientes ni métricas en la landing:
  todavía no hay clientes
- ❌ NO usar violeta ni azul: la paleta es naranja `#e03d00` sobre casi-blanco

---

## Identidad visual

Tomada de [sacia.tech](https://sacia.tech).

- Naranja: `#e03d00` · variante clara `#ff5c1a`
- Fondos: `#fafafa` base, `#f2f2f2` secciones alternadas, `#ffffff` tarjetas
- Texto: `#0a0a0a` / `#555555` / `#aaaaaa`
- Tipografías: **Space Grotesk** (títulos, peso 700, tracking negativo) y
  **Space Mono** (etiquetas en mayúscula, tracking amplio)
- Radio de esquinas: 8px parejo. Sin degradados en la marca.

Todo sale de variables CSS en `:root` de `src/index.css`. Cambiar ahí, no en
los componentes.

---

## Documentos del repo

| Archivo | Confiabilidad |
|---|---|
| `CLAUDE.md` (este) | ✅ al día |
| `FIREBASE_SETUP.md` | ✅ guía de migración, sirve de referencia |
| `ROADMAPdesde2352026.md` | ⚠️ actualizado, pero el histórico de sprints tiene ruido |
| `PROJECT_CONTEXT.md` | ❌ **desactualizado**, describe el diseño original de un solo negocio |

Ante cualquier duda, **el código manda sobre los documentos**.
