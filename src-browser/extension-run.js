/**
 * The init script's sandbox: the same locked-down iframe and worker as source blocks (babel-run.js),
 * kept alive so the functions the script registers can be called again and again.
 */
import { MAX_RUN_WITH_REQUESTS_MS, startSandbox } from './babel-run.js';

/** Runs inside the worker. Serialised with toString(), so it must not use anything from this module. */
function extensionMain() {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const sexps = new Map();
  const commands = new Map();
  const handlers = new Map(); // event name -> [fn]
  const tableFns = new Map();
  const agendaSources = new Map();
  const uiLines = new Map();
  const linkTypes = new Map();
  const exporters = new Map();
  let current = null; // the command being run: { document, edits, notices }
  const logs = [];
  const waiting = new Map();
  let lastRid = 0;
  const rpc = (method, args) =>
    new Promise((resolve, reject) => {
      const rid = ++lastRid;
      waiting.set(rid, { resolve, reject });
      self.postMessage({ type: 'rpc', rid, method, args });
    });
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
    if (m.type === 'rpc-result') {
      const w = waiting.get(m.rid);
      waiting.delete(m.rid);
      if (w) (m.ok ? w.resolve(m.value) : w.reject(new Error(m.message)));
    } else if (m.type === 'init') {
      const pushEdit = (op) => {
        if (!current) throw new Error('org.edit can only be used while a command is running');
        if (current.edits.length >= 500) throw new Error('too many edits in one command (500 at most)');
        current.edits.push(JSON.parse(JSON.stringify(op)));
      };
      const edit = Object.assign((op) => pushEdit(op), {
        setTitle: (heading, title) => pushEdit({ op: 'set-title', heading, title }),
        setTodo: (heading, todo) => pushEdit({ op: 'set-todo', heading, todo }),
        setTags: (heading, tags) => pushEdit({ op: 'set-tags', heading, tags }),
        setProperty: (heading, name, value) => pushEdit({ op: 'set-property', heading, name, value }),
        deleteProperty: (heading, name) => pushEdit({ op: 'delete-property', heading, name }),
        appendBody: (heading, text) => pushEdit({ op: 'append-body', heading, text }),
      });
      const org = Object.freeze({
        apiVersion: 1,
        vars: Object.freeze({ get: (name) => (Object.prototype.hasOwnProperty.call(m.variables, name) ? m.variables[name] : null) }),
        sexp(name, fn) {
          if (typeof name !== 'string' || typeof fn !== 'function') throw new TypeError('org.sexp(name, function) expects a name and a function');
          sexps.set(name, fn);
        },
        command(id, label, fn) {
          if (typeof id !== 'string' || !/^[A-Za-z][A-Za-z0-9-]*$/.test(id) || typeof label !== 'string' || !label.trim() || typeof fn !== 'function') {
            throw new TypeError('org.command(id, label, function): the id is letters, digits and dashes');
          }
          commands.set(id, { label: label.trim().slice(0, 80), fn });
        },
        on(event, fn) {
          if (!['open', 'save', 'todo-change', 'capture'].includes(event) || typeof fn !== 'function') {
            throw new TypeError('org.on(event, function): the events are open, save, todo-change and capture');
          }
          if (!handlers.has(event)) handlers.set(event, []);
          handlers.get(event).push(fn);
        },
        tableFunction(name, fn) {
          if (typeof name !== 'string' || typeof fn !== 'function') throw new TypeError('org.tableFunction(name, function) expects a name and a function');
          tableFns.set(name, fn);
        },
        linkType(prefix, fn) {
          if (typeof prefix !== 'string' || typeof fn !== 'function') throw new TypeError('org.linkType(prefix, function) expects a prefix and a function');
          linkTypes.set(prefix, fn);
        },
        exportBackend(id, label, fn) {
          if (typeof id !== 'string' || !/^[A-Za-z][A-Za-z0-9-]*$/.test(id) || typeof label !== 'string' || !label.trim() || typeof fn !== 'function') {
            throw new TypeError('org.exportBackend(id, label, function): the id is letters, digits and dashes');
          }
          exporters.set(id, { label: label.trim().slice(0, 80), fn });
        },
        notify(text) {
          if (current) {
            if (current.notices.length < 20) current.notices.push(String(text).slice(0, 500));
          } else log(String(text));
        },
        edit,
        ics: Object.freeze({ parse: async (text) => rpc('ics.parse', [text]) }),
        agenda: Object.freeze({
          source(name, fn) {
            if (typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9-]*$/.test(name) || typeof fn !== 'function') throw new TypeError('org.agenda.source(name, function): the name is letters, digits and dashes');
            agendaSources.set(name, fn);
          },
        }),
        ui: Object.freeze({
          line(id, fn) {
            if (typeof id !== 'string' || !/^[A-Za-z][A-Za-z0-9-]*$/.test(id) || typeof fn !== 'function') throw new TypeError('org.ui.line(id, function): the id is letters, digits and dashes');
            uiLines.set(id, fn);
          },
        }),
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
        get document() {
          return current ? current.document : null;
        },
      });
      const consoleShim = Object.freeze({ log, info: log, warn: log, error: log, debug: log });
      try {
        await new AsyncFunction('org', 'console', m.code)(org, consoleShim);
        self.postMessage({ type: 'init-done', ok: true, sexps: [...sexps.keys()], commands: [...commands].map(([id, c]) => ({ id, label: c.label })), events: [...handlers.keys()], tableFunctions: [...tableFns.keys()], linkTypes: [...linkTypes.keys()], exporters: [...exporters].map(([id, x]) => ({ id, label: x.label })), agendaSources: [...agendaSources.keys()], uiLines: [...uiLines.keys()], logs });
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
    } else if (m.type === 'table') {
      const fn = tableFns.get(m.name);
      const results = [];
      let error = null;
      for (const args of m.calls) {
        try {
          if (!fn) throw new Error('no function named ' + m.name);
          const v = await fn(...args);
          results.push(typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)) ? v : null);
        } catch (err) {
          results.push(null);
          error = error || String((err && err.message) || err);
        }
      }
      self.postMessage({ type: 'table-done', id: m.id, results, error, logs: logs.splice(0) });
    } else if (m.type === 'agenda') {
      const fn = agendaSources.get(m.name);
      let items = null;
      let error = null;
      try {
        if (!fn) throw new Error('no agenda source named ' + m.name);
        const v = await fn({ from: m.from, to: m.to });
        items = Array.isArray(v) ? JSON.parse(JSON.stringify(v.slice(0, 2000))) : [];
      } catch (err) {
        error = String((err && err.message) || err);
      }
      self.postMessage({ type: 'agenda-done', id: m.id, items, error, logs: logs.splice(0) });
    } else if (m.type === 'line') {
      const fn = uiLines.get(m.name);
      let text = null;
      let error = null;
      try {
        if (!fn) throw new Error('no line named ' + m.name);
        const v = await fn();
        text = typeof v === 'string' || typeof v === 'number' ? String(v) : null;
      } catch (err) {
        error = String((err && err.message) || err);
      }
      self.postMessage({ type: 'line-done', id: m.id, text, error, logs: logs.splice(0) });
    } else if (m.type === 'link') {
      const fn = linkTypes.get(m.prefix);
      let url = null;
      let error = null;
      try {
        if (!fn) throw new Error('no link type named ' + m.prefix);
        const v = await fn(m.path, { target: m.target, description: m.description });
        url = typeof v === 'string' ? v : null;
      } catch (err) {
        error = String((err && err.message) || err);
      }
      self.postMessage({ type: 'link-done', id: m.id, url, error, logs: logs.splice(0) });
    } else if (m.type === 'export') {
      const ex = exporters.get(m.name);
      current = { document: m.document, edits: [], notices: [] };
      let output = null;
      let error = null;
      try {
        if (!ex) throw new Error('no export backend named ' + m.name);
        const v = await ex.fn({ name: m.document.name, document: m.document });
        output = typeof v === 'string' ? { text: v } : v && typeof v === 'object' ? { text: v.text, filename: v.filename, mime: v.mime } : null;
      } catch (err) {
        error = String((err && err.message) || err);
      }
      current = null;
      self.postMessage({ type: 'export-done', id: m.id, output, error, logs: logs.splice(0) });
    } else if (m.type === 'event') {
      current = { document: m.document, edits: [], notices: [] };
      let error = null;
      try {
        const heading = m.document.focused === null ? null : m.document.headings[m.document.focused];
        for (const fn of handlers.get(m.name) || []) await fn({ event: m.name, name: m.document.name, focused: m.document.focused, heading, ...m.payload });
      } catch (err) {
        error = String((err && err.message) || err);
      }
      const done = current;
      current = null;
      self.postMessage({ type: 'event-done', id: m.id, edits: error ? [] : done.edits, notices: done.notices, error, logs: logs.splice(0) });
    } else if (m.type === 'command') {
      const command = commands.get(m.name);
      current = { document: m.document, edits: [], notices: [] };
      let error = null;
      let message = null;
      try {
        if (!command) throw new Error('no command named ' + m.name);
        const heading = m.document.focused === null ? null : m.document.headings[m.document.focused];
        const answer = await command.fn({ name: m.document.name, focused: m.document.focused, heading });
        if (typeof answer === 'string') message = answer.slice(0, 500);
      } catch (err) {
        error = String((err && err.message) || err);
      }
      const done = current;
      current = null;
      self.postMessage({ type: 'command-done', id: m.id, edits: error ? [] : done.edits, notices: done.notices, message, error, logs: logs.splice(0) });
    }
  };
}

