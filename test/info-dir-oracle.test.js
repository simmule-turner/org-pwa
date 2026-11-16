// Holds the directory the app composes from its manuals (composeDir, read with dirSections) to Emacs 29.3's Info-directory: each manual's
// entries go to Emacs as a dir file of their own, and Emacs merges them as it does for the Info-directory-list of a machine. The
// sections and their entries must come out the same (the order of the dir files decides the order in Emacs; the app sorts, as
// install-info does, so the comparison is of sorted sections). Skipped without Emacs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { composeDir, dirManual, dirSections } from '../src/info-store.js';

const emacs = spawnSync('emacs', ['--version']).status === 0;

/** @param {string} name @param {{ section: string, text: string }[]} entries */
const record = (name, entries) => ({ name, title: name, added: 1, entries, files: [], parts: [] });

const RECORDS = [
  record('emacs', [{ section: 'Emacs', text: '* Emacs: (emacs).             The extensible editor.' }]),
  record('elisp', [{ section: 'Emacs', text: '* Elisp: (elisp).             The Emacs Lisp reference.' }, { section: 'Software development', text: '* Elisp Intro: (eintr).        A programming introduction.' }]),
  record('gcc', [{ section: 'Software development', text: '* gcc: (gcc).                 The GNU compiler,\n                              with a long description.' }]),
  record('make', [{ section: 'Programming', text: '* Make: (make).               Build tool.' }]),
  record('dupe-a', [{ section: 'Emacs', text: '* Emacs: (emacs).             The extensible editor.' }]),
  record('coreutils', [{ section: 'Basics', text: '* ls: (coreutils)ls invocation.   List directory contents.' }, { section: 'Basics', text: '* cp: (coreutils)cp invocation.   Copy files.' }]),
];

/** The sections of an Emacs directory node, as dirSections gives them, from its text. */
function emacsSections(dir) {
  const el = path.join(dir, 'q.el');
  fs.writeFileSync(el, `(require 'info)
(setq Info-directory-list (directory-files ${JSON.stringify(dir)} t "^d[0-9]+$"))
(setq Info-additional-directory-list nil Info-default-directory-list nil)
(Info-directory)
(with-temp-file ${JSON.stringify(path.join(dir, 'out.txt'))}
  (insert (with-current-buffer "*info*" (buffer-substring-no-properties (point-min) (point-max)))))
`);
  const r = spawnSync('emacs', ['--batch', '-Q', '-l', el], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const text = fs.readFileSync(path.join(dir, 'out.txt'), 'utf8');
  return dirSections(text.slice(text.indexOf('\n') + 1));
}

const normalize = (sections) => sections.map((s) => ({ heading: s.heading, entries: s.entries.map((e) => [e.name, e.file, e.node, e.description]).sort((a, b) => a[0].localeCompare(b[0])) })).filter((s) => s.heading !== null).sort((a, b) => a.heading.localeCompare(b.heading));

test('the directory composed from the manuals is the one Emacs makes of their dir files', { skip: !emacs }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'info-dir-'));
  try {
    RECORDS.forEach((rec, i) => {
      const sub = path.join(dir, 'd' + i);
      fs.mkdirSync(sub);
      const bySection = new Map();
      for (const e of rec.entries) bySection.set(e.section, [...(bySection.get(e.section) || []), e.text]);
      let text = 'File: dir,\tNode: Top\tThis is the top of the INFO tree\n\n  This is the file .../info/dir, which contains the topmost node of the\nInfo hierarchy.\n\n\x1f\nFile: dir,\tNode: Top\tThis is the top of the INFO tree\n\n* Menu:\n';
      for (const [section, lines] of bySection) text += '\n' + section + '\n' + lines.join('\n') + '\n';
      fs.writeFileSync(path.join(sub, 'dir'), text);
    });
    const ours = normalize(dirSections(dirManual(RECORDS).findNode('Top').text));
    const theirs = normalize(emacsSections(dir));
    if (process.env.DBG) console.log(JSON.stringify({ ours, theirs }, null, 1).slice(0, 3000));
    assert.ok(theirs.length >= 3 && theirs.some((s) => s.entries.length > 1), 'Emacs listed the sections');
    assert.deepEqual(ours, theirs);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('composeDir keeps a manual without entries under Other', () => {
  const text = composeDir([record('plain', [])]);
  assert.match(text, /\nOther\n\* plain: \(plain\)\./);
});
