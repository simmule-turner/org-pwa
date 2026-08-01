import test from 'node:test';
import assert from 'node:assert/strict';
import { decideProgressLogging, decideLogbookEntry, effectiveLogSpec, parseLogSpec, getEffectiveLogDoneSetting } from '../src/progress-logging.js';

const SEQ = { todoKeywords: ['TODO', 'WAIT'], doneKeywords: ['DONE', 'KILL'], logSpecs: {} };

function decideClosed(from, to, logDoneSetting, keepWhenNoTodo = false) {
  return decideProgressLogging(from, to, SEQ, logDoneSetting, keepWhenNoTodo);
}

// ==== decideProgressLogging (CLOSED planning line only) ===================

test('TODO -> DONE with \u0027time inserts CLOSED', () => {
  assert.deepEqual(decideClosed('TODO', 'DONE', 'time'), { insertClosed: true, removeClosed: false });
});

test('null (no keyword) -> DONE with \u0027time also inserts CLOSED', () => {
  assert.deepEqual(decideClosed(null, 'DONE', 'time'), { insertClosed: true, removeClosed: false });
});

test('WAIT -> KILL with \u0027time inserts CLOSED (any non-done -> any done keyword counts as entering DONE)', () => {
  assert.deepEqual(decideClosed('WAIT', 'KILL', 'time'), { insertClosed: true, removeClosed: false });
});

test('entering DONE with logDoneSetting null (no #+STARTUP: logdone) inserts nothing', () => {
  assert.deepEqual(decideClosed('TODO', 'DONE', null), { insertClosed: false, removeClosed: false });
});

test('entering DONE with \u0027note does NOT insert CLOSED -- CLOSED is \u0027time-only, \u0027note is handled entirely by decideLogbookEntry instead', () => {
  assert.equal(decideClosed('TODO', 'DONE', 'note').insertClosed, false);
});

test('DONE -> KILL (already done, switching to a DIFFERENT done keyword) does not insert a second CLOSED', () => {
  assert.deepEqual(decideClosed('DONE', 'KILL', 'time'), { insertClosed: false, removeClosed: false });
});

test('DONE -> TODO removes CLOSED, even with logDoneSetting null (cleanup of a stale timestamp)', () => {
  assert.deepEqual(decideClosed('DONE', 'TODO', null), { insertClosed: false, removeClosed: true });
});

test('DONE -> WAIT removes CLOSED regardless of org-closed-keep-when-no-todo (that setting only governs the null-target case)', () => {
  assert.deepEqual(decideClosed('DONE', 'WAIT', null, true), { insertClosed: false, removeClosed: true });
});

test('DONE -> null removes CLOSED by default (org-closed-keep-when-no-todo is nil)', () => {
  assert.deepEqual(decideClosed('DONE', null, null, false), { insertClosed: false, removeClosed: true });
});

test('DONE -> null with org-closed-keep-when-no-todo = t keeps CLOSED instead of removing it', () => {
  assert.deepEqual(decideClosed('DONE', null, null, true), { insertClosed: false, removeClosed: false });
});

test('removeClosed fires regardless of the CURRENT logDoneSetting', () => {
  assert.equal(decideClosed('DONE', 'TODO', null).removeClosed, true);
  assert.equal(decideClosed('DONE', 'TODO', 'note').removeClosed, true);
  assert.equal(decideClosed('DONE', 'TODO', 'time').removeClosed, true);
});

test('TODO -> WAIT (neither state is done) does nothing at all', () => {
  assert.deepEqual(decideClosed('TODO', 'WAIT', 'time'), { insertClosed: false, removeClosed: false });
});

test('a heading staying in the exact same state does nothing', () => {
  assert.deepEqual(decideClosed('DONE', 'DONE', 'time'), { insertClosed: false, removeClosed: false });
  assert.deepEqual(decideClosed('TODO', 'TODO', 'time'), { insertClosed: false, removeClosed: false });
});

// ==== parseLogSpec ==========================================================

test('parseLogSpec: "@" is an entering-note-only spec', () => {
  assert.deepEqual(parseLogSpec('@'), { enterNote: true, enterTimestamp: false, leaveTimestamp: false });
});

test('parseLogSpec: "!" is an entering-timestamp-only spec', () => {
  assert.deepEqual(parseLogSpec('!'), { enterNote: false, enterTimestamp: true, leaveTimestamp: false });
});

test('parseLogSpec: "@/!" is entering-note PLUS leaving-timestamp', () => {
  assert.deepEqual(parseLogSpec('@/!'), { enterNote: true, enterTimestamp: false, leaveTimestamp: true });
});

test('parseLogSpec: "/!" is leaving-timestamp ONLY, no entering behavior at all', () => {
  assert.deepEqual(parseLogSpec('/!'), { enterNote: false, enterTimestamp: false, leaveTimestamp: true });
});

