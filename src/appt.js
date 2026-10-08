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
import { titleWithoutTimestamps } from './export-icalendar.js';
import { resolveTodoSequence } from './todo-cycle.js';

/** The settings, under the Emacs names. A record of these is what is stored (and what a settings backup carries). */
export const APPT_DEFAULTS = {
  'appt-activate': false,
  'appt-message-warning-time': 10,
  'appt-agenda-scan-interval': 5,
  'appt-display-mode-line': true,
  'appt-display-format': 'window', // 'window' | 'echo'
};

export const APPT_LIMITS = { warning: [1, 1440], scan: [1, 60] };

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
 * @returns {{ key: string, id: number, documentId: string, title: string, start: Date, end: Date|null }[]}
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
    found.push({ key, id: appointmentId(key), documentId: item.documentId, title, start, end });
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

const span = (appt) => (appt.end ? `${clock(appt.start)}–${clock(appt.end)}` : clock(appt.start));

/** "Dentist · in 10 min · 09:30–10:15". `minutes` is how long until it starts (0 reads "now"). */
export function reminderText(appt, minutes) {
  const when = minutes <= 0 ? 'now' : `in ${minutes} min`;
  return `${appt.title} · ${when} · ${span(appt)}`;
}

/** The appointments that have come within `warningMinutes` and not yet been announced, soonest first. `fired` is a Set of keys. */
export function dueReminders(appointments, now, warningMinutes, fired) {
  return appointments.filter((a) => !fired.has(a.key) && a.start.getTime() - now.getTime() <= warningMinutes * 60000 && a.start.getTime() >= now.getTime());
}

/** `fired` without the appointments that have started: the memory only needs to cover what could still be announced. */
export function pruneFired(fired, appointments, now) {
  const live = new Set(appointments.filter((a) => a.start.getTime() >= now.getTime()).map((a) => a.key));
  return new Set([...fired].filter((key) => live.has(key)));
}

/** "Appt: 10m" for the nearest appointment inside the warning window, else null. Cleared once the start time is reached. */
export function modeLineText(appointments, now, warningMinutes) {
  const next = appointments.find((a) => a.start.getTime() > now.getTime());
  if (!next || next.start.getTime() - now.getTime() > warningMinutes * 60000) return null;
  return `Appt: ${minutesUntil(next.start, now)}m`;
}

/**
 * What a platform that can schedule ahead (an Android shell) should hold: one notification per appointment, due `warningMinutes`
 * before it starts, worded as it will read then. An appointment already inside its warning window is not here (it is announced
 * straight away by the app), and at most `limit` are kept, because the system caps how many alarms an app may hold.
 */
export function plannedNotifications(appointments, now, warningMinutes, limit = 50) {
  const planned = [];
  for (const appt of appointments) {
    const at = new Date(appt.start.getTime() - warningMinutes * 60000);
    if (at.getTime() <= now.getTime()) continue;
    planned.push({ id: appt.id, key: appt.key, at, title: 'Appointment', body: reminderText(appt, warningMinutes), day: startOfDay(appt.start).getTime() });
    if (planned.length >= limit) break;
  }
  return planned;
}
