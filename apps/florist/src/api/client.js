// Axios API client — like a standardized purchase order template.
// Every request automatically gets the X-Auth-PIN header injected.
// If the server returns 401 (PIN rejected), the user is sent back to login.

import axios from 'axios';

// We can't use useAuth() here (it's a hook, not a component),
// so we store a PIN reference that AuthContext updates via setClientPin().
let _pin = null;

export function setClientPin(pin) {
  _pin = pin;
}

const client = axios.create({
  baseURL: '/api',
});

// Request interceptor — stamps every outgoing "purchase order" with the PIN badge
client.interceptors.request.use((config) => {
  if (_pin) {
    config.headers['X-Auth-PIN'] = _pin;
  }
  return config;
});

// Response interceptor — if badge is rejected, clear PIN so user re-authenticates
client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      _pin = null;
      console.error('Authentication failed — PIN rejected');
    }
    return Promise.reject(error);
  }
);

export default client;
