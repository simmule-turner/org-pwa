// @ts-check
// Extracted from app.js: search ui.
import { EmacsRegexError } from '../src/elisp-regex.js';
import { getPropertyInheritance, getUsePropertyInheritance, getUseTagInheritance } from '../src/local-variables.js';
import { countBlockOnlyMatches, createQueryReplace, createTextQueryReplace } from '../src/query-replace.js';
import { searchDocuments, searchDocumentsByMatchQuery } from '../src/search.js';
import { filesystemAdapter, githubAdapter, webdavAdapter } from './adapters.js';
import { aggregateAgendaDocs, localAgendaFilesWritable, aggregateSearchDocs, ensureAgendaFilesLoaded, ensureSearchExtraFilesLoaded, searchExtraFilesProblems } from './agenda-files.js';
import { S } from './app-state.js';
import { renderMinibuffer } from './chrome.js';
import { SEARCH_TYPE_ICON } from './constants.js';
import { buildQueryReplacePattern } from './doc-helpers.js';
import { openRemotePath } from './documents-io.js';
import { minibufferSearchEl, searchPanel } from './dom.js';
import { commitAndRender, setStatus } from './editing.js';
import { paintTextMatches } from './text-view.js';
import { isRowFindView, refreshRowFind, stepRowFind, stopRowFind, updateRowFindCount } from './find-in-view.js';
import { narrowToSparseMatches } from './gestures-structure.js';
import { navigateToHeadingByPath, outlinePathForHeadingInDocument } from './navigation.js';
import { render } from './render.js';
import { agendaFilesCache } from './singletons.js';
import { switchToTab } from './tabs.js';
import { VH_UNIT, appendSnippetWithHighlight, tableActionButton as tableActionButtonBase } from './ui-widgets.js';
import { promptText } from './dialogs.js';
import { openQueryView, saveQueryAsCommand } from './agenda-query-view.js';

/** Ends the search like Escape does: the query goes, and in the Text view the last match stays selected. */
function closeSearch() {
  S.searchOpen = false;
  S.searchQuery = '';
  render();
  renderSearchPanel();
}

