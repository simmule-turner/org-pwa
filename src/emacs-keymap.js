// @ts-check
/**
 * Emacs mode, the keys: Emacs's default keymap for the commands of src/emacs-edit.js, and the input state that reads key sequences
 * (C-x and ESC prefixes) and prefix arguments (C-u, M-digits). Keys are written as in Emacs: `C-f`, `M-f`, `C-x C-x`, `DEL`, `<left>`.
 */

/** The keys that run a command of the command palette (the app's own commands for these Emacs functions), as Emacs binds them. @type {Readonly<Record<string, string>>} */
export const PALETTE_BINDINGS = {
  'C-c C-d': 'org-deadline',
  'C-c C-q': 'org-set-tags-command',
  'C-c C-x p': 'org-set-property',
  'C-\'': 'org-cycle-agenda-files',
  'C-,': 'org-cycle-agenda-files',
  'C-c !': 'org-time-stamp-inactive',
  'C-c #': 'org-update-statistics-cookies',
  'C-c $': 'org-archive-subtree',
  'C-c %': 'org-mark-ring-push',
  'C-c &': 'org-mark-ring-goto',
  'C-c ,': 'org-priority',
  'C-c .': 'org-time-stamp',
  'C-c /': 'org-sparse-tree',
  'C-c ;': 'org-toggle-comment',
  'C-c @': 'org-mark-subtree',
  'C-c C-,': 'org-insert-structure-template',
  'C-c C-<': 'org-promote-subtree',
  'C-c C->': 'org-demote-subtree',
  'C-c C-a': 'org-attach',
  'C-c C-e': 'org-export-dispatch',
  'C-c C-j': 'org-goto',
  'C-c C-s': 'org-schedule',
  'C-c C-v C-b': 'org-babel-execute-buffer',
  'C-c C-v C-e': 'org-babel-execute-maybe',
  'C-c C-v C-n': 'org-babel-next-src-block',
  'C-c C-v C-p': 'org-babel-previous-src-block',
  'C-c C-v C-s': 'org-babel-execute-subtree',
  'C-c C-v C-t': 'org-babel-tangle',
  'C-c C-v b': 'org-babel-execute-buffer',
  'C-c C-v e': 'org-babel-execute-maybe',
  'C-c C-v i': 'org-babel-lob-ingest',
  'C-c C-v k': 'org-babel-remove-result-one-or-many',
  'C-c C-v n': 'org-babel-next-src-block',
  'C-c C-v p': 'org-babel-previous-src-block',
  'C-c C-v s': 'org-babel-execute-subtree',
  'C-c C-v t': 'org-babel-tangle',
  'C-c C-w': 'org-refile',
  'C-c C-x ,': 'org-timer-pause-or-continue',
  'C-c C-x -': 'org-timer-item',
  'C-c C-x 0': 'org-timer-start',
  'C-c C-x ;': 'org-timer-set-timer',
  'C-c C-x <': 'org-agenda-set-restriction-lock',
  'C-c C-x >': 'org-agenda-remove-restriction-lock',
  'C-c C-x A': 'org-archive-to-archive-sibling',
  'C-c C-x C-a': 'org-archive-subtree-default',
  'C-c C-x C-c': 'org-columns',
  'C-c C-x C-i': 'org-clock-in',
  'C-c C-x C-j': 'org-clock-goto',
  'C-c C-x C-n': 'org-next-link',
  'C-c C-x C-o': 'org-clock-out',
  'C-c C-x C-q': 'org-clock-cancel',
  'C-c C-x C-s': 'org-archive-subtree',
  'C-c C-x C-u': 'org-dblock-update',
  'C-c C-x C-x': 'org-clock-in-last',
  'C-c C-x M': 'org-insert-todo-heading',
  'C-c C-x TAB': 'org-clock-in',
  'C-c C-x _': 'org-timer-stop',
  'C-c C-x c': 'org-clone-subtree-with-time-shift',
  'C-c C-x d': 'org-insert-drawer',
  'C-c C-x e': 'org-set-effort',
  'C-c C-x f': 'org-footnote-action',
  'C-c [': 'org-agenda-file-to-front',
  'C-c ]': 'org-remove-file',
  'C-c ^': 'org-sort',
  'C-x C-q': 'read-only-mode',
  'C-x C-s': 'save-buffer',
  'C-x C-w': 'write-file',
  'C-x RET r': 'revert-buffer-with-coding-system',
  'C-x n s': 'org-narrow-to-subtree',
  'C-x n w': 'widen',
  'C-x s': 'save-some-buffers',
  'C-x x r': 'rename-buffer',
};

