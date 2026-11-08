// @ts-check
// "Copy security diagnostics": checks, in this build on this device, what a JavaScript source block can reach. The page
// starts the same sandbox the code runner uses (src-browser/babel-run.js: same hidden iframe, same page, same locked-down
// worker), asks the sandbox page and its worker which native bridge names exist there, and shows the answer with a
// verdict first. OK copies the text. It reads and sends nothing but these `typeof` strings, and only to this page.
import { openTextFieldPopup } from './dialogs.js';
import { setStatus } from './editing.js';
import { platform } from './platform.js';
import { startSandbox } from './babel-run.js';
import { APP_VERSION } from './version.js';
import { BRIDGE_NAMES, ENTRY_NAMES, bridgeLookingNames, securityReport } from '../src/security-diagnostics.js';

/** Runs inside the sandbox worker (serialised with toString(), so it uses nothing from this module). */
function diagWorkerMain() {
  addEventListener('message', (/** @type {MessageEvent} */ e) => {
    const m = e.data;
    if (!m || m.type !== 'probe') return;
    /** @type {Record<string, string>} */
    const typeofs = {};
    const names = String(m.names || '').split(',');
    for (const n of names) {
      try {
        typeofs[n] = typeof (/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (self))[n]);
      } catch (err) {
        typeofs[n] = 'error ' + (err instanceof Error ? err.name : '');
      }
    }
    /** @type {string[]} */
    const extra = [];
    try {
      for (const n of Object.getOwnPropertyNames(self)) if (/capacitor|android|bridge|webview|native/i.test(n) && !names.includes(n)) extra.push(n);
    } catch (err) {
      /* the list is only a bonus */
    }
    self.postMessage({ type: 'probe-worker', nonce: m.nonce, probe: { typeofs, extra } });
  });
}

/** @param {string[]} names */
function probeMainPage(names) {
  /** @type {Record<string, string>} */
  const typeofs = {};
  for (const n of names) typeofs[n] = typeof (/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (window))[n]);
  return { typeofs, extra: bridgeLookingNames(Object.getOwnPropertyNames(window)) };
}

/**
 * Asks the sandbox page and its worker. Resolves with null for a part that did not answer in time.
 * @param {string[]} names
 * @param {number} timeoutMs
 */
export async function collectSandboxProbes(names, timeoutMs = 3000) {
  const sandbox = await startSandbox(diagWorkerMain, { startupMs: timeoutMs });
  if (!sandbox.ok) return { page: null, worker: null };
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
  /** @type {{ page: unknown, worker: unknown }} */
  const got = { page: null, worker: null };
  return new Promise((resolve) => {
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    const done = () => {
      clearTimeout(timer);
      sandbox.close();
      resolve(got);
    };
    sandbox.onMessage((/** @type {{ type?: string, nonce?: string, probe?: unknown }} */ m) => {
      if (!m || m.nonce !== nonce) return;
      if (m.type === 'probe-page') got.page = m.probe;
      else if (m.type === 'probe-worker') got.worker = m.probe;
      if (got.page && got.worker) done();
    });
    timer = setTimeout(done, timeoutMs);
    sandbox.send({ type: 'probe', nonce, names: names.join(',') });
  });
}

/** The report, as text. */
export async function securityDiagnosticsText() {
  const names = [...BRIDGE_NAMES, ...ENTRY_NAMES];
  const { page, worker } = await collectSandboxProbes(names);
  const cap = /** @type {{ getPlatform?: () => string } | undefined} */ (/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (window)).Capacitor);
  let platformName = 'web';
  try {
    platformName = (cap && cap.getPlatform && cap.getPlatform()) || 'web';
  } catch {
    /* keep web */
  }
  return securityReport({ version: APP_VERSION, platform: platformName, userAgent: navigator.userAgent, main: probeMainPage(names), page, worker });
}

/** The command: shows the report in a box whose OK copies it. */
export async function showSecurityDiagnostics() {
  setStatus('Checking the sandbox…');
  const text = await securityDiagnosticsText();
  openTextFieldPopup({
    label: 'Security diagnostics (OK copies it)',
    value: text,
    defaultValue: text,
    onSave: async (/** @type {string} */ edited) => {
      try {
        await platform.clipboard.writeText(edited);
        setStatus('Security diagnostics copied.');
      } catch {
        setStatus("Couldn't copy it: select the text in the box instead.");
      }
    },
  });
}
