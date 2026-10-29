// @ts-check
/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {import('./types.js').Doc} Doc */
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

import { insertLogLines } from './todo-transition.js';

/** How clock lines are written: `into` is `org-clock-into-drawer` (true, false, a drawer name or an integer), `logDrawer` is
 *  `org-log-into-drawer` (the drawer `t` stands for), `removeZero` is `org-clock-out-remove-zero-time-clocks`.
 * @typedef {{ into?: boolean | number | string, logDrawer?: string | null, removeZero?: boolean }} ClockOptions */

const RUNNING_CLOCK_RE = /^CLOCK:\s+(\[[^\]]+\]|<[^>]+>)\s*$/;
const COMPLETED_CLOCK_RE = /^CLOCK:\s+(\[[^\]]+\]|<[^>]+>)--(\[[^\]]+\]|<[^>]+>)\s*=>\s*(-?\d+):(\d+)\s*$/;

/** Every array of a heading's lines that can hold CLOCK lines, in the order they are written: lines of other drawers before the
 *  :LOGBOOK: drawer, the :LOGBOOK: drawer itself, then the body.
 * @param {Heading} heading @returns {string[][]} */
function clockLineArrays(heading) {
  heading.logbookLines = heading.logbookLines || [];
  return [heading.preLogLines || [], heading.logbookLines, heading.bodyLines || []];
}

/** Where `heading`'s currently-running clock line is (in any drawer, or bare), or null. At most one clock runs per heading;
 *  clocking in again while one runs is a no-op (see clockIn below), as in Emacs.
 * @param {Heading} heading @returns {{ lines: string[], idx: number } | null} */
function findRunningClockLine(heading) {
  for (const lines of clockLineArrays(heading)) {
    const idx = lines.findIndex((l) => RUNNING_CLOCK_RE.test(l));
    if (idx >= 0) return { lines, idx };
  }
  return null;
}

/** @param {Heading} heading */
function runningClockText(heading) {
  const at = findRunningClockLine(heading);
  return at ? at.lines[at.idx] : null;
}

/**
 * Whether `heading` currently has a running clock.
 * @param {Heading} heading
 */
