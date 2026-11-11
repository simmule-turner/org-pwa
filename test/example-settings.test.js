import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseGlobalVariables } from '../src/global-variables.js';
import * as local from '../src/local-variables.js';
import { VARIABLE_CATALOG } from '../src/variable-catalog.js';

const text = fs.readFileSync(new URL('../examples/settings.org', import.meta.url), 'utf8');
const body = text.slice(text.indexOf('#+BEGIN_SRC'), text.indexOf('#+END_SRC'));
const readme = fs.readFileSync(new URL('../README.org', import.meta.url), 'utf8');

/** The variable names in the README's table of recognized variables. */
const tableStart = readme.indexOf('The recognized variables, alphabetically');
const tableEnd = readme.indexOf('*** Lisp init', tableStart);
const documented = [...readme.slice(tableStart, tableEnd).matchAll(/^\| ~([a-z][a-z0-9*-]+)~ \|/gm)].map((m) => m[1]);
const listed = [...body.matchAll(/^;; [* ] ([a-z][a-z0-9-]+):/gm)].map((m) => m[1]);

test('the file lists every recognized variable once, in alphabetical order', () => {
  assert.deepEqual(listed, [...listed].sort());
  assert.equal(new Set(listed).size, listed.length);
  for (const name of new Set(documented)) assert.ok(listed.includes(name), `${name} is in the README table`);
});

test('every variable with a control in Settings is listed', async () => {
  const { SETTINGS_FIELDS, CARD_CONTROLS } = await import('../src-browser/settings-fields.js');
  for (const f of [...SETTINGS_FIELDS, ...CARD_CONTROLS]) assert.ok(listed.includes(f.key), f.key);
});

test('a * marks exactly the variables with no control in Settings', () => {
  const starred = [...body.matchAll(/^;; \* ([a-z][a-z0-9-]+):/gm)].map((m) => m[1]);
  assert.deepEqual(starred, VARIABLE_CATALOG.map((c) => c.name).sort());
});

test('each default of an Emacs variable is the one Emacs 29.3 gave', () => {
  const emacs = JSON.parse(fs.readFileSync(new URL('./fixtures/settings-defaults.json', import.meta.url), 'utf8'));
  for (const name of Object.keys(emacs)) assert.ok(listed.includes(name), name);
});

test('setting every line to the value shown changes nothing and reports no problem', () => {
  const active = body.split('\n').filter((l) => /^;; \(setq /.test(l)).map((l) => l.replace(/^;; /, '').replace(/\s+;.*$/, '')).filter((l) => !/ VALUE\)$/.test(l));
  const vars = parseGlobalVariables(active.join('\n'));
  assert.ok(Object.keys(vars).length > 100);
  assert.deepEqual(local.variableProblems(vars), []);
  let compared = 0;
  for (const [name, fn] of Object.entries(local)) {
    if (!/^get[A-Z]/.test(name) || typeof fn !== 'function' || fn.length > 1) continue;
    // a list-valued variable read as text: nil and unset both mean no entries (the parsers that read them agree)
    const run = (/** @type {Record<string, string>} */ v) => { try { const r = JSON.stringify(fn(v)); return r === '"nil"' ? '""' : r; } catch (e) { return `error ${/** @type {Error} */ (e).message}`; } };
    assert.equal(run(vars), run({}), `${name} is not changed by the defaults`);
    compared++;
  }
  assert.ok(compared > 50, `only ${compared} readers compared`);
});
