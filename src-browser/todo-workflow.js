// Extracted from app.js: todo workflow.
import { computeNonCollidingKeys } from '../src/capture-template.js';
import { updateCheckboxCookiesUpward } from '../src/checkbox-cookie.js';
import { getClosedKeepWhenNoTodo, parseLocalVariables } from '../src/local-variables.js';
import { formatStateLogLine } from '../src/logbook.js';
import { serializeOrg } from '../src/org-parser.js';
import { formatOrgTimestamp } from '../src/org-timestamp.js';
import { cycleHeadingTodo } from '../src/outline-view-model.js';
import { decideLogbookEntry, decideProgressLogging, getEffectiveLogDoneSetting } from '../src/progress-logging.js';
import { applyRepeaterShiftOnDone } from '../src/repeater-shift.js';
import { parseStartupConfig } from '../src/startup-config.js';
import { resolveTodoSequence, resolveTodoSequences, setTodoState } from '../src/todo-cycle.js';
import { S } from './app-state.js';
import { closeAllOverlayPanels } from './chrome.js';
import { GLOBAL_TODO_DEFAULT } from './constants.js';
import { showModalOverlay } from './dialogs.js';
import { doneNotePanel, doneNotePanelBox, refilePanel, refilePanelBox } from './dom.js';
import { commitAndRender } from './editing.js';
import { render } from './render.js';
import { autoGrowTextarea, hideModalOverlay, menuButton } from './ui-widgets.js';

/**
 * Every call site in this app that changes a heading's TODO state
 * (cycling, toggling) must go through this rather than calling
 * cycleHeadingTodo/toggleHeadingTodo directly -- progress logging needs
 * to see EVERY transition applied consistently, not just the ones some
 * call site happened to remember to wire up. `performChange` is a
 * thunk that actually performs the state change (e.g. `() =>
 * cycleHeadingTodo(state.doc, heading, GLOBAL_TODO_DEFAULT)`); this
 * wrapper captures the state immediately before and after it runs to
 * decide what logging actions apply.
 *
 * Two genuinely separate decisions get applied here, matching
 * progress-logging.js's own separation: the CLOSED planning line
 * (org-log-done's 'time value specifically) and a :LOGBOOK: "- State
 * ..." entry (the general per-keyword mechanism, which also subsumes
 * org-log-done's 'note value as a synthesized fallback spec -- see
 * effectiveLogSpec's own docs for why that isn't a separate code path).
 * Both can fire independently for the same transition.
 *
 * Parses #+STARTUP: fresh from state.doc on every call rather than
 * trusting state.startupConfig to already be current -- that cached
 * value isn't guaranteed refreshed at every point a heading's TODO
 * state could change (e.g. immediately after a plain-text-editor
 * round-trip), and this check is cheap enough that re-parsing beats
 * risking a stale read.
 */
export function applyTodoTransition(heading, performChange) {
  const fromTodo = heading.todo;
  performChange();
  const toTodo = heading.todo;

  const sequence = resolveTodoSequence(S.state.doc, GLOBAL_TODO_DEFAULT);
  const fileLocalVarsOnly = parseLocalVariables(serializeOrg(S.state.doc));
  const logDoneSetting = getEffectiveLogDoneSetting(fileLocalVarsOnly, parseStartupConfig(S.state.doc), S.globalVariables);
  const keepWhenNoTodo = getClosedKeepWhenNoTodo(S.state.localVariables);
  const now = new Date();
  const timestamp = formatOrgTimestamp({ date: now, time: now.toTimeString().slice(0, 5), active: false });

  const closedDecision = decideProgressLogging(fromTodo, toTodo, sequence, logDoneSetting, keepWhenNoTodo);
  if (closedDecision.insertClosed) {
    heading.planning.closed = timestamp;
  } else if (closedDecision.removeClosed) {
    heading.planning.closed = null;
  }

  const logbookDecision = decideLogbookEntry(fromTodo, toTodo, sequence, logDoneSetting);
  if (logbookDecision.shouldLog) {
    if (logbookDecision.needsNote) {
      S.pendingLogNote = { heading, fromTodo, toTodo, timestamp };
    } else {
      heading.logbookLines.splice(0, 0, ...formatStateLogLine(toTodo, fromTodo, timestamp));
    }
  }

  // Real org's own repeater-shift-on-DONE: completing a heading with
  // a repeating SCHEDULED/DEADLINE doesn't actually finish it -- the
  // date shifts forward and the state bounces straight back to TODO.
  // Only applies when THIS transition is what just entered a
  // done-type keyword (not e.g. cycling from one done-type keyword to
  // another) -- matches real org's own "on marking DONE" trigger.
  if (sequence.doneKeywords.includes(toTodo) && !sequence.doneKeywords.includes(fromTodo)) {
    if (applyRepeaterShiftOnDone(heading, sequence, now)) {
      // The bounce-back is an automatic side effect of the repeater,
      // not a real user-initiated transition -- real org's own actual
      // behavior logs only the original DONE entry above, not a
      // second one for this. The CLOSED timestamp just inserted DOES
      // still need to come back off, though, since the heading isn't
      // actually staying done.
      const bounceBackDecision = decideProgressLogging(toTodo, heading.todo, sequence, logDoneSetting, keepWhenNoTodo);
      if (bounceBackDecision.removeClosed) {
        heading.planning.closed = null;
      }
    }
  }

  // A heading's own TODO state is exactly what a :COOKIE_DATA: "todo"
  // cookie on some ancestor counts -- this transition may have just
  // changed that count, the same reasoning a checkbox toggle already
  // has its own updateCheckboxCookiesUpward call for.
  updateCheckboxCookiesUpward(S.state.doc, heading, sequence.doneKeywords);
}

