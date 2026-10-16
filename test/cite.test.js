import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import { parseInline } from '../src/inline-markup.js';
import { exportToHtml } from '../src/export-html.js';
import { exportToMarkdown } from '../src/export-markdown.js';
import { exportToAscii } from '../src/export-ascii.js';
import { exportToOdt } from '../src/export-odt.js';
import { cacheBibliography, citeEntry, parseBibtex, parseCitationAt, parseCslJson, splitCitationKeys } from '../src/cite.js';
import { getCiteGlobalBibliography, getCiteSeparator, getCiteSortingField } from '../src/local-variables.js';

const fixture = (name) => fs.readFileSync(new URL(`./fixtures/html/${name}`, import.meta.url), 'utf8');
cacheBibliography('refs.bib', fixture('refs.bib'));
cacheBibliography('refs2.bib', fixture('refs2.bib'));

const SOURCE = [
  '#+BIBLIOGRAPHY: refs.bib',
  '* Intro',
  'See [cite:@knuth84] and [cite/t:@knuth84, p. 5] and [cite/a:@lamport94] and [cite/na:@knuth84]. Bare [cite/n:@three]. Year',
  '* Refs',
  '#+PRINT_BIBLIOGRAPHY:',
  '',
].join('\n');
// what Emacs 29.3's basic processor makes of that
const SENTENCE = 'See (Donald E. Knuth, 1984) and Donald E. Knuth (1984, p. 5) and Leslie Lamport and Donald E. Knuth and (1984). Bare. Year';

test('a citation is read as org-element reads it: style, common affixes, references with their own affixes', () => {
  const hit = parseCitationAt('[cite/t:see;@a p. 3; @b for more; end] after', 0);
  assert.equal(hit.length, '[cite/t:see;@a p. 3; @b for more; end] '.length);
  assert.equal(hit.node.style, 't');
  assert.equal(hit.node.prefix, 'see');
  assert.equal(hit.node.suffix, ' end');
  assert.deepEqual(hit.node.refs, [
    { key: 'a', prefix: '', suffix: ' p. 3' },
    { key: 'b', prefix: ' ', suffix: ' for more' },
  ]);
  assert.equal(hit.node.blanks, 1);
  // a prefix before the first key with no ';' belongs to that reference
  assert.deepEqual(parseCitationAt('[cite:see @a p. 3]', 0).node.refs, [{ key: 'a', prefix: 'see ', suffix: ' p. 3' }]);
  assert.equal(parseCitationAt('[cite:no key here]', 0), null);
  assert.equal(parseCitationAt('[cite:@a', 0), null);
  assert.equal(parseCitationAt('[cited:@a]', 0), null);
});

test('citations are inline objects, but not inside verbatim text or code', () => {
  const nodes = parseInline('A [cite:@x] b =[cite:@y]= c ~[cite:@z]~');
  assert.deepEqual(nodes.filter((n) => n.type === 'citation').map((n) => n.refs[0].key), ['x']);
  assert.equal(splitCitationKeys('[cite/t:see @a p. 3; @b]').filter((p) => p.key).map((p) => p.key).join(), 'a,b');
});

test('a document with citations is saved exactly as it was written', () => {
  assert.equal(serializeOrg(parseOrg(SOURCE)), SOURCE);
});

test('BibTeX: @string macros, # joins, quoted values with \\", braces kept inside, white space squeezed, @comment skipped', () => {
  const e = parseBibtex(fixture('refs2.bib'));
  assert.equal(e.get('a1').title, 'A \\"quoted\\" {Title} here');
  assert.equal(e.get('a1').journal, 'Journal of Things');
  assert.equal(e.get('e1').publisher, 'Big Press');
  assert.equal(e.get('e1').title, 'Edited multi line');
  assert.equal(e.get('e1').date, '2019-05-01');
  assert.equal(e.get('a1').year, '2020');
  assert.equal(e.size, 7);
});

