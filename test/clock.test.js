import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import { formatOrgTimestamp } from '../src/org-timestamp.js';
import { isClockRunning, clockIn, clockOut, clockCancel, formatClockDuration, parseClockDuration, totalClockedMinutes, findHeadingWithRunningClock } from '../src/clock.js';

function ts(date, timeStr) {
  return formatOrgTimestamp({ date, time: timeStr, active: false });
}

// ---- formatClockDuration / parseClockDuration ------------------------------

test('formatClockDuration: minutes only, always two digits', () => {
  assert.equal(formatClockDuration(5), '0:05');
  assert.equal(formatClockDuration(30), '0:30');
});

test('formatClockDuration: hours unpadded', () => {
  assert.equal(formatClockDuration(90), '1:30');
  assert.equal(formatClockDuration(600), '10:00');
});

test('parseClockDuration: round-trips with formatClockDuration', () => {
  assert.equal(parseClockDuration(formatClockDuration(125)), 125);
});

test('parseClockDuration: an unparseable value returns 0 rather than throwing', () => {
  assert.equal(parseClockDuration('garbage'), 0);
  assert.equal(parseClockDuration(''), 0);
  assert.equal(parseClockDuration(null), 0);
});

// ---- isClockRunning / clockIn / clockOut -----------------------------------

test('a heading with no LOGBOOK content at all has no running clock', () => {
  const doc = parseOrg('* Task\n');
  assert.equal(isClockRunning(doc.children[0]), false);
});

test('clockIn inserts a bare "CLOCK: [timestamp]" line at the top of logbookLines', () => {
  const doc = parseOrg('* Task\n');
  const heading = doc.children[0];
  const start = new Date(2026, 6, 31, 9, 0);
  const ok = clockIn(heading, ts(start, '09:00'));
  assert.equal(ok, true);
  assert.equal(heading.logbookLines.length, 1);
  assert.match(heading.logbookLines[0], /^CLOCK: \[2026-07-31 Fri 09:00\]$/);
});

test('clockIn correctly reports the clock as running afterward', () => {
  const doc = parseOrg('* Task\n');
  const heading = doc.children[0];
  clockIn(heading, ts(new Date(2026, 6, 31, 9, 0), '09:00'));
  assert.equal(isClockRunning(heading), true);
});

test('clockIn on an ALREADY-running clock is a no-op, matching real org\u2019s own refusal to double-start', () => {
  const doc = parseOrg('* Task\n');
  const heading = doc.children[0];
  clockIn(heading, ts(new Date(2026, 6, 31, 9, 0), '09:00'));
  const secondAttempt = clockIn(heading, ts(new Date(2026, 6, 31, 9, 5), '09:05'));
  assert.equal(secondAttempt, false);
  assert.equal(heading.logbookLines.length, 1); // nothing new was added
});

test('clockOut on a heading with NOTHING running is a no-op', () => {
  const doc = parseOrg('* Task\n');
  const heading = doc.children[0];
  const ok = clockOut(heading, ts(new Date(), '00:00'), new Date());
  assert.equal(ok, false);
});

test('clockOut replaces the running line with the completed "start--end => H:MM" form, matching real org\u2019s own exact format', () => {
  const doc = parseOrg('* Task\n');
  const heading = doc.children[0];
  const start = new Date(2026, 6, 31, 9, 0);
  clockIn(heading, ts(start, '09:00'));
  const end = new Date(2026, 6, 31, 10, 30);
  const ok = clockOut(heading, ts(end, '10:30'), end);
  assert.equal(ok, true);
  assert.equal(heading.logbookLines.length, 1);
  assert.equal(heading.logbookLines[0], 'CLOCK: [2026-07-31 Fri 09:00]--[2026-07-31 Fri 10:30] =>  1:30');
});

test('clockOut correctly computes the duration directly from the two actual timestamps, not a separately-trusted value', () => {
  const doc = parseOrg('* Task\n');
  const heading = doc.children[0];
  const start = new Date(2026, 6, 31, 9, 0);
  clockIn(heading, ts(start, '09:00'));
  const end = new Date(2026, 6, 31, 9, 5); // only 5 minutes
  clockOut(heading, ts(end, '09:05'), end);
  assert.match(heading.logbookLines[0], /=> {2}0:05$/);
});

