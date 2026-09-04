/**
 * Clocking: real org-mode's org-clock-in / org-clock-out / the pure
 * computation org-clock-display needs. All three write into / read
 * from a heading's own logbookLines, the same raw-text-is-the-
 * serialization-source array src/logbook.js's own parser already
 * works with -- consistent with how progress-logging.js's own
 * :LOGBOOK: entries are stored, not a separate mechanism.
 *
 * Deliberate simplification, stated plainly: real org keeps a heading's
 * very first CLOCK line as a bare line directly under the heading,
 * only wrapping it (and every subsequent one) into a :LOGBOOK: drawer
 * once a SECOND clocking happens. This app's own LOGBOOK handling was
 * already unified into always using the drawer from the start (see
 * logbook.js's own docs) -- clocking follows that same established
 * convention rather than reintroducing the bare-line special case.
 */

const RUNNING_CLOCK_RE = /^CLOCK:\s+(\[[^\]]+\]|<[^>]+>)\s*$/;
const COMPLETED_CLOCK_RE = /^CLOCK:\s+(\[[^\]]+\]|<[^>]+>)--(\[[^\]]+\]|<[^>]+>)\s*=>\s*(-?\d+):(\d+)\s*$/;

/** The index of `heading`'s own currently-running clock line within
 *  its logbookLines, or -1 if none is running. Only ever at most one
 *  clock can be running per heading at a time -- clocking in again
 *  while one is already running is a no-op (see clockIn below),
 *  matching real org's own refusal to double-start the same clock. */
function findRunningClockLineIndex(heading) {
  for (let i = 0; i < (heading.logbookLines || []).length; i++) {
    if (RUNNING_CLOCK_RE.test(heading.logbookLines[i])) return i;
  }
  return -1;
}

/** Whether `heading` currently has a running clock. */
function isClockRunning(heading) {
  return findRunningClockLineIndex(heading) !== -1;
}

/** Starts the clock on `heading`: inserts a new "CLOCK: [timestamp]"
 *  line (a bare start, no end yet) at the top of its own LOGBOOK --
 *  real org's own most-recent-first insertion point, matching every
 *  other LOGBOOK entry type this app already writes. `timestamp` is
 *  the already-formatted org timestamp string (org-timestamp.js's own
 *  formatOrgTimestamp, inactive brackets, matching real org's own
 *  clock-timestamp convention exactly). Returns false without
 *  changing anything if a clock is already running on this heading --
 *  real org itself doesn't let you double-start the same clock, it
 *  just continues the existing session. */
function clockIn(heading, timestamp) {
  if (isClockRunning(heading)) return false;
  heading.logbookLines = heading.logbookLines || [];
  heading.logbookLines.unshift(`CLOCK: ${timestamp}`);
  return true;
}

/** Stops `heading`'s currently-running clock: replaces its bare
 *  "CLOCK: [start]" line with the completed
 *  "CLOCK: [start]--[end] =>  H:MM" form, computing the duration from
 *  the start time parsed directly out of that same stored line (never
 *  trusting a separately-passed-in start time -- there's nothing else
 *  to get wrong that way) and the given `endDate`. `endTimestamp` is
 *  the already-formatted end timestamp string -- real org's own exact
 *  line format, including its own space-before-arrow convention.
 *  Returns false without changing anything if nothing is currently
 *  running, or if the running line's own start timestamp turns out to
 *  be unparseable (a hand-edited or corrupted CLOCK line) rather than
 *  computing a nonsensical duration from a null start time. */
function clockOut(heading, endTimestamp, endDate) {
  const idx = findRunningClockLineIndex(heading);
  if (idx === -1) return false;
  const m = RUNNING_CLOCK_RE.exec(heading.logbookLines[idx]);
  const startRaw = m[1];
  const startDate = parseClockTimestampToDate(startRaw);
  if (!startDate) return false;
  const minutes = Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / 60000));
  heading.logbookLines[idx] = `CLOCK: ${startRaw}--${endTimestamp} =>  ${formatClockDuration(minutes)}`;
  return true;
}