export function renderMinibufferSearch() {
  minibufferSearchEl.innerHTML = '';
  minibufferSearchEl.style.display = 'flex';
  minibufferSearchEl.style.flexDirection = 'column';
  minibufferSearchEl.style.flex = '1';
  minibufferSearchEl.style.minWidth = '0';
  minibufferSearchEl.style.gap = '8px';
  minibufferSearchEl.style.padding = '8px 0'; // the same space above the field and below the last row, so nothing touches an edge

  const topRow = document.createElement('div');
  topRow.style.display = 'flex';
  topRow.style.alignItems = 'center';
  topRow.style.gap = '8px';
  minibufferSearchEl.appendChild(topRow);

  const input = document.createElement('textarea');
  input.id = 'search-query-input';
  input.rows = 1;
  input.placeholder = S.searchUseMatch ? 'family+work|urgent, PROP="value"\u2026' : 'Search, +word -word, or [tag|todo|priority|key]:value\u2026';
  input.value = S.searchQuery;
  input.style.flex = '1';
  input.style.minWidth = '0';
  input.style.height = '38px';
  input.style.boxSizing = 'border-box';
  input.style.font = 'inherit';
  input.style.fontSize = '16px';
  input.style.padding = '8px 12px';
  input.style.lineHeight = '20px';
  input.style.border = '1px solid var(--border-strong)';
  input.style.borderRadius = '8px';
  input.style.background = 'var(--bg)';
  input.style.color = 'var(--fg)';
  input.style.resize = 'none';
  input.style.overflow = 'hidden';
  input.style.whiteSpace = 'nowrap';
  input.addEventListener('input', () => {
    S.searchQuery = input.value;
    renderSearchResults();
    if (S.searchOptionsMenuOpen) renderSearchOptionsMenu(); // keeps the Replace row's own disabled state in sync as the query changes
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.preventDefault(); // a search query is one line; results already update live
    if (S.currentView === 'text' && (e.key === 'Enter' || ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'r')))) {
      e.preventDefault();
      stepTextFind(e.key === 'r' || e.shiftKey ? -1 : 1);
      return;
    }
    if (isRowFindView()) {
      // Emacs's incremental search keys: Enter or C-s next, Shift+Enter or C-r previous
      if (e.key === 'Enter' || ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'r'))) {
        e.preventDefault();
        stepRowFind(e.key === 'r' || e.shiftKey ? -1 : 1);
        return;
      }
    }
    if (S.currentView !== 'text' && !isRowFindView()) {
      // the same keys over the results list: Enter, Down or C-s next; Shift+Enter, Up or C-r previous
      const ctrl = e.ctrlKey || e.metaKey;
      if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp' || (ctrl && (e.key === 's' || e.key === 'r'))) {
        e.preventDefault();
        stepOrgResult(e.key === 'r' || e.key === 'ArrowUp' || e.shiftKey ? -1 : 1);
        return;
      }
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeSearch();
    }
  });
  topRow.appendChild(input);

  {
    for (const [label, aria, delta] of /** @type {[string, string, number][]} */ ([['\u25b2', 'Previous match', -1], ['\u25bc', 'Next match', 1]])) {
      const step = document.createElement('button');
      step.textContent = label;
      step.setAttribute('aria-label', aria);
      step.style.cssText = 'flex-shrink:0;min-width:38px;height:38px;padding:0 10px;display:flex;align-items:center;justify-content:center;font-size:16px;border:1px solid var(--border-strong);border-radius:8px;background:transparent;color:var(--fg);line-height:1;';
      step.onclick = () => {
        if (S.currentView === 'text') stepTextFind(delta);
        else if (isRowFindView()) stepRowFind(delta);
        else stepOrgResult(delta);
        input.focus({ preventScroll: true });
      };
      topRow.appendChild(step);
    }
  }
  const optionsBtn = document.createElement('button');
  optionsBtn.id = 'search-options-btn';
  optionsBtn.textContent = '\u22ef'; // horizontal ellipsis -- distinct from the More button's own vertical \u22ee, so the two don't read as the same control
  optionsBtn.setAttribute('aria-label', 'Search options');
  optionsBtn.style.position = 'relative';
  optionsBtn.style.fontSize = '18px';
  optionsBtn.style.height = '38px';
  optionsBtn.style.width = '38px';
  optionsBtn.style.padding = '0';
  optionsBtn.style.borderRadius = '8px';
  optionsBtn.style.border = '1px solid var(--border-strong)';
  optionsBtn.style.background = 'transparent';
  optionsBtn.style.color = 'var(--fg)';
  optionsBtn.style.flexShrink = '0';
  optionsBtn.style.lineHeight = '1';
  if (S.searchUseRegex || S.searchUseMatch) {
    const dot = document.createElement('span');
    dot.style.position = 'absolute';
    dot.style.top = '2px';
    dot.style.right = '2px';
    dot.style.width = '7px';
    dot.style.height = '7px';
    dot.style.borderRadius = '50%';
    dot.style.background = 'var(--accent)';
    optionsBtn.appendChild(dot);
  }
  optionsBtn.onclick = () => {
    S.searchOptionsMenuOpen = !S.searchOptionsMenuOpen;
    renderSearchOptionsMenu();
    input.focus({ preventScroll: true }); // restores focus (and so the on-screen keyboard) after the button's own click naturally took it away
  };
  topRow.appendChild(optionsBtn);

  if (isRowFindView()) {
    const count = document.createElement('div');
    count.id = 'find-row-count';
    count.style.cssText = 'font-size:12px;opacity:0.75;line-height:1.35;';
    minibufferSearchEl.appendChild(count);
    queueMicrotask(updateRowFindCount);
  }
  // the options wrap on the left; Close sits in a column of its own at the right, directly under the options button
  const optionsArea = document.createElement('div');
  optionsArea.id = 'search-options-area';
  optionsArea.style.cssText = 'display:none;align-items:flex-start;gap:8px;';
  const optionsRow = document.createElement('div');
  optionsRow.id = 'search-options-row';
  optionsRow.style.flex = '1';
  optionsRow.style.minWidth = '0';
  optionsRow.style.marginTop = '2px'; // 34px buttons centered against the 38px Close beside the first row
  const closeBtn = document.createElement('button');
  closeBtn.id = 'search-close-btn';
  closeBtn.textContent = '\u2715';
  closeBtn.setAttribute('aria-label', 'Close search');
  closeBtn.style.cssText = 'flex-shrink:0;width:38px;height:38px;padding:0;display:flex;align-items:center;justify-content:center;font-size:16px;border:1px solid var(--border-strong);border-radius:8px;background:transparent;color:var(--fg);line-height:1;';
  closeBtn.onclick = closeSearch;
  optionsArea.appendChild(optionsRow);
  optionsArea.appendChild(closeBtn);
  minibufferSearchEl.appendChild(optionsArea);

  input.focus({ preventScroll: true }); // the bar is already above the keyboard: nothing needs scrolling into view
  renderSearchOptionsMenu();
}

/** Regex/Match/Replace, expanding inline as a second row directly
 *  below the search input -- NOT a floating popover. That earlier
 *  design needed its own position computed relative to the viewport
 *  on every open, and broke in a new, platform-specific way each time
 *  a fix landed for the last one: first dismissing the on-screen
 *  keyboard, then rendering off-screen entirely once that was fixed
 *  (the search bar sits at the very bottom of the screen, so "always
 *  position below" had nowhere to go), and this exact class of bug
 *  was suspected again on Android specifically, where the keyboard's
 *  own real, live effect on window.innerHeight couldn't be reliably
 *  reproduced or confirmed without a physical device to test on. This
 *  version has no position to compute at all -- it's a normal DOM
 *  sibling in the page's own regular layout flow, so there's nothing
 *  left to get wrong across platforms. */
