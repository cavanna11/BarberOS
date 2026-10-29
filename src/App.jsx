import { lazy, Suspense } from 'react';
import { importarConReintento } from './utils/versionNueva';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { estadoDelNegocio } from './utils/estadoDelNegocio';
import { useBusiness } from './contexts/BusinessContext';
import BusinessSync from './contexts/BusinessSync';
import { isPlatformOwner } from './config/platform';
import { entraAlPanel } from './config/roles';
import { tienePagina } from './config/pagina';
import { paginaExclusiva } from './paginas-exclusivas';
import Header from './components/layout/Header';
import Footer from './components/layout/Footer';
import { BarraSlotly } from './components/landing/Slotly';
import TemaNegocio from './components/client/TemaNegocio';
import AdminLayout from './components/layout/AdminLayout';
import SuperAdminLayout from './components/layout/SuperAdminLayout';

// ── Carga diferida por ruta ────────────────────────────────────────────────
// Cada bloque se descarga solo cuando hace falta. Antes todo iba en un único
// bundle: quien entraba a reservar un turno se bajaba también el panel de
// administración y el panel global, que nunca va a usar.
//
// LoginPage y NoBusinessPage quedan en el bundle inicial: son livianas y se
// necesitan al toque en el recorrido más común.

// Cliente
import LoginPage from './pages/client/LoginPage';
import NoBusinessPage from './pages/client/NoBusinessPage';
import CuentaSinBarberia from './pages/client/CuentaSinBarberia';
import SinAcceso from './pages/client/SinAcceso';

const LandingPage      = lazy(importarConReintento(() => import('./pages/LandingPage')));
const BookingPage      = lazy(importarConReintento(() => import('./pages/client/BookingPage')));
const PaginaBarberia   = lazy(importarConReintento(() => import('./pages/client/PaginaBarberia')));
const ConfirmationPage = lazy(importarConReintento(() => import('./pages/client/ConfirmationPage')));
const MyAppointments   = lazy(importarConReintento(() => import('./pages/client/MyAppointments')));
const PremiosPage      = lazy(importarConReintento(() => import('./pages/client/PremiosPage')));
const CuentaPublica    = lazy(importarConReintento(() => import('./pages/client/CuentaPublica')));

// Panel del negocio
const DashboardPage       = lazy(importarConReintento(() => import('./pages/admin/DashboardPage')));
const ProfessionalsPage   = lazy(importarConReintento(() => import('./pages/admin/ProfessionalsPage')));
const ServicesPage        = lazy(importarConReintento(() => import('./pages/admin/ServicesPage')));
const ProductosPage       = lazy(importarConReintento(() => import('./pages/admin/ProductosPage')));
const AppointmentsPage    = lazy(importarConReintento(() => import('./pages/admin/AppointmentsPage')));
const SettingsPage        = lazy(importarConReintento(() => import('./pages/admin/SettingsPage')));
const SucursalesPage      = lazy(importarConReintento(() => import('./pages/admin/SucursalesPage')));
const PaginaPage          = lazy(importarConReintento(() => import('./pages/admin/PaginaPage')));
const CuponesPage         = lazy(importarConReintento(() => import('./pages/admin/CuponesPage')));
const RecompensasPage     = lazy(importarConReintento(() => import('./pages/admin/RecompensasPage')));
const MembresiasPage      = lazy(importarConReintento(() => import('./pages/admin/MembresiasPage')));
const ResenasPage         = lazy(importarConReintento(() => import('./pages/admin/ResenasPage')));
const AdminsPage          = lazy(importarConReintento(() => import('./pages/admin/AdminsPage')));
const ProfileSettingsPage = lazy(importarConReintento(() => import('./pages/admin/ProfileSettingsPage')));
const SupportPage         = lazy(importarConReintento(() => import('./pages/admin/SupportPage')));
const InstalarPage        = lazy(importarConReintento(() => import('./pages/admin/InstalarPage')));

// Panel global
const SuperAdminDashboard = lazy(importarConReintento(() => import('./pages/super-admin/SuperAdminDashboard')));