/**
 * Starts the init script. Resolves with { ok: true, sexps, logs, call(name, context, args, days), close() }
 * or { ok: false, message, logs }. A call that takes longer than `callTimeoutMs` closes the sandbox and
 * rejects, so a script that hangs cannot stay running.
 */
export async function startExtension({ code, variables = {}, onRpc = null, initTimeoutMs = 3000, callTimeoutMs = 3000, commandTimeoutMs = 5000, eventTimeoutMs = 2000 }) {
  const box = await startSandbox(extensionMain, { onRpc });
  if (!box.ok) return { ok: false, message: box.message, logs: [] };
  let nextId = 1;
  const waiting = new Map();
  let initWaiter = null;
  box.onMessage((m) => {
    if (m.type === 'init-done' && initWaiter) initWaiter(m);
    else if (['call-done', 'command-done', 'event-done', 'table-done', 'link-done', 'export-done', 'agenda-done', 'line-done'].includes(m.type) && waiting.has(m.id)) waiting.get(m.id)(m);
  });

  /** A timer that does not run while the script waits for the page (network, position), up to a hard limit. */
  const deadline = (timeoutMs, onTimeout) => {
    const started = Date.now();
    let timer = null;
    const arm = (delay) => {
      timer = setTimeout(() => {
        const elapsed = Date.now() - started;
        const active = elapsed - box.requestsPausedMs();
        if (elapsed < MAX_RUN_WITH_REQUESTS_MS && box.requestsWaiting() > 0) arm(250);
        else if (elapsed < MAX_RUN_WITH_REQUESTS_MS && active < timeoutMs - 5) arm(timeoutMs - active);
        else onTimeout();
      }, delay);
    };
    arm(timeoutMs);
    return () => clearTimeout(timer);
  };

  const init = await new Promise((resolve) => {
    const stop = deadline(initTimeoutMs, () => resolve({ ok: false, message: `The script took longer than ${initTimeoutMs / 1000} s to start`, logs: [] }));
    initWaiter = (m) => {
      stop();
      resolve(m);
    };
    box.send({ type: 'init', code, variables });
  });
  if (!init.ok) {
    box.close();
    return { ok: false, message: init.message, logs: init.logs || [] };
  }

  /** One request to the worker, answered by its id. Past the timeout the sandbox is closed, so a script that hangs cannot stay running. */
  const request = (message, label, timeoutMs) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const stop = deadline(timeoutMs, () => {
        waiting.delete(id);
        box.close();
        reject(new Error(`${label} took longer than ${timeoutMs / 1000} s, so the script was stopped`));
      });
      waiting.set(id, (m) => {
        stop();
        waiting.delete(id);
        resolve(m);
      });
      box.send({ ...message, id });
    });

  return {
    ok: true,
    sexps: init.sexps,
    commands: init.commands || [],
    events: init.events || [],
    tableFunctions: init.tableFunctions || [],
    agendaSources: init.agendaSources || [],
    uiLines: init.uiLines || [],
    linkTypes: init.linkTypes || [],
    exporters: init.exporters || [],
    logs: init.logs || [],
    close: box.close,
    call: (name, context, args, days) => request({ type: 'call', name, context, args, days }, name, callTimeoutMs),
    runCommand: (name, document) => request({ type: 'command', name, document }, name, commandTimeoutMs),
    fetchAgenda: (name, from, to) => request({ type: 'agenda', name, from, to }, `the ${name} agenda source`, 8000),
    fetchLine: (name) => request({ type: 'line', name }, `the ${name} line`, 8000),
    callTable: (name, calls) => request({ type: 'table', name, calls }, name, callTimeoutMs),
    resolveLink: (prefix, path, target, description) => request({ type: 'link', prefix, path, target, description }, `the ${prefix} link`, callTimeoutMs),
    runExport: (name, document) => request({ type: 'export', name, document }, `the ${name} export`, commandTimeoutMs),
    runEvent: (name, document, payload) => request({ type: 'event', name, document, payload }, `the ${name} hook`, eventTimeoutMs),
  };
}
