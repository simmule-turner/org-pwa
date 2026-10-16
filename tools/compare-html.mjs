#!/usr/bin/env node
// Compares this app's HTML export of an Org file with Emacs's ox-html, by document structure.
//   node tools/compare-html.mjs file.org        prints the differing lines (nothing when the structure is the same)
// Needs Emacs on the PATH. Ids, the postamble, syntax colouring, real checkboxes and the stray space Emacs leaves
// in timestamps are ignored; see skeleton() in test/export-html-emacs.test.js for the same reduction.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseOrg } from '../src/org-parser.js';
import { exportToHtml } from '../src/export-html.js';
import { cacheBibliography } from '../src/cite.js';

const file = process.argv[2];
if (!file) {
  console.error('usage: node tools/compare-html.mjs file.org');
  process.exit(2);
}

function skeleton(h) {
  const i = h.indexOf('<div id="content"');
  h = h.slice(i, h.lastIndexOf('</body>'));
  h = h.replace(/<div id="postamble"[\s\S]*$/, '');
  h = h.replace(/ (id|for)="[^"]*"/g, '').replace(/ href="#[^"]*"/g, ' href="#"');
  h = h.replace(/<span class="org-[a-z-]+">([^<]*)<\/span>/g, '$1');
  h = h.replace(/<br \/>/g, '<br>').replace(/ \/>/g, '>');
  h = h.replace(/<input type="checkbox" disabled checked>/g, '<code>[X]</code>').replace(/<input type="checkbox" disabled>/g, '<code>[&#xa0;]</code>');
  h = h.replace(/(<span class="timestamp">[^<]*?)\s+<\/span>/g, '$1</span>');
  h = h.replace(/<div class="outline-text-\d">\s*<\/div>\s*/g, '');
  h = h.replace(/\s*\n\s*/g, '\n').replace(/>\n</g, '><').replace(/\n(?=<)/g, '').replace(/>\n/g, '>').replace(/\s+/g, ' ').replace(/> </g, '><');
  return h.replace(/></g, '>\n<').trim();
}

const abs = path.resolve(file);
const emacs = execFileSync('emacs', ['-Q', '--batch', '--eval', `(progn (require 'ox-html) (setq org-export-use-babel nil) (find-file ${JSON.stringify(abs)}) (princ (org-export-as 'html)))`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 28 });
const source = fs.readFileSync(abs, 'utf8');
// bibliography files named by #+BIBLIOGRAPHY: sit beside the Org file, as Emacs finds them
for (const m of source.matchAll(/^#\+BIBLIOGRAPHY:\s*"?([^"\n]+?)"?\s*$/gim)) {
  const f = path.resolve(path.dirname(abs), m[1]);
  if (fs.existsSync(f)) cacheBibliography(m[1], fs.readFileSync(f, 'utf8'));
}
const ours = exportToHtml(parseOrg(source));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmp-html-'));
fs.writeFileSync(path.join(dir, 'emacs.txt'), skeleton(emacs) + '\n');
fs.writeFileSync(path.join(dir, 'ours.txt'), skeleton(ours) + '\n');
try {
  execFileSync('diff', ['-u', path.join(dir, 'emacs.txt'), path.join(dir, 'ours.txt')], { stdio: 'inherit' });
  console.log('same structure');
} catch {
  process.exitCode = 1;
}
