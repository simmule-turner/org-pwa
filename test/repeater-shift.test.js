import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import { computeShiftedDate, shiftTimestampString, applyRepeaterShiftOnDone } from '../src/repeater-shift.js';

const SEQ = { todoKeywords: ['TODO', 'NEXT'], doneKeywords: ['DONE'] };

// ---- computeShiftedDate -----------------------------------------------------

test('cumulate (+): one interval forward from the OLD date, even if the result is still in the past', () => {
  const old = new Date(2026, 0, 1); // Jan 1
  const now = new Date(2026, 5, 1); // completed months later
  const result = computeShiftedDate('+', 1, 'w', old, now);
  assert.equal(result.getMonth(), 0);
  assert.equal(result.getDate(), 8); // one week later, NOT caught up to "now"
});

test('catch-up (++): repeatedly adds the interval to the OLD date until strictly after today, preserving day-of-week/time-of-day', () => {
  // Real-world example: SCHEDULED <2022-01-23 Sun ++1w>, completed [2022-01-29 Sat 09:35]
  const old = new Date(2022, 0, 23); // Sunday
  const now = new Date(2022, 0, 29, 9, 35); // the following Saturday
  const result = computeShiftedDate('++', 1, 'w', old, now);
  assert.equal(result.getFullYear(), 2022);
  assert.equal(result.getMonth(), 0);
  assert.equal(result.getDate(), 30); // the NEXT Sunday after completion
  assert.equal(result.getDay(), 0); // still a Sunday -- day-of-week preserved
});

test('restart (.+): bases the new date off TODAY (completion date), ignoring the old date\u2019s own position entirely', () => {
  // Real-world example: SCHEDULED <2022-01-23 Sun .+1w>, completed [2022-01-29 Sat 09:28]
  const old = new Date(2022, 0, 23); // Sunday
  const now = new Date(2022, 0, 29, 9, 28); // Saturday
  const result = computeShiftedDate('.+', 1, 'w', old, now);
  assert.equal(result.getFullYear(), 2022);
  assert.equal(result.getMonth(), 1);
  assert.equal(result.getDate(), 5); // one week after the COMPLETION date, a Saturday
  assert.equal(result.getDay(), 6); // Saturday, matching the completion day, NOT the original Sunday
});

test('catch-up (++) needing MULTIPLE iterations to actually catch up (missed several occurrences in a row)', () => {
  const old = new Date(2026, 0, 1); // Jan 1
  const now = new Date(2026, 2, 1); // completed 2 months later -- several weekly occurrences missed
  const result = computeShiftedDate('++', 1, 'w', old, now);
  assert.ok(result > now, 'the result must land strictly in the future relative to completion');
  // Should still be a Thursday (2026-01-01 is a Thursday), matching the original day-of-week
  assert.equal(result.getDay(), old.getDay());
});

// ---- shiftTimestampString ---------------------------------------------------

test('shiftTimestampString preserves the repeater, active/inactive bracket style, and any delay suffix -- only the date itself changes', () => {
  const now = new Date(2026, 0, 15);
  const result = shiftTimestampString('<2026-01-01 Thu +1w>', now);
  assert.equal(result, '<2026-01-08 Thu +1w>');
});

test('shiftTimestampString preserves a delay/warning-period suffix alongside the repeater', () => {
  const now = new Date(2026, 0, 15);
  const result = shiftTimestampString('<2026-01-01 Thu +1w -2d>', now);
  assert.equal(result, '<2026-01-08 Thu +1w -2d>');
});

test('shiftTimestampString preserves a time-of-day component', () => {
  const now = new Date(2026, 0, 15);
  const result = shiftTimestampString('<2026-01-01 Thu 09:00 +1w>', now);
  assert.equal(result, '<2026-01-08 Thu 09:00 +1w>');
});

test('shiftTimestampString returns null for a timestamp with NO repeater at all -- nothing for this module to do', () => {
  const now = new Date(2026, 0, 15);
  assert.equal(shiftTimestampString('<2026-01-01 Thu>', now), null);
});

test('shiftTimestampString returns null for an unparseable/empty string', () => {
  assert.equal(shiftTimestampString('', new Date()), null);
  assert.equal(shiftTimestampString(null, new Date()), null);
});

// ---- applyRepeaterShiftOnDone -----------------------------------------------

test('THE FEATURE: marking a heading with a repeating SCHEDULED as done shifts the date and bounces todo back to the first keyword in the sequence', () => {
  const doc = parseOrg('* DONE Pay phone bill\nSCHEDULED: <2012-05-07 Mon 18:00 +1m>\n');
  const heading = doc.children[0];
  const now = new Date(2012, 4, 10);

  const shifted = applyRepeaterShiftOnDone(heading, SEQ, now);

  assert.equal(shifted, true);
  assert.equal(heading.todo, 'TODO'); // bounced back to the FIRST todo keyword
  assert.equal(heading.planning.scheduled, '<2012-06-07 Thu 18:00 +1m>');
});

test('THE FEATURE: LAST_REPEAT is stamped with the completion moment', () => {
  const doc = parseOrg('* DONE Pay phone bill\nSCHEDULED: <2012-05-07 Mon 18:00 +1m>\n');
  const heading = doc.children[0];
  const now = new Date(2012, 4, 10, 14, 30);

  applyRepeaterShiftOnDone(heading, SEQ, now);

  assert.equal(heading.properties.LAST_REPEAT, '[2012-05-10 Thu 14:30]');
});

test('THE FEATURE: both SCHEDULED and DEADLINE shift independently when both have their own repeater', () => {
  const doc = parseOrg('* DONE Task\nSCHEDULED: <2026-01-01 Thu +1w> DEADLINE: <2026-01-03 Sat +1w>\n');
  const heading = doc.children[0];
  const now = new Date(2026, 0, 5);

  applyRepeaterShiftOnDone(heading, SEQ, now);

  assert.equal(heading.planning.scheduled, '<2026-01-08 Thu +1w>');
  assert.equal(heading.planning.deadline, '<2026-01-10 Sat +1w>');
});

test('a heading with a SCHEDULED but no repeater at all is genuinely completed -- no shift, todo unchanged, per real org', () => {
  const doc = parseOrg('* DONE Task\nSCHEDULED: <2026-01-01 Thu>\n');
  const heading = doc.children[0];
  const shifted = applyRepeaterShiftOnDone(heading, SEQ, new Date());

  assert.equal(shifted, false);
  assert.equal(heading.todo, 'DONE'); // stays done -- nothing to bounce back for
  assert.equal(heading.planning.scheduled, '<2026-01-01 Thu>'); // untouched
  assert.equal('LAST_REPEAT' in heading.properties, false);
});

test('a heading with no SCHEDULED or DEADLINE at all is unaffected', () => {
  const doc = parseOrg('* DONE Task\n');
  const heading = doc.children[0];
  const shifted = applyRepeaterShiftOnDone(heading, SEQ, new Date());
  assert.equal(shifted, false);
  assert.equal(heading.todo, 'DONE');
});
