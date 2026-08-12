/**
 * Pure logic for a single-month calendar grid: which cells belong to
 * the month, which are blank leading/trailing padding, and how to
 * step forward/back by month or year. No DOM at all -- app.js's own
 * renderCalendarPanel is the only thing that turns this into actual
 * markup, matching this app's general separation of pure logic from
 * rendering throughout.
 *
 * Loosely modeled on the attached TiddlyWiki cal.js macro's own
 * structure (year nav / month nav / Sunday-first weekday grid / blank
 * leading+trailing padding to a whole number of weeks) -- its own
 * holiday-lookup and journal-link integration are deliberately not
 * carried over here, per the request; this module only computes the
 * grid shape itself.
 */

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Builds the day-cell grid for `month` (0-11, JS Date convention,
 *  NOT the 1-12 convention org's own diary-float/org-anniversary use
 *  elsewhere in this app -- this module works directly with JS Date
 *  throughout, so 0-11 is the natural, zero-conversion choice here)
 *  of `year`. Returns a flat array of exactly a multiple of 7 cells
 *  (padded to complete the last week), each either `null` (a blank
 *  leading/trailing cell, before the 1st or after the last day) or
 *  `{ day, date, isToday }` -- `day` the 1-based day-of-month number,
 *  `date` a real JS Date for that day (midnight, local time), and
 *  `isToday` true iff that date is the same calendar day as `today`.
 *  Weeks start on Sunday, matching real org-mode's own default
 *  ~calendar-week-start-day~ and the attached example's own ~Su~
 *  first column -- this app's own Agenda already has a configurable
 *  week-start elsewhere (see agenda.js's own getAgendaStartOnWeekday)
 *  but a single-month calendar overview is conventionally always
 *  Sunday-first regardless of that separate weekly-agenda setting,
 *  matching real Emacs's own actual calendar-mode display. */
function buildMonthGrid(year, month, today = new Date()) {
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const isToday = date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
    cells.push({ day, date, isToday });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** `{ year, month }` for `delta` months forward (positive) or back
 *  (negative) from `year`/`month` -- correctly rolls over into an
 *  adjacent year at either end (December + 1 -> January of next
 *  year; January - 1 -> December of the previous one), for any
 *  `delta` magnitude, not just +/-1 (matching how the attached
 *  example's own prevM_Date/nextM_Date already relied on JS Date's
 *  own automatic month-overflow arithmetic for this, just made
 *  explicit and directly testable here rather than only exercised
 *  incidentally through UI navigation). */
function stepMonth(year, month, delta) {
  const d = new Date(year, month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

/** `{ year, month }` for `delta` years forward/back, keeping the same
 *  month -- a separate function from stepMonth rather than
 *  stepMonth(year, month, delta * 12), since a year-step should never
 *  itself change which month is showing (a `delta`-month step
 *  legitimately can, by design), even though the arithmetic would
 *  happen to produce the same result for a whole-year delta either
 *  way -- being explicit about the actual intent here matters more
 *  than the shorter implementation. */
function stepYear(year, month, delta) {
  return { year: year + delta, month };
}

export { MONTH_NAMES, buildMonthGrid, stepMonth, stepYear };