function isClockRunning(heading) {
  return findRunningClockLine(heading) !== null;
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
 * @param {Heading} heading
 * @param {string} timestamp
 * @param {ClockOptions} [options]
 *  just continues the existing session. */
function clockIn(heading, timestamp, options = {}) {
  if (isClockRunning(heading)) return false;
  heading.logbookLines = heading.logbookLines || [];
  const line = `CLOCK: ${timestamp}`;
  const name = clockDrawerName(options);
  const existing = allClockLines(heading).length;
  const into = options.into === undefined ? true : options.into;
  // an integer asks for a drawer only once the entry would hold that many clock lines (or when the drawer is already there)
  const bare = name === null || (typeof into === 'number' && !hasDrawer(heading, name) && existing + 1 < into);
  if (bare) {
    insertBareClock(heading, line);
    return true;
  }
  const target = /** @type {string} */ (name);
  if (insertIntoDrawer(heading, target, [line])) return true;
  // no such drawer yet: it is made, and the clock lines already in the entry move into it with the new one (the older ones in
  // reverse order, as Emacs leaves them); a :LOGBOOK: drawer emptied by that stays, empty
  const hadLogbook = heading.logbookLines.length > 0;
  const old = takeClockLines(heading).reverse();
  insertLogLines(heading, [line, ...old], target, false);
  if (hadLogbook && heading.logbookLines.length === 0 && target.toUpperCase() !== 'LOGBOOK') heading.bodyLines.splice(old.length + 3, 0, ':LOGBOOK:', ':END:');
  return true;
}

/** Puts `lines` at the top of drawer `name` when the entry has it (in any case): the :LOGBOOK: lines, or a drawer among the body lines.
 * @param {Heading} heading @param {string} name @param {string[]} lines @returns {boolean} */
function insertIntoDrawer(heading, name, lines) {
  if (name.toUpperCase() === 'LOGBOOK' && heading.logbookLines.length > 0) {
    heading.logbookLines.splice(0, 0, ...lines);
    return true;
  }
  const isOpen = (/** @type {string} */ l) => l.trim().toLowerCase() === `:${name.toLowerCase()}:`;
  for (const arr of [heading.preLogLines || [], heading.bodyLines]) {
    const open = arr.findIndex(isOpen);
    if (open >= 0) {
      arr.splice(open + 1, 0, ...lines);
      return true;
    }
  }
  return false;
}

/** The drawer clock lines go into, or null for none (`org-clock-into-drawer` nil).
 * @param {ClockOptions} options @returns {string | null} */
function clockDrawerName(options) {
  const into = options.into === undefined ? true : options.into;
  if (into === false) return null;
  if (typeof into === 'string') return into;
  return options.logDrawer || 'LOGBOOK';
}

/** @param {Heading} heading @param {string} name */
function hasDrawer(heading, name) {
  if (name.toUpperCase() === 'LOGBOOK' && heading.logbookLines.length > 0) return true;
  const isOpen = (/** @type {string} */ l) => l.trim().toLowerCase() === `:${name.toLowerCase()}:`;
  return (heading.preLogLines || []).some(isOpen) || (heading.bodyLines || []).some(isOpen);
}

/** Removes every CLOCK line from the entry (all drawers and the body) and returns them in order.
 * @param {Heading} heading @returns {string[]} */
function takeClockLines(heading) {
  /** @type {string[]} */
  const taken = [];
  for (const lines of clockLineArrays(heading)) {
    for (let i = 0; i < lines.length; ) {
      if (/^CLOCK:/.test(lines[i])) taken.push(...lines.splice(i, 1));
      else i++;
    }
  }
  return taken;
}

/** A CLOCK line with no drawer: right before the first CLOCK line of the entry, or else directly under the heading (planning line and properties come first).
 * @param {Heading} heading @param {string} line */
function insertBareClock(heading, line) {
  for (const lines of clockLineArrays(heading)) {
    const first = lines.findIndex((l) => /^CLOCK:/.test(l));
    if (first >= 0) {
      lines.splice(first, 0, line);
      return;
    }
  }
  if (heading.logbookLines.length > 0) heading.preLogLines = [line, ...(heading.preLogLines || [])];
  else heading.bodyLines.splice(0, 0, line);
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
 * @param {Heading} heading
 * @param {string} endTimestamp
 * @param {Date} endDate
 * @param {ClockOptions} [options]
 *  computing a nonsensical duration from a null start time. */
function clockOut(heading, endTimestamp, endDate, options = {}) {
  const at = findRunningClockLine(heading);
  if (!at) return false;
  const m = /** @type {RegExpExecArray} */ (RUNNING_CLOCK_RE.exec(at.lines[at.idx]));
  const startRaw = m[1];
  const startDate = parseClockTimestampToDate(startRaw);
  if (!startDate) return false;
  const minutes = Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / 60000));
  if (minutes === 0 && options.removeZero) {
    // org-clock-out-remove-zero-time-clocks: the line goes, and a drawer left empty by it goes too
    at.lines.splice(at.idx, 1);
    const open = at.lines[at.idx - 1];
    if (at.lines !== heading.logbookLines && at.idx > 0 && /^:[^:\s]+:$/.test((open || '').trim()) && (at.lines[at.idx] || '').trim() === ':END:') at.lines.splice(at.idx - 1, 2);
    if (heading.logbookLines.length === 0 && heading.bodyLines.length === 1 && heading.bodyLines[0] === '') heading.bodyLines.length = 0;
    return true;
  }
  // Emacs writes the duration as "=> " and the hours in two columns: "=>  2:05", "=> 24:00", "=> 100:00"
  at.lines[at.idx] = `CLOCK: ${startRaw}--${endTimestamp} => ${formatClockDuration(minutes).padStart(5, ' ')}`;
  return true;
}

/** org-clock-cancel: stops `heading`'s currently-running clock and
 *  discards its accumulated time entirely -- unlike clockOut, this
 *  doesn't complete the line with an end timestamp and duration, it
 *  removes the bare "CLOCK: [start]" line outright, as if the clock
 *  had never been started at all. Used when a clock was started by
 *  mistake, or the person switched to a completely different task
 *  without wanting the elapsed time logged. Returns false without
 * @param {Heading} heading
 *  changing anything if nothing is currently running. */
function clockCancel(heading) {
  const at = findRunningClockLine(heading);
  if (!at) return false;
  at.lines.splice(at.idx, 1);
  return true;
}

/** Formats a whole number of minutes as real org's own "H:MM" clock
 *  duration string -- hours unpadded, minutes always two digits, e.g.
 * @param {number} totalMinutes
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
 * @param {string} raw
 *  for an entire subtree over one bad entry. */
