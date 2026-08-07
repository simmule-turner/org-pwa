import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import { computeClocktable, renderClocktable, parseClocktableRange, formatCaptionTimestamp } from '../src/clocktable.js';

// ---- THE EXACT WORKED EXAMPLE FROM THE REQUEST -----------------------------

test('THE EXACT WORKED EXAMPLE renders character-for-character identically to what was specified', () => {
  const text = `* Project Alpha
** Task 1: Setup repo
:LOGBOOK:
CLOCK: [2026-08-01 Sat 09:00]--[2026-08-01 Sat 11:00] =>  2:00
:END:
** Task 2: Fix bug #42
:LOGBOOK:
CLOCK: [2026-08-02 Sun 14:00]--[2026-08-02 Sun 16:15] =>  2:15
:END:
* Administrative
** Team meeting
:LOGBOOK:
CLOCK: [2026-08-03 Mon 10:00]--[2026-08-03 Mon 11:30] =>  1:30
:END:
`;
  const doc = parseOrg(text);
  const result = computeClocktable(doc, '2026-08-01', '2026-08-07');
  const now = new Date(2026, 7, 7, 12, 11); // 2026-08-07 Fri 12:11
  const rendered = renderClocktable(result, '2026-08-01', '2026-08-07', now);
  assert.equal(
    rendered,
    [
      '#+BEGIN: clocktable :maxlevel 2 :scope file :tstart "2026-08-01" :tend "2026-08-07"',
      '#+CAPTION: Clock summary at [2026-08-07 Fri 12:11]',
      '| Headline | Time |',
      '|----------------------------------------+-------|',
      '| *Total time* | *5:45* |',
      '|----------------------------------------+-------|',
      '| Project Alpha | 4:15 |',
      '| \\_  Task 1: Setup repo | 2:00 |',
      '| \\_  Task 2: Fix bug #42 | 2:15 |',
      '| Administrative | 1:30 |',
      '| \\_  Team meeting | 1:30 |',
      '#+END:',
    ].join('\n')
  );
});

// ---- date range filtering -------------------------------------------------

test('an entry whose start date falls before tstart is excluded', () => {
  const doc = parseOrg(
    '* H\n:LOGBOOK:\nCLOCK: [2026-07-31 Fri 09:00]--[2026-07-31 Fri 10:00] =>  1:00\n:END:\n'
  );
  const result = computeClocktable(doc, '2026-08-01', '2026-08-07');
  assert.equal(result.totalMinutes, 0);
});

test('an entry whose start date falls after tend is excluded', () => {
  const doc = parseOrg(
    '* H\n:LOGBOOK:\nCLOCK: [2026-08-08 Sat 09:00]--[2026-08-08 Sat 10:00] =>  1:00\n:END:\n'
  );
  const result = computeClocktable(doc, '2026-08-01', '2026-08-07');
  assert.equal(result.totalMinutes, 0);
});

test('an entry starting exactly on tstart is included (inclusive boundary)', () => {
  const doc = parseOrg(
    '* H\n:LOGBOOK:\nCLOCK: [2026-08-01 Sat 00:00]--[2026-08-01 Sat 01:00] =>  1:00\n:END:\n'
  );
  const result = computeClocktable(doc, '2026-08-01', '2026-08-07');
  assert.equal(result.totalMinutes, 60);
});

test('an entry starting late in the day exactly on tend is included (inclusive boundary, whole day covered)', () => {
  const doc = parseOrg(
    '* H\n:LOGBOOK:\nCLOCK: [2026-08-07 Fri 23:00]--[2026-08-07 Fri 23:30] =>  0:30\n:END:\n'
  );
  const result = computeClocktable(doc, '2026-08-01', '2026-08-07');
  assert.equal(result.totalMinutes, 30);
});

test('an empty/unset tstart and tend means an unbounded range -- everything included', () => {
  const doc = parseOrg(
    '* H\n:LOGBOOK:\nCLOCK: [2020-01-01 Wed 09:00]--[2020-01-01 Wed 10:00] =>  1:00\n:END:\n'
  );
  const result = computeClocktable(doc, '', '');
  assert.equal(result.totalMinutes, 60);
});

// ---- maxlevel rollup --------------------------------------------------------

