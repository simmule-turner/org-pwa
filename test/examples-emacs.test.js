// examples/clock-tables.org and examples/cookies.org hold what Emacs 29.3 left after org-update-all-dblocks and
// org-update-statistics-cookies; the app must give the same text from the same file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import { updateAllStatisticsCookies } from '../src/checkbox-cookie.js';
import { computeClocktable, renderClocktable } from '../src/clocktable.js';

const read = (name) => readFileSync(new URL('../examples/' + name, import.meta.url), 'utf8');

test('cookies.org is unchanged by updating every cookie', () => {
  const text = read('cookies.org');
  const doc = parseOrg(text);
  updateAllStatisticsCookies(doc, ['DONE', 'CANCELED']);
  assert.equal(serializeOrg(doc), text);
});

test('every clock table in clock-tables.org is what the app writes', () => {
  const text = read('clock-tables.org');
  const doc = parseOrg(text);
  const lines = text.split('\n');
  let checked = 0;
  lines.forEach((line, i) => {
    const m = /^#\+BEGIN: clocktable (.*)$/.exec(line);
    if (!m) return;
    const params = m[1];
    const maxlevel = Number(/:maxlevel (\d+)/.exec(params)?.[1] ?? 2);
    const tstart = /:tstart "([^"]*)"/.exec(params)?.[1];
    const tend = /:tend "([^"]*)"/.exec(params)?.[1];
    const end = lines.indexOf('#+END:', i);
    const emacs = lines.slice(i, end + 1).join('\n').replace(/Clock summary at \[[^\]]*\]/, 'Clock summary at [X]');
    const ours = renderClocktable(computeClocktable(doc, tstart, tend, maxlevel), tstart, tend, new Date(2000, 0, 1), maxlevel).replace(/Clock summary at \[[^\]]*\]/, 'Clock summary at [X]');
    assert.equal(ours.trimEnd(), emacs.trimEnd());
    checked++;
  });
  assert.equal(checked, 2);
});

test('icalendar.ics is what the app exports from icalendar.org', async () => {
  const { exportOrgIcalendar } = await import('../src/ox-icalendar.js');
  const normalize = (ics) => ics.replace(/\r\n /g, '').replace(/\r\n/g, '\n').replace(/^DTSTAMP:.*$/gm, 'DTSTAMP:X').replace(/^PRODID:.*$/m, 'PRODID:X');
  const ics = exportOrgIcalendar([{ documentId: 'icalendar.org', doc: parseOrg(read('icalendar.org')), name: 'icalendar.org' }], {
    stamp: new Date(Date.UTC(2026, 9, 22, 12, 0, 0)),
    settings: { timezone: 'America/New_York' },
  });
  assert.equal(normalize(ics), normalize(read('icalendar.ics')));
});

test('every query in match-queries.org finds the headings Emacs found', async () => {
  const { searchDocumentsByMatchQuery } = await import('../src/search.js');
  const text = read('match-queries.org');
  const doc = parseOrg(text);
  let checked = 0;
  for (const m of text.matchAll(/^- =(.+?)= :: (.*)$/gm)) {
    const found = searchDocumentsByMatchQuery([{ documentId: 'match-queries.org', doc }], m[1], { doneKeywords: ['DONE'], now: new Date(2026, 9, 22) }).map((r) => r.heading.title);
    assert.equal(found.join('; ') || '(none)', m[2], `query ${m[1]}`);
    checked++;
  }
  assert.ok(checked >= 25);
});
