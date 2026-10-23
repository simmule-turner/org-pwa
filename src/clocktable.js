// @ts-check
/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {import('./types.js').Doc} Doc */
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

import { COMPLETED_CLOCK_RE, parseClockTimestampToDate } from './clock.js';
import { layoutTable, widthWithLinks } from './org-table-layout.js';

/**
 * `:tstart` / `:tend` as Org reads them: "YYYY-MM-DD", optionally followed by " HH:MM". The start is included and the end
 * is not, so `:tend "2026-08-07"` stops at midnight before the 7th. Either may be empty for an open side.
 * @param {string | null | undefined} tstartStr
 * @param {string | null | undefined} tendStr
 */
function parseClocktableRange(tstartStr, tendStr) {
  /** @param {string | null | undefined} str */
  const read = (str) => {
    const m = /^(\d{4})-(\d\d)-(\d\d)(?: (\d\d):(\d\d))?$/.exec((str || '').trim());
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0)) : null;
  };
  return { tstart: read(tstartStr), tend: read(tendStr) };
}

/**
 * The minutes of `heading`'s own completed CLOCK lines inside `[tstart, tend)`, a clock that straddles an end counting only
 * the part inside. A running clock is not counted.
 * @param {Heading} heading
 * @param {Date | null} tstart
 * @param {Date | null} tend
 */
function ownMinutesInRange(heading, tstart, tend) {
  let total = 0;
  for (const line of heading.logbookLines || []) {
    const m = COMPLETED_CLOCK_RE.exec(line);
    if (!m) continue;
    const from = parseClockTimestampToDate(m[1]);
    const to = parseClockTimestampToDate(m[2]);
    if (!from || !to) continue;
    const start = tstart && from < tstart ? tstart : from;
    const end = tend && to > tend ? tend : to;
    if (end > start) total += Math.round((end.getTime() - start.getTime()) / 60000);
  }
  return total;
}

/**
 * Computes a clocktable for `doc` over `[tstartStr, tendStr)` (see parseClocktableRange). A heading at or above `maxlevel`
 * gets a row with its own time and its descendants'; deeper headings add their time to the nearest ancestor that has a
 * row. A heading with no time in the range has no row. Levels are the headings' own levels.
 * @param {Doc} doc
 * @param {string | null | undefined} [tstartStr]
 * @param {string | null | undefined} [tendStr]
 * @param {number} [maxlevel]
 * @returns {{ rows: { heading: Heading, level: number, minutes: number, title: string }[], totalMinutes: number }}
 */
function computeClocktable(doc, tstartStr, tendStr, maxlevel = 2) {
  const { tstart, tend } = parseClocktableRange(tstartStr, tendStr);
  /** @type {{ heading: Heading, level: number, minutes: number, title: string }[]} */
  const rows = [];
  let totalMinutes = 0;
  /** @param {Heading} heading @param {boolean} counted  an ancestor already has a row @returns {number} */
  const walk = (heading, counted) => {
    const level = heading.level;
    const hasRow = level <= maxlevel;
    /** @type {{ heading: Heading, level: number, minutes: number, title: string } | null} */
    const row = hasRow ? { heading, level, minutes: 0, title: cleanTitle(heading) } : null;
    if (row) rows.push(row);
    let minutes = ownMinutesInRange(heading, tstart, tend);
    for (const child of heading.children || []) minutes += walk(child, counted || hasRow);
    if (row) {
      row.minutes = minutes;
      if (!counted) totalMinutes += minutes;
    }
    return minutes;
  };
  for (const heading of doc.children || []) walk(heading, false);
  return { rows: rows.filter((r) => r.minutes > 0), totalMinutes };
}

/** A heading's text as the clocktable shows it: no keyword, priority or tags, and nothing past 40 characters. @param {Heading} heading */
function cleanTitle(heading) {
  const text = heading.title.replace(/^COMMENT\s+/, '').trim();
  if (text.length <= 40) return text;
  const cut = text.slice(0, 37);
  return (text[37] === ' ' ? cut : cut.replace(/\s+\S*$/, '')) + '...';
}

/** "H:MM"; a day or more reads "1d 2:05". @param {number} minutes */
function formatClocktableDuration(minutes) {
  const days = Math.floor(minutes / 1440);
  const rest = minutes % 1440;
  const clock = `${Math.floor(rest / 60)}:${String(rest % 60).padStart(2, '0')}`;
  return days ? `${days}d ${clock}` : clock;
}

/**
 * The org dynamic block `#+BEGIN: clocktable ... #+END:` for a computed table, as Org writes it: one time column per level,
 * the total first, then a row per heading.
 * @param {{ rows: { level: number, minutes: number, title: string }[], totalMinutes: number }} computed
 * @param {string | null | undefined} tstartStr
 * @param {string | null | undefined} tendStr
 * @param {Date} [now]
 * @param {number} [maxlevel]
 */
function renderClocktable({ rows, totalMinutes }, tstartStr, tendStr, now = new Date(), maxlevel = 2) {
  const tstartPart = tstartStr ? ` :tstart "${tstartStr}"` : '';
  const tendPart = tendStr ? ` :tend "${tendStr}"` : '';
  const deepest = Math.max(1, ...rows.map((r) => r.level));
  const columns = 1 + deepest;
  /** @param {string[]} cells */
  const pad = (cells) => [...cells, ...Array(Math.max(0, columns - cells.length)).fill('')];
  /** @type {(string[] | null)[]} */
  const table = [pad(['Headline', 'Time']), null, pad(['*Total time*', `*${formatClocktableDuration(totalMinutes)}*`])];
  if (rows.length) table.push(null);
  for (const row of rows) {
    const cells = Array(columns).fill('');
    cells[0] = (row.level > 1 ? '\\_' + ' '.repeat(2 * (row.level - 1)) : '') + row.title;
    cells[row.level] = formatClocktableDuration(row.minutes);
    table.push(cells);
  }
  return [
    `#+BEGIN: clocktable :maxlevel ${maxlevel} :scope file${tstartPart}${tendPart}`,
    `#+CAPTION: Clock summary at [${formatCaptionTimestamp(now)}]`,
    ...layoutTable(table.map((r) => (r ? r.flatMap((c, i) => (i === 0 ? c.split('|').map((x) => x.trim()) : [c])) : null)), widthWithLinks),
    '#+END:',
  ].join('\n');
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "2026-08-07 Fri 12:11" -- real org's own inactive-timestamp
 *  format with a day-name abbreviation and HH:MM (no seconds), the
 * @param {Date} date
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
