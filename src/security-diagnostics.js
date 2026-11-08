// @ts-check
/**
 * "Copy security diagnostics": what a JavaScript source block can reach from where it runs. The browser side collects the
 * `typeof` of the native bridge names in the page, in the sandbox page and in the sandbox's worker (src-browser/
 * security-diagnostics.js); this module turns those answers into a verdict and a report. It does no I/O.
 */

/** Names the Android shell (Capacitor) puts into a web view. None may be reachable from sandboxed code. */
export const BRIDGE_NAMES = [
  'CapacitorHttpAndroidInterface',
  'CapacitorCookiesAndroidInterface',
  'androidBridge',
  'Capacitor',
  'CapacitorCustomPlatform',
  'WEBVIEW_SERVER_URL',
];

/** Entry points reported for information (a worker's `fetch` is removed on purpose). */
export const ENTRY_NAMES = ['fetch', 'XMLHttpRequest', 'WebSocket', 'indexedDB', 'importScripts', 'localStorage', 'caches'];

/**
 * @typedef {{
 *   typeofs: Record<string, string>,
 *   extra?: string[],
 *   parentAccess?: string,
 * }} FrameProbe
 * `typeofs` maps a name to its typeof ('undefined', 'object', 'function', 'error SecurityError'); `extra` lists any global whose
 * name looks like a bridge (capacitor, android, bridge, native) that is not in BRIDGE_NAMES; `parentAccess` is what reading
 * the parent's document gave ('blocked' is the good answer).
 */

/**
 * @param {FrameProbe | null | undefined} probe
 * @param {string} where
 * @returns {string[]} what is reachable in that frame (empty is good)
 */
function reachable(probe, where) {
  /** @type {string[]} */
  const found = [];
  if (!probe) return found;
  for (const name of BRIDGE_NAMES) {
    const t = probe.typeofs[name];
    if (t !== undefined && t !== 'undefined') found.push(`${name} is ${t} in ${where}`);
  }
  for (const name of probe.extra || []) found.push(`${name} is present in ${where}`);
  if (probe.parentAccess !== undefined && probe.parentAccess !== 'blocked') found.push(`the parent page is ${probe.parentAccess} from ${where}`);
  return found;
}

/**
 * @param {{ page?: FrameProbe | null, worker?: FrameProbe | null }} results  what the sandbox page and its worker answered (null: no answer)
 * @returns {{ verdict: 'PASS' | 'FAIL' | 'UNKNOWN', line: string, problems: string[] }}
 */
export function securityVerdict(results) {
  const { page, worker } = results;
  if (!page || !worker) {
    const missing = [!page ? 'the sandbox page' : '', !worker ? "the sandbox's worker" : ''].filter(Boolean).join(' and ');
    return { verdict: 'UNKNOWN', line: `UNKNOWN: ${missing} did not answer`, problems: [] };
  }
  const problems = [...reachable(page, 'the sandbox page'), ...reachable(worker, "the sandbox's worker")];
  if (problems.length) return { verdict: 'FAIL', line: 'FAIL: ' + problems.join('; '), problems };
  return { verdict: 'PASS', line: 'PASS: no native bridge reachable from sandboxed code', problems };
}

/** @param {FrameProbe | null | undefined} probe */
function section(probe) {
  if (!probe) return ['  (no answer)'];
  /** @type {string[]} */
  const lines = [];
  for (const name of [...BRIDGE_NAMES, ...ENTRY_NAMES]) if (name in probe.typeofs) lines.push(`  ${name}: ${probe.typeofs[name]}`);
  if (probe.parentAccess !== undefined) lines.push(`  parent page: ${probe.parentAccess}`);
  if (probe.extra && probe.extra.length) lines.push(`  other names that look like a bridge: ${probe.extra.join(', ')}`);
  return lines;
}

/**
 * The text shown and copied: the verdict first.
 * @param {{ version: string, platform: string, userAgent: string, main: FrameProbe, page?: FrameProbe | null, worker?: FrameProbe | null }} r
 */
export function securityReport(r) {
  const v = securityVerdict({ page: r.page, worker: r.worker });
  return [
    v.line,
    '',
    `app: ${r.version}`,
    `platform: ${r.platform}`,
    `web view: ${r.userAgent}`,
    '',
    'main page (Capacitor and androidBridge are expected here):',
    ...section(r.main),
    '',
    'sandbox page (where the code runner lives):',
    ...section(r.page),
    '',
    "sandbox worker (where your code runs):",
    ...section(r.worker),
  ].join('\n');
}

/** The names whose spelling suggests a native bridge, for a probe to report beyond BRIDGE_NAMES.
 * @param {string[]} names
 */
export function bridgeLookingNames(names) {
  return names.filter((n) => /capacitor|android|bridge|webview|native/i.test(n) && !BRIDGE_NAMES.includes(n));
}
