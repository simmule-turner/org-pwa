// Extracted from app.js: chrome.
import { getProperty } from '../src/archive-model.js';
import { formatTime } from '../src/capture-template.js';
import { currentClockSessionMinutes, formatClockDuration } from '../src/clock.js';
import { initialState as godModeInitialState } from '../src/god-mode.js';
import { getDisplayTimeFormat, getDisplayTimeMode } from '../src/local-variables.js';
import { parseOrgDuration } from '../src/org-duration.js';
import { findHeadingLineNumber } from '../src/org-parser.js';
import { S } from './app-state.js';
import { renderCalendarPanel } from './calendar-panel.js';
import { renderCapturePanel } from './capture-ui.js';
import { findRunningClockAcrossSessions } from './clock-flow.js';
import { contentAreaEl, extraMenuBtn, godModeBtn, minibufferSearchEl, modelineBarEl, modelineEl, navBackBtn, outlineEl, statusEl, topBarEl } from './dom.js';
import { setStatus } from './editing.js';
import { renderFileMenu, stopBrowsing } from './file-menu.js';
import { FLOATING_BUTTON_GAP, FLOATING_BUTTON_SIZE, positionFloatingKeyboard } from './floating-keyboard.js';
import { renderExtraMenu, renderMoreMenu } from './menus.js';
import { renderRefilePanel } from './refile-flow.js';
import { renderMinibufferSearch, renderSearchPanel } from './search-ui.js';
import { documentDisplayLabel, storageKindLabel } from './sync-helpers.js';
import { renderTodoWorkflowPanel } from './todo-workflow.js';
import { isWideLayout } from './ui-widgets.js';
import { renderViewMenu } from './views.js';

/** The element that's ACTUALLY scrollable right now -- #outline only
 *  gets its own overflow-y:auto inside the wide-layout (>=900px)
 *  media query; on the default, narrow/mobile layout it has no scroll
 *  behavior of its own at all, and #contentArea (the whole page's own
 *  scroll pane there) is what actually scrolls instead. Reading or
 *  writing outlineEl.scrollTop unconditionally is silently a no-op on
 *  mobile specifically -- the default, most common case, not an edge
 *  case -- since that element genuinely never scrolls there. */
export function scrollContainer() {
  return isWideLayout() ? outlineEl : contentAreaEl;
}

/** True while any overlay-style panel (extras menu, Settings, Docs,
 *  Capture, Search, the File menu, the View menu, the "More" menu,
 *  the undo History panel, or the single-month Calendar) is currently
 *  showing on top of the outline. Neither god-mode nor this app's
 *  own plain keyboard shortcuts should ever act while one of these
 *  has the user's actual attention -- confirmed as a real bug this
 *  app had until now: none of these panels touch `currentView`
 *  (they're all overlays, not separate views), so the outline's own
 *  keydown listener stayed completely unaware one was open, letting
 *  a plain shortcut silently mutate the hidden document underneath,
 *  or (worse, if god-mode happened to be active) swallowing every
 *  keystroke meant for that panel as a god-mode sequence instead. */
export function anyOverlayPanelOpen() {
  return (
    S.fileMenuOpen ||
    S.settingsOpen ||
    S.searchOpen ||
    S.captureOpen ||
    S.extraMenuOpen ||
    S.calendarOpen ||
    S.viewMenuOpen ||
    S.moreOpen ||
    S.historyOpen ||
    !!S.pendingTodoWorkflowChoice ||
    !!S.pendingRefile
  );
}

/** Closes whichever overlay panel(s) anyOverlayPanelOpen() found open,
 *  re-rendering each one so it actually disappears -- the shared
 *  Escape-to-dismiss behavior every one of these panels was missing
 *  on its own (see anyOverlayPanelOpen's own docs for why). */
