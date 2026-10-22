import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { emacsSunriseSunset } from '../src/solar-emacs.js';
import { solarDaylight } from '../src/diary-sexp.js';

// Emacs 29.3's solar-sunrise-sunset for five places, every third day of five years (tools/gen-solar-oracle.mjs), in standard time.
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/calendar/solar.json', import.meta.url), 'utf8'));

test('sunrise, sunset and daylight match Emacs for every sampled day', () => {
  /** @type {Record<string, any>} */
  const places = Object.fromEntries(fixture.places.map((/** @type {any} */ p) => [p.name, p]));
  const bad = [];
  /** @param {number | null} h */
  const shown = (h) => (h === null || h < 0 || h >= 24 ? null : Math.round(60 * h) / 60);
  for (const [name, year, month, day, rise, set, daylight] of fixture.rows) {
    const p = places[name];
    const r = emacsSunriseSunset(month, day, year, p.lat, p.lon, p.zone);
    const got = [shown(r.rise), shown(r.set), solarDaylight(r.length)];
    const same = (/** @type {number | null} */ a, /** @type {number | null} */ b) => (a === null || b === null ? a === b : Math.abs(a - b) < 1e-6);
    if (!same(got[0], rise) || !same(got[1], set) || got[2] !== daylight) bad.push(`${name} ${year}-${month}-${day} app ${got} emacs ${rise},${set},${daylight}`);
  }
  assert.deepEqual(bad.slice(0, 10), []);
});
