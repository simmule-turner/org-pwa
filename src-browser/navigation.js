// Extracted from app.js: navigation.
import { findAncestorPath } from '../src/archive-model.js';
import { flattenVisibleRows } from '../src/outline-view-model.js';
import { findHeadingByOutlinePath } from '../src/refile.js';
import { githubAdapter, webdavAdapter } from './adapters.js';
import { S } from './app-state.js';
import { scrollContainer } from './chrome.js';
import { HELP_DOCUMENT_ID, NAVIGATION_BACK_STACK_LIMIT } from './constants.js';
import { openRemotePath } from './documents-io.js';
import { navBackBtn, outlineEl, sidePanelEl } from './dom.js';
import { setStatus } from './editing.js';
import { render } from './render.js';
import { renderSettingsView } from './settings-view.js';
import { agendaFilesCache } from './singletons.js';
import { isWideLayout } from './ui-widgets.js';
import { openOrSwitchToHelp, switchToView } from './views.js';

export function toggleActionMenu(node) {
  const opening = S.actionMenuFor !== node;
  S.actionMenuFor = opening ? node : null;
  render();

  if (!opening) return;
  requestAnimationFrame(() => {
    const rows = flattenVisibleRows(S.state.doc);
    const idx = rows.findIndex((r) => (r.rowType === 'list-item' ? r.item === node : r.node === node));
    if (idx === -1 || !outlineEl.children[idx]) return;
    outlineEl.children[idx].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
}

/** Shows/hides the floating back button based on whether there's
 *  actually anywhere to go back to -- called after every navigation
 *  (both a forward jump, which may have just pushed a new entry, and
 *  a back-navigation itself, which may have just emptied the stack). */
export function syncNavBackButtonVisibility() {
  navBackBtn.style.display = S.navigationBackStack.length > 0 ? 'flex' : 'none';
}

export function navigateToHeading(heading, { revealOwnBody = false, targetNode = heading, pushToBackStack = true } = {}) {
  if (pushToBackStack) {
    S.navigationBackStack.push({
      view: S.currentView,
      documentId: S.state.documentId,
      storageKind: S.state.storageKind,
      scrollTop: scrollContainer().scrollTop,
    });
    if (S.navigationBackStack.length > NAVIGATION_BACK_STACK_LIMIT) S.navigationBackStack.shift();
  }
  syncNavBackButtonVisibility();
  S.currentContextHeading = heading;
  // Always land in the outline — a caller (search, an internal link,
  // agenda) shouldn't each need to remember this. Safe to call even when
  // already in 'org': switchToView no-ops in that case rather than
  // re-rendering redundantly, and the render() below always runs anyway
  // to reflect the collapsed-state changes just made.
  if (S.currentView !== 'org') switchToView('org');

  for (const ancestor of findAncestorPath(S.state.doc, heading) || []) {
    ancestor.collapsed = false;
  }
  if (revealOwnBody) {
    heading.collapsed = false;
    heading.bodyHidden = false;
    heading.drawersHidden = false;
  }
  render();

  requestAnimationFrame(() => {
    const rows = flattenVisibleRows(S.state.doc);
    const idx = rows.findIndex((r) => (r.rowType === 'list-item' ? r.item === targetNode : r.node === targetNode));
    if (idx === -1 || !outlineEl.children[idx]) return;
    const el = outlineEl.children[idx];
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const original = el.style.backgroundColor;
    el.style.transition = 'background-color 1.2s';
    el.style.backgroundColor = 'rgba(255,214,0,0.45)';
    setTimeout(() => {
      el.style.backgroundColor = original;
    }, 5000);
  });
}

/** Maps a plain documentId (as agenda items and search results already
 *  carry it) back to which backend (github/webdav) it came from --
 *  needed to actually re-open it via openRemotePath for cross-document
 *  navigation. The currently open document's own storageKind is known
 *  directly; any other documentId can only be an agenda file (the
 *  only other source a heading reference can come from), found by
 *  matching against agendaFilesCache's own "scheme:path" keys -- the
 *  same key-parsing ensureAgendaFilesLoaded itself already does. */
export function storageKindForDocumentId(documentId) {
  if (documentId === S.state.documentId) return S.state.storageKind;
  for (const key of agendaFilesCache.keys()) {
    const colonIndex = key.indexOf(':');
    const scheme = colonIndex === -1 ? key : key.slice(0, colonIndex);
    const path = colonIndex === -1 ? '' : key.slice(colonIndex + 1);
    if (path === documentId) return scheme;
  }
  return null;
}

/** The ancestor-title-chain identity of `heading` -- the only thing
 *  that survives a fresh re-parse of the same file, unlike a direct
 *  object reference, which a cached agendaFilesCache entry's own doc
 *  would no longer share with a freshly re-opened copy of that same
 *  file. Looks in whichever document actually contains `heading`
 *  right now: state.doc if `documentId` matches what's currently
 *  open, otherwise the matching agendaFilesCache entry's own cached
 *  doc. null if that document isn't actually available (shouldn't
 *  normally happen -- an agenda item/search result's own documentId
 *  only ever comes from a document that was, at some point, actually
 *  loaded). */
export function outlinePathForHeadingInDocument(documentId, heading) {
  const doc =
    documentId === S.state.documentId
      ? S.state.doc
      : Array.from(agendaFilesCache.values()).find((e) => e.documentId === documentId)?.doc;
  if (!doc) return null;
  return [...(findAncestorPath(doc, heading) || []).map((h) => h.title), heading.title];
}

/** Navigates to the heading identified by `outlinePath` within
 *  `documentId` -- switching to that document first (via
 *  openRemotePath, the exact same mechanism openFileLink already uses
 *  for a cross-file link jump, including its own conflict handling)
 *  if it isn't already the one open. The single entry point both
 *  agenda-item-tap and search-result-tap use for navigation, so a
 *  result/item from a different file behaves identically regardless
 *  of which one produced it. No separate "discard unsaved changes?"
 *  prompt -- matching openFileLink's own existing, working behavior,
 *  since any in-progress edit is already safely cached locally
 *  regardless of navigating away (see "Pending Local Changes" in
 *  Settings) -- there's nothing this would put at risk that isn't
 *  already handled the same way a plain internal link jump is. */
export async function navigateToHeadingByPath(documentId, outlinePath, opts = {}) {
  if (documentId === S.state.documentId) {
    const heading = findHeadingByOutlinePath(S.state.doc, outlinePath);
    if (heading) navigateToHeading(heading, opts);
    return;
  }

  const storageKind = storageKindForDocumentId(documentId);
  const adapter = storageKind === 'github' ? githubAdapter : storageKind === 'webdav' ? webdavAdapter : null;
  const label = storageKind === 'github' ? 'GitHub' : storageKind === 'webdav' ? 'WebDAV' : null;
  if (!adapter) {
    setStatus(`Can't open "${documentId}" \u2014 unrecognized source.`);
    return;
  }

  const originEntry = {
    view: S.currentView,
    documentId: S.state.documentId,
    storageKind: S.state.storageKind,
    scrollTop: scrollContainer().scrollTop,
  };

  await openRemotePath(documentId, storageKind, adapter, label);
  if (!S.state.doc || S.state.documentId !== documentId) return;

  S.navigationBackStack.push(originEntry);
  if (S.navigationBackStack.length > NAVIGATION_BACK_STACK_LIMIT) S.navigationBackStack.shift();
  syncNavBackButtonVisibility();

  const heading = findHeadingByOutlinePath(S.state.doc, outlinePath);
  if (heading) {
    navigateToHeading(heading, { ...opts, pushToBackStack: false });
  } else {
    setStatus(`Opened ${documentId}, but couldn't find that heading anymore \u2014 it may have been edited or removed.`);
  }
}

/** Pops the most recent entry off the navigation back-stack and
 *  restores that view and scroll position -- unlike navigateToHeading,
 *  this doesn't target a specific heading at all, since the point
 *  navigated away from often wasn't one (organic scrolling, or a link
 *  tapped from a non-'org' view like Docs). A no-op if the stack is
 *  empty (the floating back button isn't shown in that case anyway,
 *  but this stays safe to call regardless). */
export async function navigateBack() {
  const target = S.navigationBackStack.pop();
  if (!target) return;

  if (target.documentId && target.documentId !== S.state.documentId) {
    if (target.documentId === HELP_DOCUMENT_ID) {
      await openOrSwitchToHelp();
    } else {
      let adapter, label;
      if (target.storageKind === 'github') {
        adapter = githubAdapter;
        label = 'GitHub';
      } else if (target.storageKind === 'webdav') {
        adapter = webdavAdapter;
        label = 'WebDAV';
      } else {
        setStatus(
          `Can't automatically return to "${target.documentId}" — local files need a file picker per file (browser security), which can't happen from the back button.`
        );
        syncNavBackButtonVisibility();
        return;
      }
      await openRemotePath(target.documentId, target.storageKind, adapter, label);
    }
    // openRemotePath/openOrSwitchToHelp each catch and report their own
    // errors via setStatus rather than throwing -- confirm one of them
    // actually landed on the origin document before restoring any of
    // its own view/scroll state below, the same "did this actually
    // succeed" check openFileLink's own forward-navigation already uses.
    if (!S.state.doc || S.state.documentId !== target.documentId) {
      syncNavBackButtonVisibility();
      return;
    }
    if (target.originHeadingPath) {
      const originHeading = findHeadingByOutlinePath(S.state.doc, target.originHeadingPath);
      if (originHeading) {
        navigateToHeading(originHeading, { pushToBackStack: false, revealOwnBody: true });
        syncNavBackButtonVisibility();
        return;
      }
      // Renamed or deleted since -- fall through to the generic
      // scrollTop restoration below rather than leaving the person on
      // a blank, unscrolled document with no indication anything was
      // even attempted.
    }
  }

  if (target.settingsOpen && !S.settingsOpen) {
    // The jump away (a Quick Settings help link, or the Capture
    // Templates reference link) came FROM Settings -- return there.
    S.settingsOpen = true;
    if (isWideLayout()) {
      sidePanelEl.style.display = 'block';
      await renderSettingsView(sidePanelEl);
      render();
    } else {
      await renderSettingsView(outlineEl);
    }
  } else if (target.view !== S.currentView) {
    switchToView(target.view);
  }

  requestAnimationFrame(() => {
    scrollContainer().scrollTop = target.scrollTop;
  });
  syncNavBackButtonVisibility();
}
