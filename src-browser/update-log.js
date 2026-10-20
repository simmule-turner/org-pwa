// @ts-check
// A short trail of what happens when the app starts and when a new version arrives: the update check, the new worker
// installing and taking over, the Reload tap, the page restarting, the first screen, and any network request that was
// slow or failed. It is kept on this device (it has to survive the reload an update causes) and leaves it only when the
// person copies it ("Copy update and startup log" in the palette). Addresses are reduced to their host name.
import { APP_VERSION } from './version.js';

const KEY = 'org-pwa-update-log';
const LIMIT = 300;
const SLOW_FETCH_MS = 1500;
const bootAt = Date.now();
/** @type {{ loaded: { at: number, boot: number, what: string }[] | null, once: Set<string>, installed: boolean }} */
const state = { loaded: null, once: new Set(), installed: false };

/** @returns {{ at: number, boot: number, what: string }[]} */
function entries() {
  if (state.loaded) return state.loaded;
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    state.loaded = Array.isArray(parsed) ? parsed : [];
  } catch {
    state.loaded = [];
  }
  return state.loaded;
}

/**
 * @param {string} what
 * @param {Record<string, unknown>} [detail]
 */
export function noteUpdate(what, detail = {}) {
  const parts = Object.entries(detail).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`);
  const list = entries();
  list.push({ at: Date.now(), boot: bootAt, what: [what, ...parts].join(' ') });
  if (list.length > LIMIT) list.splice(0, list.length - LIMIT);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage may be unavailable (a private window, blocked site data): the trail then lasts for this page only.
  }
}

/** Notes `what` the first time only in this page's life.
 * @param {string} what
 * @param {Record<string, unknown>} [detail] */
export function noteUpdateOnce(what, detail) {
  if (state.once.has(what)) return;
  state.once.add(what);
  noteUpdate(what, detail);
}

/** Starts the page-wide marks: how this page started, whether it was shown or hidden, the network, and slow requests. */
export function installUpdateLog() {
  if (state.installed) return;
  state.installed = true;
  const nav = /** @type {PerformanceNavigationTiming | undefined} */ (performance.getEntriesByType('navigation')[0]);
  noteUpdate('page start', {
    version: APP_VERSION,
    controlled: !!navigator.serviceWorker?.controller,
    navType: nav ? nav.type : '?',
    responseEndMs: nav ? Math.round(nav.responseEnd) : '?',
    online: navigator.onLine,
  });
  document.addEventListener('visibilitychange', () => noteUpdate('page ' + document.visibilityState));
  window.addEventListener('pagehide', () => noteUpdate('pagehide'));
  window.addEventListener('pageshow', (e) => noteUpdate('pageshow', { fromCache: e.persisted }));
  window.addEventListener('online', () => noteUpdate('network online'));
  window.addEventListener('offline', () => noteUpdate('network offline'));
  if (typeof window.fetch === 'function') {
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const started = Date.now();
      const result = /** @type {Promise<Response>} */ (original(input, init));
      result.then(
        (response) => {
          const ms = Date.now() - started;
          if (ms >= SLOW_FETCH_MS || response.status >= 500) noteUpdate('slow request', { host: hostOf(input), status: response.status, ms });
        },
        (/** @type {{name?: string} | null} */ err) => noteUpdate('request failed', { host: hostOf(input), error: err && err.name ? err.name : 'error', ms: Date.now() - started })
      );
      return result;
    };
  }
}

/** @param {RequestInfo | URL} input */
function hostOf(input) {
  try {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return new URL(url, location.href).host;
  } catch {
    return '?';
  }
}

/** @param {number} ms */
function clock(ms) {
  const d = new Date(ms);
  const two = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

/** The whole trail as text, oldest first, each page start on its own line and each mark timed from it. */
export function updateLogText() {
  const conn = /** @type {{ effectiveType?: string, downlink?: number, rtt?: number } | undefined} */ (/** @type {{ connection?: unknown }} */ (navigator).connection);
  const head = [
    `version: ${APP_VERSION}`,
    `user agent: ${navigator.userAgent}`,
    `standalone: ${/** @type {{ standalone?: boolean }} */ (navigator).standalone === true || matchMedia('(display-mode: standalone)').matches}`,
    `online: ${navigator.onLine}; connection: ${conn ? `${conn.effectiveType || '?'} ${conn.downlink ?? '?'}Mbps rtt ${conn.rtt ?? '?'}ms` : 'unknown'}`,
    `worker controlling this page: ${!!navigator.serviceWorker?.controller}`,
    `time now: ${clock(Date.now())}`,
    '',
  ];
  const lines = [];
  let boot = -1;
  for (const e of entries()) {
    if (e.boot !== boot) {
      boot = e.boot;
      lines.push(`--- page started ${clock(e.boot)} ---`);
    }
    lines.push(`${clock(e.at)}  +${((e.at - e.boot) / 1000).toFixed(2)}s  ${e.what}`);
  }
  return [...head, ...(lines.length ? lines : ['(nothing recorded yet)'])].join('\n');
}
