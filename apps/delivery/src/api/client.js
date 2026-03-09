// Axios API client — same standardized "purchase order template" as the florist app.
// Every request gets the X-Auth-PIN header. 401 → redirect to login.

import axios from 'axios';

let _pin = null;

export function setClientPin(pin) {
  _pin = pin;
}

export function getClientPin() {
  return _pin;
}

const client = axios.create({
  baseURL: '/api',
});

client.interceptors.request.use((config) => {
  if (_pin) {
    config.headers['X-Auth-PIN'] = _pin;
  }
  return config;
});

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
