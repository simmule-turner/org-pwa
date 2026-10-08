/**
 * The agenda as calendar events, and the plan for keeping a CalDAV calendar in step with it. All pure: what to
 * send, what to remove, and what to remember afterwards. The network is caldav-client.js and the wiring is
 * src-browser/calendar-sync.js.
 *
 * The calendar is a ONE-WAY mirror of the agenda. What goes in is what View -> Agenda shows, plus the things it
 * leaves to other views: completed items are kept (with their state in the description), and recurring items are
 * sent as a single event with a recurrence rule, which calendar apps expand themselves, instead of one copy per
 * day. Ambient entries (sunrise, sunset, weather) are left out, as in the agenda's own calendar. A window keeps the
 * calendar tidy: one-off items from a month back to six months ahead, and sexp (diary-style) entries over the same
 * range, since those have to be worked out day by day.
 *
 * Each event remembers which file it came from, and is only ever deleted when that file was loaded in the run. So the
 * calendar never depends on which file happens to be open (switching files cannot remove the other file's events), a
 * file that failed to load or is not open keeps its events, and a device that mirrors different files cannot delete
 * another device's. Unsaved scratch documents are not mirrored: they have no stable identity to own events by.
 */

import { UNSAVED_DOCUMENT_ID } from './agenda.js';
import { DEFAULT_DAYS_AFTER, DEFAULT_DAYS_BEFORE, agendaWindow, collectAgendaCalendarEvents } from './calendar-from-agenda.js';
import { contentHash } from './sync-engine.js';

const RESOURCE_PREFIX = 'orgpwa-';
const CALENDAR_HEAD = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//org-pwa//org-pwa//EN', 'CALSCALE:GREGORIAN'];

/** The file name an event is stored under on the server: readable, safe in a URL, and unique to the event id (the
 *  hash covers ids that sanitize or truncate to the same text). Every name this app makes starts with
 *  `orgpwa-`, which is how it recognizes its own events and leaves anything else in the calendar alone. */
function resourceNameForUid(uid) {
  const base = uid.replace(/@org-pwa$/, '').replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 100);
  return `${RESOURCE_PREFIX}${base}-${contentHash(uid)}.ics`;
}

function isOurResource(name) {
  return name.startsWith(RESOURCE_PREFIX) && name.endsWith('.ics');
}

/** A change fingerprint that ignores DTSTAMP, which changes on every run and would make every event look edited. */
function eventHash(ics) {
  return contentHash(ics.replace(/^DTSTAMP:.*\r\n/m, ''));
}

function wrapEvent(eventLines) {
  return [...CALENDAR_HEAD, ...eventLines, 'END:VCALENDAR'].join('\r\n') + '\r\n';
}

/**
 * Every event the calendar should hold, keyed by the name it is stored under.
 * @param {{ documentId: string, doc: object }[]} docs the open document and the loaded agenda files
 * @returns {Map<string, { uid: string, documentId: string, ics: string, hash: string }>}
 */
function buildCalendarResources(allDocs, opts = {}) {
  const docs = allDocs.filter(({ documentId, doc }) => doc && documentId && !documentId.startsWith(UNSAVED_DOCUMENT_ID));
  const today = opts.today || new Date();
  const daysBefore = opts.daysBefore ?? DEFAULT_DAYS_BEFORE;
  const daysAfter = opts.daysAfter ?? DEFAULT_DAYS_AFTER;
  const window = agendaWindow(today, daysBefore, daysAfter);
  const birthdayProperty = opts.birthdayProperty || 'BIRTHDAY';

  // What View > Agenda shows, folded into calendar events (see calendar-from-agenda.js): completed items are not in it, so not here.
  const events = collectAgendaCalendarEvents(docs, { today, window, birthdayProperty, contactsDocs: opts.contactsDocs || null });

  const resources = new Map();
  for (const { uid, documentId, lines } of events) {
    let name = resourceNameForUid(uid);
    for (let n = 2; resources.has(name); n++) name = resourceNameForUid(`${uid}#${n}`); // two events cannot share a file
    const ics = wrapEvent(lines);
    resources.set(name, { uid, documentId, ics, hash: eventHash(ics) });
  }
  return resources;
}

/**
 * What to do to bring the server in line with `wanted`, given what was last sent (`previous`: name -> { hash, doc }).
 * An event is deleted only if this device sent it AND its file (`doc`) is among `loadedDocs`, the files actually
 * loaded in this run: an event for a file that did not load would otherwise look like one that was removed.
 * `loadedDocs` null means every file counts as loaded.
 */
function planCalendarSync(wanted, previous, { loadedDocs = null } = {}) {
  const puts = [];
  let unchanged = 0;
  for (const [name, resource] of wanted) {
    if (previous[name] && previous[name].hash === resource.hash) unchanged++;
    else puts.push(name);
  }
  const deletes = Object.keys(previous).filter((name) => !wanted.has(name) && (!loadedDocs || loadedDocs.has(previous[name].doc)));
  return { puts, deletes, unchanged };
}

/**
 * What to remember after a run: for each event, its fingerprint and its file. A successful send or delete is
 * recorded; a failed one is left as it was, so the next run tries it again.
 * @param {object} outcome `{ putOk, deleteOk }`: sets of names
 */
function nextSyncState(previous, wanted, outcome) {
  const next = {};
  for (const [name, entry] of Object.entries(previous)) {
    if (outcome.deleteOk.has(name)) continue;
    if (!outcome.putOk.has(name)) next[name] = entry; // unchanged, failed, or not touched this run
  }
  for (const name of outcome.putOk) next[name] = { hash: wanted.get(name).hash, doc: wanted.get(name).documentId };
  for (const [name, resource] of wanted) {
    if (previous[name] && previous[name].hash === resource.hash) next[name] = { hash: resource.hash, doc: resource.documentId };
  }
  return next;
}

export { DEFAULT_DAYS_BEFORE, DEFAULT_DAYS_AFTER, RESOURCE_PREFIX, resourceNameForUid, isOurResource, eventHash, buildCalendarResources, planCalendarSync, nextSyncState };
