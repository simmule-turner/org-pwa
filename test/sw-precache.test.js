import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The service worker precaches the app shell from an explicit list and does
// NOT cache anything at runtime, so a module the app imports but the list
// omits simply isn't there on a cold start without a network -- and the
// whole app then fails to load. It happened once (five modules); these
// tests make it impossible to add a module and forget the list.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

function shellFiles() {
  const body = /const SHELL_FILES = \[([\s\S]*?)\];/.exec(read('sw.js'));
  assert.ok(body, 'could not find SHELL_FILES in sw.js');
  return [...body[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** Every module reachable from app.js by static or dynamic relative import. */
function reachableModules() {
  const seen = new Set();
  const queue = ['app.js'];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const m of read(file).matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+\.js)['"]/g)) {
      const resolved = path.normalize(path.join(path.dirname(file), m[1]));
      if (fs.existsSync(path.join(ROOT, resolved))) queue.push(resolved);
    }
  }
  return [...seen];
}

test('every module reachable from app.js is in the service worker precache list', () => {
  const listed = new Set(shellFiles());
  const missing = reachableModules().filter((file) => !listed.has('./' + file));
  assert.deepEqual(missing, [], `imported by the app but not precached (the app would fail to load offline): ${missing.join(', ')}`);
});

test('every local file index.html references is precached', () => {
  const listed = new Set(shellFiles());
  const html = read('index.html');
  const refs = [...html.matchAll(/(?:src|href)="([^"#?]+)"/g)]
    .map((m) => m[1])
    .filter((ref) => !/^(?:[a-z]+:|\/\/|data:)/i.test(ref));
  const missing = refs.filter((ref) => !listed.has('./' + ref.replace(/^\.\//, '')));
  assert.deepEqual(missing, [], `referenced by index.html but not precached: ${missing.join(', ')}`);
});

test('every file in the precache list exists', () => {
  const missing = shellFiles().filter((entry) => entry !== './' && !fs.existsSync(path.join(ROOT, entry)));
  assert.deepEqual(missing, [], `listed in sw.js but not on disk: ${missing.join(', ')}`);
});

test('the precache list has no duplicates', () => {
  const files = shellFiles();
  const dupes = files.filter((f, i) => files.indexOf(f) !== i);
  assert.deepEqual(dupes, []);
});

test('the test itself can see the app: a healthy number of modules is reachable', () => {
  assert.ok(reachableModules().length > 50, 'the import crawl found suspiciously few modules');
});
