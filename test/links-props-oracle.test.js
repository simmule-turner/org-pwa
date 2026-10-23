// Holds property edits, tags, links and link abbreviations to Emacs. The fixtures were made by tools/gen-props-oracle.mjs,
// gen-linksearch-oracle.mjs, gen-storelink-oracle.mjs, gen-abbrev-oracle.mjs and gen-linkparse-oracle.mjs, which run the
// Org commands in Emacs 29.3.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import { setHeadingTags } from '../src/heading-edit.js';
import { setProperty, deleteProperty } from '../src/archive-model.js';
import { searchLink } from '../src/link-resolve.js';
import { makeLinkString } from '../src/link-string.js';
import { linkAbbreviations, expandAbbreviation } from '../src/link-abbrev.js';
import { parseInline } from '../src/inline-markup.js';

const load = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));

test('setting tags and setting or deleting a property leave the text Emacs leaves (tags stay one space after the title)', () => {
  const squeeze = (t) => t.replace(/^(\*+ .*?)\s+(:[\w@#%:]+:)$/gm, '$1 $2');
  const wrong = [];
  for (const c of load('props-oracle').cases) {
    const doc = parseOrg(c.org);
    const heading = doc.children[0];
    if (c.op === 'tags') setHeadingTags(heading, c.args);
    else if (c.op === 'put') setProperty(heading, c.args[0], c.args[1]);
    else deleteProperty(heading, c.args[0]);
    const got = squeeze(serializeOrg(doc));
    if (got !== squeeze(c.emacs)) wrong.push({ heading: c.heading, op: c.op, args: c.args, got, want: c.emacs });
  }
  assert.equal(wrong.length, 0, JSON.stringify(wrong[0], null, 1));
});

test('an internal link leads to the heading Emacs finds', () => {
  const oracle = load('linksearch-oracle');
  const doc = parseOrg(oracle.doc);
  // Not looked up here: a target above the first heading, a (coderef), and /regexp/ (which is a file path as a link)
  const skipped = new Set(['top target', '(one)', '(two)', '/alpha/']);
  const wrong = [];
  for (const c of oracle.cases) {
    if (skipped.has(c.query)) continue;
    const heading = searchLink(doc, c.query);
    const got = heading ? heading.title.replace(/^COMMENT /, '') : 'ERROR';
    const want = c.emacs.startsWith('ERROR') ? 'ERROR' : c.emacs;
    if (got !== want) wrong.push({ query: c.query, got, want });
  }
  assert.equal(wrong.length, 0, JSON.stringify(wrong, null, 1));
});

test('the link stored for a heading reads as Emacs writes it', () => {
  const wrong = [];
  for (const c of load('storelink-oracle').cases) {
    const heading = parseOrg(`* ${c.heading}\n:PROPERTIES:\n:ID: abc-123\n:END:\nbody\n`).children[0];
    const got = makeLinkString(`id:${heading.properties.ID}`, heading.title);
    if (got !== c.emacs) wrong.push({ heading: c.heading, got, want: c.emacs });
  }
  assert.equal(wrong.length, 0, JSON.stringify(wrong, null, 1));
});

test('a link abbreviation expands as Emacs expands it', () => {
  const oracle = load('abbrev-oracle');
  const map = linkAbbreviations(parseOrg(oracle.defs + '\n* H\n'));
  const wrong = [];
  for (const c of oracle.cases) {
    if (c.emacs.startsWith('ERROR')) continue; // a %(function) value needs Emacs Lisp
    const got = expandAbbreviation(c.target, map);
    if (got !== c.emacs) wrong.push({ target: c.target, got, want: c.emacs });
  }
  assert.equal(wrong.length, 0, JSON.stringify(wrong, null, 1));
});

test('a line of text has the links Emacs finds in it', () => {
  const links = (nodes, out = []) => {
    for (const n of nodes) {
      if (n.type === 'link' || n.type === 'image') out.push([n.target, n.description ?? null]);
      if (n.children) links(n.children, out);
    }
    return out;
  };
  const wrong = [];
  for (const c of load('linkparse-oracle').cases) {
    const got = links(parseInline(c.line));
    const want = c.emacs.map((l) => [l.raw, l.desc]);
    if (JSON.stringify(got) !== JSON.stringify(want)) wrong.push({ line: c.line, got, want });
  }
  assert.equal(wrong.length, 0, JSON.stringify(wrong[0], null, 1));
});