export function closeAllOverlayPanels() {
  if (S.fileMenuOpen) {
    S.fileMenuOpen = false;
    S.fileMenuStep = null;
    stopBrowsing();
    renderFileMenu();
  }
  if (S.settingsOpen) {
    S.settingsOpen = false;
  }
  if (S.searchOpen) {
    S.searchOpen = false;
    S.searchQuery = '';
    renderSearchPanel();
  }
  if (S.captureOpen) {
    S.captureOpen = false;
    S.captureOpenedFromExtraMenu = false;
    S.captureOpenedViaGodMode = false;
    renderCapturePanel();
  }
  if (S.extraMenuOpen) {
    S.extraMenuOpen = false;
    renderExtraMenu();
  }
  if (S.calendarOpen) {
    S.calendarOpen = false;
    renderCalendarPanel();
  }
  if (S.viewMenuOpen) {
    S.viewMenuOpen = false;
    renderViewMenu();
  }
  if (S.moreOpen) {
    S.moreOpen = false;
    S.moreMenuStep = null;
    S.exportFormat = null;
    S.exportPickingHeading = false;
    renderMoreMenu();
  }
  if (S.historyOpen) {
    S.historyOpen = false;
  }
  if (S.pendingTodoWorkflowChoice) {
    S.pendingTodoWorkflowChoice = null;
    renderTodoWorkflowPanel();
  }
  if (S.pendingRefile) {
    S.pendingRefile = null;
    renderRefilePanel();
  }
}

export function renderMinibuffer() {
  if (anyOverlayPanelOpen() && S.godModeActive) {
    S.godModeActive = false;
    S.godModeState = godModeInitialState();
  }

  if (S.searchOpen) {
    statusEl.style.display = 'none';
    minibufferSearchEl.style.display = 'flex';
    renderMinibufferSearch();
    return;
  }
  minibufferSearchEl.style.display = 'none';
  statusEl.style.display = 'flex';

  if (S.godModeActive) {
    const seq = S.godModeState.chordString || (S.godModeState.pendingModifier ? '\u2026' : '');
    // a chord that has just completed: name what ran (the palette's own label,
    // when the chord has a palette command) instead of the bare ready prompt
    const done = S.godModeLastCommand;
    const ran = done ? `\ud83e\udde0 God-mode \u00b7 ${done.chord}${done.label ? ` \u2192 ${done.label}` : ''}` : '\ud83e\udde0 God-mode (Esc to exit)';
    setStatus(seq ? `\ud83e\udde0 God-mode: ${seq}` : ran);
  }
}

export function syncContentOffset() {
  const barHeight = topBarEl.offsetHeight;
  const bottomBarHeight = modelineBarEl.offsetHeight;
  const vv = window.visualViewport;
  const keyboardInset = vv ? Math.max(0, window.innerHeight - (vv.height + vv.offsetTop)) : 0;
  modelineBarEl.style.bottom = keyboardInset + 'px';
  contentAreaEl.style.marginTop = barHeight + 'px';
  contentAreaEl.style.height = `calc(100% - ${barHeight}px - ${bottomBarHeight}px - ${keyboardInset}px)`;
  extraMenuBtn.style.bottom = bottomBarHeight + keyboardInset + 16 + 'px';
  navBackBtn.style.bottom = bottomBarHeight + keyboardInset + 16 + 'px';
  // [g] rides with them: stacked directly above the Extras button while that
  // one is showing, in its slot when there is no Extras menu. Nothing that was
  // already floating moves to make room.
  const extrasShowing = extraMenuBtn.style.display !== 'none';
  godModeBtn.style.bottom = bottomBarHeight + keyboardInset + 16 + (extrasShowing ? FLOATING_BUTTON_SIZE + FLOATING_BUTTON_GAP : 0) + 'px';
  positionFloatingKeyboard();
}

/** Top/Bot/All/percentage -- real Emacs's own actual "how far down
 *  the buffer am I" modeline segment, computed from whichever element
 *  is genuinely the scrolling one right now (scrollContainer() --
 *  #outline on a wide layout, #contentArea on narrow, an existing,
 *  already-established distinction, not new for this feature). */
export function computeDocumentDepth() {
  const el = scrollContainer();
  if (!el) return '';
  const { scrollTop, scrollHeight, clientHeight } = el;
  if (scrollHeight <= clientHeight + 1) return 'All';
  if (scrollTop <= 0) return 'Top';
  if (scrollTop + clientHeight >= scrollHeight - 1) return 'Bot';
  return Math.round((scrollTop / (scrollHeight - clientHeight)) * 100) + '%';
}

