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

- Las ocho `VITE_*` (incluida `VITE_FIREBASE_VAPID_KEY`, la clave pública de
  Web Push) están en **Vercel → Settings → Environment Variables**.
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
- Reserva pública con motor de disponibilidad. **Se mira sin cuenta**: el link
  muestra equipo, servicios y grilla; el login se pide recién al cargar los
  datos (paso 5), y al volver sigue donde estaba. El staff también agenda a
  mano desde Citas (para el cliente que pide por WhatsApp).
- El barbero (rol `admin`) edita su propia ficha y horarios, atiende su agenda
  (confirmar / completar / no asistió / cancelar / agendar) y abre tickets.
- El cliente puede cancelar solo hasta `minCancelHours` antes (Configuración);
  después tiene que escribir a la barbería. Se hace cumplir en el front.
- **Agenda del día** (`AgendaDelDia`): el inicio del panel, para dueño y
  barbero, es un calendario vertical del día — hora grande a la izquierda,
  cliente/servicio/teléfono a la derecha, acciones en cada turno, navegación
  por día y filtro por barbero. Pensado para leerse en el celular.
- **Notificaciones in-app** (campanita en el topbar): `onNuevoTurno` y
  `onTurnoCancelado` (triggers de Firestore en Functions) escriben en
  `businesses/{id}/notifications`; el dueño ve todas, el barbero las suyas;
  se marcan leídas por `leidaPor.{uid}`. Con permiso, también avisa por
  notificación del navegador. Cuando llegue WhatsApp, sale del mismo trigger.
  No se notifica lo que cargó el propio staff (`type` walkin/manual) ni lo
  que canceló el staff (`cancelledBy !== 'client'`).
- **PWA + push.** El panel se instala en el celular (`manifest.webmanifest`,
  íconos en `public/icons/`, generados con `scripts/generar-iconos.mjs`) y
  recibe notificaciones push por Firebase Cloud Messaging con la app cerrada.
  Piezas: `public/firebase-messaging-sw.js` (service worker: SOLO push y click,
  no cachea la app a propósito), `src/lib/push.js` (permiso, token, estado por
  dispositivo), `businesses/{id}/devices/{token}` (un doc por teléfono, uid
  propio), y `enviarPush()` en Functions, llamado desde el mismo `notificar()`
  de la campanita: dueño todo, barbero lo suyo; los tokens muertos se borran.
  `/admin/instalar` es el tutorial paso a paso (iPhone/Safari, Android/Chrome,
  escritorio) con el botón "Activar avisos" y el estado real del dispositivo.
  Badge en el ícono con las no leídas. Requiere `VITE_FIREBASE_VAPID_KEY`
  (clave pública de Web Push) en `.env` **y en Vercel**.
  iPhone: solo con la app en la pantalla de inicio y iOS 16.4+; el permiso se
  pide desde un toque adentro de la app instalada.
- **Notificaciones de la plataforma** (campanita del panel global, dueño y
  moderadores): ticket nuevo, respuesta de una barbería en un ticket, y cuenta
  suspendida por deuda (desde `procesarFacturacion`). Viven en
  `platform/notifications/items`; push a `platformDevices/{token}` con el
  mismo `push.js` (`plataforma: true`). Cada aviso trae `url` y la campanita
  navega ahí (`/super-admin?tab=soporte`; el dashboard lee `?tab=`). El
  primer mensaje de un ticket no se avisa dos veces: entra en el mismo batch
  que el ticket y `createdAt` coincide (serverTimestamp resuelve al mismo
  instante en todo el batch).
- **Mobile**: todo el panel, la reserva y la landing verificados a 375px sin
  desborde horizontal. En el celular las citas son tarjetas (no tabla), las
  tablas de gestión esconden columnas secundarias (`.oculta-mobile`), las
  grillas inline de dos columnas pasan a una, y el stepper de reserva se
  reparte el ancho.
- Sistema de tickets de soporte (chat barbería ↔ plataforma).
- Landing pública de venta en la raíz.
- Identidad visual de SACIA aplicada.

---

