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

// ---- the core rules, in isolation (real god-mode.el's own actual rules,
//      confirmed directly against github.com/emacsorphanage/god-mode) -----

test('a single plain letter defaults to Control', () => {
  assert.equal(run([['t']]), 'C-t');
});

test('a single plain punctuation character also defaults to Control outside any chain', () => {
  assert.equal(run([[',']]), 'C-,');
});

test('THE FIX: "g" prefixes the very next key with Meta, consuming no chord of its own -- real god-mode.el\u2019s own actual g, not this app\u2019s own earlier, incorrect "m"', () => {
  assert.equal(run([['g'], ['x']]), 'M-x');
});

test('THE FEATURE: "G" (Shift+g) prefixes the very next key with Control+Meta', () => {
  assert.equal(run([['G'], ['n']]), 'C-M-n');
});

test('a bare named key (arrow/Tab/RET) never defaults to Control -- ordinary cursor movement must stay usable while god-mode is active', () => {
  assert.equal(run([['ArrowUp']]), '<up>');
  assert.equal(run([['ArrowDown']]), '<down>');
  assert.equal(run([['Tab']]), 'TAB');
  assert.equal(run([['Enter']]), 'RET');
});

test('Shift held alongside a bare named key passes through as S-<key>, with no Control at all', () => {
  assert.equal(run([['ArrowUp', true]]), 'S-<up>');
  assert.equal(run([['ArrowDown', true]]), 'S-<down>');
  assert.equal(run([['Tab', true]]), 'S-TAB');
});

test('THE FEATURE: SPC (the literal key) toggles literal mode, consuming no chord of its own -- real god-mode.el\u2019s own actual mechanism, replacing this app\u2019s own earlier, incorrect "g clears the chain"', () => {
  assert.equal(run([[' ']]), '');
});

test('THE EXACT REQUEST: "g x -> M-x" from the provided example table', () => {
  assert.equal(run([['g'], ['x']]), 'M-x');
});

test('THE EXACT REQUEST: "G n -> C-M-n" from the provided example table', () => {
  assert.equal(run([['G'], ['n']]), 'C-M-n');
});

test('THE EXACT REQUEST: "g <up> -> M-<up>" from the provided example table', () => {
  assert.equal(run([['g'], ['ArrowUp']]), 'M-<up>');
});

test('THE EXACT REQUEST: "c c -> C-c C-c" from the provided example table -- a SECOND "c" is just another letter auto-Controlled inside the chain, not a special 2-key case', () => {
  assert.equal(run([['c'], ['c']]), 'C-c C-c');
});

test('THE EXACT REQUEST: "c s -> C-c C-s" from the provided example table', () => {
  assert.equal(run([['c'], ['s']]), 'C-c C-s');
});

test('THE EXACT REQUEST: "c t -> C-c C-t" from the provided example table -- only ONE "c" is needed, not two', () => {
  assert.equal(run([['c'], ['t']]), 'C-c C-t');
});

test('THE EXACT REQUEST: "c . -> C-c ." (literal dot) from the provided example table', () => {
  assert.equal(run([['c'], ['.']]), 'C-c .');
});

test('THE EXACT REQUEST: "c | -> C-c |" from the provided example table', () => {
  assert.equal(run([['c'], ['|']]), 'C-c |');
});

test('THE EXACT REQUEST: "c SPC g -> C-c g" (literal g) from the provided example table', () => {
  assert.equal(run([['c'], [' '], ['g']]), 'C-c g');
});

test('within the c-chain, a letter key auto-applies Control', () => {
  assert.equal(run([['c'], ['t']]), 'C-c C-t');
});

test('within the c-chain, a punctuation key stays literal -- matches real org\u2019s own mixed "C-c C-t" / "C-c ." bindings', () => {
  assert.equal(run([['c'], [',']]), 'C-c ,');
  assert.equal(run([['c'], ['.']]), 'C-c .');
});

test('SPC is sticky -- once toggled on, stays literal across MULTIPLE subsequent keys until toggled off again, matching real god-mode.el\u2019s own documented "x SPC r t -> C-x r t" example exactly', () => {
  assert.equal(run([['x'], [' '], ['r'], ['t']]), 'C-x r t');
});

test('SPC toggles back OFF on a second press -- subsequent keys resume auto-Control', () => {
  assert.equal(run([['x'], [' '], ['s'], [' '], ['q']]), 'C-x s C-q');
});

test('SPC pressed while literal mode is already active makes "g"/"G" themselves literal too, not modifier prefixes', () => {
  assert.equal(run([['c'], [' '], ['g']]), 'C-c g');
  assert.equal(run([['c'], [' '], ['G']]), 'C-c G');
});

test('there is no way to type a bare C-g -- "g" always means "the next key gets Meta", matching real god-mode.el\u2019s own documented limitation exactly', () => {
  assert.equal(run([['g'], ['g']]), 'M-g'); // a second "g" is simply the TARGET of the first g's own Meta prefix
});

