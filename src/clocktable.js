/**
 * Computes and renders a clocktable -- real org's own
 * #+BEGIN: clocktable ... #+END: dynamic block, the report
 * org-clock-report/org-dblock-update generate. Pure and DOM-free:
 * walks the same parsed heading tree every other module in this app
 * already works with, using clock.js's own CLOCK-line parsing rather
 * than a second, separate implementation of it.
 *
 * Scope is always the whole document (real org's own :scope file) --
 * this app edits one open document at a time, so a subtree/agenda
 * scope isn't a meaningful distinction the way it is in real org's
 * own multi-buffer, multi-file world.
 *
 * `maxlevel` (real org's own dynamic-block parameter, default 2 here
 * matching the request that motivated this) controls how many levels
 * of heading get their own row: a heading at or above maxlevel gets
 * an explicit row showing ITS OWN clocked time plus every descendant's
 * (the usual "parent row includes children" clocktable convention);
 * a heading deeper than maxlevel contributes its own time upward into
 * whichever ancestor is the first one at or above maxlevel, but never
 * gets a row of its own -- exactly real org's own rollup behavior. A
 * heading (at any level) with zero relevant clocked time anywhere in
 * its own subtree is omitted entirely, matching real org too: an
 * empty row conveys nothing worth taking up space for.
 */

import { COMPLETED_CLOCK_RE, parseClockTimestampToDate, formatClockDuration } from './clock.js';

/**
 * Parses two "YYYY-MM-DD" date-picker strings into the inclusive
 * `{ tstart, tend }` Date range a clocktable filters against --
 * `tstart` at the very start of that day (00:00:00), `tend` at the
 * very end of it (23:59:59.999), so a clock entry beginning at any
 * point during the end date is still included, not just ones ending
 * exactly at midnight. Either can be null/empty for an unbounded side
 * of the range (an empty start date picker means "everything up to
 * tend", not "nothing").
 */
function parseClocktableRange(tstartStr, tendStr) {
  const tstart = tstartStr ? new Date(tstartStr + 'T00:00:00') : null;
  const tend = tendStr ? new Date(tendStr + 'T23:59:59.999') : null;
  return { tstart, tend };
}

/** Every completed CLOCK line directly on `heading` (not descendants)
 *  whose own start timestamp falls within `[tstart, tend]` inclusive,
 *  summed in minutes. A currently-running (not-yet-closed) clock is
 *  deliberately excluded -- real org's own default clocktable
 *  behavior only counts completed sessions unless explicitly told
 *  otherwise, and an in-progress duration would keep changing every
 *  time this report is viewed, which isn't what "a report for this
 *  date range" should mean. */
function ownMinutesInRange(heading, tstart, tend) {
  let total = 0;
  for (const line of heading.logbookLines || []) {
    const m = COMPLETED_CLOCK_RE.exec(line);
    if (!m) continue;
    const startDate = parseClockTimestampToDate(m[1]);
    if (!startDate) continue;
    if (tstart && startDate < tstart) continue;
    if (tend && startDate > tend) continue;
    total += Number(m[3]) * 60 + Number(m[4]);
  }
  return total;
}

/** Bottom-up: every heading's own-plus-descendants total, in minutes,
 *  within the given range -- a Map so this never mutates the actual
 *  document/heading objects just to produce a report from them. */
function computeSubtreeTotals(headings, tstart, tend, totals) {
  for (const heading of headings) {
    computeSubtreeTotals(heading.children || [], tstart, tend, totals);
    let total = ownMinutesInRange(heading, tstart, tend);
    for (const child of heading.children || []) {
      total += totals.get(child) || 0;
    }
    totals.set(heading, total);
  }
  return totals;
}

/** Builds the actual rows to display: a heading at or above maxlevel
 *  with any relevant clocked time (its own or rolled up from
 *  descendants) gets a row and its children are considered too (up to
 *  maxlevel); deeper headings contribute upward but never get a row
 *  of their own. */
function buildClocktableRows(headings, level, maxlevel, totals, rows) {
  for (const heading of headings) {
    const minutes = totals.get(heading) || 0;
    if (minutes <= 0) continue; // nothing relevant anywhere in this subtree -- omit, matching real org
    if (level > maxlevel) continue; // rolled up into an ancestor's own row already; no row of its own
    rows.push({ heading, level, minutes });
    buildClocktableRows(heading.children || [], level + 1, maxlevel, totals, rows);
  }
}

/**
 * Computes a clocktable for `doc` over `[tstartStr, tendStr]`
 * ("YYYY-MM-DD" strings, either may be empty/null for an unbounded
 * side). Returns `{ rows, totalMinutes }` -- `rows` an array of
 * `{ heading, level, minutes }` in document order, `totalMinutes` the
 * grand total (the sum of every top-level row's own total, which
 * already includes every descendant).
 */
function computeClocktable(doc, tstartStr, tendStr, maxlevel = 2) {
  const { tstart, tend } = parseClocktableRange(tstartStr, tendStr);
  const totals = computeSubtreeTotals(doc.children || [], tstart, tend, new Map());
  const rows = [];
  buildClocktableRows(doc.children || [], 1, maxlevel, totals, rows);
  const totalMinutes = rows.filter((r) => r.level === 1).reduce((sum, r) => sum + r.minutes, 0);
  return { rows, totalMinutes };
}

/** "H:MM" -- real org's own clocktable duration format, matching
 *  clock.js's own formatClockDuration exactly (reused directly rather
 *  than reimplemented, so the two can never drift apart). */
function formatClocktableDuration(minutes) {
  return formatClockDuration(minutes);
}

/**
 * Renders a computed `{ rows, totalMinutes }` (from computeClocktable)
 * as the literal org dynamic-block text real org itself would produce
 * -- `#+BEGIN: clocktable ... #+END:`, ready to read, copy, or (if
 * the caller chooses to) insert directly into a document as valid org
 * source. `now` (a Date) drives the `#+CAPTION:` timestamp -- "Clock
 * summary at [...]", real org's own exact wording and inactive-
 * timestamp-with-day-name-and-HH:MM format (no seconds).
 */
function renderClocktable({ rows, totalMinutes }, tstartStr, tendStr, now = new Date(), maxlevel = 2) {
  const lines = [];
  const tstartPart = tstartStr ? ` :tstart "${tstartStr}"` : '';
  const tendPart = tendStr ? ` :tend "${tendStr}"` : '';
  lines.push(`#+BEGIN: clocktable :maxlevel ${maxlevel} :scope file${tstartPart}${tendPart}`);
  lines.push(`#+CAPTION: Clock summary at [${formatCaptionTimestamp(now)}]`);
  lines.push('| Headline | Time |');
  lines.push('|----------------------------------------+-------|');
  lines.push(`| *Total time* | *${formatClocktableDuration(totalMinutes)}* |`);
  lines.push('|----------------------------------------+-------|');
  for (const row of rows) {
    const indent = '\\_  '.repeat(row.level - 1);
    lines.push(`| ${indent}${row.heading.title} | ${formatClocktableDuration(row.minutes)} |`);
  }
  lines.push('#+END:');
  return lines.join('\n');
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "2026-08-07 Fri 12:11" -- real org's own inactive-timestamp
 *  format with a day-name abbreviation and HH:MM (no seconds), the
 *  exact form a clocktable's own #+CAPTION: line uses. */
function formatCaptionTimestamp(date) {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const day = DAY_NAMES[date.getDay()];
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${d} ${day} ${h}:${mi}`;
}

export { computeClocktable, renderClocktable, parseClocktableRange, formatCaptionTimestamp };
