// @ts-check
/**
 * Emacs's undo list and the `undo` command on the text of a buffer: the records Emacs keeps for each change (`record_insert`,
 * `record_delete`, `record_point` of undo.c), the boundaries between commands, `primitive-undo`, and `undo` with its consecutive
 * undos and its redo (an undo that follows another command undoes the earlier undo).
 */

/**
 * One record of the list: an insertion `ins` (beg to end), a deletion `del` (the text and where it was; `end` when the caret was at
 * its end), a caret position `pt`, or `mark`, how the mark moved when the text around it was deleted. `null` is a boundary.
 * @typedef {{ k: 'ins', beg: number, end: number } | { k: 'del', text: string, at: number, end: boolean }
 *   | { k: 'pt', pos: number } | { k: 'mark', adj: number } | null} UndoEntry
 */
/** @typedef {{ e: UndoEntry, next: Cons }} ConsCell */
/** @typedef {ConsCell | null} Cons the list, newest first */

/**
 * @typedef {object} UndoState
 * @property {Cons} list `buffer-undo-list`
 * @property {number} ptBefore the caret before the running command (`point_before_last_command_or_undo`)
 * @property {Cons | true | undefined} pending `pending-undo-list`
 * @property {Map<Cons, Cons | 'empty'>} equiv `undo-equiv-table`
 * @property {number | null} amalgamated how many commands the last group took in (`undo-auto--last-boundary-cause`)
 */

/** @returns {UndoState} */
export const newUndo = () => ({ list: null, ptBefore: 0, pending: undefined, equiv: new Map(), amalgamated: null });

/** @typedef {{ text: string, pos: number, mark: number | null }} Buf */

/** @param {number | null} mark @param {number} from @param {number} to @param {number} inserted */
function markerAfter(mark, from, to, inserted) {
  if (mark === null) return null;
  if (mark >= to && (mark > from || to > from)) return mark - (to - from) + inserted;
  return mark > from ? from : mark;
}

/** @param {UndoState} u @param {UndoEntry} e */
const push = (u, e) => {
  u.list = { e, next: u.list };
};

/** `record_point`. @param {UndoState} u @param {number} beg */
function recordPoint(u, beg) {
  const atBoundary = u.list === null || u.list.e === null;
  if (atBoundary && u.ptBefore !== beg) push(u, { k: 'pt', pos: u.ptBefore });
}

/**
 * `record_delete`. @param {UndoState} u @param {number} beg @param {string} text @param {number} point the caret when it happened
 * @param {number | null} mark @param {boolean} markers whether markers in the text are recorded
 */
export function recordDelete(u, beg, text, point, mark, markers) {
  recordPoint(u, beg);
  if (markers && mark !== null && mark >= beg && mark <= beg + text.length && mark !== beg) push(u, { k: 'mark', adj: beg - mark });
  push(u, { k: 'del', text, at: beg, end: point === beg + text.length });
}

/** `record_insert`. @param {UndoState} u @param {number} beg @param {number} len */
export function recordInsert(u, beg, len) {
  recordPoint(u, beg);
  const head = u.list?.e;
  if (head && head.k === 'ins' && head.end === beg) {
    head.end = beg + len;
    return;
  }
  push(u, { k: 'ins', beg, end: beg + len });
}

/** `undo-boundary`: ends the group unless it is empty or already ended. @param {UndoState} u @param {number} point */
export function boundary(u, point) {
  if (u.list !== null && u.list.e !== null) push(u, null);
  u.ptBefore = point;
}

/**
 * `primitive-undo` of `n` groups from `list`. The text, caret and mark of `buf` change, and what is done is recorded in `u`.
 * @param {UndoState} u @param {Buf} buf @param {number} n @param {Cons} list @returns {Cons}
 */
function primitiveUndo(u, buf, n, list) {
  for (let g = n; g > 0; g -= 1) {
    for (;;) {
      if (list === null) break;
      const e = list.e;
      list = list.next;
      if (e === null) break;
      if (e.k === 'pt') buf.pos = e.pos;
      else if (e.k === 'ins') {
        buf.pos = e.beg;
        const text = buf.text.slice(e.beg, e.end);
        recordDelete(u, e.beg, text, buf.pos, buf.mark, true);
        buf.text = buf.text.slice(0, e.beg) + buf.text.slice(e.end);
        buf.mark = markerAfter(buf.mark, e.beg, e.end, 0);
      } else if (e.k === 'del') {
        const apos = e.at;
        /** @type {number[] | null} */ let valid = [];
        while (list && list.e && list.e.k === 'mark') {
          const adj = list.e.adj;
          list = list.next;
          valid = buf.mark === apos && valid ? [...valid, adj] : null;
        }
        buf.text = buf.text.slice(0, apos) + e.text + buf.text.slice(apos);
        recordInsert(u, apos, e.text.length);
        buf.mark = markerAfter(buf.mark, apos, apos, e.text.length);
        buf.pos = e.end ? apos + e.text.length : apos;
        if (valid && buf.mark !== null) for (const adj of valid) buf.mark -= adj;
      }
    }
  }
  return list;
}

/** Whether the newest change is an undo (`undo--last-change-was-undo-p`). @param {UndoState} u */
function lastChangeWasUndo(u) {
  let l = u.list;
  while (l && l.e === null) l = l.next;
  return u.equiv.has(l);
}

/**
 * The `undo` command.
 * @param {UndoState} u @param {Buf} buf @param {string | undefined} last the previous command
 * @returns {{ error?: string }}
 */
export function undo(u, buf, last) {
  const continuing = last === 'undo' && (u.pending === true || lastChangeWasUndo(u));
  if (!continuing) {
    u.pending = u.list;
    const rest = primitiveUndo(u, buf, 1, /** @type {Cons} */ (u.pending));
    u.pending = rest === null ? true : rest;
  }
  if (u.pending === true) return { error: 'No further undo information' };
  const rest = primitiveUndo(u, buf, 1, /** @type {Cons} */ (u.pending));
  u.pending = rest === null ? true : rest;
  let head = u.list;
  while (head && head.e === null) head = head.next;
  u.equiv.set(head, u.pending === true ? 'empty' : u.pending);
  // the undo command does not record caret positions: undoing it puts the caret where the change is
  let prev = null;
  for (let tail = u.list; tail && tail.e !== null; tail = tail.next) {
    if (tail.e.k === 'pt') {
      if (prev) prev.next = tail.next;
      else u.list = tail.next;
    }
    prev = tail;
  }
  return {};
}
