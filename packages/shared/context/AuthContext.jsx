import { createContext, useContext, useReducer } from 'react';

const AuthContext = createContext(null);

const initialState = { pin: null, role: null, driverName: null };

function reducer(state, action) {
  switch (action.type) {
    case 'LOGIN':
      return { pin: action.pin, role: action.role, driverName: action.driverName || null };
    case 'LOGOUT':
      return initialState;
    default:
      return state;
  }
}

export function AuthProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  function login(pin, role, driverName) {
    dispatch({ type: 'LOGIN', pin, role, driverName });
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
