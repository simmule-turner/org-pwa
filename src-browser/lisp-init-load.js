// @ts-check
// The Lisp init text (org-xx-lisp-init, Settings → Advanced): applied at once without its (load ...) forms, then again with their files
// read in. A file that is read is kept on the device, so a later start-up without a connection still has it. The Agenda's refresh
// button reads the files again.
import { expandLoads, findLoads } from '../src/lisp-load.js';
import { applyHolidayVariables } from '../src/holidays.js';
import { parseGlobalVariables } from '../src/global-variables.js';
import { settingsFromInit } from './lisp-settings.js';
import { S } from './app-state.js';
import { lispStringValue } from '../src/export-defaults.js';
import { readSpec } from './diary-file-load.js';
import { setStatus } from './editing.js';
import { render } from './render.js';
import { kv } from './singletons.js';

const CACHE_PREFIX = 'org-xx-lisp-load:';
const latest = { generation: 0 };

/** The settings the Lisp init sets right now (their boxes are read-only), and the errors its forms gave. */
export const lispSettings = { keys: /** @type {Set<string>} */ (new Set()), errors: /** @type {string[]} */ ([]) };

const hooks = { afterSettingsChange: /** @type {(() => void) | null} */ (null) };
/** Registers what to redo when the init's settings change after a file it loads has been read. @param {() => void} fn */
export function onLispSettingsChange(fn) {
  hooks.afterSettingsChange = fn;
}

/**
 * Puts the settings the init sets over `vars` (the saved settings) and remembers which they are. Returns true when that changed anything.
 * @param {Record<string, string> | null | undefined} vars @param {string} text  the init text
 */
function layerSettings(vars, text) {
  if (!vars) return false;
  const saved = parseGlobalVariables(S.globalVariablesText || '');
  const { values, errors } = settingsFromInit(text, saved);
  const keys = new Set(Object.keys(values));
  const same = keys.size === lispSettings.keys.size && [...keys].every((k) => lispSettings.keys.has(k)) && Object.entries(values).every(([k, v]) => vars[k] === v);
  for (const k of lispSettings.keys) if (!keys.has(k)) {
    if (saved[k] === undefined) delete vars[k];
    else vars[k] = saved[k];
  }
  Object.assign(vars, values);
  lispSettings.keys = keys;
  lispSettings.errors = errors;
  return !same;
}

/** @param {string} key */
async function cached(key) {
  try {
    const result = /** @type {unknown} */ (await kv.get(CACHE_PREFIX + key));
    const raw = result && typeof result === 'object' && 'value' in result ? /** @type {{value: unknown}} */ (result).value : result;
    return typeof raw === 'string' ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Applies the init text of `vars`. With load forms in it, the files are read in the background and the result applied when they arrive.
 * @param {Record<string, string> | null | undefined} vars
 * @param {{ prompt?: boolean, say?: boolean }} [options]  prompt: a local file may ask for its permission; say: report what was loaded
 */
export function applyLispInit(vars, { prompt = false, say = false } = {}) {
  const raw = (vars || {})['org-xx-lisp-init'];
  const text = lispStringValue(raw) || raw || '';
  const loads = findLoads(text);
  const mine = ++latest.generation;
  if (!loads.length) {
    layerSettings(vars, text);
    applyHolidayVariables(vars);
    if (say && lispSettings.errors.length) setStatus(lispSettings.errors[0]);
    return;
  }
  // at once: the files as they were last read on this device, if any; then the files as they are now
  expandLoads(text, async (spec) => {
    const old = await cached(spec);
    if (old === null) throw new Error('not read yet');
    return old;
  }).then(({ text: first }) => {
    if (mine !== latest.generation) return;
    const changed = layerSettings(vars, first);
    applyHolidayVariables({ ...vars, 'org-xx-lisp-init': first });
    if (changed && hooks.afterSettingsChange) hooks.afterSettingsChange();
  });
  expandLoads(text, async (spec) => {
    try {
      const body = await readSpec(spec, prompt);
      await kv.set(CACHE_PREFIX + spec, JSON.stringify(body));
      return body;
    } catch (err) {
      const old = await cached(spec);
      if (old === null) throw err;
      return old;
    }
  }).then(({ text: full, errors, specs }) => {
    if (mine !== latest.generation) return;
    const changed = layerSettings(vars, full);
    applyHolidayVariables({ ...vars, 'org-xx-lisp-init': full });
    if (changed && hooks.afterSettingsChange) hooks.afterSettingsChange();
    if (errors.length || lispSettings.errors.length) setStatus([...errors, ...lispSettings.errors].join(' '));
    else if (say) setStatus(`Loaded ${specs.join(', ')}.`);
    render();
  });
}