## ✅ Blaze activo, Functions desplegadas

Desplegadas en `southamerica-east1`: `setBusinessAdmin`, `revokeBusinessAdmin`,
`applyPendingClaims`, `createAppointment`, `createOwnerWithPassword`,
`resetOwnerPassword`, `setPlatformModerator`, `deleteBusiness`, `getBusySlots`, los triggers
`onNuevoTurno` / `onTurnoCancelado` / `onTicketNuevo` / `onMensajeDeTicket` y `runBilling` (3 AM, hora de Buenos
Aires). Quedó puesta la política que borra imágenes de contenedor de más de un
día, para que no se acumule costo de almacenamiento.

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://southamerica-east1-barberos-1d60e.cloudfunctions.net/setBusinessAdmin
```

`400`/`401` = desplegada y validando. `404` = se cayó el deploy.

El checklist post-Blaze está completo: el fallback de permisos de
`AuthContext` se sacó en la auditoría de seguridad. Sin claims, sos cliente.

### Moderadores

Equipo de soporte con acceso al panel global. Un moderador **ve todo y atiende
tickets**; **no** da de alta cuentas, no registra pagos, no cambia planes, no
suspende, no nombra moderadores y no lee el contacto personal del staff.

Lleva el claim `platform: 'moderator'` y NO `platform: true` a propósito: todo
lo que exige `platform === true` —Rules y functions— lo deja afuera por defecto,
y lo que puede hacer se le concede explícitamente con `esEquipoPlataforma()`.
Es la diferencia entre "tiene lo que se le dio" y "tiene todo salvo lo que se le
sacó".

Se nombran desde `/super-admin` → **Equipo** (pestaña que solo ve el dueño).
`setPlatformModerator` los crea, los quita (y les corta las sesiones), y usa el
mismo mecanismo de pendientes que los admins de barbería para quien nunca entró.

En el frontend: `user.isModerator`, `user.isPlatformTeam` (dueño o moderador).
El panel esconde lo que no puede hacer; la barrera real son las Rules.

### Entrar sin Gmail

En el alta se elige **cómo entra el dueño**: con su cuenta de Google, o con un
usuario y contraseña que genera la plataforma. Lo segundo es para el barbero que
no usa Gmail o no quiere mezclarlo con lo personal.

`createOwnerWithPassword` crea la cuenta y devuelve la contraseña **una sola
vez**: Firebase guarda el hash, no el texto. Si se pierde, se genera otra con
`resetOwnerPassword` (que además corta las sesiones abiertas con la vieja).

Crear cuentas es exclusivo de la plataforma. Un dueño puede dar de alta barberos
con `setBusinessAdmin`, pero no fabricar usuarios.

**Requiere habilitar el proveedor** en Firebase → Authentication → Sign-in
method → Email/Password. Sin eso, el login con contraseña falla con
`auth/operation-not-allowed` aunque la cuenta exista.

Los permisos no cambian en nada: son los mismos custom claims, y no saben con
qué proveedor entró la persona.

### Quien entra y no tiene barbería

No hay registro self-service **y es a propósito**, pero antes eso dejaba un
agujero: el barbero curioso que entraba a la landing, tocaba "Iniciar Sesión" y
se logueaba con su Google volvía a la landing **sin ningún mensaje**. Quedaba
pensando que había fallado, y era justo el lead más caliente.

Ahora cae en `/cuenta`, que le explica que las cuentas las activa la plataforma
y le da el botón de WhatsApp.

Ojo con el detalle que casi lo rompe: `Header` es compartido entre la landing y
la página de cada barbería. Si el link a `/login` no lleva `state.from`, un
cliente parado en `/su-barberia` que toca "Iniciar Sesión" también terminaría en
`/cuenta` en vez de volver a reservar. Por eso `Header` y `MyAppointments` pasan
su `pathname`, y `LoginPage` descarta `/` y `/login` como orígenes — volver ahí
es justamente el problema que esto resuelve.

### Límite de barberos por plan

`maxBarbers` (en `config/plans.js`) ahora se hace cumplir: al llegar al tope, el
botón de agregar se deshabilita y aparece un aviso con el link para ampliar. Se
cuentan solo los ACTIVOS, así que desactivar a alguien que se fue libera el
lugar. Se compara al agregar y no al editar, para que una barbería que quedó por
encima del tope —porque le bajaron el plan— pueda seguir administrando a los que
tiene en vez de quedar trabada.

**Es un límite comercial, no una barrera de seguridad**: vive en la interfaz y
alguien con la consola abierta podría saltearlo. Igual que cualquier tope de
plan en una app de browser. Lo que protege los datos son las Rules, y la
cantidad de barberos no es un dato a proteger. Si algún día se cobra por
barbero de verdad, hay que moverlo a una Cloud Function.

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

35 casos: precio falsificado, fecha pasada, profesional y servicio inexistentes,
servicio que ese profesional no hace, fuera de horario, en el descanso, día que
no trabaja, teléfono inválido, un turno por día, doble reserva, negocio
suspendido, sin sesión, tope de turnos a futuro y `getBusySlots`.

**Tope por cuenta.** Además de un turno por día, una cuenta no puede tener más
de `MAX_TURNOS_ACTIVOS` (3) turnos activos de hoy en adelante en la misma
barbería. Es lo que hace inútil llenarle la agenda al barbero con una sola
cuenta. Los pasados no cuentan aunque hayan quedado `pendiente`; los cancelados
tampoco. Se cuenta en la misma transacción, con una sola lectura por `userId`
filtrada en memoria — a propósito: un `where` por uid + rango de fecha pediría
un índice compuesto que el emulador no exige y producción sí.

**`getBusySlots`.** Devuelve `{ ocupados: [{ startTime, endTime }] }` de un
profesional en un día. Existe porque al cerrar la agenda a los clientes en las
Rules (correcto: tiene datos de otros), la grilla del cliente quedó ciega —
mostraba libre lo que ya estaba tomado y cada reserva moría en "ese horario ya
fue tomado". `BookingPage` la llama al elegir profesional y día. No expone ni
un campo más que las horas.

**Turno agendado por el staff.** `NuevoTurnoModal` (botón "Agendar turno" en
Citas) escribe directo a Firestore, NO por la function: la function cuenta los
turnos del uid que llama, y frenaría al barbero en el cuarto que cargue. Las
Rules ya permiten al staff crear en su propia agenda. Nace `pendiente` y se
confirma acto seguido. Lleva `type: 'manual'` y `userId` del que lo cargó.

---

## Seguridad — modelo y auditoría (17/09/2026)

**Modelo.** Los permisos son custom claims escritos solo por Functions con el
Admin SDK; las Rules los verifican en cada lectura y escritura; el frontend
solo esconde. Ya **no hay fallback** de permisos en `AuthContext`: sin claims,
sos cliente. Todo lo que un cliente puede escribir sobre la agenda pasa por
`createAppointment`. Los datos públicos (negocio, staff, catálogo, horarios)
no tienen nada personal; lo personal (contacto del staff, facturación, turnos)
está cerrado por rol.

**Qué se auditó y qué se arregló:**

- **Prueba gratis editable por el dueño (alta).** `runBilling` lee
  `trialEndsAt` del documento público del negocio, y ese campo no estaba en la
  lista de campos que el dueño no puede tocar: con la consola abierta se ponía
  la prueba en 2099 y no pagaba nunca. Protegido en Rules (`trialEndsAt`,
  `createdAt`, `maxBarbers`).
- **Robo de permisos pendientes (alta).** La API pública de Firebase Auth deja
  crear cuentas de email+contraseña con cualquier mail, sin verificarlo.
  `applyPendingClaims` entregaba el rol pendiente a quien tuviera ese mail en
  el token, y `setBusinessAdmin` se lo daba directo a una cuenta ya existente.
  Ahora los dos exigen `email_verified` (Google verifica; las cuentas que crea
  la plataforma nacen verificadas; las de un intruso, no).
- El staff no puede crear turnos con el `userId` de otra cuenta (le aparecían
  en "Mis citas" a esa persona).
- El cliente solo cancela turnos vivos (`pendiente`/`confirmada`); antes podía
  pasar uno `completada` a `cancelada` y tocar la caja.
- `clientEmail` del turno sale del token, no del cuerpo de la llamada.
- Contraseñas que crea la plataforma: mínimo 8 (era 6).
- Cabeceras en Vercel: HSTS, nosniff, X-Frame-Options DENY, Referrer-Policy,
  Permissions-Policy. Sin CSP todavía (Firebase + fuentes de Google lo hacen
  delicado; hacerlo en modo report-only primero).
- Dependencias: `functions/` subido a firebase-admin 14 y firebase-functions 7,
  con `overrides` de `uuid` → **0 vulnerabilidades** en las dos raíces.
- Verificado: no hay secretos en el repo ni en su historia (`.env` y
  `serviceAccountKey.json` ignorados; la API key web es pública por diseño);
  el bypass de login de desarrollo no está en el bundle de producción; no hay
  `innerHTML`/`eval`; los `from` del login son estado interno, no URL.

**Lo que hace falta hacer a mano en la consola de Firebase (Authentication →
Settings):**

1. ~~User actions → desactivar "Enable create (sign-up)"~~ **NO. Tiene que
   estar PRENDIDO.** Se probó apagarlo y rompió el primer login de todos: ese
   interruptor bloquea la creación de la cuenta de Auth con CUALQUIER
   proveedor, y el primer "Continuar con Google" de un barbero nuevo o de un
   cliente que viene a reservar ES una creación (`auth/admin-restricted-
   operation`, que el front mostraba como "No se pudo iniciar sesión con
   Google"). La barrera contra el robo de pendientes es el `email_verified`
   de las Functions, que alcanza.
2. **Activar "Email enumeration protection"**: sin eso, el endpoint de login
   dice si un mail existe o no.
3. **Password policy**: mínimo 8, mayúscula y número, para las cuentas con
   contraseña.

**Lo que queda, en orden:**

- **App Check (reCAPTCHA v3)** sobre los callables: hoy `getBusySlots` es
  pública y `createAppointment` exige login pero no que la llamada venga de
  la web real. `maxInstances: 10` acota el costo, no el abuso.
- **Cancelación del cliente**: `minCancelHours` se hace cumplir solo en el
  front (las Rules no pueden comparar strings de fecha con `request.time`).
  Si importa, mover la cancelación a un callable.
- **Bloquear cliente** desde el panel, para la cuenta que se porta mal.
- CSP en report-only.

Cómo repetir la auditoría técnica: las cuatro suites del emulador (92 casos
de Rules cubren aislamiento, auto-beneficio, robo de pendientes y batches),
`npm audit --omit=dev` en la raíz y en `functions/`,
`git grep -nE "AIza|PRIVATE KEY|GOCSPX"`, y `grep -c "ACCESO R" dist/assets/*.js`
después de un build (tiene que dar 0).

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
   Y en `repository.js` todas pasan por `escuchar()`, nunca `onSnapshot` a
   pelo: descarta los snapshots vacíos que vienen del caché (con la red a
   medio volver, Firestore emitía "cero de todo" y el panel pisaba los datos
   buenos), y reintenta con espera creciente si el listener muere (onSnapshot
   solo no vuelve a intentar nunca). Era el "de la nada el panel muestra cero
   barberías y no se arregla sin F5".
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
  /notifications                  🔒 dueño todas; barbero las suyas. Las
                                     escribe un trigger; el browser solo
                                     marca leídas
  /devices/{token}                🔒 tokens de push; cada uno crea/borra los
                                     suyos, nadie lista
  /admins/{email}                 🔒 registro para UI, NO otorga permiso
/tickets/{id}                     🔒 su barbería + plataforma
  /messages/{id}
/platform/{doc}                   🔒 solo plataforma
  /notifications/items/{id}       🔒 campanita del panel global (dueño y
                                     moderadores); las escribe un trigger
/platformDevices/{token}          🔒 push del equipo de la plataforma
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
- **Que una regla permita la consulta correcta no prueba que la app la haga.**
  `subscribeMyAppointments` existió desde el principio, la auditoría probó que
  las Rules la permiten, y nadie la llamaba: `BusinessSync` pedía la agenda
  entera para el cliente, las Rules se la negaban, y "Mis citas" estuvo vacío
  para todos hasta que un usuario real lo notó. Ahora la suscripción se arma por
  rol (dueño todo, barbero lo suyo, cliente lo suyo, anónimo lo público). Si
  agregás una regla con `resource.data`, revisá quién hace la consulta.
- **En un batch, `get()` en las Rules ve el estado ANTERIOR al batch.** El
  ticket y su primer mensaje se escriben juntos; la regla del mensaje hacía
  `get(ticket).data.businessId`, el ticket todavía no existía, y `.data` de
  null revienta → denegado. Nadie podía abrir un ticket. Para leer otro doc
  del mismo batch es `getAfter()`. La suite de rules ahora prueba el batch tal
  como lo manda la app (`commit` en `auditar-rules-emulador.mjs`).
- **Las suites comparten `biz-test` en el emulador.** Un seed a mano (o la
  suite de claims) que deje horarios o servicios de más rompe "día que no
  trabaja" y "servicio que no hace" en la de reservas. Cada suite limpia sus
  subcolecciones al arrancar; si agregás una, hacé lo mismo.
- **`new Date().toISOString()` es UTC.** A partir de las 21:00 en Argentina
  ya es mañana: el walk-in y "Hoy" del panel caían en el día equivocado. Para
  fechas locales, `toDateString(new Date())` de `dateUtils`.
- **Los Timestamps de Firestore no son fechas de JS.** `new Date(timestamp)` da
  `Invalid Date`. Es `timestamp.toDate()`.
- **El primer deploy de un trigger de Firestore falla con "Permission denied
  while using the Eventarc Service Agent".** Es la primera vez que el
  proyecto usa Eventarc y los permisos tardan unos minutos en propagarse.
  Esperar 2 minutos y repetir `firebase deploy --only functions:<nombre>`.
- **Dos `match` sobre la misma ruta se SUMAN.** Si cualquiera permite, pasa.
  Había un `match /notifications` viejo (log de WhatsApp que nunca existió)
  que le daba lectura a todo el staff, y anulaba el nuevo que filtra por
  barbero. Antes de agregar un match, `grep "match /"` para ver si ya existe.
- **El panel de navegador de Claude bloquea los service workers y niega
  `Notification`.** La PWA y el push no se pueden probar ahí: se prueban en un
  teléfono real. Lo que sí se prueba desde el emulador es el camino del
  servidor: sembrar un doc en `devices` con un token falso y reservar; el
  trigger llama a FCM de verdad, FCM rechaza el token y el doc se borra.
- **Un trigger que escribe `undefined` en Firestore muere.** `onNuevoTurno`
  reventaba con turnos sin `appointmentDate` (los que siembra la suite de
  rules). Todo lo que se copia de un doc a otro va con `|| null`.
- **"Enable create (sign-up)" apagado en Firebase Auth rompe el primer login
  con Google.** No es "registro con contraseña": es crear la cuenta de Auth
  por cualquier proveedor. Síntoma: "No se pudo iniciar sesión con Google"
  para todo usuario nuevo, mientras los que ya entraron alguna vez siguen
  entrando. Dejarlo prendido. Ahora el mensaje del front trae el código.
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

### Manual — nadie más lo puede hacer

1. **Trámite de Meta para WhatsApp** — tarda 1-2 semanas, conviene arrancarlo en
   paralelo con lo demás. Hasta entonces la landing lo marca "pronto".
2. **Ensayo en producción.** Todas las suites corren contra emulador; el
   recorrido completo en producción real (alta con días de prueba → dueño
   carga servicios/barberos/horarios → cliente reserva desde incógnito → se ve
   en el panel y en "Mis citas") nunca se hizo.

Ya resueltos y verificados: dominio `barberos.sacia.tech` autorizado,
Email/Password habilitado, alcance del barbero cerrado en Rules.

### Producto — hace falta decidir antes de programar

3. **Días de demo.** La landing dice `DIAS_DEMO = 10`; en el alta se tipean cada
   vez. Elegir un número y usar siempre ese.
4. **Planes.** Lo único que el sistema hace cumplir es `maxBarbers`. La landing
   ya lo refleja: cada tarjeta muestra solo lo que la diferencia (barberos,
   cuota de avisos "pronto", soporte) y lo común va en un bloque aparte
   (`FEATURES_COMUNES`). Cuando lleguen los avisos por WhatsApp, la cuota es la
   segunda diferencia real. No restar funciones al Básico para diferenciar.
5. **Seña por Mercado Pago.** No empezado. El modelo correcto es OAuth de
   Mercado Pago ("Conectar con Mercado Pago" en Configuración): el dueño
   autoriza con su cuenta, MP le da a la plataforma un token de SU cuenta y la
   plata va directo a él, sin que nadie tipee credenciales. Hace falta antes:
   una aplicación creada en el panel de desarrolladores de MP (client_id +
   client_secret como secrets de Functions, redirect URL), y decidir monto de
   seña (fijo o %), qué pasa si no paga en N minutos (se libera el turno) y
   si se devuelve al cancelar. Se construye recién con las credenciales, para
   probarlo de verdad.
6. **Abuso de reservas.** Hecho: un turno por día y tope de 3 a futuro por
   cuenta. Falta, por orden: bloquear cliente desde el panel (para la cuenta que
   se porta mal), y App Check con reCAPTCHA v3 sobre los callables para frenar
   scripts. Ninguno hace falta para la demo con amigos.

### Técnico, cuando haya tiempo

7. Sacar el SDK de Firebase del camino crítico de la landing. **El split por
   rutas ya está hecho**: lo que falta es otra cosa. Hoy quien entra a ver
   precios baja 265 kB gzip, de los cuales 164 kB son Firebase, que la landing
   no usa. Sin él serían 101 kB — 62% menos. `App.jsx` importa `LoginPage` eager
   y los tres contexts importan firebase a nivel de módulo, así que hay que
   desmontar los providers de la raíz y montarlos dentro de las rutas de app.
8. Revisar `src/components/landing/HeroMotionMockup.jsx` y
   `FloatingActionWidget.jsx` (generados por Antigravity, sin auditar).
9. Monitoreo global de turnos: hoy la pestaña del panel global solo muestra el
   negocio activo. Necesita `collectionGroup` + regla nueva.
10. ~~Sacar el fallback de permisos de `AuthContext`~~ Hecho en la auditoría
    de seguridad.
11. Los 3 errores de lint que quedan son `react-refresh/only-export-components`
   en los contexts: mover los hooks a otro archivo toca todos los imports y no
   cambia el comportamiento. Con eso el lint queda en cero y se puede poner CI.
12. ~~Borrado en cascada~~ Hecho: `deleteBusiness` (solo dueño de plataforma,
    con el nombre exacto como confirmación) borra negocio, subcolecciones,
    slug, tickets, pendientes, y les vacía los claims a todos los usuarios
    del negocio. Botón "Eliminar barbería" en el panel global.
    `deleteBusinessRecord` de repository.js quedó sin uso.
13. Subir logo por barbería (Firebase Storage).
14. ~~PWA~~ Hecha, con push. Falta: TWA para Play Store si algún cliente lo
    pide (misma web envuelta con Bubblewrap).

---

## Cómo probar sin tocar producción

```bash
firebase emulators:start --only auth,firestore,functions
node scripts/test-claims-emulador.mjs      # permisos y cuentas con contraseña
node scripts/test-reservas-emulador.mjs    # validación de turnos
node scripts/test-billing-emulador.mjs     # cobro, suspensión y prueba gratis
node scripts/auditar-rules-emulador.mjs    # aislamiento entre barberías
```

Hoy: claims 64, reservas 35, facturación 11, rules 106. Todo en verde.

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
