// Holds lists, checkbox cookies and footnotes to Emacs 29.3 over a wide corpus: test/fixtures/oracle-lists.json was made by
// tools/gen-oracle-lists.mjs from tools/oracle-lists-cases.mjs. Each case is a text and the text Emacs leaves after a command:
// toggling a box (C-c C-c), M-RET, M-S-RET, deleting an item with its sub-items (then org-list-repair), org-list-repair, the
// cookie update of the whole buffer and the org-footnote commands. A case the app does not match yet is named in KNOWN with
// the reason, and fails once it starts to match, so the list only shrinks.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import { deleteListItem, insertListItem, listItemAtLine } from '../src/body-edit.js';
import { updateAllStatisticsCookies, updateCheckboxCookie } from '../src/checkbox-cookie.js';
import { isItemLine, repairList } from '../src/list-edit.js';
import { setTagsColumn, withTags } from '../src/tags-column.js';
import { parseBody } from '../src/body-parser.js';
import { cycleItemCheckbox } from '../src/outline-view-model.js';
import { deleteFootnote, insertFootnote, normalizeFootnotes, renumberFootnotes, sortFootnotes } from '../src/footnotes.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/oracle-lists.json', import.meta.url), 'utf8'));

/** The text the app leaves for a list case: the document or heading that holds the line owns it, in its body or its drawer. */
function ours(c) {
  const doc = parseOrg(c.org);
  const owners = [doc];
  const walkHeadings = (/** @type {any} */ h) => { for (const k of h.children || []) { owners.push(k); walkHeadings(k); } };
  walkHeadings(doc);
  /** @type {any} */ let owner = null;
  /** @type {any} */ let item = null;
  for (const ow of owners) {
    for (const key of /** @type {const} */ (['bodyLines', 'logbookLines', 'preLogLines'])) {
      const lines = ow[key] || [];
      for (let i = 0; i < lines.length && !item; i++) {
        if (!isItemLine(lines[i])) continue;
        const saved = lines[i];
        lines[i] = '\u0001' + saved;
        const at = serializeOrg(doc).split('\n').findIndex((l) => l.includes('\u0001'));
        lines[i] = saved;
        if (at === c.line) { owner = ow; item = listItemAtLine(ow, i, key); }
      }
      if (item) break;
    }
    if (item) break;
  }
  if (!item) return 'NO ITEM';
  if (c.op === 'toggle') {
    cycleItemCheckbox(owner, item);
    if (owner !== doc) updateCheckboxCookie(owner);
  } else if (c.op === 'insert-after') insertListItem(owner, item);
  else if (c.op === 'insert-todo') insertListItem(owner, item, '', true);
  else if (c.op === 'cut') deleteListItem(owner, item);
  else {
    const key = item.linesKey || 'bodyLines';
    owner[key] = repairList(owner[key], item.lineIndex);
    if (key === 'bodyLines') owner.body = parseBody(owner.bodyLines);
  }
  return serializeOrg(doc).replace(/\u0001/g, '');
}

/** Lists the app does not read as Emacs does, or where Emacs itself misbehaves: `[list, op or null, reason]`. */
const KNOWN_LISTS = [
  ['oddIndent', 'insert-todo', 'chosen: app behavior (Emacs signals "wholenump, -1" on this ill-indented list)'],
  ['nestedDeepMixed', 'insert-todo', 'chosen: app behavior (Emacs corrupts the first line, "[-]-] a", on this input)'],
  ['checkAlone', 'toggle', 'chosen: app behavior (Emacs leaves "- [X]" with nothing after it as it is when toggled)'],
];
/** @param {any} c */
const knownList = (c) => KNOWN_LISTS.find(([list, op]) => list === c.list && (op === null || op === c.op)) ?? null;

