/**
 * Agenda notifications, the way Emacs's appt does them: appointments are the agenda items that have a time of day, and each is
 * announced once, `appt-message-warning-time` minutes before it starts. Everything here is pure (no timers, no DOM, no platform), so
 * the scan, the reminder text and the countdown can be tested directly; src-browser/appt-flow.js is what runs them.
 *
 * What counts as an appointment: a SCHEDULED, DEADLINE or plain active timestamp with a time of day (a repeating one expanded into
 * the occurrences that fall in the window), not DONE, not archived or commented, not yet started. Items with no time of day are
 * ignored, as in Emacs.
 */

import { buildAgendaItems, endOfDay, startOfDay } from './agenda.js';
import { eventDetails, titleWithoutTimestamps } from './export-icalendar.js';
import { resolveTodoSequence } from './todo-cycle.js';

/** The settings, under the Emacs names. A record of these is what is stored (and what a settings backup carries). */
export const APPT_DEFAULTS = {
  'appt-activate': false,
  'appt-message-warning-time': 10,
  'appt-display-interval': 3, // once an appointment is within its warning time, remind again every this many minutes
  'appt-agenda-scan-interval': 5,
  'appt-display-mode-line': true,
  'appt-display-format': 'window', // 'window' | 'echo'
};

export const APPT_LIMITS = { warning: [1, 1440], interval: [1, 60], scan: [1, 60] };

const clampInt = (value, [min, max], fallback) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** Any stored value (missing, partial, hand-edited) as a complete, valid settings record. */
export function normalizeApptSettings(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    'appt-activate': r['appt-activate'] === true,
    'appt-message-warning-time': clampInt(r['appt-message-warning-time'], APPT_LIMITS.warning, APPT_DEFAULTS['appt-message-warning-time']),
    'appt-display-interval': clampInt(r['appt-display-interval'], APPT_LIMITS.interval, APPT_DEFAULTS['appt-display-interval']),
    'appt-agenda-scan-interval': clampInt(r['appt-agenda-scan-interval'], APPT_LIMITS.scan, APPT_DEFAULTS['appt-agenda-scan-interval']),
    'appt-display-mode-line': r['appt-display-mode-line'] !== false,
    'appt-display-format': r['appt-display-format'] === 'echo' ? 'echo' : 'window',
  };
}

const pad = (n) => String(n).padStart(2, '0');
export const clock = (date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

/**
 * The appointments from `now` to `now` + `hours`, soonest first.
 * @param {{ documentId: string, doc: object }[]} docs the open document and the loaded agenda files
 * @returns {{ key: string, id: number, documentId: string, title: string, start: Date, end: Date|null, detail: string|null }[]} `detail` is the start of the heading's body (up to 400 characters, as the calendar sync sends)
 */
export function upcomingAppointments(docs, now, { hours = 6, birthdayProperty = 'BIRTHDAY', contactsDocs = null, includeArchived = false, includeCommented = false } = {}) {
  const horizon = new Date(now.getTime() + hours * 3600000);
  const done = new Set();
  for (const { doc } of docs) for (const keyword of resolveTodoSequence(doc).doneKeywords) done.add(keyword);
  const items = buildAgendaItems(docs, {
    today: now,
    rangeStart: startOfDay(now),
    rangeEnd: endOfDay(horizon),
    birthdayProperty,
    contactsDocs,
    includeArchived,
    includeCommented,
    deadlineWarningDays: 0,
    todoFilter: (todo) => !done.has(todo), // no isDone: nothing is carried forward, an appointment is on its own day
  });
  const found = [];
  const seen = new Set();
  for (const item of items) {
    if (!item.hasTime || item.daysOverdue) continue;
    if (item.kind !== 'scheduled' && item.kind !== 'deadline' && item.kind !== 'timestamp') continue;
    const start = item.date;
    if (!(start.getTime() > now.getTime() - 1) || start.getTime() > horizon.getTime()) continue; // already started, or too far off
    let end = null;
    if (item.endDate) {
      end = new Date(start.getFullYear(), start.getMonth(), start.getDate(), item.endDate.getHours(), item.endDate.getMinutes());
      if (end <= start) end = null;
    }
    const title = item.kind === 'timestamp' ? titleWithoutTimestamps(item.heading.title) : item.heading.title;
    const key = `${item.documentId}\u0000${title}\u0000${start.getTime()}`;
    if (seen.has(key)) continue; // the same heading and moment twice (say a SCHEDULED and a timestamp alike) is one appointment
    seen.add(key);
    found.push({ key, id: appointmentId(key), documentId: item.documentId, title, start, end, detail: eventDetails(item.heading).body });
  }
  found.sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));
  return found;
}

