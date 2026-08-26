/**
 * god-mode: a key-sequence translator letting a plain, unmodified
 * keystroke stand in for an Emacs-style Control/Meta chord, so a
 * browser never sees an actual Ctrl/Alt combination it might
 * otherwise intercept for its own purposes (copy/paste, back/forward
 * navigation, ...). The person types a short sequence of ordinary
 * keys; this module accumulates them into a normalized chord string
 * ("C-c C-t", "M-<up>", "C-M-x") that a caller (app.js) matches
 * against a table of known actions.
 *
 * This is a direct, deliberate implementation of real god-mode.el's
 * own actual, documented rules (github.com/emacsorphanage/god-mode),
 * confirmed against its own README and source before writing any of
 * this -- not an approximation invented for this app. The full rule
 * set:
 *   - A plain key, by default, becomes Control+key ("t" -> "C-t").
 *     This is the ONLY default; every other rule below is either an
 *     exception to it or a way to override it for one keystroke.
 *   - "g" prefixes the very next key with Meta instead ("g" then
 *     "x" -> "M-x"). Consumes no chord of its own. As in real
 *     god-mode, this means there is no way to type a bare "C-g" --
 *     "g" always means "the next key gets Meta", full stop.
 *   - "G" (Shift+g) prefixes the very next key with Control+Meta
 *     ("G" then "n" -> "C-M-n"). Consumes no chord of its own.
 *   - SPC (the literal key) TOGGLES literal mode -- sticky, exactly
 *     as real god-mode's own god-literal-key describes: once
 *     toggled on, every subsequent key is typed with no modifier at
 *     all until SPC is pressed again to toggle it back off. This is
 *     what makes "c SPC g" produce "C-c g" (a literal "g" following
 *     "C-c"), not "C-c C-g".
 *   - A named key with no printable character of its own (arrows,
 *     Tab, Return) is never auto-Controlled by the plain-key default
 *     above -- it executes as typed unless a pending g/G prefix
 *     (or active literal mode) says otherwise. There would be no way
 *     to navigate at all otherwise, since "C-<up>" isn't a
 *     navigational chord any Emacs binding actually uses.
 *   - The very first chord of a fresh sequence being exactly "C-c"
 *     (a bare "c" typed with none of the above overrides active)
 *     marks the rest of that sequence as an org-style C-c chain:
 *     every further LETTER also auto-Controls, matching how nearly
 *     every real org-mode C-c binding is itself multi-key
 *     ("C-c C-t", "C-c C-c") -- but PUNCTUATION inside that same
 *     chain stays literal instead ("C-c .", "C-c |"), matching
 *     org's own real bindings that mix the two. This one rule is
 *     this app's own necessary approximation of what real Emacs
 *     itself gets "for free" from actually consulting its own
 *     keymaps (C-c is always a prefix key, never a complete command
 *     by itself, in the specific command set this app supports) --
 *     everything else above is real god-mode's own actual mechanism,
 *     unmodified.
 *
 * State is a plain object, threaded through processKey call by call
 * -- this module holds none of its own; the caller (app.js) owns the
 * actual state variable and decides when to reset it (after a
 * successful dispatch, an invalid/dead-end sequence, Escape, or a
 * timeout).
 */

/** A fresh, empty god-mode state -- nothing typed yet. */
function initialState() {
  return { chordString: '', pendingModifier: null, literalActive: false, inCcChain: false };
}

const LETTER_RE = /^[a-zA-Z]$/;

/** Formats one resolved (modifier, key) pair into its own Emacs-style
 *  chord text -- "C-t", "M-<up>", "C-M-x", or the bare key itself for
 *  a literal (unmodified) keystroke. `key` is already whatever
 *  human-readable form the caller wants in the final chord string
 *  (e.g. "<up>" for the ArrowUp key, matching real Emacs's own
 *  bracketed special-key notation) -- this function doesn't interpret
 *  key names itself, that's normalizeKeyName's own job below. */
function formatChord(modifier, key) {
  if (modifier === 'C') return `C-${key}`;
  if (modifier === 'M') return `M-${key}`;
  if (modifier === 'CM') return `C-M-${key}`;
  return key; // literal, no modifier at all
}