// Redirige a /login si no está autenticado, recordando a dónde quería ir
// para volver ahí después del login (importante ahora que el link del cliente
// lleva el slug del negocio).
// adminOnly = true       → además exige rol admin | owner
// superAdminOnly = true  → exige ser dueño de la plataforma
function ProtectedRoute({ children, adminOnly = false, superAdminOnly = false }) {
  const { isAuthenticated, user, loading } = useAuth();
  const location = useLocation();

  // Al recargar, Firebase tarda un instante en restaurar la sesión. Sin esta
  // espera, `isAuthenticated` arranca en false y el usuario sale rebotado al
  // login en cada F5 aunque tenga sesión válida.
  if (loading) return <SessionLoading />;

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  // Por el claim (user.isPlatformTeam), no por la lista de mails de
  // config/platform.js: esa lista es comodidad de UI y no sabe de moderadores.
  const platformOwner = user?.isPlatformOwner || isPlatformOwner(user?.email);
  const platformTeam = user?.isPlatformTeam || platformOwner;

  // Ojo con el destino: hasta el 13/10/2026 los dos casos hacian
  // `<Navigate to="/" />`, y en la raiz un usuario sin rol ve la LANDING DE
  // VENTA. El barbero iniciaba sesion bien y aparecia en la pagina publica de
  // BarberOS, sin cartel ni error: imposible de entender y de explicar. Pasa
  // con cualquiera a quien le falte el permiso o que entre con otro mail.
  if (superAdminOnly && !platformTeam) {
    // El staff que escribe /super-admin a mano va a SU panel, que es el que le
    // corresponde; no es un problema de acceso que haya que explicarle.
    if (entraAlPanel(user)) {
      return <Navigate to="/admin" replace />;
    }
    return <SinAcceso />;
  }

  if (adminOnly && !entraAlPanel(user) && !platformOwner) {
    return <SinAcceso />;
  }

  return children;
}

/**
 * Resuelve a qué negocio apunta el slug de la URL.
 *
 * `estado` es uno de:
 *   'resolviendo' → todavía no se sabe. No es ni que existe ni que no.
 *   'no-existe'   → se sabe que ese slug no es de nadie.
 *   'cerrado'     → existe pero no toma turnos (suspendida, o apagada).
 *   'ok'          → anda.
 *
 * Está como hook y no adentro de `TenantRoute` porque la entrada pública lo
 * necesita ANTES de decidir con qué layout pintar: una barbería con su página
 * de presentación no lleva el header de BarberOS, y eso no se puede saber
 * desde afuera del componente que ya resolvió el negocio.
 */
function useNegocioDelSlug() {
  const { businessSlug } = useParams();
  const { state } = useBusiness();
  const { user, loading } = useAuth();
  const business = (state.businesses || []).find((b) => b.slug === businessSlug);

  // El link de la CUENTA de una cuenta con sucursales (no es ninguna de ellas).
  // Para el visitante lo resuelve BusinessSync leyendo /slugs; la plataforma
  // tiene todas las barberías cargadas y lo encuentra en `slugCuenta`.
  if (!business) {
    if (state.slugEstado?.slug === businessSlug && state.slugEstado.estado === 'cuenta') {
      return { business: null, estado: 'cuenta', grupoId: state.slugEstado.grupoId };
    }
    const principal = (state.businesses || []).find((b) => b.slugCuenta && b.slugCuenta === businessSlug);
    if (principal) return { business: null, estado: 'cuenta', grupoId: principal.grupoId || principal.id };
  }

  if (!business) {
    // "No existe" recién cuando se SABE que no existe. Esto ya se había
    // arreglado una vez para el estado 'resolviendo', y faltaba la mitad:
    //
    // `slugEstado: 'ok'` se despacha apenas el slug resuelve, PERO el
    // documento de la barbería llega después, por el listener. En esa ventana
    // `business` todavía es undefined y el estado ya no es 'resolviendo', así
    // que la pantalla declaraba que el negocio no existe. En una conexión
    // rápida la ventana son milisegundos y no se ve; adentro del navegador de
    // Instagram, con 4G, dura lo suficiente como para que el cliente lea
    // "No encontramos este negocio" y se vaya.
    //
    // Ahora solo cuentan como respuesta los estados que de verdad responden:
    // 'no-existe' (el slug no está en la base) y 'sin-conexion' (no se pudo
    // averiguar, que es otra pantalla y con botón para reintentar).
    return {
      business: null,
      estado: estadoDelNegocio({
        business: null,
        businessSlug,
        slugEstado: state.slugEstado,
        esPlataforma: user?.isPlatformTeam === true,
        negociosCargados: state.negociosCargados === true,
        loading,
      }),
    };
  }
  return { business, estado: estadoDelNegocio({ business }) };
}

/**
 * Envuelve las rutas públicas de cliente (`/:businessSlug/...`).
 * Verifica que el slug corresponda a un negocio real y que no esté congelado
 * por falta de pago antes de dejar reservar.
 */
function TenantRoute({ children }) {
  const { estado, grupoId } = useNegocioDelSlug();
  if (estado === 'resolviendo') return <SessionLoading />;
  if (estado === 'cuenta') return <CuentaPublica grupoId={grupoId} />;
  if (estado === 'sin-conexion') return <NoBusinessPage reason="sin-conexion" />;
  if (estado === 'no-existe') return <NoBusinessPage reason="not-found" />;
  if (estado === 'cerrado') return <NoBusinessPage reason="frozen" />;
  return children;
}

