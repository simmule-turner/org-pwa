#!/usr/bin/env node
/**
 * Writes test/fixtures/html-bars-oracle.json: the preamble and postamble that real Emacs (ox-html, Emacs 29.3) writes for a
 * grid of `#+OPTIONS: html-preamble: / html-postamble:` values and format codes. test/html-bars-oracle.test.js holds
 * src/export-html.js to it.
 *
 *   node tools/gen-html-bars-oracle.mjs        (needs emacs and faketime on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const heads = [
  '#+TITLE: Ttl\n#+SUBTITLE: Sub\n#+AUTHOR: Estes\n#+EMAIL: e@x.org\n#+DATE: 2026-01-02',
  '#+TITLE: Plain\n#+AUTHOR: A & B',
  '#+TITLE: Bare',
];
const options = [
  'html-postamble:"%a"', 'html-postamble:"By %a, %d"', 'html-postamble:"%t - %s"', 'html-postamble:"%e"', 'html-postamble:"100%% of %a"',
  'html-postamble:"line1\\nline2 %a"', 'html-postamble:"say \\"hi\\" %a"', 'html-postamble:"<b>%a</b>"', 'html-postamble:"Created %C / %T"',
  'html-postamble:nil', 'html-postamble:"x" author:nil date:nil', 'html-postamble:"%a %d" email:t',
  'html-preamble:"%a"', 'html-preamble:"<b>%t</b> %s"', 'html-preamble:"Pre %d" html-postamble:"Post %a"', 'html-preamble:nil', 'html-preamble:t',
];
// the postamble Emacs writes without an option falls back to the machine's own name and address, so these are asked only of a document that has both
const fullOnly = ['title:t', 'html-postamble:auto', 'html-postamble:t', 'creator:t', 'author:nil', 'date:nil', 'email:t', 'timestamp:nil', 'html-postamble:t creator:t email:t', 'creator:t author:nil date:nil timestamp:nil'];
const cases = [];
for (const opt of fullOnly) cases.push(`${heads[0]}\n#+OPTIONS: ${opt}\n* H\nbody\n`);
// %e and %a fall back to the machine's own address and name without #+EMAIL / #+AUTHOR, so they are only asked of a document that has one
for (const head of heads) for (const opt of options) if (!(opt.includes('%e') && !head.includes('#+EMAIL')) && !(opt.includes('%a') && !head.includes('#+AUTHOR'))) cases.push(`${head}\n#+OPTIONS: ${opt}\n* H\nbody\n`);

// preamble formats, languages, validation links and functions: each case sets variables first (`setup`, Lisp) and the app is given the same
const setups = [
  { setup: `(setq org-html-preamble-format '(("en" "<p>%t by %a</p>") ("de" "<p>DE %t</p>")))`, formats: [['en', '<p>%t by %a</p>'], ['de', '<p>DE %t</p>']], options: ['html-preamble:t', 'html-preamble:nil', 'html-preamble:"own %t"'] },
  { setup: `(setq org-html-preamble-format '(("en" "<p>%t by %a</p>") ("de" "<p>DE %t</p>")))`, formats: [['en', '<p>%t by %a</p>'], ['de', '<p>DE %t</p>']], language: 'de', options: ['html-preamble:t'] },
  { setup: `(setq org-html-preamble-format '(("en" "<p>%t by %a</p>") ("de" "<p>DE %t</p>")))`, formats: [['en', '<p>%t by %a</p>'], ['de', '<p>DE %t</p>']], language: 'fr', options: ['html-preamble:t'] },
  { setup: `(setq org-html-preamble-format '(("en" "<p>%v</p>\n<hr>")))`, formats: [['en', '<p>%v</p>\n<hr>']], options: ['html-preamble:t', 'html-postamble:"%v"'] },
  { setup: `(setq org-html-preamble-format '(("en" "   \n")))`, formats: [['en', '   \n']], options: ['html-preamble:t'] },
  { setup: `(setq org-html-preamble-format '(("en" "line\n")))`, formats: [['en', 'line\n']], options: ['html-preamble:t', 'html-preamble:"%t\\n"'] },
  { setup: `(setq org-html-validation-link "<a href=\\"/v\\">V</a>" org-html-preamble-format '(("en" "%v")))`, validationLink: '<a href="/v">V</a>', formats: [['en', '%v']], options: ['html-preamble:t'] },
  { setup: `(setq org-html-preamble (lambda (info) (format "<p>%s|%s|%s</p>" (org-export-data (plist-get info :title) info) (plist-get info :language) (org-export-data (plist-get info :author) info))))`, fn: `(lambda (info) (format "<p>%s|%s|%s</p>" (org-export-data (plist-get info :title) info) (plist-get info :language) (org-export-data (plist-get info :author) info)))`, options: ['title:t'] },
  { setup: `(setq org-html-preamble (lambda (info) nil))`, fn: `(lambda (info) nil)`, options: ['title:t'] },
  { setup: `(setq org-html-preamble (lambda (info) "  "))`, fn: `(lambda (info) "  ")`, options: ['title:t'] },
  { setup: `(setq org-html-preamble (lambda (info) "<b>x</b>\n"))`, fn: `(lambda (info) "<b>x</b>\n")`, options: ['title:t'] },
  { setup: `(setq org-html-postamble-format '(("en" "<p>%a on %d</p>") ("de" "<p>DE %a</p>")))`, defaults: { postambleFormats: [['en', '<p>%a on %d</p>'], ['de', '<p>DE %a</p>']] }, options: ['html-postamble:t', 'html-postamble:auto'] },
  { setup: `(setq org-html-postamble-format '(("en" "<p>%a on %d</p>") ("de" "<p>DE %a</p>")))`, defaults: { postambleFormats: [['en', '<p>%a on %d</p>'], ['de', '<p>DE %a</p>']] }, language: 'de', options: ['html-postamble:t'] },
  { setup: `(setq org-html-postamble-format '(("en" "<p>%a on %d</p>") ("de" "<p>DE %a</p>")))`, defaults: { postambleFormats: [['en', '<p>%a on %d</p>'], ['de', '<p>DE %a</p>']] }, language: 'fr', options: ['html-postamble:t'] },
  { setup: `(setq org-html-postamble-format '(("en" "<p>%v|%c|%C</p>")))`, defaults: { postambleFormats: [['en', '<p>%v|%c|%C</p>']] }, options: ['html-postamble:t'] },
  { setup: `(setq org-html-postamble-format '(("en" "  \n")))`, defaults: { postambleFormats: [['en', '  \n']] }, options: ['html-postamble:t'] },
  { setup: `(setq org-html-postamble 'auto)`, defaults: {}, language: 'de', options: ['title:t', 'email:t creator:t'] },
  { setup: `(setq org-html-postamble 'auto)`, defaults: {}, language: 'fr', options: ['title:t', 'email:t'] },
  { setup: `(setq org-html-postamble 'auto)`, defaults: {}, language: 'es', options: ['title:t', 'email:t'] },
  { setup: `(setq org-html-postamble t)`, defaults: { postamble: true }, options: ['title:t', 'html-postamble:auto'] },
  { setup: `(setq org-html-validation-link nil)`, defaults: { validationLink: '' }, options: ['title:t', 'html-postamble:t'] },
  { setup: `(setq org-html-postamble nil)`, defaults: { postamble: false }, options: ['title:t', 'html-postamble:auto'] },
  { setup: `(setq user-full-name "Ann Lee" user-mail-address "ann@x.org")`, defaults: { userFullName: 'Ann Lee', userMailAddress: 'ann@x.org' }, noAuthor: true, options: ['title:t', 'email:t', 'html-postamble:"%a %e"', 'html-postamble:t'] },
  { setup: `(setq org-html-postamble (lambda (info) (format "<p>%s|%s</p>" (plist-get info :language) (org-export-data (plist-get info :author) info))))`, defaults: { postamble: { fn: `(lambda (info) (format "<p>%s|%s</p>" (plist-get info :language) (org-export-data (plist-get info :author) info)))` } }, options: ['title:t'] },
  { setup: `(setq org-html-postamble (lambda (info) nil))`, defaults: { postamble: { fn: '(lambda (info) nil)' } }, options: ['title:t'] },
];
const setupCases = [];
for (const s of setups) for (const opt of s.options) setupCases.push({ ...s, opt, src: `#+TITLE: Ttl\n${s.noAuthor ? '' : '#+AUTHOR: Estes\n#+EMAIL: e@x.org\n'}${s.language ? `#+LANGUAGE: ${s.language}\n` : ''}#+OPTIONS: ${opt}\n* H\nbody\n` });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bars-'));
const results = [];
for (const [i, src] of cases.entries()) {
  const file = path.join(dir, `c${i}.org`);
  fs.writeFileSync(file, src);
  spawnSync('faketime', ['2026-03-04 05:06:07', 'emacs', '-Q', '--batch', '--eval', `(progn (require 'ox-html) (find-file "${file}") (org-html-export-to-html))`], { encoding: 'utf8' });
  const html = fs.readFileSync(file.replace(/\.org$/, '.html'), 'utf8');
  const grab = (id) => { const m = new RegExp(`<div id="${id}" class="status">\\n([\\s\\S]*?)\\n</div>`).exec(html); return m ? m[1] : null; };
  results.push({ src, preamble: grab('preamble'), postamble: grab('postamble') });
}
for (const [i, c] of setupCases.entries()) {
  const file = path.join(dir, `s${i}.org`);
  fs.writeFileSync(file, c.src);
  const r = spawnSync('faketime', ['2026-03-04 05:06:07', 'emacs', '-Q', '--batch', '--eval', `(progn (require 'ox-html) ${c.setup} (find-file "${file}") (org-html-export-to-html))`], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${c.opt}: ${c.setup}\n${r.stderr}`);
  const html = fs.readFileSync(file.replace(/\.org$/, '.html'), 'utf8');
  const grab = (id) => { const m = new RegExp(`<div id="${id}" class="status">\\n([\\s\\S]*?)\\n</div>`).exec(html); return m ? m[1] : null; };
  results.push({ src: c.src, preamble: grab('preamble'), postamble: grab('postamble'), formats: c.formats, validationLink: c.validationLink, fn: c.fn, defaults: c.defaults });
}
fs.writeFileSync(new URL('../test/fixtures/html-bars-oracle.json', import.meta.url), JSON.stringify(results, null, 1) + '\n');
console.log(`wrote ${results.length} cases`);
