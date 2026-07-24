
/**
 * TODO-cycle logic. Per the requirements decision: the file's own #+TODO:
 * line(s) win if present; a global app-level default is the fallback when a
 * file doesn't specify any. There's no "merge" step between the file's own
 * configuration and the global default — it's one or the other, which keeps
 * the UI's TODO badge unambiguous about which sequence it's cycling through.
 *
 * When a file has multiple #+TODO: lines (real org allows this, and some
 * files use it deliberately, appending or overriding), this needs to
 * resolve them the exact same way org-parser.js itself does when it
 * decides what to set each heading's own .todo field to — otherwise the
 * two could disagree about which keywords are valid, which is exactly
 * what happened before this was fixed: a heading using a keyword from an
 * earlier #+TODO: line that a later line's non-empty TODO part replaced
 * (not merged) would have .todo === null (the parser correctly didn't
 * recognize it), while this function still considered that keyword part
 * of "the" sequence (it was reading only the first line, effectively
 * getting the opposite priority order from the parser's actual "each
 * later line updates, last one std" behavior) — so a real, undone task
 * could silently disappear from every feature that relies on this
 * (TODO cycling, Agenda's done-detection, the Task List) without ever
 * showing up as broken, since nothing threw — it just silently used the
 * wrong keyword set.
 */

import { DEFAULT_TODO_KEYWORDS, DEFAULT_DONE_KEYWORDS } from './org-parser.js';

const DEFAULT_SEQUENCE = { todoKeywords: ['TODO'], doneKeywords: ['DONE'] };

function parseTodoValue(value) {
  const [todoPart, donePart = ''] = value.split('|').map((s) => s.trim());
  return {
    todoKeywords: todoPart.split(/\s+/).filter(Boolean),
    doneKeywords: donePart.split(/\s+/).filter(Boolean),
  };
}

/**
 * Resolves which keyword sequence applies to `doc`: its own #+TODO:
 * line(s) if present, otherwise `globalDefault` (falling back to the
 * built-in TODO/DONE pair if no global default is supplied either).
 *
 * When there are multiple #+TODO: lines, each one updates the todo part
 * and/or done part independently (an empty part on a later line doesn't
 * blank out an earlier line's non-empty value for that part) — this is
 * org-parser.js's own algorithm, replicated exactly here rather than
 * approximated, since heading.todo values were set using THAT algorithm
 * and this function needs to agree with it, not use a different one.
 */
function resolveTodoSequence(doc, globalDefault) {
  const fallback = globalDefault || DEFAULT_SEQUENCE;
  if (!doc || !Array.isArray(doc.keywords)) return fallback;

  let todoKeywords = null;
  let doneKeywords = null;
  for (const kw of doc.keywords) {
    if (kw.key.toUpperCase() !== 'TODO') continue;
    const parsed = parseTodoValue(kw.value);
    if (parsed.todoKeywords.length) todoKeywords = parsed.todoKeywords;
    if (parsed.doneKeywords.length) doneKeywords = parsed.doneKeywords;
  }

  if (todoKeywords === null && doneKeywords === null) return fallback; // no #+TODO: line found at all
  return {
    todoKeywords: todoKeywords || [...DEFAULT_TODO_KEYWORDS],
    doneKeywords: doneKeywords || [...DEFAULT_DONE_KEYWORDS],
  };
}

/** The full cycle order: no keyword -> each TODO-type keyword -> each
 *  DONE-type keyword -> back to no keyword. Matches Emacs's default
 *  org-todo cycling (C-c C-t with no argument). */
function fullCycle(sequence) {
  return [null, ...sequence.todoKeywords, ...sequence.doneKeywords];
}

/**
 * Advances (or, with { direction: 'backward' }, retreats) `heading`'s TODO
 * state by one step in `sequence`'s cycle. Mutates and returns the new
 * value. A heading whose current state isn't part of the resolved sequence
 * (e.g. after switching sequences) is treated as if it were at the start
 * of the cycle rather than throwing — cycling should never dead-end.
 */
function cycleTodoState(heading, sequence, opts = {}) {
  const direction = opts.direction === 'backward' ? -1 : 1;
  const cycle = fullCycle(sequence);
  const currentIndex = cycle.indexOf(heading.todo);
  const idx = currentIndex === -1 ? 0 : currentIndex;
  const nextIndex = ((idx + direction) % cycle.length + cycle.length) % cycle.length;
  heading.todo = cycle[nextIndex];
  return heading.todo;
}

/**
 * Sets an explicit TODO state (e.g. from the command palette rather than
 * cycling one step at a time). Throws on a keyword outside the resolved
 * sequence — this one *should* be loud, since silently accepting an
 * unrecognized keyword would corrupt the file's TODO semantics.
 */
function setTodoState(heading, keyword, sequence) {
  const cycle = fullCycle(sequence);
  if (!cycle.includes(keyword)) {
    throw new Error(`setTodoState: "${keyword}" is not part of the resolved TODO sequence`);
  }
  heading.todo = keyword;
  return heading.todo;
}

function isDoneKeyword(keyword, sequence) {
  return sequence.doneKeywords.includes(keyword);
}

export {
  DEFAULT_SEQUENCE,
  parseTodoValue,
  resolveTodoSequence,
  fullCycle,
  cycleTodoState,
  setTodoState,
  isDoneKeyword,
};