test('list edits leave the text Emacs leaves', () => {
  const wrong = [];
  /** @type {Map<any, number>} how many cases of each KNOWN entry the app still gets wrong */
  const stillWrong = new Map();
  for (const c of oracle.lists) {
    let got;
    try {
      got = ours(c);
    } catch (e) {
      got = 'THROW ' + /** @type {Error} */ (e).message;
    }
    const want = String(c.emacs);
    const ok = want.startsWith('ERROR') ? got.startsWith('THROW') : got.trimEnd() === want.trimEnd();
    const known = knownList(c);
    if (!ok && !known) wrong.push({ list: c.list, line: c.line, op: c.op, org: c.org, want, got });
    if (known && !ok) stillWrong.set(known, (stillWrong.get(known) ?? 0) + 1);
  }
  const stale = KNOWN_LISTS.filter((k) => !stillWrong.has(k)).map((k) => k[0] + ' ' + k[1]);
  assert.equal(wrong.length, 0, `${wrong.length} differ, first: ${JSON.stringify(wrong[0], null, 1)}`);
  assert.equal(stale.length, 0, `now matching, remove from KNOWN_LISTS: ${JSON.stringify(stale.slice(0, 3))}`);
});

test('updating all statistics cookies leaves the text Emacs leaves', () => {
  const wrong = [];
  setTagsColumn(-77); // Emacs's own org-tags-column; the app's default is 0
  for (const c of oracle.cookies) {
    let got;
    try {
      const doc = parseOrg(c.org);
      updateAllStatisticsCookies(doc, ['DONE', 'CANCELED']);
      got = serializeOrg(doc);
    } catch (e) {
      got = 'THROW ' + /** @type {Error} */ (e).message;
    }
    const ok = got === c.emacs;
    if (!ok) wrong.push({ org: c.org, want: c.emacs, got });
  }
  setTagsColumn(0);
  assert.equal(wrong.length, 0, `${wrong.length} differ, first: ${JSON.stringify(wrong[0], null, 1)}`);
});

/** @param {any} c */
function footnote(c) {
  switch (c.op) {
    case 'normalize': return normalizeFootnotes(c.text, { section: c.section });
    case 'renumber': return renumberFootnotes(c.text).text;
    case 'sort': return sortFootnotes(c.text, { section: c.section });
    case 'delete': return deleteFootnote(c.text, c.label, { autoAdjust: c.autoAdjust }).text;
    default: {
      const r = insertFootnote(c.text, c.pos, c.label === '' ? null : c.label, { section: c.section, defineInline: c.defineInline, autoAdjust: c.autoAdjust });
      return r ? r.text : 'ERROR';
    }
  }
}
test('footnote commands leave the text Emacs leaves', () => {
  const wrong = [];
  for (const c of oracle.footnotes) {
    let got;
    try {
      got = footnote(c);
    } catch (e) {
      got = 'ERROR ' + /** @type {Error} */ (e).message;
    }
    const ok = c.emacs.startsWith('ERROR') ? got.startsWith('ERROR') : got === c.emacs;
    if (!ok) wrong.push({ op: c.op, text: c.text, label: c.label, pos: c.pos, section: c.section, want: c.emacs, got });
  }
  assert.equal(wrong.length, 0, `${wrong.length} differ, first: ${JSON.stringify(wrong[0], null, 1)}`);
});

test('a heading line is written with its tags where org-tags-column puts them (org-align-tags)', () => {
  const wrong = [];
  for (const c of oracle.tags) {
    const m = /^(.*?)[ \t]+(:[^\s]+:)$/.exec(c.head);
    const head = m ? m[1] : c.head;
    const tags = m ? m[2] : '';
    const got = withTags(head, tags, c.col);
    if (got !== c.emacs) wrong.push({ col: c.col, head: c.head, want: c.emacs, got });
  }
  assert.equal(wrong.length, 0, `${wrong.length} differ, first: ${JSON.stringify(wrong[0])}`);
});

test('a heading that is rewritten keeps its blanks after the last word and its tags go to org-tags-column; one that is not stays as read', () => {
  const doc = parseOrg('* H [1/2] \n- [X] a\n* T :tag:\n* U :tag:\n');
  doc.children[1].title = 'T2';
  setTagsColumn(-20);
  try {
    doc.children[0].title = 'H [2/2]';
    assert.equal(serializeOrg(doc), '* H [2/2] \n- [X] a\n* T2           :tag:\n* U :tag:\n');
  } finally {
    setTagsColumn(0);
  }
});
