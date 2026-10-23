// @ts-check
/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {import('./types.js').Doc} Doc */
/**
 * The variables that decide what a change of TODO state writes: `org-log-done`, `org-log-into-drawer` and `org-log-repeat`.
 * Each is read from the file's Local Variables block, then its `#+STARTUP:` words, then Global Variables, then Emacs's own
 * default; a heading's `LOG_INTO_DRAWER` and `LOGGING` properties (inherited) override them for that subtree.
 *
 *   #+STARTUP: logdone | lognotedone | nologdone
 *   #+STARTUP: logdrawer | nologdrawer
 *   #+STARTUP: logrepeat | lognoterepeat | nologrepeat
 */

/** @typedef {{ logDone: 'time' | 'note' | null, logIntoDrawer: string | null, logRepeat: 'time' | 'note' | null }} LogSettings */

/** What `#+STARTUP:` says for each variable: undefined when it does not mention it, 'none' for the words that turn it off.
 * @param {Doc} doc */
export function startupLogWords(doc) {
  /** @type {{ logDone?: string, logIntoDrawer?: string, logRepeat?: string }} */
  const out = {};
  for (const kw of doc.keywords || []) {
    if (kw.key.toUpperCase() !== 'STARTUP') continue;
    for (const word of kw.value.trim().split(/\s+/)) Object.assign(out, wordEffect(word));
  }
  return out;
}

/** @param {string} word @returns {{ logDone?: string, logIntoDrawer?: string, logRepeat?: string }} */
function wordEffect(word) {
  switch (word) {
    case 'logdone': return { logDone: 'time' };
    case 'lognotedone': return { logDone: 'note' };
    case 'nologdone': return { logDone: 'none' };
    case 'logdrawer': return { logIntoDrawer: 'LOGBOOK' };
    case 'nologdrawer': return { logIntoDrawer: 'none' };
    case 'logrepeat': return { logRepeat: 'time' };
    case 'lognoterepeat': return { logRepeat: 'note' };
    case 'nologrepeat': return { logRepeat: 'none' };
    default: return {};
  }
}

/** @param {unknown} raw @returns {string | undefined} */
const lispSymbol = (raw) => (raw === undefined || raw === null ? undefined : String(raw).trim().replace(/^'/, ''));

/** @param {unknown} raw a Lisp value for org-log-into-drawer: nil, t or a drawer name @returns {string | undefined} */
function drawerValue(raw) {
  const v = lispSymbol(raw);
  if (v === undefined || v === '') return undefined;
  if (v === 'nil') return 'none';
  if (v === 't') return 'LOGBOOK';
  return v.replace(/^"(.*)"$/, '$1');
}

/** @param {unknown} raw @returns {string | undefined} */
function repeatValue(raw) {
  const v = lispSymbol(raw);
  if (v === undefined) return undefined;
  if (v === 'nil') return 'none';
  if (v === 't' || v === 'time') return 'time';
  return v === 'note' ? 'note' : undefined;
}

/** @param {unknown} raw @returns {string | undefined} */
function doneValue(raw) {
  const v = lispSymbol(raw);
  if (v === undefined) return undefined;
  if (v === 'nil') return 'none';
  return v === 'time' || v === 'note' ? v : undefined;
}

/**
 * @param {Doc} doc
 * @param {Record<string, string>} [localVarsOnly] the file's own Local Variables
 * @param {Record<string, string>} [globalVarsOnly]
 * @param {Heading[]} [path] the headings from the top down to the one that changes, for LOG_INTO_DRAWER and LOGGING
 * @returns {LogSettings}
 */
export function readLogSettings(doc, localVarsOnly = {}, globalVarsOnly = {}, path = []) {
  const startup = startupLogWords(doc);
  const layers = (/** @type {(v: unknown) => string | undefined} */ read, /** @type {string} */ name, /** @type {string | undefined} */ fromStartup) =>
    read(localVarsOnly[name]) ?? fromStartup ?? read(globalVarsOnly[name]);
  let logDone = layers(doneValue, 'org-log-done', startup.logDone);
  let logIntoDrawer = layers(drawerValue, 'org-log-into-drawer', startup.logIntoDrawer);
  let logRepeat = layers(repeatValue, 'org-log-repeat', startup.logRepeat);

  // LOGGING: the nearest heading that has it, its words (logdone, nologrepeat, …) apply as #+STARTUP: words do
  const logging = nearestProperty(path, 'LOGGING');
  if (logging !== undefined) {
    if (logging.trim() === 'nil') {
      logDone = 'none';
      logRepeat = 'none';
    } else {
      for (const word of logging.trim().split(/\s+/)) {
        const e = wordEffect(word);
        if (e.logDone) logDone = e.logDone;
        if (e.logRepeat) logRepeat = e.logRepeat;
      }
    }
  }
  const own = nearestProperty(path, 'LOG_INTO_DRAWER');
  if (own !== undefined) logIntoDrawer = own === 'nil' ? 'none' : own === 't' ? 'LOGBOOK' : own;

  return {
    logDone: logDone === 'time' || logDone === 'note' ? logDone : null,
    logIntoDrawer: logIntoDrawer && logIntoDrawer !== 'none' ? logIntoDrawer : null,
    logRepeat: logRepeat === undefined ? 'time' : logRepeat === 'note' ? 'note' : logRepeat === 'none' ? null : 'time', // Emacs's default is `time`
  };
}

/** @param {Heading[]} path @param {string} name @returns {string | undefined} */
function nearestProperty(path, name) {
  for (let i = path.length - 1; i >= 0; i--) {
    const props = path[i].properties || {};
    const key = Object.keys(props).find((k) => k.toUpperCase() === name);
    if (key !== undefined) return props[key].trim();
  }
  return undefined;
}
