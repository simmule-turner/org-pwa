// Guards the work of narrowing JSDoc `any`: a name that now always has a real type must not slip back to `{any}`, and the total of `@param {any}` placeholders may only go down.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const FILES = [path.join(ROOT, 'app.js')];
for (const dir of ['src', 'src-browser']) for (const f of fs.readdirSync(path.join(ROOT, dir))) if (f.endsWith('.js')) FILES.push(path.join(ROOT, dir, f));

// Names whose type is the same everywhere: write the real type (see src/types.js for Heading, Doc, Table).
const TYPED_NAMES = [
  'text', 'line', 'lines', 'path', 'id', 'name', 'tags', 'title', 'url', 'label', 'body', 'filename', 'fileId', 'documentId',
  'level', 'prefix', 'suffix', 'html', 'src', 'dest', 'str', 'string', 'heading', 'headings', 'doc', 'table',
];
// `@param {any}` placeholders left on purpose (callbacks, per-file shapes, mixed meanings). Lower this when you remove some; never raise it.
const MAX_ANY_PARAMS = 785;

const found = [];
let total = 0;
for (const file of FILES) {
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(/@param \{any\} \[?(\w+)/g)) {
    total++;
    if (TYPED_NAMES.includes(m[1])) found.push(`${path.relative(ROOT, file)}: @param {any} ${m[1]}`);
  }
}

test('names with a known type are not typed any', () => {
  assert.deepEqual(found, []);
});

test('the number of @param {any} placeholders does not grow', () => {
  assert.ok(total <= MAX_ANY_PARAMS, `${total} placeholders, limit ${MAX_ANY_PARAMS}`);
});

test('no file has more `any` annotations than its budget (test/any-budget.json)', async () => {
  const { execFileSync } = await import('node:child_process');
  const budget = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/any-budget.json'), 'utf8'));
  const now = JSON.parse(execFileSync('node', [path.join(ROOT, 'tools/any-report.mjs'), '--json'], { cwd: ROOT, encoding: 'utf8' })).files;
  const over = Object.entries(now).filter(([f, n]) => n > (budget[f] ?? 0)).map(([f, n]) => `${f}: ${n} > ${budget[f] ?? 0}`);
  assert.deepEqual(over, [], 'lower the number with tools/any-report.mjs --write-budget when you remove some; never raise it');
});
