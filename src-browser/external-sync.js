// Extracted from app.js: external sync.
import { openDocument } from '../src/document-store.js';
import { applyStartupVisibility } from '../src/fold-state.js';
import { mergeGlobalAndLocalVariables } from '../src/global-variables.js';
import { getBufferReadOnly, getCycleOpenArchivedTrees, parseLocalVariables } from '../src/local-variables.js';
import { planConflict, resolveSegments } from '../src/merge3.js';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import { hasPendingChange } from '../src/outbox.js';
import { resolveEffectiveStartupConfig } from '../src/startup-config.js';
import { getSyncMeta, setSyncMeta } from '../src/sync-engine.js';
import { pushSnapshot } from '../src/undo-history.js';
import { filesystemAdapter, githubAdapter, inputFileAdapter, webdavAdapter } from './adapters.js';
import { syncAgendaFilesConfig, syncContactsFilesConfig } from './agenda-files.js';
import { S } from './app-state.js';
import { syncContentOffset } from './chrome.js';
import { CONFLICT_PREVIEW_LINES } from './constants.js';
import { lockBackgroundScroll } from './dialogs.js';
import { externalChangeBanner, externalChangeText } from './dom.js';
import { commitTextModeIfActive, restoreFromHistory, setStatus } from './editing.js';
import { render } from './render.js';
import { kv } from './singletons.js';
import { recordSyncedWrite } from './sync-helpers.js';
import { keepOverlayInVisibleViewport, tableActionButton } from './ui-widgets.js';

/** Which adapter Save/Save-As-in-place should use — whatever storage kind
 *  the currently open document actually came from. This is the crux of
 *  "Save uses whatever mechanism was used to open the file". */
/** CRITICAL DATA-LOSS FIX (defense in depth): every cross-file write
 *  that bypasses saveAndSync (capture-to-a-different-file, archive-to-
 *  a-different-file, refile, unarchive/restore-to-a-different-file)
 *  writes straight to disk via adapter.write, with no corresponding
 *  syncMeta update -- meaning this app's own record of "the last known
 *  hash of that file" would otherwise go stale the instant any of those
 *  ran, regardless of whether that target file was also the currently-
 *  open document. Later opening/editing/saving that same file could
 *  then miss a REAL external change entirely, since the conflict
 *  check's baseline no longer reflected reality. Call this right after
 *  every one of those direct writes succeeds, so syncMeta always
 *  tracks the true last-known-on-disk state no matter which code path
 *  performed the write -- the same bookkeeping saveAndSync's own
 *  syncDocument already keeps for the single-document save path, now
 *  kept consistently everywhere a write can happen. */
/** Re-reads the currently open document fresh from disk/GitHub/WebDAV
 *  and replaces state.doc with it, discarding whatever was in memory.
 *  Used both by saveCurrent's own "keep disk" conflict resolution and
 *  the external-change banner's Reload button -- the same "start over
 *  from what's actually there right now" operation either way. Caller
 *  is responsible for confirming with the person first if there's
 *  anything of theirs that would be lost by doing this. */
export async function reloadCurrentDocumentFromDisk() {
  const reopened = await openDocument({
    documentId: S.state.documentId,
    kvAdapter: kv,
    diskAdapter: activeDiskAdapter(),
  });
  S.state.doc = reopened.doc;
  const rawLocalVars = parseLocalVariables(serializeOrg(S.state.doc));
  S.state.startupConfig = resolveEffectiveStartupConfig(S.state.doc, rawLocalVars, S.globalVariables);
  S.state.localVariables = mergeGlobalAndLocalVariables(S.globalVariables, rawLocalVars);
  S.isBufferReadOnly = getBufferReadOnly(S.state.localVariables);
  syncAgendaFilesConfig();
  syncContactsFilesConfig();
  S.currentContextHeading = null;
  const archiveVisibility = getCycleOpenArchivedTrees(S.state.localVariables) ? 'noarchived' : 'archived';
  applyStartupVisibility(S.state.doc, S.state.startupConfig, archiveVisibility);
  S.isDirty = false;
  S.lastSavedText = serializeOrg(S.state.doc);
  hideExternalChangeBanner();
  render();
}

