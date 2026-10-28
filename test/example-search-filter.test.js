// examples/search-filter.org lists what Emacs 29.3 finds in its sample outline and how query-replace changes it
// (tools/gen-example-search-filter.mjs). The app must find and change the same, apart from the differences pinned at the end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import { searchDocument } from '../src/search.js';
import { searchViewItems } from '../src/agenda-queries.js';
import { createQueryReplace } from '../src/query-replace.js';
import { buildQueryReplacePattern } from '../src-browser/doc-helpers.js';
import { resolveTodoSequence } from '../src/todo-cycle.js';

const text = readFileSync(new URL('../examples/search-filter.org', import.meta.url), 'utf8');
const unescape = (/** @type {string} */ s) => s.replace(/^,(\*|#\+)/gm, '$1');
const sample = unescape(/The outline:\n#\+BEGIN_SRC org\n([\s\S]*?)\n#\+END_SRC/.exec(text)?.[1] || '') + '\n';
const section = (/** @type {string} */ name) => new RegExp(`^\\* ${name}\\n([\\s\\S]*?)(?=^\\* |(?![\\s\\S]))`, 'm').exec(text)?.[1] || '';

/** Every heading of a fresh sample, in file order. */
function headings() {
  const doc = parseOrg(sample);
  /** @type {import('../src/types.js').Heading[]} */ const all = [];
  (function walk(nodes) {
    for (const n of nodes) {
      all.push(n);
      walk(n.children);
    }
  })(doc.children);
  return { doc, all };
}
/** The titles of `found` in file order, as the example lists them. @param {import('../src/types.js').Heading[]} found */
function names(found) {
  const { all } = headings();
  const titles = new Set(found.map((h) => h.title));
  return all.filter((h) => titles.has(h.title)).map((h) => h.title).join('; ') || '(none)';
}

test('search-filter.org: Keyword search lists what Emacs lists', () => {
  const { doc } = headings();
  const list = [{ documentId: 'sample.org', doc }];
  const sequence = resolveTodoSequence(doc, ['TODO', 'DONE']);
  let n = 0;
  for (const m of section('Keyword search').matchAll(/^- =(.+?)= :: (.*)$/gm)) {
    const items = searchViewItems(list, m[1], { doneKeywords: sequence.doneKeywords, todoKeywords: sequence.todoKeywords, documentOrder: ['sample.org'] });
    assert.equal(names(items.map((i) => i.heading)), m[2], `query ${m[1]}`);
    n++;
  }
  assert.equal(n, 10);
});

test('search-filter.org: regular expressions find what Emacs finds', () => {
  const { doc } = headings();
  let n = 0;
  for (const m of section('Regular expressions').matchAll(/^- =(.+?)= :: (.*)$/gm)) {
    const found = searchDocument(doc, m[1], { useRegex: true }).map((r) => r.heading);
    assert.equal(names(found), m[2], `pattern ${m[1]}`);
    n++;
  }
  assert.equal(n, 13);
});

test('search-filter.org: a filter finds what its Match query finds in Emacs', () => {
  const { doc } = headings();
  let n = 0;
  for (const m of section('Filters').matchAll(/^- =(.+?)= as =(.+?)= :: (.*)$/gm)) {
    const found = searchDocument(doc, m[1]).map((r) => r.heading);
    assert.equal(names(found), m[3], `filter ${m[1]}`);
    n++;
  }
  assert.equal(n, 10);
});

test('search-filter.org: replace changes what Emacs changes', () => {
  const blocks = [...section('Replace').matchAll(/Replace the (text|regexp) =(.+?)= with =(.+?)=:\n#\+BEGIN_SRC org\n([\s\S]*?)#\+END_SRC/g)];
  assert.equal(blocks.length, 4);
  for (const [, kind, from, to, body] of blocks) {
    const doc = parseOrg(sample);
    const re = buildQueryReplacePattern(from, kind === 'regexp');
    createQueryReplace(doc, re, kind === 'regexp' ? to : to.replace(/\\/g, '\\\\')).replaceAll();
    const after = serializeOrg(doc).split('\n');
    const before = sample.split('\n');
    let got = '';
    before.forEach((l, i) => {
      if (l !== after[i]) got += `- ${l}\n+ ${after[i]}\n`;
    });
    assert.equal(got, unescape(body), `${from} -> ${to}`);
  }
});

test('search-filter.org: a replacement takes the case of the text it replaces, and \\& and \\\\ are read, as in Emacs', () => {
  const run = (/** @type {string} */ from, /** @type {string} */ to, /** @type {string} */ src, regexp = false) => {
    const doc = parseOrg(src);
    createQueryReplace(doc, buildQueryReplacePattern(from, regexp), to).replaceAll();
    return serializeOrg(doc);
  };
  assert.match(run('colour', 'color', '* Colour and COLOUR and colour\n'), /^\* Color and COLOR and color$/m); // Emacs 29.3 gives the same
  assert.match(run('Colour', 'color', '* Colour and colour\n'), /^\* color and colour$/m); // a capital in the search text: case matters, nothing is converted
  assert.match(run('b+', '[\\&]', '* abbc\n', true), /^\* a\[bb\]c$/m);
  assert.match(run('b', 'x\\\\y', '* abc\n', true), /^\* ax\\yc$/m);
});

test('search-filter.org: where the app differs from Emacs', () => {
  assert.match(text, /^\* Where the app differs from Emacs\n- \*Where it replaces\*/m);
});
