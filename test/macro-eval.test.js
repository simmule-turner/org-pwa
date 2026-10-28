import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg } from '../src/org-parser.js';
import { expandMacrosForExport } from '../src/export-org.js';
import { exportToHtml } from '../src/export-html.js';

// Emacs 29.3 (tools/gen-macro-eval-oracle.mjs): macros whose template starts with (eval ...), expanded by org-macro-replace-all.
const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/macro-eval.json', import.meta.url), 'utf8'));

const source = (c) => `#+MACRO: m ${c.template}\n\nbefore ${c.use} after\n`;
const wanted = (c) => (c.emacs.startsWith('ERROR') ? c.emacs : c.emacs.replace(/^#\+MACRO[^\n]*\n\n/, ''));

test('eval macros give Emacs\'s text, and its error, for the shared expander', () => {
  const bad = [];
  for (const c of oracle.cases) {
    let got;
    try {
      const { doc } = expandMacrosForExport(parseOrg(source(c)), null, new Date());
      got = doc.bodyLines.join('\n').replace(/^\n+/, '').replace(/\n*$/, '\n');
    } catch (e) {
      got = 'ERROR ' + e.message;
    }
    const want = wanted(c).replace(/\n*$/, wanted(c).startsWith('ERROR') ? '' : '\n');
    if (got !== want) bad.push({ template: c.template, use: c.use, got, want });
  }
  assert.deepEqual(bad, []);
});

test('the HTML export runs them too', () => {
  const html = exportToHtml(parseOrg('#+MACRO: up (eval (upcase $1))\n\nsay {{{up(hello)}}} now\n'));
  assert.match(html, /say HELLO now/);
});
