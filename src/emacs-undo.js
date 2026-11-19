// @ts-check
/**
 * Emacs's undo list and the `undo` command on the text of a buffer: the records Emacs keeps for each change (`record_insert`,
 * `record_delete`, `record_point` of undo.c), the boundaries between commands, `primitive-undo`, and `undo` with its consecutive
 * undos and its redo (an undo that follows another command undoes the earlier undo).
 */

/**
 * One record of the list: an insertion `ins` (beg to end), a deletion `del` (the text and where it was; `end` when the caret was at
 * its end; `wrap`: it belongs to a change Emacs keeps as one wrapped entry, so the caret record inside it stays), a caret position `pt`, or `mark`, how the mark moved when the text around it was deleted. `null` is a boundary.
 * @typedef {{ k: 'ins', beg: number, end: number, wrap?: boolean } | { k: 'del', text: string, at: number, end: boolean, wrap?: boolean }
 *   | { k: 'pt', pos: number } | { k: 'mark', adj: number } | null} UndoEntry
 */
/** @typedef {{ e: UndoEntry, next: Cons }} ConsCell */
/** @typedef {ConsCell | null} Cons the list, newest first */

/**
 * @typedef {object} UndoState
 * @property {Cons} list `buffer-undo-list`
 * @property {number} ptBefore the caret before the running command (`point_before_last_command_or_undo`)
 * @property {Cons | true | 'region' | undefined} pending `pending-undo-list` ('region': what redo leaves after an undo in the region, which has no list to go on with)
 * @property {Map<Cons, Cons | 'empty' | 'region'>} equiv `undo-equiv-table` ('region': made by an undo in the region)
 * @property {boolean} inRegion `undo-in-region`, set when a run of undos begins
 * @property {number | null} amalgamated how many commands the last group took in (`undo-auto--last-boundary-cause`)
 */

/** @returns {UndoState} */
export const newUndo = () => ({ list: null, ptBefore: 0, pending: undefined, equiv: new Map(), amalgamated: null, inRegion: false });

/** @typedef {{ text: string, pos: number, mark: number | null, changed?: boolean }} Buf `changed` is set when the buffer was modified, even if the text ended up the same */

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
 * @param {number | null} mark @param {boolean} markers whether markers in the text are recorded @param {boolean} [wrap]
 */
export function recordDelete(u, beg, text, point, mark, markers, wrap = false) {
  recordPoint(u, beg);
  if (markers && mark !== null && mark >= beg && mark <= beg + text.length && mark !== beg) push(u, { k: 'mark', adj: beg - mark });
  push(u, { k: 'del', text, at: beg, end: point === beg + text.length, ...(wrap ? { wrap: true } : {}) });
}

