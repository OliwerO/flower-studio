// App.jsx — the routing map of the entire application.
// Think of it as a site plan: each route is a department, and React Router
// is the corridor that sends staff to the right room based on the URL.

import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, lazy, Suspense } from 'react';
import { useAuth } from './context/AuthContext.jsx';
import { LanguageProvider } from './context/LanguageContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { setClientPin } from './api/client.js';
import { useNotifications } from './hooks/useNotifications.js';

import Toast                   from './components/Toast.jsx';
import BottomNav               from './components/BottomNav.jsx';

const LoginPage = lazy(() => import('./pages/LoginPage.jsx'));
const OrderListPage = lazy(() => import('./pages/OrderListPage.jsx'));
const OrderDetailPage = lazy(() => import('./pages/OrderDetailPage.jsx'));
const NewOrderPage = lazy(() => import('./pages/NewOrderPage.jsx'));
const PremadeBouquetCreatePage = lazy(() => import('./pages/PremadeBouquetCreatePage.jsx'));
const StockPanelPage = lazy(() => import('./pages/StockPanelPage.jsx'));
const StockEvaluationPage = lazy(() => import('./pages/StockEvaluationPage.jsx'));
const SubstituteReconciliationPage = lazy(() => import('./pages/SubstituteReconciliationPage.jsx'));
const DaySummaryPage = lazy(() => import('./pages/DaySummaryPage.jsx'));
const ShoppingSupportPage = lazy(() => import('./pages/ShoppingSupportPage.jsx'));
const PurchaseOrderPage = lazy(() => import('./pages/PurchaseOrderPage.jsx'));
const FloristHoursPage = lazy(() => import('./pages/FloristHoursPage.jsx'));
const BouquetsPage = lazy(() => import('./pages/BouquetsPage.jsx'));
const WasteLogPage = lazy(() => import('./pages/WasteLogPage.jsx'));
const CustomerListPage = lazy(() => import('./pages/CustomerListPage.jsx'));
const CustomerDetailPage = lazy(() => import('./pages/CustomerDetailPage.jsx'));

function PageFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center dark:bg-dark-bg">
      <div className="w-8 h-8 border-2 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
    </div>
  );
}

// PrivateRoute — like a badge-reader gate. Redirects to /login if no PIN in context.
function PrivateRoute({ children }) {
  const { pin } = useAuth();
  return pin ? children : <Navigate to="/login" replace />;
}

// OwnerRoute — only allows the owner role through. Florists get redirected to orders.
function OwnerRoute({ children }) {
  const { pin, role } = useAuth();
  if (!pin) return <Navigate to="/login" replace />;
  if (role !== 'owner') return <Navigate to="/orders" replace />;
  return children;
}

// (FloristRoute removed — the owner can do everything the florist can,
// including stock evaluation. ShoppingSupportPage is still owner-only.)

// Layout — wraps authenticated pages with the bottom tab bar.
// Like mounting the factory floor signage above every workstation.
function Layout({ children }) {
  return (
    <>
      {children}
      <BottomNav />
    </>
  );
}

export default function App() {
  const { pin } = useAuth();

  // Keep the axios client in sync whenever PIN changes in context
  useEffect(() => {
    setClientPin(pin);
  }, [pin]);

  // Listen for real-time notifications (new Wix orders, etc.)
  // Only active when logged in — SSE connection opens automatically
  useNotifications(pin ? () => {
    // Could trigger a refresh here — for now, toast is enough
  } : null);

  return (
    <ThemeProvider>
    <LanguageProvider>
      <Toast />
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

        <Route path="/orders" element={
          <PrivateRoute><Layout><OrderListPage /></Layout></PrivateRoute>
        } />

        <Route path="/orders/new" element={
          <PrivateRoute><Layout><NewOrderPage /></Layout></PrivateRoute>
        } />

        <Route path="/premade-bouquets/new" element={
          <PrivateRoute><Layout><PremadeBouquetCreatePage /></Layout></PrivateRoute>
        } />

        <Route path="/orders/:id" element={
          <PrivateRoute><Layout><OrderDetailPage /></Layout></PrivateRoute>
        } />

        <Route path="/stock" element={
          <PrivateRoute><Layout><StockPanelPage /></Layout></PrivateRoute>
        } />

        <Route path="/stock-evaluation" element={
          <PrivateRoute><Layout><StockEvaluationPage /></Layout></PrivateRoute>
        } />

        <Route path="/reconcile-substitutes" element={
          <PrivateRoute><SubstituteReconciliationPage /></PrivateRoute>
        } />

        <Route path="/shopping-support" element={
          <OwnerRoute><Layout><ShoppingSupportPage /></Layout></OwnerRoute>
        } />

        <Route path="/purchase-orders" element={
          <OwnerRoute><Layout><PurchaseOrderPage /></Layout></OwnerRoute>
        } />

        <Route path="/day-summary" element={
          <OwnerRoute><Layout><DaySummaryPage /></Layout></OwnerRoute>
        } />

        <Route path="/hours" element={
          <PrivateRoute><Layout><FloristHoursPage /></Layout></PrivateRoute>
        } />

        {/* Catalog (owner-only) — Wix bouquet management. /catalog is a shortcut
            that redirects to the default sub-view. */}
        <Route path="/catalog" element={<Navigate to="/catalog/bouquets" replace />} />
        <Route path="/catalog/bouquets" element={
          <OwnerRoute><Layout><BouquetsPage /></Layout></OwnerRoute>
        } />

        {/* Waste Log — both roles can view + CRUD (backend permits florist too). */}
        <Route path="/stock/waste" element={
          <PrivateRoute><Layout><WasteLogPage /></Layout></PrivateRoute>
        } />

        {/* Customers — both roles. Florist is view-only (enforced in
            CustomerDetailView via canEdit=role==='owner'); owner gets the
            same edit capabilities as the dashboard Customer tab. */}
        <Route path="/customers" element={
          <PrivateRoute><Layout><CustomerListPage /></Layout></PrivateRoute>
        } />
        <Route path="/customers/:id" element={
          <PrivateRoute><Layout><CustomerDetailPage /></Layout></PrivateRoute>
        } />

        {/* Default: send logged-in users to orders, others to login */}
          <Route path="*" element={
            pin ? <Navigate to="/orders" replace /> : <Navigate to="/login" replace />
          } />
        </Routes>
      </Suspense>
    </LanguageProvider>
    </ThemeProvider>
  );
}
