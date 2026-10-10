import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { useBusiness } from './contexts/BusinessContext';
import BusinessSync from './contexts/BusinessSync';
import { isPlatformOwner } from './config/platform';
import { tienePagina } from './config/pagina';
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

const LandingPage      = lazy(() => import('./pages/LandingPage'));
const BookingPage      = lazy(() => import('./pages/client/BookingPage'));
const PaginaBarberia   = lazy(() => import('./pages/client/PaginaBarberia'));
const ConfirmationPage = lazy(() => import('./pages/client/ConfirmationPage'));
const MyAppointments   = lazy(() => import('./pages/client/MyAppointments'));
const CuentaPublica    = lazy(() => import('./pages/client/CuentaPublica'));

// Panel del negocio
const DashboardPage       = lazy(() => import('./pages/admin/DashboardPage'));
const ProfessionalsPage   = lazy(() => import('./pages/admin/ProfessionalsPage'));
const ServicesPage        = lazy(() => import('./pages/admin/ServicesPage'));
const AppointmentsPage    = lazy(() => import('./pages/admin/AppointmentsPage'));
const SettingsPage        = lazy(() => import('./pages/admin/SettingsPage'));
const SucursalesPage      = lazy(() => import('./pages/admin/SucursalesPage'));
const PaginaPage          = lazy(() => import('./pages/admin/PaginaPage'));
const CuponesPage         = lazy(() => import('./pages/admin/CuponesPage'));
const MembresiasPage      = lazy(() => import('./pages/admin/MembresiasPage'));
const ResenasPage         = lazy(() => import('./pages/admin/ResenasPage'));
const AdminsPage          = lazy(() => import('./pages/admin/AdminsPage'));
const ProfileSettingsPage = lazy(() => import('./pages/admin/ProfileSettingsPage'));
const SupportPage         = lazy(() => import('./pages/admin/SupportPage'));
const InstalarPage        = lazy(() => import('./pages/admin/InstalarPage'));

// Panel global
const SuperAdminDashboard = lazy(() => import('./pages/super-admin/SuperAdminDashboard'));

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

  if (superAdminOnly && !platformTeam) {
    return <Navigate to="/" replace />;
  }

  if (adminOnly && user?.role !== 'admin' && user?.role !== 'owner' && !platformOwner) {
    return <Navigate to="/" replace />;
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
    // "No existe" recién cuando se SABE que no existe. Antes se mostraba
    // mientras el slug todavía se estaba resolviendo, y cada apertura del
    // link arrancaba con un cartel de error que después desaparecía.
    const esPlataforma = user?.isPlatformTeam === true;
    const resuelto = esPlataforma
      ? state.negociosCargados === true
      : state.slugEstado?.slug === businessSlug && state.slugEstado.estado !== 'resolviendo';
    return { business: null, estado: loading || !resuelto ? 'resolviendo' : 'no-existe' };
  }
  if (business.isFrozen || business.onlineBookingEnabled === false) {
    return { business, estado: 'cerrado' };
  }
  return { business, estado: 'ok' };
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
  if (estado === 'ok' && tienePagina(business)) {
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
    if (user?.role === 'owner' || user?.role === 'admin') {
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
  if (isAuthenticated && (user?.role === 'owner' || user?.role === 'admin')) {
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
          <Route path="citas" element={<AppointmentsPage />} />
          <Route path="admins" element={<AdminsPage />} />
          <Route path="sucursales" element={<SucursalesPage />} />
          <Route path="resenas" element={<ResenasPage />} />
          <Route path="pagina" element={<PaginaPage />} />
          <Route path="cupones" element={<CuponesPage />} />
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

        {/* Fallback */}
        <Route path="*" element={<ClientLayout><NoBusinessPage reason="not-found" /></ClientLayout>} />
      </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
