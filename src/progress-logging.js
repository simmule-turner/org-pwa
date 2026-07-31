/**
 * Progress logging, Layer 1: org-log-done semantics. Decides what
 * should happen to a heading's CLOSED planning line (or, in 'note
 * mode, a note) when its TODO state changes -- pure decision logic,
 * no DOM/mutation here, matching this codebase's established
 * separation between engine logic (src/) and the UI code that acts on
 * its decisions (app.js).
 *
 * org-log-done's two values are mutually exclusive, not combined: 'time
 * inserts/removes a CLOSED: [timestamp] planning line and never prompts
 * for a note; 'note prompts for and stores a note instead, and never
 * touches the CLOSED planning line at all. null (real org's own actual
 * default -- no #+STARTUP: logdone/lognotedone line present) means
 * neither happens on entering DONE, though CLOSED removal on LEAVING a
 * done state still applies regardless (see closedLineAction below).
 */

/**
 * Whether entering DONE should insert a CLOSED timestamp: only when
 * `logDoneSetting` is exactly 'time' AND this transition is actually
 * "was not done, now is done" (re-marking an already-done heading as a
 * *different* done keyword, e.g. DONE -> KILL, doesn't count as
 * "entering" DONE and shouldn't insert a second CLOSED line or disturb
 * an existing one).
 */
function shouldInsertClosedOnEnteringDone(fromTodo, toTodo, sequence, logDoneSetting) {
  if (logDoneSetting !== 'time') return false;
  const wasDone = sequence.doneKeywords.includes(fromTodo);
  const isDone = sequence.doneKeywords.includes(toTodo);
  return !wasDone && isDone;
}

/**
 * Whether entering DONE should prompt for and store a note: the exact
 * same "was not done, now is done" transition as above, just gated on
 * logDoneSetting === 'note' instead of 'time'.
 */
function shouldPromptDoneNote(fromTodo, toTodo, sequence, logDoneSetting) {
  if (logDoneSetting !== 'note') return false;
  const wasDone = sequence.doneKeywords.includes(fromTodo);
  const isDone = sequence.doneKeywords.includes(toTodo);
  return !wasDone && isDone;
}

/**
 * Whether an existing CLOSED timestamp should be removed for this
 * transition: real org removes it whenever a done heading leaves its
 * done state, *unconditionally* (regardless of the file's current
 * org-log-done setting -- a stale CLOSED timestamp from an earlier
 * 'time-logging session should still be cleaned up even if logging was
 * since turned off or changed) -- with one specific carve-out:
 * `org-closed-keep-when-no-todo` (`keepWhenNoTodo`) controls ONLY the
 * "cycled all the way back to no TODO keyword at all" case
 * specifically. Cycling to a *different*, non-done TODO keyword always
 * removes CLOSED regardless of that setting -- real org has no
 * variable governing that case at all, it's simply how CLOSED works.
 */
function shouldRemoveClosed(fromTodo, toTodo, sequence, keepWhenNoTodo) {
  const wasDone = sequence.doneKeywords.includes(fromTodo);
  const isDone = sequence.doneKeywords.includes(toTodo);
  if (!wasDone || isDone) return false; // wasn't done, or still done (e.g. DONE -> KILL) -- nothing to remove either way
  if (toTodo === null && keepWhenNoTodo) return false;
  return true;
}

/**
 * The single entry point a caller (app.js's TODO-cycling call sites)
 * actually needs: given the heading's TODO state just before and just
 * after a transition, decides the full set of actions to take. Returns
 * `{ insertClosed, promptNote, removeClosed }` -- booleans, since more
 * than one could in principle apply to unusual custom sequences (though
 * insertClosed/promptNote are mutually exclusive in practice, since
 * they're gated on different, mutually-exclusive logDoneSetting values).
 */
function decideProgressLogging(fromTodo, toTodo, sequence, logDoneSetting, keepWhenNoTodo) {
  return {
    insertClosed: shouldInsertClosedOnEnteringDone(fromTodo, toTodo, sequence, logDoneSetting),
    promptNote: shouldPromptDoneNote(fromTodo, toTodo, sequence, logDoneSetting),
    removeClosed: shouldRemoveClosed(fromTodo, toTodo, sequence, keepWhenNoTodo),
  };
}

export { decideProgressLogging, shouldInsertClosedOnEnteringDone, shouldPromptDoneNote, shouldRemoveClosed };
