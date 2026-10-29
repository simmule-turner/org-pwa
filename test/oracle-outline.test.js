// Holds heading parsing and the structure commands to Emacs 29.3 (Org 9.6): test/fixtures/oracle-outline.json was made by
// tools/gen-oracle-outline.mjs from the cases in tools/oracle-outline-cases.mjs. Differences that are known and deliberate are listed in
// KNOWN_DEVIATIONS with the reason; nothing else is normalized except straight and curly quotes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import { isCommentedHeading } from '../src/comment-model.js';
import { detectLineEnding, fromLf, toLf } from '../src/line-endings.js';
import { setTagsColumn } from '../src/tags-column.js';
import { demoteHeading, insertHeadingAfter, moveHeadingDown, moveHeadingUp, pasteSubtreeAfter, promoteHeading, removeHeading, subtreeText } from '../src/heading-edit.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/oracle-outline.json', import.meta.url), 'utf8'));
// Differences from Emacs that are known and kept, each with its reason. Anything else that differs fails the test.
/** @type {{ reason: string, parse?: RegExp, edit?: (c: any, got: string | null) => boolean }[]} */
const KNOWN_DEVIATIONS = [];
const quotes = (t) => String(t).replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
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
const known = (c, got) => KNOWN_DEVIATIONS.some((d) => (c.kind === 'parse' ? d.parse?.test(c.text) : d.edit?.(c, got)));

function oursParse(c) {
  const opts = c.header ? {} : {};
  const doc = parseOrg(c.text, opts);
  const h = doc.children[0];
  if (!h) return { heading: false };
  const commented = isCommentedHeading(h);
  return { heading: true, level: h.level, todo: h.todo, priority: h.priority, title: h.title, commented, tags: h.tags };
}
// Org has two parsers for a heading line. org-element (export) and org-heading-components with org-get-tags (the editing commands, the
// agenda) disagree on a few odd lines: "* TODO" alone, "[#A]Title" with no space, tags right after a keyword, "::" in tags, COMMENTED.
// The app follows the editing commands for todo, priority, title and tags, and org-element for the level and the COMMENT flag.
function expectedParse(c) {
  const e = c.emacs;
  const k = e.comp;
  if (!e.heading) return { heading: false };
  return { heading: true, level: e.level, todo: k.todo || null, priority: k.priority || null, title: k.title || '', commented: !!e.commented, tags: k.tags };
}
// The file layer keeps a file's line endings (src/line-endings.js); Emacs was given the same text with LF breaks.
function oursEdit(c) {
  const eol = detectLineEnding(c.org);
  setTagsColumn(c.column ?? 0);
  try {
    const doc = parseOrg(toLf(c.org));
    const h = flat(doc)[c.index];
    if (c.op === 'copy') {
      pasteSubtreeAfter(doc, h, subtreeText(doc, h));
      return fromLf(serializeOrg(doc), eol);
    }
    const edit = { promote: promoteHeading, demote: demoteHeading, up: moveHeadingUp, down: moveHeadingDown, delete: removeHeading, 'insert-after': insertHeadingAfter }[c.op];
    const ok = edit(doc, h);
    return ok === false ? null : fromLf(serializeOrg(doc), eol);
  } finally {
    setTagsColumn(0);
  }
}
const refused = (c) => c.emacs.error !== undefined;

const parseCases = oracle.cases.filter((c) => c.kind === 'parse');
test(`heading lines parse as Emacs parses them (${parseCases.length} cases)`, () => {
  const wrong = parseCases.filter((c) => !known(c, null) && JSON.stringify(oursParse(c)) !== JSON.stringify(expectedParse(c)));
  assert.equal(wrong.length, 0, wrong.length + ' differ, e.g. ' + wrong.slice(0, 3).map((c) => JSON.stringify(c.text) + ' app ' + JSON.stringify(oursParse(c)) + ' emacs ' + JSON.stringify(expectedParse(c))).join('\n'));
});

for (const op of ['promote', 'demote', 'up', 'down', 'delete', 'insert-after', 'copy']) {
  const cs = oracle.cases.filter((c) => c.kind === 'edit' && c.op === op);
  test(`${op} leaves the text Emacs leaves (${cs.length} cases)`, () => {
    const wrong = cs.filter((c) => {
      const got = oursEdit(c);
      if (refused(c)) return !known(c, got) && got !== null && got !== c.org; // Emacs refuses: the app must leave the text as it was
      return quotes(got) !== quotes(fromLf(c.emacs.text, detectLineEnding(c.org))) && !known(c, got);
    });
    assert.equal(wrong.length, 0, wrong.length + ' differ, e.g. ' + wrong.slice(0, 2).map((c) => `${c.doc}#${c.index}\napp ${JSON.stringify(oursEdit(c))}\nemacs ${JSON.stringify(c.emacs.text ?? c.emacs.error)}`).join('\n'));
  });
}
