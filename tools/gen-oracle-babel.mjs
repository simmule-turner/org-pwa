#!/usr/bin/env node
/**
 * Writes test/fixtures/oracle-babel.json: what Emacs 29.3 (Org 9.6) does with source blocks, for the corpus in
 * tools/oracle-babel-cases.mjs -- the blocks it finds with their languages, bodies, names and header arguments (inheritance
 * included), Noweb expansion, the files org-babel-tangle writes, what the export step leaves of a block, and what
 * org-babel-execute-src-block writes under an emacs-lisp block.  test/oracle-babel.test.js holds the app to it.
 *   node tools/gen-oracle-babel.mjs   (needs emacs on the PATH)
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCases } from './oracle-babel-cases.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const cases = buildCases();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-babel-'));

/** Runs one slice of the cases in its own Emacs and returns the results. */
function runSlice(slice, n) {
  return new Promise((resolve, reject) => {
    const input = path.join(dir, `in-${n}.json`);
    const output = path.join(dir, `out-${n}.json`);
    fs.writeFileSync(input, JSON.stringify(slice));
    const p = spawn('emacs', ['--batch', '-Q', '-l', path.join(root, 'tools', 'oracle-babel.el')], { env: { ...process.env, ORACLE_IN: input, ORACLE_OUT: output }, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => p.kill('SIGKILL'), 900_000);
    p.on('close', () => {
      clearTimeout(timer);
      if (!fs.existsSync(output)) return reject(new Error(`slice ${n} wrote nothing\n${err.slice(-2000)}`));
      resolve(JSON.parse(fs.readFileSync(output, 'utf8')));
    });
  });
}

const SLICE = 150;
const slices = [];
for (let i = 0; i < cases.length; i += SLICE) slices.push(cases.slice(i, i + SLICE));
const results = [];
const WIDTH = 4;
for (let i = 0; i < slices.length; i += WIDTH) {
  const batch = await Promise.all(slices.slice(i, i + WIDTH).map((s, k) => runSlice(s, i + k)));
  for (const r of batch) results.push(...r);
}
const version = '29.3';
const out = cases.map((c, i) => ({ ...c, emacs: results[i] }));
fs.writeFileSync(path.join(root, 'test', 'fixtures', 'oracle-babel.json'), JSON.stringify({ emacs: version, cases: out }) + '\n');
const byKind = {};
for (const c of out) {
  byKind[c.kind] = byKind[c.kind] || { n: 0, errors: 0 };
  byKind[c.kind].n++;
  if (typeof c.emacs === 'string' && c.emacs.startsWith('ERROR')) byKind[c.kind].errors++;
}
console.log(JSON.stringify(byKind));