export function renderSearchOptionsMenu() {
  const optionsRow = document.getElementById('search-options-row');
  if (!optionsRow) return;
  optionsRow.innerHTML = '';
  const area = document.getElementById('search-options-area');
  if (area) area.style.display = S.searchOptionsMenuOpen ? 'flex' : 'none';
  if (!S.searchOptionsMenuOpen) return;

  optionsRow.style.display = 'flex';
  optionsRow.style.gap = '8px';
  optionsRow.style.flexWrap = 'wrap';

  /**
   * @param {string} label
   * @param {boolean} checked
   * @param {boolean} disabled
   * @param {() => void} onClick
   */
  function optionButton(label, checked, disabled, onClick) {
    const btn = document.createElement('button');
    btn.style.display = 'flex';
    btn.style.alignItems = 'center';
    btn.style.justifyContent = 'center';
    btn.style.gap = '5px';
    btn.style.fontSize = '14px';
    btn.style.height = '34px';
    btn.style.padding = '0 14px';
    btn.style.border = '1px solid var(--border-strong)';
    btn.style.borderRadius = '8px';
    btn.style.background = checked ? 'var(--fill-ghost-selected, rgba(127,127,127,0.15))' : 'transparent';
    btn.style.color = 'var(--fg)';
    btn.disabled = !!disabled;
    btn.style.opacity = disabled ? '0.4' : '1';
    btn.appendChild(document.createTextNode((checked ? '\u2713\u00a0' : '') + label)); // a check only on an option that is on, so a label is centered
    if (!disabled) btn.onclick = onClick;
    return btn;
  }

  optionsRow.appendChild(
    optionButton('Regex', S.searchUseRegex, false, () => {
      S.searchUseRegex = !S.searchUseRegex;
      if (S.searchUseRegex) S.searchUseMatch = false; // mutually exclusive: selecting Regex turns off Match
      renderMinibufferSearch();
      renderSearchResults();
    })
  );
  if (S.currentView !== 'text' && !isRowFindView()) {
    optionsRow.appendChild(
      optionButton('Match', S.searchUseMatch, false, () => {
        S.searchUseMatch = !S.searchUseMatch;
        if (S.searchUseMatch) S.searchUseRegex = false; // mutually exclusive: selecting Match turns off Regex
        renderMinibufferSearch();
        renderSearchResults();
      })
    );
  }
  if (S.currentView !== 'text') {
    // the panel's query as an Agenda view: Match as Match, Regex as a {regexp} word, anything else as Search words
    const asView = () => {
      const query = S.searchQuery.trim();
      const kind = S.searchUseMatch ? 'tags' : 'search';
      const text = S.searchUseRegex ? `{${query}}` : query;
      S.searchOpen = false;
      S.searchQuery = '';
      S.searchOptionsMenuOpen = false;
      renderSearchPanel();
      openQueryView(kind, { query: text });
    };
    optionsRow.appendChild(optionButton('Open as Agenda view', false, S.searchQuery.trim() === '', asView));
    optionsRow.appendChild(
      optionButton('Save as agenda command…', false, S.searchQuery.trim() === '', () => {
        const query = S.searchQuery.trim();
        saveQueryAsCommand(S.searchUseMatch ? 'tags' : 'search', S.searchUseRegex ? `{${query}}` : query, false);
      })
    );
  }
  if (!isRowFindView()) optionsRow.appendChild(
    optionButton('Replace', false, S.searchQuery.trim() === '' || S.searchUseMatch, () => {
      S.searchOptionsMenuOpen = false;
      renderSearchOptionsMenu();
      startQueryReplace();
    })
  );
}

/** Starts an Emacs-style query-replace walk over the CURRENT document
 *  only (not cross-file agenda-file results -- writing to several
 *  different documents' own backends in one walk is a substantially
 *  bigger, riskier undertaking than this first version takes on),
 *  using the search box's own current query as the find pattern.
 *  Restricted to node types with a safe, existing setter -- heading
 *  titles, paragraphs, list items, table cells -- structured fields
 *  (tags, TODO state, priority, properties, planning timestamps) and
 *  block content are silently skipped, never offered as a match at
 *  all, since blind text substitution into those risks corrupting the
 *  document's own syntax rather than just its content. */
export async function startQueryReplace() {
  if (S.searchQuery.trim() === '') return;
  const inTextMode = S.currentView === 'text';
  if (!inTextMode && !S.state.doc) return;
  let pattern;
  try {
    pattern = buildQueryReplacePattern(S.searchQuery, S.searchUseRegex);
  } catch (err) {
    const message = err instanceof EmacsRegexError ? err.message : String(err.message || err);
    setStatus('Invalid regex: ' + message);
    return;
  }
  const replacementText = await promptText(`Query replace "${S.searchQuery}" with:`, '', { okLabel: 'Replace' });
  if (replacementText === null) return; // cancelled
  // a plain-text search puts the replacement in as typed; a regexp search reads \1, \& and \\ in it, as in Emacs
  const walkText = S.searchUseRegex ? replacementText : replacementText.replace(/\\/g, '\\\\');

  if (inTextMode) {
    const textarea = document.getElementById('document-text-edit-input');
    const controller = createTextQueryReplace(textarea ? /** @type {any} */ (textarea).value : '', pattern, walkText);
    S.activeQueryReplace = { controller, replacementText, walkText, findPattern: S.searchQuery, pattern, inTextMode };
    renderSearchPanel();
    return;
  }

  ensureAgendaFilesLoaded();
  const matchingIds = aggregateAgendaDocs({ writable: true }) // a local agenda file is read-only, so a replace never walks into one
    .filter(({ doc }) => createQueryReplace(doc, pattern, walkText).current() !== null)
    .map(({ documentId }) => documentId);
  if (matchingIds.length === 0) {
    setStatus('No matches to replace.');
    return;
  }

  const [firstId, ...restIds] = matchingIds;
  if (firstId !== S.state.documentId) {
    const opened = await switchToAgendaDoc(firstId);
    if (!opened) {
      setStatus(`Couldn't open "${firstId}" to start replacing there.`);
      return;
    }
  }

  S.activeQueryReplace = {
    controller: createQueryReplace(S.state.doc, pattern, walkText),
    replacementText,
    walkText,
    findPattern: S.searchQuery,
    pattern,
    inTextMode: false,
    remainingFiles: restIds,
    totalReplaced: 0,
    filesChanged: 0,
  };
  renderSearchPanel();
}

