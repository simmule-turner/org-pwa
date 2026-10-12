// @ts-check
// The Archive & Refile panel: one sheet for a heading, in two parts that scroll on their own. Part 1 says what Archive (or, for an
// archived heading, Restore) will do; Part 2 lists the places Refile can put it, with a search and the details of the chosen one.
// Archive/Restore, Refile and Cancel stay at the bottom, one line each, never resized by the text above them. The state lives in
// S.pendingRefile so Escape and the other panels' dismissal reach it like any panel.
import { findAncestorPath, getArchiveLocation, isArchivedInPlace, parseArchiveLocation, resolveArchiveFileId } from '../src/archive-model.js';
import { archiveStamps, describeSubtree, displayName, filterTargets, refileDetails, restoreDestination } from '../src/archive-refile-details.js';
import { getRefileTargets } from '../src/local-variables.js';
import { getRefileCandidates, parseRefileTargetsWithErrors, recentRefileCandidates } from '../src/refile.js';
import { ensureAgendaFilesLoadedAndWait } from './agenda-files.js';
import { archiveHeadingToLocation, getArchiveDestinationLabel, unarchiveHeadingToOriginalLocation } from './archive-flow.js';
import { S } from './app-state.js';
import { containTab, rememberOpener, restoreOpener } from './containers.js';
import { showModalOverlay } from './dialogs.js';
import { archiveRefilePanel, archiveRefilePanelBox } from './dom.js';
import { loadRefileTargetDocs, performRefile } from './refile-flow.js';
import { loadRefileRecent } from './sync-helpers.js';
import { hideModalOverlay } from './ui-widgets.js';

const PART_TITLE = 'display:flex;justify-content:space-between;align-items:baseline;gap:8px;padding:7px 14px 5px;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;background:var(--surface-solid);';
const SCROLL = 'overflow-y:auto;overscroll-behavior:contain;padding:8px 14px 10px;min-height:0;flex:1 1 auto;';

/** @param {string} css @param {string} [text] */
function div(css, text) {
  const el = document.createElement('div');
  el.style.cssText = css;
  if (text !== undefined) el.textContent = text;
  return el;
}

/** A label/value grid.
 * @param {{ label: string, value: string, warn?: boolean }[]} rows */
function detailGrid(rows) {
  const grid = div('display:grid;grid-template-columns:92px 1fr;gap:3px 10px;font-size:13px;margin-top:8px;');
  for (const row of rows) {
    grid.appendChild(div('opacity:0.65;', row.label));
    grid.appendChild(div('overflow-wrap:anywhere;' + (row.warn ? 'color:#b5530a;' : ''), row.value));
  }
  return grid;
}

/** Opens the panel for `heading`: Archive for a live heading, Restore for one already archived. The refile targets load behind it.
 * @param {any} heading */
export async function openArchiveRefilePanel(heading) {
  const { entries: targetsSpec, errors } = parseRefileTargetsWithErrors(getRefileTargets(S.state.localVariables));
  const mode = isArchivedInPlace(heading) ? 'restore' : 'archive';
  S.pendingRefile = { heading, mode, loading: true, candidates: [], errors, recent: [], selected: null, query: '' };
  renderArchiveRefilePanel();
  if (targetsSpec.some((entry) => entry.fileSpec === 'agenda-files')) await ensureAgendaFilesLoadedAndWait();
  const docsById = await loadRefileTargetDocs(targetsSpec);
  if (!S.pendingRefile || S.pendingRefile.heading !== heading) return; // closed while loading
  const candidates = getRefileCandidates(targetsSpec, docsById, S.state.documentId, S.agendaFilesConfig, heading);
  const recent = recentRefileCandidates(candidates, await loadRefileRecent());
  if (!S.pendingRefile || S.pendingRefile.heading !== heading) return;
  S.pendingRefile = { heading, mode, loading: false, candidates, errors, recent, selected: null, query: '' };
  renderArchiveRefilePanel();
}

/** Closes the panel. */
export function closeArchiveRefilePanel() {
  S.pendingRefile = null;
  renderArchiveRefilePanel();
}

/** Part 1's content for a heading that will be archived.
 * @param {any} heading */
