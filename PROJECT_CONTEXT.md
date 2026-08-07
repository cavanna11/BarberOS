# Contexto del Proyecto: SaciaTurno

Este documento describe la arquitectura, flujo de datos, estructura de archivos y reglas de negocio del sistema de reservas **SaciaTurno**. Está diseñado para que cualquier inteligencia artificial (o nuevo desarrollador) adquiera rápidamente todo el conocimiento necesario para comprender, extender o depurar la aplicación.

> ### ⚠️ Leer primero
>
> Este documento describe el diseño original y **quedó atrasado en varios puntos**.
> Los cambios estructurales posteriores están en
> [`ROADMAPdesde2352026.md`](ROADMAPdesde2352026.md), y la migración a Firebase en
> [`FIREBASE_SETUP.md`](FIREBASE_SETUP.md). Las diferencias que más importan:
>
> | Dice acá | Está así hoy |
> |---|---|
> | `mockData.js` con datos de demostración | `seedData.js`, **vacío**. Las barberías se dan de alta a mano desde `/super-admin`. |
> | Los componentes leen de `state` | Leen de los hooks de `src/hooks/useTenantData.js`, que filtran por tenant |
> | Un solo negocio (`businessSettings`) | Multi-tenant: rutas `/:businessSlug/...` |
> | `authorizedAdmins` define todos los roles | Los dueños de plataforma están en `src/config/platform.js`; los admins de cada negocio llevan `businessId` |
> | Rutas de cliente en `/`, `/mis-citas` | `/:businessSlug`, `/:businessSlug/mis-citas` |
> | `dayOfWeek: 0` = Lunes | Igual (0=Lunes … 6=Domingo). **No es el `getDay()` de JS** — se convierte en `getLocalDayOfWeek()` |
>
> Ante una duda, el código manda sobre estos documentos.

---

## 1. Descripción General del Software
**SaciaTurno** es una aplicación web (SPA) para la gestión y reserva de turnos orientada a negocios de servicios (ej. barberías, salones de belleza, centros de estética).
*   **Modelo de Datos**: Local-first en el frontend. Utiliza `localStorage` como persistencia simulada de base de datos a través de contexts de React.
*   **Enfoque de Usuarios (Autenticación por Google OAuth)**:
    *   **Cliente**: Inicia sesión mediante Google, registra sus datos personales, selecciona un profesional, elige un servicio, busca fechas/horas disponibles y reserva su turno.
    *   **Administrador / Staff**: Inicia sesión con su cuenta de Google. Si su correo está en la lista de administradores autorizados (`authorizedAdmins`), accede al panel administrativo.
    *   **Owner (Dueño)**: Acceso total al panel de administración, incluyendo la gestión de otros administradores y configuración general.

---

## 2. Stack Tecnológico
*   **Core**: React 19 (JavaScript / JSX)
*   **Herramienta de Construcción**: Vite
*   **Enrutamiento**: React Router DOM v7
*   **Autenticación**: `@react-oauth/google` para inicio de sesión único con Google + `jwt-decode` para procesar el token en el cliente.
*   **Estilos**: CSS Puro (Vanilla CSS), gestionado dinámicamente mediante variables CSS (`theme.js`) y un archivo central `index.css`.
*   **Gestión del Estado**: React Contexts (`useContext` + `useReducer`).
*   **Base de Datos / Persistencia**: `localStorage` inicializado con datos mock (`mockData.js`).
*   **Variables de Entorno**: `.env` para la definición de `VITE_GOOGLE_CLIENT_ID`.

---

## 3. Estructura de Directorios y Archivos

```text
saciaTurno/
├── .env                    # Configuración de variables de entorno (Google Client ID)
├── public/                 # Recursos estáticos
├── src/
│   ├── components/
│   │   └── layout/         # Componentes estructurales (Header, Footer, AdminLayout)
│   ├── config/
│   │   ├── mockData.js     # Datos mock iniciales del sistema
│   │   └── theme.js        # Configuración del sistema de temas White-Label
│   ├── contexts/
│   │   ├── AuthContext.jsx       # Gestión de sesión a través de Google OAuth
│   │   ├── BookingContext.jsx    # Estado del wizard de reservas paso a paso
│   │   └── BusinessContext.jsx   # Estado central del negocio, CRUDs y admins autorizados
│   ├── pages/
│   │   ├── admin/          # Panel administrativo (Dashboard, Profesionales, Servicios, Citas, Admins, Configuración)
│   │   └── client/         # Vistas de cliente (Booking, Login, Register, Mis Citas, Confirmación)
│   ├── utils/
│   │   ├── availabilityEngine.js # Algoritmo de cálculo de disponibilidad de turnos
│   │   ├── dateUtils.js          # Conversiones de fecha, hora y formateo de precios
│   │   └── statsCalculator.js    # Lógica de cálculo de métricas para el dashboard
│   ├── App.jsx             # Enrutador principal y configuración de rutas protegidas
│   ├── index.css           # Estilos globales y variables de diseño
│   └── main.jsx            # Punto de entrada de React con la jerarquía de Providers y GoogleOAuthProvider
├── package.json
└── vite.config.js
```