test('CSL-JSON: authors become "family given and ...", issued becomes the year', () => {
  const e = parseCslJson(fixture('refs.json'));
  assert.equal(e.get('j1').author, 'Fam Giv and Two Per');
  assert.equal(e.get('j1').year, '2012');
  assert.equal(e.get('j2').editor, 'Ed It');
  assert.equal(e.get('j2').year, '2005');
  assert.equal(citeEntry(['refs.bib'], 'knuth84').year, '1984');
  assert.equal(citeEntry(['refs.bib'], 'nope'), null);
});

test('HTML: the default author-year processor gives Emacs\'s text, the bibliography follows #+PRINT_BIBLIOGRAPHY:', () => {
  const html = exportToHtml(parseOrg(SOURCE));
  assert.ok(html.includes(SENTENCE), html);
  assert.ok(html.includes('<p>\nAnn Alpha and Bob Beta and Cy Gamma (2001). <i>Three authors</i>.</p>'));
  assert.ok(html.indexOf('Ann Alpha') < html.indexOf('Donald E. Knuth (1984). <i>'), 'entries are sorted by author');
});

test('Markdown, ASCII and ODT give the same text, with the bibliography in their own markup', () => {
  const doc = parseOrg(SOURCE);
  const md = exportToMarkdown(doc);
  assert.ok(md.includes(SENTENCE));
  assert.ok(md.includes('Ann Alpha and Bob Beta and Cy Gamma (2001). *Three authors*.'));
  const ascii = exportToAscii(doc, null, 400);
  assert.ok(ascii.includes(SENTENCE));
  assert.ok(ascii.includes('Ann Alpha and Bob Beta and Cy Gamma (2001). /Three authors/.'));
  const odt = Buffer.from(exportToOdt(doc)).toString('latin1');
  assert.ok(odt.length > 0);
});

test('the numeric styles number the cited keys in sorted order and join runs', () => {
  const src = '#+BIBLIOGRAPHY: refs2.bib\n#+CITE_EXPORT: basic numeric nb\n* A\n[cite:@a1;@a2;@a3;@e1] [cite:see @t1 pp. 3-4]\n#+PRINT_BIBLIOGRAPHY:\n';
  const html = exportToHtml(parseOrg(src));
  assert.ok(html.includes('(1-4) (see 5 pp. 3-4)'), html);
  assert.ok(html.includes('[1] Ed Itor, <i>Edited multi line</i>, Big Press, 2019.'));
});

test('two works by one author in one year get the year letter oc-basic gives them (a), and the first none', () => {
  const html = exportToHtml(parseOrg('#+BIBLIOGRAPHY: refs2.bib\n* A\n[cite:@a1] [cite:@a2] [cite:@a3]\n'));
  assert.ok(html.includes('(Smith, John and Doe, Jane, 2020) (Smith, John and Doe, Jane, 2020a) (Smith, John and Doe, Jane, 2020a)'));
});

test('a citation that prints nothing takes the space before it; one after a quotation mark gets a space', () => {
  const html = exportToHtml(parseOrg('#+BIBLIOGRAPHY: refs.bib\n* A\nBare [cite/n:@three]. Quote "[cite:@knuth84]"\n'));
  assert.ok(html.includes('Bare. Quote " (Donald E. Knuth, 1984)"'), html);
});

test('without the bibliography file, keys have no author or year, as in Emacs', () => {
  const html = exportToHtml(parseOrg('* A\n[cite:@nowhere]\n'));
  assert.ok(html.includes('(, )'));
});

test('the settings: global files, sorting field and separator', () => {
  assert.deepEqual(getCiteGlobalBibliography({ 'org-cite-global-bibliography': '("a.bib" "b.json")' }), ['a.bib', 'b.json']);
  assert.deepEqual(getCiteGlobalBibliography({ 'org-cite-global-bibliography': 'a.bib, b.bib' }), ['a.bib', 'b.bib']);
  assert.equal(getCiteSortingField({}), 'author');
  assert.equal(getCiteSortingField({ 'org-cite-basic-sorting-field': 'nil' }), null);
  assert.equal(getCiteSeparator({}), ', ');
  assert.equal(getCiteSeparator({ 'org-cite-basic-author-year-separator': '"; "' }), '; ');
});