// ---- every existing GOD_MODE_ACTIONS trigger sequence, re-derived and
//      individually verified against the new engine -----------------------

test('Section 1: Move heading/list item Up/Down', () => {
  assert.equal(run([['g'], ['ArrowUp']]), 'M-<up>');
  assert.equal(run([['g'], ['ArrowDown']]), 'M-<down>');
});

test('Section 1: Demote/Promote heading/list item', () => {
  assert.equal(run([['g'], ['ArrowRight']]), 'M-<right>');
  assert.equal(run([['g'], ['ArrowLeft']]), 'M-<left>');
});

test('Section 1: Demote/Promote entire subtree', () => {
  assert.equal(run([['g'], ['ArrowRight', true]]), 'M-S-<right>');
  assert.equal(run([['g'], ['ArrowLeft', true]]), 'M-S-<left>');
});

test('Section 1: Move to next/previous heading (same level)', () => {
  assert.equal(run([['c'], ['f']]), 'C-c C-f');
  assert.equal(run([['c'], ['b']]), 'C-c C-b');
});

test('Section 1: Move up to parent heading', () => {
  assert.equal(run([['c'], ['u']]), 'C-c C-u');
});

test('Section 1: Move to next/previous visible heading, any level', () => {
  assert.equal(run([['c'], ['n']]), 'C-c C-n');
  assert.equal(run([['c'], ['p']]), 'C-c C-p');
});

test('Section 2: Insert heading / TODO heading', () => {
  assert.equal(run([['g'], ['Enter']]), 'M-RET');
  assert.equal(run([['g'], ['Enter', true]]), 'M-S-RET');
});

test('Section 2: Toggle checkbox status / evaluate (C-c C-c itself)', () => {
  assert.equal(run([['c'], ['c']]), 'C-c C-c');
});

test('Section 3: Cycle TODO state', () => {
  assert.equal(run([['c'], ['t']]), 'C-c C-t');
});

test('Section 3: Set task priority', () => {
  assert.equal(run([['c'], [',']]), 'C-c ,');
});

test('Section 3: Show sparse TODO tree', () => {
  assert.equal(run([['c'], ['v']]), 'C-c C-v');
});

test('Section 4: Insert active/inactive date', () => {
  assert.equal(run([['c'], ['.']]), 'C-c .');
  assert.equal(run([['c'], ['!']]), 'C-c !');
});

test('Section 4: Insert DEADLINE/SCHEDULED timestamp', () => {
  assert.equal(run([['c'], ['d']]), 'C-c C-d');
  assert.equal(run([['c'], ['s']]), 'C-c C-s');
});

test('Section 4: Shift date under cursor', () => {
  assert.equal(run([['ArrowUp', true]]), 'S-<up>');
  assert.equal(run([['ArrowDown', true]]), 'S-<down>');
});

test('Section 5: Create table / convert region', () => {
  assert.equal(run([['c'], ['|']]), 'C-c |');
});

test('Section 5: Move to next cell / re-align', () => {
  assert.equal(run([['Tab']]), 'TAB');
});

test('Section 6: Store link to current position -- needs SPC now, since a bare "l" auto-Controls inside the chain (real god-mode.el has no "g clears the chain" mechanism at all)', () => {
  assert.equal(run([['c'], [' '], ['l']]), 'C-c l');
});

test('Section 6: Insert/edit hyperlink', () => {
  assert.equal(run([['c'], ['l']]), 'C-c C-l');
});

test('Section 6: Open link under cursor', () => {
  assert.equal(run([['c'], ['o']]), 'C-c C-o');
});

test('Section 6: Open Org Agenda view / Capture window -- both need SPC for the same reason as store-link above', () => {
  assert.equal(run([['c'], [' '], ['a']]), 'C-c a');
  assert.equal(run([['c'], [' '], ['c']]), 'C-c c');
});

test('Section 6: Open Export Dispatcher menu', () => {
  assert.equal(run([['c'], ['e']]), 'C-c C-e');
});

test('THE EXACT REQUEST: "C-h i" (real Emacs\u2019s own actual Info binding) reached via "h SPC i" -- h needs zero special-casing in the new engine, unlike this app\u2019s own earlier, bespoke "h i" literal-sequence hack', () => {
  assert.equal(run([['h'], [' '], ['i']]), 'C-h i');
});

// ---- state threading -----------------------------------------------------------

test('processKey returns an updated state that a caller can feed back in for the next keystroke, without needing to replay the whole sequence', () => {
  let state = initialState();
  let chordString;
  ({ state, chordString } = processKey(state, 'c', false));
  assert.equal(chordString, 'C-c');
  ({ state, chordString } = processKey(state, 't', false));
  assert.equal(chordString, 'C-c C-t');
});

test('initialState starts with an empty chord string, no pending modifier, literal mode off, and no active chain', () => {
  const state = initialState();
  assert.equal(state.chordString, '');
  assert.equal(state.pendingModifier, null);
  assert.equal(state.literalActive, false);
  assert.equal(state.inCcChain, false);
});