/** org-clock-cancel: stops `heading`'s currently-running clock and
 *  discards its accumulated time entirely -- unlike clockOut, this
 *  doesn't complete the line with an end timestamp and duration, it
 *  removes the bare "CLOCK: [start]" line outright, as if the clock
 *  had never been started at all. Used when a clock was started by
 *  mistake, or the person switched to a completely different task
 *  without wanting the elapsed time logged. Returns false without
 *  changing anything if nothing is currently running. */
function clockCancel(heading) {
  const idx = findRunningClockLineIndex(heading);
  if (idx === -1) return false;
  heading.logbookLines.splice(idx, 1);
  return true;
}

/** Formats a whole number of minutes as real org's own "H:MM" clock
 *  duration string -- hours unpadded, minutes always two digits, e.g.
 *  90 minutes -> "1:30", 5 minutes -> "0:05". */
function formatClockDuration(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

/** Parses a real org clock-duration string ("H:MM", any number of
 *  digits for the hours part) back into a whole number of minutes.
 *  Returns 0 for anything unparseable rather than throwing, so a
 *  malformed or hand-edited CLOCK line doesn't break the running total
 *  for an entire subtree over one bad entry. */
function parseClockDuration(raw) {
  const m = /^(-?\d+):(\d+)$/.exec(String(raw || '').trim());
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Every completed "CLOCK: [start]--[end] => H:MM" line directly on
 *  `heading` (not its descendants -- see totalClockedMinutes below for
 *  the whole-subtree sum org-clock-display actually wants), in
 *  minutes. A line this app's own COMPLETED_CLOCK_RE doesn't recognize
 *  (including a still-running one, deliberately excluded here) simply
 *  doesn't contribute, rather than the whole computation failing. */
function ownClockedMinutes(heading) {
  let total = 0;
  for (const line of heading.logbookLines || []) {
    const m = COMPLETED_CLOCK_RE.exec(line);
    if (!m) continue;
    total += parseClockDuration(`${m[3]}:${m[4]}`);
  }
  return total;
}

/**
 * The total time ever clocked for `heading`, including every one of
 * its descendants -- real org's own org-clock-display/mode-line
 * behavior exactly ("all time ever clocked in for this task and its
 * children"). A currently-running clock (on `heading` itself or any
 * descendant) contributes its own elapsed-so-far time too, given `now`
 * as the reference point -- matching real org's own live-updating
 * total while a clock is actively running, not just the completed
 * sessions.
 */
function totalClockedMinutes(heading, now = new Date()) {
  let total = ownClockedMinutes(heading);
  const runningIdx = findRunningClockLineIndex(heading);
  if (runningIdx !== -1) {
    const m = RUNNING_CLOCK_RE.exec(heading.logbookLines[runningIdx]);
    const startDate = parseClockTimestampToDate(m[1]);
    if (startDate) total += Math.max(0, Math.round((now.getTime() - startDate.getTime()) / 60000));
  }
  for (const child of heading.children || []) {
    total += totalClockedMinutes(child, now);
  }
  return total;
}

/** Just the elapsed minutes since `heading`'s own currently-running
 *  clock started -- 0 if it doesn't have one running at all (checking
 *  isClockRunning first is still worth doing for callers who need to
 *  distinguish "not running" from "just started"). */
function currentClockSessionMinutes(heading, now = new Date()) {
  const runningIdx = findRunningClockLineIndex(heading);
  if (runningIdx === -1) return 0;
  const m = RUNNING_CLOCK_RE.exec(heading.logbookLines[runningIdx]);
  const startDate = parseClockTimestampToDate(m[1]);
  if (!startDate) return 0;
  return Math.max(0, Math.round((now.getTime() - startDate.getTime()) / 60000));
}

/** A minimal, dependency-free parse of a bracketed/angled org
 *  timestamp string into a JS Date -- deliberately not reusing
 *  org-timestamp.js's own fuller parseOrgTimestamp here, since that
 *  module's own repeater/delay handling isn't relevant to a clock
 *  line's own timestamp at all, and pulling in that whole surface
 *  would be more coupling than this narrow need justifies. Returns
 *  null for anything unparseable. */
function parseClockTimestampToDate(raw) {
  const m = /(\d{4})-(\d{2})-(\d{2})(?:[^0-9]+(\d{2}):(\d{2}))?/.exec(raw);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d), h ? Number(h) : 0, mi ? Number(mi) : 0);
}

