// @ts-check
/** @typedef {import('../src/types.js').Heading} Heading */
/** @typedef {import('../src/types.js').Doc} Doc */
// [[id:UUID]] links, as org-id does them: a heading's :ID: property names it for good, wherever the heading is later
// moved, renamed or refiled. Following one looks in the open file, then the other open tabs, then the Agenda Files (the
// set org-id scans for its locations table) and opens whichever file holds it. "Copy link to heading" (org-store-link,
// C-c l) makes the :ID: when there is none and puts the link on the clipboard.
import { setProperty } from '../src/archive-model.js';
import { findHeadingById, findHeadingsById } from '../src/link-resolve.js';
import { S } from './app-state.js';
import { ensureAgendaFilesLoadedAndWait } from './agenda-files.js';
import { scrollContainer } from './chrome.js';
import { NAVIGATION_BACK_STACK_LIMIT } from './constants.js';
import { openFileLink } from './documents-io.js';
import { commitAndRender, setStatus } from './editing.js';
import { navigateToHeading, syncNavBackButtonVisibility } from './navigation.js';
import { platform } from './platform.js';
import { agendaFilesCache } from './singletons.js';
import { switchToTab } from './tabs.js';

/** Where an ID is found. `tabId` is set for an open tab; `key` and `documentId` for an Agenda File not open in a tab.
 * @typedef {{ tabId?: number, key?: string, documentId?: string, count: number }} IdPlace */

/** Looks for the ID in the files already loaded: the open tabs, then the loaded Agenda Files.
 * @param {string} id
 * @returns {{ places: IdPlace[], total: number }} the places in search order, and how many headings share the ID in all of them */
function locate(id) {
  /** @type {IdPlace[]} */ const places = [];
  let total = 0;
  const openIds = new Set();
  for (const session of S.documentSessions) {
    if (session.tabId === S.activeTabId || !session.state || !session.state.doc) continue;
    openIds.add(session.state.documentId);
    const count = findHeadingsById(session.state.doc, id).length;
    if (count) {
      places.push({ tabId: session.tabId, count });
      total += count;
    }
  }
  openIds.add(S.state.documentId);
  for (const [key, entry] of agendaFilesCache.entries()) {
    if (!entry.doc || openIds.has(entry.documentId)) continue; // an open tab has the live version of it
    const count = findHeadingsById(entry.doc, id).length;
    if (count) {
      places.push({ key, documentId: entry.documentId, count });
      total += count;
    }
  }
  return { places, total };
}

/**
 * Follows an `id:` link that is not in the file on screen.
 * @param {string} id
 * @param {Heading | null} [containingHeading]  the heading the link is in, so Back returns to it
 */
export async function openIdLink(id, containingHeading = null) {
  const here = S.state.doc ? findHeadingById(S.state.doc, id) : null;
  if (here) {
    navigateToHeading(here);
    return;
  }
  let { places, total } = locate(id);
  if (places.length === 0) {
    setStatus(`Looking for ID ${id}…`);
    await ensureAgendaFilesLoadedAndWait();
    ({ places, total } = locate(id));
  }
  if (places.length === 0) {
    setStatus(`No heading with ID ${id} in this file, your open tabs or your Agenda Files.`);
    return;
  }
  const first = places[0];
  if (first.tabId !== undefined) {
    S.navigationBackStack.push({ view: S.currentView, documentId: S.state.documentId, storageKind: S.state.storageKind, scrollTop: scrollContainer().scrollTop });
    if (S.navigationBackStack.length > NAVIGATION_BACK_STACK_LIMIT) S.navigationBackStack.shift();
    syncNavBackButtonVisibility();
    switchToTab(first.tabId);
    const heading = findHeadingById(S.state.doc, id);
    if (heading) navigateToHeading(heading, { pushToBackStack: false });
  } else if (first.key && first.documentId) {
    const colon = first.key.indexOf(':');
    const scheme = colon === -1 ? first.key : first.key.slice(0, colon);
    // root-relative ("/"), so the file is found by its own path and not beside the document on screen
    await openFileLink({ type: 'file', scheme, path: '/' + first.documentId, inFileTarget: null, byId: id }, containingHeading);
  }
  if (total > 1) setStatus(`${total} headings share ID ${id}; opened the first.`);
}

/** Link text must not hold brackets, which would end the link early.
 * @param {string} title */
function linkText(title) {
  return title.replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * org-store-link: puts `[[id:UUID][Title]]` for the heading on the clipboard, giving the heading an :ID: first when it has none.
 * @param {Heading} heading
 */
export async function copyHeadingLink(heading) {
  let id = typeof heading.properties.ID === 'string' ? heading.properties.ID.trim() : '';
  const title = linkText(heading.title) || 'link';
  let created = false;
  if (!id) {
    if (S.isBufferReadOnly) {
      setStatus('This heading has no ID yet, and the buffer is read-only — make it writable to give it one.');
      return;
    }
    id = crypto.randomUUID();
    setProperty(heading, 'ID', id);
    created = true;
    commitAndRender(`Added an ID to "${title}"`);
  }
  const link = `[[id:${id}][${title}]]`;
  try {
    await platform.clipboard.writeText(link);
    setStatus(`Copied the link to "${title}"${created ? ' (and added its :ID:)' : ''}.`);
  } catch {
    setStatus(`Couldn't copy to the clipboard — your browser may not allow it here.${created ? ' The :ID: was added to the heading.' : ''}`);
  }
}
