#!/usr/bin/env node
/**
 * Writes examples/archive-refile.org: for each case the files before, and the files Emacs 29.3 leaves after
 * org-archive-subtree, org-toggle-archive-tag or org-refile. test/example-archive-refile.test.js holds the app to them.
 *   node tools/gen-example-archive-refile.mjs   (needs emacs and faketime on the PATH; the clock is 2026-10-11 16:30 New York)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = '/home/me/org'; // what the files' directory is called in the example; the real run happens elsewhere
const tree = '* Projects :work:\n** TODO [#A] File taxes :tax:\nSCHEDULED: <2026-10-20 Tue>\nSee the form.\n*** Gather receipts\n** Plan the year\n* Home\n** Chores\n';
/** @type {{ title: string, about: string, files: Record<string, string>, op: { type: 'archive' | 'tag' | 'refile', find: string, to?: string }, show: string[] }[]} */
export const CASES = [
  {
    title: 'Archive to the default file',
    about: 'With no setting, the subtree goes to a file named like this one with =_archive= added, at the top level. The first line records where it came from; each of the six properties says where the subtree was.',
    files: { 'notes.org': tree },
    op: { type: 'archive', find: 'File taxes' },
    show: ['notes.org', 'notes.org_archive'],
  },
  {
    title: 'Archive under a heading of the same file',
    about: '=#+ARCHIVE: ::* Archived Tasks= keeps the subtree in this file, under a heading that is created at the end if it is not there yet.',
    files: { 'notes.org': '#+ARCHIVE: ::* Archived Tasks\n' + tree },
    op: { type: 'archive', find: 'File taxes' },
    show: ['notes.org'],
  },
  {
    title: 'Archive to one file, under a heading named after this one',
    about: '=%s= in the location is the name of the file; the heading is created in the archive file.',
    files: { 'notes.org': '#+ARCHIVE: archive.org::* From %s\n' + tree },
    op: { type: 'archive', find: 'File taxes' },
    show: ['notes.org', 'archive.org'],
  },
  {
    title: 'A heading with its own location',
    about: 'The =ARCHIVE= property of a heading beats the file\'s =#+ARCHIVE:= line.',
    files: { 'notes.org': '#+ARCHIVE: archive.org::\n* Projects :work:\n** TODO File taxes :tax:\n:PROPERTIES:\n:ARCHIVE: ::* Tax papers\n:END:\n** Plan the year\n' },
    op: { type: 'archive', find: 'File taxes' },
    show: ['notes.org'],
  },
  {
    title: 'Archive a heading with no parent',
    about: 'A top-level heading has no outline path, so =ARCHIVE_OLPATH= and =ARCHIVE_ITAGS= are left out; a property with nothing to say is not written. A heading that is not a TODO has no =ARCHIVE_TODO= either.',
    files: { 'notes.org': tree },
    op: { type: 'archive', find: 'Home' },
    show: ['notes.org', 'notes.org_archive'],
  },
  {
    title: 'Tags and category of the subtree',
    about: '=ARCHIVE_CATEGORY= is the category the subtree had: its =CATEGORY= property or its parent\'s, else =#+CATEGORY:=, else the file name. =ARCHIVE_ITAGS= lists the tags it inherited (=#+FILETAGS:= first, then each level from the outermost down; a tag it has itself does not count) separated by spaces. Archived within its own file, the subtree takes those tags on, since it loses its parents.',
    files: { 'notes.org': '#+CATEGORY: finance\n#+FILETAGS: :office:\n#+ARCHIVE: ::* Done\n* Projects :work:\n** Q4 :money:work:\n*** TODO Pay :tax:money:\n* Done\n' },
    op: { type: 'archive', find: 'Pay' },
    show: ['notes.org'],
  },
  {
    title: 'Archive into a heading that has entries',
    about: 'The new entry goes last under the heading, one blank line after what is there.',
    files: { 'notes.org': '#+ARCHIVE: ::* Archived Tasks\n* Home\n** TODO Sweep\n* Archived Tasks\n** DONE Old chore\nbody\n\n\n' },
    op: { type: 'archive', find: 'Sweep' },
    show: ['notes.org'],
  },
  {
    title: 'Archive in place',
    about: '=C-c C-x a= only adds the =ARCHIVE= tag; the subtree stays where it is, folded, and the agenda leaves it out.',
    files: { 'notes.org': '* Projects :work:\n** TODO Old plan\nbody\n** Plan the year\n' },
    op: { type: 'tag', find: 'Old plan' },
    show: ['notes.org'],
  },
  {
    title: 'Refile a subtree',
    about: 'The subtree becomes the last child of the target, one level deeper than it, with its own children moved along. Nothing is stamped.',
    files: { 'notes.org': tree },
    op: { type: 'refile', find: 'File taxes', to: 'Home' },
    show: ['notes.org'],
  },
  {
    title: 'Refile to another file',
    about: 'The same, to a heading of a second file; the first file loses the subtree.',
    files: { 'notes.org': tree, 'inbox.org': '* Inbox\n** Call Pat\n* Later\n' },
    op: { type: 'refile', find: 'File taxes', to: 'Inbox', toFile: 'inbox.org' },
    show: ['notes.org', 'inbox.org'],
  },
];