/** Switches the live document to `documentId` for the multi-file
 *  replace walk -- reuses the tab already open for it if there is one
 *  (switchToTab), otherwise fetches and opens it fresh (openRemotePath),
 *  via whichever of GitHub/WebDAV it's configured under in
 *  agendaFilesCache -- the only two schemes a not-already-open agenda
 *  file can ever be (see ensureAgendaFilesLoaded's own docs; a local
 *  file can never appear here unless it's the one already open, which
 *  the existing-session branch above already handles). Returns true
 *  once state.doc genuinely is `documentId`, false if opening it
 *  failed (network error, etc.) -- callers should skip it and move on
 * @param {string} documentId
 *  rather than lose the rest of the walk over one file's own failure. */
export async function switchToAgendaDoc(documentId) {
  const existingSession = S.documentSessions.find((s) => (s.tabId === S.activeTabId ? S.state.documentId : s.state.documentId) === documentId);
  if (existingSession) {
    if (existingSession.tabId !== S.activeTabId) switchToTab(existingSession.tabId);
    return S.state.documentId === documentId;
  }
  const cacheEntry = [...agendaFilesCache.entries()].find(([, v]) => v.documentId === documentId);
  if (!cacheEntry) return false;
  const [key] = cacheEntry;
  const scheme = key.slice(0, key.indexOf(':'));
  if (scheme === 'local') {
    if (!localAgendaFilesWritable()) return false; // see localAgendaFilesWritable
    await openRemotePath(documentId, 'filesystem', filesystemAdapter, 'Local');
    return !!S.state.doc && S.state.documentId === documentId;
  }
  const adapter = scheme === 'github' ? githubAdapter : webdavAdapter;
  const label = scheme === 'github' ? 'GitHub' : 'WebDAV';
  await openRemotePath(documentId, scheme, adapter, label);
  return !!S.state.doc && S.state.documentId === documentId;
}

/** Called whenever the current file's own controller is exhausted --
 *  either naturally (walking y/n through every match) or after !
 *  finishes the rest of the current file. Real Calc's own ! is scoped
 *  to the current buffer only, never cascading unconditionally across
 *  the rest of a multi-file walk (confirmed directly against
 *  tags-query-replace's own documented behavior) -- ! callers reach
 *  this same function, not a separate "replace everywhere" path.
 *  Commits the current file's own changes via the same commitAndRender
 *  a single-file replace already uses (files are never auto-saved
 *  during the walk, matching every real multi-file Emacs replace
 *  command -- this is this app's own equivalent of "the buffer's own
 *  edits are applied", not a disk write), then either continues the
 *  walk on the next file with a match, or -- none remaining -- ends
 *  the whole operation via the existing finishQueryReplace. */
export async function advanceToNextFileOrFinish() {
  const aq = S.activeQueryReplace;
  if (aq.remainingFiles.length === 0) {
    finishQueryReplace(); // handles committing + reporting this (the last, or only) file entirely on its own
    return;
  }
  // More files remain -- commit this one's own changes and fold its
  // count into the running total before moving on, since
  // finishQueryReplace (called exactly once, only at the very end)
  // needs an accurate running total to add the FINAL file's own count
  // to, not a double-counted one.
  const countThisFile = aq.controller.replacedCount();
  commitAndRender('Query-replaced ' + countThisFile + ' occurrence' + (countThisFile === 1 ? '' : 's'));
  aq.totalReplaced += countThisFile;
  if (countThisFile > 0) aq.filesChanged += 1;

  const [nextId, ...rest] = aq.remainingFiles;
  aq.remainingFiles = rest;
  // afterDocumentLoaded (reached via either of switchToAgendaDoc's own
  // paths -- openRemotePath for a not-yet-open file, or switchToTab's
  // own closeAllOverlayPanels for an already-open one) unconditionally
  // resets searchOpen and calls renderSearchPanel() as part of its
  // own general "a document was just opened" bookkeeping -- with
  // activeQueryReplace still set at that moment, that stray call
  // would incorrectly finish the whole walk early. Clearing it here
  // means there's nothing for that call to prematurely finish; it's
  // restored right after, rebuilt against the newly-current document.
  S.activeQueryReplace = null;
  const opened = await switchToAgendaDoc(nextId);
  if (!opened) {
    S.activeQueryReplace = aq;
    setStatus(`Couldn't open "${nextId}" \u2014 skipped, continuing with the rest.`);
    await advanceToNextFileOrFinish();
    return;
  }
  aq.controller = createQueryReplace(S.state.doc, aq.pattern, aq.walkText);
  S.activeQueryReplace = aq;
  S.searchOpen = true;
  renderSearchPanel();
}

