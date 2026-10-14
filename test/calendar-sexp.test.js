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
  const doc = parseOrg('* <%%(when (today-p) (format "Sun: %s" (diary-sunrise)))>\n');
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
