/**
 * Progress logging: decision logic for what should happen to a
 * heading's CLOSED planning line and :LOGBOOK: drawer when its TODO
 * state changes -- pure decision logic, no DOM/mutation here, matching
 * this codebase's established separation between engine logic (src/)
 * and the UI code that acts on its decisions (app.js).
 *
 * Two genuinely separate mechanisms, kept as two separate decision
 * functions rather than merged into one:
 *
 * - decideProgressLogging governs ONLY the CLOSED: [timestamp] planning
 *   line -- org-log-done's 'time value specifically, a dedicated field
 *   real org treats as its own thing, separate from LOGBOOK entirely.
 *
 * - decideLogbookEntry governs :LOGBOOK: "- State ..." lines -- the
 *   general per-keyword logging mechanism (the "!"/"@"/"@/!"/"/!"
 *   markers in a #+TODO: line's parenthetical spec), which applies to
 *   ANY keyword, not just done-type ones. org-log-done's 'note value is
 *   modeled here too, as a synthesized fallback spec ("@") applied to a
 *   done-type keyword that has no EXPLICIT per-keyword spec of its own
 *   -- an explicit spec on that keyword always wins over the
 *   #+STARTUP-level default, matching real org's own precedence.
 *   This means org-log-done='note isn't a separate code path at all;
 *   it's just one particular case this same engine already handles.
 *
 * Both can fire independently for the same transition -- e.g. entering
 * DONE(d!) with #+STARTUP: logdone also active inserts a CLOSED
 * timestamp AND a LOGBOOK "State" line, which can look redundant but is
 * how real org itself behaves; they're separate mechanisms that happen
 * to both be configured here; this doesn't try to silently suppress one
 * in favor of the other.
 */

// ---- CLOSED planning-line logic (org-log-done's 'time value only) -------