export function finishQueryReplace() {
  const { controller, pattern, inTextMode, totalReplaced, filesChanged } = S.activeQueryReplace;
  const count = controller.replacedCount();
  const grandTotal = (totalReplaced ?? 0) + count;
  const filesTouched = (filesChanged ?? 0) + (count > 0 ? 1 : 0);
  S.activeQueryReplace = null;
  let label;
  if (grandTotal > 0) {
    label =
      'Query-replaced ' +
      grandTotal +
      ' occurrence' +
      (grandTotal === 1 ? '' : 's') +
      (filesTouched > 1 ? ' across ' + filesTouched + ' files' : '') +
      '.';
  } else if (inTextMode) {
    label = 'Query-replace: nothing changed.';
  } else {
    const blockOnly = countBlockOnlyMatches(S.state.doc, pattern);
    label =
      blockOnly > 0
        ? blockOnly + ' match' + (blockOnly === 1 ? '' : 'es') + ' found only inside block content (e.g. #+BEGIN_VERSE) \u2014 not editable here; use Text view instead.'
        : 'Query-replace: nothing changed.';
  }
  if (inTextMode) {
    if (count > 0) {
      const textarea = document.getElementById('document-text-edit-input');
      if (textarea) {
        /** @type {any} */ (textarea).value = controller.getText();
        textarea.dispatchEvent(new Event('input', { bubbles: true })); // triggers the textarea's own existing auto-resize, wired to this event
      }
    }
  } else {
    commitAndRender('Query-replaced ' + count + ' occurrence' + (count === 1 ? '' : 's'));
  }
  setStatus(label);
  renderSearchPanel();
}

export function renderSearchPanel() {
  renderMinibuffer();
  searchPanel.innerHTML = '';
  if (!S.searchOpen) {
    stopRowFind();
    const textBox = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('document-text-edit-input'));
    if (textBox) paintTextMatches(textBox, [], -1); // the Text view's shading goes; the last match stays selected
    textFind.anchor = null;
    searchPanel.style.display = 'none';
    if (S.activeQueryReplace) finishQueryReplace();
    if (S.searchOptionsMenuOpen) {
      S.searchOptionsMenuOpen = false;
      renderSearchOptionsMenu();
    }
    return;
  }

  if (S.activeQueryReplace) {
    renderQueryReplacePrompt();
    return;
  }

  const resultsEl = document.createElement('div');
  resultsEl.id = 'search-results';
  resultsEl.style.maxHeight = `40${VH_UNIT}`;
  resultsEl.style.overflowY = 'auto';
  resultsEl.style.overscrollBehavior = 'contain';
  searchPanel.appendChild(resultsEl);

  renderSearchResults();
}

export function renderQueryReplacePrompt() {
  searchPanel.style.display = 'block';
  const { controller, replacementText, inTextMode, remainingFiles } = S.activeQueryReplace;
  const c = controller.current();
  if (!c) {
    if (inTextMode) finishQueryReplace();
    else advanceToNextFileOrFinish();
    return;
  }
  const { target, match, text } = c;

  const wrap = document.createElement('div');
  wrap.style.padding = '8px';

  const context = document.createElement('div');
  context.style.fontFamily = 'ui-monospace, monospace';
  context.style.fontSize = '13px';
  context.style.padding = '6px 8px';
  context.style.border = '1px solid var(--border)';
  context.style.borderRadius = '8px';
  context.style.marginBottom = '8px';
  context.style.overflowWrap = 'break-word';
  const radius = 40;
  const start = Math.max(0, match.index - radius);
  const end = Math.min(text.length, match.index + match[0].length + radius);
  context.appendChild(document.createTextNode((start > 0 ? '\u2026' : '') + text.slice(start, match.index)));
  const mark = document.createElement('mark');
  mark.textContent = match[0] || '\u2205'; // empty-set symbol so a genuinely zero-length match isn't invisible
  context.appendChild(mark);
  context.appendChild(document.createTextNode(text.slice(match.index + match[0].length, end) + (end < text.length ? '\u2026' : '')));
  wrap.appendChild(context);

  const label = document.createElement('div');
  label.style.fontSize = '12px';
  label.style.opacity = '0.7';
  label.style.marginBottom = '8px';
  const moreFilesHint = remainingFiles && remainingFiles.length > 0 ? ` (${remainingFiles.length} more file${remainingFiles.length === 1 ? '' : 's'} after this one)` : '';
  label.textContent =
    (target
      ? `${target.label} in "${target.heading.title || '(untitled)'}" \u2014 replace with "${replacementText}"?`
      : `Replace with "${replacementText}"?`) + moreFilesHint;
  wrap.appendChild(label);

  const prompt = document.createElement('div');
  prompt.style.fontFamily = 'ui-monospace, monospace';
  prompt.style.fontSize = '14px';
  prompt.style.marginBottom = '8px';
  prompt.textContent = 'Query replace (y, n, q, ., !): ';
  wrap.appendChild(prompt);

  // Two rows made by hand, y n q and then . and !, rather than left to wrap: where a row wrapped depended on the font's widths, and
  // a slightly wider font gave three lines. Each button grows to share its row.
  const buttons = document.createElement('div');
  buttons.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
  const row = document.createElement('div');
  row.className = 'panel-row';
  row.style.cssText = 'display:flex;flex-wrap:nowrap;gap:8px;margin:0;'; // .panel-row wraps and has margins: neither here, so a row is always one line
  const row2 = document.createElement('div');
  row2.className = 'panel-row';
  row2.style.cssText = 'display:flex;flex-wrap:nowrap;gap:8px;margin:0;';
  buttons.appendChild(row);
  buttons.appendChild(row2);
  /** the same size as the option buttons of the search bar: 34px tall, label centered, 8px corners
   *  @param {string} text @param {() => void} onClick */
  const tableActionButton = (text, onClick) => {
    const btn = tableActionButtonBase(text, onClick);
    btn.style.cssText += 'height:34px;min-height:34px;padding:0 8px;font-size:14px;border-radius:8px;display:flex;align-items:center;justify-content:center;margin:0;flex:1 1 auto;min-width:0;white-space:nowrap;';
    return btn;
  };
  row.appendChild(
    tableActionButton('y - replace', () => {
      controller.replace();
      renderSearchPanel();
    })
  );
  row.appendChild(
    tableActionButton('n - skip', () => {
      controller.skip();
      renderSearchPanel();
    })
  );
  row.appendChild(
    tableActionButton('q - quit', () => {
      controller.quit();
      finishQueryReplace();
    })
  );
  row2.appendChild(
    tableActionButton('. - replace, stop', () => {
      controller.replace();
      finishQueryReplace();
    })
  );
  row2.appendChild(
    tableActionButton('! - replace all', () => {
      controller.replaceAll();
      if (inTextMode) finishQueryReplace();
      else advanceToNextFileOrFinish();
    })
  );
  wrap.appendChild(buttons);

  searchPanel.appendChild(wrap);
}

