// @ts-check
/**
 * :LOGBOOK: drawer parsing and entry formatting. A heading-level
 * drawer, same as :PROPERTIES:, but structurally different enough
 * (varied line shapes, multi-line note continuations, content this
 * parser won't recognize every variant of -- CLOCK lines from
 * clocking, which isn't built yet, or a customized
 * org-log-note-headings format) that it follows body-parser.js's own
 * "additive, raw lines are the serialization source of truth" pattern
 * rather than :PROPERTIES:' full-reconstruction one. Losing an
 * unrecognized LOGBOOK line on save would be exactly the kind of
 * silent data loss this app's round-trip guarantee exists to prevent
 * -- parseLogbookEntries derives a best-effort structured view for
 * rendering/logic to use, but never removes anything from the raw
 * lines it was given; a line it can't make sense of is simply absent
 * from the derived entries, still present in the raw text.
 *
 * Real org's own default logging format (org-log-note-headings) is
 * what's recognized here -- not an arbitrary customization of it. The
 * three entry shapes real org actually produces for a plain state
 * transition:
 *
 *   - State "DONE"       from "TODO"       [2026-07-31 Fri 14:22]
 *   - State "WAIT"       [2026-07-30 Thu 09:10]
 *   - State "WAIT"       from "TODO"       [2026-07-30 Thu 09:10] \
 *     Blocked on vendor response.
 *
 * (no "from" clause at all when there was no previous keyword; a
 * trailing backslash plus indented continuation line(s) when a note
 * was taken alongside the state change.) CLOCK lines are parsed into
 * their own { type: 'clock', start, end, duration } entry, same as
 * state/note entries -- see app.js's own logbook-display rendering
 * for how each one is actually shown.
 */

const STATE_LINE_RE = /^-\s+State\s+"([^"]*)"(?:\s+from(?:\s+"([^"]*)")?)?\s+(\[[^\]]+\])(\s+\\{1,2})?\s*$/;
const NOTE_LINE_RE = /^-\s+Note taken on\s+(\[[^\]]+\])(\s+\\{1,2})?\s*$/;
const CLOCK_LINE_RE = /^CLOCK:\s+(\[[^\]]+\]|<[^>]+>)(?:--(\[[^\]]+\]|<[^>]+>)\s*=>\s*(-?\d+:\d+))?\s*$/;
const CONTINUATION_INDENT_RE = /^\s+\S/; // a note-continuation line: indented, not blank

/**
 * Parses the raw lines of a :LOGBOOK: drawer (everything between
 * :LOGBOOK: and :END:, exclusive of both) into structured entries, in
 * document order (most-recent-first, matching how real org itself
 * writes new entries at the top of the drawer -- this function doesn't
 * reorder anything, just reflects whatever order the lines were
 * actually in).
 *
 * Returns entries of three possible shapes:
 *   { type: 'state', newState, oldState (string|null), timestamp, note (string|null) }
 *   { type: 'note', timestamp, note }
 *   { type: 'clock', start, end (string|null), duration (string|null) }
 *
 * A line that doesn't match any recognized shape is skipped entirely
 * in the returned array -- it's still present in the drawer's own raw
 * lines (untouched, since this function never mutates its input), just
 * absent from this derived view.
 * @param {string[]} lines
 */
function parseLogbookEntries(lines) {
  const entries = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    const stateMatch = STATE_LINE_RE.exec(line);
    if (stateMatch) {
      const [, newState, oldState, timestamp, continues] = stateMatch;
      i++;
      /** @type {any} */
      let note = null;
      if (continues) {
        const collected = [];
        while (i < lines.length && CONTINUATION_INDENT_RE.test(lines[i])) {
          collected.push(lines[i].replace(/^\s+/, ''));
          i++;
        }
        note = collected.length ? collected.join('\n') : null;
      }
      entries.push({ type: 'state', newState, oldState: oldState || null, timestamp, note });
      continue;
    }

    const noteMatch = NOTE_LINE_RE.exec(line);
    if (noteMatch) {
      const [, timestamp, continues] = noteMatch;
      i++;
      const collected = [];
      if (continues) {
        while (i < lines.length && CONTINUATION_INDENT_RE.test(lines[i])) {
          collected.push(lines[i].replace(/^\s+/, ''));
          i++;
        }
      }
      // A bare note line with no continuation at all (malformed --
      // real org always writes one) still parses, just with empty text,
      // rather than being dropped from the derived view entirely.
      entries.push({ type: 'note', timestamp, note: collected.join('\n') });
      continue;
    }

    const clockMatch = CLOCK_LINE_RE.exec(line);
    if (clockMatch) {
      const [, start, end, duration] = clockMatch;
      entries.push({ type: 'clock', start, end: end || null, duration: duration || null });
      i++;
      continue;
    }

    i++; // unrecognized line -- skip in the derived view, left untouched in the raw lines
  }

  return entries;
}

/** Left-justifies `s` to at least 12 characters, matching real org's
 *  own org-log-note-headings default format string ("State %-12s from
 *  %-12s %t") exactly -- not just a fixed, arbitrary gap -- so a file
 *  written by this app looks like genuine org output when later opened
 * @param {string} s
 *  in real Emacs too. */
function padTo12(s) {
  return s.length >= 12 ? s : s + ' '.repeat(12 - s.length);
}

/**
 * Formats a single state-change entry into the exact line(s) real
 * org's own default org-log-note-headings format produces -- the
 * inverse of parseLogbookEntries' 'state case. `oldState` may be null
 * (no "from" clause, matching real org when there was no previous
 * keyword); `note` may be null (a bare timestamp, no trailing
 * backslash or continuation). Returns an array of lines, ready to
 * splice into a heading's logbookLines at the top (real org always
 * inserts new entries there, most-recent-first).
 * @param {string | null} newState
 * @param {string | null} oldState
 * @param {string} timestamp
 */
function formatStateLogLine(newState, oldState, timestamp, note = /** @type {string | null} */ (null)) {
  // org-log-note-headings: "State %-12s from %-12S %t".  With no old state %S is empty, so the "from" field is blank, not left out.
  const newPart = padTo12(`"${newState ?? ''}"`);
  const oldPart = padTo12(oldState === null ? '' : `"${oldState}"`);
  const head = `- State ${newPart} from ${oldPart} ${timestamp}`;
  const text = note ? note.replace(/^\s+|\s+$/g, '') : '';
  if (!text) return [head];
  return [`${head} \\\\`, ...text.split('\n').map((l) => (l.trim() ? `  ${l}` : ''))];
}

/**
 * A log item with another heading from `org-log-note-headings`, such as `CLOSING NOTE %t`; the note, if any, follows indented.
 * @param {string} heading e.g. "CLOSING NOTE [2026-10-11 Sun 16:30]"
 * @param {string | null} [note]
 */
function formatNoteLine(heading, note = null) {
  const text = note ? note.replace(/^\s+|\s+$/g, '') : '';
  if (!text) return [`- ${heading}`];
  return [`- ${heading} \\\\`, ...text.split('\n').map((l) => (l.trim() ? `  ${l}` : ''))];
}

/** Every log item of a heading: those above its :LOGBOOK: drawer (Emacs's default placement), then the drawer's own.
 * @param {{ logbookLines?: string[], preLogLines?: string[] }} heading */
function allLogLines(heading) {
  return [...(heading.preLogLines || []), ...(heading.logbookLines || [])];
}

export { allLogLines, parseLogbookEntries, formatStateLogLine, formatNoteLine };