/** Searches `doc` for whichever heading (if any) currently has a
 *  running clock -- depth-first, so if more than one somehow ended up
 *  running (e.g. a hand-edited file), the first one encountered wins
 *  rather than this throwing or picking arbitrarily. Returns null if
 *  nothing is running anywhere in the document. */
function findHeadingWithRunningClock(doc) {
  const walk = (headings) => {
    for (const heading of headings) {
      if (isClockRunning(heading)) return heading;
      const found = walk(heading.children || []);
      if (found) return found;
    }
    return null;
  };
  return walk(doc.children || []);
}

/**
 * org-clock-in, but matching real org's own actual behavior when a
 * DIFFERENT heading already has a running clock: real org's own
 * org-clock-in docstring says it plainly -- "If necessary, clock-out
 * of the currently active clock" -- before starting the new one,
 * rather than refusing, or (this app's own previous, confirmed bug)
 * silently allowing a second, simultaneous clock to start running
 * elsewhere in the same document. Only ever at most one clock can
 * meaningfully be "the current task" at a time, matching real org's
 * own singular org-clock-marker model.
 *
 * `doc` is searched for whichever heading (if any) currently has a
 * running clock; if it's a DIFFERENT heading than `heading` itself,
 * that one is clocked out first, using `timestamp` as its own end
 * time too -- the switch happens at a single moment, so the previous
 * task's end and the new task's start are the exact same instant,
 * with no gap between them, matching real org's own seamless-switch
 * behavior. If the running clock is already on `heading` itself, this
 * is unchanged from plain clockIn -- a no-op, real org doesn't let you
 * double-start the same clock either.
 *
 * Returns `{ started, switchedFrom }` -- `started` is clockIn's own
 * boolean (whether the new clock actually started), `switchedFrom` is
 * the heading that got auto-clocked-out to make room for it, or null
 * if nothing needed switching.
 */
function clockInSwitchingTasks(doc, heading, timestamp, now) {
  const previouslyRunning = findHeadingWithRunningClock(doc);
  let switchedFrom = null;
  if (previouslyRunning && previouslyRunning !== heading) {
    if (clockOut(previouslyRunning, timestamp, now)) {
      switchedFrom = previouslyRunning;
    }
  }
  const started = clockIn(heading, timestamp);
  return { started, switchedFrom };
}

/** org-clock-continue's own target-finding half: the heading whose
 *  most recent CLOCK line (running or already-completed, either
 *  counts) started more recently than any other heading's own most
 *  recent one, searched across the whole document. Real org's own
 *  actual "most recently clocked into" ordering -- not "most recently
 *  clocked OUT of", which can differ for a still-running session that
 *  has no end time to compare against at all. Returns null if no
 *  heading anywhere has ever been clocked. Callers are expected to
 *  have already confirmed nothing is currently running before calling
 *  this -- resuming "the last clock" while one is already active
 *  doesn't have a sensible meaning of its own. */
function findMostRecentlyClockedHeading(doc) {
  let best = null;
  let bestStart = null;
  const consider = (heading) => {
    for (const line of heading.logbookLines || []) {
      const running = RUNNING_CLOCK_RE.exec(line);
      const completed = COMPLETED_CLOCK_RE.exec(line);
      const startRaw = running ? running[1] : completed ? completed[1] : null;
      if (!startRaw) continue;
      const start = parseClockTimestampToDate(startRaw);
      if (!start) continue;
      if (!bestStart || start > bestStart) {
        bestStart = start;
        best = heading;
      }
    }
  };
  const walk = (headings) => {
    for (const heading of headings) {
      consider(heading);
      walk(heading.children || []);
    }
  };
  walk(doc.children || []);
  return best;
}

export {
  isClockRunning,
  clockIn,
  clockInSwitchingTasks,
  clockOut,
  clockCancel,
  formatClockDuration,
  parseClockDuration,
  totalClockedMinutes,
  currentClockSessionMinutes,
  findHeadingWithRunningClock,
  findMostRecentlyClockedHeading,
  COMPLETED_CLOCK_RE,
  parseClockTimestampToDate,
};