/** A stable positive 31-bit number for an appointment, which is what a native notification is cancelled and replaced by. */
export function appointmentId(key) {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h * 33) ^ key.charCodeAt(i)) >>> 0;
  return (h % 2147483646) + 1;
}

/** Minutes from `now` until `start`, rounded up (a start 30 seconds away is "in 1 min"), never below 0. */
export function minutesUntil(start, now) {
  return Math.max(0, Math.ceil((start.getTime() - now.getTime()) / 60000));
}

const span = (appt) => (appt.end ? `${clock(appt.start)}\u2013${clock(appt.end)}` : clock(appt.start));

/** "in 10 min · 09:30–10:15" (0 reads "now"): what a reminder says about the appointment, under its title. */
export function reminderBody(appt, minutes) {
  const when = minutes <= 0 ? 'now' : `in ${minutes} min`;
  return `${when} \u00b7 ${span(appt)}`;
}

/** "Dentist · in 10 min · 09:30–10:15": the whole reminder as one line (the status line, a banner). */
export function reminderText(appt, minutes) {
  return `${appt.title} \u00b7 ${reminderBody(appt, minutes)}`;
}

/** When, in minutes before the start, an appointment is announced: as it enters its warning time, then every `interval` minutes, as
 *  Emacs's appt does (appt-display-interval). 10 minutes warned at 3-minute intervals reads 10, 7, 4, 1; the last one falls on the
 *  start itself only if the warning time is a multiple of the interval, which is why Emacs recommends it. */
export function reminderOffsets(warningMinutes, interval) {
  const offsets = [];
  for (let m = warningMinutes; m >= 0; m -= Math.max(1, interval)) offsets.push(m);
  return offsets;
}

/** The slot an announcement is remembered under, so it is made once. */
export const reminderSlot = (appt, offset) => `${appt.key}\u0001${offset}`;

/**
 * What to announce now: for each appointment, the latest of its reminder times that has come and not yet been made (reminders missed
 * while the app was away are not made up, only the current one is), as `{ appt, offset, minutes }` with `minutes` the time left.
 * `fired` is a Set of slots; the caller adds the slot of each one it announces.
 */
export function dueReminders(appointments, now, warningMinutes, fired, interval = 3) {
  const offsets = reminderOffsets(warningMinutes, interval);
  const due = [];
  for (const appt of appointments) {
    if (appt.start.getTime() < now.getTime()) continue;
    const left = (appt.start.getTime() - now.getTime()) / 60000;
    // the latest reminder time that has come is the smallest offset still >= the time left
    const offset = offsets.filter((o) => o >= left).pop();
    if (offset === undefined || fired.has(reminderSlot(appt, offset))) continue;
    due.push({ appt, offset, minutes: minutesUntil(appt.start, now) });
  }
  return due;
}

/** `fired` without the appointments that have started: the memory only needs to cover what could still be announced. */
export function pruneFired(fired, appointments, now) {
  const live = new Set(appointments.filter((a) => a.start.getTime() >= now.getTime()).map((a) => a.key));
  return new Set([...fired].filter((slot) => live.has(slot.slice(0, slot.indexOf('\u0001')))));
}

/** "Appt: 10m" for the nearest appointment inside the warning window, else null. Cleared once the start time is reached. */
export function modeLineText(appointments, now, warningMinutes) {
  const next = appointments.find((a) => a.start.getTime() > now.getTime());
  if (!next || next.start.getTime() - now.getTime() > warningMinutes * 60000) return null;
  return `Appt: ${minutesUntil(next.start, now)}m`;
}

/**
 * What a platform that can schedule ahead (an Android shell) should hold: one notification for each reminder time of each
 * appointment, worded as it will read then and titled by the appointment, the repeats of one appointment sharing a group. Times that
 * have passed are not here (the app announces what is current itself), and at most `limit` are kept, nearest first, because the
 * system caps how many alarms an app may hold.
 */
export function plannedNotifications(appointments, now, warningMinutes, interval = 3, limit = 50) {
  const offsets = reminderOffsets(warningMinutes, interval);
  const planned = [];
  for (const appt of appointments) {
    for (const offset of offsets) {
      const at = new Date(appt.start.getTime() - offset * 60000);
      if (at.getTime() <= now.getTime()) continue;
      const body = reminderBody(appt, offset);
      planned.push({ id: appointmentId(reminderSlot(appt, offset)), slot: reminderSlot(appt, offset), at, title: appt.title, body, group: `appt-${appt.id}`, detail: appt.detail, day: startOfDay(appt.start).getTime() });
    }
  }
  planned.sort((a, b) => a.at - b.at);
  return planned.slice(0, limit);
}