test('after clockOut, the clock is no longer reported as running', () => {
  const doc = parseOrg('* Task\n');
  const heading = doc.children[0];
  const start = new Date(2026, 6, 31, 9, 0);
  clockIn(heading, ts(start, '09:00'));
  clockOut(heading, ts(new Date(2026, 6, 31, 10, 0), '10:00'), new Date(2026, 6, 31, 10, 0));
  assert.equal(isClockRunning(heading), false);
});

test('clocking in again after clocking out adds a SECOND clock entry, preserving the first', () => {
  const doc = parseOrg('* Task\n');
  const heading = doc.children[0];
  const start1 = new Date(2026, 6, 31, 9, 0);
  clockIn(heading, ts(start1, '09:00'));
  clockOut(heading, ts(new Date(2026, 6, 31, 10, 0), '10:00'), new Date(2026, 6, 31, 10, 0));
  const start2 = new Date(2026, 6, 31, 14, 0);
  clockIn(heading, ts(start2, '14:00'));
  assert.equal(heading.logbookLines.length, 2);
  assert.match(heading.logbookLines[0], /14:00/); // most recent first
  assert.match(heading.logbookLines[1], /=> {2}1:00/); // the earlier, completed session preserved
});

// ---- totalClockedMinutes ----------------------------------------------------

test('totalClockedMinutes: a heading with no clocking at all is 0', () => {
  const doc = parseOrg('* Task\n');
  assert.equal(totalClockedMinutes(doc.children[0]), 0);
});

test('totalClockedMinutes: sums every completed clock entry directly on the heading', () => {
  const doc = parseOrg(
    '* Task\n:LOGBOOK:\nCLOCK: [2026-07-31 Fri 09:00]--[2026-07-31 Fri 10:00] =>  1:00\nCLOCK: [2026-07-30 Thu 09:00]--[2026-07-30 Thu 09:30] =>  0:30\n:END:\n'
  );
  assert.equal(totalClockedMinutes(doc.children[0]), 90);
});

test('totalClockedMinutes: includes every descendant\u2019s own clocked time too, matching real org\u2019s "this task and its children"', () => {
  const doc = parseOrg(
    '* Parent\n:LOGBOOK:\nCLOCK: [2026-07-31 Fri 09:00]--[2026-07-31 Fri 09:30] =>  0:30\n:END:\n** Child\n:LOGBOOK:\nCLOCK: [2026-07-31 Fri 10:00]--[2026-07-31 Fri 10:15] =>  0:15\n:END:\n*** Grandchild\n:LOGBOOK:\nCLOCK: [2026-07-31 Fri 11:00]--[2026-07-31 Fri 11:05] =>  0:05\n:END:\n'
  );
  assert.equal(totalClockedMinutes(doc.children[0]), 50); // 30 + 15 + 5
});

test('totalClockedMinutes: a currently-running clock contributes its own elapsed-so-far time, given the reference "now"', () => {
  const doc = parseOrg('* Task\n');
  const heading = doc.children[0];
  const start = new Date(2026, 6, 31, 9, 0);
  clockIn(heading, ts(start, '09:00'));
  const now = new Date(2026, 6, 31, 9, 45);
  assert.equal(totalClockedMinutes(heading, now), 45);
});

test('totalClockedMinutes: a running clock on a DESCENDANT also contributes its elapsed-so-far time to the ancestor\u2019s total', () => {
  const doc = parseOrg('* Parent\n** Child\n');
  const child = doc.children[0].children[0];
  const start = new Date(2026, 6, 31, 9, 0);
  clockIn(child, ts(start, '09:00'));
  const now = new Date(2026, 6, 31, 9, 20);
  assert.equal(totalClockedMinutes(doc.children[0], now), 20);
});