function shouldInsertClosedOnEnteringDone(fromTodo, toTodo, sequence, logDoneSetting) {
  if (logDoneSetting !== 'time') return false;
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
 * Decides what should happen to the CLOSED planning line for this
 * transition. Returns `{ insertClosed, removeClosed }`.
 */
function decideProgressLogging(fromTodo, toTodo, sequence, logDoneSetting, keepWhenNoTodo) {
  return {
    insertClosed: shouldInsertClosedOnEnteringDone(fromTodo, toTodo, sequence, logDoneSetting),
    removeClosed: shouldRemoveClosed(fromTodo, toTodo, sequence, keepWhenNoTodo),
  };
}

// ---- :LOGBOOK: entry logic (the general per-keyword spec mechanism) -----

/**
 * Interprets a raw logSpec string (the parenthetical suffix after a
 * keyword's fast-key, e.g. "@/!" in "WAIT(w@/!)") into its three
 * independent components. Real org only ever produces these four
 * concrete forms -- "@", "!", "@/!", "/!" -- notably never a leaving
 * *note* (only a leaving timestamp is possible); an unrecognized raw
 * spec is treated as no logging at all rather than guessing at intent.
 */
function parseLogSpec(rawSpec) {
  if (rawSpec === '@') return { enterNote: true, enterTimestamp: false, leaveTimestamp: false };
  if (rawSpec === '!') return { enterNote: false, enterTimestamp: true, leaveTimestamp: false };
  if (rawSpec === '@/!') return { enterNote: true, enterTimestamp: false, leaveTimestamp: true };
  if (rawSpec === '/!') return { enterNote: false, enterTimestamp: false, leaveTimestamp: true };
  return { enterNote: false, enterTimestamp: false, leaveTimestamp: false };
}

/**
 * The logging spec that actually applies to `keyword` for this file:
 * its own explicit per-keyword spec (`sequence.logSpecs[keyword]`) if
 * it has one -- an explicit spec always wins, regardless of
 * org-log-done -- otherwise, for a done-type keyword specifically, a
 * spec synthesized from org-log-done ('time -> "!", 'note -> "@") as
 * the fallback every done-keyword effectively gets unless it overrides
 * it individually. A non-done keyword with no explicit spec of its own
 * has no effective spec at all -- org-log-done only ever affects
 * done-type keywords.
 */
function effectiveLogSpec(keyword, sequence, logDoneSetting) {
  if (keyword === null) return null;
  if (sequence.logSpecs && keyword in sequence.logSpecs) return sequence.logSpecs[keyword];
  if (sequence.doneKeywords.includes(keyword)) {
    if (logDoneSetting === 'time') return '!';
    if (logDoneSetting === 'note') return '@';
  }
  return null;
}

/**
 * Decides whether a :LOGBOOK: "- State ..." entry should be written
 * for this transition, and whether it needs a note. This is the single
 * function that implements the conditional leaving-log rule: a
 * leaving-timestamp on the OLD state (fromTodo's own "/!") only fires
 * when the NEW state (toTodo) doesn't *already* log something on its
 * own entry -- if it does, that entering-log already covers the
 * transition, and the old state's own leaving-log is suppressed rather
 * than producing a second, redundant entry for the same moment.
 *
 * Returns `{ shouldLog, needsNote }`. When `shouldLog` is true and
 * `needsNote` is false, the caller can write a bare-timestamp entry
 * immediately; when `needsNote` is also true, the caller should prompt
 * for one first (matching Layer 1's own established UX: entering the
 * new state itself is never blocked on this, only the LOGBOOK entry is
 * -- and if the note prompt is skipped, no entry gets written at all,
 * not even a timestamp-only fallback).
 */
function decideLogbookEntry(fromTodo, toTodo, sequence, logDoneSetting) {
  if (fromTodo === toTodo) return { shouldLog: false, needsNote: false }; // not a real transition

  const enterSpec = parseLogSpec(effectiveLogSpec(toTodo, sequence, logDoneSetting));
  const fromSpec = parseLogSpec(effectiveLogSpec(fromTodo, sequence, logDoneSetting));

  const targetLogsOnEntry = enterSpec.enterNote || enterSpec.enterTimestamp;
  const leaveTimestamp = fromSpec.leaveTimestamp && !targetLogsOnEntry;

  const shouldLog = enterSpec.enterNote || enterSpec.enterTimestamp || leaveTimestamp;
  const needsNote = enterSpec.enterNote; // the only note-producing case -- a leaving-log is always timestamp-only, matching real org

  return { shouldLog, needsNote };
}

// ---- org-log-done's own 3-layer precedence (Global Variables < #+STARTUP < Local Variables) ----

/** Real Emacs Lisp quote-symbol syntax -- a Global/Local Variables
 *  value like `'time` or `'note` (the leading `'` is how Lisp writes a
 *  quoted symbol) resolves to the bare symbol name; anything else
 *  (including an unset or unrecognized value) resolves to null rather
 *  than guessing. */
function parseLogDoneLispValue(raw) {
  if (raw === undefined || raw === null) return null;
  const v = String(raw).trim().replace(/^'/, '');
  return v === 'time' || v === 'note' ? v : null;
}

/**
 * Resolves org-log-done's effective value across all three
 * precedence layers, highest first: a file's own "# Local Variables:"
 * block, then #+STARTUP: logdone/lognotedone, then the app-wide
 * Global Variables setting -- matching real Emacs' own actual
 * resolution order (see global-variables.js's own docs for why this
 * order specifically). `localVarsOnly` must be the file-local-only
 * map (parseLocalVariables's own direct output), NOT a map already
 * merged with Global Variables -- a pre-merged map can't tell "this
 * file set it explicitly" apart from "only the global default
 * applies", and only the former should outrank #+STARTUP.
 */
function getEffectiveLogDoneSetting(localVarsOnly, startupConfig, globalVarsOnly) {
  const local = parseLogDoneLispValue((localVarsOnly || {})['org-log-done']);
  if (local) return local;
  if (startupConfig && startupConfig.logDone) return startupConfig.logDone;
  return parseLogDoneLispValue((globalVarsOnly || {})['org-log-done']);
}

export { decideProgressLogging, decideLogbookEntry, effectiveLogSpec, parseLogSpec, getEffectiveLogDoneSetting, parseLogDoneLispValue };
