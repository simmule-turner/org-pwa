// Extracted from app.js: search ui.
import { EmacsRegexError } from '../src/emacs-regex.js';
import { getUsePropertyInheritance, getUseTagInheritance } from '../src/local-variables.js';
import { countBlockOnlyMatches, createQueryReplace, createTextQueryReplace } from '../src/query-replace.js';
import { searchDocuments, searchDocumentsByMatchQuery } from '../src/search.js';
import { githubAdapter, webdavAdapter } from './adapters.js';
import { aggregateAgendaDocs, ensureAgendaFilesLoaded } from './agenda-files.js';
import { S } from './app-state.js';
import { renderMinibuffer } from './chrome.js';
import { SEARCH_TYPE_ICON } from './constants.js';
import { buildQueryReplacePattern } from './doc-helpers.js';
import { openRemotePath } from './documents-io.js';
import { minibufferSearchEl, searchPanel } from './dom.js';
import { commitAndRender, setStatus } from './editing.js';
import { narrowToSparseMatches } from './gestures-structure.js';
import { navigateToHeadingByPath, outlinePathForHeadingInDocument } from './navigation.js';
import { render } from './render.js';
import { agendaFilesCache } from './singletons.js';
import { switchToTab } from './tabs.js';
import { VH_UNIT, appendSnippetWithHighlight, tableActionButton } from './ui-widgets.js';

