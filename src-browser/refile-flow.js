// Extracted from app.js: refile flow.
import { shiftLevels } from '../src/archive-model.js';
import { removeHeading } from '../src/heading-edit.js';
import { getRefileTargets } from '../src/local-variables.js';
import { parseOrg } from '../src/org-parser.js';
import { findHeadingByOutlinePath, getRefileCandidates, parseRefileTargetsWithErrors, recentRefileCandidates, resolveEntryFileIds } from '../src/refile.js';
import { aggregateAgendaDocs, ensureAgendaFilesLoadedAndWait } from './agenda-files.js';
import { S } from './app-state.js';
import { showModalOverlay } from './dialogs.js';
import { refilePanel, refilePanelBox } from './dom.js';
import { commitAndRender, setStatus } from './editing.js';
import { activeDiskAdapter, writeToOtherFile } from './external-sync.js';
import { loadRefileRecent, rememberRefileTarget } from './sync-helpers.js';
import { hideModalOverlay, menuButton } from './ui-widgets.js';

/**
 * Performs a full org-archive-subtree move (real org's `C-c C-x C-s` /
 * `C-c $`): computes the effective org-archive-location for `heading`
 * (its own `ARCHIVE` property, then the file's `#+ARCHIVE:` keyword,
 * then the documented default `"%s_archive::"`), and moves the subtree
 * there -- either within the current document (an empty file part) or
 * to a separate file, read/parsed/inserted/written via whichever
 * storage backend the current document itself already came from
 * (reused directly; there's no separate "where does the archive file
 * live" configuration to set up).
 *
 * Write-before-remove for the cross-file case: buildArchivedClone is
 * deliberately non-mutating (see archive-model.js), so the target
 * file's write is attempted FIRST, and the heading is only removed
 * from the current document once that write has actually succeeded --
 * a network failure, a WebDAV conflict, or a local-file permission
 * problem can then never silently lose the heading; it simply stays
 * exactly where it was, with a clear error shown instead.
 *
 * A local (File System Access) or iOS-import backend can't write to a
 * file it doesn't already have a granted handle for -- the browser's
 * own security model requires an explicit user gesture (a file picker)
 * per file, which can't be done silently mid-archive. Rather than
 * failing with a confusing low-level permission error, this is
 * detected up front and reported as an actionable message.
 */
/** Loads every document a resolved refile-targets spec could need,
 *  beyond what aggregateAgendaDocs() already covers (the current file
 *  and every configured Agenda File) -- an explicitly-named target
 *  file spec that isn't already one of those gets read fresh via the
 *  active disk adapter. A file that fails to load is silently omitted
 *  (getRefileCandidates already treats a missing docsById entry as
 *  "no candidates from this entry", not an error) rather than blocking
 *  the whole picker on one bad/inaccessible target. */
export async function loadRefileTargetDocs(targetsSpec) {
  const docsById = {};
  for (const { documentId, doc } of aggregateAgendaDocs({ writable: true })) { // a local agenda file is read-only, so never a destination
    docsById[documentId] = doc;
  }
  const adapter = activeDiskAdapter();
  for (const entry of targetsSpec) {
    if (entry.fileSpec === 'current' || entry.fileSpec === 'agenda-files') continue;
    for (const documentId of resolveEntryFileIds(entry, S.state.documentId, S.agendaFilesConfig)) {
      if (docsById[documentId]) continue;
      try {
        const existing = await adapter.read(documentId);
        if (existing) docsById[documentId] = parseOrg(existing.content);
      } catch {
        // Omitted, not an error -- see doc comment above.
      }
    }
  }
  return docsById;
}

export async function openRefilePicker(heading) {
  const { entries: targetsSpec, errors: targetErrors } = parseRefileTargetsWithErrors(getRefileTargets(S.state.localVariables));
  S.pendingRefile = { heading, loading: true, candidates: [], errors: targetErrors };
  renderRefilePanel();
  if (targetsSpec.some((entry) => entry.fileSpec === 'agenda-files')) {
    await ensureAgendaFilesLoadedAndWait();
  }
  const docsById = await loadRefileTargetDocs(targetsSpec);
  if (!S.pendingRefile || S.pendingRefile.heading !== heading) return; // dismissed while loading
  const candidates = getRefileCandidates(targetsSpec, docsById, S.state.documentId, S.agendaFilesConfig, heading);
  const recent = recentRefileCandidates(candidates, await loadRefileRecent());
  if (!S.pendingRefile || S.pendingRefile.heading !== heading) return;
  S.pendingRefile = { heading, loading: false, candidates, errors: targetErrors, recent };
  renderRefilePanel();
}

