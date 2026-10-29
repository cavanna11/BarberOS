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

### Modelo de venta: dos puertas (23/09/2026)

1. **Alta sola, con 5 días de prueba.** Quien entra con Google y no tiene
   barbería cae en `/cuenta` y se la crea solo: nombre, link, teléfono. La
   cuenta nace andando (el dueño cargado como primer barbero, tres servicios y
   horario), marcada `origen: 'autoservicio'`, y a los 5 días la corta la
   facturación sola, por el mismo camino que cualquier cuenta impaga. Cada alta
   le avisa a la plataforma (campanita + push).
2. **Onboarding manual**, el de siempre: el cliente escribe por WhatsApp y la
   cuenta se prepara desde `/super-admin` → "Nueva barbería", lista para
   entregar. El CTA de la landing sigue yendo a WhatsApp.

La primera existe porque el barbero que entra un sábado a la noche a curiosear
no espera al lunes. La segunda, porque al que quiere que se la dejemos lista
conviene acompañarlo.

El alta sola es la ÚNICA puerta por la que alguien de afuera crea datos, así
que tiene cuatro cerrojos (ver `crearBarberiaDePrueba`): mail verificado, una
barbería por cuenta —chequeada contra los claims reales, no contra el token,
que se queda viejo una hora—, slug tomado en transacción con lista de
reservados, y tope de altas por día.

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
- **Horario cortado** (de 8 a 16 y de 19 a 22), tanto del local como de cada
  barbero: `HorarioSemanal` es el único editor de horario (Configuración,
  Profesionales, Mi Configuración). Se guarda como `breakStart`/`breakEnd`
  dentro del día; el motor, `createAppointment` y la agenda lo respetan.
  Validación en `utils/horarios.js` (`errorDeHorario`), en vivo y al guardar.
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
- **Ficha de la barbería** en la reserva (`FichaBarberia`): presentación
  (`welcomeMessage`), dirección + "Cómo llegar" (`mapsUrl` si es un link de
  Google Maps de verdad —se valida contra una lista de dominios porque
  termina en un href público—, o búsqueda por dirección+ciudad), Instagram y
  WhatsApp (`socialLinks`). Compacta arriba del paso 1; completa en la
  confirmación. Todo se edita en Configuración.
- **Foto de perfil del barbero**: `avatarUrl` como data URL JPEG de ≤320 px
  (`utils/imagen.js` la achica en el browser, ~20 KB) en el doc público del
  profesional; sin Firebase Storage a propósito. Las Rules acotan a 250 KB.
  La suben el dueño (Profesionales) o el barbero (Mi Configuración); se ve en
  la reserva, el resumen y la tabla.
- **Mobile**: todo el panel, la reserva y la landing verificados a 375px sin
  desborde horizontal. En el celular las citas son tarjetas (no tabla), las
  tablas de gestión esconden columnas secundarias (`.oculta-mobile`), las
  grillas inline de dos columnas pasan a una, y el stepper de reserva se
  reparte el ancho.
- **Cuentas con sucursales** (Plan Empresarial): hasta 4 barberías con una
  sola cuenta, cada una con su equipo, servicios, horarios, agenda y link.
  Selector de sucursal en el panel y pantalla **Mis sucursales** con el
  consolidado. El abono lo paga la principal y la suspensión arrastra a todo
  el grupo.
- **Ingresos del mes** e historial mes por mes, en el panel de la barbería y
  en el panel global (ahí, lo que BarberOS le cobró a las barberías).
- **Reseñas**: el cliente puntúa de 1 a 5 con comentario opcional, solo sobre
  turnos atendidos y una sola vez por turno. El panel muestra promedio,
  distribución y promedios por barbero y por sucursal, con filtros. Después de
  valorar se le ofrece dejarla también en Google.
- **WhatsApp por wa.me**: dos botones en cada turno (recordatorio y gracias)
  que abren WhatsApp con el mensaje escrito. Lo manda el barbero; no hay API,
  ni bot, ni envío automático.
- **El cliente elige sucursal**: el link de una cuenta con varias barberías
  arranca preguntando a cuál va, con nombre y dirección de cada una.
- **Funciones por plan**: foto del barbero y página de presentación desde el
  Intermedio; colores, logo y foto de portada desde el Full. Se hace cumplir en
  las Rules, no solo en la interfaz.
- **La página de presentación de la barbería**: el link puede abrir una mini
  landing (estilo Linktree) con el nombre, la presentación y botones grandes —
  reservar, cómo llegar, WhatsApp, Instagram— antes de la reserva. Tres
  plantillas, nace apagada, y la reserva de siempre queda en `/:slug/reservar`.
- **Los colores de la barbería llegan al cliente.** Hasta el 08/10/2026 se
  guardaban y no se aplicaban en ningún lado: la función que lo hacía no la
  llamaba nadie.
- **La vista previa del link** (WhatsApp, Instagram, Facebook) dice el nombre de
  la barbería y su presentación, no "BarberOS".
- Sistema de tickets de soporte (chat barbería ↔ plataforma).
- Landing pública de venta en la raíz.
- Identidad visual de SACIA aplicada.

---

## ✅ Blaze activo, Functions desplegadas

