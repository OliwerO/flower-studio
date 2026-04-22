// App.jsx — the routing map of the entire application.
// Think of it as a site plan: each route is a department, and React Router
// is the corridor that sends staff to the right room based on the URL.

import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuth } from './context/AuthContext.jsx';
import { LanguageProvider } from './context/LanguageContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { setClientPin } from './api/client.js';
import { useNotifications } from './hooks/useNotifications.js';

import LoginPage        from './pages/LoginPage.jsx';
import OrderListPage    from './pages/OrderListPage.jsx';
import OrderDetailPage  from './pages/OrderDetailPage.jsx';
import NewOrderPage     from './pages/NewOrderPage.jsx';
import PremadeBouquetCreatePage from './pages/PremadeBouquetCreatePage.jsx';
import StockPanelPage       from './pages/StockPanelPage.jsx';
import StockEvaluationPage  from './pages/StockEvaluationPage.jsx';
import SubstituteReconciliationPage from './pages/SubstituteReconciliationPage.jsx';
import DaySummaryPage          from './pages/DaySummaryPage.jsx';
import ShoppingSupportPage     from './pages/ShoppingSupportPage.jsx';
import PurchaseOrderPage       from './pages/PurchaseOrderPage.jsx';
import FloristHoursPage        from './pages/FloristHoursPage.jsx';
import BouquetsPage            from './pages/BouquetsPage.jsx';
import WasteLogPage            from './pages/WasteLogPage.jsx';
import CustomerListPage        from './pages/CustomerListPage.jsx';
import CustomerDetailPage      from './pages/CustomerDetailPage.jsx';
import Toast                   from './components/Toast.jsx';
import BottomNav               from './components/BottomNav.jsx';

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
    </LanguageProvider>
    </ThemeProvider>
  );
}
