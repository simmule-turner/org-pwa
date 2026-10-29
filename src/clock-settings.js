// @ts-check
/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {import('./types.js').Doc} Doc */
/** @typedef {import('./clock.js').ClockOptions} ClockOptions */
/**
 * The variables that decide how clocking writes to the file, read as `org-clock-into-drawer` and its neighbors are in Emacs:
 * the file's Local Variables, then Global Variables, then Emacs's own default. A heading's `CLOCK_INTO_DRAWER` property
 * (inherited) overrides `org-clock-into-drawer` for that subtree.
 *
 *   org-clock-into-drawer                    t (default) | nil | "NAME" | an integer
 *   org-clock-out-switch-to-state            nil (default) | "STATE"
 *   org-clock-out-remove-zero-time-clocks    nil (default) | t
 */
import { readLogSettings } from './log-settings.js';

/** The value of `org-clock-into-drawer` from Lisp text: t, nil, a quoted name or an integer; undefined when it is none of these.
 * @param {unknown} raw @returns {boolean | number | string | undefined} */
export function parseClockIntoDrawer(raw) {
  if (raw === undefined || raw === null) return undefined;
  const v = String(raw).trim();
  if (v === '') return undefined;
  if (v === 't') return true;
  if (v === 'nil') return false;
  if (/^\d+$/.test(v)) return Number(v);
  const quoted = /^"(.*)"$/.exec(v);
  return quoted ? quoted[1] : undefined;
}

/** `org-clock-out-switch-to-state` from Lisp text: a quoted keyword, else null.
 * @param {unknown} raw @returns {string | null} */
export function parseClockOutSwitchState(raw) {
  const quoted = /^"(.*)"$/.exec(String(raw ?? '').trim());
  return quoted && quoted[1] ? quoted[1] : null;
}

/** @param {Heading[]} path @returns {string | undefined} */
function clockIntoDrawerProperty(path) {
  for (let i = path.length - 1; i >= 0; i--) {
    const props = path[i].properties || {};
    const key = Object.keys(props).find((k) => k.toUpperCase() === 'CLOCK_INTO_DRAWER');
    if (key !== undefined) return props[key].trim();
  }
  return undefined;
}

/**
 * @param {Doc} doc
 * @param {Record<string, string>} [localVars] the file's own Local Variables
 * @param {Record<string, string>} [globalVars]
 * @param {Heading[]} [path] headings from the top down to the one being clocked
 * @returns {ClockOptions & { switchTo: string | null }}
 */
export function readClockSettings(doc, localVars = {}, globalVars = {}, path = []) {
  const variable = (/** @type {string} */ name) => localVars[name] ?? globalVars[name];
  const prop = clockIntoDrawerProperty(path);
  let into = parseClockIntoDrawer(variable('org-clock-into-drawer'));
  if (prop !== undefined) {
    // a property holds the bare text: nil, t, a number, or a drawer name taken as it stands
    const fromProp = prop === 'nil' ? false : prop === 't' ? true : /^\d+$/.test(prop) ? Number(prop) : prop;
    into = fromProp;
  }
  const log = readLogSettings(doc, localVars, globalVars, path);
  return {
    into: into === undefined ? true : into,
    logDrawer: log.logIntoDrawer,
    removeZero: /^t$/.test(String(variable('org-clock-out-remove-zero-time-clocks') ?? '').trim()),
    switchTo: parseClockOutSwitchState(variable('org-clock-out-switch-to-state')),
  };
}

/** The state `org-clock-out-switch-to-state` moves a clocked-out entry to: any entry whose state differs (a DONE one and one with no state too).
 * @param {Heading} heading @param {string | null} switchTo @returns {string | null} */
export function clockOutSwitchState(heading, switchTo) {
  return switchTo && heading.todo !== switchTo ? switchTo : null;
}
