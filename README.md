# BarberOS

Sistema de turnos multi-tenant para barberías y salones. Cada negocio tiene su
propio link público donde los clientes reservan, su panel de administración, y
se gestiona desde un panel global de plataforma.

Desarrollado por [SACIA](https://sacia.tech).

---

## Modelo

**El onboarding es manual, no self-service.** El cliente se contacta, se cierra
la venta, y la cuenta se prepara desde `/super-admin` → "Nueva barbería": eso
crea el negocio, su link público y el acceso del dueño en un solo paso.

No hay registro público ni checkout de suscripción, y es a propósito.

Tres niveles de acceso:

| Rol | Alcance |
|---|---|
| **Dueño de plataforma** | Panel global: alta de cuentas, cobros, suspensiones, WhatsApp |
| **Dueño de barbería** | Su negocio: staff, servicios, agenda, horarios, sus admins |
| **Peluquero** | Solo sus propios turnos |
| **Cliente** | Reserva por el link público del negocio |

---

## Stack

React 19 · Vite · React Router 7 · CSS puro con variables

La persistencia hoy es `localStorage`. La migración a Firebase está escrita y
documentada en [`FIREBASE_SETUP.md`](FIREBASE_SETUP.md), pendiente de conectar.

---

## Correr en local

```bash
npm install
cp .env.example .env.local   # completar VITE_GOOGLE_CLIENT_ID
npm run dev
```

En desarrollo el login muestra un acceso rápido que evita Google. Ese bloque
está detrás de `import.meta.env.DEV` y no existe en el build de producción.

```bash
npm run build    # producción
npm run lint
```

---

## Cómo está organizado

```
src/
├── config/
│   ├── platform.js       Dueños de la plataforma (fuente de verdad del acceso global)
│   ├── plans.js          Planes comerciales: cuotas y precios
│   ├── seedData.js       Estado inicial — vacío, las cuentas se crean a mano
│   └── theme.js          Tema white-label por negocio
├── hooks/
│   ├── useCurrentBusiness.js   Resuelve qué negocio corresponde al usuario/URL
│   └── useTenantData.js        Capa de datos filtrada por tenant
├── pages/
│   ├── client/           Reserva pública en /:businessSlug
│   ├── admin/            Panel del negocio
│   └── super-admin/      Panel global de plataforma
└── utils/
    ├── availabilityEngine.js   Cálculo de horarios disponibles
    └── statsCalculator.js      Métricas del dashboard
```

**Regla importante:** ningún componente lee los datos crudos del contexto. Todo
pasa por los hooks de `useTenantData.js`, que filtran por negocio. Cuando entre
Firebase, la migración se hace adentro de esos hooks sin tocar los componentes.

**No romper:** `availabilityEngine.js` y `statsCalculator.js` reciben arrays por
argumento y no saben de dónde salen. Mantenerlos así.

---

## Seguridad

El filtro de los hooks es **para la UI, no es seguridad**. Con los datos en
`localStorage` no hay barrera real; cuando estén en Firestore, lo que aísla los
negocios entre sí son las Security Rules ([`firestore.rules`](firestore.rules))
más los custom claims, no el frontend.

Ver la sección correspondiente en [`FIREBASE_SETUP.md`](FIREBASE_SETUP.md).

---

## Documentación

| Archivo | Contenido |
|---|---|
| [`FIREBASE_SETUP.md`](FIREBASE_SETUP.md) | Migración a Firebase paso a paso, Rules, permisos, deploy |
| [`ROADMAPdesde2352026.md`](ROADMAPdesde2352026.md) | Estado real, decisiones tomadas y qué evitar |
| [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) | Diseño original (parcialmente desactualizado; tiene tabla de diferencias) |
