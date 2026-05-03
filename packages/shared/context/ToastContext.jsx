// ToastContext — a simple notification bus.
// Components call showToast('message', 'success'|'error') from anywhere.

import { createContext, useContext, useState, useCallback } from 'react';

// React-recommended pattern: provide a no-op default so consumers rendered
// outside a ToastProvider still get a callable `showToast`. Avoids needing
// try/catch around the hook in shared components that may end up in trees
// with or without a provider.
const NO_OP_TOAST = { toast: null, showToast: () => {}, dismiss: () => {} };

const ToastContext = createContext(NO_OP_TOAST);

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null); // { message, type }

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const dismiss = useCallback(() => setToast(null), []);

  return (
    <ToastContext.Provider value={{ toast, showToast, dismiss }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
