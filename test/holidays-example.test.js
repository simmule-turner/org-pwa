import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { listHolidays, setHolidayZone, setHolidayConfig } from '../src/holidays.js';
import { ENTRIES } from '../tools/holidays-entries.mjs';

// examples/holidays.org shows what Emacs 29.3 lists for each Lisp init text in it (tools/gen-holidays-example.mjs). The app, given the
// same text, must list the same, and the file must show it.
const cases = JSON.parse(fs.readFileSync(new URL('./fixtures/holidays-example.json', import.meta.url), 'utf8'));
const org = fs.readFileSync(new URL('../examples/holidays.org', import.meta.url), 'utf8');
const ALL = '(setq calendar-christian-all-holidays-flag t calendar-hebrew-all-holidays-flag t calendar-islamic-all-holidays-flag t calendar-bahai-all-holidays-flag t calendar-chinese-all-holidays-flag t)';

/** @param {string} init @param {number} from @param {number} to */
function listed(init, from, to) {
  setHolidayZone('America/New_York');
  setHolidayConfig(init);
  try {
    return listHolidays(from, to).split('\n').filter(Boolean);
  } finally {
    setHolidayZone(null);
    setHolidayConfig('');
  }
}
const dateOf = (/** @type {string} */ line) => new Date(line.slice(line.indexOf(',') + 2, line.indexOf(':'))).getTime();
/** @param {string[]} base @param {string[]} list */
function diff(base, list) {
  const inBase = new Set(base);
  const inList = new Set(list);
  /** @type {[string, string][]} */
  const out = [...list.filter((l) => !inBase.has(l)).map((l) => /** @type {[string, string]} */ (['+', l])), ...base.filter((l) => !inList.has(l)).map((l) => /** @type {[string, string]} */ (['-', l]))];
  out.sort((a, b) => dateOf(a[1]) - dateOf(b[1]) || (a[0] === '-' ? -1 : 1));
  return out.map(([sign, l]) => `${sign} ${l}`);
}

const base = listed('', 2026, 2026);
for (const c of cases) {
  test(`holidays.org: ${c.id} lists what Emacs lists`, () => {
    const lines = listed(c.init, c.from, c.to);
    const shown = c.mode === 'full' ? lines : diff(base, lines);
    assert.equal(shown.join('\n') + '\n', c.expected);
    if (c.init) assert.ok(org.includes(c.init), 'the file shows the Lisp');
    assert.ok(org.includes(`#+begin_example\n${c.expected || '(no change)\n'}#+end_example`), 'the file shows the result');
  });
}

test('holidays.org has a row for every holiday the app can list, and none for a holiday it cannot', () => {
  const known = new Set(ENTRIES.flatMap((e) => e.names));
  const normalize = (/** @type {string} */ text) => text.replace(/ \d{1,2}:\d{2}[ap]m \([A-Z]+\)$/, '').replace(/^(Rosh HaShanah|Islamic New Year) \d+$/, '$1').replace(/^Bahá’í New Year \(Naw-Ruz\) \d+$/, 'Bahá’í New Year (Naw-Ruz)').replace(/^Chinese New Year \(.*\)$/, 'Chinese New Year');
  const seen = new Set();
  for (const init of [ALL, '']) for (const l of listed(init, 1990, 2060)) seen.add(normalize(l.slice(l.indexOf(': ') + 2)));
  assert.deepEqual([...seen].filter((n) => !known.has(n)), []);
  assert.deepEqual([...known].filter((n) => !seen.has(n)), []);
});

test('every row of the table links to a description', () => {
  for (const e of ENTRIES) assert.ok(org.includes(`[[https://en.wikipedia.org/wiki/${e.wiki}]`), e.label);
});