/** Shows a small dedicated panel for taking (or skipping) the log note
 *  when a transition's effective logging spec requires one (either an
 *  explicit "@" on the keyword being entered, or org-log-done's 'note
 *  value acting as a same-shaped fallback for a done-type keyword with
 *  no spec of its own) -- the TODO badge already flipped immediately
 *  when tapped (applyTodoTransition doesn't wait for this), so
 *  declining to add a note here never reverts or blocks that state
 *  change; it only decides whether a :LOGBOOK: entry gets added
 *  alongside it. Skipping adds no entry at all -- not even a
 *  timestamp-only fallback -- matching real org's own behavior for a
 *  declined note prompt, and this app's own established convention
 *  from before this was generalized beyond just DONE. */
export function renderLogNotePrompt() {
  doneNotePanelBox.innerHTML = '';
  if (!S.pendingLogNote) {
    hideModalOverlay(doneNotePanel);
    return;
  }
  showModalOverlay(doneNotePanel);

  const { heading, fromTodo, toTodo, timestamp } = S.pendingLogNote;

  const label = document.createElement('div');
  label.style.fontSize = '12px';
  label.style.opacity = '0.7';
  label.style.marginBottom = '6px';
  label.textContent = `Note for marking "${heading.title || '(untitled)'}" as ${toTodo}:`;
  doneNotePanelBox.appendChild(label);

  const textarea = document.createElement('textarea');
  textarea.id = 'done-note-input';
  textarea.rows = 3;
  textarea.style.width = '100%';
  textarea.style.boxSizing = 'border-box';
  textarea.style.font = 'inherit';
  doneNotePanelBox.appendChild(textarea);
  autoGrowTextarea(textarea);

  const row = document.createElement('div');
  row.className = 'panel-row';
  row.style.marginTop = '6px';
  row.appendChild(
    menuButton('Save note', () => {
      const text = textarea.value.trim();
      S.pendingLogNote = null;
      if (text) {
        heading.logbookLines.splice(0, 0, ...formatStateLogLine(toTodo, fromTodo, timestamp, text));
      }
      commitAndRender(text ? 'Added log note' : 'Skipped log note');
    })
  );
  row.appendChild(
    menuButton('Skip', () => {
      S.pendingLogNote = null;
      renderLogNotePrompt();
    })
  );
  doneNotePanelBox.appendChild(row);

  requestAnimationFrame(() => textarea.focus());
}

/** The TODO action's own entry point -- called from both the keyboard
 *  shortcut and the action-menu "Mark as TODO"/"Remove TODO/DONE state"
 *  item, so the two stay in sync rather than drifting into separate
 *  behavior over time. A file with just one #+TODO: sequence (the
 *  overwhelming common case) behaves exactly as it always has --
 *  toggleHeadingTodo directly, no picker, no change in feel at all. A
 *  file with more than one parallel sequence opens the full state-picker
 *  panel instead, regardless of whether `heading` is currently blank or
 *  already mid-cycle -- "random access" to any state in any workflow,
 *  not just a choice of which workflow to start in, matching real org's
 *  own actual C-u C-c C-t direct-state-selection behavior more closely
 *  than a narrower "pick a workflow, land on its first state" design
 *  would. Tap-the-badge (cycleHeadingTodo, a separate code path) is
 *  deliberately untouched by any of this -- once a heading already has a
 *  keyword, which sequence it belongs to is already unambiguous, and a
 *  picker popping up on every single ordinary cycle tap would be a real,
 *  noticeable regression for the common case. */
export function openTodoOrPickWorkflow(heading) {
  const sequences = resolveTodoSequences(S.state.doc, GLOBAL_TODO_DEFAULT);
  if (heading.todo || sequences.length <= 1) {
    const hadTodo = !!heading.todo;
    applyTodoTransition(heading, () => cycleHeadingTodo(S.state.doc, heading, GLOBAL_TODO_DEFAULT));
    commitAndRender(hadTodo ? 'Cycled TODO state' : 'Marked as TODO');
    return;
  }
  const viaGodMode = S.godModeActive;
  if (viaGodMode) S.godModeActive = false;
  closeAllOverlayPanels();
  S.pendingTodoWorkflowChoice = { heading, viaGodMode };
  render();
  renderTodoWorkflowPanel();
}