test('a heading at or above maxlevel gets its own row, including every descendant\u2019s time', () => {
  const doc = parseOrg(
    '* Top\n** Mid\n:LOGBOOK:\nCLOCK: [2026-08-03 Mon 09:00]--[2026-08-03 Mon 10:00] =>  1:00\n:END:\n'
  );
  const result = computeClocktable(doc, '2026-08-01', '2026-08-07', 2);
  const midRow = result.rows.find((r) => r.heading.title === 'Mid');
  assert.equal(midRow.minutes, 60);
  assert.equal(midRow.level, 2);
});

test('a heading DEEPER than maxlevel contributes its time upward but gets no row of its own', () => {
  const doc = parseOrg(
    '* Top\n** Mid\n*** Deep\n:LOGBOOK:\nCLOCK: [2026-08-03 Mon 09:00]--[2026-08-03 Mon 10:30] =>  1:30\n:END:\n'
  );
  const result = computeClocktable(doc, '2026-08-01', '2026-08-07', 2);
  assert.equal(result.rows.some((r) => r.heading.title === 'Deep'), false);
  const midRow = result.rows.find((r) => r.heading.title === 'Mid');
  assert.equal(midRow.minutes, 90); // rolled up from Deep
});

test('maxlevel 1 rolls up everything below level 1 into the top-level row only', () => {
  const doc = parseOrg(
    '* Top\n** Mid\n:LOGBOOK:\nCLOCK: [2026-08-03 Mon 09:00]--[2026-08-03 Mon 10:00] =>  1:00\n:END:\nContent.\n'
  );
  const result = computeClocktable(doc, '2026-08-01', '2026-08-07', 1);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].heading.title, 'Top');
  assert.equal(result.rows[0].minutes, 60);
});

// ---- omission of headings with no relevant time ----------------------------

test('a heading with zero clocked time anywhere in its own subtree is omitted entirely, not shown with 0:00', () => {
  const doc = parseOrg('* No Clocking\nJust text.\n* Has Clocking\n:LOGBOOK:\nCLOCK: [2026-08-03 Mon 09:00]--[2026-08-03 Mon 10:00] =>  1:00\n:END:\n');
  const result = computeClocktable(doc, '2026-08-01', '2026-08-07');
  assert.equal(result.rows.some((r) => r.heading.title === 'No Clocking'), false);
  assert.equal(result.rows.some((r) => r.heading.title === 'Has Clocking'), true);
});

test('a heading whose only clocked entries fall OUTSIDE the range is also omitted, not shown with 0:00', () => {
  const doc = parseOrg('* Outside Range Only\n:LOGBOOK:\nCLOCK: [2020-01-01 Wed 09:00]--[2020-01-01 Wed 10:00] =>  1:00\n:END:\n');
  const result = computeClocktable(doc, '2026-08-01', '2026-08-07');
  assert.equal(result.rows.length, 0);
});

// ---- running (unclosed) clocks are excluded --------------------------------

test('a currently-running (unclosed) clock line does not contribute to the report', () => {
  const doc = parseOrg('* Running\n:LOGBOOK:\nCLOCK: [2026-08-03 Mon 09:00]\n:END:\n');
  const result = computeClocktable(doc, '2026-08-01', '2026-08-07');
  assert.equal(result.rows.length, 0);
  assert.equal(result.totalMinutes, 0);
});

// ---- parseClocktableRange ---------------------------------------------------

test('parseClocktableRange produces an inclusive whole-day range for both start and end', () => {
  const { tstart, tend } = parseClocktableRange('2026-08-01', '2026-08-07');
  assert.equal(tstart.getHours(), 0);
  assert.equal(tstart.getMinutes(), 0);
  assert.equal(tend.getHours(), 23);
  assert.equal(tend.getMinutes(), 59);
});

test('parseClocktableRange returns null for an empty string on either side', () => {
  const { tstart, tend } = parseClocktableRange('', '');
  assert.equal(tstart, null);
  assert.equal(tend, null);
});

// ---- formatCaptionTimestamp -------------------------------------------------

test('formatCaptionTimestamp matches real org\u2019s exact inactive-timestamp caption format', () => {
  const date = new Date(2026, 7, 7, 12, 11); // August 7 2026, 12:11 -- a Friday
  assert.equal(formatCaptionTimestamp(date), '2026-08-07 Fri 12:11');
});

test('formatCaptionTimestamp pads single-digit month/day/hour/minute correctly', () => {
  const date = new Date(2026, 0, 5, 9, 5); // January 5 2026, 09:05
  assert.equal(formatCaptionTimestamp(date), '2026-01-05 Mon 09:05');
});
