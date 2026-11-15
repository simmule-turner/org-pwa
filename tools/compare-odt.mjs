#!/usr/bin/env node
// Compares this app's ODT export of Org files with Emacs 29.3's org-odt-export-to-odt, on the body of content.xml (the text, tables,
// styles in use and anchors), normalized as test/support/odt-normalize.mjs does it for the fixtures: one tag per line, generated names gone.
//   node tools/compare-odt.mjs test/fixtures/odt/p1.org [more.org ...]   prints the differing lines of each file (nothing when the same)
//   node tools/compare-odt.mjs --all                                      every fixture in test/fixtures/odt, with a count per file
// Needs Emacs and unzip on the PATH. A fixture's .el file (Lisp init the fixture is exported under) is loaded into Emacs first.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { FIXTURES, FIXTURE_NAMES, normalizedFixture, loadKatex } from '../test/support/odt-normalize.mjs';
import { parseOrg } from '../src/org-parser.js';
import { odtContentXml } from '../src/ox-odt.js';

/** The body of an exported content.xml as odt-normalize.mjs reduces it. @param {string} xml */
function reduce(xml) {
  let s = xml.slice(xml.indexOf('<office:text')).replace(/<office:text[^>]*>/, '').replace(/<\/office:text>[\s\S]*/, '').replace(/<text:sequence-decls>[\s\S]*?<\/text:sequence-decls>/, '');
  s = s.replace(/text:name="Section\d+"/g, '').replace(/draw:name="[^"]*"/g, '').replace(/org[0-9a-f]{7}/g, 'ORG');
  // Emacs writes every space of fontified code as <text:s/> and a quote as &quot;; this app writes a space and a quote: the same text.
  s = s.replace(/<text:s text:c="(\d+)"\/>/g, (_m, n) => '\u2423'.repeat(Number(n))).replace(/<text:s\/>/g, '\u2423').replace(/>( +)</g, (_m, sp) => '>' + '\u2423'.repeat(sp.length) + '<').replace(/&quot;/g, '"');
  // Emacs also closes a span where only an invisible property changes (the `>` ending a timestamp); the same style twice in a row is one run.
  for (let before = ''; before !== s; ) {
    before = s;
    s = s.replace(/<text:span text:style-name="([^"]+)">((?:(?!<\/text:span>)[^])*)<\/text:span>\s*<text:span text:style-name="\1">/g, '<text:span text:style-name="$1">$2');
  }
  return s.replace(/>\s*</g, '>\n<').replace(/\n\s*\n/g, '\n').trim().replace(/\u2423/g, ' ') + '\n';
}

/** What the app makes of any file (a fixture is made as the tests make it). @param {string} file */
function ourBody(file) {
  if (path.resolve(path.dirname(file)) === path.resolve(FIXTURES)) return normalizedFixture(path.basename(file, '.org'));
  loadKatex();
  return reduce(odtContentXml(parseOrg(fs.readFileSync(file, 'utf8')), null, { highlight: true }));
}

/** What Emacs makes of the file. @param {string} file */
function emacsBody(file) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmp-odt-'));
  try {
    const name = path.basename(file);
    fs.copyFileSync(file, path.join(dir, name));
    for (const extra of fs.readdirSync(path.dirname(file))) if (/\.(png|jpe?g|svg|gif)$/i.test(extra)) fs.copyFileSync(path.join(path.dirname(file), extra), path.join(dir, extra));
    const init = file.replace(/\.org$/, '.el');
    const load = fs.existsSync(init) ? `(load ${JSON.stringify(init)} nil t)` : '';
    const r = spawnSync('emacs', ['-Q', '--batch', '--eval', `(progn (require 'ox-odt) (setq org-export-use-babel nil) ${load} (find-file ${JSON.stringify(path.join(dir, name))}) (org-odt-export-to-odt))`], { encoding: 'utf8', cwd: dir, timeout: 120000 });
    const odt = path.join(dir, name.replace(/\.org$/, '.odt'));
    if (!fs.existsSync(odt)) throw new Error(`Emacs wrote no .odt for ${name}: ${(r.stderr || '').slice(-300)}`);
    return reduce(execFileSync('unzip', ['-p', odt, 'content.xml'], { encoding: 'utf8', maxBuffer: 1e9 }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The differing lines, as a unified diff without its header. @param {string} a @param {string} b */
function diff(a, b) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmp-odt-d-'));
  fs.writeFileSync(path.join(dir, 'emacs.xml'), a);
  fs.writeFileSync(path.join(dir, 'ours.xml'), b);
  const r = spawnSync('diff', ['-U0', path.join(dir, 'emacs.xml'), path.join(dir, 'ours.xml')], { encoding: 'utf8', maxBuffer: 1e9 });
  fs.rmSync(dir, { recursive: true, force: true });
  return r.stdout.split('\n').filter((l) => /^[-+@]/.test(l) && !/^(---|\+\+\+)/.test(l));
}

const args = process.argv.slice(2);
const files = args.includes('--all') ? FIXTURE_NAMES.map((n) => path.join(FIXTURES, n + '.org')) : args;
if (!files.length) {
  console.error('usage: node tools/compare-odt.mjs file.org [...] | --all');
  process.exit(2);
}
let differing = 0;
for (const f of files) {
  let lines;
  try {
    lines = diff(emacsBody(f), ourBody(f));
  } catch (e) {
    console.log(`ERROR ${path.basename(f)}: ${/** @type {Error} */ (e).message}`);
    continue;
  }
  const changed = lines.filter((l) => !l.startsWith('@')).length;
  if (changed) differing++;
  if (args.includes('--all')) console.log(`${changed}\t${path.basename(f)}`);
  else console.log(lines.join('\n'));
}
if (args.includes('--all')) console.log(`differing: ${differing} of ${files.length}`);