test('parseLogSpec: null or an unrecognized string means no logging at all', () => {
  assert.deepEqual(parseLogSpec(null), { enterNote: false, enterTimestamp: false, leaveTimestamp: false });
  assert.deepEqual(parseLogSpec('garbage'), { enterNote: false, enterTimestamp: false, leaveTimestamp: false });
});

// ==== effectiveLogSpec ======================================================

test('effectiveLogSpec: an explicit per-keyword spec is used directly', () => {
  const seq = { doneKeywords: ['DONE'], logSpecs: { DONE: '!' } };
  assert.equal(effectiveLogSpec('DONE', seq, null), '!');
});

test('effectiveLogSpec: an explicit spec wins even when org-log-done would otherwise apply', () => {
  const seq = { doneKeywords: ['DONE'], logSpecs: { DONE: '@' } };
  assert.equal(effectiveLogSpec('DONE', seq, 'time'), '@'); // not '!' from the 'time setting -- the explicit spec wins
});

test('effectiveLogSpec: org-log-done \u0027time synthesizes "!" for a done keyword with no explicit spec', () => {
  const seq = { doneKeywords: ['DONE'], logSpecs: {} };
  assert.equal(effectiveLogSpec('DONE', seq, 'time'), '!');
});

test('effectiveLogSpec: org-log-done \u0027note synthesizes "@" for a done keyword with no explicit spec', () => {
  const seq = { doneKeywords: ['DONE'], logSpecs: {} };
  assert.equal(effectiveLogSpec('DONE', seq, 'note'), '@');
});

test('effectiveLogSpec: org-log-done never applies to a non-done keyword, even with no explicit spec', () => {
  const seq = { doneKeywords: ['DONE'], logSpecs: {} };
  assert.equal(effectiveLogSpec('TODO', seq, 'time'), null);
});

test('effectiveLogSpec: null keyword (no TODO state at all) always has no effective spec', () => {
  const seq = { doneKeywords: ['DONE'], logSpecs: { DONE: '!' } };
  assert.equal(effectiveLogSpec(null, seq, 'time'), null);
});

// ==== decideLogbookEntry: the exact worked example from the original spec ====
// #+TODO: TODO(t) WAIT(w@/!) | DONE(d!) KILL(k@)

const SPEC_SEQ = { todoKeywords: ['TODO', 'WAIT'], doneKeywords: ['DONE', 'KILL'], logSpecs: { WAIT: '@/!', DONE: '!', KILL: '@' } };

test('worked example: WAIT -> DONE -- DONE already logs on entry, so WAIT\u2019s own leaving-log has no OBSERVABLE extra effect (still logs once, via DONE\u2019s own entry spec)', () => {
  const result = decideLogbookEntry('WAIT', 'DONE', SPEC_SEQ, null);
  assert.equal(result.shouldLog, true); // DONE's own "!" still logs the transition
  assert.equal(result.needsNote, false); // timestamp only, not a note
});

test('worked example: WAIT -> TODO -- TODO has NO logging of its own, so WAIT\u2019s own "/!" leaving-log fires', () => {
  const result = decideLogbookEntry('WAIT', 'TODO', SPEC_SEQ, null);
  assert.equal(result.shouldLog, true);
  assert.equal(result.needsNote, false); // leaving-log is always timestamp-only, never a note
});

test('worked example: TODO -> WAIT -- entering WAIT triggers its own "@" (note on entry)', () => {
  const result = decideLogbookEntry('TODO', 'WAIT', SPEC_SEQ, null);
  assert.equal(result.shouldLog, true);
  assert.equal(result.needsNote, true);
});

test('worked example: TODO -> DONE -- entering DONE triggers its own "!" (timestamp only)', () => {
  const result = decideLogbookEntry('TODO', 'DONE', SPEC_SEQ, null);
  assert.equal(result.shouldLog, true);
  assert.equal(result.needsNote, false);
});

test('worked example: TODO -> KILL -- entering KILL triggers its own "@" (note on entry)', () => {
  const result = decideLogbookEntry('TODO', 'KILL', SPEC_SEQ, null);
  assert.equal(result.shouldLog, true);
  assert.equal(result.needsNote, true);
});

// ==== decideLogbookEntry: the suppression logic is directly observable =======

test('the leaving-log rule genuinely fires (not just coincidentally masked) when the target has NO entry logging at all', () => {
  const seq = { todoKeywords: ['TODO', 'WAIT'], doneKeywords: ['DONE'], logSpecs: { WAIT: '@/!' } }; // DONE has no spec of its own
  const result = decideLogbookEntry('WAIT', 'DONE', seq, null);
  assert.equal(result.shouldLog, true); // fires via WAIT's own /!, since DONE doesn't log on entry
});

