// @ts-check
/**
 * Emacs mode, the keys: Emacs's default keymap for the commands of src/emacs-edit.js, and the input state that reads key sequences
 * (C-x and ESC prefixes) and prefix arguments (C-u, M-digits). Keys are written as in Emacs: `C-f`, `M-f`, `C-x C-x`, `DEL`, `<left>`.
 */

/** Key sequence to command, as Emacs binds them in an Org buffer. @type {Readonly<Record<string, string>>} */
export const BINDINGS = {
  'C-f': 'forward-char',
  'C-b': 'backward-char',
  'C-n': 'next-line',
  'C-p': 'previous-line',
  'C-a': 'org-beginning-of-line',
  'C-e': 'org-end-of-line',
  'M-f': 'forward-word',
  'M-b': 'backward-word',
  'M-<': 'beginning-of-buffer',
  'M->': 'end-of-buffer',
  'C-d': 'org-delete-char',
  DEL: 'org-delete-backward-char',
  'M-d': 'kill-word',
  'M-DEL': 'backward-kill-word',
  'C-k': 'org-kill-line',
  'C-w': 'kill-region',
  'M-w': 'kill-ring-save',
  'C-y': 'org-yank',
  'C-o': 'org-open-line',
  'C-t': 'transpose-chars',
  'M-t': 'org-transpose-words',
  'M-u': 'upcase-word',
  'M-l': 'downcase-word',
  'M-c': 'capitalize-word',
  'M-\\': 'delete-horizontal-space',
  'M-m': 'back-to-indentation',
  'C-SPC': 'set-mark-command',
  'C-x C-x': 'exchange-point-and-mark',
  'C-/': 'undo',
  'C-_': 'undo',
  'C-x u': 'undo',
  'C-g': 'keyboard-quit',
  'C-u': 'universal-argument',
  'M-x': 'execute-extended-command',
  ...Object.fromEntries(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => [`M-${d}`, 'digit-argument'])),
  'M--': 'negative-argument',
};

/** Every key sequence of the table. */
export const KEY_SEQUENCES = Object.keys(BINDINGS);

const PREFIXES = new Set(['C-x', 'ESC', 'M-ESC']);

/** @typedef {{ n: number, universal: boolean }} Prefix */
/**
 * @typedef {object} KeyInput
 * @property {string[]} pending the keys of an unfinished sequence
 * @property {{ n: number | null, negative: boolean, universal: boolean, typed: string, echo: string, cleared?: boolean } | null} arg a prefix argument being typed
 */

/** @returns {KeyInput} */
export const newKeyInput = () => ({ pending: [], arg: null });

/**
 * What the keys so far amount to.
 * @typedef {{ type: 'pending', echo: string } | { type: 'quit' } | { type: 'unhandled' } | { type: 'error', message: string }
 *   | { type: 'run', command: string, key: string, prefix?: Prefix, char?: string }} KeyResult
 */

/** @param {string} key */
const isDigit = (key) => /^[0-9]$/.test(key);

/**
 * Reads one key. Keys that Emacs mode does not own are `unhandled`, left to the browser.
 * @param {KeyInput} input @param {string} rawKey
 * @returns {{ input: KeyInput, result: KeyResult }}
 */