export function renderMinibufferSearch() {
  minibufferSearchEl.innerHTML = '';
  minibufferSearchEl.style.display = 'flex';
  minibufferSearchEl.style.flexDirection = 'column';
  minibufferSearchEl.style.flex = '1';
  minibufferSearchEl.style.minWidth = '0';
  minibufferSearchEl.style.gap = '6px';

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
  input.style.height = '26px';
  input.style.boxSizing = 'border-box';
  input.style.font = 'inherit';
  input.style.fontSize = '16px';
  input.style.padding = '4px 8px';
  input.style.border = '1px solid var(--border-strong)';
  input.style.borderRadius = '4px';
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
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      S.searchOpen = false;
      S.searchQuery = '';
      render();
      renderSearchPanel();
    }
  });
  topRow.appendChild(input);

  const optionsBtn = document.createElement('button');
  optionsBtn.id = 'search-options-btn';
  optionsBtn.textContent = '\u22ef'; // horizontal ellipsis -- distinct from the More button's own vertical \u22ee, so the two don't read as the same control
  optionsBtn.setAttribute('aria-label', 'Search options');
  optionsBtn.style.position = 'relative';
  optionsBtn.style.fontSize = '18px';
  optionsBtn.style.padding = '3px 10px';
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
    input.focus(); // restores focus (and so the on-screen keyboard) after the button's own click naturally took it away
  };
  topRow.appendChild(optionsBtn);

  const optionsRow = document.createElement('div');
  optionsRow.id = 'search-options-row';
  minibufferSearchEl.appendChild(optionsRow);

  input.focus();
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
  if (!S.searchOptionsMenuOpen) return;

  optionsRow.style.display = 'flex';
  optionsRow.style.gap = '6px';
  optionsRow.style.flexWrap = 'wrap';

  function optionButton(label, checked, disabled, onClick) {
    const btn = document.createElement('button');
    btn.style.display = 'flex';
    btn.style.alignItems = 'center';
    btn.style.gap = '5px';
    btn.style.fontSize = '13px';
    btn.style.padding = '5px 10px';
    btn.style.border = '1px solid var(--border-strong)';
    btn.style.borderRadius = '8px';
    btn.style.background = checked ? 'var(--fill-ghost-selected, rgba(127,127,127,0.15))' : 'transparent';
    btn.style.color = 'var(--fg)';
    btn.disabled = !!disabled;
    btn.style.opacity = disabled ? '0.4' : '1';
    const check = document.createElement('span');
    check.style.width = '12px';
    check.style.display = 'inline-block';
    check.textContent = checked ? '\u2713' : '';
    btn.appendChild(check);
    btn.appendChild(document.createTextNode(label));
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
  if (S.currentView !== 'text') {
    optionsRow.appendChild(
      optionButton('Match', S.searchUseMatch, false, () => {
        S.searchUseMatch = !S.searchUseMatch;
        if (S.searchUseMatch) S.searchUseRegex = false; // mutually exclusive: selecting Match turns off Regex
        renderMinibufferSearch();
        renderSearchResults();
      })
    );
  }
  optionsRow.appendChild(
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
  const replacementText = window.prompt(`Query replace "${S.searchQuery}" with:`, '');
  if (replacementText === null) return; // cancelled

  if (inTextMode) {
    const textarea = document.getElementById('document-text-edit-input');
    const controller = createTextQueryReplace(textarea ? textarea.value : '', pattern, replacementText);
    S.activeQueryReplace = { controller, replacementText, findPattern: S.searchQuery, pattern, inTextMode };
    renderSearchPanel();
    return;
  }

  ensureAgendaFilesLoaded();
  const matchingIds = aggregateAgendaDocs({ writable: true }) // a local agenda file is read-only, so a replace never walks into one
    .filter(({ doc }) => createQueryReplace(doc, pattern, replacementText).current() !== null)
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
    controller: createQueryReplace(S.state.doc, pattern, replacementText),
    replacementText,
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
  if (scheme === 'local') return false; // never written into by a replace (see aggregateAgendaDocs' writable option)
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
  aq.controller = createQueryReplace(S.state.doc, aq.pattern, aq.replacementText);
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
        textarea.value = controller.getText();
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
  resultsEl.style.maxHeight = `50${VH_UNIT}`;
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
  context.style.borderRadius = '4px';
  context.style.marginBottom = '6px';
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

  const row = document.createElement('div');
  row.className = 'panel-row';
  row.appendChild(
    tableActionButton('y \u2014 replace', () => {
      controller.replace();
      renderSearchPanel();
    })
  );
  row.appendChild(
    tableActionButton('n \u2014 skip', () => {
      controller.skip();
      renderSearchPanel();
    })
  );
  row.appendChild(
    tableActionButton('. \u2014 replace & stop', () => {
      controller.replace();
      finishQueryReplace();
    })
  );
  row.appendChild(
    tableActionButton('! \u2014 replace all', () => {
      controller.replaceAll();
      if (inTextMode) finishQueryReplace();
      else advanceToNextFileOrFinish();
    })
  );
  row.appendChild(
    tableActionButton('q \u2014 quit', () => {
      controller.quit();
      finishQueryReplace();
    })
  );
  wrap.appendChild(row);

  searchPanel.appendChild(wrap);
}

/** The Text-mode counterpart to renderSearchResults' own structured
 *  results list -- just a live match count against the textarea's own
 *  current value, since there's no parsed document (and so no
 *  per-match "heading"/"paragraph" context) to show anything richer
 *  than that yet. Match mode is deliberately not offered in Text mode
 *  at all: it's a structured, tag/property-based concept that needs a
 *  parsed document, which doesn't exist for content still being
 *  edited as plain text. */
export function renderTextModeSearchResults() {
  const resultsEl = document.getElementById('search-results');
  if (!resultsEl) return;
  resultsEl.innerHTML = '';

  if (!S.searchQuery.trim()) {
    searchPanel.style.display = 'none';
    return;
  }
  searchPanel.style.display = 'block';

  const textarea = document.getElementById('document-text-edit-input');
  const text = textarea ? textarea.value : '';

  const info = document.createElement('div');
  info.style.fontSize = '13px';
  info.style.padding = '6px 2px';
  try {
    const pattern = buildQueryReplacePattern(S.searchQuery, S.searchUseRegex);
    const globalPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
    const count = (text.match(globalPattern) || []).length;
    info.style.opacity = '0.7';
    info.textContent = count === 0 ? 'No matches.' : count + ' match' + (count === 1 ? '' : 'es') + ' in this text.';
  } catch (err) {
    const message = err instanceof EmacsRegexError ? err.message : String(err.message || err);
    info.style.color = '#c0392b';
    info.textContent = 'Invalid regex: ' + message;
  }
  resultsEl.appendChild(info);
}

export function renderSearchResults() {
  if (S.currentView === 'text') {
    renderTextModeSearchResults();
    return;
  }

  const resultsEl = document.getElementById('search-results');
  if (!resultsEl) return;
  resultsEl.innerHTML = '';

  if (!S.searchQuery.trim() || !S.state.doc) {
    searchPanel.style.display = 'none';
    return;
  }
  searchPanel.style.display = 'block';

  ensureAgendaFilesLoaded();

  let results;
  try {
    results = S.searchUseMatch
      ? searchDocumentsByMatchQuery(aggregateAgendaDocs(), S.searchQuery, {
          useTagInheritance: getUseTagInheritance(S.state.localVariables),
          usePropertyInheritance: getUsePropertyInheritance(S.state.localVariables),
        })
      : searchDocuments(aggregateAgendaDocs(), S.searchQuery, {
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

  const currentDocMatches = results.filter((r) => r.documentId === S.state.documentId).map((r) => r.heading);
  if (currentDocMatches.length > 0) {
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'space-between';
    header.style.gap = '8px';
    header.style.padding = '4px 2px 8px';

    const countLabel = document.createElement('div');
    countLabel.style.fontSize = '12px';
    countLabel.style.color = 'var(--fg)';
    countLabel.style.opacity = '0.7';
    const distinctCount = new Set(currentDocMatches).size;
    countLabel.textContent = `${distinctCount} match${distinctCount === 1 ? '' : 'es'} in this file`;
    header.appendChild(countLabel);

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
    narrowBtn.onclick = () => narrowToSparseMatches(new Set(currentDocMatches));
    header.appendChild(narrowBtn);

    resultsEl.appendChild(header);
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
    icon.textContent = SEARCH_TYPE_ICON[result.type] || '\u2022';
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
      headingLine.appendChild(document.createTextNode(result.heading.title || '(untitled)'));
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

    row.onclick = () => {
      S.searchOpen = false;
      renderSearchPanel();
      const outlinePath = outlinePathForHeadingInDocument(result.documentId, result.heading);
      if (outlinePath) {
        navigateToHeadingByPath(result.documentId, outlinePath, {
          revealOwnBody: result.type !== 'heading',
          targetNode: result.node,
        });
      }
    };
    resultsEl.appendChild(row);
  }
}
