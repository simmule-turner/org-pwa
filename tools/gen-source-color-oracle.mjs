// Oracle for source coloring: Emacs 29.3 colours each sample in test/fixtures/source-color/ with the major mode Org's export uses
// (org-src-get-lang-mode; font-lock-ensure, the call org-html-fontify-code makes), and the faces per run go to <sample>.emacs.json.
// With --compare it also lays the app's highlighter (src/syntax-highlight.js) beside it, token by token, and prints the differences.
// Run: node tools/gen-source-color-oracle.mjs [--compare]   (needs emacs on the path)
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { highlightToHtml } from '../src/syntax-highlight.js';

const DIR = new URL('../test/fixtures/source-color/', import.meta.url);
/** language (an Org src block language), sample file */
const SAMPLES = [['emacs-lisp', 'sample.el'], ['python', 'sample.py'], ['js', 'sample.js'], ['java', 'Sample.java'], ['go', 'sample.go']];

/** Runs of equal face in Emacs for one sample: [[text, face|null], ...]; face is the first face symbol without font-lock-/-face. */
function emacsRuns(lang, file) {
  const path = new URL(file, DIR).pathname;
  const lisp = `(progn (require 'org) (require 'json)
    (let* ((mode (org-src-get-lang-mode ${JSON.stringify(lang)})) (runs nil))
      (with-temp-buffer
        (insert-file-contents ${JSON.stringify(path)})
        (if (fboundp mode) (funcall mode) (fundamental-mode))
        (font-lock-ensure)
        (let ((pos (point-min)))
          (while (< pos (point-max))
            (let* ((next (next-single-property-change pos 'face nil (point-max))) (f (get-text-property pos 'face))
                   (f1 (if (consp f) (car f) f))
                   (name (and f1 (replace-regexp-in-string "-face$" "" (replace-regexp-in-string "^font-lock-" "" (symbol-name f1))))))
              (push (vector (buffer-substring-no-properties pos next) name) runs)
              (setq pos next)))))
      (princ (json-encode (list :mode (if (fboundp mode) (symbol-name mode) (concat (symbol-name mode) " (not defined: plain text)")) :runs (vconcat (nreverse runs)))))))`;
  return JSON.parse(execFileSync('emacs', ['--batch', '-Q', '--eval', lisp], { encoding: 'utf8', maxBuffer: 1 << 26 }));
}

/** The app's runs: parse the span classes of highlightToHtml back to [[text, face|null]]. */
function appRuns(lang, text) {
  const html = highlightToHtml(text, lang);
  const runs = [];
  const re = /<span class="org-([\w-]+)">([\s\S]*?)<\/span>|([^<]+)/g;
  const un = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  for (let m; (m = re.exec(html)); ) runs.push(m[1] ? [un(m[2]), m[1]] : [un(m[3]), null]);
  return runs;
}

/** A face per character. @param {[string, string|null][]} runs */
function perChar(runs) {
  const faces = [];
  for (const [t, f] of runs) for (let i = 0; i < t.length; i++) faces.push(f);
  return faces;
}

const compare = process.argv.includes('--compare');
const TOKEN = /[A-Za-z_$][\w$]*|\d[\w.]*|\s+|./gs;
let report = '';
for (const [lang, file] of SAMPLES) {
  const text = readFileSync(new URL(file, DIR), 'utf8');
  const o = emacsRuns(lang, file);
  writeFileSync(new URL(`${file}.emacs.json`, DIR), `${JSON.stringify({ lang, mode: o.mode, runs: o.runs }, null, 1)}\n`);
  if (!compare) continue;
  const e = perChar(o.runs);
  const a = perChar(appRuns(lang, text));
  const diffs = new Map();
  let line = 1;
  for (let m; (m = TOKEN.exec(text)); ) {
    const tok = m[0];
    if (/^\s+$/.test(tok)) { line += (tok.match(/\n/g) || []).length; continue; }
    // the token's face: the first character's (Emacs colours some tokens in parts, e.g. a string's quotes)
    const ef = e[m.index] ?? null;
    const af = a[m.index] ?? null;
    if (ef === af) continue;
    const key = `emacs ${ef ?? 'plain'} / app ${af ?? 'plain'}`;
    if (!diffs.has(key)) diffs.set(key, []);
    diffs.get(key).push(`${tok}@${line}`);
  }
  report += `\n## ${lang} (${o.mode}): ${[...diffs.values()].reduce((n, v) => n + v.length, 0)} tokens differ\n`;
  for (const [k, v] of [...diffs].sort((x, y) => y[1].length - x[1].length)) report += `- ${k}: ${v.length}: ${[...new Set(v.map((s) => s.replace(/@\d+$/, '')))].slice(0, 14).join('  ')}\n`;
}
if (compare) console.log(report);
