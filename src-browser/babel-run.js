/**
 * The JavaScript sandbox for source blocks.
 *
 * Each run gets a fresh hidden iframe and a Web Worker inside it:
 *
 *  - The iframe is `sandbox="allow-scripts"`, so it has an opaque origin: no access to
 *    the app's DOM, storage, cookies or tokens.
 *  - The iframe's Content-Security-Policy is `default-src 'none'`, so the code has no
 *    network at all (fetch, XHR, WebSocket, import() and importScripts are all refused),
 *    whatever it tries. The worker created from a blob URL inherits that policy.
 *  - The code runs in the worker, so a busy loop cannot freeze the page, and on timeout
 *    the iframe is removed, which stops the worker. It is not asked to stop.
 *
 * The code sees `org` (a small, versioned API), `console`, and its `:var` values. Nothing
 * else of the app is reachable from there.
 */

/** Runs first inside every worker. Belt and braces: the CSP already blocks the network; remove the entry points too. */
export function lockDown() {
  for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'BroadcastChannel', 'SharedWorker', 'Worker']) {
    try {
      Object.defineProperty(self, name, { value: undefined, configurable: false, writable: false });
    } catch (e) {
      /* not removable here; the CSP still applies */
    }
  }
}

/** Runs inside the worker. Serialised with toString(), so it must not use anything from
 *  this module. */
function workerMain() {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const show = (v) => {
    if (typeof v === 'string') return v;
    try {
      return typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
    } catch (e) {
      return String(v);
    }
  };
  const plain = (v) => {
    if (v === undefined || v === null || ['string', 'number', 'boolean'].includes(typeof v)) return v;
    if (typeof v === 'bigint') return String(v);
    if (v instanceof Date) return v.toISOString();
    if (v instanceof Set || v instanceof Map) return plain(Array.from(v));
    if (Array.isArray(v)) return v.map(plain);
    if (typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v)) out[k] = plain(v[k]);
      return out;
    }
    return String(v);
  };

  // Requests to the page (network, cache, position); the page decides.
  const waiting = new Map();
  let lastRid = 0;
  const rpc = (method, args) =>
    new Promise((resolve, reject) => {
      const rid = ++lastRid;
      waiting.set(rid, { resolve, reject });
      self.postMessage({ type: 'rpc', rid, method, args });
    });
  const services = {
    location: Object.freeze({ get: () => rpc('location.get', []) }),
    cache: Object.freeze({
      get: async (key, maxAgeMs) => {
          const r = await rpc('cache.get', [key, maxAgeMs === undefined ? null : maxAgeMs]);
          return r.found ? r.value : null;
        },
      set: async (key, value) => {
        await rpc('cache.set', [key, value]);
        return value;
      },
    }),
    fetch: async (url, options) => {
      const r = await rpc('fetch', [String(url), options === undefined ? null : JSON.parse(JSON.stringify(options))]);
      return Object.freeze({ status: r.status, ok: r.ok, url: r.url, text: async () => r.body, json: async () => JSON.parse(r.body) });
    },
  };

  self.onmessage = async (e) => {
    if (e.data.type === 'rpc-result') {
      const w = waiting.get(e.data.rid);
      waiting.delete(e.data.rid);
      if (w) (e.data.ok ? w.resolve(e.data.value) : w.reject(new Error(e.data.message)));
      return;
    }
    const { id, code, vars, variables, maxBytes } = e.data;
    const lines = [];
    const log = (...a) => lines.push(a.map(show).join(' '));
    const consoleShim = Object.freeze({ log, info: log, warn: log, error: log, debug: log });
    const org = Object.freeze({
      apiVersion: 1,
      vars: Object.freeze({ get: (name) => (Object.prototype.hasOwnProperty.call(variables, name) ? variables[name] : null) }),
      ...services,
    });
    try {
      const names = Object.keys(vars);
      for (const n of names) if (!/^[A-Za-z_$][\w$]*$/.test(n)) throw new Error('Not a usable variable name: ' + n);
      const fn = new AsyncFunction('org', 'console', ...names, code);
      const value = await fn(org, consoleShim, ...names.map((n) => vars[n]));
      const result = plain(value);
      const output = lines.join('\n');
      if (JSON.stringify(result === undefined ? null : result).length + output.length > maxBytes) {
        throw new Error('Result is larger than ' + Math.round(maxBytes / 1024) + ' KB');
      }
      self.postMessage({ type: 'result', id, ok: true, hasValue: value !== undefined, value: result, output });
    } catch (err) {
      const stack = String((err && err.stack) || '');
      const at = /<anonymous>:(\d+):\d+/.exec(stack);
      self.postMessage({ type: 'result', id, ok: false, message: String((err && err.message) || err), line: at ? Math.max(1, Number(at[1]) - 2) : null, output: lines.join('\n') });
    }
  };
}

