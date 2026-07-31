import test from 'node:test';
import assert from 'node:assert/strict';
import { decideProgressLogging } from '../src/progress-logging.js';

const SEQ = { todoKeywords: ['TODO', 'WAIT'], doneKeywords: ['DONE', 'KILL'] };

function decide(from, to, logDoneSetting, keepWhenNoTodo = false) {
  return decideProgressLogging(from, to, SEQ, logDoneSetting, keepWhenNoTodo);
}

// ---- 'time mode: entering DONE inserts CLOSED -----------------------

test('TODO -> DONE with \u0027time inserts CLOSED', () => {
  assert.deepEqual(decide('TODO', 'DONE', 'time'), { insertClosed: true, promptNote: false, removeClosed: false });
});

test('null (no keyword) -> DONE with \u0027time also inserts CLOSED', () => {
  assert.deepEqual(decide(null, 'DONE', 'time'), { insertClosed: true, promptNote: false, removeClosed: false });
});

test('WAIT -> KILL with \u0027time inserts CLOSED (any non-done -> any done keyword counts as entering DONE)', () => {
  assert.deepEqual(decide('WAIT', 'KILL', 'time'), { insertClosed: true, promptNote: false, removeClosed: false });
});

test('entering DONE with logDoneSetting null (no #+STARTUP: logdone) does nothing at all', () => {
  assert.deepEqual(decide('TODO', 'DONE', null), { insertClosed: false, promptNote: false, removeClosed: false });
});

test('entering DONE with \u0027note does NOT insert CLOSED -- the two settings are mutually exclusive, not combined', () => {
  const result = decide('TODO', 'DONE', 'note');
  assert.equal(result.insertClosed, false);
});

// ---- 'note mode: entering DONE prompts for a note --------------------

test('TODO -> DONE with \u0027note prompts for a note, does not insert CLOSED', () => {
  assert.deepEqual(decide('TODO', 'DONE', 'note'), { insertClosed: false, promptNote: true, removeClosed: false });
});

test('entering DONE with \u0027time does NOT prompt for a note', () => {
  const result = decide('TODO', 'DONE', 'time');
  assert.equal(result.promptNote, false);
});

// ---- already-done -> different-done: does NOT re-trigger entering-DONE logic ----

test('DONE -> KILL (already done, switching to a DIFFERENT done keyword) does not insert a second CLOSED or prompt again', () => {
  assert.deepEqual(decide('DONE', 'KILL', 'time'), { insertClosed: false, promptNote: false, removeClosed: false });
  assert.deepEqual(decide('DONE', 'KILL', 'note'), { insertClosed: false, promptNote: false, removeClosed: false });
});

// ---- leaving DONE: CLOSED removal, unconditional regardless of current setting ----

test('DONE -> TODO (cycled back to a different, non-done keyword) removes CLOSED, even with logDoneSetting null', () => {
  assert.deepEqual(decide('DONE', 'TODO', null), { insertClosed: false, promptNote: false, removeClosed: true });
});

test('DONE -> WAIT removes CLOSED regardless of org-closed-keep-when-no-todo (that setting only governs the null-target case)', () => {
  assert.deepEqual(decide('DONE', 'WAIT', null, /* keepWhenNoTodo */ true), {
    insertClosed: false,
    promptNote: false,
    removeClosed: true,
  });
});

test('DONE -> null (cycled all the way to no keyword) removes CLOSED by default (org-closed-keep-when-no-todo is nil)', () => {
  assert.deepEqual(decide('DONE', null, null, false), { insertClosed: false, promptNote: false, removeClosed: true });
});

test('DONE -> null with org-closed-keep-when-no-todo = t keeps CLOSED instead of removing it', () => {
  assert.deepEqual(decide('DONE', null, null, true), { insertClosed: false, promptNote: false, removeClosed: false });
});

test('removeClosed fires regardless of the CURRENT logDoneSetting -- cleaning up a stale CLOSED from an earlier \u0027time session even if logging is now off', () => {
  assert.equal(decide('DONE', 'TODO', null).removeClosed, true);
  assert.equal(decide('DONE', 'TODO', 'note').removeClosed, true);
  assert.equal(decide('DONE', 'TODO', 'time').removeClosed, true);
});

// ---- no-op transitions: neither entering nor leaving DONE -------------

test('TODO -> WAIT (neither state is done) does nothing at all', () => {
  assert.deepEqual(decide('TODO', 'WAIT', 'time'), { insertClosed: false, promptNote: false, removeClosed: false });
});

test('null -> TODO (starting to cycle, still not done) does nothing', () => {
  assert.deepEqual(decide(null, 'TODO', 'time'), { insertClosed: false, promptNote: false, removeClosed: false });
});

test('a heading staying in the exact same DONE state (not a real transition, but a defensive case) does nothing', () => {
  assert.deepEqual(decide('DONE', 'DONE', 'time'), { insertClosed: false, promptNote: false, removeClosed: false });
});

test('a heading staying in the exact same non-done state does nothing', () => {
  assert.deepEqual(decide('TODO', 'TODO', 'time'), { insertClosed: false, promptNote: false, removeClosed: false });
});

// ---- full round-trip scenario -------------------------------------------

test('full scenario: TODO -> DONE (insert) -> TODO (remove) -> DONE again (insert again)', () => {
  let state = { todo: 'TODO' };
  let d1 = decide(state.todo, 'DONE', 'time');
  assert.equal(d1.insertClosed, true);
  state.todo = 'DONE';

  let d2 = decide(state.todo, 'TODO', 'time');
  assert.equal(d2.removeClosed, true);
  state.todo = 'TODO';

  let d3 = decide(state.todo, 'DONE', 'time');
  assert.equal(d3.insertClosed, true);
});
