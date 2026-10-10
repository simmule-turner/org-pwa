/**
 * What scripts may ask of the network, the cache and the phone's position: the pure rules.
 * The sandbox itself has no network; a script's fetch is a request to the page, which checks
 * it here, asks the person once for the host, and only then sends it (src-browser/extension-services.js).
 */

export const MAX_URL_LENGTH = 2000;
export const MAX_BODY_BYTES = 100 * 1024;
export const MAX_RESPONSE_BYTES = 1024 * 1024;
export const MAX_CACHE_VALUE_CHARS = 200 * 1024;
export const MAX_CACHE_SCOPE_CHARS = 1024 * 1024;
export const MAX_CACHE_KEYS = 100;
export const FETCH_TIMEOUT_MS = 8000;

const ALLOWED_HEADERS = new Map([
  ['accept', 'Accept'],
  ['content-type', 'Content-Type'],
  ['authorization', 'Authorization'],
  ['x-api-key', 'X-Api-Key'],
]);

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** The host (with port when not the default) of a fetchable URL, or throws. https only; plain
 *  http only to this device (loopback), which is how the tests and local services work. */
export function checkFetchUrl(text) {
  const raw = String(text || '');
  if (raw.length > MAX_URL_LENGTH) throw new Error('The address is too long');
  let url;
  try {
    url = new URL(raw);
  } catch (e) {
    throw new Error('Not a usable address: ' + raw.slice(0, 80));
  }
  if (url.username || url.password) throw new Error('Addresses with a user name or password are not allowed');
  const loopback = LOOPBACK.has(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('Only https addresses can be fetched');
  return { url: url.href, host: url.hostname.toLowerCase(), hostPort: url.host.toLowerCase() };
}

/** `:net api.open-meteo.com *.example.org` -> ['api.open-meteo.com', '*.example.org']. */
export function parseNetHeader(value) {
  const hosts = [];
  for (const word of String(value || '').trim().toLowerCase().split(/[\s,]+/).filter(Boolean)) {
    if (word === 'no' || word === 'none' || word === 'nil') continue;
    if (!/^(\*\.)?[a-z0-9]([a-z0-9.-]*[a-z0-9])?$|^\[::1\]$/.test(word)) throw new Error(`:net ${word}: not a host name`);
    if (!hosts.includes(word)) hosts.push(word);
  }
  return hosts;
}

/** Whether `host` is covered by an allowed entry (`example.org`, or `*.example.org` for its subdomains). */
export function hostAllowed(host, allowed) {
  const h = String(host || '').toLowerCase();
  return (allowed || []).some((a) => (a.startsWith('*.') ? h.endsWith(a.slice(1)) && h.length > a.length - 1 : a === h));
}

/** `:location yes` -> true. */
export function parseLocationHeader(value) {
  return /^(yes|t|true|on)$/i.test(String(value || '').trim());
}

/** The options a script passes to fetch, reduced to what is allowed. Throws on anything else. */
export function normalizeFetchOptions(options) {
  const o = options && typeof options === 'object' ? options : {};
  const method = String(o.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'POST') throw new Error('Only GET and POST are allowed');
  const headers = {};
  for (const [name, value] of Object.entries(o.headers && typeof o.headers === 'object' ? o.headers : {})) {
    const canonical = ALLOWED_HEADERS.get(String(name).toLowerCase());
    if (!canonical) throw new Error(`The header ${name} is not allowed`);
    headers[canonical] = String(value).replace(/[\r\n]/g, ' ').slice(0, 2000);
  }
  let body;
  if (o.body !== undefined && o.body !== null) {
    if (method === 'GET') throw new Error('A GET request has no body');
    body = typeof o.body === 'string' ? o.body : JSON.stringify(o.body);
    if (body.length > MAX_BODY_BYTES) throw new Error('The request body is larger than 100 KB');
  }
  return { method, headers, body };
}

/** A cache key: short, plain text. */
export function checkCacheKey(key) {
  const k = String(key);
  if (!/^[\w.:/@+-]{1,100}$/.test(k)) throw new Error('A cache key is 1 to 100 letters, digits or . : / @ + - _');
  return k;
}

/** The text stored for a cache value (JSON), or throws when it is too big or not plain data. */
export function encodeCacheValue(value) {
  const text = JSON.stringify(value === undefined ? null : value);
  if (text === undefined) throw new Error('That value cannot be cached');
  if (text.length > MAX_CACHE_VALUE_CHARS) throw new Error('A cached value is limited to 200 KB');
  return text;
}

/** Puts `key` into a scope ({ key: { t, v } }), dropping the oldest entries to stay within the limits. */
export function cacheSet(scope, key, text, now) {
  const next = { ...scope, [key]: { t: now, v: text } };
  const size = () => Object.values(next).reduce((n, e) => n + e.v.length, 0);
  const oldest = () => Object.keys(next).filter((k) => k !== key).sort((a, b) => next[a].t - next[b].t)[0];
  while (Object.keys(next).length > MAX_CACHE_KEYS || size() > MAX_CACHE_SCOPE_CHARS) {
    const k = oldest();
    if (k === undefined) throw new Error('The cache is full');
    delete next[k];
  }
  return next;
}

/** The cached value (parsed) if present and not older than maxAgeMs, else null. */
export function cacheGet(scope, key, maxAgeMs, now) {
  const e = scope && scope[key];
  if (!e) return null;
  if (Number.isFinite(maxAgeMs) && maxAgeMs >= 0 && now - e.t > maxAgeMs) return null;
  try {
    return { value: JSON.parse(e.v) };
  } catch (err) {
    return null;
  }
}

/** The position handed to a script: rounded to about 10 m. */
export function roundPosition(coords, time) {
  const r = (n) => Math.round(Number(n) * 1e4) / 1e4;
  return { lat: r(coords.latitude), lon: r(coords.longitude), accuracy: Math.round(Number(coords.accuracy) || 0), time };
}

// ---- link types and export files -------------------------------------------

const RESERVED_LINK_PREFIXES = new Set(['http', 'https', 'file', 'mailto', 'tel', 'geo', 'doi', 'id', 'fn', 'github', 'webdav', 'local', 'attachment', 'ftp', 'javascript', 'data', 'blob', 'about', 'news', 'shell', 'elisp', 'info', 'help', 'docview', 'irc', 'mhe', 'rmail', 'gnus', 'bbdb', 'calc']);

/** A prefix a script may claim for its own links (`weather` in [[weather:nyc]]). */
export function usableLinkPrefix(prefix) {
  return typeof prefix === 'string' && /^[a-z][a-z0-9-]{1,19}$/.test(prefix) && !RESERVED_LINK_PREFIXES.has(prefix);
}

/** Where a custom link may lead: https, mail, phone or a map position. Anything else is refused. */
export function checkLinkOpenUrl(text) {
  const raw = String(text || '').trim();
  if (raw.length > MAX_URL_LENGTH) throw new Error('The link address is too long');
  let url;
  try {
    url = new URL(raw);
  } catch (e) {
    throw new Error('Not a usable link address: ' + raw.slice(0, 80));
  }
  if (!['https:', 'mailto:', 'tel:', 'geo:'].includes(url.protocol)) throw new Error('A link can lead to https, mailto, tel or geo addresses only');
  if (url.username || url.password) throw new Error('Addresses with a user name or password are not allowed');
  return url.href;
}

export const MAX_EXPORT_CHARS = 2 * 1024 * 1024;

/** What an export backend returns -> { text, filename, mime }. A string is the text; an object may name the file. */
export function normalizeExport(result, fallbackName) {
  const o = typeof result === 'string' ? { text: result } : result && typeof result === 'object' ? result : null;
  if (!o || typeof o.text !== 'string') throw new Error('An export backend returns text, or { text, filename, mime }');
  if (o.text.length > MAX_EXPORT_CHARS) throw new Error('The export is larger than 2 MB');
  const base = String(o.filename || fallbackName || 'export.txt').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').slice(0, 100) || 'export.txt';
  const mime = /^[a-z]+\/[\w.+-]+$/i.test(String(o.mime || '')) ? String(o.mime) : 'text/plain';
  return { text: o.text, filename: base, mime };
}
