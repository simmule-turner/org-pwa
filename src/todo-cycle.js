
/**
 * TODO-cycle logic. Real org's own actual model for a file with multiple
 * #+TODO: lines: each line defines a SEPARATE, complete, parallel
 * sequence -- not a progressive override of the previous one (confirmed
 * directly: "Sometimes you may want to use different sets of TODO
 * keywords in parallel... To define TODO keywords that are valid only in
 * a single file... #+TODO: TODO(t) | DONE(d) #+TODO: REPORT(r) BUG(b)
 * KNOWNCAUSE(k) | FIXED(f)" -- two separate, coexisting workflows, not
 * one line replacing the other). Real org requires every keyword across
 * every parallel sequence in a file to be distinct, specifically so a
 * heading's own current keyword always unambiguously identifies which
 * sequence it belongs to -- no separate "which workflow is this" state is
 * ever needed once a heading actually has a keyword.
 *
 * resolveTodoSequences (plural, below) returns the array of parallel
 * sequences a file actually has -- what TODO-cycling itself needs, since
 * cycling a specific heading must stay within whichever ONE sequence that
 * heading's own keyword belongs to. resolveTodoSequence (singular) is
 * kept for the many existing consumers that only ever need a simple "is X
 * a done-type keyword" / "what are all the possible keywords" answer
 * (Agenda's own completion filtering, checkbox-cookie counting, badge
 * color) -- these don't need to know which specific sequence a keyword
 * came from, so a plain UNION across every sequence answers them
 * correctly (safe specifically because real org's own uniqueness
 * requirement above rules out any ambiguity). This union-based
 * resolveTodoSequence replaces this module's own earlier "last line
 * wins" fix, which was itself still wrong for the genuine multi-sequence
 * case: a heading using an EARLIER sequence's own keyword had that
 * keyword silently vanish from the resolved set entirely (not just read
 * from the wrong line, which was the original, narrower bug that fix
 * addressed) -- exactly the kind of silent, undone-task-disappears
 * failure mode this module's own docs already warned about, just not
 * fully fixed by that earlier pass.
 */

import { DEFAULT_TODO_KEYWORDS, DEFAULT_DONE_KEYWORDS, parseTodoSpecValue } from './org-parser.js';

const DEFAULT_SEQUENCE = { todoKeywords: ['TODO'], doneKeywords: ['DONE'], keySpecs: {}, logSpecs: {} };

/**
 * Parses EVERY #+TODO: line in `doc` into an array of separate, parallel
 * sequences, in document order -- real org's own actual multi-workflow
 * model (see this module's own header comment above). Falls back to a
 * single-element array holding `globalDefault` (or the built-in TODO/DONE
 * pair) when the file has no #+TODO: line at all.
 */
function resolveTodoSequences(doc, globalDefault) {
  const fallback = globalDefault || DEFAULT_SEQUENCE;
  if (!doc || !Array.isArray(doc.keywords)) return [fallback];
  const sequences = [];
  for (const kw of doc.keywords) {
    if (kw.key.toUpperCase() !== 'TODO') continue;
    const parsed = parseTodoSpecValue(kw.value);
    sequences.push({
      todoKeywords: parsed.todoKeywords.length ? parsed.todoKeywords : [...DEFAULT_TODO_KEYWORDS],
      doneKeywords: parsed.doneKeywords.length ? parsed.doneKeywords : [...DEFAULT_DONE_KEYWORDS],
      keySpecs: parsed.keySpecs,
      logSpecs: parsed.logSpecs,
    });
  }
  return sequences.length ? sequences : [fallback];
}

/**
 * Finds which of `sequences` (see resolveTodoSequences above) actually
 * contains `heading`'s own current keyword -- always unambiguous once a
 * heading has one, per real org's own uniqueness requirement across
 * parallel sequences. A blank heading (heading.todo === null) has no
 * keyword to disambiguate from at all -- returns the FIRST sequence,
 * matching real org's own actual default for a fresh heading. A
 * heading whose own current keyword isn't found in ANY sequence (e.g.
 * after the file's own #+TODO: lines changed) also falls back to the
 * first sequence -- the same "cycling should never dead-end" principle
 * cycleTodoState itself already has, just applied one level up.
 */
function findSequenceForHeading(sequences, heading) {
  if (heading.todo !== null) {
    const match = sequences.find((seq) => seq.todoKeywords.includes(heading.todo) || seq.doneKeywords.includes(heading.todo));
    if (match) return match;
  }
  return sequences[0];
}

/**
 * The simple, single-sequence view most consumers actually need: every
 * keyword across every one of the file's own parallel sequences (see
 * resolveTodoSequences above), unioned together. Safe specifically
 * because real org's own requirement that every keyword across every
 * sequence be distinct rules out any ambiguity in combining them this
 * way -- there's no case where the SAME keyword name means two
 * different things depending on which sequence it came from. Existing
 * callers checking "is X a done-type keyword" (Agenda's own completion
 * filtering, checkbox-cookie counting, the TODO badge's own color) get
 * a correct answer regardless of which specific sequence X belongs to,
 * without needing to know or care.
 */
function resolveTodoSequence(doc, globalDefault) {
  const sequences = resolveTodoSequences(doc, globalDefault);
  return {
    todoKeywords: [...new Set(sequences.flatMap((s) => s.todoKeywords))],
    doneKeywords: [...new Set(sequences.flatMap((s) => s.doneKeywords))],
    keySpecs: Object.assign({}, ...sequences.map((s) => s.keySpecs)),
    logSpecs: Object.assign({}, ...sequences.map((s) => s.logSpecs)),
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
  resolveTodoSequence,
  resolveTodoSequences,
  findSequenceForHeading,
  fullCycle,
  cycleTodoState,
  setTodoState,
  isDoneKeyword,
};
