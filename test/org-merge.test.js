// @ts-check
// Structure-aware merge: a subtree moved on one side and edited on the other merges, and anything it cannot be sure of stays a clash.
// Emacs has no such merge (smerge is line-based), so the expected texts are what the headings say, written out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { planConflict, merge3 } from '../src/merge3.js';
import { structureMerge } from '../src/org-merge.js';

const merged = (/** @type {string} */ base, /** @type {string} */ mine, /** @type {string} */ theirs) => structureMerge(base, mine, theirs, merge3);

const BASE = `* Projects
** Alpha
alpha notes
** Beta
beta notes
* Areas
** Health
health notes
* Archive
`;

test('a subtree moved on one side and edited on the other comes out moved and edited', () => {
  const theirs = `* Projects
** Beta
beta notes
* Areas
** Health
health notes
** Alpha
alpha notes
* Archive
`;
  const mine = BASE.replace('alpha notes', 'alpha notes\nmore alpha');
  assert.equal(merged(BASE, mine, theirs), `* Projects
** Beta
beta notes
* Areas
** Health
health notes
** Alpha
alpha notes
more alpha
* Archive
`);
  assert.equal(merge3(BASE, mine, theirs)?.conflictCount !== 0, true, 'the line merge alone clashes');
  const plan = /** @type {any} */ (planConflict(mine, theirs, BASE));
  assert.equal(plan.kind, 'auto');
  assert.equal(plan.byHeading, true);
});

test('a promoted heading takes its edits along, and the headings after it follow its level', () => {
  const mine = BASE.replace('alpha notes', 'alpha notes edited'); // Alpha edited
  const theirs = BASE.replace('** Alpha', '* Alpha'); // Alpha promoted to a top-level heading, so Beta now sits under it
  assert.equal(merged(BASE, mine, theirs), `* Projects
* Alpha
alpha notes edited
** Beta
beta notes
* Areas
** Health
health notes
* Archive
`);
});

test('a state change on one side and a move on the other both apply', () => {
  const mine = BASE.replace('** Alpha', '** TODO Alpha :work:');
  const theirs = `* Projects
** Beta
beta notes
* Areas
** Health
health notes
** Alpha
alpha notes
* Archive
`;
  assert.match(/** @type {string} */ (merged(BASE, mine, theirs)), /\*\* TODO Alpha :work:\nalpha notes\n\* Archive/);
});

test('a heading with an :ID: is the same heading after its title changes', () => {
  const base = '* A\n:PROPERTIES:\n:ID: one\n:END:\n* B\n';
  const mine = '* A renamed\n:PROPERTIES:\n:ID: one\n:END:\n* B\n';
  const theirs = '* B\n* A\n:PROPERTIES:\n:ID: one\n:END:\n';
  assert.equal(merged(base, mine, theirs), '* B\n* A renamed\n:PROPERTIES:\n:ID: one\n:END:\n');
});

test('siblings reordered on one side and edited on the other', () => {
  const base = '* A\na\n* B\nb\n* C\nc\n';
  assert.equal(merged(base, base.replace('\nb\n', '\nb2\n'), '* C\nc\n* A\na\n* B\nb\n'), '* C\nc\n* A\na\n* B\nb2\n');
});

test('what it cannot be sure of stays a clash', () => {
  // the same lines edited on both sides
  assert.equal(merged(BASE, BASE.replace('alpha notes', 'mine'), BASE.replace('alpha notes', 'theirs')), null);
  // deleted on one side, edited on the other
  assert.equal(merged(BASE, BASE.replace('** Alpha\nalpha notes\n', ''), BASE.replace('alpha notes', 'edited')), null);
  // moved to two different places
  const a = '* P\n** X\n* Q\n* R\n';
  assert.equal(merged(a, '* P\n* Q\n** X\n* R\n', '* P\n* Q\n* R\n** X\n'), null);
  // two headings with the same title and no :ID:
  assert.equal(merged('* A\n* A\n', '* A\n* A\nx\n', '* A\n* A\n'), null);
  const plan = /** @type {any} */ (planConflict(BASE.replace('alpha notes', 'mine'), BASE.replace('alpha notes', 'theirs'), BASE));
  assert.equal(plan.kind, 'review');
});