test('totalClockedMinutes: a malformed/unrecognized LOGBOOK line simply doesn\u0027t contribute, rather than breaking the whole computation', () => {
  const doc = parseOrg('* Task\n:LOGBOOK:\nsome nonsense line\nCLOCK: [2026-07-31 Fri 09:00]--[2026-07-31 Fri 09:30] =>  0:30\n:END:\n');
  assert.equal(totalClockedMinutes(doc.children[0]), 30);
});

// ---- clockCancel -------------------------------------------------------------

test('clockCancel: removes the running line entirely, no trace of it left, and no duration ever recorded', () => {
  const doc = parseOrg('* Task\n');
  const heading = doc.children[0];
  clockIn(heading, ts(new Date(2026, 6, 31, 9, 0), '09:00'));
  const ok = clockCancel(heading);
  assert.equal(ok, true);
  assert.deepEqual(heading.logbookLines, []);
  assert.equal(isClockRunning(heading), false);
});

test('clockCancel: nothing running is a no-op, returns false', () => {
  const doc = parseOrg('* Task\n');
  const heading = doc.children[0];
  assert.equal(clockCancel(heading), false);
});

test('clockCancel: only removes the running line, every other LOGBOOK entry (already-completed clocks, state-change notes) is untouched', () => {
  const doc = parseOrg(
    '* Task\n:LOGBOOK:\nCLOCK: [2026-07-30 Thu 09:00]--[2026-07-30 Thu 09:30] =>  0:30\n:END:\n'
  );
  const heading = doc.children[0];
  clockIn(heading, ts(new Date(2026, 6, 31, 9, 0), '09:00'));
  assert.equal(heading.logbookLines.length, 2);
  clockCancel(heading);
  assert.deepEqual(heading.logbookLines, ['CLOCK: [2026-07-30 Thu 09:00]--[2026-07-30 Thu 09:30] =>  0:30']);
});

test('clockCancel: cancelled time never contributes to totalClockedMinutes, unlike a completed session', () => {
  const doc = parseOrg('* Task\n');
  const heading = doc.children[0];
  clockIn(heading, ts(new Date(2026, 6, 31, 9, 0), '09:00'));
  clockCancel(heading);
  assert.equal(totalClockedMinutes(heading, new Date(2026, 6, 31, 10, 0)), 0);
});

test('clockCancel: after cancelling, clocking in again starts a genuinely fresh session', () => {
  const doc = parseOrg('* Task\n');
  const heading = doc.children[0];
  clockIn(heading, ts(new Date(2026, 6, 31, 9, 0), '09:00'));
  clockCancel(heading);
  const okAgain = clockIn(heading, ts(new Date(2026, 6, 31, 10, 0), '10:00'));
  assert.equal(okAgain, true);
  assert.equal(isClockRunning(heading), true);
  assert.equal(heading.logbookLines.length, 1);
});

// ---- findHeadingWithRunningClock --------------------------------------------

test('findHeadingWithRunningClock returns null when nothing is running anywhere', () => {
  const doc = parseOrg('* A\n** B\n');
  assert.equal(findHeadingWithRunningClock(doc), null);
});

test('findHeadingWithRunningClock finds a running clock at the top level', () => {
  const doc = parseOrg('* A\n* B\n');
  clockIn(doc.children[1], ts(new Date(2026, 6, 31, 9, 0), '09:00'));
  assert.equal(findHeadingWithRunningClock(doc), doc.children[1]);
});

test('findHeadingWithRunningClock finds a running clock nested several levels deep', () => {
  const doc = parseOrg('* A\n** B\n*** C\n');
  const target = doc.children[0].children[0].children[0];
  clockIn(target, ts(new Date(2026, 6, 31, 9, 0), '09:00'));
  assert.equal(findHeadingWithRunningClock(doc), target);
});

test('findHeadingWithRunningClock ignores a completed (non-running) clock', () => {
  const doc = parseOrg('* A\n:LOGBOOK:\nCLOCK: [2026-07-31 Fri 09:00]--[2026-07-31 Fri 09:30] =>  0:30\n:END:\n');
  assert.equal(findHeadingWithRunningClock(doc), null);
});
