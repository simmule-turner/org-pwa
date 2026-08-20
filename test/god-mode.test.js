import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, processKey } from '../src/god-mode.js';

/** Runs a sequence of [rawKey, shiftKey?] pairs through the engine
 *  from a fresh state, returning the final chord string. */
function run(seq) {
  let state = initialState();
  let chordString = '';
  for (const [key, shift] of seq) {
    ({ state, chordString } = processKey(state, key, !!shift));
  }
  return chordString;
}

// ---- the core rules, in isolation --------------------------------------------

test('a single plain letter defaults to Control', () => {
  assert.equal(run([['t']]), 'C-t');
});

test('a single plain punctuation character also defaults to Control outside any chain', () => {
  assert.equal(run([[',']]), 'C-,');
});

test('m prefixes the very next key with Meta, consuming no chord of its own', () => {
  assert.equal(run([['m'], ['x']]), 'M-x');
});

test('g prefixes the very next key with Control+Meta when no chain is active', () => {
  assert.equal(run([['g'], ['x']]), 'C-M-x');
});

test('a bare named key (arrow/Tab/RET/Space) never defaults to Control -- ordinary cursor movement must stay usable while god-mode is active', () => {
  assert.equal(run([['ArrowUp']]), '<up>');
  assert.equal(run([['ArrowDown']]), '<down>');
  assert.equal(run([['Tab']]), 'TAB');
  assert.equal(run([['Enter']]), 'RET');
  assert.equal(run([[' ']]), 'SPC');
});

test('Shift held alongside a bare named key passes through as S-<key>, with no Control at all', () => {
  assert.equal(run([['ArrowUp', true]]), 'S-<up>');
  assert.equal(run([['ArrowDown', true]]), 'S-<down>');
  assert.equal(run([['Tab', true]]), 'S-TAB');
});

test('THE FIX: "c c" generates exactly ONE C-c chord, not two', () => {
  assert.equal(run([['c'], ['c']]), 'C-c');
});

test('within the c-c chain, a letter key auto-applies Control', () => {
  assert.equal(run([['c'], ['c'], ['t']]), 'C-c C-t');
});

test('within the c-c chain, a punctuation key stays literal -- matches real org\u2019s own mixed "C-c C-t" / "C-c ." bindings', () => {
  assert.equal(run([['c'], ['c'], [',']]), 'C-c ,');
  assert.equal(run([['c'], ['c'], ['.']]), 'C-c .');
});

test('g clears an active c-c chain, making the next key completely literal', () => {
  assert.equal(run([['c'], ['c'], ['g'], ['l']]), 'C-c l');
});

test('a lone "c" not followed by a second "c" is a standalone C-c chord, and the next key starts fresh under the default rule', () => {
  assert.equal(run([['c'], ['t']]), 'C-c C-t');
});

// ---- Section 1: Structural Editing & Navigation --------------------------------

test('Section 1: Move heading/list item Up/Down', () => {
  assert.equal(run([['m'], ['ArrowUp']]), 'M-<up>');
  assert.equal(run([['m'], ['ArrowDown']]), 'M-<down>');
});

test('Section 1: Demote/Promote heading/list item', () => {
  assert.equal(run([['m'], ['ArrowRight']]), 'M-<right>');
  assert.equal(run([['m'], ['ArrowLeft']]), 'M-<left>');
});

test('Section 1: Demote/Promote entire subtree', () => {
  assert.equal(run([['m'], ['ArrowRight', true]]), 'M-S-<right>');
  assert.equal(run([['m'], ['ArrowLeft', true]]), 'M-S-<left>');
});

test('Section 1: Move to next/previous heading (same level)', () => {
  assert.equal(run([['c'], ['c'], ['f']]), 'C-c C-f');
  assert.equal(run([['c'], ['c'], ['b']]), 'C-c C-b');
});

test('Section 1: Move up to parent heading', () => {
  assert.equal(run([['c'], ['c'], ['u']]), 'C-c C-u');
});

// ---- Section 2: Item & Headline Creation ---------------------------------------

test('Section 2: Insert heading / TODO heading / checkbox item', () => {
  assert.equal(run([['m'], ['Enter']]), 'M-RET');
  assert.equal(run([['m'], ['Enter', true]]), 'M-S-RET');
});

test('Section 2: Toggle checkbox status', () => {
  assert.equal(run([['c'], ['c'], ['c']]), 'C-c C-c');
});

