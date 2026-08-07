# Conectar SaciaTurno a Firebase

Guía para pasar de `localStorage` a una base real, multi-tenant y vendible.

**Estado de partida:** la app funciona completa con `localStorage`. La capa de
acceso a datos ya está aislada en `src/hooks/useTenantData.js`, así que la
migración se hace ahí adentro sin tocar los componentes.

**Advertencia honesta:** los archivos de este repo (`firestore.rules`,
`src/lib/firebase.js`, `functions/index.js`, `scripts/bootstrap-platform-owner.mjs`)
están escritos pero **no probados contra un proyecto real**, porque hace falta tu
cuenta para crearlo. El Paso 8 es justamente cómo verificarlos con los
emuladores antes de que toquen datos de clientes. No saltees ese paso.

---

## Lo que hay que entender antes de empezar

Hoy el aislamiento entre barberías lo hace el frontend: los hooks filtran por
`businessId`. **Eso alcanza para la UI y no alcanza para producción.** Cuando los
datos estén en Firestore, cualquiera puede abrir la consola del navegador y
pedirle datos directamente, salteándose por completo tus hooks.

Lo que realmente aísla los datos son dos cosas:

1. **Security Rules** (`firestore.rules`) — se ejecutan en el servidor de Google
   y no se pueden evitar.
2. **Custom claims** — el permiso viaja firmado dentro del token de sesión, y
   solo se puede escribir desde el servidor.

Por eso `PLATFORM_OWNERS` en `src/config/platform.js` **deja de ser la fuente de
verdad** y pasa a ser solo una comodidad para la UI. Un atacante puede editar
ese array en el bundle; no puede falsificar un claim.

```
Hoy                              Con Firebase
────────────────────────────     ─────────────────────────────────────
platform.js (array en código) →  claim { platform: true } en el token
authorizedAdmins (localStorage)→ claim { businessId, role } en el token
filtro en los hooks          →   Security Rules (+ filtro en los hooks, para la UI)
```

---

## Paso 1 — Crear el proyecto