/** The matches of the search box's query in the Text view's text, as [start, end] offsets (an empty match is not one).
 * @param {string} text @returns {Array<[number, number]>} */
function textMatchRanges(text) {
  const pattern = buildQueryReplacePattern(S.searchQuery, S.searchUseRegex);
  const globalPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
  /** @type {Array<[number, number]>} */ const ranges = [];
  for (const m of text.matchAll(globalPattern)) if (m[0].length > 0) ranges.push([m.index, m.index + m[0].length]);
  return ranges;
}

/** The find in the Text view: the matches, which one is current, and the line that says so. */
const textFind = {
  ranges: /** @type {Array<[number, number]>} */ ([]),
  index: -1,
  /** where the search began, as in Emacs's isearch: every change of the query searches from here, so deleting a letter goes back to the
   *  earlier match; Enter or C-s moves it to the match reached. null until the first query. */
  anchor: /** @type {number | null} */ (null),
};

/** Shows "N of M matches" in the results panel, shades the matches in the text and, when `select`, makes the first match from the
 *  cursor the current one (selected, scrolled into view). The text box keeps its own cursor and selection: closing the search leaves
 *  the last match selected, as Emacs leaves point on it.
 *  @param {boolean} select */
function refreshTextFind(select) {
  const resultsEl = document.getElementById('search-results');
  const textarea = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('document-text-edit-input'));
  if (!resultsEl) return;
  resultsEl.innerHTML = '';
  textFind.ranges = [];
  textFind.index = -1;
  if (!S.searchQuery.trim()) {
    textFind.anchor = null; // an emptied query is back at the start, with the cursor where the search began
    searchPanel.style.display = 'none';
    if (textarea) paintTextMatches(textarea, [], -1);
    return;
  }
  searchPanel.style.display = 'block';
  const info = document.createElement('div');
  info.id = 'text-find-info';
  info.style.fontSize = '13px';
  info.style.padding = '6px 2px';
  info.style.opacity = '0.7';
  resultsEl.appendChild(info);
  if (!textarea) return;
  try {
    textFind.ranges = textMatchRanges(textarea.value);
  } catch (err) {
    const message = err instanceof EmacsRegexError ? err.message : String(err.message || err);
    info.style.color = '#c0392b';
    info.style.opacity = '1';
    info.textContent = 'Invalid regex: ' + message;
    paintTextMatches(textarea, [], -1);
    return;
  }
  const { ranges } = textFind;
  if (ranges.length > 0) {
    if (textFind.anchor === null) textFind.anchor = textarea.selectionStart;
    const from = textFind.anchor;
    const next = ranges.findIndex(([a]) => a >= from);
    textFind.index = next === -1 ? 0 : next; // past the last match it wraps to the first
    if (select) {
      const [a, b] = ranges[textFind.index];
      textarea.setSelectionRange(a, b);
    }
  }
  paintTextMatches(textarea, ranges, textFind.index);
  showTextFindCount();
  if (!textarea.dataset.findWatch) {
    textarea.dataset.findWatch = '1';
    textarea.addEventListener('input', () => {
      textFind.anchor = null; // the text changed: the search begins again from the cursor
      if (S.searchOpen && S.currentView === 'text' && S.searchQuery.trim()) refreshTextFind(false);
    });
    textarea.addEventListener('pointerdown', () => {
      textFind.anchor = null; // the cursor was put somewhere else
    });
  }
}

