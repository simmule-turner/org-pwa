// Removes `/** @type {any} */` from function parameters and from casts wherever TypeScript can work the type out without it (a
// callback of a typed method, a loop over a typed array, a value that already has a real type). Each removal is kept only if `tsc` stays clean; a failing batch is split until the
// culprits are found. Comments only: the running code is untouched (check with tools/comment-only-diff.mjs).
//   node tools/untype-lambdas.mjs [file ...]     (default: every source file)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const TSC = path.join(ROOT, 'node_modules/.bin/tsc');
const COMMENT = '/** @type {any} */ ';
// a parameter: `(/** @type {any} */ x` or `, /** @type {any} */ x`; a cast: `/** @type {any} */ (expr)`
const PARAM = /(\(|, )\/\*\* @type \{any\} \*\/ (?=[\w$[{])(?!(?:const|let|var)\b)/g;
const CAST = /\/\*\* @type \{any\} \*\/ (?=\()/g;

function tsc() {
  try {
    execFileSync(TSC, ['--noEmit', '-p', '.'], { cwd: ROOT, stdio: 'pipe' });
    return [];
  } catch (e) {
    return String(e.stdout).split('\n').filter((l) => /error TS/.test(l));
  }
}

let files = process.argv.slice(2);
if (!files.length) {
  files = ['app.js'];
  for (const dir of ['src', 'src-browser']) for (const f of fs.readdirSync(path.join(ROOT, dir))) if (f.endsWith('.js')) files.push(`${dir}/${f}`);
}
if (tsc().length) {
  console.error('tsc is not clean before starting; fix that first.');
  process.exit(1);
}

let removedTotal = 0;
let keptTotal = 0;
for (const f of files) {
  const abs = path.join(ROOT, f);
  const original = fs.readFileSync(abs, 'utf8');
  const marks = [
    ...[...original.matchAll(PARAM)].map((m) => ({ at: m.index + m[1].length, len: COMMENT.length })),
    ...[...original.matchAll(CAST)].map((m) => ({ at: m.index, len: COMMENT.length })),
  ].sort((a, b) => a.at - b.at);
  if (!marks.length) continue;
  /** @param {number[]} indexes the marks to take out */
  const build = (indexes) => {
    const drop = new Set(indexes);
    let out = '';
    let pos = 0;
    marks.forEach((m, i) => {
      if (!drop.has(i)) return;
      out += original.slice(pos, m.at);
      pos = m.at + m.len;
    });
    return out + original.slice(pos);
  };
  /** @type {number[]} */ let accepted = [];
  /** @param {number[]} batch */
  const tryBatch = (batch) => {
    fs.writeFileSync(abs, build([...accepted, ...batch]));
    return tsc().length === 0;
  };
  /** @param {number[]} batch */
  const solve = (batch) => {
    if (!batch.length) return;
    if (tryBatch(batch)) {
      accepted = [...accepted, ...batch];
      return;
    }
    if (batch.length === 1) return;
    const mid = Math.ceil(batch.length / 2);
    solve(batch.slice(0, mid));
    solve(batch.slice(mid));
  };
  solve(marks.map((_, i) => i));
  fs.writeFileSync(abs, build(accepted));
  removedTotal += accepted.length;
  keptTotal += marks.length - accepted.length;
  console.log(`${f}: removed ${accepted.length} of ${marks.length}`);
}
console.log(`removed ${removedTotal}, kept ${keptTotal}`);