// ---- Section 3: TODOs & Task Management ----------------------------------------

test('Section 3: Cycle TODO state', () => {
  assert.equal(run([['c'], ['c'], ['t']]), 'C-c C-t');
});

test('Section 3: Set task priority', () => {
  assert.equal(run([['c'], ['c'], [',']]), 'C-c ,');
});

test('Section 3: Show sparse TODO tree', () => {
  assert.equal(run([['c'], ['c'], ['v']]), 'C-c C-v');
});

// ---- Section 4: Dates, Deadlines & Timestamps ----------------------------------

test('Section 4: Insert active/inactive date', () => {
  assert.equal(run([['c'], ['c'], ['.']]), 'C-c .');
  assert.equal(run([['c'], ['c'], ['!']]), 'C-c !');
});

test('Section 4: Insert DEADLINE/SCHEDULED timestamp', () => {
  assert.equal(run([['c'], ['c'], ['d']]), 'C-c C-d');
  assert.equal(run([['c'], ['c'], ['s']]), 'C-c C-s');
});

test('Section 4: Shift date under cursor', () => {
  assert.equal(run([['ArrowUp', true]]), 'S-<up>');
  assert.equal(run([['ArrowDown', true]]), 'S-<down>');
});

// ---- Section 5: Table Manipulation ---------------------------------------------

test('Section 5: Create table / convert region', () => {
  assert.equal(run([['c'], ['c'], ['|']]), 'C-c |');
});

test('Section 5: Move to next cell / re-align', () => {
  assert.equal(run([['Tab']]), 'TAB');
});

test('Section 5: Move row/column', () => {
  assert.equal(run([['m'], ['ArrowUp']]), 'M-<up>');
  assert.equal(run([['m'], ['ArrowDown']]), 'M-<down>');
  assert.equal(run([['m'], ['ArrowLeft']]), 'M-<left>');
  assert.equal(run([['m'], ['ArrowRight']]), 'M-<right>');
});

test('Section 5: Insert/delete row/column', () => {
  assert.equal(run([['m'], ['ArrowDown', true]]), 'M-S-<down>');
  assert.equal(run([['m'], ['ArrowUp', true]]), 'M-S-<up>');
  assert.equal(run([['m'], ['ArrowRight', true]]), 'M-S-<right>');
  assert.equal(run([['m'], ['ArrowLeft', true]]), 'M-S-<left>');
});

test('Section 5: Insert horizontal rule line', () => {
  assert.equal(run([['c'], ['c'], ['-']]), 'C-c -');
});

// ---- Section 6: Agenda, Hyperlinks & Babel Code Blocks -------------------------

test('Section 6: Store link to current position (g clears the chain before a plain letter)', () => {
  assert.equal(run([['c'], ['c'], ['g'], ['l']]), 'C-c l');
});

test('Section 6: Insert/edit hyperlink', () => {
  assert.equal(run([['c'], ['c'], ['l']]), 'C-c C-l');
});

test('Section 6: Open link under cursor', () => {
  assert.equal(run([['c'], ['c'], ['o']]), 'C-c C-o');
});

test('Section 6: Open Org Agenda view / Capture window (g clears the chain)', () => {
  assert.equal(run([['c'], ['c'], ['g'], ['a']]), 'C-c a');
  assert.equal(run([['c'], ['c'], ['g'], ['c']]), 'C-c c');
});

test('Section 6: Execute Org-Babel code block', () => {
  assert.equal(run([['c'], ['c'], ['c']]), 'C-c C-c');
});

test('Section 6: Open Export Dispatcher menu', () => {
  assert.equal(run([['c'], ['c'], ['e']]), 'C-c C-e');
});

// ---- state threading -----------------------------------------------------------

test('processKey returns an updated state that a caller can feed back in for the next keystroke, without needing to replay the whole sequence', () => {
  let state = initialState();
  let chordString;
  ({ state, chordString } = processKey(state, 'c', false));
  assert.equal(chordString, '', 'nothing committed yet -- awaiting a possible second "c"');
  ({ state, chordString } = processKey(state, 'c', false));
  assert.equal(chordString, 'C-c');
  ({ state, chordString } = processKey(state, 't', false));
  assert.equal(chordString, 'C-c C-t');
});

test('initialState starts with an empty chord string and no pending modifiers', () => {
  const state = initialState();
  assert.equal(state.chordString, '');
  assert.equal(state.pendingModifier, null);
  assert.equal(state.inCcChain, false);
});
