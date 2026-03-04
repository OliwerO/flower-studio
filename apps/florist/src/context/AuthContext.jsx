// AuthContext — the "badge reader" system for the whole app.
// Stores the PIN and role in memory (clears on page refresh — intentional security choice).
// Any component can call useAuth() to get the PIN or trigger login/logout.

import { createContext, useContext, useReducer } from 'react';

const AuthContext = createContext(null);

const initialState = { pin: null, role: null };

function reducer(state, action) {
  switch (action.type) {
    case 'LOGIN':
      return { pin: action.pin, role: action.role };
    case 'LOGOUT':
      return initialState;
    default:
      return state;
  }
}

export function AuthProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  function login(pin, role) {
    dispatch({ type: 'LOGIN', pin, role });
  }

  function logout() {
    dispatch({ type: 'LOGOUT' });
  }

  return (
    <AuthContext.Provider value={{ ...state, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