test('a transition between two entirely unlogged keywords never logs anything', () => {
  const seq = { todoKeywords: ['TODO', 'NEXT'], doneKeywords: ['DONE'], logSpecs: {} };
  assert.deepEqual(decideLogbookEntry('TODO', 'NEXT', seq, null), { shouldLog: false, needsNote: false });
});

test('the same keyword (no real transition) never logs, even if it has its own spec', () => {
  const seq = { todoKeywords: ['TODO'], doneKeywords: ['DONE'], logSpecs: { DONE: '!' } };
  assert.deepEqual(decideLogbookEntry('DONE', 'DONE', seq, null), { shouldLog: false, needsNote: false });
});

// ==== decideLogbookEntry: org-log-done as a synthesized fallback (unifying Layer 1's 'note) ====

test('org-log-done \u0027note (no explicit per-keyword spec on any done keyword) makes entering DONE need a note, purely via the synthesized fallback', () => {
  const seq = { todoKeywords: ['TODO'], doneKeywords: ['DONE'], logSpecs: {} };
  const result = decideLogbookEntry('TODO', 'DONE', seq, 'note');
  assert.equal(result.shouldLog, true);
  assert.equal(result.needsNote, true);
});

test('org-log-done \u0027time (no explicit per-keyword spec) makes entering DONE log a bare timestamp via the same synthesized-fallback mechanism', () => {
  const seq = { todoKeywords: ['TODO'], doneKeywords: ['DONE'], logSpecs: {} };
  const result = decideLogbookEntry('TODO', 'DONE', seq, 'time');
  assert.equal(result.shouldLog, true);
  assert.equal(result.needsNote, false);
});

test('an explicit per-keyword spec on a done keyword overrides org-log-done entirely for that keyword', () => {
  const seq = { todoKeywords: ['TODO'], doneKeywords: ['DONE'], logSpecs: { DONE: '!' } }; // explicit timestamp-only
  const result = decideLogbookEntry('TODO', 'DONE', seq, 'note'); // org-log-done says note, but DONE's own spec wins
  assert.equal(result.needsNote, false); // the explicit "!" wins, not the synthesized "@" from 'note
});

test('org-log-done set, but leaving a done state to a keyword with no logging: still removes nothing extra from LOGBOOK (only CLOSED\u2019s own removal, a separate mechanism, applies)', () => {
  const seq = { todoKeywords: ['TODO'], doneKeywords: ['DONE'], logSpecs: {} };
  const result = decideLogbookEntry('DONE', 'TODO', seq, 'time');
  // DONE's effective spec via 'time is "!" (entry-only, no leaveTimestamp component), so leaving it logs nothing new here
  assert.equal(result.shouldLog, false);
});

// ==== getEffectiveLogDoneSetting: 3-layer precedence ========================
// Global Variables (lowest) < #+STARTUP (middle) < file-local Local Variables (highest)

test('precedence: only Global Variables set -- that value applies', () => {
  const result = getEffectiveLogDoneSetting({}, { logDone: null }, { 'org-log-done': "'time" });
  assert.equal(result, 'time');
});

test('precedence: #+STARTUP overrides Global Variables', () => {
  const result = getEffectiveLogDoneSetting({}, { logDone: 'note' }, { 'org-log-done': "'time" });
  assert.equal(result, 'note');
});

test('precedence: file-local Local Variables overrides Global Variables (with no #+STARTUP)', () => {
  const result = getEffectiveLogDoneSetting({ 'org-log-done': "'note" }, { logDone: null }, { 'org-log-done': "'time" });
  assert.equal(result, 'note');
});

test('precedence: file-local Local Variables overrides #+STARTUP too (the highest layer wins over the middle one)', () => {
  const result = getEffectiveLogDoneSetting({ 'org-log-done': "'note" }, { logDone: 'time' }, { 'org-log-done': "'time" });
  assert.equal(result, 'note');
});

test('precedence: nothing set anywhere resolves to null (no logging), matching real org\u2019s own out-of-the-box default', () => {
  assert.equal(getEffectiveLogDoneSetting({}, { logDone: null }, {}), null);
});

test('precedence: an unrecognized Global Variables value (not \u0027time or \u0027note) is treated as unset, falling through correctly', () => {
  const result = getEffectiveLogDoneSetting({}, { logDone: null }, { 'org-log-done': 'garbage' });
  assert.equal(result, null);
});

test('precedence: a leading Lisp quote mark on the value is correctly stripped', () => {
  assert.equal(getEffectiveLogDoneSetting({}, { logDone: null }, { 'org-log-done': "'note" }), 'note');
  assert.equal(getEffectiveLogDoneSetting({}, { logDone: null }, { 'org-log-done': 'note' }), 'note'); // also works without the quote mark
});

test('precedence: #+STARTUP set to null (not configured) correctly falls through to Global Variables, not treated as an explicit "no logging" override', () => {
  const result = getEffectiveLogDoneSetting({}, { logDone: null }, { 'org-log-done': "'time" });
  assert.equal(result, 'time');
});
