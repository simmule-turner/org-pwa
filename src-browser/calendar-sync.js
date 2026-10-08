// Mirrors the agenda to a CalDAV calendar (Radicale, Nextcloud, ...), one way, so the items View -> Agenda shows
// also appear in the phone's own calendar app, with its alarms. What to send is src/calendar-mirror.js, the requests
// are src/caldav-client.js; this is the part that knows about settings, the agenda files, state and the status line.
import { buildCalendarResources, isOurResource, nextSyncState, planCalendarSync } from '../src/calendar-mirror.js';
import { createCaldavClient, runLimited } from '../src/caldav-client.js';
import { getContactsBirthdayProperty } from '../src/local-variables.js';
import { S } from './app-state.js';
import { aggregateAgendaDocs, loadContactsDocsForSync, unloadedAgendaFiles, waitForAgendaFilesLoaded } from './agenda-files.js';
import { setStatus } from './editing.js';
import { getCaldavSyncState, setCaldavSyncState } from './settings.js';
import { kv } from './singletons.js';

const CONCURRENCY = 4; // requests in flight at once: quick on a LAN without swamping a small server
const AUTO_DELAY_MS = 2500; // a burst of saves or focus changes becomes one sync

/** The username and password for the calendar AND the address book (contacts-sync.js uses the same ones). A blank one falls
 *  back to the WebDAV ones, since a CalDAV or CardDAV server is often the same host. */
export function effectiveCaldavCredentials() {
  const c = S.caldavConfig || {};
  return {
    username: c.username || (S.webdavConfig && S.webdavConfig.username) || '',
    password: c.password || (S.webdavConfig && S.webdavConfig.password) || '',
  };
}

/** The calendar to use, or null when none is set. */
export function effectiveCalendarConfig() {
  const c = S.caldavConfig;
  if (!c || !c.url || !c.url.trim()) return null;
  return { url: c.url.trim(), ...effectiveCaldavCredentials() };
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * Brings the calendar in line with the agenda. `manual` is a person asking: it reports what happened and retries
 * after an earlier login failure. An automatic run says nothing unless something went wrong, and says that once.
 * `rebuild` first removes every event this app ever put in the calendar, then sends them all again; anything else in
 * the calendar is left alone. `report` receives the final message of a run (the status line by default), so the Sync
 * button can put the calendar's and the contacts' together in one line.
 */
export async function syncAgendaToCalendar({ manual = false, rebuild = false, report = setStatus } = {}) {
  const config = effectiveCalendarConfig();
  if (!config) {
    if (manual) report('Set the calendar address first (Settings \u2192 Calendar).');
    return;
  }
  if (S.calendarSyncPaused && !manual) return;
  if (S.calendarSyncRunning) {
    S.calendarSyncQueued = true;
    return;
  }
  S.calendarSyncRunning = true;
  try {
    if (manual) setStatus('Syncing the agenda to the calendar\u2026');
    const client = createCaldavClient({ url: config.url, username: config.username, password: config.password });
    await client.check(); // one cheap request that gives a clear answer for a wrong address or password

    await waitForAgendaFilesLoaded();
    const docs = aggregateAgendaDocs().filter((d) => d.doc);
    if (docs.length === 0) {
      if (manual) report('Nothing to sync: no document is open and no agenda files are loaded.');
      return;
    }
    // The contacts are those of org-contacts-files, as in the agenda. An event made from a contacts file is only ever removed when
    // that file loaded in this run, so a contacts file that failed to load keeps its birthdays on the server.
    const contactsDocs = await loadContactsDocsForSync(docs);
    const wanted = buildCalendarResources(docs, { today: new Date(), contactsDocs, birthdayProperty: S.state.doc ? getContactsBirthdayProperty(S.state.localVariables) : undefined });
    const loadedDocs = new Set([...docs, ...(contactsDocs || [])].map((d) => d.documentId));

    const stored = await getCaldavSyncState(kv);
    let previous = stored.url === config.url ? stored.resources || {} : {}; // a different calendar: nothing was sent to it
    if (rebuild) {
      const ours = (await client.list()).filter(isOurResource);
      const removed = await runLimited(ours, CONCURRENCY, (name) => client.remove(name));
      if (removed.stopped) throw removed.stopped;
      previous = {};
      await setCaldavSyncState(kv, { url: config.url, resources: {} });
    }

    const plan = planCalendarSync(wanted, previous, { loadedDocs });
    let done = 0;
    const total = plan.puts.length + plan.deletes.length;
    const tick = () => {
      done++;
      if (manual && total > 40 && done % 20 === 0) setStatus(`Syncing the calendar\u2026 ${done}/${total}`);
    };
    const puts = await runLimited(plan.puts, CONCURRENCY, async (name) => {
      await client.put(name, wanted.get(name).ics);
      tick();
    });
    const dels = puts.stopped ? { ok: [], failed: [], stopped: null } : await runLimited(plan.deletes, CONCURRENCY, async (name) => {
      await client.remove(name);
      tick();
    });
    const next = nextSyncState(previous, wanted, { putOk: new Set(puts.ok), deleteOk: new Set(dels.ok) });
    await setCaldavSyncState(kv, { url: config.url, resources: next });

    const stopped = puts.stopped || dels.stopped;
    if (stopped) throw stopped;
    S.calendarSyncPaused = false;
    S.calendarSyncLastError = null;
    const failures = [...puts.failed, ...dels.failed];
    if (failures.length > 0) {
      reportProblem(`${plural(failures.length, 'event')} could not be synced and will be retried (${failures[0].error.message})`, manual, report);
    } else if (manual) {
      const parts = [];
      if (puts.ok.length) parts.push(`${puts.ok.length} sent`);
      if (dels.ok.length) parts.push(`${dels.ok.length} removed`);
      const skipped = unloadedAgendaFiles().length;
      report(`Calendar synced: ${parts.join(', ') || 'already up to date'}.` + (skipped ? ` ${plural(skipped, 'agenda file')} could not be loaded, so their events were left as they are.` : ''));
    }
  } catch (err) {
    if (err && (err.kind === 'auth' || err.kind === 'not-found')) S.calendarSyncPaused = true; // asking again would only repeat it
    reportProblem(err && err.message ? err.message : String(err), manual, report);
  } finally {
    S.calendarSyncRunning = false;
    if (S.calendarSyncQueued) {
      S.calendarSyncQueued = false;
      scheduleCalendarSync();
    }
  }
}

/** An automatic run shows a given problem once, so a server that is down does not nag at every save. */
function reportProblem(message, manual, report = setStatus) {
  if (!manual && S.calendarSyncLastError === message) return;
  S.calendarSyncLastError = message;
  report('Calendar sync: ' + message);
}

/** Asks for a sync soon. Cheap to call from anywhere (a save, coming back to the app): calls close together become one. */
export function scheduleCalendarSync() {
  if (!effectiveCalendarConfig() || S.calendarSyncPaused) return;
  clearTimeout(S.calendarSyncTimer);
  S.calendarSyncTimer = setTimeout(() => {
    syncAgendaToCalendar().catch(() => {});
  }, AUTO_DELAY_MS);
}