/** `record_insert`. @param {UndoState} u @param {number} beg @param {number} len @param {boolean} [wrap] */
export function recordInsert(u, beg, len, wrap = false) {
  recordPoint(u, beg);
  const head = u.list?.e;
  if (!wrap && head && head.k === 'ins' && !head.wrap && head.end === beg) {
    head.end = beg + len;
    return;
  }
  push(u, { k: 'ins', beg, end: beg + len, ...(wrap ? { wrap: true } : {}) });
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
        buf.changed = true;
        buf.pos = e.beg;
        const text = buf.text.slice(e.beg, e.end);
        recordDelete(u, e.beg, text, buf.pos, buf.mark, true, e.wrap);
        buf.text = buf.text.slice(0, e.beg) + buf.text.slice(e.end);
        buf.mark = markerAfter(buf.mark, e.beg, e.end, 0);
      } else if (e.k === 'del') {
        buf.changed = true;
        const apos = e.at;
        /** @type {number[] | null} */ let valid = [];
        while (list && list.e && list.e.k === 'mark') {
          const adj = list.e.adj;
          list = list.next;
          valid = buf.mark === apos && valid ? [...valid, adj] : null;
        }
        buf.text = buf.text.slice(0, apos) + e.text + buf.text.slice(apos);
        recordInsert(u, apos, e.text.length, e.wrap);
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

/** `undo-adjust-pos`. @param {number} pos @param {Array<[number, number]>} deltas @param {boolean} [lt] compare with < */
function adjustPos(pos, deltas, lt = false) {
  let p = pos;
  for (const [at, by] of deltas) if (lt ? at < p : at <= p) p = Math.max(at, p - by);
  return p;
}

/**
 * `undo-make-selective-list`: the records inside the region from `start` to `end`, positions adjusted for the changes outside it, newest
 * first and headed by the boundary that `undo` takes off.
 * @param {Cons} list @param {number} start @param {number} end @returns {Cons}
 */
function selectiveList(list, start, end) {
  /** @type {UndoEntry[]} */ const out = [null];
  /** @type {Array<[number, number]>} */ const deltas = [];
  let last = /** @type {UndoEntry | undefined} */ (null);
  const add = (/** @type {UndoEntry} */ e) => { out.push(e); last = e; };
  for (let l = list; l; l = l.next) {
    const e = l.e;
    if (e === null) {
      if (last !== null) add(null);
      continue;
    }
    if (e.k === 'mark') continue;
    /** @type {UndoEntry} */ let adj;
    /** @type {boolean} */ let inside;
    /** @type {[number, number]} */ let delta = [0, 0];
    if (e.k === 'pt') {
      adj = { k: 'pt', pos: adjustPos(e.pos, deltas) };
      inside = adj.pos >= start && adj.pos <= end;
    } else if (e.k === 'ins') {
      const beg = adjustPos(e.beg, deltas);
      adj = { k: 'ins', beg, end: Math.max(beg, adjustPos(e.end, deltas, true)) };
      inside = adj.beg >= start && adj.end <= end;
      delta = [e.beg, e.beg - e.end];
    } else {
      adj = { k: 'del', text: e.text, at: adjustPos(e.at, deltas), end: e.end };
      inside = adj.at >= start && adj.at <= end;
      delta = [e.at, e.text.length];
    }
    if (inside) {
      end += adj.k === 'ins' ? adj.beg - adj.end : adj.k === 'del' ? adj.text.length : 0;
      add(adj);
      if (e.k === 'del') for (let m = l.next; m && m.e && m.e.k === 'mark'; m = m.next) add(m.e);
    } else if (delta[1] !== 0) deltas.unshift(delta);
  }
  /** @type {Cons} */ let result = null;
  for (let i = out.length - 1; i >= 0; i -= 1) result = { e: out[i], next: result };
  return result;
}

/**
 * The `undo` command.
 * @param {UndoState} u @param {Buf} buf @param {string | undefined} last the previous command @param {number} [n] how many groups
 * @param {{ start: number, end: number } | null} [region] where to undo, for an undo in the region
 * @returns {{ error?: string, message?: string }} the echo area's "Undo", "Undo in region" or "Redo" (when what is undone is itself an undo)
 */
export function undo(u, buf, last, n = 1, region = null) {
  const continuing = last === 'undo' && (u.pending === true || lastChangeWasUndo(u));
  if (!continuing) {
    u.inRegion = region !== null;
    u.pending = region && region.start !== region.end ? selectiveList(u.list, region.start, region.end) : u.list;
    const rest = primitiveUndo(u, buf, 1, /** @type {Cons} */ (u.pending));
    u.pending = rest === null ? true : rest;
  }
  if (u.pending === true || u.pending === 'region') return { error: 'No further undo information' + (u.inRegion ? ' for region' : '') };
  const message = `${u.equiv.has(/** @type {Cons} */ (u.pending)) ? 'Redo' : 'Undo'}${u.inRegion ? ' in region' : ''}`;
  const rest = primitiveUndo(u, buf, n, /** @type {Cons} */ (u.pending));
  u.pending = rest === null ? true : rest;
  let head = u.list;
  while (head && head.e === null) head = head.next;
  u.equiv.set(head, u.inRegion ? 'region' : u.pending === true ? 'empty' : u.pending);
  // the undo command does not record caret positions: undoing it puts the caret where the change is
  let prev = null;
  for (let tail = u.list; tail && tail.e !== null; tail = tail.next) {
    if (tail.e.k === 'pt' && !(prev && prev.e && 'wrap' in prev.e && prev.e.wrap)) {
      if (prev) prev.next = tail.next;
      else u.list = tail.next;
    }
    prev = tail;
  }
  return { message };
}

/**
 * `undo-redo` (`C-?`): takes back the last `n` undos by undoing them, and drops what the undoing recorded, so the list is as it was before them.
 * @param {UndoState} u @param {Buf} buf @param {number} [n] @returns {{ error?: string, message?: string }}
 */
export function redo(u, buf, n = 1) {
  if (!lastChangeWasUndo(u)) return { error: 'No undone changes to redo' };
  let ul = u.list;
  while (ul && ul.e === null) ul = ul.next;
  const rest = primitiveUndo(u, buf, n, ul);
  u.list = rest;
  let head = rest;
  while (head && head.e === null) head = head.next;
  const found = u.equiv.get(head);
  u.pending = found === undefined ? undefined : found === 'empty' ? true : found;
  return { message: `Redo${u.inRegion ? ' in region' : ''}` };
}
