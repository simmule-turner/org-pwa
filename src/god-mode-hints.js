/**
 * "Where can this prefix lead?": given the god-mode sequence typed so far, which
 * keys would continue it, and what each would do. Like Emacs's which-key.
 *
 * It does not reverse-engineer god-mode's key rules. For every key a person could
 * type next it asks the real translator (processKey) what that key would do from
 * the current state, and keeps the ones that lead to a bound chord or to a longer
 * prefix of one. So the hints can never disagree with what the keys actually do.
 *
 * Pure: the bound chords come in as an index, so this runs in Node.
 */

import { processKey } from './god-mode.js';

const NAMED_KEYS = [
  ['ArrowUp', '\u2191'],
  ['ArrowDown', '\u2193'],
  ['ArrowLeft', '\u2190'],
  ['ArrowRight', '\u2192'],
  ['Enter', 'RET'],
  ['Tab', 'Tab'],
];

/** Every key worth trying: [rawKey, shiftKey, display]. */
const CANDIDATES = [
  ...'abcdefghijklmnopqrstuvwxyz0123456789'.split('').map((k) => [k, false, k]),
  ...",.!|/-=;'[]`<>".split('').map((k) => [k, false, k]),
  ...NAMED_KEYS.map(([k, d]) => [k, false, d]),
  ...NAMED_KEYS.map(([k, d]) => [k, true, 'S-' + d]),
];

/** Indexes a set of bound chord strings (like "C-c C-t") for the lookups below. */
function makeChordIndex(chords) {
  const complete = new Set(chords);
  const under = new Map(); // a prefix -> how many bound chords start with it
  for (const chord of complete) {
    const parts = chord.split(' ');
    for (let n = 1; n < parts.length; n++) {
      const prefix = parts.slice(0, n).join(' ');
      under.set(prefix, (under.get(prefix) || 0) + 1);
    }
  }
  return { complete, under };
}

/** Whether a sequence has been started and not finished: something typed, a g/G prefix pending, or literal mode on. */
function isSequenceInProgress(state) {
  return !!state && (state.chordString !== '' || state.pendingModifier !== null || state.literalActive);
}

/**
 * The keys that would continue `state`.
 * @returns {{ key: string, rawKey: string, shift: boolean, chord: string|null, complete: boolean, count: number, children?: object[] }[]}
 *   `complete`: the key finishes a bound chord (`chord`). `count`: how many bound chords lie beyond it (0 for a plain leaf).
 *   Keys that only change mode (g, SPC) carry `children`, the keys that would follow them.
 */
function godModeContinuations(state, index, depth = 0) {
  const out = [];
  for (const [rawKey, shift, display] of CANDIDATES) {
    const next = processKey(state, rawKey, shift);
    if (next.state.pendingModifier !== state.pendingModifier && next.chordString === state.chordString) {
      // g: Meta for the next key (no chord of its own); look at what would follow it
      if (depth >= 2) continue;
      const children = godModeContinuations(next.state, index, depth + 1);
      if (children.length) out.push({ key: display, rawKey, shift, chord: null, complete: false, count: children.reduce((n, c) => n + Math.max(1, c.count), 0), children });
      continue;
    }
    if (next.chordString === state.chordString) continue; // no chord consumed: not a continuation
    const complete = index.complete.has(next.chordString);
    const count = index.under.get(next.chordString) || 0;
    if (!complete && count === 0) continue; // a dead end
    out.push({ key: display, rawKey, shift, chord: next.chordString, complete, count });
  }
  // SPC toggles literal mode (no chord of its own); show what typing literally would reach
  if (!state.literalActive && depth < 2) {
    const next = processKey(state, ' ', false);
    const children = godModeContinuations(next.state, index, depth + 1);
    if (children.length) out.push({ key: 'SPC', rawKey: ' ', shift: false, chord: null, complete: false, count: children.reduce((n, c) => n + Math.max(1, c.count), 0), children });
  }
  // finished chords first, then keys that lead on to more
  return out.sort((a, b) => (a.count > 0 ? 1 : 0) - (b.count > 0 ? 1 : 0) || (a.key.length - b.key.length) || (a.key < b.key ? -1 : 1));
}

export { makeChordIndex, godModeContinuations, isSequenceInProgress };
