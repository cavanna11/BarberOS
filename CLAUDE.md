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

14 casos: cobro, acumulación de varios vencimientos, suspensión, reactivación al
saldar, prueba vigente, prueba vencida y cuenta de regalo.

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
    ├── availabilityEngine.js   ⚠️ NO TOCAR — anda (única excepción hecha:
    │                              el corte del local, `corteLocal`, 21/09/2026)
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
node scripts/test-planes-emulador.mjs   # 66 casos
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

**Tres plantillas, UNA estructura.** `Simple`, `Tarjeta` y `Foto` (esta última
del Full) comparten el mismo JSX y se diferencian por una clase. Agregar una
cuarta es escribir CSS, no una pantalla nueva que después hay que acordarse de
arreglar cuando se le suma un botón.

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

## Trampas ya pagadas (no volver a descubrirlas)

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
node scripts/test-reservas-emulador.mjs    # validación de turnos
node scripts/test-billing-emulador.mjs     # cobro, suspensión, prueba gratis y regalo
node scripts/test-alta-emulador.mjs        # alta sola con 5 días de prueba
node scripts/test-mercadopago-emulador.mjs # conexión de la cuenta y sus tokens
node scripts/test-sena-emulador.mjs        # seña: horario guardado y vencimiento
node scripts/test-sucursales-emulador.mjs  # cuentas con sucursales: aislamiento y topes
node scripts/test-planes-emulador.mjs      # topes y funciones de cada plan
node scripts/test-resenas-emulador.mjs     # reseñas: cuándo, quién y una por turno
node scripts/auditar-rules-emulador.mjs    # aislamiento entre barberías
node scripts/test-whatsapp.mjs             # links de wa.me (no necesita emulador)
node scripts/test-preview.mjs              # vista previa del link (tampoco)
```

Hoy: claims 77, reservas 46, facturación 14, rules 118, alta 22, mercadopago 16,
seña 14, sucursales 68, planes 66, reseñas 36, whatsapp 23, preview 24. Todo en
verde (524).

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
| `CLAUDE.md` (este) | ✅ al día |
| `FIREBASE_SETUP.md` | ✅ guía de migración, sirve de referencia |
| `ROADMAPdesde2352026.md` | ⚠️ actualizado, pero el histórico de sprints tiene ruido |
| `PROJECT_CONTEXT.md` | ❌ **desactualizado**, describe el diseño original de un solo negocio |

Ante cualquier duda, **el código manda sobre los documentos**.
