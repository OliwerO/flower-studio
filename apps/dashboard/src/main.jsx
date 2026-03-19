import React from 'react';
import ReactDOM from 'react-dom/client';
import { ToastProvider } from './context/ToastContext.jsx';
import { ErrorBoundary } from '@flower-studio/shared';
import App from './App.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <App />
      </ToastProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
