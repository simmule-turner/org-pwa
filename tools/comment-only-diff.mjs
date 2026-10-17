// Proves a change touched only comments (JSDoc types) and no running code: parses every source file of two trees with the
// TypeScript parser and compares the syntax trees, ignoring comments and redundant parentheses.
//   node tools/comment-only-diff.mjs <baseline-dir>     (the baseline holds src/, src-browser/ and app.js of the last release)
// Exits 1 and names the files whose code differs.
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'acorn';

const ROOT = path.resolve(import.meta.dirname, '..');
const base = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !fs.existsSync(base)) {
  console.error('usage: node tools/comment-only-diff.mjs <baseline-dir>');
  process.exit(2);
}

/** @param {string} file the syntax tree as text, without positions (comments never reach the tree; parentheses are not nodes) */
function tree(file) {
  const ast = parse(fs.readFileSync(file, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' });
  return JSON.stringify(ast, (key, value) => (key === 'start' || key === 'end' ? undefined : typeof value === 'bigint' ? `${value}n` : value));
}

const files = ['app.js'];
for (const dir of ['src', 'src-browser']) for (const f of fs.readdirSync(path.join(ROOT, dir))) if (f.endsWith('.js')) files.push(`${dir}/${f}`);
const changed = [];
const added = [];
for (const f of files) {
  const before = path.join(base, f);
  if (!fs.existsSync(before)) {
    added.push(f);
    continue;
  }
  if (tree(path.join(ROOT, f)) !== tree(before)) changed.push(f);
}
if (added.length) console.log(`new files (not compared): ${added.join(', ')}`);
if (changed.length) {
  console.log(`CODE CHANGED in ${changed.length} file(s):\n  ${changed.join('\n  ')}`);
  process.exit(1);
}
console.log(`comment-only: ${files.length - added.length} files compared, no code differs`);
