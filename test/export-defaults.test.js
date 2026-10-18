import test from 'node:test';
import assert from 'node:assert/strict';
import { countExportItemsOn, encodeLispString, hasLatexTocFix, hasPagedToc, htmlExportDefaults, LATEX_HEADER_KEY, LATEX_TOC_FIX_HEADER, latexExportDefaults, withLatexTocFix, PAGED_TOC_HEAD, withPagedToc } from '../src/export-defaults.js';
import { exportToHtml } from '../src/export-html.js';
import { exportToLatex } from '../src/export-latex.js';
import { exportToAscii } from '../src/export-ascii.js';
import { exportToMarkdown } from '../src/export-markdown.js';
import { exportToOdt } from '../src/export-odt.js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseOrg } from '../src/org-parser.js';

const doc = (text) => parseOrg(text);

test('nothing is applied until it is switched on, and the text offered is the default', () => {
  assert.deepEqual(htmlExportDefaults({}), {});
  assert.deepEqual(htmlExportDefaults({ 'org-html-preamble': '"%t : %s"' }), { preamble: '%t : %s' });
  assert.equal(countExportItemsOn({ 'org-html-head': '"<b>x</b>"' }, ['preamble', 'postamble', 'head']), 1);
});

test('the defaults reach the page, and the file wins', () => {
  const defaults = { preamble: 'PRE %t', postamble: 'POST %a', head: '<style>/*mine*/</style>' };
  const plain = exportToHtml(doc('#+TITLE: T\n#+AUTHOR: Ann\n* A\n'), null, { defaults });
  assert.match(plain, /PRE T/);
  assert.match(plain, /POST Ann/);
  assert.match(plain, /\/\*mine\*\//);
  const own = exportToHtml(doc('#+TITLE: T\n#+AUTHOR: Ann\n#+OPTIONS: html-preamble:"FILE %t" html-postamble:nil\n* A\n'), null, { defaults });
  assert.match(own, /FILE T/);
  assert.doesNotMatch(own, /PRE T/);
  assert.doesNotMatch(own, /POST Ann/);
  assert.doesNotMatch(exportToHtml(doc('* A\n'), null), /PRE|counter\(page\)/);
});

test("Org's own org-html-head, org-html-preamble and org-html-postamble variables set the defaults", () => {
  assert.deepEqual(htmlExportDefaults({ 'org-html-head': '"<style>p{}</style>"', 'org-html-preamble': '"%t by %a"', 'org-html-postamble': '"Made %d"' }), { head: '<style>p{}</style>', preamble: '%t by %a', postamble: 'Made %d' });
  assert.deepEqual(htmlExportDefaults({ 'org-html-postamble': 'nil' }), { postamble: false });
  assert.deepEqual(htmlExportDefaults({ 'org-html-postamble': 'auto', 'org-html-preamble': 't', 'org-html-head': 'nil' }), {});
  assert.deepEqual(htmlExportDefaults({ 'org-xx-html-preamble': 'old', 'org-xx-html-preamble-on': 't' }), {}, 'the retired variables do nothing');
  assert.ok(!exportToHtml(doc('* A\nbody\n'), null, { defaults: htmlExportDefaults({ 'org-html-postamble': 'nil' }) }).includes('class="postamble"'));
  assert.ok(exportToHtml(doc('* A\nbody\n'), null, { defaults: htmlExportDefaults({ 'org-html-postamble': '"Made by me"' }) }).includes('Made by me'));
});

test('a text is written as the quoted Lisp string Org reads, and read back', () => {
  const text = 'a "b" \\ c\nd';
  assert.deepEqual(htmlExportDefaults({ 'org-html-preamble': encodeLispString(text) }), { preamble: text });
});

test('org-use-sub-superscripts reaches HTML and LaTeX export, and #+OPTIONS: ^: in the file still wins', () => {
  const org = '* Effort_ALL: values\nSee x_{1} and a_b.\n';
  const html = exportToHtml(doc(org), null, { defaults: { sup: '{}' } });
  assert.match(html, /Effort_ALL: values/);
  assert.match(html, /x<sub>1<\/sub> and a_b/);
  assert.match(exportToHtml(doc(org)), /Effort<sub>ALL<\/sub>: values/); // org's own default is t
  assert.match(exportToHtml(doc('#+OPTIONS: ^:t\n' + org), null, { defaults: { sup: '{}' } }), /Effort<sub>ALL<\/sub>/);
  const tex = exportToLatex(doc(org), null, { defaults: { sup: '{}' } });
  assert.match(tex, /Effort\\_ALL: values/);
  assert.match(tex, /x\\textsubscript\{1\} and a\\_b/);
  assert.match(exportToLatex(doc(org)), /Effort\\textsubscript\{ALL\}/);
});

test('"Add TOC with page numbers" adds and removes its text in org-html-head and leaves the rest alone', () => {
  assert.ok(!hasPagedToc('<style>p {}</style>'));
  const on = withPagedToc('<style>p {}</style>', true);
  assert.ok(on.startsWith('<style>p {}</style>\n') && on.endsWith(PAGED_TOC_HEAD) && hasPagedToc(on));
  assert.equal(withPagedToc(on, true), on); // ticking again does not add it twice
  assert.equal(withPagedToc(on, false), '<style>p {}</style>');
  assert.equal(withPagedToc(withPagedToc('', true), false), '');
  assert.ok(PAGED_TOC_HEAD.includes('li { break-inside: auto; page-break-inside: auto }') && PAGED_TOC_HEAD.includes('paged.polyfill.min.js'));
});

test('"Fix wide TOC numbers" is stored in org-xx-latex-header and written before the file\'s own #+LATEX_HEADER: lines', () => {
  const on = withLatexTocFix('', true);
  assert.equal(on, LATEX_TOC_FIX_HEADER);
  assert.ok(hasLatexTocFix(on) && !hasLatexTocFix('\\usepackage{x}'));
  assert.equal(withLatexTocFix(withLatexTocFix('\\usepackage{x}', true), false), '\\usepackage{x}');
  const vars = { [LATEX_HEADER_KEY]: encodeLispString(on) };
  assert.equal(latexExportDefaults(vars).header, on); // a backslash survives the round trip through the stored string
  assert.equal(latexExportDefaults({}).header, undefined);
  const tex = exportToLatex(doc('#+LATEX_HEADER: \\usepackage{mine}\n* One\n'), null, { defaults: latexExportDefaults(vars) });
  const at = (text) => tex.indexOf(text);
  assert.ok(at('\\usepackage{tocloft}') > at('\\usepackage{hyperref}') && at('\\cftsubsubsecnumwidth') < at('\\usepackage{mine}'), tex.slice(0, 600));
});

test('org-use-sub-superscripts also reaches ASCII, Markdown and ODT export, and the file\'s #+OPTIONS: ^: wins', () => {
  const org = '* Effort_ALL: values\nSee x_{1} and a_b.\n';
  // ASCII prints a subscript as _x or _{xy} either way, so its text is the same whatever the setting
  assert.match(exportToAscii(doc(org), null, 72, { sup: '{}' }), /Effort_ALL/);
  const md = (text, sup) => exportToMarkdown(doc(text), null, { sup });
  assert.match(md(org, '{}'), /Effort\\_ALL/);
  assert.match(md(org, 't'), /Effort<sub>ALL<\/sub>/);
  assert.match(md('#+OPTIONS: ^:nil\n' + org, 't'), /Effort\\_ALL/);
  const odt = (text, sup) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'export-defaults-odt-'));
    writeFileSync(path.join(dir, 't.odt'), exportToOdt(doc(text), null, { sup }));
    execFileSync('unzip', ['-o', '-q', path.join(dir, 't.odt'), '-d', dir]);
    return readFileSync(path.join(dir, 'content.xml'), 'utf8');
  };
  assert.match(odt(org, '{}'), /Effort_ALL: values/);
  assert.match(odt(org, 't'), /Effort<text:span text:style-name="Subscript">ALL<\/text:span>/);
  assert.match(odt('#+OPTIONS: ^:t\n' + org, '{}'), /Effort<text:span text:style-name="Subscript">ALL/);
});
