// The sample files in examples/ must run: their js blocks are expanded with Noweb and run against fakes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseOrg } from '../src/org-parser.js';
import { collectDocumentBlocks } from '../src/babel-blocks.js';
import { expandNoweb } from '../src/noweb.js';
import { tangleDocument } from '../src/tangle.js';
import { checkCacheKey } from '../src/extension-net.js';
import { parseIcalendarEvents } from '../src/import-icalendar.js';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const load = (name) => {
  const doc = parseOrg(readFileSync(new URL('../examples/' + name, import.meta.url), 'utf8'));
  return { doc, blocks: collectDocumentBlocks(doc) };
};
const fakeOrg = (extra = {}) => ({
  vars: { get: (n) => ({ 'calendar-latitude': '40.71', 'calendar-longitude': '-74.01' })[n] ?? null },
  location: { get: async () => ({ lat: 51.5, lon: -0.12 }) },
  ics: { parse: async (t) => parseIcalendarEvents(t) },
  cache: { get: async (k) => (checkCacheKey(k), null), set: async (k, v) => (checkCacheKey(k), v) },
  fetch: async () => ({ ok: true, status: 200, text: async () => 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:Holiday\nDTSTART;VALUE=DATE:2099-01-01\nEND:VEVENT\nEND:VCALENDAR'.replace('2099-01-01', '20990101') }),
  ...extra,
});
const run = async ({ doc, blocks }, block) => {
  const vars = Object.fromEntries(block.args.var.map((v) => [v.split('=')[0], JSON.parse(v.slice(v.indexOf('=') + 1))]));
  const code = expandNoweb(doc, blocks, block);
  return new AsyncFunction('org', ...Object.keys(vars), code)(fakeOrg(), ...Object.values(vars));
};

for (const file of ['sunrise-sunset.org', 'calendar.org']) {
  test(`${file}: every table block runs and returns rows`, async () => {
    const f = load(file);
    let ran = 0;
    for (const b of f.blocks) {
      if (b.args.tangle !== 'no' || /\bnone\b/.test(b.args.results)) continue;
      const rows = await run(f, b);
      assert.ok(Array.isArray(rows) && rows.length > 0 && rows.every(Array.isArray), `${file} block ${b.counter} under "${b.heading && b.heading.title}"`);
      ran++;
    }
    assert.ok(ran >= 3);
  });

  test(`${file}: the init script tangles and starts`, () => {
    const f = load(file);
    const out = tangleDocument(f.doc, { documentName: file });
    const init = out.files.find((x) => x.path === 'init.js');
    assert.ok(init, 'tangles to init.js');
    assert.doesNotMatch(init.text, /<<.*>>/);
    const registered = [];
    const org = { vars: fakeOrg().vars, ui: { line: (id, fn) => registered.push([id, fn]) }, agenda: { source: (id, fn) => registered.push([id, fn]) }, cache: fakeOrg().cache, fetch: fakeOrg().fetch, ics: fakeOrg().ics };
    new Function('org', init.text)(org);
    assert.equal(registered.length, 1);
  });
}

test('sunrise-sunset.org: New York sunrise on a fixed day is plausible', async () => {
  const f = load('sunrise-sunset.org');
  const block = f.blocks.find((b) => b.heading && b.heading.title.startsWith('Today, at the place'));
  class Fixed extends Date {
    constructor(...a) { super(...(a.length ? a : [Date.UTC(2026, 9, 10, 16)])); }
    toLocaleTimeString() { return this.toISOString().slice(11, 16); }
  }
  const code = expandNoweb(f.doc, f.blocks, block);
  const rows = await new AsyncFunction('org', 'Date', code)(fakeOrg(), Fixed);
  assert.equal(rows[0][0], 'Sunrise');
  assert.match(rows[0][1], /^1[0-2]:\d\d$/); // about 11:15 UTC in New York in October
});
