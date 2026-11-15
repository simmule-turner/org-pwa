// @ts-check
// org-lint: checks the buffer for likely mistakes and lists the reports (line, trust, warning) in a buffer named *Org Lint*, which is
// shown in the Text view and takes the keys of Emacs's org-lint--report-mode: `h` hides the reports of the checker of the report on the
// cursor's line, `i` also ignores that checker in later refreshes, `S` sorts by the column under the cursor, `g` makes the reports again
// and RET goes to the reported line (a tap on a report selects it, a second tap on it goes there). The prefix argument selects checkers:
// `C-u` asks for a category, `C-u C-u` for one checker.
// Files are looked up in the storage of the document (a listed folder that lacks the name: not there; anything else: there), IDs
// among the open documents and the remembered IDs.
import { collectIds } from '../src/id-locations.js';
import { formatReports } from '../src/org-lint.js';
import { checkersOfCategory, columnAtOffset, hideChecker, ignoreChecker, LINT_COLUMNS, LINT_HEADER_LINES, lintBufferText, lintCategoryChoices, lintCheckerChoices, lintRowAtCaret, openLintBuffer, refreshReports, sortByColumn } from '../src/org-lint-buffer.js';
import { orgLintInStorage } from '../src/org-lint-files.js';
import { serializeOrg } from '../src/org-parser.js';
import { S } from './app-state.js';
import { isFolderPath, loadKnownPaths } from './device-folder.js';
import { createNewUnsavedDocument } from './documents-io.js';
import { outlineEl } from './dom.js';
import { commitTextModeIfActive, setStatus } from './editing.js';
import { listing } from './file-ops-io.js';
import { lookupIdLocation } from './id-locations.js';
import { readFromMinibuffer } from './minibuffer-prompt.js';
import { render } from './render.js';
import { switchToTab } from './tabs.js';
import { selectLines } from './text-view.js';
import { switchToView } from './views.js';

/** @typedef {import('../src/org-lint-buffer.js').LintBuffer} LintBuffer */
/** The *Org Lint* buffers: for the tab each one is in, the buffer and the tab of the document it checks. @type {Map<number, { buffer: LintBuffer, source: number }>} */
const lintBuffers = new Map();

/** The state of the tab `tabId` (the active tab's is S.state). @param {number | null} tabId */
function stateOfTab(tabId) {
  if (tabId === S.activeTabId) return S.state;
  const session = S.documentSessions.find((/** @type {Record<string, any>} */ s) => s.tabId === tabId);
  return session ? session.state : null;
}

/** Whether the active tab is an *Org Lint* buffer. */
export const lintBufferActive = () => S.activeTabId !== null && lintBuffers.has(S.activeTabId);

/**
 * The reports of the checkers `names` (all when null) for the document of `state`.
 * @param {Record<string, any>} state @param {string[] | null} names
 */
