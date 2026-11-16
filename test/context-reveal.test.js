// @ts-check
// org-fold-show-context-detail: which detail a context gets, and what showing a heading opens.
import assert from 'node:assert/strict';
import test from 'node:test';
import { contextDetail, showContext } from '../src/context-reveal.js';
import { parseOrg } from '../src/org-parser.js';

test('the detail of a context follows the variable, as Emacs reads it', () => {
  assert.equal(contextDetail(undefined, 'agenda'), 'local');
  assert.equal(contextDetail(undefined, 'isearch'), 'lineage');
  assert.equal(contextDetail(undefined, 'org-goto'), 'ancestors');
  assert.equal(contextDetail('nil', 'agenda'), 'minimal');
  assert.equal(contextDetail('t', 'agenda'), 'canonical');
  assert.equal(contextDetail("'tree", 'org-goto'), 'tree');
  assert.equal(contextDetail("'((agenda . tree) (default . lineage))", 'agenda'), 'tree');
  assert.equal(contextDetail("'((agenda . tree) (default . lineage))", 'org-goto'), 'lineage');
  assert.equal(contextDetail("'((agenda . tree))", 'org-goto'), 'ancestors');
});

test('showing a heading opens its ancestors; canonical also their text; tree its children', () => {
  const doc = parseOrg('* a\ntext a\n** b\ntext b\n*** c\n');
  const [a] = doc.children;
  const b = a.children[0];
  const c = b.children[0];
  for (const h of [a, b, c]) h.collapsed = true;
  b.bodyHidden = true;
  showContext(doc, c, 'ancestors');
  assert.deepEqual([a.collapsed, b.collapsed, c.collapsed], [false, false, true]);
  assert.equal(b.bodyHidden, true);
  showContext(doc, c, 'canonical');
  assert.equal(b.bodyHidden, false);
  assert.equal(c.collapsed, false);
});
