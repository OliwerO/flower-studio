import axios from 'axios';

let _pin = null;

export function setClientPin(pin) {
  _pin = pin;
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
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default client;
