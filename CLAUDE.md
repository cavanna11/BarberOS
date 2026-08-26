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
firebase use --add
```

En `firebase use --add` elegir `barberos-1d60e` con alias `default`.
`firebase login` abre el navegador y necesita interacción humana: **no lo puede
correr un agente**.

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

## ⛔ BLOQUEANTE: plan Blaze

**Es lo único que impide vender.** Sin Cloud Functions no se pueden asignar
custom claims, así que **el dueño de una barbería real no puede entrar a su
panel** — sin claim, Firestore lo trata como cliente. Tampoco puede abrir
tickets, ni corre la facturación automática, ni se envían recordatorios.

Santiago sí funciona porque su claim se puso a mano con
`scripts/bootstrap-platform-owner.mjs`.

Verificar si ya está resuelto:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://southamerica-east1-barberos-1d60e.cloudfunctions.net/setBusinessAdmin
```

`404` = sigue bloqueado. `400`/`401` = ya está desplegada.

Para resolverlo: activar Blaze → `cd functions && npm install` →
`firebase deploy --only functions` → conectar `setBusinessAdmin` desde
`NewBusinessModal` y `AdminsPage`, y llamar `applyPendingClaims` después del
login en `AuthContext`.

Costo esperado: cercano a $0. La capa gratuita de Blaze es la misma que Spark.

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
- **Los reemplazos por script fallan con CRLF.** Varios archivos tienen finales
  de línea Windows; usar la herramienta Edit o verificar siempre el resultado.

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

1. **Activar Blaze y desplegar Cloud Functions** ← desbloquea la venta
2. **Trámite de Meta para WhatsApp** — tarda 1-2 semanas, arrancar en paralelo
3. Verificar que `barberos.sacia.tech` esté en Firebase → Authentication →
   Settings → Dominios autorizados
4. Code-splitting: separar landing de la app — quien reserva un turno no
   necesita descargar el panel de administración
5. Revisar `src/components/landing/HeroMotionMockup.jsx` y
   `FloatingActionWidget.jsx` (generados por Antigravity, sin auditar)
6. Monitoreo global de turnos: hoy la pestaña del panel global solo muestra el
   negocio activo. Necesita `collectionGroup` + regla nueva.
7. Validar el precio del turno en las Rules — hoy se puede crear con `price: 0`.
   Irrelevante mientras se cobre en el local, **crítico con señas de Mercado Pago**
8. Subir logo por barbería (Firebase Storage)
9. PWA

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