export function feedKey(input, rawKey) {
  let key = rawKey;
  if (key === 'C-g') return { input: newKeyInput(), result: { type: 'quit' } };
  // ESC followed by a key is that key with Meta
  if (input.pending.length === 1 && input.pending[0] === 'ESC') {
    key = key.startsWith('M-') ? key : `M-${key}`;
    input = { ...input, pending: [] };
  }
  const arg = input.arg;
  if (arg && input.pending.length === 0) {
    const meta = /^M-([0-9])$/.exec(key);
    if (meta) return typeArgument(input, arg, meta[1]);
    if (isDigit(key) || (key === '-' && arg.typed === '')) return typeArgument(input, arg, key);
    if (key === 'M--' && arg.typed === '') return typeArgument(input, arg, '-');
    if (key === 'C-u' && arg.typed === '' && !arg.negative) {
      const echo = `${arg.echo} C-u`;
      return { input: { pending: [], arg: { ...arg, n: (arg.n ?? 4) * 4, echo } }, result: { type: 'pending', echo: `${echo}-` } };
    }
    if (key === 'C-u') return { input, result: { type: 'pending', echo: `${arg.echo}-` } };
  }
  const sequence = [...input.pending, key];
  const joined = sequence.join(' ');
  if (!arg && sequence.length === 1) {
    if (key === 'C-u') return { input: { pending: [], arg: { n: 4, negative: false, universal: true, typed: '', echo: 'C-u' } }, result: { type: 'pending', echo: 'C-u-' } };
    if (/^M-[0-9]$/.test(key)) return startMetaArgument(key.slice(2), key);
    if (key === 'M--') return { input: { pending: [], arg: { n: null, negative: true, universal: false, typed: '', echo: 'M--' } }, result: { type: 'pending', echo: 'M---' } };
  }
  const prefix = arg && !arg.cleared ? finishPrefix(arg) : undefined;
  if (PREFIXES.has(joined)) return { input: { ...input, pending: sequence }, result: { type: 'pending', echo: `${arg ? `${arg.echo} ` : ''}${joined}-` } };
  const command = BINDINGS[joined];
  if (command) return { input: newKeyInput(), result: { type: 'run', command, key: joined, ...(prefix ? { prefix } : {}) } };
  if (sequence.length > 1) return { input: newKeyInput(), result: { type: 'error', message: `${joined} is not available` } };
  if ([...key].length === 1 && !key.startsWith('C-') && !key.startsWith('M-')) {
    return { input: newKeyInput(), result: { type: 'run', command: 'self-insert-command', key, char: key, ...(prefix ? { prefix } : {}) } };
  }
  return { input: newKeyInput(), result: { type: 'unhandled' } };
}

/** @param {{ n: number | null, negative: boolean, universal: boolean, typed: string }} arg @returns {Prefix} */
function finishPrefix(arg) {
  const n = arg.n === null ? 1 : arg.n;
  return { n: arg.negative && arg.n === null ? -1 : n, universal: arg.universal && arg.typed === '' && !arg.negative };
}

/** @param {string} digit @param {string} key */
function startMetaArgument(digit, key) {
  return { input: { pending: [], arg: { n: Number(digit), negative: false, universal: false, typed: digit, echo: key } }, result: /** @type {KeyResult} */ ({ type: 'pending', echo: `${key}-` }) };
}

/** A digit or the minus sign of a prefix argument being typed. @param {KeyInput} input @param {NonNullable<KeyInput['arg']>} arg @param {string} key */
function typeArgument(input, arg, key) {
  if (key === '-') {
    const echo = `${arg.echo} -`;
    // a second minus takes the first back, as `negative-argument` does
    const again = arg.negative && !arg.cleared;
    return { input: { pending: [], arg: { ...arg, negative: !again, cleared: again, n: null, universal: false, echo } }, result: /** @type {KeyResult} */ ({ type: 'pending', echo: `${echo}-` }) };
  }
  const typed = arg.typed + key;
  const magnitude = Number(typed);
  const n = arg.negative ? -magnitude : magnitude;
  const echo = `${arg.echo} ${key}`;
  return { input: { pending: [], arg: { ...arg, typed, n, universal: false, cleared: false, echo } }, result: /** @type {KeyResult} */ ({ type: 'pending', echo: `${echo}-` }) };
}

/** The key as Emacs names it, from a browser key event; null for a modifier alone.
 * @param {{ key: string, ctrlKey: boolean, altKey: boolean }} e */
export function eventKey({ key, ctrlKey, altKey }) {
  if (['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'CapsLock'].includes(key)) return null;
  /** @type {Record<string, string>} */
  const named = { Backspace: 'DEL', Enter: 'RET', Tab: 'TAB', Escape: 'ESC', Delete: '<deletechar>', ArrowLeft: '<left>', ArrowRight: '<right>', ArrowUp: '<up>', ArrowDown: '<down>', Home: '<home>', End: '<end>', PageUp: '<prior>', PageDown: '<next>', Insert: '<insert>' };
  const name = named[key] ?? (/^F\d+$/.test(key) ? `<${key.toLowerCase()}>` : null);
  if (!name && [...key].length !== 1) return `<${key}>`;
  let base = name ?? key;
  if (!name && ctrlKey) {
    if (key === ' ' || key === '@') base = 'SPC';
    else if (/^[A-Za-z]$/.test(key)) base = key.toLowerCase();
  } else if (!name && key === ' ') base = 'SPC';
  return `${ctrlKey ? 'C-' : ''}${altKey ? 'M-' : ''}${base === 'SPC' && !ctrlKey && !altKey ? ' ' : base}`;
}