/**
 * Shared "read another file safely, mutate it, write it back" sequence
 * for every cross-file operation (capture, archive, refile, restore).
 * Centralizing this here means the sync-baseline bookkeeping
 * (recordSyncedWrite) every one of these needs can never again be
 * silently forgotten by a future feature needing the same shape --
 * exactly the class of bug that caused a real data-loss issue before
 * this existed, when four separate hand-rolled copies of this
 * sequence meant remembering the same step four separate times.
 *
 * `label` -- used in every generated status/error message, lowercase,
 * describing the action a person would recognize ("archive", "refile",
 * "restore", "capture").
 * `allowMissing` -- if true, a target file that doesn't exist yet
 * starts from an empty document rather than being treated as an error
 * (capture/archive: a fresh target file is a completely normal thing
 * to create; refile/restore: the target is expected to already exist,
 * so its absence is a genuine error, not something to paper over).
 * `mutate(doc)` -- feature-specific mutation of the freshly-read
 * target document. Return `undefined`/`null` to abort (after calling
 * setStatus itself with a feature-specific message -- this helper
 * doesn't know enough about the specific failure to word that itself);
 * anything else is passed through as this function's own return value
 * on success.
 *
 * Returns `{ ok: true, result }` on success (after the write AND the
 * sync-baseline update have both succeeded), or `{ ok: false }` after
 * already calling setStatus with a clear, label-specific error --
 * callers just check `.ok` and bail out if false, no separate error
 * text of their own to construct for any of these shared failure modes.
 */
export async function writeToOtherFile(fileId, { label, allowMissing, mutate }) {
  // Same trap capture's own version of this check already described:
  // writing straight to the backing store while an unrelated pending
  // (unsynced) local edit for this SAME file is still sitting in the
  // outbox would leave that edit's own "resume" flow completely
  // unaware this write ever happened -- resuming it later and saving
  // would silently overwrite whatever this write just did, since
  // nothing would have told the outbox its assumption about "the last
  // synced version" had changed out from under it. Refuse up front.
  if (await hasPendingChange(kv, fileId)) {
    setStatus(
      `Can't ${label} to "${fileId}" right now \u2014 it has unsaved local changes from an earlier session that haven't been synced yet. Open "${fileId}" directly first and either save or discard those changes, then retry.`
    );
    return { ok: false };
  }

  const adapter = activeDiskAdapter();
  if ((S.state.storageKind === 'filesystem' || S.state.storageKind === 'input') && !(await adapter.exists(fileId))) {
    setStatus(
      `Can't ${label} to "${fileId}" automatically \u2014 local files need that file picked/created once first (browser security requires a file picker per file, not something this can do on its own). Try File \u2192 Open or Save As on "${fileId}" first, or use GitHub/WebDAV for automatic cross-file ${label}ing.`
    );
    return { ok: false };
  }

  let doc;
  try {
    const existing = await adapter.read(fileId);
    if (!existing) {
      if (!allowMissing) {
        setStatus(`Could not ${label}: "${fileId}" no longer exists.`);
        return { ok: false };
      }
      doc = parseOrg('');
    } else {
      doc = parseOrg(existing.content);
    }
  } catch (err) {
    setStatus(`Could not ${label}: reading "${fileId}" failed \u2014 ${err.message}`);
    return { ok: false };
  }

  const result = mutate(doc);
  if (result === undefined || result === null) return { ok: false };

  try {
    const content = serializeOrg(doc);
    const written = await adapter.write(fileId, content);
    await recordSyncedWrite(fileId, written.hash, content);
  } catch (err) {
    setStatus(`Could not ${label}: writing "${fileId}" failed \u2014 ${err.message}. Nothing was changed.`);
    return { ok: false };
  }

  return { ok: true, result };
}

/** Best-effort, proactive check: does the currently open document's
 *  actual state on disk/GitHub/WebDAV right now still match what this
 *  app last recorded seeing (openDocument's own baseline, or the most
 *  recent successful write)? If not, surfaces a dismissable notice
 *  rather than waiting for an eventual Save to be the first moment
 *  this ever comes up. Never throws and never blocks anything -- a
 *  failed check (offline, a network hiccup, the file briefly
 *  unreadable) is simply skipped; Save's own conflict check is the
 *  actual, required safety net this is only trying to surface earlier,
 *  not replace. */
