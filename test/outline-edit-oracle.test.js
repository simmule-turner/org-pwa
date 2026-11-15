// Holds the single-heading structure and editing commands to Emacs 29.3 (Org 9.6): test/fixtures/outline-edit-oracle.json was made by
// tools/gen-outline-edit-oracle.mjs (org-promote, org-demote, org-sort-entries, org-toggle-comment, org-insert-property-drawer,
// org-add-planning-info, org-set-property and org-paste-subtree). What differs and is kept is in test/support/outline-edit-known.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import { setTagsColumn } from '../src/tags-column.js';
import { setAdaptIndentation, setAutoAlignTags, setSrcPreserveIndentation } from '../src/indent-settings.js';
import { demoteHeadingOnly, insertPropertyDrawer, pasteSubtreeAfter, promoteHeadingOnly, toggleComment } from '../src/heading-edit.js';
import { setProperty } from '../src/archive-model.js';
import { setPlanningField } from '../src/reschedule.js';
import { sortEntries } from '../src/outline-sort.js';
import { readFunction } from '../src/table-sort-lisp.js';
import '../src/org-lisp.js';
import { known } from './support/outline-edit-known.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/outline-edit-oracle.json', import.meta.url), 'utf8'));
const flat = (doc) => {
  const out = [];
  (function walk(n) {
    for (const c of n.children || []) {
      out.push(c);
      walk(c);
    }
  })(doc);
  return out;
};

function ours(c) {
  setAdaptIndentation(c.adapt || 'nil');
  setAutoAlignTags(c.align !== false);
  setSrcPreserveIndentation(c.preserve === true);
  setTagsColumn(c.column ?? -77);
  const doc = parseOrg(c.org);
  const h = flat(doc)[c.index];
  const refuse = (message) => `ERROR ${message}\n${serializeOrg(doc)}`;
  try {
    switch (c.kind) {
      case 'level':
        if (!(c.op === 'promote' ? promoteHeadingOnly : demoteHeadingOnly)(doc, h)) return refuse('refused');
        break;
      case 'comment':
        toggleComment(h);
        break;
      case 'drawer':
        insertPropertyDrawer(doc, h);
        break;
      case 'setprop':
        setProperty(h, c.name, c.value);
        break;
      case 'planning':
        setPlanningField(h, c.what, '<2015-06-25 Thu>');
        break;
      case 'sort': {
        const keyFn = readFunction(c.fn, false).fn;
        sortEntries(doc, c.index < 0 ? (/^\*/.test(c.org) ? flat(doc)[0] : null) : h, c.type, { withCase: c.withCase, property: c.property, keyFn, compareFn: null, now: Date.now() / 1000, propertyOf: (x, name) => x.properties[name] ?? null });
        break;
      }
      case 'paste':
        if (h.children.length && c.folded) h.collapsed = true;
        if (!pasteSubtreeAfter(doc, h, c.tree, c.level ?? undefined, c.point !== 'bol', c.point === 'bol')) return refuse('refused');
        break;
    }
    return serializeOrg(doc);
  } catch (e) {
    return refuse(e.message);
  } finally {
    setAdaptIndentation('nil');
    setAutoAlignTags(true);
    setSrcPreserveIndentation(false);
    setTagsColumn(-77);
  }
}

const norm = (c, text) => (c.kind === 'paste' || c.kind === 'sort' || c.kind === 'drawer' || c.kind === 'setprop' || c.kind === 'planning' ? text.replace(/\n+$/, '') : text);
for (const kind of ['level', 'sort', 'comment', 'drawer', 'setprop', 'planning', 'paste']) {
  const cases = oracle.cases.filter((c) => c.kind === kind);
  test(`${kind} leaves what Emacs leaves (${cases.length} cases)`, () => {
    const wrong = [];
    for (const c of cases) {
      const want = c.emacs;
      const got = ours(c);
      const isError = want.startsWith('ERROR ');
      const same = isError ? got.startsWith('ERROR ') && norm(c, got.slice(got.indexOf('\n') + 1)) === norm(c, want.slice(want.indexOf('\n') + 1)) : norm(c, got) === norm(c, want);
      if (!same && !known(c, got, want)) wrong.push({ ...c, emacs: undefined, got, want });
    }
    assert.deepEqual(wrong.slice(0, 4), [], `${wrong.length} differ`);
  });
}