/** Commits a state picked from the TODO-workflow panel (see
 *  renderTodoWorkflowPanel below) -- shared by both the button click
 *  and the keyboard fast-key handler (the global keydown listener),
 *  so the two paths can never drift into different behavior. */
export function chooseTodoWorkflowState(heading, keyword, seq) {
  S.pendingTodoWorkflowChoice = null;
  renderTodoWorkflowPanel();
  applyTodoTransition(heading, () => setTodoState(heading, keyword, seq));
  commitAndRender('Set TODO state');
}

/** Renders the full-state picker (see openTodoOrPickWorkflow above): one
 *  row per parallel #+TODO: sequence, one button per state within that
 *  sequence (blank/no-state isn't offered here -- Cancel already covers
 *  "I didn't mean to open this", and every workflow's own DONE-type
 *  states are included alongside its TODO-type ones, so jumping straight
 *  to "FIXED" without stepping through REPORT/BUG/KNOWNCAUSE first is
 *  exactly as reachable as any other state). Each button's own label is
 *  the literal keyword text as written in the file's own #+TODO: line,
 *  not a decorated or reformatted version of it. A keyword's own
 *  fast-select key, if the file's own #+TODO: line defined one, also
 *  works as a keyboard shortcut while this panel is open (see the
 *  global keydown listener) -- but the button always works regardless
 *  of whether a fast-key exists at all. */
export function renderTodoWorkflowPanel() {
  refilePanelBox.innerHTML = '';
  if (!S.pendingTodoWorkflowChoice) {
    hideModalOverlay(refilePanel);
    return;
  }
  showModalOverlay(refilePanel);
  const { heading, viaGodMode } = S.pendingTodoWorkflowChoice;
  const sequences = resolveTodoSequences(S.state.doc, GLOBAL_TODO_DEFAULT);

  const label = document.createElement('div');
  label.style.fontSize = '13px';
  label.style.marginBottom = '8px';
  label.textContent = 'This file has more than one TODO workflow \u2014 which state?';
  refilePanelBox.appendChild(label);

  // Flattened across every sequence shown together -- a fast-access
  // key colliding between two DIFFERENT workflows is just as much a
  // collision as two states sharing one within the same workflow, so
  // this has to span all of them, not be computed per-sequence.
  const allEntries = sequences.flatMap((seq) => [...seq.todoKeywords, ...seq.doneKeywords].map((keyword) => ({ seq, keyword })));
  const nonCollidingKeys = viaGodMode
    ? computeNonCollidingKeys(allEntries, (entry) => entry.seq.keySpecs[entry.keyword])
    : new Map();

  for (const seq of sequences) {
    const row = document.createElement('div');
    row.className = 'panel-row';
    row.style.flexWrap = 'wrap'; // smaller buttons still need to wrap onto more than one visual line for a longer workflow, rather than overflowing
    row.style.gap = '4px';
    const startState = seq.todoKeywords[0];
    for (const keyword of [...seq.todoKeywords, ...seq.doneKeywords]) {
      const btn = document.createElement('button');
      btn.style.fontSize = '11px'; // smaller than the default menuButton, specifically to fit more states per row
      btn.style.padding = '3px 6px';
      btn.style.display = 'flex';
      btn.style.alignItems = 'center';
      btn.style.gap = '4px';
      const hotkey = [...nonCollidingKeys.entries()].find(([entry]) => entry.seq === seq && entry.keyword === keyword)?.[1];
      if (hotkey) {
        const badge = document.createElement('span');
        badge.textContent = hotkey;
        badge.style.fontFamily = 'monospace';
        badge.style.border = '1px solid currentColor';
        badge.style.borderRadius = '3px';
        badge.style.padding = '0 3px';
        badge.style.opacity = '0.7';
        btn.appendChild(badge);
      }
      const label2 = document.createElement('span');
      label2.textContent = keyword;
      btn.appendChild(label2);
      if (keyword === startState) {
        btn.style.borderColor = 'var(--workflow-start-fg)';
        btn.style.color = 'var(--workflow-start-fg)';
      } else if (seq.doneKeywords.includes(keyword)) {
        btn.style.borderColor = 'var(--workflow-terminal-fg)';
        btn.style.color = 'var(--workflow-terminal-fg)';
        btn.style.fontWeight = '600'; // a done-type state ending a long, wrapped workflow still needs to read as clearly terminal even at this smaller size
      }
      btn.onclick = () => chooseTodoWorkflowState(heading, keyword, seq);
      row.appendChild(btn);
    }
    refilePanelBox.appendChild(row);
  }

  const actionRow = document.createElement('div');
  actionRow.className = 'panel-row';
  actionRow.appendChild(
    menuButton('Clear', () => {
      S.pendingTodoWorkflowChoice = null;
      renderTodoWorkflowPanel();
      applyTodoTransition(heading, () => {
        heading.todo = null;
      });
      commitAndRender('Removed TODO/DONE state');
    })
  );
  actionRow.appendChild(
    menuButton('Cancel', () => {
      S.pendingTodoWorkflowChoice = null;
      renderTodoWorkflowPanel();
    })
  );
  refilePanelBox.appendChild(actionRow);
}