export async function checkForExternalChange() {
  if (!S.state.documentId || !S.state.storageKind || S.externalChangeCheckInFlight) return;
  if ((S.state.storageKind === 'github' || S.state.storageKind === 'webdav') && !navigator.onLine) return;
  S.externalChangeCheckInFlight = true;
  try {
    const meta = await getSyncMeta(kv, S.state.documentId);
    if (!meta) return; // no baseline recorded yet -- nothing to compare against
    // prompt: false -- this runs on every tab switch and every focus change, so for
    // a local file it must never ask for permission (the browser shows its "allow
    // this site to view and copy" prompt each time otherwise). Without access it
    // simply compares nothing; Save, Reload and Merge, which the person starts,
    // still ask.
    const fresh = await activeDiskAdapter().read(S.state.documentId, { prompt: false });
    if (!fresh) return;
    if (fresh.hash !== meta.lastSyncedHash && fresh.hash !== S.externalChangeDismissedHash) {
      showExternalChangeBanner(fresh.hash);
    }
  } catch {
    // Best-effort -- see the doc comment above.
  } finally {
    S.externalChangeCheckInFlight = false;
  }
}

export function showExternalChangeBanner(hash) {
  S.externalChangeShownForHash = hash;
  externalChangeText.textContent = `"${S.state.documentId}" changed elsewhere since you opened it here.`;
  externalChangeBanner.style.display = 'flex';
  syncContentOffset();
}

export function hideExternalChangeBanner() {
  externalChangeBanner.style.display = 'none';
  syncContentOffset();
}

export function activeDiskAdapter() {
  if (S.state.storageKind === 'github') return githubAdapter;
  if (S.state.storageKind === 'webdav') return webdavAdapter;
  if (S.state.storageKind === 'input') return inputFileAdapter;
  return filesystemAdapter;
}

/**
 * Lets the person resolve a sync conflict region by region. `plan` is a
 * planConflict() result of kind 'review'. Every region needs an explicit
 * choice (Yours / Other / Both) before Apply enables -- a conflict is
 * never resolved by default. Returns { merged: text } once applied, or
 * 'cancel' (Cancel, Escape, or a tap on the backdrop), in which case
 * nothing has been changed anywhere.
 */
