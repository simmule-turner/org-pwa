import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import { collectAgendaCalendarEvents, agendaWindow } from '../src/calendar-from-agenda.js';
import { setUserSexps } from '../src/sexp-eval.js';

const today = new Date(2026, 9, 14, 11, 0);
const window = agendaWindow(today, 0, 1);
const summaries = (events) => events.map((e) => (e.lines.find((l) => l.startsWith('SUMMARY:')) || '').replace(/^SUMMARY:/, '').replace(/\r$/, ''));
const descriptions = (events) => events.map((e) => (e.lines.find((l) => l.startsWith('DESCRIPTION:')) || '').replace(/^DESCRIPTION:/, '').replace(/\r$/, ''));
const WEATHER = { currentTime: '2026-10-14T10:45', weatherCode: 1, humidity: 50, humidityUnit: '%', pressure: 1010, pressureUnit: 'hPa', temperatureCurrent: 70, temperatureMin: 60, temperatureMax: 75, apparentTemperatureMin: 60, apparentTemperatureMax: 75, windSpeed: 5 };

test('a <%%(org-weather)> line becomes one event, today only, saying how fresh the forecast is', () => {
  const doc = parseOrg('* <%%(when (today-p)(org-weather))>\n');
  const events = collectAgendaCalendarEvents([{ documentId: 'a.org', doc }], {
    today,
    window,
    agendaOptions: { weatherData: WEATHER, orgWeatherFormat: '%desc %tcur%tu', orgWeatherTemperatureUnit: '°F', orgWeatherSpeedUnit: 'mph' },
  });
  assert.equal(events.length, 1);
  assert.match(summaries(events)[0], /Mainly clear 70°F/);
  assert.equal(descriptions(events)[0], 'Weather as of 2026-10-14 10:45');
});

test('with no forecast fetched yet there is no weather event', () => {
  const doc = parseOrg('* <%%(when (today-p)(org-weather))>\n');
  assert.equal(collectAgendaCalendarEvents([{ documentId: 'a.org', doc }], { today, window, agendaOptions: {} }).length, 0);
});

test('a sun-times line uses the coordinates it is given', () => {
  const doc = parseOrg(`* <%%(when (today-p) (format "Sun: %s" (apply 'solar-time-string (car (solar-sunrise-sunset date)))))>\n`);
  const at = (lat, lon) => summaries(collectAgendaCalendarEvents([{ documentId: 'a.org', doc }], { today, window, agendaOptions: { calendarLatitude: lat, calendarLongitude: lon } }))[0];
  assert.notEqual(at(35.994, -78.8986), at(60, 10));
});

test('a script-defined %%(…) function in a <%%(…)> line is exported like a built-in one', () => {
  setUserSexps(['my-quote'], () => 'carpe diem');
  try {
    const doc = parseOrg('* <%%(when (today-p) (my-quote))>\n');
    const events = collectAgendaCalendarEvents([{ documentId: 'a.org', doc }], { today, window });
    assert.deepEqual(summaries(events), ['carpe diem']);
  } finally {
    setUserSexps();
  }
});

import { exportToIcalendar } from '../src/export-icalendar.js';

test('the file export puts an alarm on timed events when org-icalendar-alarm-time is set, as Emacs does; all-day ones and 0 get none', () => {
  const doc = parseOrg('* Dentist <2026-10-15 Thu 09:30>\n* Pay rent <2026-10-16 Fri>\n* Lunch <2026-10-17 Sat 12:00>\n');
  const ics = (alarmTime) => exportToIcalendar([{ documentId: 'a.org', doc }], { today, settings: { alarmTime } });
  assert.equal((ics(0).match(/BEGIN:VALARM/g) || []).length, 0);
  const ten = ics(10);
  assert.equal((ten.match(/TRIGGER:-P0DT0H10M0S/g) || []).length, 2); // the 09:30 and the 12:00 events; the all-day one gets none
  assert.match(ten, /BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Dentist <2026-10-15 Thu 09:30>\r\nTRIGGER:-P0DT0H10M0S\r\nEND:VALARM/);
});

test('the same alarm reaches the agenda-based export and sync', () => {
  const doc = parseOrg('* TODO Dentist\nSCHEDULED: <2026-10-15 Thu 09:30>\n');
  const events = collectAgendaCalendarEvents([{ documentId: 'a.org', doc }], { today, window: agendaWindow(today, 0, 5), alarmMinutes: 15 });
  assert.equal(events.length, 1);
  assert.ok(events[0].lines.some((l) => l.startsWith('TRIGGER:-PT15M')));
});

import { buildCalendarResources } from '../src/calendar-mirror.js';

test('the CalDAV payload carries the VALARM', () => {
  const doc = parseOrg('* TODO Dentist\nSCHEDULED: <2026-10-15 Thu 09:30>\n');
  const out = [...buildCalendarResources([{ documentId: 'a.org', doc }], { today, alarmMinutes: 12 }).values()].map((r) => r.ics).join('');
  assert.ok(out.includes('BEGIN:VALARM') && out.includes('ACTION:DISPLAY') && out.includes('TRIGGER:-PT12M'));
});
