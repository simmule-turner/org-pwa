// The worked examples in docs/extensions-design.org must run, and give the same answers as the app's own forms.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeSunriseSunsetUtc } from '../src/diary-sexp.js';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const design = readFileSync(new URL('../docs/extensions-design.org', import.meta.url), 'utf8');

/** The body of the first `,#+BEGIN_SRC js` block under the heading that starts with `heading`. */
function exampleCode(heading) {
  const start = design.indexOf('** ' + heading);
  assert.ok(start >= 0, `example "${heading}" is in the design note`);
  const lines = design.slice(start).split('\n');
  const from = lines.findIndex((l) => l.startsWith(',#+BEGIN_SRC js'));
  const to = lines.findIndex((l, i) => i > from && l.startsWith(',#+END_SRC'));
  return lines.slice(from + 1, to).join('\n');
}

const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const hoursToMinutes = (h) => Math.round(h * 60) % 1440;
const apart = (a, b) => Math.min(Math.abs(a - b), 1440 - Math.abs(a - b));

test('the sunrise example agrees with the built-in diary-sunrise and diary-sunset', async () => {
  const code = exampleCode('Example: sunrise and sunset');
  const places = [
    { name: 'New York', lat: 40.71, lon: -74.01, day: '2026-10-10' },
    { name: 'London', lat: 51.5, lon: -0.12, day: '2026-06-21' },
    { name: 'Sydney', lat: -33.87, lon: 151.21, day: '2026-12-21' },
    { name: 'Tokyo', lat: 35.68, lon: 139.69, day: '2026-03-20' },
  ];
  for (const { name, lat, lon, day } of places) {
    const noon = new Date(day + 'T12:00:00Z');
    // `new Date()` is the fixed day, and times print in UTC so the answer does not depend on the machine's zone.
    class FixedDate extends Date {
      constructor(...args) {
        super(...(args.length ? args : [noon.getTime()]));
      }
      toLocaleTimeString() {
        return this.toISOString().slice(11, 16);
      }
    }
    const org = { apiVersion: 1, vars: { get: (n) => ({ 'calendar-latitude': String(lat), 'calendar-longitude': String(lon) })[n] ?? null } };
    const rows = await new AsyncFunction('org', 'Date', code)(org, FixedDate);
    const expected = computeSunriseSunsetUtc(noon, lat, lon);
    assert.equal(rows[0][0], 'Sunrise');
    assert.ok(apart(minutesOf(rows[0][1]), hoursToMinutes(expected.sunrise)) <= 2, `${name} sunrise: ${rows[0][1]} vs ${expected.sunrise}`);
    assert.ok(apart(minutesOf(rows[1][1]), hoursToMinutes(expected.sunset)) <= 2, `${name} sunset: ${rows[1][1]} vs ${expected.sunset}`);
  }
});

test('the sunrise example says so when the sun does not rise', async () => {
  const code = exampleCode('Example: sunrise and sunset');
  const org = { vars: { get: (n) => ({ 'calendar-latitude': '78.22', 'calendar-longitude': '15.65' })[n] } };
  class WinterDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [Date.UTC(2026, 11, 21, 12)]));
    }
  }
  assert.deepEqual(await new AsyncFunction('org', 'Date', code)(org, WinterDate), [['Sun', 'does not rise or set today']]);
});

test('the weather example builds its list from a forecast', async () => {
  const code = exampleCode('Example: weather');
  const store = new Map();
  const org = {
    vars: { get: () => 'imperial' },
    cache: { get: async (k) => (store.has(k) ? store.get(k) : null), set: async (k, v) => (store.set(k, v), v) },
    location: { get: async () => ({ lat: 40.7, lon: -74 }) },
    fetch: async (url) => {
      assert.match(url, /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?latitude=40\.7&longitude=-74/);
      assert.match(url, /temperature_unit=fahrenheit/);
      return { json: async () => ({ daily: { time: ['2026-10-10', '2026-10-11'], temperature_2m_min: [50, 52], temperature_2m_max: [68, 70], precipitation_probability_max: [10, 40] } }) };
    },
  };
  const out = await new AsyncFunction('org', code)(org);
  assert.deepEqual(out, ['2026-10-10: 50–68°, 10% rain', '2026-10-11: 52–70°, 40% rain']);
  assert.deepEqual(store.get('pos'), { lat: 40.7, lon: -74 });
});

test('the calendar feed example registers an agenda source that parses the fetched feed', async () => {
  const code = exampleCode('Example: calendar feed');
  const sources = new Map();
  const lines = new Map();
  const store = new Map();
  const org = {
    agenda: { source: (n, f) => sources.set(n, f) },
    ui: { line: (n, f) => lines.set(n, f) },
    cache: { get: async (k) => (store.has(k) ? store.get(k) : null), set: async (k, v) => (store.set(k, v), v) },
    fetch: async () => ({ text: async () => 'FEED' }),
    ics: { parse: async (t) => [{ summary: t, start: '2026-12-25' }] },
  };
  await new AsyncFunction('org', code)(org);
  assert.deepEqual(await sources.get('holidays')({ from: '2026-12-01', to: '2026-12-31' }), [{ summary: 'FEED', start: '2026-12-25' }]);
  assert.equal(store.get('holidays-ics'), 'FEED');
  assert.equal(typeof lines.get('mood')(), 'string');
});
