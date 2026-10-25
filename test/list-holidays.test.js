import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { listHolidays, setHolidayZone, setHolidayConfig } from '../src/holidays.js';

// Emacs 29.3's list-holidays for these year ranges (tools/gen-list-holidays-oracle.mjs).
const cases = JSON.parse(fs.readFileSync(new URL('./fixtures/list-holidays.json', import.meta.url), 'utf8'));

for (const c of cases) {
  test(`list-holidays ${c.from}-${c.to}${c.init ? ' with ' + c.init.slice(0, 40) : ''} lists what Emacs lists`, () => {
    setHolidayZone('America/New_York');
    setHolidayConfig(c.init || '');
    try {
      assert.equal(listHolidays(c.from, c.to), c.text);
    } finally {
      setHolidayZone(null);
      setHolidayConfig('');
    }
  });
}
