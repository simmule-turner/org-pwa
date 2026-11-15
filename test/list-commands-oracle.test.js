// Holds the list commands (src/list-struct.js: M-right/M-left on an item, M-S-right/M-S-left, M-up/M-down, C-c -, C-c ^, C-c C-c on a box,
// org-list-repair) to Emacs 29.3: test/fixtures/list-commands-oracle.json was made by tools/gen-list-commands-oracle.mjs, which runs the
// commands of org-list.el on a corpus of lists.  A case the app does not match yet is in KNOWN_LIST_COMMANDS with the reason.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cycleListBullet, indentItem, indentItemTree, moveItemDown, moveItemUp, outdentItem, outdentItemTree, repairListAt, sortList, toggleCheckbox } from '../src/list-struct.js';
import { KNOWN_LIST_COMMANDS } from './support/list-commands-known.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/list-commands-oracle.json', import.meta.url), 'utf8'));

/** What the app leaves for a case: the text under the heading, or `ERROR message`. @param {any} c */
export function ours(c) {
  const lines = c.org.replace(/\n$/, '').split('\n');
  const o = { alphabetical: !!c.alpha };
  try {
    const region = c.region ? /** @type {[number, number]} */ (c.region) : undefined;
    let out;
    switch (c.op) {
      case 'indent-item': out = indentItem(lines, c.line, { region, options: o }); break;
      case 'outdent-item': out = outdentItem(lines, c.line, { region, options: o }); break;
      case 'indent-item-tree': out = indentItemTree(lines, c.line, { region, options: o }); break;
      case 'outdent-item-tree': out = outdentItemTree(lines, c.line, { region, options: o }); break;
      case 'move-item-up': out = moveItemUp(lines, c.line, o); break;
      case 'move-item-down': out = moveItemDown(lines, c.line, o); break;
      case 'repair': out = repairListAt(lines, c.line, o); break;
      case 'cycle': out = cycleListBullet(lines, c.line, c.arg, o); break;
      case 'toggle-cb': out = toggleCheckbox(lines, c.line, { presence: c.arg === 'u' ? 4 : c.arg === 'uu' ? 16 : null, region, all: !!c.heading, options: o }); break;
      case 'toggle-cb-ordered': out = toggleCheckbox(lines, c.line, { ordered: true, options: o }); break;
      case 'sort': out = sortList(lines, c.line, c.arg, { options: o }); break;
      case 'sort-case': out = sortList(lines, c.line, c.arg, { withCase: true, options: o }); break;
      default: throw new Error('op ' + c.op);
    }
    return out.join('\n') + '\n';
  } catch (e) {
    return 'ERROR ' + /** @type {Error} */ (e).message;
  }
}

/** @param {any} c */
function expected(c) {
  const e = c.emacs;
  if (e.startsWith('ERROR')) return e.replace(/at line (\d+)/, (_m, n) => `at line ${Number(n) - (c.op === 'toggle-cb-ordered' ? 4 : 1)}`);
  return e.replace(/^\* H\n(:PROPERTIES:\n:ORDERED:\s+t\n:END:\n)?/, '');
}

test(`${oracle.cases.length} list commands leave the text Emacs leaves`, () => {
  const wrong = [];
  let checked = 0;
  for (const c of oracle.cases) {
    if (/Wrong type argument/.test(c.emacs)) continue; // Emacs's own failure on text that is no list
    if (KNOWN_LIST_COMMANDS.some((k) => k.match(c))) continue;
    checked++;
    const want = expected(c);
    const got = ours(c);
    if (want.startsWith('ERROR') ? got !== want : got !== want) wrong.push({ c: { ...c, emacs: undefined }, want, got });
  }
  assert.ok(checked > 3000, `${checked} checked`);
  assert.equal(wrong.length, 0, `${wrong.length} differ, first: ${JSON.stringify(wrong[0], null, 1)}`);
});