async function lintReports(state, names) {
  const text = serializeOrg(state.doc);
  const states = S.documentSessions.map((/** @type {Record<string, any>} */ s) => (s.tabId === S.activeTabId ? S.state : s.state)).filter(Boolean);
  const ids = new Set(states.flatMap((/** @type {Record<string, any>} */ s) => (s.doc ? collectIds(s.doc) : [])).map((id) => id.toLowerCase()));
  for (const m of text.matchAll(/\bid:([^\]#\s]+)/g)) {
    const id = m[1].toLowerCase();
    if (!ids.has(id) && (await lookupIdLocation(id))) ids.add(id);
  }
  await loadKnownPaths();
  const documentId = String(state.documentId || '');
  const place = state.storageKind === 'github' ? 'github' : state.storageKind === 'webdav' ? 'webdav' : state.storageKind === 'filesystem' && isFolderPath(documentId) ? 'device' : null;
  const listFolder = async (/** @type {string} */ folder) => {
    const entries = place ? await listing(place, folder) : null;
    return entries ? entries.map((e) => e.name) : null;
  };
  return orgLintInStorage(text, names, { idExists: (id) => ids.has(id.toLowerCase()), hasFile: !!state.documentId }, documentId, listFolder);
}

/**
 * completing-read with a required match, as org-lint asks for its prefix arguments.
 * @param {string} prompt @param {string[]} choices
 * @returns {Promise<string | null>} the answer ('' accepted, as completing-read returns it), or null when cancelled
 */
async function completeFrom(prompt, choices) {
  let shown = prompt;
  for (;;) {
    const answer = await readFromMinibuffer(shown, '', choices);
    if (answer === null || answer === '' || choices.includes(answer)) return answer;
    shown = prompt.replace(/: $/, ' [No match]: ');
  }
}

/**
 * org-lint: the document's reports in an *Org Lint* buffer. `prefix` is the prefix argument: 'category' (C-u) or 'checker' (C-u C-u).
 * @param {'category' | 'checker' | null} [prefix]
 */
export async function orgLintCommand(prefix = null) {
  commitTextModeIfActive();
  /** @type {string[] | null} */
  let names = null;
  if (prefix === 'category') {
    const answer = await completeFrom('Checker category: ', lintCategoryChoices());
    if (answer === null) return;
    names = checkersOfCategory(answer);
  } else if (prefix === 'checker') {
    const answer = await completeFrom('Checker name: ', lintCheckerChoices());
    if (answer === null) return;
    if (answer === '') {
      setStatus('Wrong type argument: org-lint-checker, nil'); // no checker has the name "": Emacs's (list nil) fails when the reports are made
      return;
    }
    names = [answer];
  }
  const source = S.activeTabId;
  const sourceState = S.state;
  const reports = await lintReports(sourceState, names);
  const buffer = openLintBuffer(names ?? lintCheckerChoices(), reports);
  await createNewUnsavedDocument(formatReports(reports), 'Org linting process completed', '*Org Lint*');
  if (source === null || S.activeTabId === null) return;
  lintBuffers.set(S.activeTabId, { buffer, source });
  if (S.currentView === 'text') {
    outlineEl.innerHTML = ''; // the Text view was built before the buffer was known
    render();
  } else switchToView('text');
}

/** The Text view showing now, if the active tab is an *Org Lint* buffer. @returns {HTMLTextAreaElement | null} */
function reportTextarea() {
  return lintBufferActive() ? /** @type {HTMLTextAreaElement | null} */ (document.getElementById('document-text-edit-input')) : null;
}

/** Shows the entries of the buffer again, with the cursor on the first report (tabulated-list-print ends at the start). @param {HTMLTextAreaElement} textarea @param {LintBuffer} buffer */
function showEntries(textarea, buffer) {
  textarea.value = lintBufferText(buffer);
  const first = textarea.value.split('\n').slice(0, LINT_HEADER_LINES).join('\n').length + 1;
  textarea.setSelectionRange(first, first);
  textarea.scrollTop = 0;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Goes to a line of the document the buffer checks, in its Text view. @param {number} source @param {number} line */
function goToSourceLine(source, line) {
  if (!S.documentSessions.some((/** @type {Record<string, any>} */ s) => s.tabId === source)) {
    setStatus('The buffer these reports are for is not open any more.');
    return;
  }
  switchToTab(source);
  if (S.currentView !== 'text') switchToView('text');
  queueMicrotask(() => {
    const box = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('document-text-edit-input'));
    if (box) selectLines(box, line, line);
  });
}

/**
 * One of the keys of the *Org Lint* buffer, acting on the report on the cursor's line of the Text view.
 * @param {'jump' | 'hide' | 'ignore' | 'sort' | 'refresh'} key
 */
export async function lintKey(key) {
  const info = S.activeTabId === null ? undefined : lintBuffers.get(S.activeTabId);
  if (!info) {
    setStatus('Open the *Org Lint* buffer first (Check for syntax mistakes).');
    return;
  }
  const textarea = reportTextarea();
  if (!textarea) {
    switchToView('text');
    setStatus('Put the cursor on a report in the Text view, then run it again.');
    return;
  }
  const { buffer, source } = info;
  if (key === 'refresh') {
    const state = stateOfTab(source);
    if (!state || !state.doc) {
      setStatus('The buffer these reports are for is not open any more.');
      return;
    }
    refreshReports(buffer, await lintReports(state, buffer.names));
    showEntries(textarea, buffer);
    return;
  }
  const row = lintRowAtCaret(textarea.value, textarea.selectionStart, buffer.entries.length);
  if (!row) {
    setStatus(key === 'sort' ? 'Cannot sort by nil' : 'Wrong type argument: arrayp, nil'); // what Emacs says with no report (or no column) under the cursor
    return;
  }
  if (key === 'jump') {
    goToSourceLine(source, buffer.entries[row.index].line);
    return;
  }
  if (key === 'sort') {
    const column = columnAtOffset(row.offset, row.length);
    if (column === null) {
      setStatus('Cannot sort by nil');
      return;
    }
    sortByColumn(buffer, column);
    setStatus(`Sorted by ${LINT_COLUMNS[column]}`);
  } else if (key === 'hide') hideChecker(buffer, row.index);
  else ignoreChecker(buffer, row.index);
  showEntries(textarea, buffer);
}

/**
 * What the Text view of an *Org Lint* buffer gets: a row of buttons for the keys (Jump, Hide, Ignore, Sort, Refresh) and the keys
 * themselves (h, i, S, g, Enter), and a tap on a report that selects it (a second tap on it goes to the line). Null for any other buffer.
 * @param {HTMLTextAreaElement} textarea
 * @returns {HTMLElement | null}
 */
export function lintToolsRow(textarea) {
  if (!lintBufferActive()) return null;
  const row = document.createElement('div');
  row.className = 'te-row';
  row.id = 'lint-tools';
  row.addEventListener('pointerdown', (e) => {
    if (/** @type {HTMLElement} */ (e.target).closest('button')) e.preventDefault(); // the cursor stays on the report
  });
  /** @param {string} label @param {string} hint @param {'jump' | 'hide' | 'ignore' | 'sort' | 'refresh'} key */
  const button = (label, hint, key) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'te-btn';
    b.textContent = label;
    b.title = hint;
    b.setAttribute('aria-label', hint);
    b.onclick = () => void lintKey(key);
    return b;
  };
  row.append(
    button('Jump', 'Go to the reported line (RET)', 'jump'),
    button('Hide', 'Hide the reports of this checker (h)', 'hide'),
    button('Ignore', 'Ignore this checker from now on (i)', 'ignore'),
    button('Sort', 'Sort by the column under the cursor (S)', 'sort'),
    button('Refresh', 'Make the reports again (g)', 'refresh')
  );
  /** @type {Record<string, 'jump' | 'hide' | 'ignore' | 'sort' | 'refresh'>} */
  const keys = { Enter: 'jump', h: 'hide', i: 'ignore', S: 'sort', g: 'refresh' };
  textarea.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || !Object.hasOwn(keys, e.key)) return;
    e.preventDefault(); // the buffer is read-only, as in Emacs
    void lintKey(keys[e.key]);
  });
  let selected = -1; // the report a tap selected
  textarea.addEventListener('input', () => (selected = -1)); // the reports are shown again: the rows moved
  textarea.addEventListener('click', () => {
    const info = S.activeTabId === null ? undefined : lintBuffers.get(S.activeTabId);
    if (!info) return;
    const at = lintRowAtCaret(textarea.value, textarea.selectionStart, info.buffer.entries.length);
    if (!at) {
      selected = -1;
      return;
    }
    if (selected === at.index) {
      void lintKey('jump');
      return;
    }
    selected = at.index;
    textarea.setSelectionRange(at.start, at.start + at.length);
  });
  return row;
}
