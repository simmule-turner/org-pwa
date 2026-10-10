/**
 * The init script's sandbox: the same locked-down iframe and worker as source blocks (babel-run.js),
 * kept alive so the functions the script registers can be called again and again.
 */
import { startSandbox } from './babel-run.js';

/** Runs inside the worker. Serialised with toString(), so it must not use anything from this module. */
function extensionMain() {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const sexps = new Map();
  const logs = [];
  const show = (v) => {
    if (typeof v === 'string') return v;
    try {
      return typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
    } catch (e) {
      return String(v);
    }
  };
  const log = (...a) => {
    if (logs.length < 50) logs.push(a.map(show).join(' ').slice(0, 500));
  };
  const plain = (v) => (v === true || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)) ? v : null);
  const dayParts = (key) => {
    const [y, m, d] = key.split('-').map(Number);
    return { date: key, year: y, month: m, day: d, weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
  };

  self.onmessage = async (e) => {
    const m = e.data;
    if (m.type === 'init') {
      const org = Object.freeze({
        apiVersion: 1,
        vars: Object.freeze({ get: (name) => (Object.prototype.hasOwnProperty.call(m.variables, name) ? m.variables[name] : null) }),
        sexp(name, fn) {
          if (typeof name !== 'string' || typeof fn !== 'function') throw new TypeError('org.sexp(name, function) expects a name and a function');
          sexps.set(name, fn);
        },
      });
      const consoleShim = Object.freeze({ log, info: log, warn: log, error: log, debug: log });
      try {
        await new AsyncFunction('org', 'console', m.code)(org, consoleShim);
        self.postMessage({ type: 'init-done', ok: true, sexps: [...sexps.keys()], logs });
      } catch (err) {
        self.postMessage({ type: 'init-done', ok: false, message: String((err && err.message) || err), logs });
      }
    } else if (m.type === 'call') {
      const fn = sexps.get(m.name);
      const results = [];
      let error = null;
      for (const key of m.days) {
        try {
          if (!fn) throw new Error('no function named ' + m.name);
          results.push(plain(await fn({ ...m.context, ...dayParts(key) }, ...m.args)));
        } catch (err) {
          results.push(null);
          error = error || String((err && err.message) || err);
        }
      }
      self.postMessage({ type: 'call-done', id: m.id, results, error, logs: logs.splice(0) });
    }
  };
}

/**
 * Starts the init script. Resolves with { ok: true, sexps, logs, call(name, context, args, days), close() }
 * or { ok: false, message, logs }. A call that takes longer than `callTimeoutMs` closes the sandbox and
 * rejects, so a script that hangs cannot stay running.
 */
export async function startExtension({ code, variables = {}, initTimeoutMs = 3000, callTimeoutMs = 3000 }) {
  const box = await startSandbox(extensionMain);
  if (!box.ok) return { ok: false, message: box.message, logs: [] };
  let nextId = 1;
  const waiting = new Map();
  let initWaiter = null;
  box.onMessage((m) => {
    if (m.type === 'init-done' && initWaiter) initWaiter(m);
    else if (m.type === 'call-done' && waiting.has(m.id)) waiting.get(m.id)(m);
  });

  const init = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, message: `The script took longer than ${initTimeoutMs / 1000} s to start`, logs: [] }), initTimeoutMs);
    initWaiter = (m) => {
      clearTimeout(timer);
      resolve(m);
    };
    box.send({ type: 'init', code, variables });
  });
  if (!init.ok) {
    box.close();
    return { ok: false, message: init.message, logs: init.logs || [] };
  }

  return {
    ok: true,
    sexps: init.sexps,
    logs: init.logs || [],
    close: box.close,
    call(name, context, args, days) {
      return new Promise((resolve, reject) => {
        const id = nextId++;
        const timer = setTimeout(() => {
          waiting.delete(id);
          box.close();
          reject(new Error(`${name} took longer than ${callTimeoutMs / 1000} s, so the script was stopped`));
        }, callTimeoutMs);
        waiting.set(id, (m) => {
          clearTimeout(timer);
          waiting.delete(id);
          resolve(m);
        });
        box.send({ type: 'call', id, name, context, args, days });
      });
    },
  };
}