export function openConflictResolver({ documentId, plan }) {
  return new Promise((resolve) => {
    S.confirmDialogOpen = true;
    const conflicts = plan.segments.filter((seg) => seg.type === 'conflict');
    const choices = new Array(conflicts.length).fill(null);

    const overlay = document.createElement('div');
    overlay.id = 'conflict-resolver';
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.background = 'rgba(0,0,0,0.6)';
    overlay.style.zIndex = '10000';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.padding = '12px';
    overlay.style.boxSizing = 'border-box';
    overlay.style.overflow = 'hidden';

    const modal = document.createElement('div');
    modal.className = 'panel';
    modal.style.background = 'var(--modal-bg)';
    modal.style.color = 'var(--fg)';
    modal.style.border = '1px solid var(--border-strong)';
    modal.style.borderRadius = '10px';
    modal.style.padding = '14px';
    modal.style.width = '100%';
    modal.style.maxWidth = '760px';
    modal.style.maxHeight = '100%';
    modal.style.boxSizing = 'border-box';
    modal.style.display = 'flex';
    modal.style.flexDirection = 'column';
    modal.style.gap = '10px';
    overlay.appendChild(modal);

    const title = document.createElement('div');
    title.textContent = `"${documentId}" changed elsewhere`;
    title.style.fontWeight = '700';
    title.style.fontSize = '15px';
    title.style.flexShrink = '0';
    modal.appendChild(title);

    const summary = document.createElement('div');
    summary.style.fontSize = '13px';
    summary.style.lineHeight = '1.4';
    summary.style.flexShrink = '0';
    const n = conflicts.length;
    const places = `${n} place${n === 1 ? '' : 's'}`;
    if (plan.hasBase) {
      const auto = plan.stats ? plan.stats.mineOnly + plan.stats.theirsOnly + plan.stats.identical : 0;
      summary.textContent =
        `Your unsaved changes and the other version both changed the same lines in ${places}, so you decide ${n === 1 ? 'that one' : 'those'}.` +
        (auto ? ` ${auto} other change${auto === 1 ? ' was' : 's were'} combined automatically.` : '');
    } else {
      summary.textContent =
        `No earlier common version is available for this file, so every difference (${places}) is shown for you to choose.`;
    }
    modal.appendChild(summary);

    const list = document.createElement('div');
    list.style.overflowY = 'auto';
    list.style.overscrollBehavior = 'contain';
    list.style.flex = '1 1 auto';
    list.style.minHeight = '0';
    list.style.display = 'flex';
    list.style.flexDirection = 'column';
    list.style.gap = '12px';
    modal.appendChild(list);

    const linesBlock = (label, lines, tint) => {
      const wrap = document.createElement('div');
      wrap.style.borderLeft = `4px solid ${tint}`;
      wrap.style.background = tint.replace('rgb(', 'rgba(').replace(')', ', 0.12)');
      wrap.style.padding = '6px 8px';
      wrap.style.borderRadius = '4px';
      const head = document.createElement('div');
      head.textContent = label;
      head.style.fontSize = '11px';
      head.style.fontWeight = '700';
      head.style.opacity = '0.75';
      head.style.marginBottom = '3px';
      wrap.appendChild(head);
      const pre = document.createElement('pre');
      pre.style.margin = '0';
      pre.style.whiteSpace = 'pre-wrap';
      pre.style.overflowWrap = 'anywhere';
      pre.style.font = 'ui-monospace, monospace';
      pre.style.fontSize = '12px';
      pre.style.maxHeight = '190px';
      pre.style.overflowY = 'auto';
      if (lines.length === 0) {
        pre.textContent = '(nothing \u2014 these lines are absent)';
        pre.style.fontStyle = 'italic';
        pre.style.opacity = '0.7';
      } else {
        const shown = lines.slice(0, CONFLICT_PREVIEW_LINES);
        pre.textContent = shown.join('\n') + (lines.length > shown.length ? `\n\u2026 ${lines.length - shown.length} more lines` : '');
      }
      wrap.appendChild(pre);
      return wrap;
    };

    const choiceButtons = []; // per conflict: { yours, other, both }
    let conflictIndex = 0;
    let lastStable = [];
    for (const seg of plan.segments) {
      if (seg.type === 'stable') {
        lastStable = seg.lines;
        continue;
      }
      const k = conflictIndex++;
      const card = document.createElement('div');
      card.style.border = '1px solid var(--border-strong)';
      card.style.borderRadius = '8px';
      card.style.padding = '8px';
      card.style.display = 'flex';
      card.style.flexDirection = 'column';
      card.style.gap = '6px';

      const heading = document.createElement('div');
      heading.textContent = `Difference ${k + 1} of ${n}`;
      heading.style.fontSize = '12px';
      heading.style.fontWeight = '700';
      card.appendChild(heading);

      const context = lastStable.slice(-2).filter((line) => line.trim() !== '');
      if (context.length) {
        const ctx = document.createElement('pre');
        ctx.textContent = context.join('\n');
        ctx.style.margin = '0';
        ctx.style.font = 'ui-monospace, monospace';
        ctx.style.fontSize = '11px';
        ctx.style.opacity = '0.55';
        ctx.style.whiteSpace = 'pre-wrap';
        ctx.style.overflowWrap = 'anywhere';
        card.appendChild(ctx);
      }
      card.appendChild(linesBlock('YOURS (this device, unsaved)', seg.mine, 'rgb(52, 152, 219)'));
      card.appendChild(linesBlock('OTHER VERSION', seg.theirs, 'rgb(230, 126, 34)'));

      const row = document.createElement('div');
      row.className = 'panel-row';
      row.style.gap = '6px';
      const mk = (label, value) => {
        const btn = tableActionButton(label, () => {
          choices[k] = value;
          refresh();
        });
        btn.setAttribute('data-choice', value);
        return btn;
      };
      const yours = mk('Yours', 'mine');
      const other = mk('Other', 'theirs');
      const both = mk('Both', 'both');
      row.appendChild(yours);
      row.appendChild(other);
      row.appendChild(both);
      card.appendChild(row);
      choiceButtons.push({ yours, other, both });
      list.appendChild(card);
    }

    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.flexWrap = 'wrap';
    footer.style.alignItems = 'center';
    footer.style.justifyContent = 'space-between';
    footer.style.gap = '8px';
    footer.style.flexShrink = '0';
    const counter = document.createElement('div');
    counter.style.fontSize = '12px';
    counter.style.opacity = '0.8';
    footer.appendChild(counter);
    const buttons = document.createElement('div');
    buttons.style.display = 'flex';
    buttons.style.flexWrap = 'wrap';
    buttons.style.gap = '6px';
    footer.appendChild(buttons);
    modal.appendChild(footer);

    const stopTrackingViewport = keepOverlayInVisibleViewport(overlay);
    const unlockScroll = lockBackgroundScroll(overlay);
    function finish(result) {
      S.confirmDialogOpen = false;
      document.removeEventListener('keydown', onKeyDown, true);
      stopTrackingViewport();
      unlockScroll();
      overlay.remove();
      resolve(result);
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish('cancel');
      }
    }
    document.addEventListener('keydown', onKeyDown, true);
    overlay.onclick = (e) => {
      if (e.target === overlay) finish('cancel');
    };

    const allYours = tableActionButton('All yours', () => {
      choices.fill('mine');
      refresh();
    });
    const allOther = tableActionButton('All other', () => {
      choices.fill('theirs');
      refresh();
    });
    const cancelBtn = tableActionButton('Cancel', () => finish('cancel'));
    const applyBtn = tableActionButton('Apply', () => finish({ merged: resolveSegments(plan.segments, choices) }));
    applyBtn.style.background = 'var(--accent)';
    applyBtn.style.color = '#fff';
    applyBtn.setAttribute('data-action', 'apply');
    buttons.appendChild(cancelBtn);
    buttons.appendChild(allYours);
    buttons.appendChild(allOther);
    buttons.appendChild(applyBtn);

    function refresh() {
      const decided = choices.filter((c) => c !== null).length;
      counter.textContent = `${decided} of ${n} decided`;
      applyBtn.disabled = decided !== n;
      applyBtn.style.opacity = decided === n ? '1' : '0.45';
      choices.forEach((choice, k) => {
        const set = (btn, on) => {
          btn.style.background = on ? 'var(--accent)' : 'transparent';
          btn.style.color = on ? '#fff' : 'var(--fg)';
          btn.style.border = '1px solid var(--border-strong)';
        };
        set(choiceButtons[k].yours, choice === 'mine');
        set(choiceButtons[k].other, choice === 'theirs');
        set(choiceButtons[k].both, choice === 'both');
      });
    }
    refresh();
    document.body.appendChild(overlay);
    cancelBtn.focus();
  });
}

