// The calendar mirror (calendar-sync.js) and the contacts mirror (contacts-sync.js) are separate, and each is optional. This is
// the one place that treats them as a pair: what the app calls when it wants "the servers brought up to date", and what the
// Sync button in Settings runs.
import { effectiveCalendarConfig, scheduleCalendarSync, syncAgendaToCalendar } from './calendar-sync.js';
import { effectiveContactsConfig, scheduleContactsSync, syncContactsToAddressBook } from './contacts-sync.js';
import { setStatus } from './editing.js';

/** Asks for a sync of whichever of the two is set up, soon. Cheap to call from anywhere: calls close together become one. */
export function scheduleSync() {
  scheduleCalendarSync();
  scheduleContactsSync();
}

/** Syncs the calendar and the contacts, whichever are set up, one after the other, and says how each went in one line (so an
 *  error in one is not hidden by the other's success). */
export async function syncNow() {
  const messages = [];
  const report = (message) => messages.push(message);
  if (effectiveCalendarConfig()) await syncAgendaToCalendar({ manual: true, report });
  if (effectiveContactsConfig()) await syncContactsToAddressBook({ manual: true, report });
  if (messages.length) setStatus(messages.join(' '));
}