/** The commands those keys run: the browser layer hands them to the palette. */
export const PALETTE_COMMANDS = new Set(Object.values(PALETTE_BINDINGS));

/** Key sequence to command, as Emacs binds them in an Org buffer. @type {Readonly<Record<string, string>>} */
export const BINDINGS = {
  ...PALETTE_BINDINGS,
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
  RET: 'org-return',
  'C-t': 'transpose-chars',
  'C-q': 'quoted-insert',
  'M-t': 'org-transpose-words',
  'M-u': 'upcase-word',
  'M-l': 'downcase-word',
  'M-c': 'capitalize-word',
  'M-\\': 'delete-horizontal-space',
  'M-m': 'back-to-indentation',
  'C-SPC': 'set-mark-command',
  'C-x C-x': 'exchange-point-and-mark',
  'C-x h': 'mark-whole-buffer',
  TAB: 'org-cycle',
  '<backtab>': 'org-shifttab',
  'S-<up>': 'org-shiftup',
  'S-<down>': 'org-shiftdown',
  'S-<left>': 'org-shiftleft',
  'S-<right>': 'org-shiftright',
  'M-S-<up>': 'org-shiftmetaup',
  'M-S-<down>': 'org-shiftmetadown',
  'M-S-<left>': 'org-shiftmetaleft',
  'M-S-<right>': 'org-shiftmetaright',
  'C-c C-r': 'org-fold-reveal',
  'C-c C-n': 'org-next-visible-heading',
  'C-c C-p': 'org-previous-visible-heading',
  'C-c C-f': 'org-forward-heading-same-level',
  'C-c C-b': 'org-backward-heading-same-level',
  'C-c C-u': 'outline-up-heading',
  'C-c C-t': 'org-todo',
  'C-c C-c': 'org-ctrl-c-ctrl-c',
  'C-c C-x C-b': 'org-toggle-checkbox',
  'M-<up>': 'org-metaup',
  'M-<down>': 'org-metadown',
  'M-<left>': 'org-metaleft',
  'M-<right>': 'org-metaright',
  'C-/': 'undo',
  'C-?': 'undo-redo',
  'C-M-_': 'undo-redo',
  'M-a': 'org-backward-sentence',
  'M-e': 'org-forward-sentence',
  'M-k': 'kill-sentence',
  'M-@': 'mark-word',
  'M-^': 'org-delete-indentation',
  'C-M-o': 'split-line',
  'C-x C-t': 'transpose-lines',
  'C-<backspace>': 'backward-kill-word',
  'C-<delete>': 'kill-word',
  'M-y': 'yank-pop',
  'M-SPC': 'cycle-spacing',
  'C-x C-o': 'delete-blank-lines',
  'C-s': 'isearch-forward',
  'C-r': 'isearch-backward',
  'C-v': 'scroll-up-command',
  'M-v': 'scroll-down-command',
  'C-_': 'undo',
  'C-x u': 'undo',
  'C-g': 'keyboard-quit',
  'C-u': 'universal-argument',
  'M-x': 'execute-extended-command',
  'C-x d': 'dired',
  'C-x C-j': 'dired-jump',
  'C-x C-f': 'find-file',
  'M-z': 'zap-to-char',
  'M-q': 'org-fill-paragraph',
  'C-x C-u': 'upcase-region',
  'C-x C-l': 'downcase-region',
  'C-x b': 'switch-to-buffer',
  'C-x k': 'kill-buffer',
  'C-x C-b': 'list-buffers',
  'C-h e': 'view-echo-area-messages',
  ...Object.fromEntries(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => [`M-${d}`, 'digit-argument'])),
  'M--': 'negative-argument',
};

