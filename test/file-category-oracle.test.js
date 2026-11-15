import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg } from '../src/org-parser.js';
import { Reader } from '../src/elisp-read.js';
import { evalForm, resetRun } from '../src/elisp-core.js';
import { withHeading } from '../src/org-lisp.js';
import { buildArchivedClone } from '../src/archive-model.js';
import { buildClockReport } from '../src/clock-report.js';
import { columnviewRows, columnviewTableLines, readColumnviewParams } from '../src/org-columns.js';
import { exportOrgIcalendar } from '../src/ox-icalendar.js';
import { CLOCK_PARAMS, COLUMNS_FORMAT, clockText } from '../tools/gen-file-category-oracle.mjs';

// Emacs 29.3 (tools/gen-file-category-oracle.mjs): the category of each heading of the category documents of tools/oracle-agenda-cases.mjs
// in a file named after the document: org-get-category, org-entry-get, org-archive-subtree, a clock table, a column view and an iCalendar export.
const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/file-category-oracle.json', import.meta.url), 'utf8'));
const walk = (/** @type {any[]} */ nodes) => nodes.flatMap((h) => [h, ...walk(h.children || [])]);

test('org-get-category and org-entry-get answer the category Emacs does', () => {
  const bad = [];
  for (const c of oracle) {
    const doc = parseOrg(c.text);
    const hs = walk(doc.children);
    hs.forEach((heading, i) => {
      for (const [form, want] of [['(org-get-category)', c.headings[i][0]], ['(org-entry-get nil "CATEGORY")', c.headings[i][1]]]) {
        resetRun({ budget: 100000 });
        const got = withHeading({ doc, heading, category: c.name }, () => evalForm(new Reader(form).read(), null));
        if (String(got) !== want) bad.push({ doc: c.name, heading: i, form, got: String(got), want });
      }
    });
    assert.equal(hs.length, c.headings.length, c.name);
  }
  assert.deepEqual(bad, []);
});

test('an archived entry gets the ARCHIVE_CATEGORY Emacs gives it', () => {
  const bad = [];
  for (const c of oracle) {
    const doc = parseOrg(c.text);
    walk(doc.children).forEach((heading, i) => {
      const got = buildArchivedClone(doc, heading, `${c.name}.org`, { now: new Date(2026, 9, 11, 16, 30) }).properties.ARCHIVE_CATEGORY ?? 'nil';
      if (got !== c.archive[i]) bad.push({ doc: c.name, heading: i, got, want: c.archive[i] });
    });
  }
  assert.deepEqual(bad, []);
});

test('the CATEGORY column of a clock table is what Emacs writes', () => {
  const bad = [];
  for (const c of oracle) {
    const doc = parseOrg(clockText(c.text));
    const got = buildClockReport({ files: [{ name: `${c.name}.org`, doc }], params: CLOCK_PARAMS, now: new Date(2026, 9, 11, 16, 30) }).replace(/Clock summary at \[[^\]]*\]/, 'Clock summary at [X]').trimEnd();
    if (got !== c.clock) bad.push({ doc: c.name, got, want: c.clock });
  }
  assert.deepEqual(bad, []);
});

test('the CATEGORY column of a column view is what Emacs writes', () => {
  const bad = [];
  for (const c of oracle) {
    const doc = parseOrg(c.text);
    const { rows } = columnviewRows(doc, null, readColumnviewParams(`:id global :format "${COLUMNS_FORMAT}"`), { category: c.name, file: `${c.name}.org` });
    const got = columnviewTableLines(rows).join('\n');
    const want = c.columns.split('\n').slice(1).filter((l) => l.startsWith('|')).join('\n');
    if (got !== want) bad.push({ doc: c.name, got, want });
  }
  assert.deepEqual(bad, []);
});

test('the iCalendar export gives the CATEGORIES Emacs gives', () => {
  const bad = [];
  for (const c of oracle) {
    const ics = exportOrgIcalendar([{ documentId: `${c.name}.org`, doc: parseOrg(c.text), name: `${c.name}.org` }], {
      stamp: new Date(Date.UTC(2026, 9, 22, 12, 0, 0)),
      settings: { timezone: 'America/New_York', useScheduled: ['event-if-todo-not-done', 'event-if-not-todo'] },
    });
    const got = [...ics.matchAll(/^CATEGORIES:(.*)\r?$/gm)].map((m) => m[1]);
    const want = c.ical.map((/** @type {string} */ l) => l.replace(/\r$/, ''));
    if (JSON.stringify(got) !== JSON.stringify(want)) bad.push({ doc: c.name, got, want });
  }
  assert.deepEqual(bad, []);
});
