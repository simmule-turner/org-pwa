/**
 * The contacts as vCards, and the plan for keeping a CardDAV address book in step with them. The twin of
 * calendar-mirror.js and shaped like it: all pure (what to send, what to remove, what to remember afterwards), with the
 * network in caldav-client.js (createCarddavClient) and the wiring in src-browser/contacts-sync.js.
 *
 * The address book is a ONE-WAY mirror of the contacts files (`org-contacts-files`): every contact in them is sent as a
 * vCard of its own, in whichever style it is written (Flat or Tree: see collectContactCards). Nothing is read back.
 *
 * Each contact remembers which file it came from, and is only ever deleted when that file was loaded in the run, so a
 * contacts file that failed to load keeps its contacts on the server, and a device that mirrors different files cannot
 * delete another device's. Only files this app named (orgpwa-...) are ever removed; anything else in the address book is
 * left alone. The planning itself is calendar-mirror's, which does not care what a resource is.
 */

import { UNSAVED_DOCUMENT_ID } from './agenda.js';
import { getProperty } from './archive-model.js';
import { RESOURCE_PREFIX, nextSyncState, planCalendarSync } from './calendar-mirror.js';
import { collectContactCards } from './export-vcard.js';
import { contentHash } from './sync-engine.js';

/** What identifies a contact to the server, and stays the same from run to run: its :ID: if it has one (as org-contacts and
 *  org-id use), else built from its file and name. Two contacts with the same name in one file get different ones. */
function contactUid(documentId, heading, index) {
  const existingId = getProperty(heading, 'ID');
  const base = existingId ? existingId : `${documentId || 'doc'}-${heading.title}-contact-${index}`;
  return `${base.replace(/[^A-Za-z0-9._-]/g, '-')}@org-pwa`;
}

/** The file name a contact is stored under on the server: readable, safe in a URL, and unique to its id. Every name this
 *  app makes starts with `orgpwa-`, which is how it recognizes its own contacts and leaves any other alone. */
function resourceNameForContactUid(uid) {
  const base = uid.replace(/@org-pwa$/, '').replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 100);
  return `${RESOURCE_PREFIX}${base}-${contentHash(uid)}.vcf`;
}

function isOurContactResource(name) {
  return name.startsWith(RESOURCE_PREFIX) && name.endsWith('.vcf');
}

/** One contact's vCard text, with the UID a CardDAV server needs to tell contacts apart (the export has none, since a
 *  single file of cards does not need one). It goes straight after VERSION, where vCard 3.0 allows it. */
function vcardText(lines, uid) {
  const withUid = lines.some((line) => /^UID[:;]/i.test(line)) ? lines : [lines[0], lines[1], `UID:${uid}`, ...lines.slice(2)];
  return withUid.join('\r\n') + '\r\n';
}

/**
 * Every contact the address book should hold, keyed by the name it is stored under.
 * @param {{ documentId: string, doc: object }[]} docs the loaded contacts files
 * @returns {Map<string, { uid: string, documentId: string, vcf: string, hash: string }>}
 */
function buildContactResources(allDocs, opts = {}) {
  const docs = allDocs.filter(({ documentId, doc }) => doc && documentId && !documentId.startsWith(UNSAVED_DOCUMENT_ID));
  const cards = collectContactCards(docs, { birthdayProperty: opts.birthdayProperty || 'BIRTHDAY' });
  const resources = new Map();
  const usedUids = new Set();
  const seen = new Map();
  for (const { documentId, heading, lines } of cards) {
    const slot = `${documentId}\u0000${heading.title}`;
    const index = seen.get(slot) || 0;
    seen.set(slot, index + 1);
    let uid = contactUid(documentId, heading, index);
    for (let n = 2; usedUids.has(uid); n++) uid = contactUid(documentId, heading, index).replace(/@org-pwa$/, `-${n}@org-pwa`);
    usedUids.add(uid);
    const vcf = vcardText(lines, uid);
    resources.set(resourceNameForContactUid(uid), { uid, documentId, vcf, hash: contentHash(vcf) });
  }
  return resources;
}

export { buildContactResources, contactUid, isOurContactResource, resourceNameForContactUid, vcardText };
export { planCalendarSync as planContactsSync, nextSyncState as nextContactsSyncState };