1. [console.firebase.google.com](https://console.firebase.google.com) → **Crear un proyecto**
2. Nombre: `saciaturno`. Desactivá Google Analytics (no lo necesitás y agrega ruido).
3. Una vez creado: **⚙️ Configuración del proyecto → Tus apps → ícono web `</>`**
4. Registrá la app como `saciaturno-web`. **No** marques Firebase Hosting todavía.
5. Copiá el objeto `firebaseConfig` que te muestra.

Pegá esos valores en `.env.local` (copiá `.env.example` como base):

```bash
cp .env.example .env.local
```

> Esas claves son **públicas**: viajan en el bundle y se pueden leer. No son un
> secreto y no protegen nada — lo que protege son las Rules. No pierdas tiempo
> intentando esconderlas.

### Plan de facturación

Pasá el proyecto a **Blaze** (pago por uso): las Cloud Functions lo requieren.

Poné un **presupuesto con alerta** en Google Cloud Console → Facturación →
Presupuestos y alertas. Con 20 barberías el uso entra de sobra en la capa
gratuita (~$0/mes); la alerta es para que un bug en un loop no te sorprenda.

---

## Paso 2 — Autenticación con Google

1. **Authentication → Comenzar → Google → Habilitar**
2. Poné un correo de soporte y guardá.
3. **Authentication → Settings → Dominios autorizados**: agregá tu dominio de
   producción (`turnos.tudominio.com`). `localhost` ya viene.

La app hoy usa `@react-oauth/google` (login solo en el cliente). Con Firebase
esto se reemplaza por `signInWithPopup`, que además crea la sesión del servidor
que las Rules necesitan:

```js
// En AuthContext.jsx — reemplaza a loginWithGoogle
import { signInWithPopup, getIdTokenResult } from 'firebase/auth';
import { auth, googleProvider } from '../lib/firebase';

const loginWithGoogle = async () => {
  const { user } = await signInWithPopup(auth, googleProvider);

  // Los permisos salen del TOKEN, no de una lista en el código.
  const { claims } = await getIdTokenResult(user);

  return {
    id: user.uid,
    email: user.email,
    name: user.displayName,
    avatarUrl: user.photoURL,
    role: claims.platform ? 'owner' : (claims.role || 'client'),
    businessId: claims.businessId || null,
    professionalId: claims.professionalId || null,
    isPlatformOwner: claims.platform === true,
  };
};
```

Una vez hecho esto, se puede borrar `@react-oauth/google`, `jwt-decode` y
`loginBypass` (ya está limitado a desarrollo).

> **Detalle que cuesta horas si no lo sabés:** cuando le asignás claims a alguien,
> su token actual **sigue teniendo los viejos hasta una hora después**. Para que
> tomen efecto ya: `await user.getIdToken(true)`.

---

## Paso 3 — Firestore y el modelo de datos

**Firestore Database → Crear base de datos → Modo producción → `southamerica-east1`**

La región no se puede cambiar después. `southamerica-east1` (São Paulo) es la de
menor latencia para Argentina.

### Estructura

Subcolecciones en vez de colecciones planas con `businessId`: las Rules quedan
más simples y no se puede pedir "todos los turnos" por accidente.

```
/slugs/{slug}                       → { businessId }   ⚠️ lectura pública
/businesses/{businessId}            → nombre, colores, horarios, isFrozen  ⚠️ lectura pública
  /private/billing                  → deuda, abono, vencimientos  🔒 solo vos
  /professionals/{id}               ⚠️ lectura pública
  /services/{id}                    ⚠️ lectura pública
  /schedules/{id}                   ⚠️ lectura pública
  /professionalServices/{id}        ⚠️ lectura pública
  /appointments/{id}                🔒 staff del negocio + el cliente dueño del turno
  /admins/{email}                   🔒 registro para la UI (el permiso son los claims)
  /notifications/{id}               🔒 solo lectura del staff; lo escribe el backend
/users/{uid}                        🔒 cada uno el suyo
/pendingAdmins/{email}              🔒 permisos de quien todavía no entró nunca
/platform/config                    🔒 solo vos
```

**Dos decisiones que importan:**

**La facturación va aparte.** El documento del negocio tiene que ser de lectura
pública (la página de reservas necesita nombre, colores y horarios *antes* del
login). Si metés `debt` y `monthlyFee` ahí, cualquier cliente puede leer cuánto
te debe la barbería. Por eso van en `/businesses/{id}/private/billing`.

**`/slugs/{slug}` existe para no exponer la lista de negocios.** Resolver
`/barberia-x` sin este mapa obligaría a permitir listar toda la colección
`businesses`, y ahí cualquiera se baja tu cartera de clientes. Con el mapa, se
lee un solo documento por su id.

Cuando crees un negocio, escribí las dos cosas en un batch:

```js
const batch = writeBatch(db);
batch.set(doc(db, 'businesses', businessId), businessData);
batch.set(doc(db, 'slugs', slug), { businessId });
await batch.commit();
```

---

## Paso 4 — Instalar y conectar

```bash
npm install firebase
npm install -g firebase-tools
firebase login
firebase init
```

En `firebase init` elegí: **Firestore**, **Functions**, **Hosting**, **Emulators**.
Cuando pregunte por el directorio público poné `dist`, y **sí** a "single-page app".

`src/lib/firebase.js` ya está en el repo y lee todo de `.env.local`.

---

## Paso 5 — Security Rules

`firestore.rules` ya está escrito y comentado. Desplegalo:

```bash
firebase deploy --only firestore:rules
```

Leelo entero antes. Es el archivo más importante del proyecto: **si está mal, el
aislamiento entre barberías no existe.** Lo que hace:

- Lectura pública de lo que la página de reservas necesita, y nada más.
- Escritura de datos de un negocio solo para su dueño o para vos.
- El dueño **no puede** editar su propia facturación ni descongelarse solo
  (mirá la lista `affectedKeys().hasAny([...])` en `match /businesses/{bizId}`).
- Un cliente solo lee sus propios turnos, y solo puede cambiarles el estado a
  `cancelada` — no la fecha, ni el precio, ni el profesional.
- Los turnos no se borran nunca: se cancelan.

### Un agujero que queda abierto a propósito

La regla de `create` en `appointments` **no valida el precio**. Como está, un
cliente con la consola abierta puede crear un turno con `price: 0`.

Se puede endurecer de dos maneras. La barata es agregar a la regla que el
precio coincida con el del servicio:

```
allow create: if signedIn()
  && request.resource.data.userId == request.auth.uid
  && request.resource.data.price == get(
       /databases/$(database)/documents/businesses/$(bizId)/services/$(request.resource.data.serviceId)
     ).data.price;
```

Eso cuesta una lectura extra por reserva y no cubre los precios personalizados
por profesional (`professionalServices`). La sólida es mover la creación del
turno a una Cloud Function que calcule el precio del lado del servidor. Para
empezar a vender, el riesgo es bajo (el barbero cobra en el local y ve el precio
en su panel), pero **anotalo**: cuando cobres señas con Mercado Pago pasa a ser
crítico.

---

## Paso 6 — Permisos: darte de alta a vos

Este es el punto donde más gente se traba, porque hay un huevo y la gallina: la
función que asigna permisos exige tener permiso.

```bash
cd functions && npm install && cd ..
firebase deploy --only functions
```

Después:

1. **Entrá una vez a la app con Google** con tu cuenta. Esto crea tu usuario en
   Firebase Auth (sin eso el script no te encuentra).

2. Bajá la service account: **⚙️ Configuración del proyecto → Cuentas de servicio
   → Generar nueva clave privada**. Guardala como `serviceAccountKey.json` en la
   raíz.

   > Ese archivo es acceso **total** al proyecto, sin restricciones ni Rules.
   > Ya está en `.gitignore`. Borralo en cuanto termines.

3. Corré:

```bash
node scripts/bootstrap-platform-owner.mjs cavannaprogramacion@gmail.com
```

4. Cerrá sesión en la app y volvé a entrar.

5. **Borrá `serviceAccountKey.json`.**

Desde acá, dar de alta al dueño de una barbería ya sale del panel, llamando a la
función:

```js
import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';

const setBusinessAdmin = httpsCallable(functions, 'setBusinessAdmin');

await setBusinessAdmin({
  email: 'donjose@gmail.com',
  businessId,
  role: 'owner',
  name: 'José Pérez',
});
```

Si el dueño nunca entró a la app, la función deja el permiso en
`/pendingAdmins/{email}` y se aplica solo en su primer login. Para que eso
funcione, llamá a `applyPendingClaims` una vez después de cada login:

```js
// En AuthContext, después de signInWithPopup
const applyPending = httpsCallable(functions, 'applyPendingClaims');
const { data } = await applyPending();
if (data.status === 'applied') {
  await user.getIdToken(true); // refrescar para que el claim entre en el token
}
```

---

## Paso 7 — Migrar los hooks

Acá se paga el trabajo de la capa de tenancy: **los componentes no se tocan.**
Solo cambia el cuerpo de los hooks de `src/hooks/useTenantData.js`.

Antes:

```js
export function useProfessionals() {
  const { state } = useBusiness();
  const { businessId } = useResolvedBusiness();
  return useMemo(() => {
    if (!businessId) return [];
    return (state.professionals || []).filter((p) => p.businessId === businessId);
  }, [state.professionals, businessId]);
}
```

Después:

```js
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';

export function useProfessionals() {
  const { businessId } = useResolvedBusiness();
  const [rows, setRows] = useState([]);

  useEffect(() => {
    if (!businessId) { setRows([]); return; }
    // onSnapshot y no getDocs: el barbero ve entrar los turnos en vivo, sin
    // recargar. Es la razón principal para elegir Firestore acá.
    return onSnapshot(
      collection(db, 'businesses', businessId, 'professionals'),
      (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error('[useProfessionals]', err)
    );
  }, [businessId]);

  return rows;
}
```

Lo mismo para `useServices`, `useSchedules`, `useProfessionalServices` y
`useAppointments`. `useTenant()` sigue funcionando sin cambios porque compone
estos hooks.

**Orden que conviene seguir** — una colección por vez, verificando en el
navegador después de cada una:

1. `businesses` + `slugs` (hace andar `useCurrentBusiness`)
2. `professionals`, `services`, `schedules`, `professionalServices`
3. `appointments` (la que más importa que sea en vivo)
4. `admins` → pasa a llamar a las Cloud Functions
5. Facturación del panel global → `/private/billing`

`availabilityEngine.js` y `statsCalculator.js` **no se tocan**: reciben arrays
como argumentos y les da igual de dónde salgan. Eso fue a propósito.

---

## Paso 8 — Probar las Rules con emuladores (no lo saltees)

Nunca escribas Rules directo en producción. Los emuladores son una base
descartable local:

```bash
firebase emulators:start
```

Poné `VITE_USE_EMULATORS=true` en `.env.local` y `npm run dev`. La app trabaja
contra la base local; `src/lib/firebase.js` ya tiene el cableado.

La consola de los emuladores queda en http://127.0.0.1:4000.

**Las cuatro pruebas que tienen que pasar** antes de considerar esto seguro:

| Prueba | Resultado esperado |
|---|---|
| Logueado como dueño de la barbería A, leer `businesses/B/appointments` desde la consola | `permission-denied` |
| Logueado como dueño de A, escribir en `businesses/A/private/billing` | `permission-denied` |
| Logueado como dueño de A, poner `isFrozen: false` en su propio negocio | `permission-denied` |
| Sin login, leer `businesses/{id}` de una barbería activa | funciona (la página pública lo necesita) |

Probalas a mano en la consola del navegador, no confíes en la UI:

```js
// Con la sesión del dueño de A abierta, en la consola del browser:
const { getDocs, collection } = await import('firebase/firestore');
await getDocs(collection(window.__db, 'businesses', 'ID_DE_B', 'appointments'));
// Tiene que tirar FirebaseError: Missing or insufficient permissions.
```

(Para eso exponé `window.__db = db` temporalmente en `src/lib/firebase.js`, y
sacalo después.)

---

## Paso 9 — Deploy

```bash
npm run build
firebase deploy
```

Dominio propio: **Hosting → Agregar dominio personalizado**. Firebase emite el
certificado SSL solo. Acordate de agregar el dominio en
**Authentication → Settings → Dominios autorizados**, o el login falla en
producción con un error poco claro.

---

## Checklist antes del primer cliente que paga

**Seguridad**

- [ ] `firestore.rules` desplegado y las 4 pruebas del Paso 8 pasando
- [ ] `serviceAccountKey.json` borrado de tu máquina
- [ ] `.env` ya no está trackeado en git (hecho) y `.env.local` tampoco
- [ ] El bypass de login no está en el bundle: `grep "ACCESO RÁPIDO" dist/assets/*.js` → sin resultados
- [ ] Ningún token de WhatsApp ni de Mercado Pago en el código ni en variables `VITE_*`
- [ ] Tu cuenta es el único `platform: true`

**Funcionamiento**

- [ ] Dar de alta una barbería de prueba y recorrer todo el flujo con dos cuentas de Google distintas
- [ ] Verificar que el dueño de la barbería A no ve nada de la B
- [ ] Reservar desde un celular real (no solo el responsive del navegador)
- [ ] Suspender una cuenta y confirmar que el link público deja de tomar turnos
- [ ] Presupuesto con alerta configurado en Google Cloud

**Operación**

- [ ] Saber cuánto tarda un alta completa (medilo con la de prueba: es tu costo por venta)
- [ ] Definir qué pasa si un cliente se va: exportar sus datos y borrar la cuenta
- [ ] Backup: Firestore → PITR (recuperación a un punto en el tiempo), o un export programado a Cloud Storage

---

## Lo que queda pendiente después de Firebase

En orden de lo que más mueve la aguja para vender:

1. **Recordatorios de WhatsApp.** Es *el* argumento de venta: menos ausencias. El
   trámite con Meta tarda 1-2 semanas — empezalo en paralelo, no al final. El
   esqueleto está comentado en `functions/index.js`.
2. **Logo por barbería** (Firebase Storage). Hoy `logoUrl` existe en el modelo
   pero no hay forma de subirlo.
3. **PWA.** Que el barbero tenga el ícono en la pantalla de inicio del celular.
4. **Señas con Mercado Pago.** Recién acá el agujero del precio del Paso 5 pasa a
   ser urgente.
5. **Exportar datos de un cliente** (obligación práctica y argumento de confianza).

---

## Costos reales

Con 20 barberías y ~30 turnos por día cada una:

| Servicio | Uso mensual estimado | Capa gratuita | Costo |
|---|---|---|---|
| Firestore lecturas | ~500k | 50k/día (1.5M/mes) | $0 |
| Firestore escrituras | ~40k | 20k/día (600k/mes) | $0 |
| Auth | ~2k usuarios | ilimitado con Google | $0 |
| Hosting | <1 GB | 10 GB/mes | $0 |
| Functions | ~5k invocaciones | 2M/mes | $0 |
| **Firebase total** | | | **~$0** |
| WhatsApp Cloud API | ~1200 mensajes | 1000 conversaciones/mes | ~USD 3-8 |

El costo real de la operación es WhatsApp, no Firebase. Los planes en
`src/config/plans.js` ya cobran por cuota de mensajes con margen —
`OVERAGE_COST_USD = 0.06` contra un costo real de ~USD 0.04.

**El que se puede escapar:** `onSnapshot` cobra una lectura por documento cada
vez que algo cambia. Si dejás un listener sobre todos los turnos de un negocio y
alguien tiene el panel abierto todo el día, se suman. Cuando migres
`useAppointments`, filtrá por rango de fechas en la query en vez de traer el
historial completo:

```js
query(
  collection(db, 'businesses', businessId, 'appointments'),
  where('appointmentDate', '>=', hace30dias)
)
```