Desplegadas en `southamerica-east1`: `setBusinessAdmin`, `revokeBusinessAdmin`,
`applyPendingClaims`, `createAppointment`, `createOwnerWithPassword`,
`resetOwnerPassword`, `setPlatformModerator`, `deleteBusiness`, `getBusySlots`,
`migrarPlanes`, los triggers
`onNuevoTurno` / `onTurnoCancelado` / `onTicketNuevo` / `onMensajeDeTicket` y `runBilling` (3 AM, hora de Buenos
Aires). Quedó puesta la política que borra imágenes de contenedor de más de un
día, para que no se acumule costo de almacenamiento.

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://southamerica-east1-barberos-1d60e.cloudfunctions.net/setBusinessAdmin
```

`400`/`401` = desplegada y validando. `404` = se cayó el deploy.

El checklist post-Blaze está completo: el fallback de permisos de
`AuthContext` se sacó en la auditoría de seguridad. Sin claims, sos cliente.

### Equipo de la plataforma: moderadores y administradores

`setPlatformModerator` toma `rol: 'moderator' | 'admin'` y sirve para nombrar,
ascender y degradar (antes solo nombraba moderadores y para cambiar algo había
que quitar el acceso y volver a empezar):

- `moderator` → claim `platform: 'moderator'`. Mira y atiende soporte.
- `admin`     → claim `platform: true`. Acceso total, igual que el fundador.

Cambiar el rol corta las sesiones abiertas (`revokeRefreshTokens`): el rol vive
en el token y si no tarda hasta una hora en tomar efecto. Los mails de
`FUNDADORES` (functions/index.js) no se pueden degradar ni revocar desde el
panel: sin eso, el primer administrador que nombres puede dejarte afuera y
recuperarlo exige la clave de servicio.

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

Antes volvía a la landing **sin ningún mensaje**: quedaba pensando que había
fallado, y era justo el lead más caliente.

Ahora cae en `/cuenta`, que es el alta: se crea la barbería solo, con 5 días de
prueba, y entra derecho al panel. Abajo queda el botón de WhatsApp para el que
prefiere que se la dejemos lista.

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
mes.

**Para regalar una cuenta, el abono va en 0** (no los días de prueba): sin abono
no hay deuda, y sin deuda `runBilling` no la congela nunca. El alta y el cambio
de plan lo piden confirmar a mano, porque el campo vacío también vale 0 y esa es
la forma de regalar una cuenta sin querer; el panel global la muestra como
"🎁 De regalo" en vez de "$ 0", y al ponerla en 0 se le borra el `trialEndsAt`
—si no, el barbero vería "se terminó tu prueba" para siempre en una cuenta que
no se le va a cortar—. Hay dos casos en la suite de facturación.

```bash
node scripts/test-billing-emulador.mjs
```

20 casos: cobro, acumulación de varios vencimientos, suspensión, reactivación al
saldar, prueba vigente, prueba vencida, cuenta de regalo y el espejo del
vencimiento en el documento público.

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

40 casos: precio falsificado, fecha pasada, profesional y servicio inexistentes,
servicio que ese profesional no hace, fuera de horario, en el descanso, día que
no trabaja, teléfono inválido, un turno por día, doble reserva, negocio
suspendido, sin sesión, tope de turnos a futuro, promo por día y franja, y
`getBusySlots`.

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

**Promos por día y horario.** Un servicio puede llevar
`ventana: { dias: [1, 2], desde: '16:30', hasta: '19:30' }` (días en 0=Lunes …
6=Domingo, la convención de los horarios; `null` = siempre). Se configura en
Servicios ("Solo en ciertos días y horarios"); `utils/ventanaServicio.js` la
aplica en el calendario (días deshabilitados), en la grilla (el turno entero
tiene que caer adentro), en el modal del staff, y `createAppointment` la
repite en el servidor. Era el "corte de media tarde, martes y miércoles de
16:30 a 19:30, 10% menos", que antes vivía solo en la descripción.

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
    ├── availabilityEngine.js   ⚠️ NO TOCAR — anda (dos excepciones hechas: el
    │                              corte del local `corteLocal` 21/09/2026,
    │                              `normalizarIntervalo` 13/10/2026, que evita
    │                              el bucle infinito con slotInterval en 0, y
    │                              las `ausencias` 13/10/2026)
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
/grupos/{grupoId}                 → { principalId, businessIds }  ⚠️ lectura
                                    pública — las sucursales de una cuenta,
                                    para que el cliente elija a cuál va
/businesses/{id}                  → marca, horarios, isFrozen,
                                    grupoId (cuenta con sucursales),
                                    maxBarbers / maxSucursales,
                                    paginaActiva (interruptor de su página)
                                                            ⚠️ pública
  /private/billing                → deuda, abono           🔒 solo plataforma
  /public/pagina                  → su página de presentación: plantilla,
                                    portada, textos y botones  ⚠️ pública
  /professionals /services /schedules /professionalServices   ⚠️ públicas
  /staffContacts/{profId}         🔒 teléfono y mail del staff — NO va en
                                     /professionals, que es de lectura pública
  /appointments                   🔒 staff + dueño del turno
  /reviews/{appointmentId}        🔒 una por turno — el id ES el del turno
  /membresiaPlanes /membresias /membresiaUsos /membresiaPagos
                                  🔒 membresías de clientes (en la principal);
                                     solo las escriben Functions
  /recompensas /premios /recompensasClientes /recompensasSellos
                                  🔒 campañas de fidelización, premios y
                                     tarjetas; solo las escriben Functions
                                     (espejo público en `recompensas` del negocio)
  /notifications                  🔒 dueño todas; barbero las suyas. Las
                                     escribe un trigger; el browser solo
                                     marca leídas
  /devices/{token}                🔒 tokens de push; cada uno crea/borra los
                                     suyos, nadie lista
  /admins/{email}                 🔒 registro para UI, NO otorga permiso
/tickets/{id}                     🔒 su barbería + plataforma
  /messages/{id}
/platform/{doc}                   🔒 solo plataforma
  /cobros/items/{id}              🔒 un asiento por cada cobro de abono
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

### Push: tres fallas encadenadas (26/09/2026)

1. `webpush.fcm_options.link` llevaba ruta relativa y FCM exige HTTPS ahí: el
   mensaje entero se rechaza.
2. Se borraba el token con `invalid-argument`, que significa "el MENSAJE está
   mal", no "el teléfono no existe". Con (1), cada envío le borraba el registro
   a todo el equipo. Ahora solo borra `registration-token-not-registered` y
   toda falla queda logueada con su código.
3. Con la app ABIERTA no se mostraba nada: si hay una ventana visible, Firebase
   no dibuja el aviso, se lo pasa a la página — y nadie usaba `onMessage`. Era
   el caso más común. Ahora los dos layouts escuchan en primer plano.

Además el mensaje viaja con `notification` (no solo `data`) para que lo dibuje
el navegador aunque el service worker no corra, el SW tiene respaldo por si
falla `importScripts`, y la campanita usa `showNotification` del SW porque en
iPhone `new Notification` no existe. Todo con el mismo `tag` para no duplicar.

### Avisos a todas las barberías (26/09/2026)

`/super-admin` → **Avisos** publica un cartel que ve todo el staff arriba de su
panel, con botón opcional. Reemplaza el "le escribo por WhatsApp a cada uno".
Vive en `platform/avisos/items` (escribe la plataforma, lee cualquiera con
sesión) y cada uno lo cierra por dispositivo (localStorage).

Ojo: la consulta ordena por `createdAt`, y **Firestore excluye los documentos
que no tienen ese campo**. Un aviso sembrado a mano sin `createdAt` no aparece
nunca y parece que el cartel está roto.

### Cuentas con sucursales — Plan Empresarial (05/10/2026)

Una cuenta puede administrar hasta cuatro barberías. Cada sucursal es una
barbería COMPLETA y separada —su equipo, sus servicios, sus horarios, su agenda,
su link público, su configuración— y lo único que comparten es quién entra y el
abono.

**Cómo se atan.** Cada negocio del grupo lleva `grupoId`, que es el id del
negocio PRINCIPAL. Así el principal se reconoce solo (`grupoId === id`) y no hace
falta un flag aparte que pueda contradecir a la realidad.

**El permiso.** El dueño lleva en sus claims:

```
{ businessId: <principal>, role: 'owner', grupoId, businessIds: [...] }
```

`businessId` sigue existiendo y apuntando a una sola porque es lo que entiende
todo el código anterior; `businessIds` es la lista y es lo que miran las Rules
(`inBusiness` acepta las dos formas). **Un barbero NUNCA lleva `businessIds`**:
su claim nombra una sola barbería, así que el aislamiento entre sucursales le
sale gratis y no depende de ningún filtro del frontend.

**El agujero que esto abre, y cómo está cerrado.** Los claims del dueño se
calculan preguntándole a la base qué negocios comparten `grupoId`. Si el dueño
pudiera escribir ese campo, se metería la barbería de otro adentro de su cuenta y
en el siguiente recálculo se llevaría sus datos. Por eso `grupoId` (y
`maxSucursales`) están en la lista de campos que las Rules no le dejan tocar, en
`firestore.rules` y en `CAMPOS_SOLO_PLATAFORMA` de `repository.js`. Hay casos en
las dos suites.

**Abrir una sucursal** es `crearSucursal` (callable), no una escritura del
browser, por tres razones y cada una alcanza sola: el tope del plan es plata y en
la interfaz se saltea con la consola abierta; crear una barbería es documento +
slug + facturación en una sola operación y a medias queda inservible; y los
claims solo los escribe el Admin SDK. El tope se chequea DENTRO de la
transacción: dos pestañas creando la cuarta y la quinta a la vez pasarían las dos
un chequeo hecho antes. Nace vacía de equipo y catálogo (son datos de la
sucursal, no del grupo); lo único que se copia, y solo si lo piden, es la lista
de servicios, en documentos nuevos e independientes.

**La facturación es de la CUENTA.** El plan lo paga el principal y las sucursales
van con abono 0. `procesarFacturacion` hace dos pasadas: primero la deuda de cada
una, después la suspensión — y una sucursal se congela si debe el principal. Sin
eso, el dueño deja de pagar, se congela el principal y las otras tres siguen
tomando turnos: la palanca de cobro desarmada. Lo mismo vale para el botón de
suspender del panel global, que avisa y aplica a todo el grupo.

**Borrar.** La barbería principal de un grupo con sucursales NO se puede borrar
(quedarían sin plan, sin abono y sin forma de cobrarlas): primero las sucursales.
Y al borrar una sucursal, al dueño se le SACA esa de su lista en vez de vaciarle
los claims — antes, borrar una sucursal lo echaba de su propia cuenta.

**En el panel.** Selector de sucursal arriba del menú (cambia
`currentBusinessId`, el mismo mecanismo con el que la plataforma administra una
barbería) y una sección **Mis sucursales** con el consolidado de todas y los
números de cada una. Esa pantalla lee los turnos de a una y de UNA sola vez
(`obtenerSubcoleccion`), no con suscripciones: dejar cuatro agendas escuchando en
todas las pantallas del panel sería pagar cuatro veces lo mismo todo el tiempo.
El consolidado es una SUMA de números ya calculados por sucursal, nunca una
consulta que junte turnos de todas en una misma bolsa.

Trampa que costó un rato: entrar a la sucursal recién creada no se puede hacer en
el mismo momento de crearla. `SET_CURRENT_BUSINESS` se valida contra la lista de
negocios que tiene la app, y esa lista llega un instante después (primero el
token nuevo, después los datos). El dispatch se descartaba en silencio y uno
quedaba parado en la sucursal anterior. Ahora se espera a que aparezca.

```bash
node scripts/test-sucursales-emulador.mjs     # 60 casos
node scripts/sembrar-sucursales-emulador.mjs  # escenario para mirar en el browser
```

### Planes por capacidad e ingresos del mes (05/10/2026)

La escalera comercial dejó de ser "tres planes con cuota de WhatsApp" y pasó a
ordenarse por CAPACIDAD, que es lo único que el sistema hace cumplir de verdad:

| | sucursales | barberos | abono |
|---|---|---|---|
| Básico | 1 | 1 | $15.000 |
| Intermedio | 1 | 3 | $20.000 |
| Full | 1 | sin límite | $30.000 |
| Empresarial | 4 | sin límite | $60.000 |
| Personalizado | a convenir | a convenir | sin precio de lista (CTA) |

(Los precios quedaron cerrados el 06/10/2026; ver "Funciones por plan" más
arriba para lo que habilita cada uno.)

Un `monthlyFee` en null significa "precio todavía no definido": la landing
muestra **Consultanos** en vez de un número inventado y el alta pide tipear el
abono acordado. Hoy solo el Personalizado está así. **El abono no puede quedar
en 0**: `runBilling` suma el abono a la deuda y congela cuando la deuda es mayor
a cero, así que con 0 la cuenta queda gratis para siempre y los días de prueba no
cortan nada. Lo valida el alta y el cambio de plan.

Los topes se ESCRIBEN en el documento del negocio (`maxBarbers`,
`maxSucursales`) y no se dejan implícitos en el plan: así una cuenta conserva lo
que compró aunque la escalera cambie, y se le puede hacer una excepción sin
inventar un plan nuevo. `limitesDelNegocio()` resuelve la precedencia (el
documento manda sobre el plan) en el front, y `functions/planes.js` repite los
topes del lado del servidor — duplicado a propósito: las Functions no pueden
importar del bundle de Vite.

Los planes viejos (`pro`, `business`) quedan en `PLANES_HISTORICOS` y no se
borran: si el id desapareciera, `getPlan` daría null, el tope quedaría en "sin
límite" y el panel dejaría sumar barberos de gratis. **Ojo con `basico`**: el id
se reusa con un tope más bajo (2 barberos → 1). Como el tope se compara al
AGREGAR y no al editar, nadie pierde un barbero que ya tenga, pero a una cuenta
vieja de Básico con dos barberos hay que pasarla a Intermedio o dejarle el tope
viejo escrito en el documento.

**Ingresos del mes.** El panel de la barbería muestra lo facturado en el mes en
curso (con la variación contra el anterior) además del total histórico, y un
historial mes por mes. Está en `utils/ingresos.js`, aparte de
`statsCalculator.js` —que sigue marcado para no tocar— y con la misma regla:
recibe arrays y no sabe de dónde salen. Cuenta solo los turnos `completada`,
igual que el total que ya se mostraba.

**Ingresos de la plataforma.** Son otra caja: lo que BarberOS le cobra a las
barberías. Antes no existían como dato — `recordPayment` solo pisaba
`lastPaymentDate`, que se sobreescribe en cada cobro, así que no había forma de
decir cuánto se facturó en septiembre. Ahora cada cobro deja un asiento en
`platform/cobros/items` (solo el equipo de la plataforma lo lee; solo el dueño lo
escribe) y el panel global muestra cobrado del mes, cobrado histórico e historial
por mes. **El historial arranca el día que esto se puso**: los cobros anteriores
no se pueden reconstruir.

### Funciones por plan, de verdad (06/10/2026)

Hasta acá lo único que un plan cambiaba era un cartel en la interfaz. Ahora la
escalera define **capacidad** (sucursales y barberos) y **capacidades** (qué
funciones están habilitadas), y las dos se hacen cumplir del lado del servidor.

| | sucursales | barberos | foto del barbero | página | colores + logo + portada | abono |
|---|---|---|---|---|---|---|
| Básico | 1 | 1 | — | — | — | $15.000 |
| Intermedio | 1 | 3 | ✓ | ✓ | — | $20.000 |
| Full | 1 | sin límite | ✓ | ✓ | ✓ | $30.000 |
| Empresarial | 4 | sin límite | ✓ | ✓ (una por sucursal) | ✓ | $60.000 |
| Personalizado | a convenir | a convenir | a convenir | | | Consultanos |

Las capacidades son cinco: `fotoPerfil`, `pagina`, `paginaFoto`, `colores` y
`logo`. La página y su foto de portada son dos distintas a propósito — ver "La
página de presentación de la barbería" más abajo.

**Dónde vive cada cosa, y por qué en tres lugares:**

1. `src/config/plans.js` — lo que muestra la interfaz.
2. `firestore.rules` — lo que la base acepta. Lee el campo `capacidades` del
   documento del negocio, porque las Rules no pueden importar una tabla de
   planes. Ese campo lo escribe la plataforma al dar de alta y al cambiar de
   plan, y el dueño **no** lo puede tocar (está en la lista de campos
   protegidos). Si el campo no existe, la regla asume que SÍ puede: una cuenta
   vieja no puede perder de un día para el otro la foto que ya tenía cargada.
   Para completárselo a las que ya estaban: `node scripts/migrar-planes.mjs`
   (muestra qué haría; con `--aplicar` escribe).

   **Ojo al agregar una capacidad nueva**: el default `true` no es solo para las
   cuentas sin el campo, también vale para una CLAVE que falte adentro de un
   mapa que sí existe. Una cuenta de Básico creada la semana pasada tiene
   `capacidades` escrito sin la clave nueva, así que en las Rules le queda
   habilitada mientras la interfaz le dice que no.

   Después de agregar una capacidad: **/super-admin → Barberías → Mantenimiento
   → "Ver qué falta"**, y aplicar. Completa las claves que faltan adentro del
   mapa, no solo el campo entero. Es idempotente: correrlo de más no hace nada.
3. `functions/planes.js` — lo que validan las Cloud Functions.

**El tope de barberos pasó a ser una function.** Las Security Rules no pueden
CONTAR documentos, así que el tope no se puede expresar ahí: hasta ahora vivía
solo en la interfaz y se salteaba con la consola abierta. Ahora el alta de un
barbero es `crearProfesional` (callable), que cuenta los activos y compara. Las
Rules dejaron de permitir el `create` directo del dueño sobre `professionals`
—solo la plataforma, que prepara cuentas—, así que no hay camino de atrás. Se
cuentan solo los ACTIVOS: desactivar a alguien que se fue libera el lugar.

**El logo** va como data URL adentro del documento del negocio, igual que la
foto del barbero y por la misma razón (sin Storage). `redimensionarLogo` lo
achica a 240 px y lo deja en PNG para no romper las transparencias; si el PNG se
pasa de 250 KB, reintenta en JPEG sobre fondo blanco. Se ve arriba del link
público y en el panel. Las Rules acotan el tamaño: sin eso, un logo pesado se
lleva puesto el límite de 1 MB por documento y la barbería no puede guardar nada
más.

Lo bloqueado NO se esconde: se muestra apagado, con desde qué plan está y el
link para ampliar. Esconderlo deja al dueño creyendo que el sistema no lo tiene.

```bash
node scripts/test-planes-emulador.mjs   # 71 casos
```

### WhatsApp por wa.me, sin API ni bot (06/10/2026)

Al lado de cada turno hay dos botones: **Recordatorio** y **Gracias**. Abren
WhatsApp en el teléfono del barbero con el mensaje ya escrito, apuntando al
número que el cliente dejó al reservar. **El mensaje no se manda solo**: lo manda
el barbero, desde su número, cuando quiere.

No tiene nada del lado del servidor: ni API de Meta, ni plantillas aprobadas, ni
costo por mensaje. Es otra cosa que la integración de WhatsApp Cloud que sigue
pendiente de Meta —aquella manda sola—, y conviven sin pisarse.

Todo el trabajo está en `utils/whatsapp.js`, y es el formato del número: la
gente escribe "11 2345-6789", "(0223) 15 456-7890" o "02257 15-529684" y wa.me
quiere `5492234567890`. Se sacan separadores, el 0 de larga distancia y el 15 de
los celulares, y se antepone 54 9. Si lo que queda no puede ser un teléfono, NO
se muestra el botón: abrir WhatsApp en un número inventado es peor que no tener
botón.

```bash
node scripts/test-whatsapp.mjs   # 23 casos, sin emulador: es función pura
```

### Reseñas (06/10/2026)

El cliente puntúa de 1 a 5 estrellas y, si quiere, deja un comentario. Solo
sobre un turno **propio y marcado como atendido** (`completada`): un turno
pendiente, cancelado o "no vino" no se puede valorar.

**Una por turno, por construcción.** El id del documento de la reseña ES el id
del turno (`businesses/{id}/reviews/{appointmentId}`). No hay contador ni chequeo
que se pueda saltear: Firestore no deja crear dos documentos con el mismo id, y
la regla de `update` solo deja corregir al que la escribió. Corregirla sí;
duplicarla no; borrarla, nadie — el promedio no se maquilla sacando las malas.

**La reseña no puede mentir sobre el turno.** Las Rules comparan el profesional,
el servicio y el negocio contra el documento del turno. Sin eso, quien manda el
formulario podría colgarle una reseña de una estrella al barbero que no lo
atendió, y ensuciarle el promedio para siempre.

En el panel, **Reseñas** muestra promedio, total, distribución de 1 a 5,
promedio por barbero y por sucursal, y el listado con filtros combinables
(período, barbero, sucursal, estrellas). El barbero ve SOLO las de sus turnos:
las Rules le filtran por su `professionalId`, así que si pide las de todos la
consulta se rechaza entera.

**Google es aparte.** Después de valorar, si la barbería cargó su link
(`googleReviewUrl` en Configuración), se le ofrece dejar también la reseña en
Google. Se abre la ficha: no se incrusta nada ni se publica nada automáticamente
—Google no lo permite— y la valoración interna no se "sube" a ningún lado. Se le
ofrece a TODOS, no solo a los que puntuaron bien: filtrar por puntaje es *review
gating*, está prohibido por Google y puede costarle la ficha al negocio.

```bash
node scripts/test-resenas-emulador.mjs   # 36 casos
```

Trampa que costó un rato, y que ninguna prueba agarró hasta probarlo en el
browser: antes de guardar, la app PREGUNTA si ya existe la reseña de ese turno
(para saber si crea o corrige). La regla de `get` miraba `resource.data` sin
chequear que el documento exista, y `resource.data` de null es **"Null value
error"**, que cuenta como denegado — así que nadie podía dejar su PRIMERA
reseña. La misma clase de error apareció en `esElTurno`, que usaba `aptId`
tomándolo del match equivocado: una variable que no existe en Rules no da error
de compilación, revienta en runtime y la regla entera queda en denegado.

### Ver varias sucursales sin entrar a cada una (06/10/2026)

En Citas, Profesionales, Servicios y Reseñas hay un selector de **Sucursal** con
"Todas" y una por una. Elegir una puntual la vuelve la sucursal ACTIVA (es lo
mismo que "Gestionar sucursal", sin salir de la pantalla); elegir "Todas" junta
los datos de las cuatro para MIRARLOS.

Dos decisiones que hacen que esto no sea una mezcla de datos:

- Cada fila traída de otra sucursal lleva `__bizId`. En Citas, las acciones
  (Vino / No vino / Cancelar / Devolver seña) escriben en la barbería de ESA
  fila, no en la activa. Sin eso, marcar "Vino" en un turno de Centro mientras
  estás parado en Norte le cambiaría el estado al turno de la otra.
- En Profesionales y Servicios, "Todas" es de **solo lectura**. Editar a un
  barbero de otra sucursal desde acá le ofrecería los servicios y horarios de
  ESTA, que son otros. La forma de no mezclar no es tener cuidado: es no dejar.
  Cada fila trae el botón para entrar a su sucursal.

Los datos de las otras sucursales se leen de UNA sola vez
(`useDatosDeSucursales`), no con suscripciones vivas: mantener cuatro agendas
escuchando en todas las pantallas del panel sería pagar cuatro veces lo mismo
todo el tiempo, incluso cuando el dueño mira una sola.

**Y el bug que impedía crear sucursales:** el dueño de la plataforma no tiene
`businessId` en su token (no pertenece a ninguna barbería), así que cuando
administraba una cuenta y tocaba "Nueva sucursal", la function recibía la cuenta
vacía y respondía *"Falta saber de qué cuenta es la sucursal"* — sin que hubiera
en pantalla ningún lugar donde elegirla, porque no hay nada que elegir: es la
cuenta de la barbería que se está administrando. Ahora el panel la manda
siempre, y `useResolvedBusiness` arma el grupo desde el negocio activo cuando
quien mira es la plataforma.

### La plataforma elige qué sucursal administrar (09/10/2026)

Al entrar desde el panel global ("Administrar esta cuenta") a una cuenta con varias
sucursales, lo primero es **"¿Qué sucursal querés administrar?"** (`ElegirSucursalPanel`):
una tarjeta por local con dirección, teléfono, link y qué le falta configurar. Hasta elegir,
`AdminLayout` no muestra el menú ni ninguna pantalla. Antes caía directo en la principal y
era fácil cargarle el WhatsApp o el equipo de otro local. La barra naranja de la plataforma
dice en qué sucursal está y tiene **"Cambiar de sucursal"**. La elección vive en
sessionStorage (`utils/sucursalEnPanel.js`) y se borra en cada "Administrar esta cuenta".
Corregido el mismo día: **las sucursales son iguales, no hay una central.** El dueño también
elige al entrar ("¿En qué sucursal vas a trabajar?") y tiene "Cambiar de sucursal" arriba.
El alta de una cuenta con plan de varias sucursales pide el nombre de la MARCA (`nombreCuenta`,
en el doc de la primera) y una ficha por sucursal con su link, teléfono, WhatsApp y dirección;
la primera es el documento que se crea, las demás salen por `crearSucursal`. Y `crearSucursal`
ya no hereda teléfono ni WhatsApp de la principal (las tres quedaban con el mismo número).

### "Vengo con alguien": un turno que atiende a dos (15/10/2026)

El padre que viene con el hijo no podía reservar los dos (un turno por día y por
cuenta). Ahora, en el paso 2, "Vengo con alguien" pide el servicio de la otra
persona. `createAppointment` recibe `acompanante: { serviceId }`, lo revalida
(existe, activo, no es un adicional, el barbero lo hace, su promo rige a la hora
que le toca a él) y **suma su duración y su precio**: es UN turno con `endTime`
de los dos seguidos, `durationMinutes` total y `acompanante: { serviceId, name,
price, durationMinutes }`. No gasta un segundo cupo del tope. El precio se paga
siempre (la membresía y el cupón son del titular). Con "Cualquiera" solo sirven
los barberos que hacen los DOS servicios.

El motor de horarios NO se tocó: el front le pasa una copia del servicio con la
duración total. **Orden de despliegue: Functions primero, front después**: un
front nuevo contra un servidor viejo ignora el campo y guarda el turno sin
acompañante, en silencio. Casos en la suite de reservas.

**21/10/2026: ahora es "¿Cuántos turnos querés? 1 o 2".** En el paso 4, arriba de
la grilla. Con 2, el segundo turno es del MISMO servicio y es el que sigue al
suyo; la grilla muestra solo los horarios con el siguiente libre. Por dentro es
el mismo `acompanante` con el `serviceId` del titular, así que el servidor no
cambió. La agenda muestra "↑ 2.º turno de X" en ese rato.

### La pantalla en blanco que se arreglaba con F5 (21/10/2026)

Después de cada deploy, el que tenía la app abierta (el panel instalado en el
celular) pedía pantallas `lazy()` con el hash viejo; Vercel le devolvía
`index.html` en vez de un 404, el import fallaba y React desmontaba todo.
Ahora: `importarConReintento` y `vite:preloadError` recargan solos una vez
(`utils/versionNueva.js`), `ErrorDePantalla` envuelve la app con un botón de
"Recargar", y `vercel.json` ya no reescribe `/assets/*` a `index.html`.
Servicios rechaza duraciones fuera de 5–240 min y pide confirmar más de 120:
un "350" tipeado bloqueó una tarde entera de Neytan.

### Adicionales: se suman al servicio, no son un turno (13/10/2026)

Cejas, lavado, café, mascarilla: un servicio con `adicional: true` (se marca en Servicios) no
se reserva solo. En la reserva, después de elegir el servicio, aparece "¿Querés agregar
algo?" y se suma al precio. `createAppointment` recibe solo los ids (`adicionales`), los
revalida (existen, activos, son adicionales de ESA barbería) y suma el precio de cada
documento; guarda `adicionales: [{ id, name, price }]` en el turno y `price` ya incluye los
extras. No suman tiempo (se hacen durante el corte). La membresía cubre el servicio, no los
adicionales; el cupón descuenta el servicio, no los adicionales. Casos en la suite de reservas.

### Recargo por pagar con tarjeta o QR (13/10/2026)

`recargoTarjeta` en el negocio (Configuración, $ por turno; 0 = no se pregunta). En la reserva,
si hay algo para pagar en el local, el cliente elige "Efectivo o transferencia" o "Tarjeta o
QR (+$X)" y ve el total con el recargo. `createAppointment` lo recalcula (recibe solo
`metodoPago`), lo suma a `price` y guarda `metodoPago` y `recargoTarjeta` en el turno. No corre
si paga todo online por Mercado Pago ni si el turno no cuesta nada. Va por TURNO, no por cada
adicional. Casos en la suite de reservas.

**Con Mercado Pago conectado** (y la seña activa), elegir tarjeta o QR = pagar AHORA el TOTAL
por Mercado Pago, con el recargo incluido, y el turno queda pago (`tipoPago: 'total'`). Efectivo
sigue con la seña de siempre. Con recargo configurado, el "Pago todo ahora" suelto no existe:
pagar online es el camino de la tarjeta (si no, se salteaba el recargo). Sin Mercado Pago,
tarjeta se paga en el local con el recargo. La preferencia de MP excluye `ticket` y `atm`
(Rapipago, Pago Fácil, cajero): se acreditan en días y el turno se guarda 15 minutos. Casos en
la suite de seña.

### Turnos fijos: el cliente de siempre (13/10/2026)

En Citas → "Agendar turno" → **Repetir** (todas las semanas, o cada 2, 3 o 4): el
turno queda fijo ese día de la semana a esa hora. Lo arma `crearTurnoFijo`
(`functions/turnosFijos.js`), no el browser: guarda la serie en
`businesses/{id}/turnosFijos/{serieId}` (Rules: lee el dueño, la plataforma y el
barbero las suyas; escribe solo el servidor) y agenda las próximas **8 semanas**.
`extenderTurnosFijosDiario` (4 AM) corre la ventana todas las noches.

- Cada turno tiene id `${serieId}_${fecha}`: regenerar no duplica y un turno
  CANCELADO a mano no vuelve a aparecer (el doc existe). Así se cancela una sola
  fecha: cancelando ese turno en la agenda.
- La primera fecha se valida y si no entra, no se crea nada (error claro). Las
  siguientes que no entran (cerrado, el barbero no trabaja, fuera de horario,
  corte del mediodía, horario tomado) se SALTEAN y quedan en `saltados` con el
  motivo; el modal "🔁 Turnos fijos" las muestra.
- Nacen `confirmada`, `type: 'fijo'`; `onNuevoTurno` no avisa (los cargó el staff).
- "Dar de baja" (`darDeBajaTurnoFijo`) cancela los turnos futuros vivos de la serie.
- El barbero solo crea en su propia agenda.

```bash
node scripts/test-turnos-fijos-emulador.mjs   # 28 casos
```

### El link de la CUENTA y los de cada sucursal (09/10/2026)

Reemplaza lo de abajo: el link de una SUCURSAL (`/franlook-olivos`) entra DIRECTO a esa
sucursal, sin preguntar (queda "Cambiar de sucursal" a mano). El que pregunta "Elegí tu
sucursal" es el link de la CUENTA (`/franlook`): un doc en `/slugs/{link}` con
`{ grupoId, esCuenta: true }` (sin `businessId`) más `slugCuenta` en la principal.
`BusinessSync` lo resuelve como `slugEstado.estado === 'cuenta'` y `TenantRoute` muestra
`CuentaPublica`, que manda al link de la sucursal elegida conservando el resto de la ruta
(`/franlook/reservar` → `/franlook-olivos/reservar`). Lo define la plataforma: en el alta
de una cuenta con varias sucursales, o con "Definir" en la tarjeta de la cuenta del panel
global (`guardarLinkDeCuenta`). Necesita `/grupos/{grupoId}`: si una cuenta vieja no lo
tiene, "Mantenimiento" lo reconstruye. `api/preview.js` arma la tarjeta del link de la
cuenta con `nombreCuenta`.

### El cliente elige sucursal (07/10/2026)

Cada sucursal tiene su propio link, pero el cliente que recibe UNO por Instagram
no sabe que hay otros tres locales — y el que recibe el de la sucursal
equivocada reservaba ahí sin enterarse, con los barberos y los horarios de ese
local.

Ahora, al abrir el link de una barbería que es parte de una cuenta con varias
sucursales, lo primero es **"Elegí tu sucursal"**: nombre, dirección y teléfono
de cada una, con la del link marcada. Al elegir, se navega al slug de esa
sucursal y sigue el flujo normal (profesional → servicio → fecha → hora). Elegir
el slug, y no "cambiar el negocio activo", es lo que hace que no haya ningún
caso especial aguas abajo: el motor de disponibilidad, la agenda y la reserva
siguen viendo UNA barbería.

Se pregunta una vez por visita (queda en `sessionStorage`), y en el primer paso
queda **"Cambiar de sucursal"** a la vista.

**`/grupos/{grupoId}`** es el mapa que lo hace posible: `{ principalId,
businessIds }`, lectura pública, escrito solo por `crearSucursal` con el Admin
SDK. Mismo truco que `/slugs`: resolverlo de otra forma obligaría a permitir
listar `businesses`, y ahí cualquiera se baja la cartera entera de clientes.

Guarda SOLO ids. El nombre, la dirección y si está suspendida se leen del
documento de cada barbería, que ya es público: así el selector nunca muestra una
dirección vieja. Son 2 a 4 lecturas de un documento cada una, y solo para las
cuentas que tienen sucursales — una barbería sola no va a la base ni una vez.

Para los grupos creados antes de que el mapa existiera:
`node scripts/migrar-planes.mjs --aplicar` lo reconstruye desde `grupoId`.

### El plan es de la CUENTA, no de cada sucursal (07/10/2026)

Una sucursal no tiene plan propio y no se le cobra: el abono lo paga la
principal. Lo que se corrigió:

- **La sucursal ya no hereda `trialEndsAt`.** Lo copiaba al crearse, así que una
  sucursal de una cuenta con la prueba vencida mostraba *"se terminó tu prueba"*
  por su cuenta, como si se pagara aparte. El período de prueba vive en la
  principal y `runBilling` mira el de ahí para decidir por todo el grupo.
- **En el panel de una sucursal** no hay banner de plan: hay un cartel que dice
  en qué sucursal está, de qué cuenta es, y que el plan se maneja en la
  principal, con el link a *Mis sucursales*.
- **En el panel global**, la tarjeta de una sucursal no muestra abono, deuda,
  consumo de WhatsApp ni los botones de cobrar y cambiar plan: dice que todo eso
  está en la principal. Antes dejaba cambiarle el plan a una sola sucursal, que
  es la forma más fácil de desincronizar un grupo.
- **Cambiar el plan propaga a las sucursales** los topes y las capacidades. Las
  Rules leen el campo de CADA documento, así que sin propagar, el dueño que sube
  de plan veía la función nueva en la principal y no en las otras tres.

### El Plan Personalizado se configura (07/10/2026)

Antes el modal de cambio de plan preguntaba, para el Personalizado, el **límite
de mensajes de WhatsApp** — de una integración que todavía no existe — y nada de
lo que de verdad define un plan. La cuenta terminaba creada con los topes del
Básico.

Ahora pregunta lo que se negocia: cuántas **sucursales**, cuántos **barberos** y
qué **funciones** (foto, colores, logo), con el abono acordado. La cuota de
WhatsApp quedó al final, opcional y marcada como "todavía no se usa". Vacío en
los topes = sin límite, a propósito: escribir 999 sería inventar un número que
después alguien lee como límite real.

Los mismos campos están en el alta (`NewBusinessModal`) y en el cambio de plan,
con el mismo componente (`PlanAMedida`), y arrancan con lo que la cuenta tiene
HOY: si ya era personalizada, se edita sobre lo acordado y no desde cero.

### La página de presentación de la barbería (08/10/2026)

El link de una barbería abría directo el paso 1 de la reserva. Funciona, pero
es un formulario: el que llega desde la bio de Instagram y todavía no decidió
nada se encuentra con "elegí tu profesional" sin saber dónde queda el local, qué
cobran ni si es la barbería que le recomendaron.

Ahora el link puede abrir primero una **página de presentación**: nombre,
una línea de presentación y botones grandes —reservar, servicios y precios, cómo
llegar, WhatsApp, Instagram—. El modelo es un Linktree, no un constructor de
páginas.

**Nace apagada para todas.** Mientras `paginaActiva` no esté en true, `/:slug`
es exactamente la reserva de siempre. Esto no puede cambiarle el link a una
barbería que ya lo repartió sin que ella lo decida.

```
/:slug            la página si está prendida; si no, la reserva
/:slug/reservar   la reserva, SIEMPRE, con página o sin ella
```

`/:slug/reservar` existe desde ahora para todas, y es a donde apuntan el botón
de la página, el `from` del login y los "Reservar otra cita" de la confirmación
y de Mis Citas. El flujo de reserva no se tocó.

**Cuatro plantillas.** `Simple`, `Tarjeta` y `Foto` (esta última del Full)
comparten el mismo JSX y se diferencian por una clase: agregar otra de esas es
escribir CSS. **`Sitio`** es la excepción y es a propósito — ver abajo.

**Se elige, no se diseña.** El dueño elige plantilla y escribe dos líneas; todo
lo demás —nombre, logo, presentación, dirección, Instagram, WhatsApp,
servicios— sale de lo que ya cargó en Configuración. Un dato, un lugar: si
hubiera que escribir la dirección otra vez acá, el día que se muda le queda
vieja en un lado y nueva en el otro. Por eso el editor muestra una lista de
"esto lo arma sola" con el estado de cada dato y el link a Configuración.

**El orden de los botones: primero las sucursales.** En una cuenta con varios
locales, a cuál va se decide ANTES de reservar, porque el equipo y los horarios
son los de ese local. Por eso cuando hay más de uno el botón dice *"Reservar en
Tijeras — Centro"* y no "Reservar un turno", y el local en el que está se marca
como "estás acá" en vez de ser un botón más. Entrar a reservar anota la sucursal
(`recordarSucursal`), así el paso cero de la reserva no la vuelve a preguntar.

**La configuración va en `businesses/{id}/public/pagina`, aparte.** El documento
del negocio lo lee CADA visitante del link y además vive en la suscripción
permanente del panel: meterle una foto de portada sería pagarla en todas las
pantallas, todo el tiempo. Acá se baja una sola vez y solo cuando alguien abre
la página. El negocio lleva nada más que el interruptor, que ya viene en la
lectura que la app hace igual — la barbería que no tiene página no gasta una
lectura de más.

**Dos capacidades, no una**: `pagina` (tenerla, del Intermedio) y `paginaFoto`
(la plantilla con la foto a pantalla completa, del Full). Un Intermedio tiene su
página pero sin logo, sin colores propios y sin portada. Donde iría el logo van
las **iniciales** de la barbería sobre un círculo de color: es lo que hace que
no se vea como un hueco, y es la diferencia entre una función recortada y una
función incompleta.

`paginaEfectiva()` resuelve la plantilla contra las capacidades: una cuenta que
baja de plan con la plantilla de foto guardada se degrada a la Simple en vez de
quedar con el hueco de una foto que las Rules ya no dejan guardar.

```bash
node scripts/sembrar-pagina-emulador.mjs   # las tres plantillas, para mirarlas
```

**Vista previa en vivo (09/10/2026).** El editor ("Mi página") muestra la página dentro de un
celular al costado, con lo que se está editando y SIN guardar; en pantallas angostas se abre
con "Ver cómo queda". Las opciones de diseño son miniaturas de la plantilla real con los
datos de la barbería (antes eran tres barras abstractas casi iguales y no se entendía qué
cambiaba). Todo usa `VistaPagina`, el MISMO componente que ve el cliente: la vista previa no
puede separarse de la página real. `CelularPagina` la dibuja a 390 px y la achica con
`transform`, que además hace que la portada (`position: fixed`) quede fija al celular.

### La plantilla "Sitio": cuando piden una web, no un Linktree (13/10/2026)

"Quiero que parezca una página web hecha para mí" es un pedido real y
recurrente, y la respuesta no puede ser hacerle una a mano a cada barbería: eso
es código que no se puede vender dos veces y que se rompe en el próximo cambio
del producto. Es una **plantilla más**, la elige cualquiera, y lo que la hace
suya son sus datos, su logo y sus colores.

Las otras tres son una pantalla con botones. Esta se baja:

```
portada (logo grande + nombre + bajada + Reservar)
Sobre mí          cfg.sobreMi, hasta 800 caracteres, párrafos por renglón
Servicios         con precio y duración
Horarios          agrupados: "Lun a Vie 09:00–20:00 · Sáb 09:00–18:00"
Nuestros locales  solo en cuentas con sucursales
Dónde estamos     el mapa de Google incrustado
Escribinos        WhatsApp, Instagram y los botones libres
```

Vive en el MISMO archivo que las otras (`VistaPagina.jsx`) porque el editor
dibuja la vista previa con ese componente: lo que el dueño ve mientras edita
tiene que ser lo que ve el cliente, no una imitación que con el tiempo se
separa.

**El mapa se arma solo, desde la dirección cargada** (`mapaIncrustado()` en
`utils/contactoBarberia.js`). NUNCA desde una URL que escriba el dueño: un `src`
de iframe que sale de un campo de texto es una puerta abierta. El dominio está
fijo en el código y lo único variable es el texto de la búsqueda, codificado.
Usa `output=embed`, que no pide clave de API ni facturación — es lo que lo hace
viable para cada barbería sin administrar nada.

**En el editor el mapa es un marcador, no el mapa.** La vista previa se dibuja
dos veces (la miniatura de la plantilla y el celular grande) y se redibuja con
cada tecla: serían dos pedidos a Google por apertura del panel para mostrarle al
dueño dónde queda su propio local.

**El único efecto** es que las secciones aparecen al llegar scrolleando
(`IntersectionObserver`, veinte líneas, cero kB de librería) y la barra de
abajo con "Reservar" fija en el celular — que no es decoración: en una página
larga el botón queda arriba de todo y el que terminó de leer tiene que volver a
buscarlo.

Ojo con la clase que esconde: `.sitio-aparece` arranca en opacidad 0 y la saca
el observer. Se pone **solo** cuando el observer va a correr (no en la vista
previa). Un efecto que esconde contenido cuando no se ejecuta no es un efecto,
es una página en blanco.

### Páginas exclusivas: diseño a medida pagado aparte (13/10/2026)

La excepción consciente a "no hacerle una página a mano a nadie". Neytan Barber
777 pagó aparte un diseño propio y Santiago decidió que sea código a medida,
mantenido aparte. Viven en `src/paginas-exclusivas/`, registradas por
**businessId** (no por slug: si el dueño cambia el link, no pierde lo que pagó)
y cargadas con `lazy()`: ninguna otra barbería baja ese código ni su CSS.

- Reemplazan SOLO lo que se ve en `/:slug`. La reserva sigue en
  `/:slug/reservar`, sin tocar. Se muestran aunque `paginaActiva` esté apagada.
- El botón de reservar va arriba de todo, sin scrollear, a 375x667.
- No esperan a `public/pagina` (trae la portada, cientos de KB); el "Sobre mí"
  de ahí aparece cuando llega.
- Todo dato sale de lo cargado (servicios, horarios, contacto): no hay que
  actualizarlas a mano.
- `irAReservar(servicioId)` en `PaginaBarberia` acepta un servicio y lo pasa
  como `?servicio=`, el mismo parámetro de los links de promo.

### Los colores de la barbería no llegaban a ningún lado (08/10/2026)

`applyTheme()` existía desde el principio en `config/theme.js` y **no la llamaba
nadie**. Una barbería del Plan Full podía elegir sus colores, guardarlos, verlos
en la vista previa de Configuración… y el cliente que abría su link veía el
naranja de BarberOS. Lo único que pasaba al guardar era un
`document.documentElement.style.setProperty` que pintaba el PANEL del que
guardaba — y se lo dejaba pintado al dueño de la plataforma que entró a
administrar esa cuenta, hasta que recargara.

Ahora es `variablesDelTema(business, habilitado)`, que devuelve un objeto de
estilo, y `<TemaNegocio>` lo pone en un contenedor que envuelve todo lo que el
cliente ve bajo el slug (la página, la reserva, la confirmación, sus turnos) y
también el header. Nada global, nada que limpiar al salir.

Tres detalles que hacen que funcione de verdad:

- **`display: contents`** en el contenedor: no genera caja, así que no cambia
  NADA del layout, pero las custom properties siguen heredando por el árbol.
- **El texto del botón se calcula.** El único color que la barbería elige es el
  de sus botones, y el texto era blanco fijo en el CSS: una barbería con el
  dorado de su cartel se quedaba con botones que no se leen. `textoSobre()` usa
  la luminancia relativa de WCAG con el corte en **0.179**, que sale de igualar
  los dos contrastes. Ojo con subirlo a 0.5 "porque el blanco queda mejor": 0.5
  es el medio de la luminosidad percibida, no de la luminancia, y con ese número
  un dorado se lleva texto blanco con 2.4:1.
- **`--border-accent` y `--primary-glow`** se derivan del color elegido. En
  `:root` están escritas como un `rgba()` literal con el naranja adentro, así que
  sin pisarlas el botón verde quedaba con el aro naranja alrededor.

**Lo que faltaba, y apareció recién con un color claro de verdad (13/10/2026).**
Preparando el verde lima de Neytan Barber 777:

- **`--primary` se usa de dos formas que piden cosas opuestas**: como FONDO del
  botón, y como TEXTO en 23 reglas del CSS — la primera es `a { }`, o sea TODOS
  los links. Un verde lima da 13:1 como fondo y **1.5:1 como texto sobre
  blanco**. El botón impecable y los links invisibles. Ahora `variablesDelTema()`
  deriva **`--primary-texto`** con `legibleSobreClaro()`: el mismo color
  oscurecido hasta 4.5:1. Un color que ya se leía vuelve igual.
- **`.btn-primary` tenía `color: #ffffff !important`**, así que el valor que
  `textoSobre()` calcula no llegaba nunca al botón más importante del producto.
  Con el verde eran 2.09:1.
- **`--sobre-primary` no estaba en `:root`**, solo dentro de `.pagina-barberia`
  — y ahí es peor que no estar: al declararlo el propio elemento, le gana al
  valor que hereda de `TemaNegocio`, así que las cuatro plantillas se quedaban
  con el blanco fijo. Ahora vive en `:root` y nadie lo pisa.

BarberOS no cambia: en `:root` las dos variables apuntan a lo que ya había. Su
naranja como texto queda en 4.34:1, apenas por debajo de AA; se deja porque es
la marca y oscurecerla es una decisión de identidad (sería `#d93b00`, 4.59:1).

Para sacar la paleta de un logo y validar los contrastes antes de cargar nada:

```bash
node scripts/paleta-de-logo.mjs ruta/al/logo.png
```



El panel sigue con los colores de BarberOS a propósito, y Configuración ahora lo
dice.

### La vista previa del link compartido (08/10/2026)

Mandar `barberos.sacia.tech/volcadoclub` por WhatsApp mostraba una tarjeta que
decía "BarberOS — Turnos para barberías": el nombre de la barbería no aparecía.
Es justo donde más duele, porque ese link se reparte por WhatsApp y por la bio
de Instagram y la tarjeta es lo único que se ve antes de decidir si se toca.

Los crawlers que arman esa tarjeta **no ejecutan JavaScript**: leen el HTML que
les llega. En una SPA ese HTML es el mismo para todas las rutas, así que ponerle
las etiquetas desde React no sirve para nada — el crawler ya se fue.

`api/preview.js` (función serverless de Vercel) devuelve un HTML mínimo con las
etiquetas de ESA barbería. El `vercel.json` manda ahí **solo** a los user agents
de los crawlers; una persona recibe la app como siempre y nunca pasa por ese
código. Lee el negocio por la API REST con la clave web, que es pública igual
que el documento del negocio: no hay credencial de servidor en `api/`.

Dos cosas para no romper:

- **Todo lo que entra al HTML se escapa.** El nombre y la presentación los
  escribe el dueño y terminan adentro de un atributo: un `">` sin escapar cierra
  la etiqueta y lo que sigue pasa a ser marcado.
- **La imagen es la misma para todas.** El logo de la barbería es un data URL
  adentro de su documento y un crawler necesita una URL https que pueda
  descargar. Va `public/img/og-barberos.png` (1200x630, la genera
  `scripts/generar-iconos.mjs`). El nombre sí es de cada una: va en el título,
  que es lo que de verdad se lee.

```bash
node scripts/test-preview.mjs   # 24 casos, sin emulador ni red
```

### Mantenimiento: completar planes sin la clave de servicio (08/10/2026)

`/super-admin` → Barberías → **Mantenimiento** completa en cada barbería los
topes y las capacidades de su plan, y reconstruye el mapa público de las cuentas
con sucursales. Siempre muestra primero qué haría; escribe recién al confirmar.

Es lo mismo que `scripts/migrar-planes.mjs`, pero como callable
(`migrarPlanes`). La razón no es comodidad: el script pide la **clave de
servicio** del proyecto —acceso total, sin restricciones— bajada a mano al disco
de quien lo corre, y confía en que se acuerde de borrarla. Para algo que hay que
repetir cada vez que se agrega una capacidad nueva, eso es una llave maestra
dando vueltas por una carpeta. Acá el permiso es el claim que el dueño de la
plataforma ya tiene.

No puede ser una escritura del browser: `capacidades`, `maxBarbers`,
`maxSucursales` y `grupoId` son justo los campos que las Rules no dejan tocar a
nadie salvo a la plataforma, y `/grupos` no lo escribe ningún browser. Con el
Admin SDK pasa por arriba de las Rules — que es exactamente lo que hace falta, y
exactamente por lo que está cerrado a `platform === true` y a nadie más.

Es **idempotente**: correrlo de más no hace nada, y lo que ya está escrito manda
(puede ser una excepción hecha a mano para esa cuenta). Una cuenta con un
`planId` que no está en la lista se informa y no se toca: pasarla de plan es una
charla con el cliente, no un script.

El script sigue existiendo para el día que el panel no esté disponible.

### El panel global, por secciones (28/09/2026)

Era UNA pantalla con ocho pestañas arriba: en cualquier monitor normal no
entraban y salía una barra de scroll horizontal. Ahora cada sección es una ruta
(`/super-admin/barberias`, `/turnos`, `/soporte`, `/avisos`, `/equipo`,
`/whatsapp`, `/mensajes`) y se navega desde el menú lateral, igual que el panel
de la barbería.

`SuperAdminDashboard` sigue siendo un solo componente grande y recibe `seccion`
por prop desde la ruta; se mantiene el `?tab=` para los links viejos de la
campanita. El menú esconde lo que un moderador no puede hacer, y si escribe la
dirección a mano le explica por qué no ve nada (antes: página en blanco).

### Seña por Mercado Pago (27/09/2026)

Modelo OAuth: el dueño conecta SU cuenta y la plata va DIRECTO a él. La
plataforma no la toca ni cobra comisión (`marketplace_fee` en 0). Esto no es
técnico: define que el cobro figura bajo el CUIT del barbero y que las
retenciones se las hacen a él. Si algún día se cobra comisión, esa comisión sí
es ingreso de la plataforma.

- Config: `businesses/{id}.sena = { activa, monto, modo }`, con `modo`
  `'opcional'` (el cliente elige seña o pagar en el local) u `'obligatoria'`.
  Opcional es lo recomendado: hay clientes sin Mercado Pago.
- Los tokens van en `businesses/{id}/private/mercadopago`, con las Rules en
  **false**: no los lee nadie desde el browser, ni el dueño. Solo el Admin SDK.
- El turno con seña nace `esperando_pago` + `senaExpiraEn` (15 min). `reservaViva()`
  decide si ocupa el horario; vencido, se libera solo (lo respetan el
  solapamiento y `getBusySlots`).
- Confirma el WEBHOOK, nunca la vuelta del navegador: esa URL se escribe a mano.
- Devolución: botón en Citas (`devolverSena`). No es automática — la plata sale
  de la cuenta del barbero.
- La plataforma puede configurar el cobro de cualquier barbería pasando el
  businessId, con un aviso grande: **en OAuth la plata va a la cuenta de quien
  autoriza**, así que si conecta la plataforma, los cobros caen en su cuenta.

Trampa cara: `mercadopago.js` se carga ANTES que `setGlobalOptions`, así que sus
funciones se despliegan en `us-central1` salvo que lleven `region` explícita —
y el rewrite de `vercel.json` (`/api/mp/callback` y `/api/mp/webhook`) apunta a
`southamerica-east1`. Sin eso, Mercado Pago vuelve a un 404.

### Membresías: planes mensuales de la barbería a sus clientes (09/10/2026)

Un cliente paga un plan por mes (p. ej. "Corte Mensual, $25.000, 4 cortes") y
reserva sin pagar el turno. **El problema que resuelve no es anotar socios: es
que un barbero no pueda declarar que un cliente usó su plan** cuando en
realidad le cobró en mano, o cuando el plan ni está pago.

**Cómo está cerrado:**

- **El uso lo elige el CLIENTE al reservar**, desde su cuenta ("Usar mi
  membresía" en el paso 6). `createAppointment` lo valida y descuenta DENTRO de
  la transacción del turno: dos reservas por el último uso pasan de a una.
- **El barbero no tiene ningún botón.** Ve en la agenda "🪪 Membresía — no se
  cobra" y nada más. Desde Citas, **solo el dueño** aplica (`aplicarMembresia`,
  motivo obligatorio, `origen: 'dueno'`) o quita (`revertirUsoMembresia`).
  Aplicarla a un turno que reservó un cliente con SU cuenta exige que la
  membresía sea de ese cliente; a uno cargado a mano por el staff, el dueño
  elige de quién es (por eso el motivo).
- **Nada de membresías se escribe desde el browser, ni el dueño** (Rules en
  `false`): planes, membresías, meses, usos y cobros van por Functions. En el
  turno, el snapshot `membresia` lo escribe solo el servidor, y a un turno con
  membresía el staff no le puede tocar `serviceId`, `price`, `precioLista` ni
  `userId` (`noTocaLaMembresia()` en las Rules). Fecha, hora y estado sí.
- **Un uso por turno, por construcción**: `membresiaUsos/{appointmentId}`, mismo
  truco que las reseñas.

**Modelo** (vive en la barbería PRINCIPAL: la membresía es de la cuenta y se usa
en cualquier sucursal, como el abono):

```
businesses/{cuenta}/membresiaPlanes/{id}  lectura pública; beneficios = grupos de
                                          servicios {businessId, serviceId} que
                                          comparten cupo (`usos` null = ilimitado)
                                          + `usosTotales` opcional
businesses/{cuenta}/membresias/{id}       cliente (uid + mail), plan congelado,
                                          estado, mp{preapprovalId…}, inicio,
                                          periodoActual, historial
  /periodos/{id}                          un mes pago: desde/hasta ('YYYY-MM-DD'),
                                          términos congelados y contadores
businesses/{cuenta}/membresiaUsos/{aptId} auditoría: quién, cuándo, barbero,
                                          sucursal, valor, origen, eventos
businesses/{cuenta}/membresiaPagos/{id}   plata que entró por membresías
mpSuscripciones/{preapprovalId}           índice para el webhook (Rules false)
mpPagos/{paymentId}                       índice para reintegros (Rules false)
```

Estados: `pendiente`, `activa`, `pausada`, `pago_rechazado`, `cancelada`,
`vencida`, `reemplazada`. **Lo que decide si hay beneficio es el MES PAGO, no la
etiqueta**: una cancelada, pausada o con la cuota siguiente rechazada se usa
hasta el último día del mes que sí pagó. El turno tiene que caer dentro de un
mes pago; si no, "Tu membresía cubre turnos hasta el …".

**El ciclo del uso** (trigger `onTurnoMembresia`, porque los estados los escribe
el staff directo): reservar → `reservado` (ya ocupa cupo, así nadie reserva 8
turnos con un plan de 4); cancelar un turno vivo → `liberado` (vuelve el cupo);
atendido o no-show → `consumido`. Un turno atendido que después "se cancela"
**no devuelve el uso** (sería la forma de lavarlo): queda `requiereRevision` y
el dueño lo ve. Reprogramar = mover fecha del MISMO turno: el uso lo sigue; si
cae fuera del mes pago, se marca para revisar.

**Ingresos.** El turno con membresía se guarda con `price: 0` y el valor en
`membresia.valorServicio`: la caja (`ingresos.js`, `statsCalculator.js`) queda
bien sin tocarlos y la plata del plan va aparte, en `membresiaPagos`. El
dashboard muestra "Cubierto por membresías" y la pantalla Membresías el
cobrado contra lo consumido.

**Mercado Pago.** No había nada de suscripciones; las que tienen las barberías
se crearon a mano en SU cuenta de MP y no apuntan a ningún cliente nuestro. Por
eso **se cargan a mano** (Membresías → Clientes → "Cargar membresía"): nombre,
**el mail con el que el cliente entra a BarberOS**, plan, mes pago y,
opcionalmente, la suscripción de MP (buscador por mail del pagador, o el id).
Si el cliente todavía no entró nunca, la membresía queda esperando y se ata a
su cuenta la primera vez que reserva con ese mail **verificado**. Sin MP
(efectivo, transferencia), el dueño la renueva con "Registrar pago del mes".

Con MP vinculada, el estado lo manda MP:

- Webhook (`webhookMercadoPago`, mismo endpoint): `subscription_preapproval`
  → estado; `subscription_authorized_payment` → cobro aprobado abre el mes
  (id del mes = id del cobro, con `create`: el mismo aviso diez veces abre UN
  mes), rechazado → `pago_rechazado`; `payment` devuelto → el mes queda
  `revertido`.
- **Se procesa ESTADO, no eventos**: ante cualquier aviso se le pregunta a MP y
  se aplica; `last_modified` frena el aviso viejo que llega tarde. Un cobro
  anterior a `inicio` (de cuando BarberOS todavía no la seguía) no abre nada:
  si no, la reconciliación importaría todo el historial como meses encimados.
- `reconciliarMembresiasDiario` (3:30 AM): vuelve a leer cada suscripción y sus
  cobros (lo que el webhook perdió) y vence las que pasaron 3 días sin pagar.
- Baja desde el panel cancela también en MP (`PUT /preapproval`).
- Cambio de plan = membresía nueva con `reemplazaA`; la vieja queda
  `reemplazada` y su mes se cierra el día anterior. Sin prorrateo.

**Lo que hay que hacer a mano en el panel de la app de Mercado Pago:**
prender los tópicos **Planes y suscripciones** (`subscription_preapproval` y
`subscription_authorized_payment`) en Webhooks, con la URL
`https://barberos.sacia.tech/api/mp/webhook`. Los avisos de suscripciones NO
llegan por `notification_url` como la seña. Sin eso, todo depende de la
reconciliación diaria.

El webhook ahora **procesa antes de responder** (antes respondía 200 y seguía):
en Functions v2 lo que corre después de la respuesta puede quedarse sin CPU.

Verificado contra el Mercado Pago REAL: nada todavía (no hay credenciales de
prueba). La forma de `preapproval` y `authorized_payments` sale de la
documentación; antes de darlo por cerrado, vincular una suscripción de sandbox
y mirar los logs del webhook.

Trampa: los rechazos de permiso de una function se mostraban siempre como "No
tenés permiso para esta operación." (`functions.js` pisaba el mensaje). Ahora,
si la function manda una frase, se muestra esa ("Ese turno lo reservó otra
persona…").

```bash
echo MP_API_URL=http://127.0.0.1:5199 > functions/.env.local   # MP falso, solo emulador
node scripts/test-membresias-emulador.mjs    # 121 casos
node scripts/sembrar-membresias-emulador.mjs # escenario para mirar en el browser
```

Para el browser contra el emulador: `.env.emulador.local` con
`VITE_USE_EMULATORS=true` y `npm run dev -- --mode emulador`.

### El intervalo de la grilla: el barbero lo escribe, y le decimos cuánto cuesta (13/10/2026)

Era un desplegable de cuatro opciones (15, 30, 45, 60). Dos problemas, y el
segundo es el caro.

Un barbero avisó que su corte clásico sale en 20 minutos y el degradé en 40, con
la grilla cada 30, y que "se le armaba una diferencia". Simulado con el motor de
verdad sobre una jornada de 09:00 a 20:00 con 15 turnos mezclados:

| grilla | huecos muertos | termina |
|---|---|---|
| 60 | 320 min | 19:20 |
| 30 (la que tenía) | **200 min** | 19:20 |
| 15 | 110 min | 17:50 |
| **20** | **0 min** | **16:00** |

Mismos turnos, mismo trabajo: **3 horas y 20 minutos** de diferencia por día.

**El problema no es tener servicios de distinta duración. Es que 30 no divide ni
a 20 ni a 40.** La grilla arranca en la apertura y suma de a `slotInterval`; un
corte de 20 termina 09:20, que no es un punto de la grilla, y el siguiente
espera hasta 09:30. Con el **máximo común divisor** de las duraciones (acá 20),
cada turno termina justo donde puede empezar el próximo y no se pierde nada.

Entonces el panel no se limita a dejar escribir el número (5 a 120, libre): le
muestra la cuenta. `utils/intervalo.js` calcula el MCD y cuántos minutos muertos
deja CADA servicio, y `IntervaloDeTurnos` lo pinta con el botón para aplicarlo:

```
Estás perdiendo tiempo entre turno y turno.
  Degradé (40 min)        +20 min muertos
  Corte clásico (20 min)  +10 min muertos
Con la grilla cada 20 minutos no se pierde ninguno. En un día de 11 horas
te entran 16 turnos de Degradé en vez de 10.          [Usar 20 minutos]
```

Se informa **por servicio**, que es exacto, y no "perdés 200 minutos por día",
que supondría una mezcla de turnos que nadie midió. Los "turnos que entran" usan
la jornada real del horario cargado.

**"¿Y si pongo 10 y me entra un servicio de 60?"** La pregunta apareció sola y
tiene dos mitades. La primera es un susto infundado: un turno de 60 **ya bloquea
la hora entera**, no un slot de 10 — el motor filtra por solapamiento desde
siempre, y se verificó. La segunda es un problema real que nadie había nombrado:
con la grilla fina el cliente deja **huecos de 10 minutos donde no entra ningún
servicio**. Medido sobre 200 días simulados, con servicios de 20/40/60 y
clientes eligiendo el horario que les gusta (no el primero libre):

| grilla | turnos/día | minutos vendidos | huecos < 20 min | minutos tirados |
|---|---|---|---|---|
| 10 | 13.9 | 460 | 3.3 | 33 |
| 15 | 13.7 | 449 | 6.5 | 54 |
| **20** (el MCD) | **14.0** | **463** | **0** | **0** |
| 30 | 13.2 | 429 | 5.1 | 51 |
| 60 | 11.0 | 365 | 0 | 0 |

El MCD gana en las dos cosas: no deja huecos inútiles y vende más minutos. Más
fino no suma nada y multiplica las opciones que ve el cliente.

Cuatro estados: `ok` (todas las duraciones son múltiplos — se lo confirma),
`mejorable` (hay MCD y se ofrece), **`muy-fino`** (no pierde nada pero la grilla
es más chica que el MCD: se le ofrece agrandarla, con la cuenta de cuántos
horarios ve el cliente), y **`desalineados`**: si el MCD cae por debajo
de 10 (25 y 40 dan 5), la salida NO es achicar la grilla —serían 132 horarios en
un día de once horas y el cliente deja de leer la lista— sino redondear las
duraciones en Servicios. Por eso `INTERVALO_MIN` (lo que se puede escribir, 5) y
`INTERVALO_SUGERIBLE_MIN` (lo que vale la pena ofrecer, 10) son dos cosas
distintas.

**Y la excepción al "no tocar availabilityEngine.js".** El bucle de la grilla es
`for (cursor = inicio; cursor < fin; cursor += slotInterval)`. Con el desplegable
de cuatro opciones nunca podía llegar un 0; con un número que escribe el barbero,
sí — y ese bucle **no termina nunca**, congelándole el navegador a cada cliente
que abra el link de esa barbería. El motor ahora pasa el valor por
`normalizarIntervalo()`. Es la segunda excepción hecha a ese archivo (la primera
fue `corteLocal`), y está defendido en tres lugares: el campo al salir del foco,
el guardado, y el motor. Verificado escribiendo `slotInterval: 0` directo en
Firestore: la página responde normal y ofrece la grilla de 30.

```bash
node scripts/test-intervalo.mjs   # 96 casos, sin emulador
```

**Lo que NO se hizo, y por qué.** La otra salida era reescribir el motor para
que los turnos se "peguen" al final del anterior. Deja horas irregulares (09:20,
10:50), el barbero pierde la previsibilidad del día, y los números dicen que el
camino simple ya llega a cero huecos. Queda para el día que aparezca una
barbería con duraciones que no se puedan alinear.

**Pendiente, acordado con Santiago:** que cada barbero tenga su propio intervalo
y su propia duración por servicio. El modelo ya tiene `customDuration` en el
vínculo barbero–servicio y el motor del cliente la respeta, pero está a medio
construir: **no hay dónde cargarla** en el panel (se escribe `null` al crear el
vínculo) y **`createAppointment` la ignora** — usa siempre `durationMinutes` del
servicio. Si se cargara hoy a mano, la grilla del cliente usaría una duración y
el servidor guardaría otra en `endTime`, y la agenda se desacomodaría sola. Hay
que arreglar el servidor antes de ofrecerlo.

### El MCD trataba a todos los servicios como si salieran igual (13/10/2026)

Lo de arriba sigue siendo cierto y sigue andando, pero le faltaba la mitad del
problema, y la trajo Santiago mirando una cuenta real:

> "Volcado tiene 30 y 60 y la grilla en 60, y vos decís que correspondía 30.
> Pero lo más frecuente que tienen es el de 60. El de 30 es solo barba y no va
> casi nadie: el 90% pide el de 60. **No es solamente una cuestión matemática,
> es de qué es lo que más sale.**"

Tenía razón. El MCD minimiza el tiempo muerto *por servicio*, pero los pondera a
todos igual: con el de 60 al 90%, bajar la grilla a 30 fragmenta el día para
atender un servicio que casi no se pide. Simulado sobre 6000 días (jornada de
11 h, 13 pedidos, el cliente se corre hasta una hora de su horario preferido
antes de no reservar), barriendo cuánto sale la barba:

| la barba sale el | grilla 60 | grilla 30 | gana |
|---|---|---|---|
| 5 % | 526 min | 494 | **60** (+32 min/día) |
| 10 % ← Volcado | 515 | 493 | **60** (+22) |
| 15 % | 500 | 489 | **60** (+11) |
| **20 %** | 485 | 484 | **empatan** ← el cruce |
| 25 % | 473 | 482 | **30** (+9) |
| 40 % | 433 | 468 | **30** (+34) |
| 50 % | 406 | 457 | **30** (+51) |

**El cruce está en 1 de cada 5**, y de ahí sale la regla, que además se puede
decir en una frase: *la grilla va a la duración del servicio que más te piden,
salvo que los que no encajan ahí sumen más de 1 de cada 5 turnos — entonces va
el MCD*.

Con la grilla gruesa SÍ hay tiempo muerto (17 a 27 min/día en Volcado: el rato
que deja cada barba), solo que vende más igual. El panel lo dice en vez de
esconderlo: *"cada Barba deja 30 min sueltos. Ya está contado: igual te
conviene."* Un consejo que oculta su costo no se puede chequear.

**Y el dato no hace falta pedirlo: ya está.** Cada turno guarda su `serviceId`,
así que la mezcla se cuenta. Esto importa porque la pregunta original era otra:

> "No me termina de convencer cómo explicar esto. En cada servicio ellos ponen
> cuánto tarda, entonces no terminan de entender qué es el intervalo. **No sé
> cómo explicarlo, no sé bien cómo decirles cuánto les aconsejo.**"

La respuesta no es redactarlo mejor: es no tener que explicarlo. El barbero ya
contestó cuánto dura cada servicio, y cuáles se piden más lo dicen sus turnos.

**Cómo quedó la pantalla** (`IntervaloDeTurnos`):

- **El campo manual no se tocó y nadie pierde su número.** Sigue siendo libre
  (5 a 120) y es el que manda. Lo nuevo propone; el barbero decide.
- **Arriba, el panel del automático**, con el cálculo hecho con SUS turnos:
  *"De tus últimos 120 turnos, el que más te piden es Corte (60 min): 108 de
  120. Barba (30 min) no entra redondo en esa grilla, pero sale 1 de cada 10.
  Por tan poco no conviene partirle el día al que más sale."* Con el botón
  **"Usar 60 minutos"**, o un *"Ya lo tenés en el que te conviene"* si no hay
  nada que cambiar.
- **Un `<details>` "¿Cómo lo calcula?"**, cerrado. El que pregunta lo abre.
- **Debajo del campo, nunca la palabra "intervalo"**: *"Tus clientes ven 09:00 ·
  09:30 · 10:00 · 10:30…"*, con el horario de apertura real del local. Nadie se
  imagina una grilla; todos se imaginan una lista de horarios.

**Con historial, el automático es el ÚNICO que opina.** `diagnosticoDelIntervalo`
(el del MCD) queda para la barbería sin turnos cargados. Si hablaran los dos a
la vez se contradicen —en Volcado uno diría 60 y el otro 30— y dos consejos
opuestos en la misma pantalla no son más información, son ninguna.

Detalles que valen:

- **`TURNOS_MINIMOS = 20`.** Con 8 turnos, uno solo de barba pesa 12% y dos
  pesan 25%: la respuesta salta de un lado al otro del cruce por un turno. Por
  debajo de eso dice que todavía no puede y vuelve al MCD, que no pierde nada
  con ninguna mezcla.
- **La duración sale del servicio como está HOY**, no de lo que duraba el turno
  cuando se tomó: lo que se decide es la grilla de acá en adelante.
- **No cuentan los cancelados** (no ocuparon el horario) ni los adicionales (no
  se reservan solos). **Los "no vino" SÍ**: el horario estuvo tomado, que es lo
  único que le importa a la grilla.
- **Empatados, gana el más corto.** Con 50/50 de 30 y 60, el desempate toma 30,
  y entonces el de 60 encaja solo: se llega a la respuesta buena sin el MCD.
- Solo se avisa del tiempo suelto de los servicios que **de verdad se piden**:
  hacerlo por uno que nadie reserva es ruido y debilita el resto del cartel.

**Lo que esto arregla en producción:** a Volcado Club el panel le estaba
ofreciendo el botón para bajar la grilla a 30. Si lo tocaba, perdía ~22 minutos
vendibles por día. El cálculo estaba bien y la conclusión mal.

### Ausencias: el día suelto que un barbero no va (13/10/2026)

Lo pidió el caso de una sucursal de Franlook con dos barberos: *"justo hoy
Pepito no puede trabajar, que pueda desactivar ese miércoles puntual y no
acordarse de activar para el próximo miércoles"*. La alternativa que la gente
usaba era apagar el miércoles en su horario semanal — y el día que alguien se
olvida de volver a prenderlo, pierde **todos** los miércoles.

Dos formas, la segunda del mismo pedido: **día completo** y **franja** ("hoy me
tengo que ir de 15:00 a 18:00 y después vuelvo").

**El modelo**: `businesses/{id}/ausencias/{profId_fecha_franja}`, con
`{ professionalId, fecha, desde, hasta }`. `desde`/`hasta` en null = el día
entero.

- **Un documento por DÍA, no un rango.** Para las vacaciones daban ganas de
  guardar `{ desde, hasta }`: no se puede preguntar. Firestore **no admite
  desigualdad sobre dos campos distintos** en la misma consulta, así que
  `fecha <= hoy AND hasta >= hoy` no existe. Con un doc por día es una igualdad
  y no necesita ni índice. El selector de desde/hasta escribe los días en un
  solo lote, con tope de 366 por si alguien tipea mal el año.
- **El id es la clave natural** (`prof-pepito_2026-10-21_1500`), mismo truco que
  las reseñas y los usos de membresía: tocar el botón dos veces con la conexión
  lenta no deja duplicados.
- **Lectura pública**, igual que `schedules`: la grilla del cliente la necesita
  antes de que haya sesión. **Por eso no lleva motivo**: "está enfermo" quedaría
  legible para cualquiera que mire la API.
- **Escribe el dueño, o el barbero LA SUYA** (`esSuHorario`, el mismo helper que
  los horarios). Sin esa segunda condición, un barbero le marca ausencias al
  compañero y se queda con sus turnos.

**Dónde se hace cumplir** — si falta uno, el turno entra igual:

| dónde | qué hace |
|---|---|
| `utils/ausencias.js` | la cuenta, pura y probada sin emulador |
| `availabilityEngine` | **tercera excepción** al "no tocar" (las otras: `corteLocal` y `normalizarIntervalo`) |
| `professionalWorksOnDate` | apaga el día en el calendario, solo si falta ENTERO |
| **`createAppointment`** | la barrera de verdad: con la consola abierta se saltea todo lo demás |
| `turnosFijos` (`motivoDelDia`) | saltea esa fecha y la serie sigue |
| `NuevoTurnoModal` | el staff tampoco ve esos horarios |

**Encaja sin camino nuevo.** Una ausencia parcial es otro rato excluido, igual
que el descanso del profesional y el corte del local, y se descuenta en el mismo
lugar del bucle. Una de día completo corta antes y devuelve cero horarios.

**Falla CERRADO.** Un registro cuya franja no se entiende bloquea el día entero,
no lo deja pasar. Lo destapó un caso de la suite: con `desde: 'xx'` la primera
versión no bloqueaba nada, o sea que alguien marcaba que no venía y el cliente
igual sacaba turno. Entre perder unos horarios y mandarle un cliente a un
barbero que no está, se pierden los horarios.

**Los turnos ya reservados NO se tocan**, y es una decisión, no una omisión. Al
marcar la ausencia se muestra "ya tenés N turnos ese día" y los cancela el
barbero desde Citas: a cada cliente hay que avisarle, y eso lo decide una
persona. Marcar la ausencia saca los horarios LIBRES; los que ya reservaron
siguen ahí.

**Dónde se carga**: Mi Configuración (el barbero, la suya) y Profesionales →
📅 en la fila (el dueño, la de cualquiera). En Profesionales va en un modal
PROPIO y no adentro del de editar: las ausencias se guardan al toque, y ahí
adentro "Cancelar" parecería deshacerlas.

```bash
node scripts/test-ausencias.mjs   # 97 casos, sin emulador
```

Más 13 casos nuevos en la suite de reservas (el servidor rechazando día
completo, franja, los bordes exactos, la ausencia de otro barbero, y el fallo
cerrado) y 8 en la de Rules.

Trampa al escribir esos casos: la suite de reservas trabaja sobre un día de la
semana fijo (`DOW`), así que una fecha de prueba que caiga en otro día falla por
*"el profesional no trabaja ese día"* y parece un bug de las ausencias. Y
`crear()` en la auditoría de Rules hace POST a la **colección** (id automático),
no a una ruta de documento; para probar lectura y borrado hay que sembrar con el
Admin SDK, porque un 404 cuenta como denegado.

### El "gracias" de WhatsApp pide la reseña (27/10/2026)

*"Para las reseñas tendría que haber también un mensaje, en el de gracias:
valorar a nuestro peluquero, con el link de la parte de reseñas de ese corte. Y
también con el link de Google Maps, ambos links."*

El agradecimiento es **el único momento en que el cliente está contento y con el
teléfono en la mano**. Pedir la reseña en cualquier otro momento es pedirla
tarde, y por eso los links van ahí y no en un mensaje aparte.

```
Hola Juan! Gracias por elegirnos en La Barbería. ¿Nos dejás tu opinión?
Nos ayuda un montón.

⭐ Valorá a tu peluquero: https://barberos.sacia.tech/la-barberia/mis-citas?valorar=…

📍 Y si te queda cómodo, en Google: https://g.page/r/…/review

¡Te esperamos la próxima!
```

**Los dos links, no uno**: la valoración de la app alimenta el promedio por
barbero del panel, y la de Google es la que ve el que todavía no es cliente.
Sirven para cosas distintas. Si la barbería no cargó su ficha de Google va solo
el primero, y si no corresponde ninguno el mensaje vuelve a ser el de siempre
—sin una pregunta colgada sin links debajo—. Hay un caso para cada combinación.

**No hay una pantalla de reseña por turno, y no se hizo una.** La valoración
vive adentro de "Mis citas", en un modal; el link abre esa misma pantalla con
`?valorar={idDelTurno}` y el modal se abre solo. Una ruta menos que mantener, y
el aislamiento ya está resuelto: "Mis citas" muestra solo los turnos del que
entró.

Tres detalles que hacen que no mande links muertos ni deje la pantalla rara:

- **Solo para turnos de una cuenta de cliente de verdad.** Los que carga el
  staff a mano (`manual`, `walkin`, `fijo`) llevan el `userId` del que los
  cargó: ese link le abriría "Mis citas" vacío a alguien que nunca entró a la
  app. Un link muerto adentro de un agradecimiento es peor que no mandar link.
- **Solo si el turno está `completada`.** Antes no hay nada que valorar y las
  Rules lo rechazarían igual.
- **El parámetro se saca de la URL al cerrar el modal.** Si quedara puesto, el
  modal se volvería a abrir solo, y el cliente que copia la dirección de la
  barra para compartirla estaría mandando el link para valorar SU turno.

El modal se **deriva** del parámetro en vez de copiarse a un estado adentro de
un efecto: el turno llega por la suscripción un rato después que la pantalla, y
guardar en estado algo que ya está en la URL es tener la misma verdad en dos
lados. (El lint lo marca, con razón: `react-hooks/set-state-in-effect`.)

Y se le ofrece a **todos**, no solo a los que uno cree que van a puntuar bien:
filtrar por quién parece conforme es *review gating*, Google lo prohíbe y puede
costarle la ficha al negocio. Es la misma regla que ya regía en la pantalla de
después de valorar.

```bash
node scripts/test-whatsapp.mjs   # 32 casos (9 nuevos), sin emulador
```

### "No encontramos este negocio" en un link que existe (24/10/2026)

Un barbero mandó una captura: abrió `barberos.sacia.tech/su-barberia` desde el
navegador de Instagram y leyó **"No encontramos este negocio"**. En SU propio
link. Y a veces sí y a veces no.

**No era la conexión: era una ventana de carrera.** Resolver el link son dos
pasos y el segundo llega después:

```
1. se lee /slugs/{slug} y se sabe qué barbería es   → slugEstado: 'ok'
2. llega el documento de la barbería (listener)     → business
```

Entre los dos, `business` todavía es `undefined` y el estado **ya no es
'resolviendo'**. La condición era *"si ya no está resolviendo y no hay negocio,
entonces no existe"*, así que en esa ventana la pantalla declaraba que la
barbería no existe. En una conexión rápida dura milisegundos y no se ve nunca;
en el navegador de Instagram con 4G dura lo suficiente para que el cliente lo
lea y se vaya.

Esto ya se había arreglado una vez —el destello de error mientras el slug
resolvía— y se arregló **la mitad**: se cubrió `'resolviendo'` y quedó
descubierto `'ok'`.

**La regla, ahora en una sola función pura** (`utils/estadoDelNegocio.js`):
*solo se declara que algo no existe cuando alguien lo afirmó*, y lo único que
puede afirmarlo es la lectura del slug. Todo lo demás es "todavía no sé"
(cargando) o "no pude averiguarlo" (otra pantalla, con botón).

**Los otros tres agujeros del mismo viaje**, todos encontrados mirando este:

1. **`obtenerSlug` usaba `getDoc`**, que contesta desde el caché cuando la red
   no está — y un documento que no está en el caché se ve **exactamente igual**
   que un documento que no existe: `exists() === false`, sin ningún error. Una
   mala señal le decía al cliente que la barbería no existe. Ahora va con
   `getDocFromServer` y devuelve `{ datos, confiable }`: de un `datos: null`
   con `confiable: false` no se concluye nada. Es la única lectura del proyecto
   que exige servidor, y se justifica porque es de la que sale ese cartel.
2. **El resultado negativo se cacheaba.** `slugResuelto.current` guardaba el
   `null` de una lectura fallida, así que el error se volvía **permanente**: el
   resto de la visita contestaba "no existe" desde la memoria sin volver a
   preguntar. Por eso cerrar y abrir no siempre lo arreglaba. Ahora el caché
   guarda solo resultados buenos.
3. **El `catch` solo logueaba**, así que una lectura que fallaba dejaba la
   pantalla en "Cargando…" **para siempre**. Y si el listener del negocio no
   contestaba nunca, lo mismo. Ahora hay un reloj de 12 segundos y los dos
   caminos terminan en la pantalla de "no pudimos cargar", con *Reintentar*.

Y se agregó un reintento con espera creciente (3 intentos) antes de concluir
nada: una sola lectura fallida no puede ser la diferencia entre "tu barbería" y
"no encontramos este negocio".

```bash
node scripts/test-estado-negocio.mjs   # 19 casos, sin emulador
```

El que importa, y que la lógica vieja NO pasaba (comprobado corriendo las dos):
*el slug resolvió pero el negocio todavía no llegó* → **cargando**, no "no
existe".

**Es la tercera vez que este error aparece con otra ropa** en este proyecto: el
turno que no se podía dar y no decía por qué, la agenda vacía del barbero con
el vínculo roto, y esto. Siempre es lo mismo: **confundir "no sé" con "no
hay"**.

### "Pidió cualquiera": que el barbero se entere, y poder cambiarlo (22/10/2026)

Santiago, de una barbería con dos barberos: *"cuando eligen cualquiera se le
asigna a cualquiera de los dos, y cuando llegan el barbero no se entera que
vino con esa opción: es como si lo hubieran elegido a él."*

**Lo que NO se hizo, y por qué.** La salida intuitiva es bloquearles el horario
a los dos hasta que decidan. No va, y lo vio él mismo: un turno a las 18:00
dejaría a todo el equipo sin esa hora, y el cliente que SÍ quiere a uno puntual
se queda afuera. Con dos barberos se pierde el doble de agenda; con cuatro, el
cuádruple. Es aritmética, no se arregla.

Entonces se sigue asignando uno —el servidor, adentro de su transacción— y se
arregla lo que de verdad faltaba, que es **que nadie se enteraba**:

1. **El turno lo dice.** `pidioCualquiera: true`, y en la agenda aparece
   *"👥 Pidió cualquiera — lo atiende el que esté libre"*.
2. **Y se puede cambiar en el mostrador**, con un desplegable en el turno.

**La segunda es la que contesta la pregunta de verdad**, y la pregunta la hizo
él: *"¿cómo se anota a quién lo atiende después, para que entre en las
estadísticas?"*. Marcar el turno no alcanza: si lo atiende el otro y el turno
sigue a nombre del primero, quedan mal los ingresos por barbero, las reseñas y
**la venta del producto**.

**Por qué es una function y no una escritura del panel.** Mover un turno no es
cambiar un campo: hay que verificar que el otro haga ese servicio, que trabaje
ese día, que el horario entre en SU jornada y no en su descanso, que no haya
avisado que ese día no viene, y que no tenga otro turno encima. Nada de eso se
puede expresar en las Rules —no saben consultar la agenda— y en el browser se
saltea con la consola abierta. El solapamiento se chequea **dentro de una
transacción**: dos personas en el mostrador moviendo turnos al mismo barbero a
la misma hora leerían las dos "libre".

**Y arrastra lo que cuelga.** Es la parte que no se ve: `ventasProductos` y
`reviews` guardan el `professionalId` por su cuenta, así que sin moverlos la
cera se la sigue acreditando el que no la vendió. Queda anotado quién movió el
turno y desde quién (`reasignadoDe`, `reasignadoPor`): cuando a fin de mes un
número no cierra, lo primero que se pregunta es si alguien lo movió.

**Quién puede.** El dueño y el mostrador mueven cualquier turno de su barbería.
El peluquero **solo puede ponerse a sí mismo** — es el "lo atiendo yo" — porque
si no tendría cómo sacarse de encima los turnos que no quiere pasándoselos al
compañero. (En la práctica el peluquero ni ve los turnos de otro: las Rules le
filtran la agenda. El límite está igual, del lado del servidor.)

```bash
node scripts/test-reservas-emulador.mjs   # 140 casos (21 nuevos de esto)
```

Dos trampas que costaron una corrida cada una, las dos ya documentadas en este
archivo y pisadas igual:

- **Firestore exige TODAS las lecturas antes que las escrituras** en una
  transacción. La reseña se leía después de actualizar el turno y la function
  tiraba `INTERNAL` sin mensaje: la reasignación no pasaba y en pantalla no se
  entendía por qué.
- **`DOW = 1` es MARTES**, no lunes (la convención de la app es 0=Lunes). Con
  una fecha de prueba en lunes, todo falla por *"no trabaja ese día"* y parece
  un bug de la reasignación.

### Productos: la cera que el barbero vende al lado del corte (22/10/2026)

*"Los barberos quieren subir una cera para el pelo que venden. Estaría bueno que
la puedan subir ahí a productos, y que cuando reserven un corte les aparezca la
sección de productos para seleccionar algo si quieren."*

Sección **propia**, no un servicio con `adicional: true`. Los adicionales
(cejas, lavado, café) quedan exactamente como estaban. La diferencia no es de
prolijidad: un adicional es **trabajo** —lo hace una persona, se hace durante el
corte, no se agota— y un producto es **mercadería**: tiene stock, tiene foto, y
cuando se vendió el último no se puede vender otro. Meterle stock a `services`
obligaría al motor de disponibilidad a ignorar un campo que no le importa, y a
la pantalla de Servicios a preguntar por unidades a quien está cargando un
corte.

```
businesses/{id}/productos/{id}         ⚠️ lectura pública (el cliente los ve
                                          antes de tener sesión). Escribe el
                                          dueño: es su mercadería.
businesses/{id}/ventasProductos/{aptId}  🔒 la venta. NADIE la escribe desde el
                                          browser, ni el dueño.
```

**El stock es del LOCAL; la venta es del BARBERO.** Decisión de Santiago: hay 10
ceras y son del local, cualquiera las vende. Lo que se registra es **quién** la
vendió, y sale del barbero del turno. No hay stock por barbero.

**El stock baja adentro de la transacción del turno.** Es toda la decisión
técnica. `createAppointment` lee los productos con `tx.get` —no antes— porque
entre leer el stock afuera y escribir el turno adentro hay una ventana, y esa
ventana es exactamente donde la última cera se vende dos veces. Del cliente
llegan **solo el id y la cantidad**: el precio sale del documento.

**Y vuelve si el turno no pasa**, con el trigger `onTurnoConProductos`:

| el turno queda | el stock | por qué |
|---|---|---|
| `cancelada` | **vuelve** | nadie se llevó nada |
| `no_asistio` | **vuelve** | acá se separa del cupón: el cupón SÍ se consume con un no-show (el horario quedó bloqueado y eso es lo que el descuento pagó), pero la cera sigue en el estante |
| `completada` | se queda | se la llevó |

El candado contra el doble conteo es el mismo que el del uso del cupón: manda el
`estado` del documento de VENTA, no el del turno. Sin eso, cancelar →
reactivar → cancelar devolvería las unidades dos veces y el stock subiría solo.
Hay un caso de la suite que hace exactamente esa secuencia.

**`stock: null` es "no lo controlo", y es distinto de `stock: 0`.** El barbero
con una caja de sobres de gel no los cuenta, y obligarlo a mantener un número
que no mira termina con todo en cero y nada vendible. Confundir los dos deja el
catálogo sin vender de un día para el otro, así que hay cuatro casos sobre esa
sola distinción. Un producto sin control de stock se ofrece siempre y la venta
anota `descontado: false`, para que el trigger no le sume unidades a algo que
nunca las tuvo.

**Lo que se agotó no se esconde del panel** —el dueño tiene que verlo para
reponerlo, y hay un ＋/− en la fila— pero sí deja de ofrecerse al cliente. Y en
la reserva el ＋ se apaga en la última unidad: el servidor igual lo rechazaría,
pero recién después de que el cliente eligió día y horario, y ahí ya le
arruinamos la reserva por algo que se sabía antes.

**La foto** va como data URL de ≤320 px adentro del documento, igual que la del
barbero y el logo (sin Storage), con el tope en las Rules. Por eso los productos
**NO entran en la suscripción de `BusinessSync`**: esas imágenes se bajarían en
todas las pantallas del panel, todo el tiempo, incluso para el barbero que nunca
abre Productos. Se leen de una vez donde hacen falta (la reserva y la pantalla
del panel), como "Mis sucursales" y las reseñas.

**Los productos se pagan siempre y enteros**: la membresía cubre el *servicio* y
el cupón descuenta el *servicio*. Una membresía que además regalara la cera sería
la barbería regalando mercadería que compró.

**En la agenda aparecen pegados al servicio** (`textoProductos` en
`utils/adicionales.js`, que ya era el "qué más tiene este turno"). No es
decoración: es lo único que le dice al barbero que tiene que sacar algo del
estante. Un producto comprado que no aparece en la agenda es un producto que el
cliente pagó y nadie le dio.

```bash
node scripts/test-productos.mjs            # 54 casos, sin emulador
node scripts/test-reservas-emulador.mjs    # 119 (38 nuevos: stock, precio, devolución)
node scripts/auditar-rules-emulador.mjs    # 152 (10 nuevos)
```

Trampa al escribir esos casos: **los triggers del emulador tardan**. Con una
espera fija de 3,5 s el caso de la devolución fallaba y parecía un bug del
trigger; el primer disparo de cada trigger carga el contenedor. Se espera hasta
que el stock llegue al valor esperado, con tope.

**Lo que NO está hecho, y Santiago lo pidió:** la sección de productos en la
página de la barbería, y pedirlos **después del corte** desde Mis Citas para que
se sumen al total. Se acordó arrancar por el catálogo y la reserva. Lo que falta
necesita una function aparte (`pedirProducto`): agregarle un producto a un turno
que ya existe mueve el precio, y el precio del turno no lo puede tocar el
browser. El staff tampoco puede sumar productos desde `NuevoTurnoModal`
todavía — ese modal escribe directo a Firestore, no por la function.

### Cuándo vence el abono: la fecha que nadie veía (19/10/2026)

Dos agujeros del mismo dato, los dos encontrados por Santiago usando el panel.

**1. El panel global decía "2026".** La tarjeta de cada barbería mostraba el
próximo vencimiento (y el último pago) con
`formatDate(x).split(',')[1]`. `formatDate` devuelve *"Martes 21 de Octubre,
2026"*, así que la mitad de después de la coma es **solo el año**: la tarjeta
decía `2026` y no había forma de saber cuándo vencía ninguna cuenta. Alguien
quiso sacarle el día de la semana y se quedó con la mitad equivocada. Ahora es
`fechaDMA()` → `21/10/2026`, en los tres lugares que tenían el mismo `split`.

**2. El dueño no se enteraba hasta que lo cortaban.** La fecha vive en
`/private/billing`, que **no lee ni él** (ahí están la deuda y el abono), así
que su panel no tenía de dónde avisarle. Se enteraba cuando la cuenta ya estaba
congelada y el link no tomaba turnos — para él, una caída del sistema.

Ahora `runBilling` copia **solo la fecha** al documento público, en
`proximoVencimiento`, y `AdminLayout` muestra una barra arriba del panel:
*"Te quedan 3 días para abonar: se te vence el 21/10/2026"*, con el botón de
WhatsApp. A los 0 días y pasada la fecha cambia el texto.

- **Solo la fecha.** La deuda, el abono y el historial siguen donde estaban. Por
  eso el cartel dice **cuándo** y no cuánto.
- **El dueño no la puede tocar**: está en la lista de campos protegidos de las
  Rules, al lado de `trialEndsAt`. Si no, se corre el aviso para adelante.
- **No hay que migrar nada.** La comparación está afuera del `if (changed)`, así
  que la primera corrida nocturna completa las cuentas que ya existían.
- **El espejo y `isFrozen` van en UNA sola escritura.** Los dos apuntan al mismo
  documento, y dos `set` sobre el mismo doc en un batch es justo la clase de
  detalle que anda hasta el día que no.
- **En período de prueba no se copia nada**: ahí manda el cartel de la prueba, y
  dos barras diciendo cosas parecidas no son más información. Por lo mismo, si
  hay vencimiento cargado se deja de mostrar el *"se terminó tu prueba"* — una
  cuenta que pasó al plan y a la que nadie le borró `trialEndsAt` lo mostraría
  para siempre.
- **Siete días de anticipación**: el barbero transfiere cuando se acuerda, y un
  aviso del día anterior llega tarde. Treinta lo dejaría prendido siempre, y un
  cartel que está siempre deja de leerse.

```bash
node scripts/test-billing-emulador.mjs      # 20 casos (6 nuevos)
node scripts/auditar-rules-emulador.mjs     # 142 (el dueño no corre la fecha)
```

### "Mañana trabajo de 10 a 13": el horario especial de un día (16/10/2026)

Santiago: *"Mañana tengo un barbero que solo por la mañana va a trabajar de 10
a 1 de la tarde. Después todo el resto de los días, incluido el próximo sábado,
va a trabajar normal como siempre. Y no hay una opción para poner eso: está la
opción para poner en qué momento no vas a estar, pero no para poner tal día
hago este horario."*

Tenía razón, y el agujero era exactamente ese. Con las ausencias se podía
expresar —cargando que falta de 09:00 a 10:00 **y** de 13:00 a 20:00— pero eso
es pedirle al barbero que traduzca lo que quiere, y que lo traduzca contra su
propio horario semanal. Dos registros donde él piensa un horario. Y si el
horario semanal cambia, la traducción queda vieja sin que nadie se entere.

**Se guarda el rato que SÍ trabaja**, en la misma colección `ausencias`:

```
{ professionalId, fecha, desde: null, hasta: null,
  trabajaDesde: '10:00', trabajaHasta: '13:00' }
```

y `bloqueosDelDia` devuelve los ratos de **afuera** (`[0, 10:00)` y
`[13:00, 24:00)`). Esa es toda la decisión de diseño: es una ausencia dicha al
revés, así que la calculan y la hacen cumplir **los seis lugares que ya miraban
las ausencias, sin que ninguno aprenda un caso nuevo** — el motor, el
calendario, `createAppointment`, los turnos fijos y el modal del staff. Un
horario con fecha metido en `schedules` habría obligado a los cinco a aprenderlo
de a uno.

**Por qué `desde`/`hasta` quedan en `null`.** Es la parte que más importa y no
se ve. Si se reusaran esos campos para guardar el rato que trabaja, un servidor
o un bundle **viejo** leería "no trabaja de 10 a 13": exactamente lo contrario,
y mudo. Con los dos en null, el código viejo ve un documento sin franja y
bloquea el día **entero**. Perder un día de horarios se nota y se arregla;
mandarle un cliente a un barbero que no está, no. Por eso el orden de despliegue
no es crítico pero conviene igual: **Functions primero, front después.**

**El id lleva su propio sufijo** (`prof_fecha_horario`, contra `prof_fecha_todo`
de la ausencia de día completo): cargar un horario especial no puede pisar en
silencio el día que el barbero marcó que no venía. Conviven, y **gana el que no
viene** — si alguien marcó que no va, no va.

**Solo RECORTA el semanal, nunca lo agranda.** Un horario especial no puede
abrir un día que el barbero libra, ni extenderle la jornada más allá de lo que
tiene cargado (el horario del local también lo acota). Eso podría ser una falla
muda de libro —día prendido en el calendario, cliente que entra y lo encuentra
vacío— así que está dicho en los dos lados:

- el panel lo avisa **antes** de guardar, con la cuenta hecha: *"Los martes
  atendés de 14:00 a 20:00. De 10:00 a 13:00 no se cruza con eso, así que ese
  día no quedaría ni un turno"*, o *"los lunes no tenés horario cargado, así que
  esto no va a abrir ningún turno"*;
- y `professionalWorksOnDate` **apaga el día** si la ventana no se cruza con el
  horario semanal, en vez de dejarlo prendido y vacío. Es un retoque más en
  `availabilityEngine.js`, en la misma zona que ya tocaron `corteLocal`,
  `normalizarIntervalo` y las ausencias.

**El turno tiene que caer ENTERO adentro de la ventana**, a diferencia del
horario semanal, donde alcanza con que empiece dentro para no echar al cliente a
la mitad del corte. Acá el barbero avisó que ese día se va a esa hora, y a esa
hora se va. El panel lo dice: *"el último tiene que terminar antes de las 13:00,
así que a esa hora ya estás libre"*.

**Y los turnos ya reservados no se tocan**, igual que con las ausencias: el
panel muestra cuáles quedan afuera y a qué hora, y los cancela una persona desde
Citas.

**En el panel** son dos botones arriba del formulario —*"No voy a estar"* y
*"Ese día hago otro horario"*— en Mi Configuración y en Profesionales → 📅. Dos
botones y no un desplegable porque el pedido empezaba con *"no hay una opción
para poner eso"*: la opción tiene que **verse**.

```bash
node scripts/test-ausencias.mjs   # 97 casos (46 nuevos), sin emulador
```

Un caso de esos 46 encontró un bug de verdad, y no en lo nuevo:
`timeToMinutes` hace `.split(':')` sin red, así que un documento a medio
escribir **reventaba** `bloqueosDelDia` — o sea la grilla del cliente, entera,
en el navegador. Ahora pasa por `minutosDe()`, que devuelve `NaN`, que es lo que
la función ya sabía tratar: bloquear el día.

### El login se rompe adentro del navegador de Instagram (14/10/2026)

Un cliente mandó una captura: entró a reservar, tocó "Continuar con Google" y
terminó en una pantalla blanca de `barberos-1d60e.firebaseapp.com` que decía
*"Unable to process request due to missing initial state. This may happen if
browser sessionStorage is inaccessible or accidentally cleared."*

La cadena, en orden:

1. Está adentro del navegador de otra app (Instagram, Facebook, WhatsApp): la ✕
   arriba a la izquierda, no la barra de Safari.
2. Ese navegador **bloquea las ventanas emergentes**, así que `signInWithPopup`
   no puede abrir nada y Firebase cae SOLO a su camino alternativo, redirigir.
3. La redirección sale a `<proyecto>.firebaseapp.com`, que es **otro dominio**.
4. iOS aísla el almacenamiento entre dominios, así que esa página no puede leer
   el `sessionStorage` que escribió antes de salir.

**Esto no es un caso raro: es el camino principal.** El link de una barbería se
reparte por la bio de Instagram y por WhatsApp. Cada persona a la que le pasa no
escribe para avisar — simplemente no reserva.

**El arreglo de fondo** —ya aplicado y verificado en producción el 14/10/2026—
es servir el ayudante de Firebase desde NUESTRO dominio, para que no haya dos
dominios y no haya aislamiento. Fueron tres pasos y **el orden importa**:

1. **Google Cloud Console → Credenciales → el cliente OAuth** → agregar a *URIs
   de redireccionamiento autorizados*: `https://barberos.sacia.tech/__/auth/handler`.
   **Va PRIMERO.** Si no está, Google rechaza la redirección y se rompe el login
   de todos.
2. `vercel.json`: el proxy de `/__/:path*` hacia `barberos-1d60e.firebaseapp.com`.
3. Vercel: `VITE_FIREBASE_AUTH_DOMAIN=barberos.sacia.tech` y **build nuevo**
   (Vite congela las `VITE_*` al compilar).

Los tres están hechos. En Google Cloud se agregó también
`https://barberos.sacia.tech` a *Orígenes autorizados de JavaScript*, porque
`firebaseapp.com` ya estaba ahí y al ayudante le corresponde lo mismo. El
cliente OAuth es el que creó Firebase —`184701087027-nqqk1c29ppm2bdufq6vraflfbm4tpgfa`—
y vive en el proyecto `barberos-1d60e` de Google Cloud, que es el MISMO proyecto
de Firebase aunque nadie lo haya creado ahí a mano. **No confundirlo con
`oAuthBarberia`, que está en el proyecto "SACIA web" y no participa del login.**

Cómo verificarlo sin abrir un navegador (la propagación de Google tarda de 5
minutos a unas horas, así que esto es lo que dice si ya está):

```bash
KEY=AIzaSyA2utnIdWsuBuxBhzGis_e1quOtbB11nUQ
U=$(curl -s -X POST "https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=$KEY"   -H "Content-Type: application/json"   -d '{"providerId":"google.com","continueUri":"https://barberos.sacia.tech/__/auth/handler"}'   | python -c "import sys,json;print(json.load(sys.stdin)['authUri'])")
curl -s -L "$U" | grep -qi redirect_uri_mismatch && echo RECHAZADO || echo ACEPTADO
```

Y que el bundle de producción quedó compilado con el dominio nuevo:

```bash
B=$(curl -s https://barberos.sacia.tech/ | grep -o '/assets/index-[A-Za-z0-9_-]*\.js' | head -1)
curl -s "https://barberos.sacia.tech$B" | grep -o 'authDomain:"[^"]*"'
```

Dos trampas del `vercel.json`, las dos encontradas mirándolo:

- El proxy tiene que ir **antes** del `"/(.*)" → "/index.html"`: Vercel evalúa
  en orden, y con el catch-all delante `/__/auth/handler` devuelve la app.
- **`X-Frame-Options: DENY` estaba sobre `/(.*)`** y el ayudante de Firebase se
  carga en un iframe. `DENY` bloquea el enmarcado incluso del MISMO origen, así
  que habría roto justo lo que se quiere arreglar. Ahora esa cabecera va sobre
  `/((?!__/).*)` y las demás (HSTS, nosniff, Referrer-Policy, Permissions-Policy)
  siguen sobre todo.

**Y un aviso honesto:** según el propio repositorio de `firebase-js-sdk` hay
casos de iOS dentro de estos navegadores que fallan igual con todo bien
configurado. Por eso, además, `utils/navegadorEmbebido.js` detecta que estamos
adentro de una app y **`LoginPage` avisa ANTES de que toque el botón**: "abrilo
en Safari para poder entrar", con la instrucción exacta según iPhone o Android.
Detecta solo las apps donde está comprobado que no se puede (Instagram,
Facebook, WhatsApp, TikTok, LINE, Snapchat, X, LinkedIn y los WebView de
Android): un falso positivo le muestra un cartel innecesario a alguien que iba a
poder entrar igual.

**Nadie llamaba a `getRedirectResult`.** La app usa solo `signInWithPopup`, así
que del camino de redirección —el que de verdad se usa en estos navegadores— no
se recogía ni el usuario ni el error. `onAuthStateChanged` igual termina viendo
al usuario, pero el error se perdía entero. Ahora se llama al arrancar.

### En qué orden ve el cliente los servicios (14/10/2026)

*"Si agregaron tres tipos de corte distintos, quieren modificar cuál aparece en
qué orden cuando el cliente lo va a elegir."* Es un pedido de venta, no de
prolijidad: el primero de la lista es el que más se elige, y hasta ahora el
orden lo decidía el azar de en qué orden los habían cargado.

**Estaba a medio construir, como pasó con `customDuration`.** El campo
`displayOrder` ya existía y se escribía al crear un servicio
(`services.length + 1`), pero no había dónde cambiarlo y de las cuatro
pantallas que muestran servicios **solo la grilla de reserva lo miraba**:

| dónde | antes | ahora |
|---|---|---|
| Reserva (paso 2) | sí | sí |
| Página de presentación | **no** | sí |
| "Agendar turno" del staff | **no** | sí |
| Servicios (el panel) | **no** | sí, y es donde se cambia |

`utils/orden.js` es ahora el único lugar donde vive el criterio — antes el
comparador estaba escrito a mano adentro de `BookingPage`. Tres copias del mismo
criterio es la forma de que un día dejen de coincidir.

**Flechas ▲▼, no arrastrar.** Arrastrar queda mejor en una demo y peor en la
mano: este panel se usa en el celular, la lista scrollea, y "mantener apretado
para arrastrar" pelea contra "deslizar para bajar". Una flecha es un toque, hace
una sola cosa y se deshace con la de al lado. Cero dependencias.

**Se renumera TODA la lista, no solo los dos que se cruzan.** Es el detalle que
hace que ande con los datos reales y no con los ideales: los servicios viejos no
tienen `displayOrder`, y los que lo tienen quedan con huecos al borrar (sacar el
segundo de tres deja 1 y 3) o repetidos. Si solo se intercambiaran dos valores,
mover algo en una lista sin numerar **no haría nada visible** y parecería que el
botón está roto. `mover()` devuelve solo las escrituras que hacen falta y
`guardarOrden()` las manda en un LOTE: de a una, la lista se reacomodaría a
saltos mientras llegan los snapshots.

En "Todas" (cuentas con sucursales) las flechas no aparecen: ahí se mezclan
servicios de varios locales y el `displayOrder` es de cada uno.

```bash
node scripts/test-orden.mjs   # 30 casos, sin emulador
```

Los casos que importan no son los ideales: lista sin numerar, numeración con
huecos (1,3,7), todos con el mismo número, un solo elemento, y que las flechas
de los extremos se apaguen.

**Medido en el celular, porque el panel se usa ahí**: con los botones normales,
cuatro acciones en la fila se comían 166 px de los 375 de un iPhone y el botón
de borrar se iba de pantalla. La clase `.orden-flecha` los baja a 138 px.
Verificado que la fila no desborda y que el alto de la fila es **idéntico** con
y sin flechas — lo del precio partido en dos renglones a 375 px ya estaba antes
y es otro tema.

**Los profesionales tienen el mismo campo y el mismo agujero**: `displayOrder`
se escribe al crearlos y **nadie lo ordena en ningún lado**. Es el mismo
componente y el mismo util; falta hacerlo.

### "Cualquier barbero": lo elige el SERVIDOR (14/10/2026)

El cliente que no conoce a ninguno no tiene por qué elegir a ciegas. En el paso
1 de la reserva hay una tarjeta **Cualquiera — el primero que esté libre**, a lo
ancho y arriba de todo. Solo aparece si hay **más de un barbero activo**: con
uno solo sería una pregunta sin respuesta.

**Y la elección NO la hace el navegador.** Esa es toda la decisión de diseño. Si
esta pantalla eligiera y mandara un `professionalId`, dos personas mirando la
misma grilla mandarían el mismo barbero y la segunda recibiría *"ese horario ya
fue tomado"* **con el otro barbero libre al lado**. El browser manda el
centinela `'cualquiera'` y `createAppointment` resuelve a quién **adentro de su
transacción**, que es el único momento en que la respuesta no puede quedar
vieja entre que se mira y se escribe.

**Cómo quedó el servidor.** La validación por profesional (hace el servicio,
trabaja ese día, entra en el horario, promo, descansos, ausencias) se extrajo a
`motivoNoPuede(profId)`, que **devuelve el motivo en vez de tirarlo**:

- con un profesional elegido a dedo, quien llama tira el motivo tal cual — los
  mensajes y su orden son exactamente los de antes;
- con "cualquiera", se pregunta por todo el equipo y quedan los que pasan.

Si no queda ninguno, **se informa el motivo más repetido** y no un "no hay nadie
disponible": si todos libran ese día, lo que hay que decir es eso.

Adentro de la transacción se lee la agenda del día de cada candidato (una
consulta por barbero, acotado por el tamaño del equipo), se toma el primero
libre y recién ahí se escribe. El orden de los candidatos se mezcla al azar para
que el primero de la lista no se lleve todos los turnos de los que no eligen.

⚠️ **La trampa del reintento, otra vez.** Firestore reintenta el callback de la
transacción y el barbero elegido es estado MUTABLE: se vuelve a resolver al tope
de cada intento, al lado de `cobro`, `tipoPago` y `montoSena`. Es el mismo
agujero que ya nos costó un turno guardado con precio de promoción sin consumir
el cupón.

La function **devuelve siempre `professionalId` y `professionalName`**, no solo
con "cualquiera": es lo que le permite a la confirmación decir con quién le
tocó, y el cliente que no eligió necesita enterarse. El turno se guarda con el
barbero real, nunca con el centinela.

**En el navegador**, los pasos 2 a 4 trabajan sobre la UNIÓN de los elegibles:

- **servicios**: los que hace alguno. Con más de uno en juego, el precio y la
  duración son los del SERVICIO y no los de un barbero — es lo que va a usar el
  servidor igual, y mostrar el de uno sería prometer el de otro (hoy
  `customPrice`/`customDuration` están siempre en null, así que no hay
  ambigüedad; el día que se habiliten, esto ya está decidido);
- **calendario**: el día sirve si trabaja alguno;
- **horarios**: la unión sin repetir. Si a las 10 uno está ocupado y el otro no,
  las 10 se ofrecen;
- **ocupados**: una llamada a `getBusySlots` por elegible, cada respuesta marcada
  con SU profesional — el motor necesita saber de quién es cada turno tomado.

Detalle que lo rompía y no se ve en ninguna prueba: el paso 6 estaba condicionado
a `selectedProfessional`, que con el centinela es `undefined`, así que **la
pantalla de confirmar quedaba en blanco** y la reserva no se podía terminar. Hay
un profesional "de mentira" para pintar el resumen hasta que el servidor elija.

```bash
node scripts/test-reservas-emulador.mjs   # 81 casos (12 nuevos de esto)
```

Los que importan: que el segundo cliente a la misma hora entre con el OTRO
barbero (que es el punto), que con los dos ocupados recién ahí se rechace, que
la ausencia de uno no bloquee al otro, que el motivo informado sea el real, y
que el camino del profesional elegido a dedo no haya cambiado en nada.

### Cargar un barbero ya le da acceso a su agenda (14/10/2026)

Santiago: *"a los barberos, cuando ponen continuar con Google, a todos les pone
como cliente. No los deja ver sus turnos. Les está pasando a todos los de las
distintas sucursales de Franlook."*

No era un bug del login: **cargar un profesional y darle acceso al panel eran
dos pasos, en dos pantallas distintas, y el segundo se olvidaba.** Mirado en
Firestore: `businesses/{sucursal}/admins` de Franlook Florida tenía UN solo
documento, y `pendingAdmins` estaba vacío. Las fichas existían; el permiso no.

Y el síntoma es mudo: el barbero entra con Google perfecto, el sistema no
encuentra claims, lo trata como cliente, y nadie se entera hasta que él avisa.

**Ahora el alta de un profesional incluye el acceso.** En el modal, debajo del
email, una casilla **"Darle acceso al panel para ver sus turnos"**, prendida por
defecto y apagada (deshabilitada) si no hay email, porque sin email no hay a
quién darle nada. Al guardar se dice qué pasó: que ya puede entrar, que quedó
anotado para su primer login, o que NO se pudo y por qué.

**Va por `setBusinessAdmin`, la función de siempre, y no con una copia de su
lógica adentro de `crearProfesional`.** Ahí viven los controles que importan: el
`email_verified`, el `assertTargetEnAlcance` que impide que esto le pise los
claims a una cuenta de la plataforma, y el mecanismo de pendientes. Duplicar esa
lógica para ahorrarse una llamada es la forma de que un día se separen.

Son dos llamadas y no una transacción, así que puede fallar la segunda: el
barbero queda creado y sin acceso, que es exactamente el estado de hoy, **pero
dicho en pantalla con el motivo y qué hacer**. Es la diferencia que importa.

**Lo que esto NO arregla:** los profesionales ya cargados sin acceso siguen sin
tenerlo. Hay que dárselo a mano desde Administradores, como rol *peluquero
(solo sus citas)*, con el mail exacto con el que inician sesión.

### El mostrador: rol "cajero" (14/10/2026)

*"Aparte de peluquero, agregar cajera o cajero. Que pueda ver los turnos,
agendar turnos, cobrar, etcétera. Sin ver las estadísticas totales que ve el
admin."*

Es un **rol propio**, con su claim, y **no un dueño recortado en la interfaz**.
La diferencia importa: lo que esconde el panel no es seguridad, y un "dueño con
el Dashboard oculto" seguiría pudiendo leer la facturación con la consola
abierta. Lo que un cajero puede y no puede vive en las Rules.

| | dueño | **mostrador** | peluquero |
|---|---|---|---|
| Ver la agenda del local | toda | **toda** | solo la suya |
| Agendar, confirmar, marcar quién vino, cobrar | sí | **sí** | solo en la suya |
| Turnos fijos | sí | **sí** | solo en la suya |
| La campanita de turnos nuevos | sí | **sí** | los suyos |
| Ingresos, histórico, Dashboard | sí | **no** | no |
| Facturación, plan, abono | sí | **no** | no |
| Servicios, profesionales, horarios, ausencias | sí | **no** | no |
| Configuración del local, Administradores | sí | **no** | no |

**Cómo está armado.** `esCajero(bizId)` en las Rules, y `manejaLaAgenda(bizId)`
= dueño o cajero, que es lo que se usa en `appointments` y `notifications`.
Todo lo demás pide `isBusinessOwner` o `canManage`, así que **le queda denegado
por defecto**: es la misma forma que los moderadores de la plataforma, "tiene lo
que se le dio" y no "tiene todo salvo lo que se le sacó".

`isBusinessStaff` sí lo incluye, y eso le da tres cosas que corresponden:
registrar su teléfono para los avisos, abrir tickets de soporte, y leer la
lista de accesos. No le da escritura sobre `staffContacts`: esa regla pide que
el `professionalId` del claim coincida con el de la ficha, y un cajero no tiene.

**No necesita ficha de profesional.** Un peluquero sí —las Rules le filtran los
turnos por ese id— y por eso `setBusinessAdmin` se la exige. El mostrador ve
todo, así que `professionalId` queda en null a propósito.

**Lo que no se movió:** el dueño puede nombrar peluqueros y cajeros de SU
barbería, y sigue sin poder nombrar dueños. Esa línea es comercial, no técnica.

**En el panel** tiene su propio menú: **Hoy · Citas · Soporte · Instalar la
app**. "Hoy" es la MISMA vista del Dashboard que ve el peluquero —la agenda del
día, sin una sola mención de plata— pero con todos los barberos en vez de uno:
`isOwner` sigue decidiendo si se ven los números, y `veTodo` (dueño o cajero)
qué turnos se muestran. "Servicio sin turno" no le aparece, porque agenda para
uno mismo; para eso tiene "Agendar turno", que deja elegir el barbero.

Primero se lo redirigía de `/admin` a `/admin/citas`, y era pasarse: lo dejaba
sin la pantalla que más mira un mostrador.

Ojo con la lista blanca: para el cajero se compara contra SU menú, no contra el
del peluquero. Si no, le quedaban abiertas "Mi Configuración" y "Mis reseñas",
que son de alguien que atiende, no del mostrador.

```bash
node scripts/auditar-rules-emulador.mjs   # 141 casos (15 nuevos de esto)
node scripts/test-claims-emulador.mjs     # 83 casos (6 nuevos)
```

Los 15 de Rules son mitad y mitad a propósito: cinco de lo que SÍ puede y diez
de lo que NO —facturación, el negocio, servicios, profesionales, horarios,
ausencias, nombrarse admin, borrar turnos, la agenda de la otra barbería y los
cobros de la plataforma—. Cada uno de esos diez es el motivo por el que el rol
existe en vez de dar acceso de dueño.

**Lo que NO hace, y hay que decidir si hace falta:** devolver señas
(`devolverSena`) y aplicar membresías siguen siendo del dueño. Las dos mueven
plata o benefician a un cliente puntual, y parecía la decisión correcta
mientras nadie la pida.

### Recompensas: ruleta, tarjeta de fidelidad y compañía (29/10/2026)

Siete campañas que cada barbería configura y prende por separado, desde
**Recompensas** en el panel (al lado de Cupones): 🎡 ruleta, 🎟️ tarjeta de
fidelidad, 🎁 caja sorpresa, 🎫 rasca y ganá, ⏰ happy hour, 🔥 racha y 🎂
cumpleaños. **Todas nacen apagadas**: activar una que nunca se configuró abre
el editor, y el servidor rechaza prender algo sin configuración válida.

**Un motor, siete juegos.** Los juegos solo deciden CUÁNDO se gana y QUÉ
definición de premio sale. El premio es siempre el mismo documento y lo maneja
un solo ciclo, el mismo que el cupón:

```
disponible ──reservar──▶ reservado ──"vino"/"no vino"──▶ usado
     ▲                        │
     └──────cancelar──────────┘        (vencido: pasó venceEn sin usarse)
```

**El premio NO se consume al reservar**: queda `reservado` atado al turno y lo
consume el trigger `onTurnoRecompensas` cuando el turno pasa a `completada` (o
`no_asistio`, igual que el cupón: el horario quedó bloqueado). Cancelar lo
devuelve, que era lo pedido: nadie pierde un premio por cancelar. Un turno
ATENDIDO que después "se cancela" no lo devuelve (sería usarlo dos veces), como
la membresía.

**Dónde vive cada pieza:**

| | |
|---|---|
| `functions/recompensasMotor.js` | el motor, puro: validación, sorteo, descuentos, tarjeta, racha, cumpleaños |
| `src/utils/recompensas.js` | **generado** del anterior (`node scripts/espejar-recompensas.mjs`); no se edita a mano |
| `functions/recompensas.js` | callables, el trigger, y lo que usa `createAppointment` |
| `pages/admin/RecompensasPage.jsx` | grilla de campañas + editor por tipo, con la validación en vivo del MISMO motor |
| `pages/client/PremiosPage.jsx` | "Tus premios" en `/:slug/premios` |
| `components/recompensas/` | rueda, juegos (pantalla completa), tarjeta, premios, confetti |

**Modelo** (todo por BARBERÍA, como los cupones: en una cuenta con sucursales
cada local tiene sus campañas, sus servicios y sus clientes; un premio de una
sucursal en otra "no existe"):

```
businesses/{id}.recompensas               espejo PÚBLICO de lo activo, sin probabilidades
                                          (lo lee la reserva antes de la sesión y
                                          createAppointment para el happy hour). Solo
                                          lo escribe guardarCampana; protegido en Rules
                                          y en CAMPOS_SOLO_PLATAFORMA
businesses/{id}/recompensas/{tipo}        🔒 la campaña completa; lee el dueño
businesses/{id}/premios/{id}              🔒 dueño + el cliente los suyos
businesses/{id}/recompensasClientes/{uid} 🔒 tarjeta, racha, tiradas, rascas, cumpleaños
businesses/{id}/recompensasSellos/{aptId} 🔒 un sello por turno atendido
```

Rules en `false` para todo eso: lo escribe solo el servidor. Ids que hacen
imposible el doble conteo sin chequear nada: el sello ES el id del turno, y cada
premio lleva el id de lo que lo originó (`fid_{uid}_{ciclo}`, `rasca_{turno}`,
`ruleta_{uid}_{fecha}`, `racha_{uid}_{inicio}_{nivel}`, `cumple_{uid}_{año}`).

**Callables:** `guardarCampana` (dueño/plataforma; sin `config` solo prende o
apaga), `reiniciarTarjeta`, `misRecompensas` (una llamada al abrir "Tus
premios"; de paso escribe los vencidos y genera el regalo de cumpleaños — sin
proceso nocturno), `guardarCumpleanos` (UNA vez), `jugarRecompensa` (el
SERVIDOR sortea con `crypto`; el browser anima hacia el índice que le
devuelven).

**En la reserva:** `createAppointment` recibe `premioId` (está en la lista
blanca de `functions.js`) y lo valida ADENTRO de la transacción: suyo, de esta
barbería, disponible, el turno antes de `venceEn`, vale para el servicio. Si no
sirve, rompe con el motivo (como la membresía: el cliente eligió no pagar).
**Un beneficio por turno**: premio + cupón o premio + membresía se rechaza, y
`aplicarMembresia` del dueño también rechaza un turno con premio. El **happy
hour** es automático y corre solo si no hay ningún otro. El turno guarda
`premio` / `happyHour` + `precioLista` + `descuento`; las Rules no dejan
crearlos desde el browser ni tocarle precio o servicio a un turno con premio
(`noTocaLaMembresia` ahora cubre los tres).

**Casos límite, decididos:**

- *Campaña desactivada:* no se juega ni se gana más; lo ganado vale hasta su
  vencimiento y la tarjeta conserva los sellos (si se prende, sigue).
- *Cambian las probabilidades:* solo para las tiradas siguientes; el premio es
  una copia de la definición del momento en que se ganó.
- *Cambia la cantidad de casillas:* la tarjeta en curso conserva las suyas; la
  siguiente toma las nuevas.
- *Reinicio manual:* la tarjeta llena queda llena y los turnos de en el medio
  NO suman, hasta que el dueño la reinicia (lista en la tarjeta de la campaña).
- *Reprogramar:* es el mismo turno, el premio lo sigue.
- *Turno eliminado:* no pasa; los turnos no se borran (Rules), se cancelan.
- *"Vino" deshecho:* el sello se saca si es de la tarjeta en curso y no la
  completó; un premio ya entregado no se retira por un clic. La racha no vuelve.
- *Solo suman los turnos del cliente con SU cuenta* (`origen: 'cliente'`): los
  que carga el staff llevan el uid del que los cargó.
- *Ruleta:* aparece al llegar a confirmar (paso 6), nunca después del pago, una
  vez cada `frecuenciaDias`. Porciones iguales: no muestra las chances.
- *Rasca:* una por turno atendido, hasta 5 sin raspar.

**Accesibilidad y movimiento:** los juegos son `role="dialog"` con foco
atrapado, Escape (salvo girando) y el foco devuelto; el resultado toma el foco;
cada casilla dice si está sellada (✓ además del color); `prefers-reduced-motion`
saltea todas las animaciones (JS y CSS) y muestra el resultado directo.

**Trampa del compilador de React** (encontrada acá): pasarle a una función
importada un valor que sale de un documento (`finalPrice`) hace que el
compilador suponga que se puede mutar y deje de memoizar todo lo que depende del
servicio — `react-hooks/preserve-manual-memoization` en un `useMemo` que nadie
tocó. Se arregla con `Number(...)` antes de pasarlo.

```bash
node scripts/test-recompensas.mjs             # 117 casos, sin emulador (y que las dos copias sean iguales)
node scripts/test-recompensas-emulador.mjs    # 105 casos
node scripts/sembrar-recompensas-emulador.mjs # escenario con las 7 prendidas para el browser
```

Orden de despliegue: **Rules y Functions primero, front después** (un front
nuevo contra un servidor viejo mandaría `premioId` y el servidor lo ignoraría:
el cliente vería el descuento y se le cobraría el precio de lista).

## Trampas ya pagadas (no volver a descubrirlas)

### `createAppointment` del cliente es una LISTA BLANCA (22/10/2026)

`src/lib/functions.js` no reenvía `request.data` tal cual: nombra los campos uno
por uno. **Lo que no esté nombrado ahí no llega al servidor, y no avisa** — el
servidor recibe un objeto sin esa clave, que es indistinguible de una reserva
que no la usa.

Encontrado de casualidad al conectar los productos. Dos features estaban
cortadas ahí:

- **`acompanante`** ("Vengo con alguien", 15/10). La pantalla preguntaba el
  servicio de la otra persona, el servidor sabía sumar duración y precio, hay 12
  casos en la suite que lo prueban —**porque la suite llama a la function
  directo y no pasa por este archivo**— y el campo moría en el wrapper. En
  producción, el padre que reservaba para él y el hijo sacaba UN turno de un
  servicio: el barbero se encontraba con dos cabezas y la mitad del tiempo.
- **`pagar`** (seña / pago total). Sin él, `pedido` cae en su valor por defecto
  (`'sena'`), así que "pago en el local" y "pago todo ahora" no existían: con
  Mercado Pago conectado, al cliente se le pedía seña siempre.

Las dos arregladas. Y el archivo lleva ahora un aviso arriba de la función,
porque la próxima vez que alguien agregue un campo va a pasar lo mismo. **Una
suite que llama a la function directo no prueba el camino del navegador.**


### La plataforma podía LEER las notificaciones de una barbería pero no marcarlas (22/09/2026)

El `allow update` de `businesses/{id}/notifications` listaba dueño y barbero,
no a `esEquipoPlataforma()`. Entrando al panel de una barbería como plataforma,
"marcar todas leídas" fallaba con permission-denied y volvían a aparecer sin
leer. El `catch` vacío de la campana se comía el error, así que parecía magia.
Ahora la plataforma también puede (solo `leidaPor`), el marcado va en un batch
y los errores se muestran.


### Un turno entra si EMPIEZA dentro del horario (22/09/2026)

Antes se exigía que el turno entrara entero: `cursor + duration <= cierre`. Con
grilla de 60' y servicios de 60', el barbero que atiende hasta las 17:30 perdía
el turno de las 17:00 — y con él, toda promo de media tarde: la de Volcado
(16:30–19:30) le daba CERO horarios a un barbero y sí al otro, que cerraba más
tarde. Ahora alcanza con que empiece dentro (del horario del barbero, del local
y de la franja de la promo); el descanso del mediodía sigue siendo excluyente,
porque ahí no se atiende. Está en `availabilityEngine`, `ventanaServicio` y
`createAppointment`, y hay casos en la suite de reservas.


### El barbero sin perfil vinculado veía la agenda VACÍA (22/09/2026)

El permiso del barbero sale del claim `professionalId` y las Rules le filtran
los turnos por ese id. Con el claim vacío, o apuntando a un perfil borrado:

- sin claim  → la consulta la rechazan las Rules;
- claim viejo → la consulta ANDA y devuelve **cero turnos**, sin un solo error.

Encima `BusinessSync` trataba a ese admin como cliente (`rol === 'admin' &&
Boolean(profId)`), así que ni lo intentaba: pedía "mis turnos" por uid y el
panel quedaba vacío y mudo. En producción los clientes reservaron, se
presentaron, y la barbería no se enteró.

Ahora: un `admin` es staff aunque el vínculo esté roto, `useVinculoBarbero`
detecta los dos casos, el panel muestra un aviso rojo permanente, la lista de
Administradores marca la cuenta rota y `setBusinessAdmin` rechaza dar de alta
un barbero sin un perfil que exista. Nunca más una agenda vacía sin explicación.


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
- **En la página pública (`/:slug`) manda el slug, para todos.**
  `useResolvedBusiness` resolvía primero el negocio "administrado" del dueño
  de plataforma (`currentBusinessId`) y el negocio propio del staff, y recién
  después el slug: abrir `barberos.sacia.tech/volcadoclub` con otra barbería
  activa en el panel mostraba la otra barbería. En incógnito andaba, por eso
  parecía "caché". Ahora si hay slug en la URL, es ese negocio, sea quien sea.
- **"No encontramos este negocio" solo cuando se SABE.** `TenantRoute`
  mostraba el error mientras el slug todavía se resolvía: cada apertura del
  link arrancaba con un cartel de error que desaparecía un segundo después.
  `BusinessSync` deja `slugEstado` (resolviendo / ok / no-existe) y
  `negociosCargados` para la plataforma; hasta entonces, "Cargando…".
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
4. ~~Precio de los planes~~ Definidos el 06/10/2026: 15.000 / 20.000 / 30.000 /
   60.000 y el Personalizado a convenir. El alta sola crea cuentas en Básico, que
   es lo que hace que la prueba corte a los 5 días.
   **Lo que falta a mano:** `/super-admin` → Barberías → Mantenimiento, para
   completarles `capacidades` a las cuentas que ya estaban. Hasta entonces esas
   cuentas conservan todo habilitado.
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
13. ~~Subir logo por barbería~~ Hecho: data URL en el documento del negocio,
    con `redimensionarLogo`. Capacidad `logo`, del Plan Full.
14. ~~PWA~~ Hecha, con push. Falta: TWA para Play Store si algún cliente lo
    pide (misma web envuelta con Bubblewrap).

---

## Cómo probar sin tocar producción

```bash
firebase emulators:start --only auth,firestore,functions
node scripts/test-claims-emulador.mjs      # permisos y cuentas con contraseña
node scripts/test-reservas-emulador.mjs    # validación de turnos (incluye productos)
node scripts/test-billing-emulador.mjs     # cobro, suspensión, prueba gratis y regalo
node scripts/test-alta-emulador.mjs        # alta sola con 5 días de prueba
node scripts/test-mercadopago-emulador.mjs # conexión de la cuenta y sus tokens
node scripts/test-sena-emulador.mjs        # seña: horario guardado y vencimiento
node scripts/test-sucursales-emulador.mjs  # cuentas con sucursales: aislamiento y topes
node scripts/test-planes-emulador.mjs      # topes y funciones de cada plan
node scripts/test-resenas-emulador.mjs     # reseñas: cuándo, quién y una por turno
node scripts/test-membresias-emulador.mjs  # membresías: uso, fraude, webhooks (MP falso)
node scripts/test-turnos-fijos-emulador.mjs # turnos fijos: serie, salteos, baja
node scripts/test-recompensas-emulador.mjs  # recompensas: permisos, sorteo, premio en la reserva, tarjeta
node scripts/test-recompensas.mjs           # el motor de recompensas (sin emulador)
node scripts/auditar-rules-emulador.mjs    # aislamiento entre barberías
node scripts/test-whatsapp.mjs             # links de wa.me (no necesita emulador)
node scripts/test-preview.mjs              # vista previa del link (tampoco)
node scripts/test-intervalo.mjs            # la grilla y el consejo (tampoco)
node scripts/test-ausencias.mjs            # el día suelto distinto: no voy / hago otro horario
node scripts/test-orden.mjs                # en qué orden ve el cliente la lista (tampoco)
node scripts/test-productos.mjs            # la mercadería: stock, precio y qué se ofrece
node scripts/test-estado-negocio.mjs       # qué pantalla ve el que abre el link
```

Hoy: claims 83, reservas 140, facturación 20, rules 155, alta 22, mercadopago 16,
seña 18, sucursales 68, planes 71, reseñas 36, membresías 123, cupones 74 + 71,
turnos fijos 28, whatsapp 32, preview 24, intervalo 96, ausencias 97, orden 30.
productos 54.
estado del negocio 19.
Todo en verde (1175).

Las suites se pueden correr DOS VECES seguidas sin reiniciar el emulador. Si una
falla recién en la segunda, es que deja datos: `test-planes` creaba sucursales
con id automático que el `recursiveDelete` del principal no se llevaba, y la
segunda corrida encontraba tres locales donde el caso espera dos.

Para mirar las páginas de presentación en el browser:

```bash
node scripts/sembrar-pagina-emulador.mjs
```

---

## Qué NO hacer

- ❌ NO construir checkout de suscripción (el alta de prueba sí existe: ver
  `crearBarberiaDePrueba`; el cobro sigue siendo a mano)
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
| `CLAUDE.md` (este) | ✅ al día — QUÉ es el sistema y por qué |
| `otra-ia.md` | ✅ al día — CÓMO se trabaja acá. Para una IA que recién abre el proyecto |
| `FIREBASE_SETUP.md` | ✅ guía de migración, sirve de referencia |
| `ROADMAPdesde2352026.md` | ⚠️ actualizado, pero el histórico de sprints tiene ruido |
| `PROJECT_CONTEXT.md` | ❌ **desactualizado**, describe el diseño original de un solo negocio |

Ante cualquier duda, **el código manda sobre los documentos**.
