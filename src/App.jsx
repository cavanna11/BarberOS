import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { useBusiness } from './contexts/BusinessContext';
import BusinessSync from './contexts/BusinessSync';
import { isPlatformOwner } from './config/platform';
import Header from './components/layout/Header';
import Footer from './components/layout/Footer';
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
const ConfirmationPage = lazy(() => import('./pages/client/ConfirmationPage'));
const MyAppointments   = lazy(() => import('./pages/client/MyAppointments'));

// Panel del negocio
const DashboardPage       = lazy(() => import('./pages/admin/DashboardPage'));
const AgendaPage          = lazy(() => import('./pages/admin/AgendaPage'));
const ProfessionalsPage   = lazy(() => import('./pages/admin/ProfessionalsPage'));
const ServicesPage        = lazy(() => import('./pages/admin/ServicesPage'));
const AppointmentsPage    = lazy(() => import('./pages/admin/AppointmentsPage'));
const SettingsPage        = lazy(() => import('./pages/admin/SettingsPage'));
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
 * Envuelve las rutas públicas de cliente (`/:businessSlug/...`).
 * Verifica que el slug corresponda a un negocio real y que no esté congelado
 * por falta de pago antes de dejar reservar.
 */
function TenantRoute({ children }) {
  const { businessSlug } = useParams();
  const { state } = useBusiness();
  const { user, loading } = useAuth();
  const business = (state.businesses || []).find((b) => b.slug === businessSlug);

  if (!business) {
    // "No existe" recién cuando se SABE que no existe. Antes se mostraba
    // mientras el slug todavía se estaba resolviendo, y cada apertura del
    // link arrancaba con un cartel de error que después desaparecía.
    const esPlataforma = user?.isPlatformTeam === true;
    const resuelto = esPlataforma
      ? state.negociosCargados === true
      : state.slugEstado?.slug === businessSlug && state.slugEstado.estado !== 'resolviendo';
    if (loading || !resuelto) return <SessionLoading />;
    return <NoBusinessPage reason="not-found" />;
  }
  if (business.isFrozen || business.onlineBookingEnabled === false) {
    return <NoBusinessPage reason="frozen" />;
  }

  return children;
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
  return (
    <>
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
          <Route path="agenda" element={<AgendaPage />} />
          <Route path="profesionales" element={<ProfessionalsPage />} />
          <Route path="servicios" element={<ServicesPage />} />
          <Route path="citas" element={<AppointmentsPage />} />
          <Route path="admins" element={<AdminsPage />} />
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
          <Route index element={<SuperAdminDashboard />} />
        </Route>

        {/* ── Rutas públicas de cliente, por negocio ──────────────── */}
        {/* Van al final: los segmentos estáticos de arriba tienen prioridad */}
        {/* Sin ProtectedRoute a propósito: el link de la barbería se abre sin
            cuenta. El cliente ve el equipo, los servicios y la grilla, y recién
            al llegar a sus datos se le pide entrar. Antes lo primero que veía
            era una pantalla de login con marca BarberOS y ni el nombre de la
            barbería — para un link puesto en Instagram es tirar la mitad de
            los que entran. */}
        <Route path="/:businessSlug" element={
          <ClientLayout><TenantRoute><BookingPage /></TenantRoute></ClientLayout>
        } />
        <Route path="/:businessSlug/confirmacion" element={
          <ProtectedRoute>
            <ClientLayout><TenantRoute><ConfirmationPage /></TenantRoute></ClientLayout>
          </ProtectedRoute>
        } />
        <Route path="/:businessSlug/mis-citas" element={
          <ProtectedRoute>
            <ClientLayout><TenantRoute><MyAppointments /></TenantRoute></ClientLayout>
          </ProtectedRoute>
        } />

        {/* Fallback */}
        <Route path="*" element={<ClientLayout><NoBusinessPage reason="not-found" /></ClientLayout>} />
      </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
