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

  self.onmessage = async (e) => {
    const { id, code, vars, variables, maxBytes } = e.data;
    const lines = [];
    const log = (...a) => lines.push(a.map(show).join(' '));
    const consoleShim = Object.freeze({ log, info: log, warn: log, error: log, debug: log });
    const org = Object.freeze({
      apiVersion: 1,
      vars: Object.freeze({ get: (name) => (Object.prototype.hasOwnProperty.call(variables, name) ? variables[name] : null) }),
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

/**
 * Runs `code` and resolves with one of:
 *  { ok: true, hasValue, value, output }
 *  { ok: false, message, line?, output?, timedOut? }
 * Never rejects.
 */
export function runJavaScript({ code, vars = {}, variables = {}, timeoutMs = 5000, maxBytes = DEFAULT_MAX_BYTES, startupMs = 4000 }) {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden;pointer-events:none';
    const id = Math.random().toString(36).slice(2);
    let timer = null;
    let done = false;
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
        clearTimeout(timer);
        timer = setTimeout(() => finish({ ok: false, timedOut: true, message: `Timed out after ${Math.round(timeoutMs / 100) / 10} s` }), timeoutMs);
        frame.contentWindow.postMessage({ id, code, vars, variables, maxBytes }, '*');
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
export function startSandbox(main, { startupMs = 4000 } = {}) {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden;pointer-events:none';
    const listeners = new Set();
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
        });
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
