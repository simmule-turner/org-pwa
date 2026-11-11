// @ts-check
/**
 * The index of every variable the app knows: the ones with a control in Settings (shown or hidden), the ones with none (VARIABLE_CATALOG)
 * and any others the Global Variables or a file set. apropos-variable, the Settings search and the `elisp:` link all read it.
 */
import { VARIABLE_CATALOG } from './variable-catalog.js';

/** control: 'field' has a control on a Settings page, 'hidden' has a setting that no page shows, 'none' is set only from Global Variables.
 * @typedef {{ name: string, doc: string, value: string, control: 'field' | 'hidden' | 'none', section?: string }} VariableEntry */

/** A value as Emacs prints it: `'time` is the symbol `time`. @param {string} raw */
export function printedValue(raw) {
  return raw.replace(/^'/, '');
}

/** @param {unknown} value @returns {string} */
function printedDefault(value) {
  if (value === undefined || value === null || value === '') return 'nil';
  if (typeof value === 'boolean') return value ? 't' : 'nil';
  return String(value);
}

/**
 * @param {{ key: string, label: string, section: string, default?: unknown, hidden?: boolean }[]} fields  the settings with a field
 * @param {Record<string, string>} set  the variables set in Global Variables and the open file
 * @returns {VariableEntry[]} sorted by name
 */
export function buildVariableIndex(fields, set) {
  /** @type {Map<string, VariableEntry>} */
  const byName = new Map();
  const shown = (/** @type {string} */ name, /** @type {string} */ fallback) => (set[name] !== undefined ? printedValue(String(set[name])) : fallback);
  for (const f of fields) byName.set(f.key, { name: f.key, doc: f.label, value: shown(f.key, printedDefault(f.default)), control: f.hidden ? 'hidden' : 'field', section: f.section });
  for (const c of VARIABLE_CATALOG) if (!byName.has(c.name)) byName.set(c.name, { name: c.name, doc: c.doc, value: shown(c.name, c.default), control: 'none' });
  for (const [name, raw] of Object.entries(set)) if (!byName.has(name)) byName.set(name, { name, doc: '', value: printedValue(String(raw)), control: 'none' });
  return [...byName.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
