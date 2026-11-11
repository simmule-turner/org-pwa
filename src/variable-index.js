// @ts-check
/**
 * The index of every variable the app knows: the ones with a control in Settings, the ones with none (VARIABLE_CATALOG)
 * and any others the Global Variables or a file set. apropos-variable, the Settings search and the `elisp:` link all read it.
 */
import { VARIABLE_CATALOG } from './variable-catalog.js';

/** control: 'field' has a control on a Settings page, 'none' is set only from Global Variables or the Lisp init.
 * @typedef {{ name: string, doc: string, value: string, control: 'field' | 'none', section?: string, card?: string }} VariableEntry */

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
 * @param {{ key: string, label: string, section: string, default?: unknown, card?: string }[]} fields  the settings with a control
 * @param {Record<string, string>} set  the variables set in Global Variables and the open file
 * @returns {VariableEntry[]} sorted by name
 */
export function buildVariableIndex(fields, set) {
  /** @type {Map<string, VariableEntry>} */
  const byName = new Map();
  const valueOf = (/** @type {string} */ name, /** @type {string} */ unset) => (set[name] !== undefined ? printedValue(String(set[name])) : unset);
  for (const f of fields) byName.set(f.key, { name: f.key, doc: f.label, value: valueOf(f.key, printedDefault(f.default)), control: 'field', section: f.section, card: f.card });
  for (const c of VARIABLE_CATALOG) byName.set(c.name, { name: c.name, doc: c.doc, value: valueOf(c.name, c.default), control: 'none' });
  for (const [name, raw] of Object.entries(set)) if (!byName.has(name)) byName.set(name, { name, doc: '', value: printedValue(String(raw)), control: 'none' });
  return [...byName.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
