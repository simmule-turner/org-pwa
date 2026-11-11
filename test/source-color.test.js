import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { highlightToHtml, knowsLanguage } from '../src/syntax-highlight.js';
import { highlightRuns } from '../src/source-color.js';

// Emacs 29.3 colored each sample (tools/gen-source-color-oracle.mjs; the major mode Org's export uses, then font-lock-ensure). The
// highlighter must give the same face to every character. A line break is not part of a span, so it is not compared.
const DIR = new URL('./fixtures/source-color/', import.meta.url);
const SAMPLES = [['emacs-lisp', 'sample.el'], ['python', 'sample.py'], ['js', 'sample.js'], ['java', 'Sample.java']];
/** Where the app differs from Emacs on a sample, as `character index: emacs face`; empty when nothing differs. */
const KNOWN_DEVIATIONS = /** @type {Record<string, string[]>} */ ({});

/** @param {[string, string | null][]} runs @returns {(string | null)[]} */
const perChar = (runs) => runs.flatMap(([text, face]) => [...text].map(() => face));
const unescape = (/** @type {string} */ s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

for (const [lang, file] of SAMPLES) {
  test(`${file}: every character has the face Emacs gives it`, () => {
    const code = fs.readFileSync(new URL(file, DIR), 'utf8');
    const oracle = JSON.parse(fs.readFileSync(new URL(`${file}.emacs.json`, DIR), 'utf8'));
    const emacs = perChar(oracle.runs);
    const app = perChar(highlightRuns(code, lang) ?? []);
    assert.equal(app.length, emacs.length);
    const chars = [...code];
    const wrong = [];
    for (let i = 0; i < chars.length; i++) if (chars[i] !== '\n' && app[i] !== emacs[i]) wrong.push(`${i}: ${emacs[i]} (the app: ${app[i]}) at ${JSON.stringify(chars.slice(i, i + 12).join(''))}`);
    const known = KNOWN_DEVIATIONS[file] ?? [];
    assert.deepEqual(wrong, known);
  });

  test(`${file}: the HTML has one span per run and its text is the code`, () => {
    const code = fs.readFileSync(new URL(file, DIR), 'utf8');
    const html = highlightToHtml(code, lang);
    assert.equal(unescape(html.replace(/<[^>]+>/g, '')), code);
    assert.ok(html.split('\n').length === code.split('\n').length);
  });
}

test('a language alias gets the same coloring, and Org\'s other names for a language are known', () => {
  const code = '(defun f (x) "Doc." x)\n';
  assert.equal(highlightToHtml(code, 'elisp'), highlightToHtml(code, 'emacs-lisp'));
  assert.equal(highlightToHtml('x = 1\n', 'py'), highlightToHtml('x = 1\n', 'python'));
  assert.equal(highlightToHtml('const a = 1;\n', 'javascript'), highlightToHtml('const a = 1;\n', 'js'));
  for (const l of ['emacs-lisp', 'elisp', 'python', 'js', 'javascript', 'java', 'go', 'c', 'sh', 'ruby', 'sql', 'css', 'yaml', 'json']) assert.ok(knowsLanguage(l), l);
});

test('numbers are plain, and docstrings, comment starters, operators, annotations and warnings have their own faces', () => {
  assert.equal(highlightToHtml('x = 10\n', 'python'), '<span class="org-variable-name">x</span> <span class="org-operator">=</span> 10\n');
  assert.match(highlightToHtml('(defun f () "Doc." 1)', 'elisp'), /<span class="org-doc">"Doc\."<\/span> 1\)/);
  assert.match(highlightToHtml('; hi\n', 'elisp'), /<span class="org-comment-delimiter">; <\/span><span class="org-comment">hi<\/span>/);
  assert.match(highlightToHtml('(error "x")', 'elisp'), /<span class="org-warning">error<\/span>/);
  assert.match(highlightToHtml('@Override\nvoid f() {}', 'java'), /<span class="org-c-annotation">@Override<\/span>/);
});

test('code the highlighter was not written against does not break it', () => {
  const odd = ['', '(', ')))', '"unterminated', "'''", '/* open', '/', '@', '<<<', 'class', 'def', 'f"{', '`${', '(defun', "(require '", '#', '\\', '?', "'(((", 'x = (', 'a < b > c', 'List<'];
  for (const lang of ['elisp', 'python', 'js', 'java']) {
    for (const code of odd) {
      const html = highlightToHtml(code, lang);
      assert.equal(unescape(html.replace(/<[^>]+>/g, '')), code, `${lang}: ${JSON.stringify(code)}`);
    }
  }
});

test('a long source block is colored in a moment', { timeout: 20_000 }, () => {
  const t0 = Date.now();
  for (const [lang, file] of SAMPLES) highlightToHtml(fs.readFileSync(new URL(file, DIR), 'utf8').repeat(120), lang);
  assert.ok(Date.now() - t0 < 10_000, `took ${Date.now() - t0} ms`);
});