function archivePart(heading) {
  const frag = document.createDocumentFragment();
  const location = getArchiveLocation(S.state.doc, heading);
  const { filePart } = parseArchiveLocation(location);
  const targetFileId = resolveArchiveFileId(filePart, S.state.documentId);
  const crossFile = targetFileId !== null && targetFileId !== S.state.documentId;
  frag.appendChild(div('font-weight:600;overflow-wrap:anywhere;', `To ${getArchiveDestinationLabel(heading)}`));
  const from = findAncestorPath(S.state.doc, heading) || [];
  /** @type {{ label: string, value: string, warn?: boolean }[]} */
  const rows = [
    { label: 'Moves', value: describeSubtree(heading) },
    { label: 'From', value: [displayName(S.state.documentId), ...from.map((h) => h.title), heading.title || '(untitled)'].join(' › ') },
    { label: 'Adds', value: `the :ARCHIVE: tag and ${archiveStamps(heading).join(', ')}` },
    { label: 'Setting', value: "the heading's own ARCHIVE property, else the file's #+ARCHIVE:, else the default" },
  ];
  if (heading.todo) rows.push({ label: 'State', value: `${heading.todo} (kept, and recorded as ARCHIVE_TODO)` });
  if (crossFile) rows.push({ label: 'Other file', value: 'written first; this heading is removed only if that works', warn: true });
  frag.appendChild(detailGrid(rows));
  return frag;
}

/** Part 1's content for a heading that is already archived.
 * @param {any} heading */
function restorePart(heading) {
  const frag = document.createDocumentFragment();
  const dest = restoreDestination(heading, S.state.documentId);
  frag.appendChild(div('font-weight:600;overflow-wrap:anywhere;', `Back to ${dest.label}`));
  frag.appendChild(
    detailGrid([
      { label: 'Moves', value: describeSubtree(heading) },
      { label: 'Removes', value: 'the :ARCHIVE: tag and the ARCHIVE_* properties' },
      ...(dest.recorded ? [{ label: 'Other file', value: 'when it is another file, written first; this heading is removed only if that works', warn: true }] : []),
    ])
  );
  return frag;
}