/** Every key sequence of the table. */
export const KEY_SEQUENCES = Object.keys(BINDINGS);

const PREFIXES = new Set(['C-x', 'C-c', 'C-c C-x', 'C-c C-v', 'C-x n', 'C-h', 'ESC', 'M-ESC']);

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
 *   | { type: 'run', command: string, key: string, prefix?: Prefix, char?: string, again?: string }} KeyResult
 * `again` is a key that ended a quoted character code and is then typed as itself.
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
  if (input.pending[0] === 'C-q') return quotedChar(input, key); // before C-g: C-q C-g inserts the bell character
  if (key === 'C-g') return { input: newKeyInput(), result: { type: 'quit' } };
  if (input.pending[0] === 'M-z') { // zap-to-char reads the character to kill up to; a key that is not a character is left unread
    const ch = key === 'SPC' ? ' ' : key === 'TAB' ? '\t' : [...key].length === 1 ? key : null;
    const echo = `${input.arg ? `${input.arg.echo} ` : ''}M-z-`;
    if (ch === null) return { input, result: { type: 'pending', echo } };
    const prefix = input.arg && !input.arg.cleared ? finishPrefix(input.arg) : undefined;
    return { input: newKeyInput(), result: { type: 'run', command: 'zap-to-char', key: 'M-z', char: ch, ...(prefix ? { prefix } : {}) } };
  }
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
  if (joined === 'C-q') return { input: { ...input, pending: sequence }, result: { type: 'pending', echo: `${arg ? `${arg.echo} ` : ''}C-q-` } };
  if (joined === 'M-z') return { input: { ...input, pending: sequence }, result: { type: 'pending', echo: `${arg ? `${arg.echo} ` : ''}M-z-` } };
  if (PREFIXES.has(joined)) return { input: { ...input, pending: sequence }, result: { type: 'pending', echo: `${arg ? `${arg.echo} ` : ''}${joined}-` } };
  const command = BINDINGS[joined];
  if (command) return { input: newKeyInput(), result: { type: 'run', command, key: joined, ...(prefix ? { prefix } : {}) } };
  if (sequence.length > 1) return { input: newKeyInput(), result: { type: 'error', message: `${joined} is not available` } };
  if ([...key].length === 1 && !key.startsWith('C-') && !key.startsWith('M-')) {
    return { input: newKeyInput(), result: { type: 'run', command: key === '|' ? 'org-force-self-insert' : 'self-insert-command', key, char: key, ...(prefix ? { prefix } : {}) } }; // Org binds | to its own command, which is an undo step of its own
  }
  return { input: newKeyInput(), result: { type: 'unhandled' } };
}

/** The character code of a key typed after C-q, as Emacs's `read-quoted-char` takes it; null for a key that is not a character (an arrow).
 * @param {string} key @returns {number | null | 'invalid'} */
function quotedCode(key) {
  /** @type {Record<string, number>} */
  const named = { SPC: 32, TAB: 9, RET: 13, ESC: 27, DEL: 127 };
  if (key in named) return named[key];
  if ([...key].length === 1) return /** @type {number} */ (key.codePointAt(0));
  const meta = /^M-(.)$/u.exec(key);
  if (meta) return /** @type {number} */ (meta[1].codePointAt(0)) | 128;
  const control = /^C-(.|SPC)$/u.exec(key);
  if (control) {
    const c = control[1];
    if (c === 'SPC' || c === '@') return 0;
    if (/^[a-z]$/.test(c)) return c.charCodeAt(0) - 96;
    if (/^[A-Z]$/.test(c)) return c.charCodeAt(0) - 64;
    if ('[\\]^_'.includes(c)) return c.charCodeAt(0) - 64;
    return c === '?' ? 127 : 'invalid'; // another control key is not a character
  }
  return null;
}

