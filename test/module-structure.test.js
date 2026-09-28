import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// app.js used to hold everything, sharing 113 module-level `let` variables. It
// is now an entry point plus feature modules in src-browser/, all sharing state
// through one object (S, in app-state.js). The browser modules can't be
// imported in Node (they touch the DOM), so their structure is checked by
// reading the source: these are the mistakes that would otherwise only show up
// as a broken page.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dirs = ['src', 'src-browser'];
const files = ['app.js', ...dirs.flatMap((d) => fs.readdirSync(path.join(ROOT, d)).filter((f) => f.endsWith('.js')).map((f) => `${d}/${f}`))];
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

/** Names a module exports. */
function exportsOf(text) {
  const names = new Set();
  for (const m of text.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of text.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop();
      if (name) names.add(name);
    }
  }
  return names;
}

test('no module-level `let` in app.js or src-browser: shared state belongs on S (app-state.js)', () => {
  const offenders = [];
  for (const f of files.filter((f) => f === 'app.js' || f.startsWith('src-browser/'))) {
    read(f).split('\n').forEach((line, i) => {
      if (/^let\s/.test(line)) offenders.push(`${f}:${i + 1}: ${line.trim().slice(0, 60)}`);
    });
  }
  assert.deepEqual(offenders, [], 'a module-level let cannot be shared across files; put it on S');
});

test('every name a module imports from another local module is actually exported by it', () => {
  const problems = [];
  for (const f of files) {
    const text = read(f);
    for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'(\.{1,2}\/[^']+)'/g)) {
      const target = path.normalize(path.join(path.dirname(f), m[2]));
      if (!fs.existsSync(path.join(ROOT, target))) {
        problems.push(`${f} imports ${m[2]}, which does not exist`);
        continue;
      }
      // a vendored, minified bundle can't be read line by line; its own build vouches for its exports
      if (target.includes(`${path.sep}vendor${path.sep}`)) continue;
      const exported = exportsOf(read(target));
      for (const part of m[1].split(',')) {
        const imported = part.trim().split(/\s+as\s+/)[0];
        if (imported && !exported.has(imported)) problems.push(`${f} imports { ${imported} } from ${m[2]}, which does not export it`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test('no module imports the same name twice (a duplicate import is a SyntaxError that stops the whole app loading)', () => {
  const problems = [];
  for (const f of files) {
    const seen = new Map();
    for (const m of read(f).matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)) {
      for (const part of m[1].split(',')) {
        const local = part.trim().split(/\s+as\s+/).pop();
        if (!local) continue;
        if (seen.has(local)) problems.push(`${f}: "${local}" imported from ${seen.get(local)} and ${m[2]}`);
        seen.set(local, m[2]);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test('no module declares (or imports) a name that another export in the same file also declares', () => {
  const problems = [];
  for (const f of files.filter((f) => f.startsWith('src-browser/'))) {
    const text = read(f);
    const declared = [...text.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|class)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
    const dupes = declared.filter((n, i) => declared.indexOf(n) !== i);
    for (const n of dupes) problems.push(`${f} declares ${n} twice`);
    const imported = new Set();
    for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from/g)) for (const p of m[1].split(',')) imported.add(p.trim().split(/\s+as\s+/).pop());
    for (const n of declared) if (imported.has(n)) problems.push(`${f} both imports and declares ${n}`);
  }
  assert.deepEqual(problems, []);
});

test('the entry point stays small: app.js wires things up, the features live in modules', () => {
  const lines = read('app.js').split('\n').length;
  assert.ok(lines < 2500, `app.js has grown to ${lines} lines; new feature code belongs in src-browser/`);
});

test('the shared state object exists and is exported as S', () => {
  assert.ok(exportsOf(read('src-browser/app-state.js')).has('S'));
});
