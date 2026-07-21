
/**
 * TODO-cycle logic. Per the requirements decision: the file's own #+TODO:
 * line wins if present; a global app-level default is the fallback when a
 * file doesn't specify one. There's no "merge" step — it's one or the
 * other, which keeps the UI's TODO badge unambiguous about which sequence
 * it's cycling through.
 */

const DEFAULT_SEQUENCE = { todoKeywords: ['TODO'], doneKeywords: ['DONE'] };

function parseTodoValue(value) {
  const [todoPart, donePart = ''] = value.split('|').map((s) => s.trim());
  return {
    todoKeywords: todoPart.split(/\s+/).filter(Boolean),
    doneKeywords: donePart.split(/\s+/).filter(Boolean),
  };
}

/**
 * Resolves which keyword sequence applies to `doc`: its own #+TODO: line if
 * present, otherwise `globalDefault` (falling back to the built-in TODO/DONE
 * pair if no global default is supplied either).
 */
function resolveTodoSequence(doc, globalDefault) {
  const fallback = globalDefault || DEFAULT_SEQUENCE;
  if (doc && Array.isArray(doc.keywords)) {
    for (const kw of doc.keywords) {
      if (kw.key.toUpperCase() === 'TODO') {
        return parseTodoValue(kw.value);
      }
    }
  }
  return fallback;
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
