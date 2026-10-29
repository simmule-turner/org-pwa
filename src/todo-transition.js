// @ts-check
/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {import('./log-settings.js').LogSettings} LogSettings */
/**
 * What a change of TODO state does to the heading itself, apart from the screen: the CLOSED stamp, the log item, and a
 * repeating task's shifted dates.  Follows Emacs's `org-todo`, `org-auto-repeat-maybe` and `org-add-log-setup`, and is held
 * to them by test/todo-oracle.test.js.
 */
import { formatNoteLine, formatStateLogLine } from './logbook.js';
import { formatOrgTimestamp } from './org-timestamp.js';
import { shiftEntryRepeaters } from './repeater-shift.js';
import { setProperty, deleteProperty } from './archive-model.js';

/** @typedef {{ heading: Heading, fromTodo: string | null, toTodo: string | null, timestamp: string, kind: 'state' | 'done' }} PendingNote */

/** The two halves of a keyword's log spec, `@` a note, `!` a time stamp: "WAIT(w@/!)" enters with a note, leaves with a stamp.
 * @param {string | undefined} spec @returns {{ enter: 'note' | 'time' | null, leave: 'note' | 'time' | null }} */
function halves(spec) {
  const kind = (/** @type {string} */ c) => (c === '@' ? 'note' : c === '!' ? 'time' : null);
  if (!spec) return { enter: null, leave: null };
  const [enter = '', leave = ''] = spec.split('/');
  return { enter: kind(enter.trim()), leave: kind(leave.trim()) };
}

/** `org-add-planning-info` for CLOSED: a keyword already on the line is edited in place, a new one goes first.
 * @param {Heading} heading @param {string} stamp */
function setClosed(heading, stamp) {
  const planning = heading.planning;
  const order = planning.order || [];
  if (!order.includes('closed')) Object.defineProperty(planning, 'order', { value: ['closed', ...order], writable: true, enumerable: false });
  planning.closed = stamp;
}

/** Where `org-add-log-note` puts a log item: into the drawer when `org-log-into-drawer` is set (:LOGBOOK: for t, else the name it
 * gives), else at the first non-blank line of the entry, which is above an existing :LOGBOOK: drawer.  Newest first.
 * @param {Heading} heading @param {string[]} lines @param {string | boolean | null} intoDrawer a drawer name, or true for :LOGBOOK:
 * @param {boolean} [blankBeforeNextHeading] whether a drawer made on an otherwise empty entry leaves a blank line (it does for log notes, not for clocks) */
export function insertLogLines(heading, lines, intoDrawer, blankBeforeNextHeading = true) {
  const drawer = intoDrawer === true ? 'LOGBOOK' : intoDrawer || null;
  if (drawer && drawer !== 'LOGBOOK') {
    // a drawer of another name lives among the body lines, above the text
    const isOpen = (/** @type {string} */ l) => l.trim().toLowerCase() === `:${drawer.toLowerCase()}:`;
    const pre = heading.preLogLines || [];
    const openPre = pre.findIndex(isOpen);
    const open = heading.bodyLines.findIndex(isOpen);
    if (openPre >= 0) pre.splice(openPre + 1, 0, ...lines);
    else if (open >= 0) heading.bodyLines.splice(open + 1, 0, ...lines);
    else if (heading.logbookLines.length > 0) heading.preLogLines = [`:${drawer}:`, ...lines, ':END:', ...pre]; // above the :LOGBOOK: drawer
    else {
      heading.bodyLines.splice(0, 0, `:${drawer}:`, ...lines, ':END:');
      // as for :LOGBOOK:, a drawer made on an entry with nothing else leaves a blank line before the next heading
      if (blankBeforeNextHeading && heading.bodyLines.length === lines.length + 2 && heading.logbookLines.length === 0) heading.bodyLines.push('');
    }
  } else if (drawer) {
    // Emacs, creating the drawer on an entry with nothing after it but the next heading, leaves a blank line before that heading
    if (blankBeforeNextHeading && heading.logbookLines.length === 0 && heading.bodyLines.length === 0) heading.bodyLines.push('');
    heading.logbookLines.splice(0, 0, ...lines);
  } else if (heading.logbookLines.length > 0) {
    heading.preLogLines = [...lines, ...(heading.preLogLines || [])];
  } else {
    let at = heading.bodyLines.findIndex((l) => l.trim() !== '');
    if (at < 0) at = 0;
    heading.bodyLines.splice(at, 0, ...lines);
  }
}

