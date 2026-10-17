// Counts the JSDoc `any` annotations per file and by kind, so progress is visible and the per-file budget (test/any-budget.json)
// can only go down.
//   node tools/any-report.mjs              the table
//   node tools/any-report.mjs --json       the counts as JSON
//   node tools/any-report.mjs --write-budget   lower test/any-budget.json to today's counts (never raises one)
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const FILES = ['app.js'];
for (const dir of ['src', 'src-browser']) for (const f of fs.readdirSync(path.join(ROOT, dir))) if (f.endsWith('.js')) FILES.push(`${dir}/${f}`);

const KINDS = {
  param: /@param \{any\}/g,
  'lambda-param': /\(\/\*\* @type \{any\} \*\/ [\w${[]/g,
  cast: /\/\*\* @type \{any\} \*\/ \(/g,
  declared: /\/\*\* @type \{any(?:\[\])?\} \*\/ (?:const|let|var) /g,
  returns: /@returns? \{any\}/g,
  'any[]': /\{any\[\]\}/g,
};

export function countAny(text) {
  return (text.match(/\{any\b/g) || []).length;
}

export function report() {
  const files = {};
  const kinds = Object.fromEntries(Object.keys(KINDS).map((k) => [k, 0]));
  for (const f of FILES) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const n = countAny(text);
    if (n) files[f] = n;
    for (const [k, re] of Object.entries(KINDS)) kinds[k] += (text.match(re) || []).length;
  }
  return { total: Object.values(files).reduce((a, b) => a + b, 0), kinds, files };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = report();
  const arg = process.argv[2];
  if (arg === '--json') console.log(JSON.stringify(r, null, 2));
  else if (arg === '--write-budget') {
    const file = path.join(ROOT, 'test/any-budget.json');
    const old = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    const next = {};
    for (const [f, n] of Object.entries(r.files)) next[f] = old[f] === undefined ? n : Math.min(n, old[f]);
    fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
    console.log(`wrote ${Object.keys(next).length} budgets, total ${Object.values(next).reduce((a, b) => a + b, 0)}`);
  } else {
    console.log(`total ${r.total}`);
    console.log(Object.entries(r.kinds).map(([k, v]) => `${k} ${v}`).join('  '));
    for (const [f, n] of Object.entries(r.files).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(String(n).padStart(5), f);
  }
}
