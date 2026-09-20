/**
 * Routing.
 *
 * Route guards are UX, not security: they stop a user landing on a page they
 * cannot use. Every API call behind those pages is independently authorised on
 * the server, so bypassing a guard gains nothing.
 *
 * Heavy pages are code-split — the landing page and login must not pay for
 * Recharts and jsPDF.
 */

import { Suspense, lazy, useEffect } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import Layout from './components/Layout';
import { LoadingState } from './components/ui';
import { TelemetryProviderComponent } from './lib/telemetry/TelemetryContext';
import { setUnauthorizedHandler } from './lib/api';
import { useAppDispatch, useAppSelector } from './store';
import { restoreSession } from './store/authSlice';

// --- eager: the pre-auth surface ---
import Home from './pages/Home';
import Login from './pages/Login';
import Signup from './pages/Signup';

// --- lazy: the application ---
const Overview = lazy(() => import('./pages/Overview'));
const Microgrid = lazy(() => import('./pages/Microgrid'));
const Nodes = lazy(() => import('./pages/Nodes'));
const SolarNode = lazy(() => import('./pages/SolarNode'));
const BatteryNode = lazy(() => import('./pages/BatteryNode'));
const LoadNode = lazy(() => import('./pages/LoadNode'));
const Alerts = lazy(() => import('./pages/Alerts'));
const Intelligence = lazy(() => import('./pages/Intelligence'));
const Analytics = lazy(() => import('./pages/Analytics'));
const SystemHealth = lazy(() => import('./pages/SystemHealth'));
const DemoControl = lazy(() => import('./pages/DemoControl'));
const BillCalculator = lazy(() => import('./pages/BillCalculator'));
const Reports = lazy(() => import('./pages/Reports'));
const Settings = lazy(() => import('./pages/Settings'));
const UserManagement = lazy(() => import('./pages/UserManagement'));

export default function App() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const status = useAppSelector((s) => s.auth.status);
  const language = useAppSelector((s) => s.ui.language);
  const { i18n } = useTranslation();

  // Restore the session once on boot.
  useEffect(() => {
    void dispatch(restoreSession());
  }, [dispatch]);

  // A 401 anywhere returns the user to login, rather than leaving a page
  // silently empty.
  useEffect(() => {
    setUnauthorizedHandler(() => navigate('/login', { replace: true }));
  }, [navigate]);

  useEffect(() => {
    if (i18n.language !== language) void i18n.changeLanguage(language);
  }, [language, i18n]);

  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={status === 'authenticated' ? <Navigate to="/app/overview" replace /> : <Login />} />
      <Route path="/signup" element={status === 'authenticated' ? <Navigate to="/app/overview" replace /> : <Signup />} />
      <Route path="/auth/google/callback" element={<Login />} />

      <Route
        path="/app"
        element={
          <RequireAuth>
            <TelemetryProviderComponent>
              <Layout />
            </TelemetryProviderComponent>
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/app/overview" replace />} />
        <Route path="overview" element={<Lazy><Overview /></Lazy>} />
        <Route path="microgrid" element={<Lazy><Microgrid /></Lazy>} />
        <Route path="nodes" element={<Lazy><Nodes /></Lazy>} />
        <Route path="solar" element={<Lazy><SolarNode /></Lazy>} />
        <Route path="battery" element={<Lazy><BatteryNode /></Lazy>} />
        <Route path="ac-load" element={<Lazy><LoadNode kind="AC_LOAD" /></Lazy>} />
        <Route path="dc-load" element={<Lazy><LoadNode kind="DC_LOAD" /></Lazy>} />
        <Route path="node/:nodeId" element={<Lazy><Nodes /></Lazy>} />
        <Route path="alerts" element={<Lazy><Alerts /></Lazy>} />
        <Route
          path="ai"
          element={<RequirePermission permission="view:ai"><Lazy><Intelligence /></Lazy></RequirePermission>}
        />
        <Route
          path="analytics"
          element={<RequirePermission permission="view:analytics"><Lazy><Analytics /></Lazy></RequirePermission>}
        />
        <Route path="health" element={<Lazy><SystemHealth /></Lazy>} />
        <Route
          path="demo"
          element={<RequirePermission permission="simulation:control"><Lazy><DemoControl /></Lazy></RequirePermission>}
        />
        <Route path="bill" element={<Lazy><BillCalculator /></Lazy>} />
        <Route
          path="reports"
          element={<RequirePermission permission="reports:generate"><Lazy><Reports /></Lazy></RequirePermission>}
        />
        <Route path="settings" element={<Lazy><Settings /></Lazy>} />
        <Route
          path="users"
          element={<RequirePermission permission="users:manage"><Lazy><UserManagement /></Lazy></RequirePermission>}
        />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function Lazy({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<LoadingState />}>{children}</Suspense>;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const status = useAppSelector((s) => s.auth.status);

  // Wait for the session check rather than bouncing to /login and back, which
  // would flash the login page on every reload.
  if (status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-panel-950">
        <LoadingState label="Restoring session" />
      </div>
    );
  }
  if (status !== 'authenticated') return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequirePermission({
  permission,
  children,
}: {
  permission: string;
  children: React.ReactNode;
}) {
  const permissions = useAppSelector((s) => s.auth.permissions);
  const role = useAppSelector((s) => s.auth.user?.role);

  if (!permissions.includes(permission)) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="text-lg font-semibold text-slate-200">Access restricted</h1>
        <p className="mt-2 text-sm text-slate-500">
          Your role ({role}) does not include access to this page. Contact an administrator if you
          need it.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}

function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-panel-950 px-6 text-center">
      <p className="font-mono text-5xl font-semibold text-panel-500">404</p>
      <p className="text-sm text-slate-400">That page does not exist.</p>
      <a href="/" className="btn btn-secondary">
        Return home
      </a>
    </div>
  );
}
