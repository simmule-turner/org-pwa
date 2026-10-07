// Mirrors the contacts files (org-contacts-files) to a CardDAV address book (Radicale, Nextcloud, ...), one way, so the
// contacts also appear in the phone's own contacts app. The twin of calendar-sync.js: what to send is
// src/contacts-mirror.js, the requests are src/caldav-client.js (createCarddavClient); this is the part that knows about
// settings, the contacts files, state and the status line. It signs in with the calendar's username and password.
import { createCarddavClient, runLimited } from '../src/caldav-client.js';
import { buildContactResources, isOurContactResource, nextContactsSyncState, planContactsSync } from '../src/contacts-mirror.js';
import { getContactsBirthdayProperty } from '../src/local-variables.js';
import { ensureContactsFilesLoadedAndWait, syncContactsFilesConfig } from './agenda-files.js';
import { S } from './app-state.js';
import { effectiveCaldavCredentials } from './calendar-sync.js';
import { setStatus } from './editing.js';
import { getCarddavSyncState, setCarddavSyncState } from './settings.js';
import { contactsFilesCache, kv } from './singletons.js';

const CONCURRENCY = 4; // requests in flight at once: quick on a LAN without swamping a small server
const AUTO_DELAY_MS = 2500; // a burst of saves or focus changes becomes one sync

/** The address book to use, or null when none is set. It uses the same username and password as the calendar. */
export function effectiveContactsConfig() {
  const c = S.caldavConfig;
  if (!c || !c.contactsUrl || !c.contactsUrl.trim()) return null;
  return { url: c.contactsUrl.trim(), ...effectiveCaldavCredentials() };
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** The contacts files that have loaded, as documents. The open document stands in for its own file when it is one of them,
 *  so the live version (unsaved edits included) is what is sent. The open document is NOT included otherwise: the address
 *  book holds what org-contacts-files names, not whatever file happens to be open. */
function contactsFileDocs() {
  const docs = [];
  const seen = new Set();
  for (const entry of contactsFilesCache.values()) {
    if (!entry.doc || seen.has(entry.documentId)) continue;
    seen.add(entry.documentId);
    docs.push({ documentId: entry.documentId, doc: entry.documentId === S.state.documentId && S.state.doc ? S.state.doc : entry.doc });
  }
  return docs;
}

/** The configured contacts files that have not loaded (still loading, or failed). */
function unloadedContactsFiles() {
  return S.contactsFilesConfig.filter((key) => {
    const entry = contactsFilesCache.get(key);
    return !(entry && entry.doc);
  });
}

/**
 * Brings the address book in line with the contacts files. `manual` is a person asking: it reports what happened and
 * retries after an earlier login failure. An automatic run says nothing unless something went wrong, and says that once.
 * `rebuild` first removes every contact this app ever put in the address book, then sends them all again; anything else
 * in the address book is left alone. `report` receives the final message of a run (the status line by default).
 */
export async function syncContactsToAddressBook({ manual = false, rebuild = false, report = setStatus } = {}) {
  const config = effectiveContactsConfig();
  if (!config) {
    if (manual) report('Set the contacts address first (Settings \u2192 Contacts).');
    return;
  }
  if (S.contactsSyncPaused && !manual) return;
  if (S.contactsSyncRunning) {
    S.contactsSyncQueued = true;
    return;
  }
  S.contactsSyncRunning = true;
  try {
    if (manual) setStatus('Syncing the contacts to the address book\u2026');
    syncContactsFilesConfig();
    if (S.contactsFilesConfig.length === 0) {
      if (manual) report('Nothing to sync: no contacts files are set (org-contacts-files).');
      return;
    }
    const client = createCarddavClient({ url: config.url, username: config.username, password: config.password });
    await client.check(); // one cheap request that gives a clear answer for a wrong address or password

    await ensureContactsFilesLoadedAndWait();
    const docs = contactsFileDocs();
    if (docs.length === 0) {
      if (manual) report('Nothing to sync: none of the contacts files could be loaded.');
      return;
    }
    const wanted = buildContactResources(docs, { birthdayProperty: S.state.doc ? getContactsBirthdayProperty(S.state.localVariables) : undefined });
    const loadedDocs = new Set(docs.map((d) => d.documentId));

    const stored = await getCarddavSyncState(kv);
    let previous = stored.url === config.url ? stored.resources || {} : {}; // a different address book: nothing was sent to it
    if (rebuild) {
      const ours = (await client.list()).filter(isOurContactResource);
      const removed = await runLimited(ours, CONCURRENCY, (name) => client.remove(name));
      if (removed.stopped) throw removed.stopped;
      previous = {};
      await setCarddavSyncState(kv, { url: config.url, resources: {} });
    }

    const plan = planContactsSync(wanted, previous, { loadedDocs });
    let done = 0;
    const total = plan.puts.length + plan.deletes.length;
    const tick = () => {
      done++;
      if (manual && total > 40 && done % 20 === 0) setStatus(`Syncing the contacts\u2026 ${done}/${total}`);
    };
    const puts = await runLimited(plan.puts, CONCURRENCY, async (name) => {
      await client.put(name, wanted.get(name).vcf);
      tick();
    });
    const dels = puts.stopped ? { ok: [], failed: [], stopped: null } : await runLimited(plan.deletes, CONCURRENCY, async (name) => {
      await client.remove(name);
      tick();
    });
    const next = nextContactsSyncState(previous, wanted, { putOk: new Set(puts.ok), deleteOk: new Set(dels.ok) });
    await setCarddavSyncState(kv, { url: config.url, resources: next });

    const stopped = puts.stopped || dels.stopped;
    if (stopped) throw stopped;
    S.contactsSyncPaused = false;
    S.contactsSyncLastError = null;
    const failures = [...puts.failed, ...dels.failed];
    if (failures.length > 0) {
      reportProblem(`${plural(failures.length, 'contact')} could not be synced and will be retried (${failures[0].error.message})`, manual, report);
    } else if (manual) {
      const parts = [];
      if (puts.ok.length) parts.push(`${puts.ok.length} sent`);
      if (dels.ok.length) parts.push(`${dels.ok.length} removed`);
      const skipped = unloadedContactsFiles().length;
      report(`Contacts synced: ${parts.join(', ') || 'already up to date'}.` + (skipped ? ` ${plural(skipped, 'contacts file')} could not be loaded, so their contacts were left alone.` : ''));
    }
  } catch (err) {
    if (err && (err.kind === 'auth' || err.kind === 'not-found')) S.contactsSyncPaused = true; // asking again would only repeat it
    reportProblem(err && err.message ? err.message : String(err), manual, report);
  } finally {
    S.contactsSyncRunning = false;
    if (S.contactsSyncQueued) {
      S.contactsSyncQueued = false;
      scheduleContactsSync();
    }
  }
}

/** An automatic run shows a given problem once, so a server that is down does not nag at every save. */
function reportProblem(message, manual, report = setStatus) {
  if (!manual && S.contactsSyncLastError === message) return;
  S.contactsSyncLastError = message;
  report('Contacts sync: ' + message);
}

/** Asks for a sync soon. Cheap to call from anywhere (a save, coming back to the app): calls close together become one. */
export function scheduleContactsSync() {
  if (!effectiveContactsConfig() || S.contactsSyncPaused) return;
  clearTimeout(S.contactsSyncTimer);
  S.contactsSyncTimer = setTimeout(() => {
    syncContactsToAddressBook().catch(() => {});
  }, AUTO_DELAY_MS);
}
