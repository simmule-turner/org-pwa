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
 * The full set of rules this engine implements:
 *   - A plain key, by default, becomes Control+key ("t" -> "C-t").
 *   - "m" prefixes the very next key with Meta instead ("m" then
 *     "<up>" -> "M-<up>"). Consumes no chord of its own.
 *   - "g" prefixes the very next key with Control+Meta ("g" then "x"
 *     -> "C-M-x") -- UNLESS a "c c" chain (below) is currently
 *     active, in which case "g" instead clears that chain, and the
 *     next key is typed completely literally (no modifier at all).
 *     Consumes no chord of its own either way.
 *   - "c" "c" (two literal presses of "c", as the first two keys of
 *     a fresh sequence) generates exactly one "C-c" chord -- not
 *     two -- and enters a chain where every subsequent letter key
 *     automatically becomes Control too, matching how most org-mode
 *     bindings are themselves "C-c C-<letter>". A non-letter key
 *     (punctuation) within this chain is typed literally instead,
 *     matching org's own actual bindings that mix the two ("C-c .",
 *     "C-c |", alongside "C-c C-t", "C-c C-d").
 *
 * State is a plain object, threaded through processKey call by call
 * -- this module holds none of its own; the caller (app.js) owns the
 * actual state variable and decides when to reset it (after a
 * successful dispatch, an invalid/dead-end sequence, Escape, or a
 * timeout).
 */

/** A fresh, empty god-mode state -- nothing typed yet. */
function initialState() {
  return { chordString: '', pendingModifier: null, inCcChain: false, awaitingSecondC: false };
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
  // "m"/"g" are prefix markers, not literal keys, UNLESS one of them
  // is itself the key a pending modifier applies to (typing "m" then
  // "m" again means M-m, a real, valid chord -- the second "m" is
  // consumed as the target key, not re-interpreted as a fresh prefix).
  if (state.pendingModifier === null && rawKey === 'm') {
    return { state: { ...state, pendingModifier: 'M' }, chordString: state.chordString };
  }
  if (state.pendingModifier === null && rawKey === 'g') {
    if (state.inCcChain) {
      // Clears the chain; the very next key (handled on the following
      // call, via pendingModifier: 'literal') is typed with no
      // modifier at all.
      return { state: { ...state, inCcChain: false, pendingModifier: 'literal' }, chordString: state.chordString };
    }
    return { state: { ...state, pendingModifier: 'CM' }, chordString: state.chordString };
  }

  // The very first key of a fresh sequence, if it's "c", doesn't
  // commit a chord yet -- it waits one more keystroke to see whether
  // this is the special "c c" org-prefix or a standalone "C-c".
  if (state.chordString === '' && !state.awaitingSecondC && state.pendingModifier === null && rawKey === 'c') {
    return { state: { ...state, awaitingSecondC: true }, chordString: state.chordString };
  }
  if (state.awaitingSecondC) {
    const clearedState = { ...state, awaitingSecondC: false };
    if (rawKey === 'c') {
      // Confirmed "c c" -- exactly one C-c chord, then enter the chain.
      return { state: { ...clearedState, chordString: 'C-c', inCcChain: true }, chordString: 'C-c' };
    }
    // Not a second "c" -- the first "c" stands alone as its own C-c
    // chord, and this key starts the NEXT chord in the same
    // sequence, processed fresh (recursing so "m"/"g" prefixes and
    // the chain rule below all still apply correctly to it).
    const { state: afterC, chordString: afterCChord } = processKey({ ...clearedState, chordString: 'C-c' }, rawKey, shiftKey);
    return { state: afterC, chordString: afterCChord };
  }

  const key = normalizeKeyName(rawKey, shiftKey);
  const NAMED_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Tab', ' ']);
  const isNamedKey = NAMED_KEYS.has(rawKey) || rawKey.length > 1;
  let modifier;
  if (state.pendingModifier === 'M') modifier = 'M';
  else if (state.pendingModifier === 'CM') modifier = 'CM';
  else if (state.pendingModifier === 'literal') modifier = null;
  else if (isNamedKey) modifier = null; // a bare named key (no m/g prefix) is never auto-controlled -- see docs above
  else if (state.inCcChain) modifier = LETTER_RE.test(rawKey) ? 'C' : null; // punctuation stays literal even inside the chain -- matches real org's own mixed "C-c C-t" / "C-c ." bindings
  else modifier = 'C'; // the default rule: a plain printable key/sequence acts as Control

  const chord = formatChord(modifier, key);
  const newChordString = state.chordString === '' ? chord : `${state.chordString} ${chord}`;
  const newState = { ...state, chordString: newChordString, pendingModifier: null };
  return { state: newState, chordString: newChordString };
}

export { initialState, processKey };