export function renderRefilePanel() {
  refilePanelBox.innerHTML = '';
  if (!S.pendingRefile) {
    hideModalOverlay(refilePanel);
    return;
  }
  showModalOverlay(refilePanel);

  const label = document.createElement('div');
  label.style.fontSize = '12px';
  label.style.opacity = '0.7';
  label.style.marginBottom = '6px';
  label.textContent = `Refile "${S.pendingRefile.heading.title || '(untitled)'}" to:`;
  refilePanelBox.appendChild(label);

  // Target entries that couldn't be understood are skipped, not
  // guessed at -- but never silently: each one is listed here, so a
  // typo in org-refile-targets shows up instead of a target just missing.
  for (const err of S.pendingRefile.errors || []) {
    const errEl = document.createElement('div');
    errEl.style.fontSize = '12px';
    errEl.style.color = '#c0392b';
    errEl.style.marginBottom = '6px';
    errEl.textContent = `Skipped target entry "${err.entry}": ${err.message}`;
    refilePanelBox.appendChild(errEl);
  }

  if (S.pendingRefile.loading) {
    const loading = document.createElement('div');
    loading.style.fontSize = '13px';
    loading.style.opacity = '0.6';
    loading.style.padding = '8px 0';
    loading.textContent = 'Loading targets\u2026';
    refilePanelBox.appendChild(loading);
    const cancelRow = document.createElement('div');
    cancelRow.className = 'panel-row';
    cancelRow.appendChild(
      menuButton('Cancel', () => {
        S.pendingRefile = null;
        renderRefilePanel();
      })
    );
    refilePanelBox.appendChild(cancelRow);
    return;
  }

  const list = document.createElement('div');
  list.style.maxHeight = '260px';
  list.style.overflowY = 'auto';
  list.style.overscrollBehavior = 'contain';
  if (S.pendingRefile.candidates.length === 0) {
    const empty = document.createElement('div');
    empty.style.fontSize = '13px';
    empty.style.opacity = '0.6';
    empty.style.padding = '8px 0';
    empty.textContent =
      'No refile targets found -- check org-refile-targets (Global/Local Variables) and that any configured target files are reachable.';
    list.appendChild(empty);
  }
  const buildTargetRow = (candidate, isRecent) => {
    const row = document.createElement('div');
    row.className = 'menu-list-item';
    if (isRecent) row.setAttribute('data-recent-target', '');
    const pathEl = document.createElement('div');
    pathEl.textContent = candidate.outlinePath.join(' / ');
    row.appendChild(pathEl);
    if (candidate.documentId !== S.state.documentId) {
      const fileEl = document.createElement('div');
      fileEl.style.fontSize = '11px';
      fileEl.style.opacity = '0.6';
      fileEl.style.marginTop = '2px';
      fileEl.textContent = candidate.documentId;
      row.appendChild(fileEl);
    }
    row.onclick = () => performRefile(S.pendingRefile.heading, candidate.documentId, candidate.outlinePath);
    return row;
  };
  const sectionLabel = (text) => {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.fontSize = '11px';
    el.style.fontWeight = '700';
    el.style.opacity = '0.55';
    el.style.padding = '6px 0 2px';
    return el;
  };
  const recentCandidates = S.pendingRefile.recent || [];
  if (recentCandidates.length > 0) {
    list.appendChild(sectionLabel('RECENT'));
    for (const candidate of recentCandidates) list.appendChild(buildTargetRow(candidate, true));
    list.appendChild(sectionLabel('ALL TARGETS'));
  }
  for (const candidate of S.pendingRefile.candidates) list.appendChild(buildTargetRow(candidate, false));
  refilePanelBox.appendChild(list);

  const backRow = document.createElement('div');
  backRow.className = 'panel-row';
  backRow.style.marginTop = '6px';
  backRow.appendChild(
    menuButton('\u2039 Cancel', () => {
      S.pendingRefile = null;
      renderRefilePanel();
    })
  );
  refilePanelBox.appendChild(backRow);
}

/**
 * Moves `heading` (and its whole subtree) to become the LAST child of
 * the target identified by `targetDocumentId` + `targetOutlinePath` --
 * real org's own default refile insertion point. Same-file is a
 * simple splice-out/push-in plus a level-shift, mirroring
 * demoteHeading's own already-established pattern exactly. Cross-file
 * re-resolves the target against a FRESH read of that file (never the
 * possibly-stale docsById snapshot the picker itself was built from)
 * and uses the same write-target-before-remove-from-source transaction
 * safety archiveHeadingToLocation already established -- a failed
 * write to the target file leaves the source completely untouched.
 */
export async function performRefile(heading, targetDocumentId, targetOutlinePath) {
  S.pendingRefile = null;
  renderRefilePanel();

  if (targetDocumentId === S.state.documentId) {
    const target = findHeadingByOutlinePath(S.state.doc, targetOutlinePath);
    if (!target) {
      setStatus('Could not refile: that target heading no longer exists (the outline may have changed).');
      return;
    }
    removeHeading(S.state.doc, heading);
    target.children.push(heading);
    target.collapsed = false;
    shiftLevels(heading, target.level + 1);
    commitAndRender('Refiled heading');
    setStatus(`Refiled to "${target.title}".`);
    rememberRefileTarget(targetDocumentId, targetOutlinePath);
    return;
  }

  setStatus(`Refiling to ${targetDocumentId}\u2026`);
  const { ok, result: targetTitle } = await writeToOtherFile(targetDocumentId, {
    label: 'refile',
    allowMissing: false,
    mutate: (doc) => {
      const target = findHeadingByOutlinePath(doc, targetOutlinePath);
      if (!target) {
        setStatus(
          `Could not refile: that target heading no longer exists in "${targetDocumentId}" (it may have changed since this picker opened).`
        );
        return null;
      }
      target.children.push(heading);
      target.collapsed = false;
      shiftLevels(heading, target.level + 1);
      return target.title;
    },
  });
  if (!ok) return;

  // The write succeeded -- now, and only now, remove the original.
  removeHeading(S.state.doc, heading);
  commitAndRender('Refiled heading');
  setStatus(`Refiled to "${targetTitle}" in "${targetDocumentId}".`);
  rememberRefileTarget(targetDocumentId, targetOutlinePath);
}
