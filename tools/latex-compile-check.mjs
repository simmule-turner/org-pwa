#!/usr/bin/env node
// Compiles what our LaTeX exporter writes, to catch output that looks right but does not build.
// Local tool (CI may not have TeX): node tools/latex-compile-check.mjs [fixture-name ...] [--keep] [--unicode]
// --unicode builds everything with xelatex (inputenc and fontenc dropped), for documents with emoji or symbols pdflatex cannot set.
// Exports every test/fixtures/latex/*.org (or the names given), runs the compiler the file asks for
// (#+LATEX_COMPILER, default pdflatex) twice so references settle, and lists any file that fails with the
// first TeX error. A failure that Emacs's own output (the .tex beside the fixture) has too is reported as
// "same" and not counted: it is a limit of the LaTeX setup, not of our exporter. Exit status 1 when anything
// else fails; 2 when no TeX compiler is installed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseOrg } from '../src/org-parser.js';
import { exportToLatex } from '../src/export-latex.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixtures = path.join(root, 'test/fixtures/latex');
const args = process.argv.slice(2);
const keep = args.includes('--keep');
const unicode = args.includes('--unicode');
const names = args.filter((a) => !a.startsWith('--'));
const all = fs.readdirSync(fixtures).filter((f) => f.endsWith('.org')).map((f) => f.slice(0, -4)).sort();
const todo = names.length ? names : all;

const have = (cmd) => spawnSync(cmd, ['--version'], { stdio: 'ignore' }).status === 0;
if (!have('pdflatex')) {
  console.error('pdflatex is not installed; nothing to check.');
  process.exit(2);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'latex-check-'));
let failed = 0;
for (const name of todo) {
  const source = fs.readFileSync(path.join(fixtures, name + '.org'), 'utf8');
  let tex = exportToLatex(parseOrg(source));
  if (unicode) tex = tex.replace(/^\\usepackage\[(utf8|T1)\]\{(inputenc|fontenc)\}\n/gm, '');
  const compiler = unicode ? 'xelatex' : (/^% Intended LaTeX compiler: (\S+)/.exec(tex) || [])[1] || 'pdflatex';
  const file = path.join(work, name + '.tex');
  fs.writeFileSync(file, tex);
  if (!have(compiler)) {
    console.log(`skip  ${name} (${compiler} not installed)`);
    continue;
  }
  const build = (texFile) => {
    let log = '';
    let status = 0;
    for (let pass = 0; pass < 2 && status === 0; pass++) {
      const r = spawnSync(compiler, ['-interaction=nonstopmode', '-halt-on-error', '-output-directory', work, texFile], { cwd: work, encoding: 'utf8' });
      status = r.status ?? 1;
      log = r.stdout || '';
    }
    return { status, error: (log.match(/^!.*(?:\n.*){0,1}/m) || [log.slice(-300)])[0] };
  };
  const mine = build(file);
  if (mine.status === 0) {
    console.log(`ok    ${name}`);
    continue;
  }
  const oracle = path.join(work, 'emacs-' + name + '.tex');
  fs.writeFileSync(oracle, unicode ? fs.readFileSync(path.join(fixtures, name + '.tex'), 'utf8').replace(/^\\usepackage\[(utf8|T1)\]\{(inputenc|fontenc)\}\n/gm, '') : fs.readFileSync(path.join(fixtures, name + '.tex')));
  const theirs = build(oracle);
  if (theirs.status !== 0 && theirs.error.split('\n')[0] === mine.error.split('\n')[0]) {
    console.log(`same  ${name} (Emacs's output fails the same way)\n${mine.error.replace(/^/gm, '      ')}`);
    continue;
  }
  failed++;
  console.log(`FAIL  ${name} (${compiler})\n${mine.error.replace(/^/gm, '      ')}`);
}
console.log(failed ? `\n${failed} of ${todo.length} failed${keep ? '; files in ' + work : ''}` : `\nall ${todo.length} compile${keep ? '; files in ' + work : ''}`);
if (!keep) fs.rmSync(work, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