function parseClockDuration(raw) {
  const m = /^(-?\d+):(\d+)$/.exec(String(raw || '').trim());
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** The CLOCK lines of a heading: those in its :LOGBOOK: drawer and those written without a drawer (Emacs with `org-clock-into-drawer` nil).
 * @param {Heading} heading */
function allClockLines(heading) {
  const clocks = (/** @type {string[] | undefined} */ lines) => (lines || []).filter((l) => /^CLOCK:/.test(l));
  return [...clocks(heading.logbookLines), ...clocks(heading.preLogLines), ...clocks(heading.bodyLines)];
}

/** Every completed "CLOCK: [start]--[end] => H:MM" line directly on
 *  `heading` (not its descendants -- see totalClockedMinutes below for
 *  the whole-subtree sum org-clock-display actually wants), in
 *  minutes. A line this app's own COMPLETED_CLOCK_RE doesn't recognize
 *  (including a still-running one, deliberately excluded here) simply
 * @param {Heading} heading
 *  doesn't contribute, rather than the whole computation failing. */
function ownClockedMinutes(heading) {
  let total = 0;
  for (const line of allClockLines(heading)) {
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
 * @param {Heading} heading
 */
function totalClockedMinutes(heading, now = new Date()) {
  let total = ownClockedMinutes(heading);
  const runningText = runningClockText(heading);
  if (runningText !== null) {
    const m = /** @type {RegExpExecArray} */ (RUNNING_CLOCK_RE.exec(runningText));
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
 * @param {Heading} heading
 *  distinguish "not running" from "just started"). */
function currentClockSessionMinutes(heading, now = new Date()) {
  const runningText = runningClockText(heading);
  if (runningText === null) return 0;
  const m = /** @type {RegExpExecArray} */ (RUNNING_CLOCK_RE.exec(runningText));
  const startDate = parseClockTimestampToDate(m[1]);
  if (!startDate) return 0;
  return Math.max(0, Math.round((now.getTime() - startDate.getTime()) / 60000));
}

/** When the running clock on `heading` started (minute precision, as the CLOCK line has it), or null.
 * @param {Heading} heading @returns {number | null} */
function runningClockStartMs(heading) {
  const runningText = runningClockText(heading);
  if (runningText === null) return null;
  const m = /** @type {RegExpExecArray} */ (RUNNING_CLOCK_RE.exec(runningText));
  const startDate = parseClockTimestampToDate(m[1]);
  return startDate ? startDate.getTime() : null;
}

/** A minimal, dependency-free parse of a bracketed/angled org
 *  timestamp string into a JS Date -- deliberately not reusing
 *  org-timestamp.js's own fuller parseOrgTimestamp here, since that
 *  module's own repeater/delay handling isn't relevant to a clock
 *  line's own timestamp at all, and pulling in that whole surface
 *  would be more coupling than this narrow need justifies. Returns
 * @param {string} raw
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
 * @param {Doc} doc
 *  nothing is running anywhere in the document. */
function findHeadingWithRunningClock(doc) {
  /** @param {Heading[]} headings */
  const walk = (headings) => {
    for (const heading of headings) {
      if (isClockRunning(heading)) return heading;
      /** @type {any} */ const found = walk(heading.children || []);
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
 * @param {Doc} doc
 * @param {Heading} heading
 * @param {string} timestamp
 * @param {Date} now
 * @param {ClockOptions} [options] how the new clock is written
 * @param {ClockOptions} [outOptions] how the clock stopped by the switch is closed
 */
function clockInSwitchingTasks(doc, heading, timestamp, now, options = {}, outOptions = options) {
  const previouslyRunning = findHeadingWithRunningClock(doc);
  let switchedFrom = null;
  if (previouslyRunning && previouslyRunning !== heading) {
    if (clockOut(previouslyRunning, timestamp, now, outOptions)) {
      switchedFrom = previouslyRunning;
    }
  }
  const started = clockIn(heading, timestamp, options);
  return { started, switchedFrom };
}

/** org-clock-in-last's own target-finding half: the heading whose
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
/** Every heading in `doc` that has ever been clocked (a finished clock or a running one), most recently
 *  clocked INTO first, at most `limit` of them: the data behind org-clock-goto's C-u form, which offers
 *  "a list of recently clocked tasks". Ordered by when each heading's latest clock STARTED, the same
 *  measure findMostRecentlyClockedHeading uses. Unlike Emacs's clock history, which only holds what was
 *  clocked in the current session, this reads the document's own CLOCK lines, so it is complete and
 * @param {Doc} doc
 *  survives a reload. @returns {{ heading: object, start: Date }[]} */
function listRecentlyClockedHeadings(doc, limit = 15) {
  /** @type {any[]} */ const found = [];
  /** @param {Heading} heading */
  const consider = (heading) => {
    /** @type {Date | null} */
    let latest = null;
    for (const line of heading.logbookLines || []) {
      const running = RUNNING_CLOCK_RE.exec(line);
      const completed = COMPLETED_CLOCK_RE.exec(line);
      const startRaw = running ? running[1] : completed ? completed[1] : null;
      if (!startRaw) continue;
      const start = parseClockTimestampToDate(startRaw);
      if (start && (!latest || start > latest)) latest = start;
    }
    if (latest) found.push({ heading, start: latest });
  };
  /** @param {Heading[]} headings */
  const walk = (headings) => {
    for (const heading of headings) {
      consider(heading);
      walk(heading.children || []);
    }
  };
  walk((doc && doc.children) || []);
  found.sort((a, b) => b.start - a.start);
  return found.slice(0, limit);
}

/** @param {Doc} doc */
function findMostRecentlyClockedHeading(doc) {
  /** @type {any} */
  let best = null;
  /** @type {Date | null} */
  let bestStart = null;
  /** @param {Heading} heading */
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
  /** @param {Heading[]} headings */
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
  allClockLines,
  listRecentlyClockedHeadings,
  isClockRunning,
  clockIn,
  clockInSwitchingTasks,
  runningClockStartMs,
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