/** What Save does when the file changed underneath a pending edit:
 *  identical or metadata-only changes resolve silently, changes that
 *  fit together are merged automatically, and only genuinely
 *  overlapping edits reach the person (see planConflict). */
export async function resolveSaveConflict({ mine, disk, base }) {
  const plan = planConflict(mine, disk, base);
  if (plan.kind === 'same' || (plan.kind === 'auto' && plan.keepsMineOnly)) return 'mine';
  if (plan.kind === 'auto') return { merged: plan.mergedText };
  return openConflictResolver({ documentId: S.state.documentId, plan });
}

/** The banner's Merge: combines the unsaved local text with the version
 *  now on disk/GitHub/WebDAV, resolving any overlapping edits through the
 *  same dialog Save uses, and applies the result as an ordinary (undoable,
 *  still-unsaved) edit. The other version becomes the new sync baseline --
 *  what's on screen afterwards already includes it -- so the Save that
 *  follows is a plain write, not a second conflict. With no unsaved
 *  changes there is nothing to merge, so this is just a Reload. */
export async function mergeExternalChange() {
  if (!S.state.documentId || !S.state.storageKind) return;
  if (!S.isDirty) {
    setStatus('Reloading\u2026');
    try {
      await reloadCurrentDocumentFromDisk();
      setStatus('No unsaved changes to merge \u2014 reloaded.');
    } catch (err) {
      setStatus('Reload failed: ' + err.message);
    }
    return;
  }
  if (S.isBufferReadOnly) {
    setStatus('Buffer is read-only \u2014 make it writable to merge.');
    return;
  }
  if (commitTextModeIfActive()) render();
  setStatus('Checking the other version\u2026');
  try {
    const fresh = await activeDiskAdapter().read(S.state.documentId);
    if (!fresh) {
      setStatus('The file is no longer there \u2014 nothing to merge.');
      return;
    }
    const meta = await getSyncMeta(kv, S.state.documentId);
    const base = meta && typeof meta.baseContent === 'string' ? meta.baseContent : null;
    const mine = serializeOrg(S.state.doc);
    const plan = planConflict(mine, fresh.content, base);
    let mergedText;
    if (plan.kind === 'same') mergedText = mine;
    else if (plan.kind === 'auto') mergedText = plan.mergedText;
    else {
      const result = await openConflictResolver({ documentId: S.state.documentId, plan });
      if (result === 'cancel') {
        setStatus('Merge cancelled \u2014 nothing changed.');
        return;
      }
      mergedText = result.merged;
    }
    await setSyncMeta(kv, S.state.documentId, { lastSyncedHash: fresh.hash, baseContent: fresh.content });
    if (mergedText !== mine) {
      S.history = pushSnapshot(S.history, mergedText, 'Merged with changes from elsewhere');
      restoreFromHistory();
    }
    hideExternalChangeBanner();
    setStatus('Merged with the changes made elsewhere \u2014 Save to keep them.');
  } catch (err) {
    setStatus('Merge failed: ' + err.message);
  }
}