/**
 * Una pantalla pública de la barbería: la reserva, la confirmación, sus turnos.
 *
 * Junta las tres cosas que van siempre juntas ahí: los colores de la barbería,
 * el header y el footer, y el chequeo de que el slug exista y esté activo.
 *
 * El tema va AFUERA del layout y no adentro para que el header también quede
 * con los colores de la barbería. Para el cliente, esa pantalla es la agenda de
 * SU barbería; un header naranja arriba de una reserva verde se ve como dos
 * sitios pegados con cinta.
 */
function RutaDeCliente({ children }) {
  const { business } = useNegocioDelSlug();
  return (
    <TemaNegocio business={business}>
      <ClientLayout><TenantRoute>{children}</TenantRoute></ClientLayout>
    </TemaNegocio>
  );
}

/**
 * Qué hay en `/:slug`: la página de presentación de la barbería, o la reserva.
 *
 * Nace apagada para todas (`paginaActiva` no existe en ningún documento hasta
 * que alguien la prende), así que mientras nadie la toque `/:slug` sigue siendo
 * exactamente la reserva de siempre. Eso es a propósito: esto no puede cambiarle
 * el link a una barbería que ya lo repartió sin que ella lo decida.
 *
 * El `if` por el estado 'resolviendo' no es el mismo que el de `TenantRoute`,
 * aunque muestre lo mismo: acá se devuelve el "Cargando…" SIN el header de
 * BarberOS, porque todavía no se sabe si esta barbería tiene su propia página
 * —y si la tiene, ese header no va. Verlo aparecer y desaparecer en el primer
 * medio segundo es peor que no verlo nunca.
 */
function EntradaPublica() {
  const { business, estado } = useNegocioDelSlug();

  if (estado === 'resolviendo') return <SessionLoading />;
  if (estado === 'cuenta') return <RutaDeCliente><BookingPage /></RutaDeCliente>;
  // La página exclusiva se muestra aunque el plan no tenga la de presentación
  // prendida: es un trabajo que se pagó aparte, no una función del plan.
  if (estado === 'ok' && (tienePagina(business) || paginaExclusiva(business?.id))) {
    return <PaginaBarberia business={business} />;
  }
  return <RutaDeCliente><BookingPage /></RutaDeCliente>;
}

/** Placeholder mientras Firebase resuelve si hay sesión abierta. */
function SessionLoading() {
  return (
    <div className="empty-state" style={{ padding: 'var(--space-2xl)' }}>
      <p>Cargando…</p>
    </div>
  );
}

// Redirige a /admin (o /super-admin) si el usuario ya está logueado
function PublicOnlyRoute({ children }) {
  const { isAuthenticated, user, loading } = useAuth();
  if (loading) return <SessionLoading />;
  if (isAuthenticated) {
    if (user?.isPlatformTeam || isPlatformOwner(user?.email)) {
      return <Navigate to="/super-admin" replace />;
    }
    if (entraAlPanel(user)) {
      return <Navigate to="/admin" replace />;
    }
  }
  return children;
}

/**
 * Qué mostrar en la raíz.
 *
 * Para quien ya trabaja con el sistema, es un atajo a su panel. Para todos los
 * demás es la landing de venta: el dominio público es la puerta de entrada
 * comercial, no un cartel de "te falta un link".
 *
 * Un cliente de barbería nunca cae acá: llega directo a /su-barberia.
 */
function EntryRoute() {
  const { isAuthenticated, user, loading } = useAuth();

  if (loading) return <SessionLoading />;
  if (isAuthenticated && (user?.isPlatformTeam || isPlatformOwner(user?.email))) {
    return <Navigate to="/super-admin" replace />;
  }
  if (isAuthenticated && entraAlPanel(user)) {
    return <Navigate to="/admin" replace />;
  }
  return <LandingPage />;
}

