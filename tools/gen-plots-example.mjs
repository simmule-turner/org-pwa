#!/usr/bin/env node
/**
 * Writes test/fixtures/plots-example.json (what Emacs 29.3's org-plot hands to gnuplot for the tables of tools/plots-example-cases.mjs:
 * the series it draws and the data file; gnuplot itself is not run) and examples/plots.org from it.
 *   node tools/gen-plots-example.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SECTIONS, DIFFERENCES } from './plots-example-cases.mjs';

const el = `
(require 'org) (require 'org-plot) (require 'json) (provide 'gnuplot)
(defun cap (org)
  (with-temp-buffer
    (insert org) (org-mode) (goto-char (point-min))
    (re-search-forward "^|") (beginning-of-line)
    (catch 'plot
      (advice-add 'org-plot/gnuplot-script :around
        (lambda (f table data-file &rest r)
          (let ((s (apply f table data-file r)))
            (throw 'plot (list (cons 'script s) (cons 'data (with-temp-buffer (insert-file-contents data-file) (buffer-string))))))) '((name . cap)))
      (condition-case e (org-plot/gnuplot) (error (list (cons 'error (error-message-string e))))))))
(with-temp-buffer
  (insert-file-contents (getenv "ORACLE_IN"))
  (let* ((json-array-type 'list) (json-object-type 'alist) (cs (json-read-from-string (buffer-string))) (out '()))
    (dolist (c cs) (push (cap c) out))
    (with-temp-file (getenv "ORACLE_OUT") (insert (json-encode (nreverse out))))))
`;
const all = [...SECTIONS.map((s) => s.org), ...DIFFERENCES.map((d) => d.org)];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plex-'));
fs.writeFileSync(path.join(dir, 'run.el'), el);
fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(all));
const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: path.join(dir, 'out.json') }, encoding: 'utf8' });
if (r.status !== 0) {
  console.error(r.stderr);
  process.exit(1);
}
const out = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
const version = spawnSync('emacs', ['--batch', '-Q', '--eval', '(princ emacs-version)'], { encoding: 'utf8' }).stdout.trim();

/** The series a gnuplot script draws: [columns, title]. @param {string} script */
const series = (script) => [...script.matchAll(/using (\S+) with \w+ title '([^']*)'/g)].map((m) => [m[1], m[2]]);
/** @param {{ script?: string, data?: string, error?: string }} o */
const result = (o) => (o.error ? { error: o.error } : { series: series(o.script || ''), data: (o.data || '').split('\n').map((l) => l.split('\t').map((c) => c.replace(/^"|"$/g, ''))) });
const cases = SECTIONS.map((s, i) => ({ ...s, emacs: result(out[i]) }));
const differences = DIFFERENCES.map((d, i) => ({ ...d, emacs: result(out[SECTIONS.length + i]) }));
fs.writeFileSync(new URL('../test/fixtures/plots-example.json', import.meta.url), JSON.stringify({ emacs: version, cases, differences }, null, 1) + '\n');

const describe = (/** @type {typeof cases[number]} */ c) => {
  if (c.radar) return `Axes, one per row after the swap: ${c.emacs.data.filter((r) => r[0]).map((r) => r[0]).join(', ')}.`;
  return c.emacs.series.map(([using, title]) => {
    const [x, y] = using.split(':');
    return y ? `- ${title}: column ${y} against column ${x}` : `- ${title}: column ${x} against the row number`;
  }).join('\n');
};

let text = `#+TITLE: Plots
#+STARTUP: showall

A =#+PLOT:= line directly above a table graphs it. In the app, *📊 Plot* below the table shows the graph inline; tap again to hide it. The app reads org-plot's own options, so a line copied from Emacs works. Under each table is what Emacs 29.3 (Org 9.6.15) hands to gnuplot, and the app draws the same series. The drawing itself is the app's own; Emacs needs gnuplot to draw.

`;
for (const c of cases) {
  text += `* ${c.heading}\n${c.prose}\n\n${c.org}\n${c.radar ? '' : 'Series:\n'}${describe(c)}\n\n`;
}
text += `* Where the app differs from Emacs
- Options that only script gnuplot (=set=, =line=, =script=, =file=, =map=, =timefmt=) are read and ignored.
- Not drawn: =type:3d= and =type:grid=.

App only: the graph is inline SVG, no gnuplot needed.
`;
fs.writeFileSync(new URL('../examples/plots.org', import.meta.url), text);
console.log(`wrote ${cases.length} sections and ${differences.length} differences from Emacs ${version}`);