/** Normalizes a raw KeyboardEvent-style key name (plus whether Shift
 *  was actually held -- real god-mode's own convention is that Shift
 *  IS still held physically alongside the plain key for an
 *  uppercase/shifted character or arrow, since Shift itself isn't
 *  part of what god-mode is working around; only Ctrl/Alt/Cmd are)
 *  into the form used inside a chord string: a single printable
 *  character stays as-is; a named special key (arrows, Return, Tab,
 *  ...) becomes Emacs's own bracketed form, with an "S-" prefix
 *  first if Shift was held. */
function normalizeKeyName(rawKey, shiftKey) {
  const BRACKETED_KEYS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
  const BARE_NAMED_KEYS = { Enter: 'RET', Tab: 'TAB', ' ': 'SPC' };
  if (rawKey in BRACKETED_KEYS) {
    const bracketed = `<${BRACKETED_KEYS[rawKey]}>`;
    return shiftKey ? `S-${bracketed}` : bracketed;
  }
  if (rawKey in BARE_NAMED_KEYS) {
    const bare = BARE_NAMED_KEYS[rawKey];
    return shiftKey ? `S-${bare}` : bare;
  }
  if (rawKey.length === 1) return rawKey; // a printable character -- already carries its own shifted form (",", "!", "A" vs "a", ...) from the event itself
  return rawKey; // an unrecognized special key name -- passed through as-is rather than silently dropped
}

const NAMED_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Tab']);

/** Processes one raw keystroke against the current god-mode `state`,
 *  returning `{ state, chordString }` -- `chordString` is always the
 *  FULL sequence built so far (e.g. "C-c", then "C-c C-t"), letting
 *  the caller check it against a lookup table after every single
 *  keystroke rather than only at some presumed "end" of a sequence
 *  (there is no such boundary here; the caller's own table decides
 *  when a sequence is complete, a valid-but-incomplete prefix, or a
 *  dead end -- see app.js's own dispatch logic). `rawKey` is a
 *  KeyboardEvent's own `.key` value; `shiftKey` is whether Shift was
 *  actually held (see normalizeKeyName's own docs for why Shift is
 *  treated differently from Ctrl/Alt here). */
function processKey(state, rawKey, shiftKey) {
  // SPC is real god-mode's own literal/escape key -- sticky, toggles
  // on and off, applies to every key typed while active. Consumes no
  // chord of its own.
  if (rawKey === ' ') {
    return { state: { ...state, literalActive: !state.literalActive }, chordString: state.chordString };
  }

  // "g"/"G" are prefix markers (Meta / Control-Meta), not literal
  // keys, UNLESS literal mode is currently active -- in which case
  // they're typed as themselves like anything else, same as real
  // god-mode's own SPC-then-g example.
  if (!state.literalActive && state.pendingModifier === null && rawKey === 'g') {
    return { state: { ...state, pendingModifier: 'M' }, chordString: state.chordString };
  }
  if (!state.literalActive && state.pendingModifier === null && rawKey === 'G') {
    return { state: { ...state, pendingModifier: 'CM' }, chordString: state.chordString };
  }

  const key = normalizeKeyName(rawKey, shiftKey);
  const isNamedKey = NAMED_KEYS.has(rawKey) || rawKey.length > 1;
  let modifier;
  if (state.pendingModifier === 'M') modifier = 'M';
  else if (state.pendingModifier === 'CM') modifier = 'CM';
  else if (state.literalActive) modifier = null;
  else if (isNamedKey) modifier = null; // a bare named key (no g/G prefix, no literal mode) is never auto-Controlled -- see docs above
  else if (state.inCcChain) modifier = LETTER_RE.test(rawKey) ? 'C' : null; // punctuation stays literal even inside the chain -- matches real org's own mixed "C-c C-t" / "C-c ." bindings
  else modifier = 'C'; // the default rule: a plain printable key acts as Control

  const chord = formatChord(modifier, key);
  const newChordString = state.chordString === '' ? chord : `${state.chordString} ${chord}`;
  // The very first chord of a fresh sequence being exactly "C-c"
  // marks everything after it as the org-style C-c chain -- see this
  // module's own top-level docs for why this one rule exists at all.
  const inCcChain = state.inCcChain || (state.chordString === '' && chord === 'C-c');
  const newState = { ...state, chordString: newChordString, pendingModifier: null, inCcChain };
  return { state: newState, chordString: newChordString };
}

export { initialState, processKey };
