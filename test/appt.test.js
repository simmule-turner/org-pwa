import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import { APPT_DEFAULTS, appointmentId, dueReminders, modeLineText, normalizeApptSettings, plannedNotifications, pruneFired, reminderBody, reminderOffsets, reminderSlot, reminderText, upcomingAppointments } from '../src/appt.js';

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
  assert.equal(APPT_DEFAULTS['appt-display-interval'], 3);
  assert.equal(normalizeApptSettings({ 'appt-display-interval': '5' })['appt-display-interval'], 5);
  assert.equal(normalizeApptSettings({ 'appt-display-interval': -4 })['appt-display-interval'], 1);
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

test('scan: the heading body rides along as the detail, trimmed to 400 characters, without sexp lines or the timestamp line', () => {
  const long = 'x'.repeat(500);
  const list = upcomingAppointments(docs(`* meeting <2026-10-08 Thu 09:30>
this is the description / body.
%%(org-anniversary 2000 1 1)
* Long <2026-10-08 Thu 10:00>
${long}
* Bare <2026-10-08 Thu 11:00>
`), NOW);
  assert.equal(list[0].detail, 'this is the description / body.');
  assert.equal(list[1].detail.length, 400);
  assert.ok(list[1].detail.endsWith('\u2026'));
  assert.equal(list[2].detail, null);
  const plan = plannedNotifications(list, NOW, 10, 3);
  assert.equal(plan.find((p) => p.title === 'meeting').detail, 'this is the description / body.');
  assert.equal(plan.find((p) => p.title === 'Bare').detail, null);
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

test('offsets: when the warning starts, then every interval, as Emacs does', () => {
  assert.deepEqual(reminderOffsets(10, 3), [10, 7, 4, 1]);
  assert.deepEqual(reminderOffsets(12, 3), [12, 9, 6, 3, 0]); // a multiple of the interval ends on the start itself
  assert.deepEqual(reminderOffsets(5, 10), [5]);
  assert.deepEqual(reminderOffsets(3, 1), [3, 2, 1, 0]);
});

test('due: the first as the warning time is reached, a repeat each interval, none twice, none after the start', () => {
  const list = upcomingAppointments(docs('* Dentist <2026-10-08 Thu 09:30>\n* Later <2026-10-08 Thu 12:00>\n'), NOW);
  const fired = new Set();
  const step = (h, m, s = 0) => {
    const now = new Date(at(h, m).getTime() + s * 1000);
    const due = dueReminders(list, now, 10, fired, 3);
    for (const d of due) fired.add(reminderSlot(d.appt, d.offset));
    return due.map((d) => `${d.appt.title}@${d.offset}`);
  };
  assert.deepEqual(step(9, 0), []);
  assert.deepEqual(step(9, 19), []); // 11 minutes out
  assert.deepEqual(step(9, 20), ['Dentist@10']);
  assert.deepEqual(step(9, 21), []); // not again
  assert.deepEqual(step(9, 22), []);
  assert.deepEqual(step(9, 23), ['Dentist@7']);
  assert.deepEqual(step(9, 26), ['Dentist@4']);
  assert.deepEqual(step(9, 29, 30), ['Dentist@1']);
  assert.deepEqual(step(9, 30), []);
  assert.deepEqual(step(9, 31), []); // started
  assert.equal(pruneFired(fired, list, at(9, 31)).size, 0);
  assert.equal(pruneFired(fired, list, at(9, 20)).size, 4);
});

test('due: coming back late announces only the current reminder, not the ones missed', () => {
  const list = upcomingAppointments(docs('* Dentist <2026-10-08 Thu 09:30>\n'), NOW);
  const due = dueReminders(list, at(9, 27), 10, new Set(), 3);
  assert.equal(due.length, 1);
  assert.equal(due[0].offset, 4);
  assert.equal(due[0].minutes, 3);
});

test('text: reminder and mode line', () => {
  const [a] = upcomingAppointments(docs('* Dentist <2026-10-08 Thu 09:30-10:15>\n'), NOW);
  assert.equal(reminderText(a, 10), 'Dentist \u00b7 in 10 min \u00b7 09:30\u201310:15');
  assert.equal(reminderBody(a, 10), 'in 10 min \u00b7 09:30\u201310:15');
  assert.equal(reminderText(a, 0), 'Dentist \u00b7 now \u00b7 09:30\u201310:15');
  assert.equal(modeLineText([a], at(9, 10), 10), null);
  assert.equal(modeLineText([a], at(9, 20), 10), 'Appt: 10m');
  assert.equal(modeLineText([a], new Date(at(9, 29).getTime() + 30000), 10), 'Appt: 1m');
  assert.equal(modeLineText([a], at(9, 30), 10), null);
  assert.equal(modeLineText([], at(9, 20), 10), null);
});

test('planned: one native notification per reminder time, titled by the appointment, grouped, future only, capped', () => {
  const list = upcomingAppointments(docs('* A <2026-10-08 Thu 09:05>\n* B <2026-10-08 Thu 10:00>\n'), NOW);
  const plan = plannedNotifications(list, NOW, 10, 3);
  // A is 5 minutes out: its 10 and 7 minute reminders are past; 4 and 1 remain. B: all four.
  assert.deepEqual(plan.map((p) => `${p.title}:${p.body.split(' \u00b7 ')[0]}`), ['A:in 4 min', 'A:in 1 min', 'B:in 10 min', 'B:in 7 min', 'B:in 4 min', 'B:in 1 min']);
  assert.equal(plan.filter((p) => p.title === 'A').length, 2);
  assert.equal(plan.filter((p) => p.title === 'B').length, 4);
  assert.ok(plan.every((p, i) => i === 0 || plan[i - 1].at <= p.at), 'nearest first');
  assert.equal(new Set(plan.map((p) => p.id)).size, plan.length, 'ids are distinct');
  assert.equal(new Set(plan.filter((p) => p.title === 'B').map((p) => p.group)).size, 1, 'the repeats of one appointment share a group');
  assert.equal(plan.find((p) => p.title === 'B' && p.body.startsWith('in 10 min')).body, 'in 10 min \u00b7 10:00');
  assert.equal(plannedNotifications(list, NOW, 10, 3, 2).length, 2);
  assert.ok(plan.every((p) => Number.isInteger(p.id) && p.id > 0 && p.id < 2147483647));
  assert.equal(appointmentId('x'), appointmentId('x'));
});
