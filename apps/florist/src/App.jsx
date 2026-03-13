// App.jsx — the routing map of the entire application.
// Think of it as a site plan: each route is a department, and React Router
// is the corridor that sends staff to the right room based on the URL.

import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuth } from './context/AuthContext.jsx';
import { LanguageProvider } from './context/LanguageContext.jsx';
import { setClientPin } from './api/client.js';
import { useNotifications } from './hooks/useNotifications.js';

import LoginPage        from './pages/LoginPage.jsx';
import OrderListPage    from './pages/OrderListPage.jsx';
import OrderDetailPage  from './pages/OrderDetailPage.jsx';
import NewOrderPage     from './pages/NewOrderPage.jsx';
import StockPanelPage       from './pages/StockPanelPage.jsx';
import StockEvaluationPage  from './pages/StockEvaluationPage.jsx';
import DaySummaryPage          from './pages/DaySummaryPage.jsx';
import ShoppingSupportPage     from './pages/ShoppingSupportPage.jsx';
import Toast                   from './components/Toast.jsx';

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

// FloristRoute — blocks the owner, allows florist role only.
// Owner has her own pages for the same workflows (e.g. shopping support instead of evaluation).
function FloristRoute({ children }) {
  const { pin, role } = useAuth();
  if (!pin) return <Navigate to="/login" replace />;
  if (role === 'owner') return <Navigate to="/orders" replace />;
  return children;
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
    <LanguageProvider>
      <Toast />
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route path="/orders" element={
          <PrivateRoute><OrderListPage /></PrivateRoute>
        } />

        <Route path="/orders/new" element={
          <PrivateRoute><NewOrderPage /></PrivateRoute>
        } />

        <Route path="/orders/:id" element={
          <PrivateRoute><OrderDetailPage /></PrivateRoute>
        } />

        <Route path="/stock" element={
          <PrivateRoute><StockPanelPage /></PrivateRoute>
        } />

        <Route path="/stock-evaluation" element={
          <FloristRoute><StockEvaluationPage /></FloristRoute>
        } />

        <Route path="/shopping-support" element={
          <OwnerRoute><ShoppingSupportPage /></OwnerRoute>
        } />

        <Route path="/day-summary" element={
          <OwnerRoute><DaySummaryPage /></OwnerRoute>
        } />

        {/* Default: send logged-in users to orders, others to login */}
        <Route path="*" element={
          pin ? <Navigate to="/orders" replace /> : <Navigate to="/login" replace />
        } />
      </Routes>
    </LanguageProvider>
  );
}