/** Draws, or hides, the panel from S.pendingRefile. */
export function renderArchiveRefilePanel() {
  const p = S.pendingRefile;
  archiveRefilePanelBox.innerHTML = '';
  if (!p) {
    hideModalOverlay(archiveRefilePanel);
    restoreOpener(archiveRefilePanel);
    return;
  }
  rememberOpener(archiveRefilePanel);
  containTab(archiveRefilePanel);
  showModalOverlay(archiveRefilePanel);
  const heading = p.heading;
  const restore = p.mode === 'restore';
  archiveRefilePanelBox.setAttribute('role', 'dialog');
  archiveRefilePanelBox.setAttribute('aria-label', restore ? 'Restore or refile' : 'Archive or refile');

  // header: what is being moved
  const head = div('padding:0 14px 8px;border-bottom:1px solid var(--border-strong);flex:0 0 auto;');
  const grip = div('');
  grip.className = 'ui-grip';
  head.appendChild(grip);
  head.appendChild(div('font-weight:700;overflow-wrap:anywhere;', `${heading.todo ? heading.todo + ' ' : ''}${heading.title || '(untitled)'}`));
  head.appendChild(div('font-size:12px;opacity:0.65;', `Subtree: ${describeSubtree(heading)}`));
  archiveRefilePanelBox.appendChild(head);

  // part 1
  const part1 = document.createElement('section');
  part1.setAttribute('data-part', 'archive');
  part1.style.cssText = 'display:flex;flex-direction:column;min-height:0;flex:0 0 38%;';
  const title1 = div(PART_TITLE);
  title1.append(div('', restore ? '1 · Restore & details' : '1 · Archive & details'), div('text-transform:none;letter-spacing:0;font-weight:600;opacity:0.7;', restore ? 'ARCHIVE_FILE' : 'org-archive-location'));
  const scroll1 = div(SCROLL);
  scroll1.appendChild(restore ? restorePart(heading) : archivePart(heading));
  part1.append(title1, scroll1);
  archiveRefilePanelBox.appendChild(part1);

  // part 2
  const part2 = document.createElement('section');
  part2.setAttribute('data-part', 'refile');
  part2.style.cssText = 'display:flex;flex-direction:column;min-height:0;flex:1 1 0;border-top:2px solid var(--border-strong);';
  const title2 = div(PART_TITLE);
  const state2 = div('text-transform:none;letter-spacing:0;font-weight:600;opacity:0.7;');
  title2.append(div('', '2 · Refile & details'), state2);
  const scroll2 = div(SCROLL);
  part2.append(title2, scroll2);
  archiveRefilePanelBox.appendChild(part2);

  // buttons: fixed, one line each, equal weight; Cancel is where focus starts
  const actions = div('display:flex;gap:8px;padding:10px 14px calc(12px + env(safe-area-inset-bottom, 0px));border-top:1px solid var(--border-strong);flex:0 0 auto;');
  /** @param {string} label @param {() => void} onClick */
  const button = (label, onClick) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'flex:1 1 0;min-height:var(--target);font-size:var(--text-body);font-weight:600;white-space:nowrap;';
    b.onclick = onClick;
    return b;
  };
  const archiveBtn = button(restore ? 'Restore' : 'Archive', () => {
    closeArchiveRefilePanel();
    if (restore) unarchiveHeadingToOriginalLocation(heading, { confirm: false });
    else archiveHeadingToLocation(heading);
  });
  const refileBtn = button('Refile', () => {
    const chosen = p.selected;
    if (!chosen) return;
    closeArchiveRefilePanel();
    performRefile(heading, chosen.documentId, chosen.outlinePath);
  });
  const cancelBtn = button('Cancel', closeArchiveRefilePanel);
  archiveBtn.setAttribute('data-act', 'archive');
  refileBtn.setAttribute('data-act', 'refile');
  cancelBtn.setAttribute('data-act', 'cancel');
  cancelBtn.classList.add('ui-cancel');
  actions.append(archiveBtn, refileBtn, cancelBtn);
  archiveRefilePanelBox.appendChild(actions);

  // search box: built once, so typing never loses focus
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = 'Search targets';
  search.setAttribute('aria-label', 'Search targets');
  search.value = p.query || '';
  search.style.cssText = 'width:100%;min-height:40px;box-sizing:border-box;margin-bottom:6px;';
  const listBox = div('');
  const detailBox = div('');
  scroll2.append(search, listBox, detailBox);

  const draw = () => {
    refileBtn.disabled = p.loading || !p.selected;
    state2.textContent = p.loading ? 'loading' : p.selected ? '1 chosen' : 'no target chosen';
    listBox.innerHTML = '';
    detailBox.innerHTML = '';
    for (const err of p.errors || []) listBox.appendChild(div('font-size:12px;color:#c0392b;margin-bottom:6px;', `Skipped target entry "${err.entry}": ${err.message}`));
    if (p.loading) {
      listBox.appendChild(div('font-size:13px;opacity:0.6;padding:8px 0;', 'Loading targets…'));
      return;
    }
    if (p.candidates.length === 0) {
      listBox.appendChild(div('font-size:13px;opacity:0.6;padding:8px 0;', 'No refile targets found -- check org-refile-targets (Global/Local Variables) and that any configured target files are reachable.'));
      return;
    }
    const matches = filterTargets(p.candidates, p.query || '');
    const recent = (p.query ? [] : p.recent) || [];
    /** @param {any} candidate @param {boolean} isRecent */
    const row = (candidate, isRecent) => {
      const el = document.createElement('div');
      el.className = 'menu-list-item';
      el.setAttribute('data-target', '');
      if (isRecent) el.setAttribute('data-recent-target', '');
      const chosen = p.selected && p.selected.documentId === candidate.documentId && p.selected.outlinePath.join('\u0000') === candidate.outlinePath.join('\u0000');
      if (chosen) {
        el.setAttribute('aria-selected', 'true');
        el.style.outline = '2px solid var(--accent)';
      }
      el.appendChild(div('overflow-wrap:anywhere;', candidate.outlinePath.join(' / ')));
      if (candidate.documentId !== S.state.documentId) el.appendChild(div('font-size:11px;opacity:0.6;margin-top:2px;', displayName(candidate.documentId)));
      el.onclick = () => {
        p.selected = candidate;
        draw();
        if (detailBox.scrollIntoView) detailBox.scrollIntoView({ block: 'nearest' });
      };
      return el;
    };
    const label = (/** @type {string} */ text) => div('font-size:11px;font-weight:700;opacity:0.55;padding:6px 0 2px;', text);
    if (recent.length > 0) {
      listBox.appendChild(label('RECENT'));
      for (const c of recent) listBox.appendChild(row(c, true));
      listBox.appendChild(label('ALL TARGETS'));
    }
    if (matches.length === 0) listBox.appendChild(div('font-size:13px;opacity:0.6;padding:8px 0;', 'No target matches.'));
    for (const c of matches) listBox.appendChild(row(c, false));
    if (p.selected) detailBox.appendChild(detailGrid(refileDetails(heading, p.selected, S.state.documentId)));
  };
  search.oninput = () => {
    p.query = search.value;
    draw();
  };
  draw();
  cancelBtn.focus();
}