---

## 4. Estructura y Esquemas de Datos (Mock & State)

Los datos se estructuran bajo las siguientes entidades inicializadas en [mockData.js](file:///c:/Users/cavan/Desktop/Codes/saciaTurno/src/config/mockData.js):

### A. Configuración de Negocio (`businessSettings`)
Define la identidad y configuración básica del salón.
```javascript
{
  id: 'biz-001',
  name: 'Barbería SACIA',
  slug: 'barberia-sacia',
  logoUrl: null,
  primaryColor: '#6366f1',
  secondaryColor: '#818cf8',
  accentColor: '#c084fc',
  phone: '+54 11 1234-5678',
  email: 'info@barberiasacia.com',
  address: 'Av. Corrientes 1234, CABA',
  city: 'Buenos Aires',
  country: 'Argentina',
  currency: 'ARS',
  timezone: 'America/Buenos_Aires',
  slotInterval: 30,         // Intervalo de división de turnos (en minutos)
  minCancelHours: 2,        // Antelación mínima requerida para cancelar un turno
  onlineBookingEnabled: true,
  welcomeMessage: 'Reservá tu turno en segundos',
  socialLinks: { instagram: '@barberiasacia', whatsapp: '+5411123456789' }
}
```

### B. Profesionales (`professionals`)
Representa al staff del salón.
```javascript
{
  id: 'prof-001',
  businessId: 'biz-001',
  name: 'Carlos Gómez',
  avatarUrl: null,
  specialty: 'Barbero Senior',
  bio: 'Descripción de experiencia...',
  phone: '+54 11 5555-0001',
  email: 'carlos@barberiasacia.com',
  displayOrder: 1,
  isActive: true
}
```

### C. Servicios (`services`)
Los servicios que ofrece el salón.
```javascript
{
  id: 'srv-001',
  businessId: 'biz-001',
  name: 'Corte Clásico',
  description: 'Descripción...',
  durationMinutes: 30,
  price: 5000,
  category: 'Cortes',
  imageUrl: null,
  displayOrder: 1,
  isActive: true
}
```

### D. Relación Profesional-Servicio (`professionalServices`)
Permite asociar qué profesionales realizan qué servicios, y opcionalmente personalizar el precio o la duración para esa combinación en particular.
```javascript
{
  id: 'ps-001',
  professionalId: 'prof-001',
  serviceId: 'srv-001',
  customPrice: null,        // Si es null, usa el precio base del servicio
  customDuration: null      // Si es null, usa la duración base del servicio
}
```

### E. Horarios de Trabajo (`schedules`)
Define los días de la semana y rango horario en que cada profesional trabaja.
*   `dayOfWeek`: Entero del `0` (Lunes) al `6` (Domingo).
```javascript
{
  id: 'sch-001',
  professionalId: 'prof-001',
  dayOfWeek: 0,             // Lunes
  startTime: '09:00',
  endTime: '19:00',
  breakStart: '13:00',      // Opcional, descanso
  breakEnd: '14:00',
  isActive: true
}
```

### F. Citas / Reservas (`appointments`)
Representa los turnos reservados.
*   `status`: `'pendiente'` | `'confirmada'` | `'completada'` | `'no_asistio'` | `'cancelada'`.
```javascript
{
  id: 'apt-001',
  businessId: 'biz-001',
  userId: 'usr-002',
  professionalId: 'prof-001',
  serviceId: 'srv-002',
  appointmentDate: '2026-03-12', // Formato YYYY-MM-DD
  startTime: '10:00',
  endTime: '11:00',
  price: 7500,
  status: 'confirmada',
  notes: '',
  adminNotes: '',
  cancellationReason: '',        // Opcional, en caso de cancelarse
  createdAt: '2026-03-10T15:30:00'
}
```

### G. Administradores Autorizados (`authorizedAdmins`)
Lista de cuentas de Google con permisos especiales de acceso al panel administrativo.
*   `role`: `'owner'` (acceso total a la configuración y gestión de administradores) | `'admin'` (acceso limitado a gestionar sus propias citas. Debe estar asociado a un `professionalId`).
```javascript
{
  id: 'auth-001',
  email: 'pocopanjugueteria@gmail.com',
  role: 'owner',
  professionalId: null,
  name: 'Dueño SACIA',
  addedAt: '2025-01-01T00:00:00'
}
```

---

## 5. Gestión del Estado (React Contexts)

La aplicación implementa 3 contextos principales en [src/contexts/](file:///c:/Users/cavan/Desktop/Codes/saciaTurno/src/contexts/):

1.  **`AuthContext.jsx`**:
    *   Gestiona el inicio de sesión y cierre de sesión a través de Google OAuth.
    *   **Google Login Flow**:
        1. Al recibir la credencial (JWT) de Google, la decodifica para obtener el `email`, `name` y `avatarUrl`.
        2. Compara el `email` contra la lista de `authorizedAdmins` de `BusinessContext`.
        3. Si existe una coincidencia, le asigna el rol correspondiente (`'owner'` o `'admin'`) y el `professionalId` asociado. Si no, le asigna el rol `'client'`.
        4. Guarda el objeto de usuario y estado en `localStorage` con la clave `saciaturno_auth`.
    *   **Auto-revalidación**: Un `useEffect` monitorea cambios en `authorizedAdmins` para actualizar inmediatamente en tiempo real el rol del usuario logueado en caso de revocación o cambios de permisos.
2.  **`BusinessContext.jsx`**:
    *   Controla el estado global de la base de datos simulada (profesionales, servicios, horarios, citas, configuración general y administradores autorizados).
    *   Mantiene los CRUDs y sincroniza automáticamente los datos nuevos provenientes de `mockData.js` con los datos locales guardados en `localStorage` (clave `saciaturno_data`).
3.  **`BookingContext.jsx`**:
    *   Almacena los pasos intermedios que hace un usuario en el wizard de reserva del cliente (`step`, `professionalId`, `serviceId`, `date`, `timeSlot`, `personalInfo`). No se persiste, se reinicia al completar la reserva.

---

## 6. Lógica y Motores Core (Utils)

Ubicados en [src/utils/](file:///c:/Users/cavan/Desktop/Codes/saciaTurno/src/utils/):

### A. Motor de Disponibilidad (`availabilityEngine.js`)
Es la lógica de negocios central que calcula qué franjas de tiempo están libres.
*   **`calculateAvailableSlots`**:
    1.  Obtiene el horario de trabajo (`schedule`) del profesional para el día de la semana correspondiente a la fecha solicitada.
    2.  Obtiene la duración del servicio (priorizando la personalizada en `professionalServices` si existe, o usando la base de `services`).
    3.  Genera todos los intervalos posibles (`cursor`) entre `startTime` y `endTime` basados en el tamaño del slot (por defecto 30 mins).
    4.  Filtra slots que se solapen con el horario de descanso (`breakStart` a `breakEnd`).
    5.  Obtiene las citas del profesional para esa fecha que estén en estado `'pendiente'` o `'confirmada'`.
    6.  Elimina cualquier slot que choque o se solape con una cita existente.
    7.  Si la fecha a calcular es el día actual ("hoy"), se remueven los slots cuyo horario de inicio ya haya pasado.

### B. Calculador de Estadísticas (`statsCalculator.js`)
Procesa el histórico de citas y calcula las métricas mostradas en el panel de administrador:
*   Ingresos totales de citas en estado `'completada'`.
*   Desglose de ingresos y cantidad de citas por profesional y por servicio.
*   Tasas porcentuales de inasistencia (`no_asistio`) y cancelación (`cancelada`).

### C. Utilidades de Fechas (`dateUtils.js`)
*   Conversiones de formato de fecha a cadenas cortas/largas legibles.
*   Operaciones de conversión de tiempo de texto (`"HH:MM"`) a minutos totales y viceversa para facilitar comparaciones y sumas de duraciones.

---

## 7. Ruteo y Protección de Rutas (`App.jsx`)
La navegación está dividida en dos layouts principales:
1.  **Cliente**: Rutas desprotegidas para reservas, registro y login con Google, y la ruta protegida `/mis-citas`.
2.  **Admin** (`/admin`): Envuelto bajo `ProtectedRoute` con restricción `adminOnly` (verifica si el usuario tiene rol `owner` o `admin`). Ofrece un panel con subrutas:
    *   `/admin` - Dashboard de estadísticas generales e ingresos.
    *   `/admin/profesionales` - Gestión de profesionales del staff.
    *   `/admin/servicios` - Gestión de catálogo de servicios.
    *   `/admin/citas` - Agenda y estado de turnos.
    *   `/admin/admins` - Gestión de administradores autorizados (solo accesible para el rol `owner`).
    *   `/admin/configuracion` - Ajustes del negocio (colores de tema, información básica, etc.).

---

## 8. Guía de Ejecución y Desarrollo Local

Para correr este proyecto en modo local:

1.  **Asegurar archivo `.env`**: Debe existir en la raíz con la clave de cliente de Google:
    ```env
    VITE_GOOGLE_CLIENT_ID=tu_client_id_de_google.apps.googleusercontent.com
    ```
2.  **Instalar dependencias**:
    ```bash
    npm install
    ```
3.  **Ejecutar el servidor de desarrollo**:
    ```bash
    npm run dev
    ```
4.  **Acceso de Prueba Administrativo**:
    *   Para ingresar como Owner o Admin, agrega tu Gmail a la lista de `authorizedAdmins` dentro del archivo [mockData.js](file:///c:/Users/cavan/Desktop/Codes/saciaTurno/src/config/mockData.js) (o hazlo desde la base de datos simulada en `localStorage`), inicia sesión en la app usando tu Google Login y ve a la sección `/admin`.
