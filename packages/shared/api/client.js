import axios from 'axios';

let _pin = null;
let clearCachedGetStore = null;

export function setClientPin(pin) {
  if (_pin !== pin) clearCachedGetStore?.();
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

const DEFAULT_GET_CACHE_TTL_MS = 15_000;

function stableSerialize(value) {
  if (value == null) return '';
  if (value instanceof URLSearchParams) {
    return stableSerialize(Object.fromEntries(value.entries()));
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(',')}]`;
  }
  if (typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${key}:${stableSerialize(value[key])}`).join(',')}}`;
  }
  return String(value);
}

export function createCachedGet(requestGet, { getScope = () => '', now = () => Date.now() } = {}) {
  const cache = new Map();
  const inFlight = new Map();

  function makeKey(url, config = {}, options = {}) {
    if (options.cacheKey) return `${getScope()}::${options.cacheKey}`;
    return [
      getScope(),
      url,
      stableSerialize(config.params),
    ].join('::');
  }

  function clear(prefix = '') {
    if (!prefix) {
      cache.clear();
      inFlight.clear();
      return;
    }
    for (const key of [...cache.keys()]) {
      if (key.includes(prefix)) cache.delete(key);
    }
    for (const key of [...inFlight.keys()]) {
      if (key.includes(prefix)) inFlight.delete(key);
    }
  }

  async function cachedGet(url, config = {}, options = {}) {
    const ttlMs = options.ttlMs ?? DEFAULT_GET_CACHE_TTL_MS;
    const key = makeKey(url, config, options);

    if (!options.force && ttlMs > 0) {
      const hit = cache.get(key);
      if (hit && hit.expiresAt > now()) return hit.response;
    }

    if (!options.force && inFlight.has(key)) return inFlight.get(key);

    const request = requestGet(url, config)
      .then(response => {
        if (ttlMs > 0) {
          cache.set(key, { response, expiresAt: now() + ttlMs });
        }
        return response;
      })
      .finally(() => {
        inFlight.delete(key);
      });

    inFlight.set(key, request);
    return request;
  }

  return { cachedGet, clear };
}

const cachedGetStore = createCachedGet(
  (url, config) => client.get(url, config),
  { getScope: () => _pin || '' },
);

clearCachedGetStore = cachedGetStore.clear;

export const cachedGet = cachedGetStore.cachedGet;
export const clearCachedGetCache = cachedGetStore.clear;

export default client;