/** Runs inside the iframe: starts the worker and relays messages with the page. */
function frameMain(workerSource) {
  let worker;
  try {
    worker = new Worker(URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' })));
  } catch (e) {
    parent.postMessage({ type: 'fatal', message: String(e && e.message ? e.message : e) }, '*');
    return;
  }
  worker.onmessage = (e) => parent.postMessage(e.data, '*');
  worker.onerror = (e) => parent.postMessage({ type: 'fatal', message: e.message || 'worker error' }, '*');
  addEventListener('message', (e) => {
    if (e.source === parent) worker.postMessage(e.data);
  });
  parent.postMessage({ type: 'ready' }, '*');
}

const POLICY = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:";

function frameDocument(main = workerMain) {
  const worker = `(${lockDown.toString()})();(${main.toString()})()`;
  const boot = `(${frameMain.toString()})(${JSON.stringify(worker).replace(/</g, '\\u003c')})`;
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${POLICY}"><script>${boot.replace(/<\/script/gi, '<\\/script')}</script>`;
}

export const DEFAULT_MAX_BYTES = 64 * 1024;
export const MAX_REQUESTS_PER_RUN = 30;
export const MAX_RUN_WITH_REQUESTS_MS = 60000;

/**
 * Answers the worker's requests (`{type:'rpc', rid, method, args}`) with `onRpc(method, args)`.
 * waiting() is how many are unanswered; the run's timer is not counted down meanwhile
 * (pausedMs() is the time spent waiting), up to MAX_RUN_WITH_REQUESTS_MS in all.
 */
export function createRpcHost(onRpc, post) {
  let count = 0;
  let pending = 0;
  let paused = 0;
  return {
    waiting: () => pending,
    pausedMs: () => paused,
    handle(m) {
      const reply = (r) => post({ type: 'rpc-result', rid: m.rid, ...r });
      if (!onRpc) return reply({ ok: false, message: 'Not available here' });
      if (++count > MAX_REQUESTS_PER_RUN) return reply({ ok: false, message: `Too many requests (${MAX_REQUESTS_PER_RUN} at most per run)` });
      pending++;
      const t0 = Date.now();
      Promise.resolve()
        .then(() => onRpc(m.method, m.args))
        .then(
          (value) => reply({ ok: true, value: value === undefined ? null : value }),
          (err) => reply({ ok: false, message: String((err && err.message) || err) }),
        )
        .finally(() => {
          pending--;
          paused += Date.now() - t0;
        });
    },
  };
}

/**
 * Runs `code` and resolves with one of:
 *  { ok: true, hasValue, value, output }
 *  { ok: false, message, line?, output?, timedOut? }
 * Never rejects.
 */
export function runJavaScript({ code, vars = {}, variables = {}, timeoutMs = 5000, maxBytes = DEFAULT_MAX_BYTES, startupMs = 4000, onRpc = null }) {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden;pointer-events:none';
    const id = Math.random().toString(36).slice(2);
    let timer = null;
    let done = false;
    const rpcs = createRpcHost(onRpc, (message) => frame.contentWindow && frame.contentWindow.postMessage(message, '*'));
    const arm = (delay) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const elapsed = Date.now() - startedAt;
        const active = elapsed - rpcs.pausedMs();
        if (elapsed < MAX_RUN_WITH_REQUESTS_MS && rpcs.waiting() > 0) arm(250);
        else if (elapsed < MAX_RUN_WITH_REQUESTS_MS && active < timeoutMs - 5) arm(timeoutMs - active);
        else finish({ ok: false, timedOut: true, message: `Timed out after ${Math.round(timeoutMs / 100) / 10} s` });
      }, delay);
    };
    let startedAt = 0;
    const finish = (outcome) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      removeEventListener('message', onMessage);
      frame.remove();
      resolve(outcome);
    };
    const onMessage = (e) => {
      if (e.source !== frame.contentWindow || !e.data) return;
      const m = e.data;
      if (m.type === 'ready') {
        startedAt = Date.now();
        arm(timeoutMs);
        frame.contentWindow.postMessage({ id, code, vars, variables, maxBytes }, '*');
      } else if (m.type === 'rpc') {
        rpcs.handle(m);
      } else if (m.type === 'fatal') {
        finish({ ok: false, message: 'The sandbox could not start: ' + m.message });
      } else if (m.type === 'result' && m.id === id) {
        finish(m.ok ? { ok: true, hasValue: m.hasValue, value: m.value, output: m.output } : { ok: false, message: m.message, line: m.line, output: m.output });
      }
    };
    addEventListener('message', onMessage);
    timer = setTimeout(() => finish({ ok: false, message: 'The sandbox did not start' }), startupMs);
    frame.srcdoc = frameDocument();
    document.body.appendChild(frame);
  });
}

/**
 * Starts a sandbox that stays alive, for code that is called more than once (the init script).
 * `main` is a function that runs inside the worker and talks through self.onmessage / self.postMessage;
 * it is serialised, so it must not use anything from the page's modules. Resolves with
 * { ok: true, send(message), onMessage(listener), close() }, or { ok: false, message }.
 */
export function startSandbox(main, { startupMs = 4000, onRpc = null } = {}) {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden;pointer-events:none';
    const listeners = new Set();
    const rpcs = createRpcHost(onRpc, (message) => frame.contentWindow && frame.contentWindow.postMessage(message, '*'));
    let settled = false;
    let closed = false;
    let timer = null;
    const close = () => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      removeEventListener('message', onMessage);
      frame.remove();
    };
    const settle = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!value.ok) close();
      resolve(value);
    };
    const onMessage = (e) => {
      if (e.source !== frame.contentWindow || !e.data) return;
      if (e.data.type === 'ready') {
        settle({
          ok: true,
          send: (message) => frame.contentWindow && frame.contentWindow.postMessage(message, '*'),
          onMessage: (listener) => listeners.add(listener),
          close,
          requestsWaiting: rpcs.waiting,
          requestsPausedMs: rpcs.pausedMs,
        });
      } else if (e.data.type === 'rpc') {
        rpcs.handle(e.data);
      } else if (e.data.type === 'fatal') {
        settle({ ok: false, message: 'The sandbox could not start: ' + e.data.message });
      } else {
        for (const listener of listeners) listener(e.data);
      }
    };
    addEventListener('message', onMessage);
    timer = setTimeout(() => settle({ ok: false, message: 'The sandbox did not start' }), startupMs);
    frame.srcdoc = frameDocument(main);
    document.body.appendChild(frame);
  });
}