/** "Top L15 C0"-style position string. Line number only when a
 *  heading is actually focused (via findHeadingLineNumber, which
 *  already existed for a different purpose) -- there's no meaningful
 *  "current line" for this app's own structured-editing model without
 *  one. Column only while a real text field is actively focused,
 *  reading its own live selectionStart -- omitted otherwise rather
 *  than fabricating an always-0 that would misrepresent an app with
 *  no persistent, Emacs-style point/cursor concept between edits. */
export function computeBufferPositionString() {
  const depth = computeDocumentDepth();
  let suffix = '';
  if (S.keyboardFocusedHeading && S.state.doc) {
    const lineNum = findHeadingLineNumber(S.state.doc, S.keyboardFocusedHeading);
    if (lineNum >= 0) suffix += ` L${lineNum + 1}`;
  }
  const active = document.activeElement;
  if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT') && typeof active.selectionStart === 'number') {
    const value = active.value || '';
    const beforeCursor = value.slice(0, active.selectionStart);
    const col = active.selectionStart - beforeCursor.lastIndexOf('\n') - 1;
    suffix += ` C${col}`;
  }
  return depth + suffix;
}

/** The shared "global-mode-string" portion of the modeline -- real
 *  Emacs's own actual construct that BOTH display-time-mode and
 *  org-clock append themselves to (confirmed directly: org-clock-in
 *  does (setq global-mode-string (append global-mode-string
 *  '(org-mode-line-string))), the exact same mechanism display-time
 *  uses) -- which is why both genuinely show in every buffer's own
 *  modeline in real Emacs, this app's own Help buffer included, not
 *  something specific to an ordinary document. `vars` follows this
 *  app's own already-established state.doc ? state.localVariables :
 *  globalVariables fallback (already used elsewhere for agenda files,
 *  contacts files), so a caller with no document open at all still
 *  correctly reflects the app-wide Settings baseline rather than a
 *  hardcoded default disconnected from it. The clock indicator scans
 *  across every open tab (findRunningClockAcrossSessions), not just
 *  one specific document -- now that the single-clock invariant is
 *  properly enforced there (only one can ever be running, app-wide),
 *  this correctly matches real Emacs's own genuinely global org-
 *  clock-marker behavior: the clock shows in every buffer's modeline
 *  regardless of which one it's actually running in, exactly like
 *  display-time already does. */
export function buildGlobalModeStringParts(vars) {
  const parts = [];
  if (getDisplayTimeMode(vars)) {
    parts.push(formatTime(new Date(), getDisplayTimeFormat(vars)));
  }
  const running = findRunningClockAcrossSessions();
  if (running) {
    const mins = currentClockSessionMinutes(running.heading);
    const effortRaw = getProperty(running.heading, 'EFFORT');
    const effortMins = Math.round(effortRaw ? parseOrgDuration(effortRaw) || 0 : 0);
    const overEstimate = effortMins > 0 && mins > effortMins;
    const clockText = effortMins > 0
      ? `${formatClockDuration(mins)} / ${formatClockDuration(effortMins)}${overEstimate ? ' !' : ''}`
      : formatClockDuration(mins);
    parts.push(`[\u23f1 ${clockText}] ${running.heading.title}`);
  }
  return parts;
}

export function renderModeline() {
  if (!S.state.doc) {
    modelineEl.textContent = '';
    return;
  }
  const vars = S.state.localVariables;
  const parts = [];

  // Modified indicator -- real Emacs's own -- (unmodified) / ** (unsaved
  // changes) convention. Real Emacs's own fuller buffer-state block also
  // includes a coding-system + end-of-line segment, deliberately left out
  // here: this app always writes UTF-8 and always normalizes to Unix (\n)
  // line endings on save regardless of the original file's own encoding,
  // so that portion would never actually vary for anything this app could
  // open -- static decoration, not real information, so it's not shown.
  parts.push(S.isBufferReadOnly ? (S.isDirty ? '%*' : '%%') : S.isDirty ? '**' : '--');

  parts.push(S.state.doc ? documentDisplayLabel(S.state.documentId, S.state.doc) + ' (' + storageKindLabel(S.state.storageKind) + ')' : '');
  parts.push(computeBufferPositionString());
  parts.push(...buildGlobalModeStringParts(vars));

  modelineEl.textContent = parts.join('  ');
}