const el = `
(require 'org) (require 'json) (require 'cl-lib)
(let* ((case (json-parse-string (getenv "CASE_IN") :object-type 'alist))
       (op (alist-get 'op case)) (type (alist-get 'type op)) (find (alist-get 'find op))
       (buf (find-file-noselect "notes.org")))
  (cl-letf (((symbol-function 'y-or-n-p) (lambda (&rest _) t)))
    (with-current-buffer buf
      (goto-char (point-min))
      (re-search-forward (regexp-quote find))
      (cond ((equal type "archive") (org-archive-subtree))
            ((equal type "tag") (org-toggle-archive-tag))
            (t (let* ((tbuf (if (alist-get 'toFile op) (find-file-noselect (alist-get 'toFile op)) buf))
                      (pos (with-current-buffer tbuf (save-excursion (goto-char (point-min))
                                                      (re-search-forward (concat "^\\\\*+ " (regexp-quote (alist-get 'to op))))
                                                      (line-beginning-position)))))
                 (org-refile nil nil (list (alist-get 'to op) (buffer-file-name tbuf) nil pos)))))))
  (save-some-buffers t))
`;

/** Runs a case in Emacs: the files as they stand afterwards, each with the example directory in place of the real one. @param {typeof CASES[number]} c */
export function runCase(c) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ex-arch-'));
  for (const [name, text] of Object.entries(c.files)) fs.writeFileSync(path.join(dir, name), text);
  fs.writeFileSync(path.join(dir, 'run.el'), el);
  const r = spawnSync('faketime', ['2026-10-11 16:30:00', 'emacs', '--batch', '-Q', '-l', 'run.el'], { cwd: dir, env: { ...process.env, TZ: 'America/New_York', CASE_IN: JSON.stringify(c) }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(c.title + ': ' + r.stderr);
  /** @type {Record<string, string>} */
  const out = {};
  for (const name of c.show) out[name] = fs.readFileSync(path.join(dir, name), 'utf8').split(dir).join(DIR);
  return out;
}

const escapeText = (/** @type {string} */ s) => s.replace(/^(\*|#\+)/gm, ',$1').replace(/\n+$/, '');
const block = (/** @type {string} */ label, /** @type {string} */ text) => `${label}:\n#+BEGIN_SRC org\n${escapeText(text)}\n#+END_SRC\n`;
const verb = { archive: 'Archive', tag: 'Toggle the archive tag on', refile: 'Refile' };

if (process.argv[1] && new URL(import.meta.url).pathname === path.resolve(process.argv[1])) {
  let out = `#+TITLE: Archiving and refiling
#+STARTUP: showall

A cookbook for moving subtrees. Each section shows the files before, and after the operation named under its title; the files live in =${DIR}= and the clock reads 2026-10-11 16:30. The "after" texts are what Emacs 29.3 (Org 9.6.15) left, and the app gives the same except where the last section says otherwise. Lines that start with =*= or =#+= carry a comma, as org requires inside a block.

`;
  for (const c of CASES) {
    const op = c.op;
    out += `* ${c.title}\n${c.about}\n\n${verb[op.type]} the heading =${op.find}=${op.type === 'refile' ? ` to the heading =${op.to}=${op.toFile ? ` in =${op.toFile}=` : ''}` : ''}.\n\n`;
    for (const [name, text] of Object.entries(c.files)) out += block(`Before, ${name}`, text) + '\n';
    const result = runCase(c);
    for (const name of c.show) out += block(`After, ${name}`, result[name]) + '\n';
  }
  // restoring is the app's own command: Org 9.6 has nothing that undoes an archive
  const archived = runCase(CASES[0])['notes.org_archive'].replace(/^[\s\S]*?\n(?=\* )/, '');
  const restored = archived.replace(/^\* TODO/, '* TODO').replace(/:PROPERTIES:\n[\s\S]*?:END:\n/, '');
  out += `* Restore an archived subtree (the app only)
Org has no command that undoes an archive. *Unarchive* reads the stamps back: the subtree returns to the file and heading named by =ARCHIVE_FILE= and =ARCHIVE_OLPATH=, with its TODO state from =ARCHIVE_TODO= and the stamps removed.

Restore the heading =File taxes= from the archive file.

${block('Before, notes.org_archive', archived)}
${block('After, restored', restored)}
* Where the app differs from Emacs
- *Tag column*: Emacs aligns the tags of a heading it writes to column 77; the app writes one space before them.
- *Restoring* is the app's own command; Org 9.6 has no =org-unarchive-subtree=. It puts the subtree back under the heading named by =ARCHIVE_OLPATH=, at the level that gives, without the stamps and without the tags it took on from its parents.
`;
  fs.writeFileSync(new URL('../examples/archive-refile.org', import.meta.url), out);
  console.log('wrote examples/archive-refile.org');
}
