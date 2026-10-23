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

/** Where `org-add-log-note` puts a log item: into the drawer when `org-log-into-drawer` is set, else at the first non-blank
 * line of the entry, which is above an existing :LOGBOOK: drawer.  Newest first.
 * @param {Heading} heading @param {string[]} lines @param {boolean} intoDrawer */
export function insertLogLines(heading, lines, intoDrawer) {
  if (intoDrawer) {
    // Emacs, creating the drawer on an entry with nothing after it but a sub-heading, leaves a blank line before that heading
    if (heading.logbookLines.length === 0 && heading.children?.length && heading.bodyLines.every((l) => l.trim() === '') && !heading.bodyLines.length) heading.bodyLines.push('');
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
 * @param {{ settings: LogSettings, keepWhenNoTodo: boolean, now: Date }} context
 * @returns {PendingNote | null}
 */
export function applyTransitionEffects(heading, fromTodo, sequence, { settings, keepWhenNoTodo, now }) {
  const toTodo = heading.todo;
  const isDone = (/** @type {string | null} */ k) => k !== null && sequence.doneKeywords.includes(k);
  const isTodo = (/** @type {string | null} */ k) => k !== null && sequence.todoKeywords.includes(k) && !isDone(k);
  const logStates = Object.values(sequence.logSpecs || {}).some((s) => s);
  const logging = logStates || !!settings.logDone; // Emacs does no logging, and touches no CLOSED, unless one of them is set
  const timestamp = formatOrgTimestamp({ date: now, time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`, active: false });
  const intoDrawer = !!settings.logIntoDrawer;
  /** @type {PendingNote | null} */
  let pendingNote = null;

  // CLOSED goes when the entry has no state (unless kept) or goes from not-open to open again
  if (logging && ((toTodo === null && !keepWhenNoTodo) || (isTodo(toTodo) && !isTodo(fromTodo)))) heading.planning.closed = null;

  const enter = toTodo === null ? null : halves(sequence.logSpecs?.[toTodo]).enter;
  const leave = fromTodo === null ? null : halves(sequence.logSpecs?.[fromTodo]).leave;
  const dolog = enter || leave;
  const becameDone = isDone(toTodo) && !isDone(fromTodo);

  if (logging && dolog) {
    if (dolog === 'note') pendingNote = { heading, fromTodo, toTodo, timestamp, kind: 'state' };
    else insertLogLines(heading, formatStateLogLine(toTodo, fromTodo, timestamp), intoDrawer);
  }
  if (logging && becameDone && settings.logDone) {
    setClosed(heading, timestamp);
    if (settings.logDone === 'note' && !dolog) pendingNote = { heading, fromTodo, toTodo, timestamp, kind: 'done' };
  }

  if (becameDone && shiftEntryRepeaters(heading, now)) {
    // A repeating task is not finished: its dates move on and the state goes back to where the sequence starts.
    const repeatTo = heading.properties.REPEAT_TO_STATE?.trim();
    heading.todo = repeatTo && [...sequence.todoKeywords, ...sequence.doneKeywords].includes(repeatTo) ? repeatTo : fromTodo === null ? null : sequence.todoKeywords[0] || null;
    heading.planning.closed = null;
    if (settings.logRepeat) {
      setProperty(heading, 'LAST_REPEAT', timestamp);
      if (!dolog) {
        if (settings.logRepeat === 'note') pendingNote = { heading, fromTodo, toTodo, timestamp, kind: 'state' };
        else insertLogLines(heading, formatStateLogLine(toTodo, fromTodo ?? '', timestamp), intoDrawer);
      }
    } else if (Object.keys(heading.properties).includes('LAST_REPEAT')) {
      deleteProperty(heading, 'LAST_REPEAT');
    }
    if (pendingNote?.kind === 'done') pendingNote = null;
  }
  return pendingNote;
}

/** The log item a note panel writes once the person has typed their note.
 * @param {PendingNote} pending @param {string} text @param {LogSettings} settings */
export function writePendingNote(pending, text, settings) {
  const lines = pending.kind === 'done' ? formatNoteLine(`CLOSING NOTE ${pending.timestamp}`, text) : formatStateLogLine(pending.toTodo, pending.fromTodo, pending.timestamp, text);
  insertLogLines(pending.heading, lines, !!settings.logIntoDrawer);
}
