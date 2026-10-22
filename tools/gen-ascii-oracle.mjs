#!/usr/bin/env node
/**
 * Writes test/fixtures/ascii/NAME.txt for every test/fixtures/ascii/NAME.org (not blocks.org, which has its own
 * three charsets): what real Emacs (ox-ascii) writes for it. test/export-ascii-emacs.test.js holds src/export-ascii.js to these files.
 *
 *   node tools/gen-ascii-oracle.mjs [name ...]        (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures', 'ascii');
const wanted = process.argv.slice(2);
const names = fs.readdirSync(dir).filter((f) => f.endsWith('.org') && f !== 'blocks.org').map((f) => f.slice(0, -4)).filter((n) => !wanted.length || wanted.includes(n));
/** Fixtures also written in the other character sets. */
const CHARSET_FIXTURES = new Set(['basic', 'headings', 'lists', 'tables', 'blocks2', 'title', 'misc', 'inline-tasks']);
let failed = 0;
/** One Emacs run: `charset` as org-ascii-charset, and for subtree-* fixtures just the heading "* Chosen" and below. */
function run(name, charset, suffix) {
  const out = path.join(dir, name + '.txt');
  fs.rmSync(out, { force: true });
  const subtree = name.startsWith('subtree-');
  const lisp = `(progn (require 'org) (require 'ox-ascii) ${name.startsWith('inline-') ? "(require 'org-inlinetask)" : ''} (setq org-export-with-broken-links nil) (setq user-full-name "") (setq org-ascii-charset '${charset}) (find-file ${JSON.stringify(path.join(dir, name + '.org'))}) ${subtree ? '(goto-char (point-min)) (search-forward "* Chosen") (org-ascii-export-to-ascii nil t)' : '(org-ascii-export-to-ascii)'})`;
  const r = spawnSync('emacs', ['-Q', '--batch', '--eval', lisp], { encoding: 'utf8' });
  if (r.status !== 0 || !fs.existsSync(out)) {
    failed++;
    console.error(`${name}: emacs failed\n${r.stderr.slice(-400)}`);
    return;
  }
  if (suffix) fs.renameSync(out, path.join(dir, `${name}${suffix}.txt`));
  console.log(`wrote ${name}${suffix}.txt`);
}
for (const name of names) {
  run(name, 'ascii', '');
  if (CHARSET_FIXTURES.has(name)) {
    run(name, 'utf-8', '.utf-8');
    run(name, 'latin1', '.latin1');
  }
}
process.exit(failed ? 1 : 0);
