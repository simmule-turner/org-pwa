import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import { APPT_DEFAULTS, appointmentId, dueReminders, modeLineText, normalizeApptSettings, plannedNotifications, pruneFired, reminderText, upcomingAppointments } from '../src/appt.js';

const docs = (text) => [{ documentId: 'd', doc: parseOrg(text) }];
const at = (h, m = 0, day = 8) => new Date(2026, 9, day, h, m);
const NOW = at(9, 0);

test('settings: missing, partial and junk values become valid', () => {
  assert.deepEqual(normalizeApptSettings(undefined), APPT_DEFAULTS);
  assert.equal(normalizeApptSettings({ 'appt-activate': 'yes' })['appt-activate'], false);
  const s = normalizeApptSettings({ 'appt-activate': true, 'appt-message-warning-time': '25', 'appt-agenda-scan-interval': 0, 'appt-display-format': 'echo', 'appt-display-mode-line': false });
  assert.equal(s['appt-message-warning-time'], 25);
  assert.equal(s['appt-agenda-scan-interval'], 1);
  assert.equal(s['appt-display-format'], 'echo');
  assert.equal(s['appt-display-mode-line'], false);
  assert.equal(normalizeApptSettings({ 'appt-display-format': 'x' })['appt-display-format'], 'window');
  assert.equal(normalizeApptSettings({ 'appt-message-warning-time': 99999 })['appt-message-warning-time'], 1440);
});

test('scan: only timed, not-started, not-DONE items; the timestamp is stripped from the title', () => {
  const list = upcomingAppointments(docs(`* Dentist <2026-10-08 Thu 09:30-10:15>
* TODO Call Bob
SCHEDULED: <2026-10-08 Thu 11:00>
* DONE Old thing
SCHEDULED: <2026-10-08 Thu 10:00>
* No time of day
SCHEDULED: <2026-10-08 Thu>
* Already started <2026-10-08 Thu 08:00>
* Tomorrow lunch <2026-10-09 Fri 12:00>
`), NOW, { hours: 6 });
  assert.deepEqual(list.map((a) => a.title), ['Dentist', 'Call Bob']);
  assert.equal(list[0].end.getHours(), 10);
  assert.equal(list[0].end.getMinutes(), 15);
  assert.equal(list[1].end, null);
});

test('scan: a repeating appointment appears as its occurrence in the window', () => {
  const list = upcomingAppointments(docs(`* Standup
SCHEDULED: <2026-09-01 Tue 09:30 +1d>
`), NOW, { hours: 30 });
  assert.deepEqual(list.map((a) => a.start.getTime()), [at(9, 30).getTime(), at(9, 30, 9).getTime()]);
});

test('scan: archived and commented headings are left out; one appointment is not listed twice', () => {
  const list = upcomingAppointments(docs(`* Archived thing :ARCHIVE:
SCHEDULED: <2026-10-08 Thu 10:00>
* # hidden
SCHEDULED: <2026-10-08 Thu 10:30>
* Both
SCHEDULED: <2026-10-08 Thu 11:00>
`), NOW);
  assert.deepEqual(list.map((a) => a.title), ['Both']);
});

test('due: inside the warning window, once, not after it started', () => {
  const list = upcomingAppointments(docs('* Dentist <2026-10-08 Thu 09:30>\n* Later <2026-10-08 Thu 12:00>\n'), NOW);
  const fired = new Set();
  assert.equal(dueReminders(list, NOW, 10, fired).length, 0);
  assert.equal(dueReminders(list, at(9, 20), 10, fired).length, 1);
  fired.add(list[0].key);
  assert.equal(dueReminders(list, at(9, 25), 10, fired).length, 0);
  assert.equal(dueReminders(list, at(9, 31), 10, new Set()).length, 0);
  assert.equal(pruneFired(fired, list, at(9, 31)).size, 0);
  assert.equal(pruneFired(fired, list, at(9, 20)).size, 1);
});

test('text: reminder and mode line', () => {
  const [a] = upcomingAppointments(docs('* Dentist <2026-10-08 Thu 09:30-10:15>\n'), NOW);
  assert.equal(reminderText(a, 10), 'Dentist · in 10 min · 09:30–10:15');
  assert.equal(reminderText(a, 0), 'Dentist · now · 09:30–10:15');
  assert.equal(modeLineText([a], at(9, 10), 10), null);
  assert.equal(modeLineText([a], at(9, 20), 10), 'Appt: 10m');
  assert.equal(modeLineText([a], new Date(at(9, 29).getTime() + 30000), 10), 'Appt: 1m');
  assert.equal(modeLineText([a], at(9, 30), 10), null);
  assert.equal(modeLineText([], at(9, 20), 10), null);
});

test('planned: native notifications at start minus warning, future only, capped', () => {
  const list = upcomingAppointments(docs('* A <2026-10-08 Thu 09:05>\n* B <2026-10-08 Thu 10:00>\n* C <2026-10-08 Thu 11:00>\n'), NOW);
  const plan = plannedNotifications(list, NOW, 10);
  assert.deepEqual(plan.map((p) => p.at.getHours() * 60 + p.at.getMinutes()), [590, 650]); // A is already inside its window
  assert.equal(plan[0].body, 'B · in 10 min · 10:00');
  assert.equal(plannedNotifications(list, NOW, 10, 1).length, 1);
  assert.ok(plan.every((p) => Number.isInteger(p.id) && p.id > 0 && p.id < 2147483647));
  assert.equal(appointmentId('x'), appointmentId('x'));
});