/** The key after C-q: the character itself, or octal digits for its code that any other key ends (RET is then dropped, another key typed as itself).
 * @param {KeyInput} input @param {string} key @returns {{ input: KeyInput, result: KeyResult }} */
function quotedChar(input, key) {
  const digits = input.pending.slice(1);
  const prefix = input.arg && !input.arg.cleared ? finishPrefix(input.arg) : undefined;
  /** @param {number} code @param {string} [again] @returns {{ input: KeyInput, result: KeyResult }} */
  const done = (code, again) => code > 0x10ffff
    ? { input: newKeyInput(), result: { type: 'error', message: `${code.toString(8)} is not a valid character` } }
    : { input: newKeyInput(), result: { type: 'run', command: 'quoted-insert', key: 'C-q', char: String.fromCodePoint(code), ...(prefix ? { prefix } : {}), ...(again ? { again } : {}) } };
  const octal = /^[0-7]$/.test(key);
  if (octal) return { input: { ...input, pending: [...input.pending, key] }, result: { type: 'pending', echo: `${input.arg ? `${input.arg.echo} ` : ''}C-q ${[...digits, key].join('')}-` } };
  if (digits.length) {
    const code = parseInt(digits.join(''), 8);
    return key === 'RET' ? done(code) : done(code, key);
  }
  const code = quotedCode(key);
  if (code === 'invalid') return { input: newKeyInput(), result: { type: 'error', message: `${key} is not a valid character` } };
  if (code === null) return { input: newKeyInput(), result: { type: 'error', message: `C-q ${key} is not available` } };
  return done(code);
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
 * Shift is part of the name only for the keys that have a name (S-<up>, M-S-<left>, S-<return>); a letter typed with Shift is the capital itself.
 * @param {{ key: string, ctrlKey: boolean, altKey: boolean, shiftKey?: boolean }} e */
export function eventKey({ key, ctrlKey, altKey, shiftKey = false }) {
  if (['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'CapsLock'].includes(key)) return null;
  /** @type {Record<string, string>} */
  const named = { Backspace: 'DEL', Enter: 'RET', Tab: 'TAB', Escape: 'ESC', Delete: '<deletechar>', ArrowLeft: '<left>', ArrowRight: '<right>', ArrowUp: '<up>', ArrowDown: '<down>', Home: '<home>', End: '<end>', PageUp: '<prior>', PageDown: '<next>', Insert: '<insert>' };
  const name = named[key] ?? (/^F\d+$/.test(key) ? `<${key.toLowerCase()}>` : null);
  if (!name && [...key].length !== 1) return `<${key}>`;
  if (ctrlKey && !altKey && (key === 'Backspace' || key === 'Delete')) return `C-<${key === 'Backspace' ? 'backspace' : 'delete'}>`;
  let base = name ?? key;
  if (shiftKey && name && !['Tab', 'Backspace', 'Escape', 'Delete'].includes(key)) base = `S-${key === 'Enter' ? '<return>' : name}`; // Return is RET alone, <return> with a modifier, as Emacs names it
  if (!name && ctrlKey) {
    if (key === ' ' || key === '@') base = 'SPC';
    else if (/^[A-Za-z]$/.test(key)) base = key.toLowerCase();
  } else if (!name && key === ' ') base = 'SPC';
  return `${ctrlKey ? 'C-' : ''}${altKey ? 'M-' : ''}${base === 'SPC' && !ctrlKey && !altKey ? ' ' : base}`;
}
