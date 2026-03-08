// App.jsx — the routing map of the entire application.
// Think of it as a site plan: each route is a department, and React Router
// is the corridor that sends staff to the right room based on the URL.

import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuth } from './context/AuthContext.jsx';
import { setClientPin } from './api/client.js';
import { useNotifications } from './hooks/useNotifications.js';

import LoginPage        from './pages/LoginPage.jsx';
import OrderListPage    from './pages/OrderListPage.jsx';
import OrderDetailPage  from './pages/OrderDetailPage.jsx';
import NewOrderPage     from './pages/NewOrderPage.jsx';
import StockPanelPage   from './pages/StockPanelPage.jsx';
import Toast            from './components/Toast.jsx';

// PrivateRoute — like a badge-reader gate. Redirects to /login if no PIN in context.
function PrivateRoute({ children }) {
  const { pin } = useAuth();
  return pin ? children : <Navigate to="/login" replace />;
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
    <>
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

        {/* Default: send logged-in users to orders, others to login */}
        <Route path="*" element={
          pin ? <Navigate to="/orders" replace /> : <Navigate to="/login" replace />
        } />
      </Routes>
    </>
  );
}
