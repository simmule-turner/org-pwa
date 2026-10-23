#!/usr/bin/env node
/**
 * Writes test/fixtures/icalendar-oracle.json: the .ics file real Emacs (org-icalendar-export-to-ics) writes for each
 * { org, lisp } in tools/icalendar-cases.json (`lisp` is a let-binding list for the org-icalendar-* variables).
 * test/ox-icalendar.test.js holds src/ox-icalendar.js to it.
 *
 *   node tools/gen-icalendar-oracle.mjs        (needs emacs on the PATH)
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const cases = JSON.parse(fs.readFileSync(path.join(root, 'tools', 'icalendar-cases.json'), 'utf8'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ical-oracle-'));
const out = cases.map((c, i) => {
  const file = path.join(dir, `cal${i}.org`);
  fs.writeFileSync(file, c.org);
  const lisp = `(progn (require 'org) (require 'ox-icalendar) (setq user-full-name "") (find-file "${file}") (org-mode)
 (let ${c.lisp || '()'} ${c.subtree ? `(goto-char (point-min)) (re-search-forward "${c.subtree}") (org-icalendar-export-to-ics nil t)` : '(org-icalendar-export-to-ics)'}))`;
  execFileSync('emacs', ['-Q', '--batch', '--eval', lisp], { stdio: 'ignore', env: { ...process.env, TZ: 'America/New_York' } });
  return { ...c, emacs: fs.readFileSync(path.join(dir, `cal${i}.ics`), 'utf8') };
});
fs.writeFileSync(path.join(root, 'test', 'fixtures', 'icalendar-oracle.json'), JSON.stringify(out).replace(/\},\{/g, '},\n{') + '\n');
console.log(`${out.length} cases`);
