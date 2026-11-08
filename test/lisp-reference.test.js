import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GROUPS, definingModules, groupOf, lispNames, render, splice } from '../tools/gen-lisp-reference.mjs';
import { lookupHelp } from '../src/help-lookup.js';

// The "Lisp functions" section of README.org lists what the Lisp interpreter provides. tools/gen-lisp-reference.mjs writes it from the
// interpreter's symbol table; these checks keep the README and the interpreter from drifting apart.

const readme = fs.readFileSync(new URL('../README.org', import.meta.url), 'utf8');
const begin = readme.indexOf('# BEGIN lisp-reference\n');
const end = readme.indexOf('# END lisp-reference');
const section = readme.slice(begin + '# BEGIN lisp-reference\n'.length, end);
const names = await lispNames();

/** The names listed in the section: the lines that hold only `~name~` words (an `(own)` mark may follow a name), not the group introductions. */
const listed = section
  .split('\n')
  .filter((l) => /^~\S+~( \(own\))?( ~\S+~( \(own\))?)*$/.test(l))
  .flatMap((l) => [...l.matchAll(/~(\S+?)~(?= |$)/g)].map((m) => m[1]));

test('the Lisp functions section sits between its markers', () => {
  assert.ok(begin > 0 && end > begin, 'README.org has the # BEGIN lisp-reference and # END lisp-reference lines');
  assert.match(readme, /\*\*\* Lisp functions\n:PROPERTIES:\n:CUSTOM_ID: lisp-functions\n:END:/);
});

test('every function the interpreter has is in the Lisp functions section, and every name listed is a function', () => {
  const inReadme = new Set(listed);
  const missing = names.filter((n) => !inReadme.has(n));
  const unknown = [...inReadme].filter((n) => !names.includes(n));
  assert.deepEqual({ missingFromReadme: missing, listedButNotBound: unknown }, { missingFromReadme: [], listedButNotBound: [] }, 'run: node tools/gen-lisp-reference.mjs --write');
});

test('the section is what the generator writes now', () => {
  assert.equal(splice(readme, render(names)), readme, 'run: node tools/gen-lisp-reference.mjs --write');
});

test('every function is classified in a group on purpose, not left in "other"', () => {
  const other = names.filter((n) => groupOf(n) === 'other');
  assert.deepEqual(other, [], 'add these names to a group of GROUPS in tools/gen-lisp-reference.mjs');
});

test('a name belongs to one group, and the groups name only functions that exist', () => {
  const seen = new Map();
  const twice = [];
  const stale = [];
  for (const g of GROUPS) {
    for (const n of g.names.split(/\s+/).filter(Boolean)) {
      if (seen.has(n)) twice.push(`${n} (${seen.get(n)} and ${g.id})`);
      seen.set(n, g.id);
      if (!names.includes(n)) stale.push(n);
    }
  }
  assert.deepEqual({ twice, stale }, { twice: [], stale: [] });
});

test('every module that defines Lisp functions is one the app loads', () => {
  assert.deepEqual(definingModules().unreached, []);
});

test('the interpreter helpers (names with --) are not listed', () => {
  assert.deepEqual(listed.filter((n) => n.includes('--')), []);
});

test('the Help finds every listed name', () => {
  const lost = [...new Set(listed)].filter((n) => lookupHelp(readme, n) === null);
  assert.deepEqual(lost, []);
});