test('the text before the first heading, the final newline and a Local Variables block stay where they are', () => {
  const base = '#+TITLE: T\n\n* A\na\n* B\nb\n\n# Local Variables:\n# org-startup-folded: overview\n# End:\n';
  const mine = base.replace('\na\n', '\na edited\n');
  const theirs = '#+TITLE: T\n\n* B\nb\n\n* A\na\n# Local Variables:\n# org-startup-folded: overview\n# End:\n';
  const out = /** @type {string} */ (merged(base, mine, theirs));
  assert.ok(out.startsWith('#+TITLE: T\n\n* B\nb\n\n'));
  assert.ok(out.endsWith('* A\na edited\n# Local Variables:\n# org-startup-folded: overview\n# End:\n'), out);
});

// A move on one side and an edit on the other, over many random documents: the merge is the move applied to the edited document.
test('random documents: moving a subtree and editing a heading merge to the move of the edited document', () => {
  let seed = 7;
  const rand = (/** @type {number} */ n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  /** @typedef {{ title: string, body: string[], kids: N[] }} N */
  const make = (/** @type {number} */ count) => {
    /** @type {N[]} */ const all = [];
    /** @type {N} */ const root = { title: '', body: [], kids: [] };
    for (let i = 0; i < count; i++) {
      const n = { title: `H${i}`, body: [`text ${i}`], kids: [] };
      const parent = all.length && rand(3) ? all[rand(all.length)] : root;
      parent.kids.push(n);
      all.push(n);
    }
    return root;
  };
  const clone = (/** @type {N} */ n) => /** @type {N} */ (JSON.parse(JSON.stringify(n)));
  const render = (/** @type {N} */ n, level = 0, out = /** @type {string[]} */ ([])) => {
    if (level) out.push('*'.repeat(level) + ' ' + n.title, ...n.body);
    for (const k of n.kids) render(k, level + 1, out);
    return out;
  };
  const flat = (/** @type {N} */ n, out = /** @type {N[]} */ ([])) => { for (const k of n.kids) { out.push(k); flat(k, out); } return out; };
  const contains = (/** @type {N} */ a, /** @type {N} */ b) => a === b || a.kids.some((k) => contains(k, b));
  const parentOf = (/** @type {N} */ root, /** @type {N} */ n) => flat(root).concat(root).find((p) => p.kids.includes(n));
  let merges = 0;
  for (let round = 0; round < 300; round++) {
    const base = make(4 + rand(8));
    const nodes = flat(base);
    const mover = nodes[rand(nodes.length)];
    const targets = [base, ...nodes].filter((t) => !contains(mover, t));
    const target = targets[rand(targets.length)];
    const editAt = rand(nodes.length);
    const edit = (/** @type {N} */ root) => { flat(root)[editAt].body.push('edited'); return root; };
    const move = (/** @type {N} */ root) => {
      const all = flat(root);
      const m = all[nodes.indexOf(mover)];
      const t = target === base ? root : all[nodes.indexOf(target)];
      /** @type {N} */ (parentOf(root, m)).kids.splice(/** @type {N} */ (parentOf(root, m)).kids.indexOf(m), 1);
      t.kids.push(m);
      return root;
    };
    const baseText = render(base).join('\n') + '\n';
    const mine = render(edit(clone(base))).join('\n') + '\n';
    const theirs = render(move(clone(base))).join('\n') + '\n';
    const expected = render(move(edit(clone(base)))).join('\n') + '\n';
    const got = merged(baseText, mine, theirs);
    if (got !== null) { merges++; assert.equal(got, expected, `${baseText}\n--- mine\n${mine}\n--- theirs\n${theirs}`); }
  }
  assert.ok(merges > 100, `only ${merges} of 300 merged`);
});