function showTextFindCount() {
  const info = document.getElementById('text-find-info');
  if (!info || info.style.color) return;
  const n = textFind.ranges.length;
  info.textContent = n === 0 ? 'No matches.' : `${textFind.index + 1} of ${n} match${n === 1 ? '' : 'es'}`;
}

/** Enter or C-s: the next match; Shift+Enter or C-r: the previous one; both wrap round, as in Emacs.
 * @param {number} delta 1 or -1 */
export function stepTextFind(delta) {
  const textarea = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('document-text-edit-input'));
  const n = textFind.ranges.length;
  if (!textarea || n === 0) return;
  textFind.index = (textFind.index + delta + n) % n;
  const [a, b] = textFind.ranges[textFind.index];
  textarea.setSelectionRange(a, b);
  textFind.anchor = a;
  paintTextMatches(textarea, textFind.ranges, textFind.index);
  showTextFindCount();
}

/** The Text-mode counterpart to renderSearchResults' own structured results list: the matches counted, shaded and stepped through
 *  in the text box itself, since there is no parsed document to list headings from. Match mode is not offered in Text mode at all:
 *  it is a tag/property concept that needs a parsed document, which doesn't exist for content still being edited as plain text. */
export function renderTextModeSearchResults() {
  refreshTextFind(true);
}

/** The cross-file results list in the Org view: the current result (the one Enter, the arrows and C-s/C-r move between) is marked. */
/** @type {{ key: string, index: number, rows: HTMLElement[], results: Array<{ documentId: string, type: string, heading: unknown, node?: unknown }>, label: HTMLElement | null }} */
const resultNav = { key: '', index: -1, rows: [], results: [], label: null };

function markCurrentResult() {
  resultNav.rows.forEach((row, i) => {
    row.style.background = i === resultNav.index ? 'var(--fill-ghost-selected, rgba(127,127,127,0.15))' : '';
  });
  if (resultNav.label) {
    const total = resultNav.results.length;
    resultNav.label.textContent = resultNav.index >= 0 ? `${resultNav.index + 1} of ${total} result${total === 1 ? '' : 's'}` : `${total} result${total === 1 ? '' : 's'}`;
  }
  // scrolls the list itself only (scrollIntoView would also move the page and the bars around it)
  const row = resultNav.rows[resultNav.index];
  const list = document.getElementById('search-results');
  if (row && list) {
    const above = row.getBoundingClientRect().top - list.getBoundingClientRect().top;
    const below = row.getBoundingClientRect().bottom - list.getBoundingClientRect().bottom;
    if (above < 0) list.scrollTop += above;
    else if (below > 0) list.scrollTop += below;
  }
}

/** Opens a result: the search closes and the document goes to it. */
function openResult(/** @type {{ documentId: string, type: string, heading: unknown, node?: unknown }} */ result) {
  const heading = /** @type {Parameters<typeof outlinePathForHeadingInDocument>[1]} */ (result.heading);
  S.searchOpen = false;
  renderSearchPanel();
  const outlinePath = outlinePathForHeadingInDocument(result.documentId, heading);
  if (outlinePath) {
    navigateToHeadingByPath(result.documentId, outlinePath, {
      revealOwnBody: result.type !== 'heading',
      targetNode: /** @type {object | undefined} */ (result.node),
    });
  }
}

/** Enter, the arrows, C-s and C-r and the next and previous buttons: the next or previous result, wrapping around. Only the results
 *  list moves; the document stays where it is until a result is tapped. */
export function stepOrgResult(/** @type {number} */ delta) {
  const total = resultNav.results.length;
  if (total === 0) return;
  resultNav.index = resultNav.index < 0 ? (delta > 0 ? 0 : total - 1) : (resultNav.index + delta + total) % total;
  markCurrentResult();
}

