// Holds the "*History*" node of the Info reader (L) to Emacs 29.3's Info-history: the text of the menu of visited nodes, and where point
// is after Info-history. Skipped without Emacs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { InfoSession, historyNodeText } from '../src/info-nav.js';
import { loadManual } from '../tools/info-oracle-lib.mjs';

const emacs = spawnSync('emacs', ['--version']).status === 0;
const FIXTURES = new URL('./fixtures/info/', import.meta.url).pathname;
const WALKS = [['Top'], ['Top', 'Basics'], ['Top', 'Basics', 'Tables', 'Top'], ['Top', 'Tables', 'Formulas', 'Sorting', 'Basics', 'Tables', 'Top']];

for (const walk of WALKS) {
  test(`*History* after ${walk.join(' > ')}`, { skip: !emacs }, async () => {
    const manual = await loadManual(FIXTURES, 'sample.info');
    const s = new InfoSession({ resolve: () => manual });
    s.find('sample.info', walk[0]);
    for (const n of walk.slice(1)) s.goto(n);
    const mine = historyNodeText(s.visited);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'info-hist-'));
    const out = path.join(tmp, 'out.txt');
    const file = path.join(FIXTURES, 'sample.info');
    const forms = [`(Info-find-node ${JSON.stringify(file)} ${JSON.stringify(walk[0])})`, ...walk.slice(1).map((n) => `(Info-goto-node ${JSON.stringify(n)})`)].join(' ');
    const r = spawnSync('emacs', ['--batch', '-Q', '--eval', `(progn (require 'info) (setq Info-directory-list nil) ${forms} (Info-history) (let ((s (buffer-substring-no-properties (point-min) (point-max))) (p (- (point) (point-min)))) (with-temp-file ${JSON.stringify(out)} (insert (format "%d\\n" p) s))))`], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const raw = fs.readFileSync(out, 'utf8');
    fs.rmSync(tmp, { recursive: true });
    const nl = raw.indexOf('\n');
    // Emacs names the file by its whole path; the app keeps the name the manual was added under
    const theirs = raw.slice(nl + 1).replaceAll(FIXTURES, '');
    assert.equal(mine.text, theirs.replace(/\n$/, '\n'));
    // the point of Emacs is in a text that has the path in front of every file name: take it back to the entry
    const full = raw.slice(nl + 1);
    const before = full.slice(0, Number(raw.slice(0, nl)));
    assert.equal(mine.point, before.replaceAll(FIXTURES, '').length);
  });
}