/**
 * Call after `heading.todo` has changed from `fromTodo`.  Returns the note the person is still to be asked for, if the
 * transition asks for one, else null.
 * @param {Heading} heading
 * @param {string | null} fromTodo
 * @param {any} sequence
 * @param {{ settings: LogSettings, keepWhenNoTodo: boolean, now: Date, inhibitLogging?: boolean }} context
 *   `inhibitLogging` is Emacs's `org-inhibit-logging`: no log item or note is written, but CLOSED and LAST_REPEAT still follow their settings
 * @returns {PendingNote | null}
 */
export function applyTransitionEffects(heading, fromTodo, sequence, { settings, keepWhenNoTodo, now, inhibitLogging = false }) {
  const toTodo = heading.todo;
  const isDone = (/** @type {string | null} */ k) => k !== null && sequence.doneKeywords.includes(k);
  const isTodo = (/** @type {string | null} */ k) => k !== null && sequence.todoKeywords.includes(k) && !isDone(k);
  const specs = settings.logSpecs ?? sequence.logSpecs ?? {};
  const logStates = Object.values(specs).some((s) => s);
  const logging = logStates || !!settings.logDone; // Emacs does no logging, and touches no CLOSED, unless one of them is set
  const timestamp = formatOrgTimestamp({ date: now, time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`, active: false });
  const intoDrawer = settings.logIntoDrawer;
  /** @type {PendingNote | null} */
  let pendingNote = null;

  // CLOSED goes when the entry has no state (unless kept) or goes from not-open to open again
  if (logging && ((toTodo === null && !keepWhenNoTodo) || (isTodo(toTodo) && !isTodo(fromTodo)))) heading.planning.closed = null;

  const enter = toTodo === null ? null : halves(specs[toTodo]).enter;
  const leave = fromTodo === null ? null : halves(specs[fromTodo]).leave;
  const dolog = enter || leave;
  const becameDone = isDone(toTodo) && !isDone(fromTodo);
  const repeated = becameDone && shiftEntryRepeaters(heading, now);

  if (logging && dolog && !inhibitLogging) {
    // org-log-repeat `note` on a repeating task turns even a time stamp into a note: Emacs sets one log item up for both
    if (dolog === 'note' || (repeated && settings.logRepeat === 'note')) pendingNote = { heading, fromTodo, toTodo, timestamp, kind: 'state' };
    else insertLogLines(heading, formatStateLogLine(toTodo, fromTodo, timestamp), intoDrawer);
  }
  if (logging && becameDone && settings.logDone) {
    setClosed(heading, timestamp);
    if (settings.logDone === 'note' && !dolog && !inhibitLogging) pendingNote = { heading, fromTodo, toTodo, timestamp, kind: 'done' };
  }

  if (repeated) {
    // A repeating task is not finished: its dates move on and the state goes back to where the sequence starts.
    const repeatTo = heading.properties.REPEAT_TO_STATE?.trim();
    heading.todo = repeatTo && [...sequence.todoKeywords, ...sequence.doneKeywords].includes(repeatTo) ? repeatTo : fromTodo === null ? null : sequence.todoKeywords[0] || null;
    heading.planning.closed = null;
    if (settings.logSpecs && heading.todo !== toTodo) {
      // a LOGGING property is read again by the org-todo that moves the task back, so the state it enters logs by that property
      const back = halves(settings.logSpecs[heading.todo ?? '']).enter || halves(settings.logSpecs[toTodo ?? '']).leave;
      if (back && !pendingNote && !inhibitLogging) {
        if (back === 'note') pendingNote = { heading, fromTodo: toTodo, toTodo: heading.todo, timestamp, kind: 'state' };
        else insertLogLines(heading, formatStateLogLine(heading.todo, toTodo, timestamp), intoDrawer);
      }
    }
    if (settings.logRepeat) {
      setProperty(heading, 'LAST_REPEAT', timestamp);
      if (!dolog && !pendingNote && !inhibitLogging) {
        if (settings.logRepeat === 'note') pendingNote = { heading, fromTodo, toTodo, timestamp, kind: 'state' };
        else insertLogLines(heading, formatStateLogLine(toTodo, fromTodo ?? '', timestamp), intoDrawer);
      }
    } else if (Object.keys(heading.properties).includes('LAST_REPEAT')) {
      deleteProperty(heading, 'LAST_REPEAT');
    }
  }
  return pendingNote;
}

/** The log item a note panel writes once the person has typed their note.
 * @param {PendingNote} pending @param {string} text @param {LogSettings} settings */
export function writePendingNote(pending, text, settings) {
  const lines = pending.kind === 'done' ? formatNoteLine(`CLOSING NOTE ${pending.timestamp}`, text) : formatStateLogLine(pending.toTodo, pending.fromTodo, pending.timestamp, text);
  insertLogLines(pending.heading, lines, settings.logIntoDrawer);
}
