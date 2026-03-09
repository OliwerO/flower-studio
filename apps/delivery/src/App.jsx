// App.jsx — routing map for the delivery app.
// Two rooms: /login (badge reader) and /deliveries (dispatch board).

import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuth } from './context/AuthContext.jsx';
import { setClientPin } from './api/client.js';
import { useNotifications } from './hooks/useNotifications.js';

import LoginPage        from './pages/LoginPage.jsx';
import DeliveryListPage from './pages/DeliveryListPage.jsx';
import Toast            from './components/Toast.jsx';

function PrivateRoute({ children }) {
  const { pin } = useAuth();
  return pin ? children : <Navigate to="/login" replace />;
}

export default function App() {
  const { pin } = useAuth();

  useEffect(() => {
    setClientPin(pin);
  }, [pin]);

  // Listen for SSE notifications only when logged in
  useNotifications(!!pin);

  return (
    <>
      <Toast />
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route path="/deliveries" element={
          <PrivateRoute><DeliveryListPage /></PrivateRoute>
        } />

        <Route path="*" element={
          pin ? <Navigate to="/deliveries" replace /> : <Navigate to="/login" replace />
        } />
      </Routes>
    </>
  );
}
