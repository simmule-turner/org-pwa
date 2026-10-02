import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, processKey } from '../src/god-mode.js';
import { godModeContinuations, isSequenceInProgress, makeChordIndex } from '../src/god-mode-hints.js';

// a small stand-in for the app's real bindings
const CHORDS = ['C-c C-t', 'C-c C-w', 'C-c C-x C-i', 'C-c C-x C-o', 'C-c a', 'C-x C-s', 'M-x', 'M-RET', 'M-S-RET', 'M-<up>', 'C-/', 'C-f', 'C-h m'];
const index = makeChordIndex(CHORDS);
const type = (...keys) => keys.reduce((state, k) => processKey(state, k, false).state, initialState());
const keysOf = (list) => list.map((e) => e.key);
const find = (list, key) => list.find((e) => e.key === key);

test('the chord index counts how many bound chords lie beyond each prefix', () => {
  assert.equal(index.under.get('C-c'), 5);
  assert.equal(index.under.get('C-c C-x'), 2);
  assert.equal(index.under.get('C-x'), 1);
  assert.equal(index.under.get('C-t'), undefined);
  assert.ok(index.complete.has('M-x') && !index.complete.has('C-c'));
});

test('a sequence is "in progress" once something is typed, g is pending, or literal mode is on, and not before', () => {
  assert.equal(isSequenceInProgress(initialState()), false);
  assert.equal(isSequenceInProgress(type('c')), true);
  assert.equal(isSequenceInProgress(type('g')), true);
  assert.equal(isSequenceInProgress(type(' ')), true);
  assert.equal(isSequenceInProgress(null), false);
});

test('after c: the keys that finish a chord, and the keys that lead on, using the real translation rules', () => {
  const list = godModeContinuations(type('c'), index);
  const t = find(list, 't');
  assert.deepEqual([t.chord, t.complete, t.count], ['C-c C-t', true, 0]);
  assert.equal(find(list, 'w').chord, 'C-c C-w');
  const x = find(list, 'x');
  assert.deepEqual([x.chord, x.complete, x.count], ['C-c C-x', false, 2]);
  assert.ok(!keysOf(list).includes('z'), 'a key that leads nowhere is not offered');
});

test('SPC after c shows what typing literally would reach (c SPC a is C-c a)', () => {
  const list = godModeContinuations(type('c'), index);
  const spc = find(list, 'SPC');
  assert.ok(spc, 'SPC is offered because literal keys lead somewhere here');
  assert.equal(find(spc.children, 'a').chord, 'C-c a');
});

test('after g: the Meta chords, including named keys and their shifted forms', () => {
  const list = godModeContinuations(type('g'), index);
  assert.deepEqual([find(list, 'x').chord, find(list, 'RET').chord, find(list, 'S-RET').chord, find(list, '\u2191').chord], ['M-x', 'M-RET', 'M-S-RET', 'M-<up>']);
});

test('one level deeper still: after c x, only the clock keys remain', () => {
  const list = godModeContinuations(type('c', 'x'), index);
  assert.deepEqual(keysOf(list).sort(), ['i', 'o']);
  assert.ok(list.every((e) => e.complete && e.count === 0));
});

test('g is offered after c only if some Meta chord could follow it; here none can, so it is not', () => {
  assert.ok(!keysOf(godModeContinuations(type('c'), index)).includes('g'));
});

test('a prefix whose every continuation is a dead end offers nothing', () => {
  assert.deepEqual(godModeContinuations(type('h'), makeChordIndex(['C-c C-t'])), []);
});

test('entries that finish a chord come before entries that lead on to more', () => {
  const list = godModeContinuations(type('c'), index);
  const firstPrefix = list.findIndex((e) => e.count > 0);
  assert.ok(firstPrefix > 0 && list.slice(0, firstPrefix).every((e) => e.complete && e.count === 0));
  assert.ok(list.slice(firstPrefix).every((e) => e.count > 0));
});

test('the hints agree with the keys: typing an offered key really lands on the chord shown', () => {
  const start = type('c');
  for (const entry of godModeContinuations(start, index).filter((e) => e.chord)) {
    assert.equal(processKey(start, entry.rawKey, entry.shift).chordString, entry.chord);
  }
});

// ---- every bound chord has a name on the card -------------------------------------------------

import fs from 'node:fs';

const paletteSource = fs.readFileSync(new URL('../src-browser/god-mode-palette.js', import.meta.url), 'utf8');
const hintsSource = fs.readFileSync(new URL('../src-browser/god-mode-hints.js', import.meta.url), 'utf8');

function boundChords() {
  const a = paletteSource.indexOf('export const GOD_MODE_ACTIONS = {');
  const b = paletteSource.indexOf('\n};', a);
  return [...paletteSource.slice(a, b).matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1]);
}
const paletteNamed = new Set([...paletteSource.matchAll(/keys: '([^']+)'/g)].map((m) => m[1]));
const hintNamed = new Set([...hintsSource.slice(hintsSource.indexOf('UNNAMED_CHORD_LABELS = {'), hintsSource.indexOf('};', hintsSource.indexOf('UNNAMED_CHORD_LABELS = {'))).matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1]));

test('every bound chord is named on the hint card, by a palette command or by the card\u2019s own table, so a bare chord is never shown', () => {
  const unnamed = boundChords().filter((c) => !paletteNamed.has(c) && !hintNamed.has(c));
  assert.deepEqual(unnamed, [], 'bind a chord without a palette command and it needs a name in UNNAMED_CHORD_LABELS');
});

test('the card\u2019s own name table holds no stale entries: each chord in it is bound, and none already has a palette name', () => {
  const bound = new Set(boundChords());
  assert.deepEqual([...hintNamed].filter((c) => !bound.has(c)), [], 'named but not bound');
  assert.deepEqual([...hintNamed].filter((c) => paletteNamed.has(c)), [], 'named twice: the palette name wins');
});
