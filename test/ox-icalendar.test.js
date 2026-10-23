import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg } from '../src/org-parser.js';
import { exportOrgIcalendar } from '../src/ox-icalendar.js';

// Real Emacs (org-icalendar-export-to-ics, TZ=America/New_York) is the reference: tools/gen-icalendar-oracle.mjs wrote the files.
const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/icalendar-oracle.json', import.meta.url), 'utf8'));

/** The parts that differ by design: when it was written, and the ids that Emacs makes up at random. */
const normalize = (/** @type {string} */ ics) =>
  ics
    .replace(/\r\n /g, '').replace(/\r\n/g, '\n')
    .replace(/^DTSTAMP:.*$/gm, 'DTSTAMP:X')
    .replace(/^UID:((?:TODO-)?(?:TS\d+-|DL-|SC-)?)(?!myid).*$/gm, 'UID:$1*');

for (const [i, c] of oracle.entries()) {
  test(`calendar export matches Emacs: case ${i} (${JSON.stringify(c.org.slice(0, 45))}${c.lisp ? ' ' + c.lisp.slice(0, 50) : ''})`, () => {
    const doc = parseOrg(c.org);
    const scope = c.subtree ? doc.children[0].children[0] : null;
    const ics = exportOrgIcalendar([{ documentId: `cal${i}.org`, doc, name: `cal${i}.org` }], {
      scope,
      stamp: new Date(Date.UTC(2026, 9, 22, 12, 0, 0)),
      settings: { timezone: 'America/New_York', ...c.js },
    });
    assert.equal(normalize(ics), normalize(c.emacs));
  });
}