export function renderSearchResults() {
  if (S.currentView === 'text') {
    renderTextModeSearchResults();
    return;
  }
  if (isRowFindView()) {
    // the rows on screen are marked in place instead of listing headings from every file (see find-in-view.js)
    searchPanel.style.display = 'none';
    refreshRowFind({ reset: true });
    return;
  }

  const resultsEl = document.getElementById('search-results');
  if (!resultsEl) return;
  resultsEl.innerHTML = '';
  document.getElementById('search-results-header')?.remove();
  resultNav.rows = [];
  resultNav.results = [];
  resultNav.label = null;
  const navKey = `${S.searchQuery}\u0000${S.searchUseRegex}\u0000${S.searchUseMatch}`;
  if (navKey !== resultNav.key) resultNav.index = -1; // a new query starts again before the first result
  resultNav.key = navKey;

  if (!S.searchQuery.trim() || !S.state.doc) {
    searchPanel.style.display = 'none';
    return;
  }
  searchPanel.style.display = 'block';

  ensureAgendaFilesLoaded();
  ensureSearchExtraFilesLoaded();

  // an extra file that is still loading, or failed, would otherwise just find nothing: say so
  const extra = searchExtraFilesProblems();
  if (extra.loading.length > 0 || extra.failed.length > 0) {
    const status = document.createElement('div');
    status.style.fontSize = '11px';
    status.style.padding = '2px 2px 6px';
    if (extra.failed.length > 0) status.style.color = '#c0392b';
    status.textContent = [extra.loading.length ? `Loading ${extra.loading.length} extra search file${extra.loading.length === 1 ? '' : 's'}\u2026` : '', ...extra.failed.map((f) => `"${f.key}": ${f.error}`)].filter(Boolean).join(' ');
    resultsEl.appendChild(status);
  }

  let results;
  try {
    results = S.searchUseMatch
      ? searchDocumentsByMatchQuery(aggregateSearchDocs(), S.searchQuery, {
          useTagInheritance: getUseTagInheritance(S.state.localVariables),
          usePropertyInheritance: getPropertyInheritance(S.state.localVariables),
        })
      : searchDocuments(aggregateSearchDocs(), S.searchQuery, {
          useRegex: S.searchUseRegex,
          useTagInheritance: getUseTagInheritance(S.state.localVariables),
          usePropertyInheritance: getUsePropertyInheritance(S.state.localVariables),
        });
  } catch (err) {
    const errorEl = document.createElement('div');
    errorEl.style.fontSize = '13px';
    errorEl.style.color = '#c0392b';
    errorEl.style.padding = '6px 2px';
    errorEl.textContent = err.message;
    resultsEl.appendChild(errorEl);
    return;
  }
  if (results.length === 0) {
    const empty = document.createElement('div');
    empty.style.fontSize = '13px';
    empty.style.opacity = '0.6';
    empty.style.padding = '6px 2px';
    empty.textContent = 'No matches.';
    resultsEl.appendChild(empty);
    return;
  }

  resultNav.results = results;
  if (resultNav.index >= results.length) resultNav.index = -1;
  const currentDocMatches = results.filter((r) => r.documentId === S.state.documentId).map((r) => r.heading);
  {
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'space-between';
    header.style.gap = '8px';
    header.style.padding = '4px 2px 8px';
    header.id = 'search-results-header';

    const countLabel = document.createElement('div');
    countLabel.style.fontSize = '12px';
    countLabel.style.color = 'var(--fg)';
    countLabel.style.opacity = '0.7';
    resultNav.label = countLabel;
    header.appendChild(countLabel);

    if (currentDocMatches.length > 0) {
    const narrowBtn = document.createElement('button');
    narrowBtn.textContent = 'Narrow';
    narrowBtn.style.fontFamily = 'monospace';
    narrowBtn.style.fontSize = '12px';
    narrowBtn.style.fontWeight = '700';
    narrowBtn.style.padding = '3px 9px';
    narrowBtn.style.borderRadius = '12px';
    narrowBtn.style.border = '1px solid var(--border-strong)';
    narrowBtn.style.background = 'transparent';
    narrowBtn.style.color = 'var(--fg)';
    narrowBtn.style.flexShrink = '0';
    narrowBtn.onclick = () => narrowToSparseMatches(new Set(currentDocMatches.filter((h) => /** @type {{ type: string }} */ (h).type === 'heading')));
    header.appendChild(narrowBtn);
    }

    // above the list, not in it: the count and Narrow stay put while the results scroll
    document.getElementById('search-results-header')?.remove();
    resultsEl.before(header);
  }

  for (const result of results) {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '6px';
    row.style.alignItems = 'baseline';
    row.style.padding = '6px 2px';
    row.style.minHeight = '44px';
    row.style.boxSizing = 'border-box';
    row.style.borderBottom = '1px solid var(--border)';
    row.style.cursor = 'pointer';

    const icon = document.createElement('span');
    icon.textContent = /** @type {any} */ (SEARCH_TYPE_ICON)[result.type] || '\u2022';
    icon.style.flexShrink = '0';
    icon.style.opacity = '0.6';
    icon.style.fontSize = '1.3em';
    row.appendChild(icon);

    const text = document.createElement('div');
    text.style.minWidth = '0';
    text.style.flex = '1 1 auto';
    const headingLine = document.createElement('div');
    headingLine.style.fontSize = '11px';
    headingLine.style.opacity = '0.6';
    if (result.type === 'heading' && result.snippet && result.snippet.text) {
      appendSnippetWithHighlight(headingLine, result.snippet);
    } else {
      headingLine.appendChild(document.createTextNode(/** @type {{ type: string }} */ (result.heading).type === 'document' ? 'Top of the file' : result.heading.title || '(untitled)'));
    }
    if (result.documentId !== S.state.documentId) {
      headingLine.appendChild(document.createTextNode(' \u2014 ' + result.documentId));
    }
    const snippetLine = document.createElement('div');
    snippetLine.style.fontSize = '14px';
    snippetLine.style.overflow = 'hidden';
    snippetLine.style.textOverflow = 'ellipsis';
    snippetLine.style.whiteSpace = 'nowrap';
    if (result.type !== 'heading') appendSnippetWithHighlight(snippetLine, result.snippet);
    text.appendChild(headingLine);
    if (result.type !== 'heading') text.appendChild(snippetLine);
    row.appendChild(text);

    row.onclick = () => openResult(result);
    resultNav.rows.push(row);
    resultsEl.appendChild(row);
  }
  markCurrentResult();
}
