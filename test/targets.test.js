import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import { parseInline } from '../src/inline-markup.js';
import { collectTargets, findTargetHeading, radioTargetRegExp } from '../src/targets.js';
import { resolveLinkTarget } from '../src/link-resolve.js';

const sample = [
  '* Intro',
  'The big apple is a <<<big apple>>> and an <<orchard>> too.',
  '#+BEGIN_SRC org',
  '<<noweb-ref>>',
  '#+END_SRC',
  '* Elsewhere',
  'Eat a Big   Apple or visit the [[orchard]]. An apples-and-pears mix is not one.',
  '',
].join('\n');

test('targets: <<name>> and <<<name>>> parse as target nodes, and a stray << does not', () => {
  const nodes = parseInline('a <<<big apple>>> b <<orchard>> c << d >> e');
  assert.deepEqual(nodes.filter((n) => n.type !== 'text').map((n) => [n.type, n.name]), [['radio-target', 'big apple'], ['target', 'orchard']]);
  assert.equal(nodes.map((n) => (n.type === 'text' ? n.value : n.value)).join(''), 'a <<<big apple>>> b <<orchard>> c << d >> e');
});

test('targets: they are collected from text, not from code blocks, with the heading each is under', () => {
  const doc = parseOrg(sample);
  assert.deepEqual(collectTargets(doc).map((t) => [t.name, t.radio, t.heading.title]), [['big apple', true, 'Intro'], ['orchard', false, 'Intro']]);
});

test('targets: [[name]] finds the heading holding the target, ignoring case and spacing; a heading title still wins', () => {
  const doc = parseOrg(sample);
  assert.equal(findTargetHeading(doc, 'Orchard').title, 'Intro');
  assert.equal(findTargetHeading(doc, 'big   APPLE').title, 'Intro');
  assert.equal(resolveLinkTarget(doc, 'orchard').type, 'heading');
  assert.equal(resolveLinkTarget(doc, 'nowhere').type, 'unresolved');
  assert.equal(resolveLinkTarget(doc, 'Elsewhere').heading.title, 'Elsewhere');
});

test('targets: plain occurrences of a radio target become links to it, but not parts of longer words', () => {
  const doc = parseOrg(sample);
  const re = radioTargetRegExp(doc);
  const nodes = parseInline('Eat a Big   Apple or an apples-and-pears mix, big apples too, BIG APPLE.', { radioTargets: re });
  const links = nodes.filter((n) => n.type === 'link');
  assert.deepEqual(links.map((n) => [n.target, n.description]), [['Big Apple', 'Big   Apple'], ['BIG APPLE', 'BIG APPLE']]);
  assert.equal(nodes.map((n) => (n.type === 'text' ? n.value : n.description)).join(''), 'Eat a Big   Apple or an apples-and-pears mix, big apples too, BIG APPLE.');
  assert.equal(radioTargetRegExp(parseOrg('* Nothing here\n')), null);
});

import { exportToAscii } from '../src/export-ascii.js';
import { exportToOdt } from '../src/export-odt.js';

const linked = '* One\n** Sub\nText <<spot>> and <<<big apple>>> and =<<<pear>>>=.\n* Two\nSee [[*Sub]] and [[spot]] and [[spot][described]], a Big Apple and a pear.\n';

test('targets: ASCII export reads those links as Org does: section numbers, or [description] with a note, and no link markup', () => {
  const out = exportToAscii(parseOrg(linked));
  assert.match(out, /See 1\.1 and 1\.1 and \[described\], a Big Apple and a pear\./);
  assert.ok(!out.includes('<<spot>>') && !out.includes('<<<big'), out);
});

test('targets: ODT export puts bookmarks at them and links to those bookmarks', () => {
  const xml = exportToOdt(parseOrg(linked));
  const text = typeof xml === 'string' ? xml : Buffer.from(xml).toString('latin1');
  // as ox-odt: every target gets an OrgXref bookmark (and a plain one) under a generated name
  assert.match(text, /<text:bookmark-start text:name="OrgXref\.(org[0-9a-f]+)"\/>\n<text:bookmark text:name="\1"\/>big apple\n<text:bookmark-end text:name="OrgXref\.\1"\/>/);
  assert.match(text, /<text:bookmark-ref text:reference-format="chapter" text:ref-name="OrgXref\.org[0-9a-f]+">1\.1<\/text:bookmark-ref>/);
  assert.match(text, /<text:bookmark-ref text:reference-format="text" text:ref-name="OrgXref\.org[0-9a-f]+">Big Apple<\/text:bookmark-ref>/);
});
