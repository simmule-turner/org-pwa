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
const cases = [];
// %e and %a fall back to the machine's own address and name without #+EMAIL / #+AUTHOR, so they are only asked of a document that has one
for (const head of heads) for (const opt of options) if (!(opt.includes('%e') && !head.includes('#+EMAIL')) && !(opt.includes('%a') && !head.includes('#+AUTHOR'))) cases.push(`${head}\n#+OPTIONS: ${opt}\n* H\nbody\n`);

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
fs.writeFileSync(new URL('../test/fixtures/html-bars-oracle.json', import.meta.url), JSON.stringify(results, null, 1) + '\n');
console.log(`wrote ${results.length} cases`);
