#!/usr/bin/env node
/**
 * A ratchet for stricter type checking, adopted file by file. It runs the type checker with strictNullChecks and compares the
 * number of errors in each file with tools/strict-baseline.json (a file not listed there must have none). A file may only get
 * better: more errors than its baseline fails the check, and so does any new file with an error.
 *
 *   node tools/check-strict.mjs            check
 *   node tools/check-strict.mjs --update   lower the baseline to today's counts (it never raises it)
 *   node tools/check-strict.mjs --list     print the files that still have errors, fewest first
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const BASELINE = 'tools/strict-baseline.json';
const FLAGS = ['--strictNullChecks'];
const r = spawnSync('npx', ['tsc', '--noEmit', '-p', 'tsconfig.json', ...FLAGS], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const now = {};
for (const line of (r.stdout || '').split('\n')) {
  const m = /^(.+?)\(\d+,\d+\): error TS/.exec(line);
  if (m) now[m[1]] = (now[m[1]] || 0) + 1;
}
const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : {};
const files = Object.keys(now).sort();
const total = Object.values(now).reduce((a, b) => a + b, 0);

if (process.argv.includes('--list')) {
  for (const f of files.sort((a, b) => now[a] - now[b])) console.log(String(now[f]).padStart(4), f);
  console.log(`${total} errors in ${files.length} files`);
  process.exit(0);
}

const worse = files.filter((f) => now[f] > (baseline[f] || 0));
const better = Object.keys(baseline).filter((f) => (now[f] || 0) < baseline[f]);
if (process.argv.includes('--update')) {
  const next = {};
  for (const f of files) next[f] = Math.min(now[f], baseline[f] ?? now[f]);
  fs.writeFileSync(BASELINE, JSON.stringify(next, null, 1) + '\n');
  console.log(`baseline: ${Object.keys(next).length} files, ${Object.values(next).reduce((a, b) => a + b, 0)} errors`);
  process.exit(0);
}
if (worse.length > 0) {
  for (const f of worse) console.error(`${f}: ${now[f]} strictNullChecks errors, allowed ${baseline[f] || 0}`);
  process.exit(1);
}
console.log(`strictNullChecks: ${total} errors left in ${files.length} files${better.length ? `; ${better.length} file(s) improved (run with --update)` : ''}`);