function ClientLayout({ children }) {
  const { pathname } = useLocation();
  // Solo en la portada: dentro del link de una barbería, mandar al cliente a
  // otro turnero no tiene sentido, y en el login menos.
  const esPortada = pathname === '/';
  return (
    <>
      {esPortada && <BarraSlotly />}
      <Header />
      {children}
      <Footer />
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      {/* Mantiene el estado de negocios sincronizado con Firestore. No pinta nada. */}
      <BusinessSync />
      {/* Suspense envuelve todo el ruteo: sin esto, cualquier ruta diferida
          lanza al montar y rompe el árbol entero. */}
      <Suspense fallback={<SessionLoading />}>
      <Routes>

        {/* ── Raíz ────────────────────────────────────────────────── */}
        <Route path="/" element={<ClientLayout><EntryRoute /></ClientLayout>} />

        {/* Login unificado para clientes y admins */}
        <Route path="/login" element={
          <PublicOnlyRoute>
            <ClientLayout><LoginPage /></ClientLayout>
          </PublicOnlyRoute>
        } />

        {/* Redirigir la vieja URL del admin login al login unificado */}
        <Route path="/admin/login" element={<Navigate to="/login" replace />} />

        {/* Adónde cae quien se logueó pero no tiene barbería. Antes volvía a la
            landing sin explicación y parecía que el login había fallado. */}
        <Route path="/cuenta" element={<ClientLayout><CuentaSinBarberia /></ClientLayout>} />

        {/* ── Rutas de admin ──────────────────────────────────────── */}
        <Route path="/admin" element={
          <ProtectedRoute adminOnly>
            <AdminLayout />
          </ProtectedRoute>
        }>
          <Route index element={<DashboardPage />} />
          <Route path="profesionales" element={<ProfessionalsPage />} />
          <Route path="servicios" element={<ServicesPage />} />
          <Route path="productos" element={<ProductosPage />} />
          <Route path="citas" element={<AppointmentsPage />} />
          <Route path="admins" element={<AdminsPage />} />
          <Route path="sucursales" element={<SucursalesPage />} />
          <Route path="resenas" element={<ResenasPage />} />
          <Route path="pagina" element={<PaginaPage />} />
          <Route path="cupones" element={<CuponesPage />} />
          <Route path="recompensas" element={<RecompensasPage />} />
          <Route path="membresias" element={<MembresiasPage />} />
          <Route path="configuracion" element={<SettingsPage />} />
          <Route path="ajustes" element={<ProfileSettingsPage />} />
          <Route path="soporte" element={<SupportPage />} />
          <Route path="instalar" element={<InstalarPage />} />
        </Route>

        {/* ── Rutas de super-admin ────────────────────────────────── */}
        <Route path="/super-admin" element={
          <ProtectedRoute superAdminOnly>
            <SuperAdminLayout />
          </ProtectedRoute>
        }>
          {/* Una ruta por sección: el panel global dejó de ser una sola
              pantalla con ocho pestañas. `?tab=` sigue funcionando para los
              links viejos de la campanita. */}
          <Route index element={<SuperAdminDashboard />} />
          <Route path="barberias" element={<SuperAdminDashboard seccion="tenants" />} />
          <Route path="turnos" element={<SuperAdminDashboard seccion="citas" />} />
          <Route path="soporte" element={<SuperAdminDashboard seccion="soporte" />} />
          <Route path="avisos" element={<SuperAdminDashboard seccion="avisos" />} />
          <Route path="equipo" element={<SuperAdminDashboard seccion="equipo" />} />
          <Route path="whatsapp" element={<SuperAdminDashboard seccion="whatsapp" />} />
          <Route path="mensajes" element={<SuperAdminDashboard seccion="logs" />} />
        </Route>

        {/* ── Rutas públicas de cliente, por negocio ──────────────── */}
        {/* Van al final: los segmentos estáticos de arriba tienen prioridad */}
        {/* Sin ProtectedRoute a propósito: el link de la barbería se abre sin
            cuenta. El cliente ve el equipo, los servicios y la grilla, y recién
            al llegar a sus datos se le pide entrar. Antes lo primero que veía
            era una pantalla de login con marca BarberOS y ni el nombre de la
            barbería — para un link puesto en Instagram es tirar la mitad de
            los que entran. */}
        {/* La entrada del link: la página de presentación si la tiene prendida,
            y si no la reserva, igual que siempre. */}
        <Route path="/:businessSlug" element={<EntradaPublica />} />
        {/* La reserva, con su propia dirección. Existe SIEMPRE, con página o
            sin ella: es a dónde apunta el botón de reservar y es lo que se
            comparte cuando lo que se quiere compartir es el turno. */}
        <Route path="/:businessSlug/reservar" element={
          <RutaDeCliente><BookingPage /></RutaDeCliente>
        } />
        <Route path="/:businessSlug/confirmacion" element={
          <ProtectedRoute>
            <RutaDeCliente><ConfirmationPage /></RutaDeCliente>
          </ProtectedRoute>
        } />
        <Route path="/:businessSlug/mis-citas" element={
          <ProtectedRoute>
            <RutaDeCliente><MyAppointments /></RutaDeCliente>
          </ProtectedRoute>
        } />
        {/* "Tus premios": la tarjeta de fidelidad, la caja, la rasca y los
            premios ganados. Pide sesión: todo lo que muestra es de la cuenta. */}
        <Route path="/:businessSlug/premios" element={
          <ProtectedRoute>
            <RutaDeCliente><PremiosPage /></RutaDeCliente>
          </ProtectedRoute>
        } />

        {/* Fallback */}
        <Route path="*" element={<ClientLayout><NoBusinessPage reason="not-found" /></ClientLayout>} />
      </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
