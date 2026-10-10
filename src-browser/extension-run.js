/**
 * The init script's sandbox: the same locked-down iframe and worker as source blocks (babel-run.js),
 * kept alive so the functions the script registers can be called again and again.
 */
import { startSandbox } from './babel-run.js';

/** Runs inside the worker. Serialised with toString(), so it must not use anything from this module. */
function extensionMain() {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const sexps = new Map();
  const commands = new Map();
  const handlers = new Map(); // event name -> [fn]
  let current = null; // the command being run: { document, edits, notices }
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
        notify(text) {
          if (current) {
            if (current.notices.length < 20) current.notices.push(String(text).slice(0, 500));
          } else log(String(text));
        },
        edit,
        get document() {
          return current ? current.document : null;
        },
      });
      const consoleShim = Object.freeze({ log, info: log, warn: log, error: log, debug: log });
      try {
        await new AsyncFunction('org', 'console', m.code)(org, consoleShim);
        self.postMessage({ type: 'init-done', ok: true, sexps: [...sexps.keys()], commands: [...commands].map(([id, c]) => ({ id, label: c.label })), events: [...handlers.keys()], logs });
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
export async function startExtension({ code, variables = {}, initTimeoutMs = 3000, callTimeoutMs = 3000, commandTimeoutMs = 5000, eventTimeoutMs = 2000 }) {
  const box = await startSandbox(extensionMain);
  if (!box.ok) return { ok: false, message: box.message, logs: [] };
  let nextId = 1;
  const waiting = new Map();
  let initWaiter = null;
  box.onMessage((m) => {
    if (m.type === 'init-done' && initWaiter) initWaiter(m);
    else if ((m.type === 'call-done' || m.type === 'command-done' || m.type === 'event-done') && waiting.has(m.id)) waiting.get(m.id)(m);
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

  /** One request to the worker, answered by its id. Past the timeout the sandbox is closed, so a script that hangs cannot stay running. */
  const request = (message, label, timeoutMs) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        waiting.delete(id);
        box.close();
        reject(new Error(`${label} took longer than ${timeoutMs / 1000} s, so the script was stopped`));
      }, timeoutMs);
      waiting.set(id, (m) => {
        clearTimeout(timer);
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
    logs: init.logs || [],
    close: box.close,
    call: (name, context, args, days) => request({ type: 'call', name, context, args, days }, name, callTimeoutMs),
    runCommand: (name, document) => request({ type: 'command', name, document }, name, commandTimeoutMs),
    runEvent: (name, document, payload) => request({ type: 'event', name, document, payload }, `the ${name} hook`, eventTimeoutMs),
  };
}
