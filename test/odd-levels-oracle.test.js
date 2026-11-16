// @ts-check
// Promoting, demoting and adding a subheading under org-odd-levels-only give the stars Emacs 29.3 (Org 9.6.15) gives;
// the fixture is made by tools/gen-odd-levels-oracle.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { demoteHeading, insertChildHeading, promoteHeading } from '../src/heading-edit.js';
import { hideLeadingStars, oddLevelsOnly, starsText, validLevel } from '../src/levels.js';
import { parseOrg, serializeOrg } from '../src/org-parser.js';

const cases = JSON.parse(fs.readFileSync(new URL('./fixtures/odd-levels-oracle.json', import.meta.url), 'utf8'));
const starsOf = (/** @type {string} */ text) => text.split('\n').filter((l) => /^\*+ /.test(l)).map((l) => /^\*+/.exec(l)?.[0].length ?? 0);

test('odd levels: promote, demote and add a subheading as Emacs does', () => {
  let refused = 0;
  for (const c of cases) {
    const doc = parseOrg(['#+STARTUP: odd', ...c.levels.map((/** @type {string} */ s) => `${s} h`)].join('\n') + '\n');
    assert.equal(oddLevelsOnly(doc), true);
    const flat = [];
    const walk = (/** @type {any[]} */ list) => list.forEach((h) => (flat.push(h), walk(h.children)));
    walk(doc.children);
    const heading = flat[c.at];
    let got;
    if (c.op === 'subheading') {
      insertChildHeading(heading, { title: 'new', level: validLevel(heading.level, 1, true) });
      got = starsOf(serializeOrg(doc)).sort((a, b) => a - b);
      assert.deepEqual(got, [...c.result].sort((/** @type {number} */ a, /** @type {number} */ b) => a - b), JSON.stringify(c));
      continue;
    }
    const ok = (c.op === 'promote' ? promoteHeading : demoteHeading)(doc, heading);
    if (typeof c.result === 'string') {
      refused++;
      assert.equal(ok, false, JSON.stringify(c));
    } else {
      assert.equal(ok, true, JSON.stringify(c));
      assert.deepEqual(starsOf(serializeOrg(doc)), c.result, JSON.stringify(c));
    }
  }
  assert.ok(refused >= 4 && cases.length >= 70);
});

test('the stars drawn: blank leading stars with hidestars; odd and hidestars come from #+STARTUP', () => {
  assert.equal(starsText(3, true), '  *');
  assert.equal(starsText(3, false), '***');
  assert.equal(hideLeadingStars(parseOrg('#+STARTUP: hidestars\n* a\n')), true);
  assert.equal(hideLeadingStars(parseOrg('#+STARTUP: hidestars showstars\n* a\n')), false);
  assert.equal(oddLevelsOnly(parseOrg('#+STARTUP: odd oddeven\n* a\n')), false);
});
