
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import {
  applyStartupVisibility,
  isFullyExpanded,
  expandOneLevel,
  expandFully,
  collapseFully,
  cycleFoldLevel,
} from '../src/fold-state.js';

function deepDoc() {
  const text = [
    '* Grandparent',
    '** Parent A',
    '*** Child A1',
    '*** Child A2',
    '**** Grandchild A2a',
    '** Parent B',
    '*** Child B1',
  ].join('\n');
  return parseOrg(text);
}

function docWithArchivedChild() {
  const text = [
    '* Parent',
    '** Regular child',
    '*** Grandchild',
    '** Archived child :ARCHIVE:',
    '*** Archived grandchild',
  ].join('\n');
  return parseOrg(text);
}

// ---- applyStartupVisibility --------------------------------------------

test('applyStartupVisibility: overview collapses every heading', () => {
  const doc = deepDoc();
  applyStartupVisibility(doc, { visibility: 'overview' });
  function allCollapsed(nodes) {
    return nodes.every((n) => n.collapsed && allCollapsed(n.children));
  }
  assert.equal(allCollapsed(doc.children), true);
});

test('applyStartupVisibility: showeverything expands every heading', () => {
  const doc = deepDoc();
  applyStartupVisibility(doc, { visibility: 'showeverything' });
  function allExpanded(nodes) {
    return nodes.every((n) => !n.collapsed && !n.bodyHidden && allExpanded(n.children));
  }
  assert.equal(allExpanded(doc.children), true);
});

test('applyStartupVisibility: showall expands every heading with body content visible', () => {
  const doc = deepDoc();
  applyStartupVisibility(doc, { visibility: 'showall' });
  assert.equal(doc.children[0].collapsed, false);
  assert.equal(doc.children[0].bodyHidden, false);
  assert.equal(doc.children[0].children[0].children[0].collapsed, false);
});

test('applyStartupVisibility: content expands every heading (children visible) but hides body content on all of them', () => {
  const doc = deepDoc();
  applyStartupVisibility(doc, { visibility: 'content' });
  function allExpandedWithHiddenBody(nodes) {
    return nodes.every((n) => !n.collapsed && n.bodyHidden && allExpandedWithHiddenBody(n.children));
  }
  assert.equal(allExpandedWithHiddenBody(doc.children), true);
});

test('applyStartupVisibility: overview leaves bodyHidden false (irrelevant when collapsed hides everything anyway, but should not be left in a confusing state)', () => {
  const doc = deepDoc();
  applyStartupVisibility(doc, { visibility: 'overview' });
  assert.equal(doc.children[0].bodyHidden, false);
});

// ---- three-state fold cycle --------------------------------------------

test('isFullyExpanded is true only when the heading and every descendant are expanded', () => {
  const doc = deepDoc();
  const grandparent = doc.children[0];
  applyStartupVisibility(doc, { visibility: 'overview' });
  assert.equal(isFullyExpanded(grandparent), false);

  function expandAll(h) {
    h.collapsed = false;
    for (const c of h.children) expandAll(c);
  }
  expandAll(grandparent);
  assert.equal(isFullyExpanded(grandparent), true);

  grandparent.children[0].children[1].children[0].collapsed = true; // Grandchild A2a
  assert.equal(isFullyExpanded(grandparent), false);
});

test('expandOneLevel reveals direct children but keeps grandchildren collapsed', () => {
  const doc = deepDoc();
  const grandparent = doc.children[0];
  applyStartupVisibility(doc, { visibility: 'overview' });
  expandOneLevel(grandparent);

  assert.equal(grandparent.collapsed, false);
  assert.equal(grandparent.children[0].collapsed, true);
  assert.equal(grandparent.children[1].collapsed, true);
});

test('expandFully reveals every descendant recursively', () => {
  const doc = deepDoc();
  const grandparent = doc.children[0];
  applyStartupVisibility(doc, { visibility: 'overview' });
  expandFully(grandparent);

  assert.equal(isFullyExpanded(grandparent), true);
});

test('collapseFully collapses the heading and resets every descendant to collapsed', () => {
  const doc = deepDoc();
  const grandparent = doc.children[0];
  expandFully(grandparent);
  collapseFully(grandparent);

  assert.equal(grandparent.collapsed, true);
  assert.equal(grandparent.children[0].collapsed, true);
  assert.equal(grandparent.children[1].children[0].collapsed, true);
});

test('cycleFoldLevel: collapsed -> one level -> full -> collapsed, in order', () => {
  const doc = deepDoc();
  const grandparent = doc.children[0];
  applyStartupVisibility(doc, { visibility: 'overview' });

  assert.equal(cycleFoldLevel(grandparent), 'children');
  assert.equal(grandparent.collapsed, false);
  assert.equal(grandparent.children[0].collapsed, true);

  assert.equal(cycleFoldLevel(grandparent), 'full');
  assert.equal(isFullyExpanded(grandparent), true);

  assert.equal(cycleFoldLevel(grandparent), 'collapsed');
  assert.equal(grandparent.collapsed, true);

  assert.equal(cycleFoldLevel(grandparent), 'children');
  assert.equal(grandparent.children[0].collapsed, true);
});

test('cycleFoldLevel treats a partially-expanded heading as "not fully expanded" and advances to full', () => {
  const doc = deepDoc();
  const grandparent = doc.children[0];
  applyStartupVisibility(doc, { visibility: 'overview' });

  grandparent.collapsed = false;
  grandparent.children[0].collapsed = false;
  grandparent.children[1].collapsed = true;

  assert.equal(cycleFoldLevel(grandparent), 'full');
  assert.equal(isFullyExpanded(grandparent), true);
});

test('cycleFoldLevel on a leaf heading (no children) still toggles sensibly', () => {
  const doc = parseOrg('* Leaf heading');
  const leaf = doc.children[0];
  leaf.collapsed = true;

  assert.equal(cycleFoldLevel(leaf), 'children');
  assert.equal(leaf.collapsed, false);
  assert.equal(cycleFoldLevel(leaf), 'collapsed');
  assert.equal(leaf.collapsed, true);
});

// ---- archive-aware cycling ----------------------------------------------

test('expandFully with archiveVisibility "archived" (default) skips expanding an archived child', () => {
  const doc = docWithArchivedChild();
  const parent = doc.children[0];
  collapseFully(parent);
  expandFully(parent, { archiveVisibility: 'archived' });

  assert.equal(parent.collapsed, false);
  assert.equal(parent.children[0].collapsed, false); // Regular child: expanded
  assert.equal(parent.children[0].children[0].collapsed, false); // Grandchild: expanded

  const archivedChild = parent.children[1];
  assert.equal(archivedChild.collapsed, true); // stays collapsed
  assert.equal(archivedChild.children[0].collapsed, true); // never recursed into, stays collapsed too
});

test('expandFully with archiveVisibility "noarchived" treats archived headings like any other', () => {
  const doc = docWithArchivedChild();
  const parent = doc.children[0];
  collapseFully(parent);
  expandFully(parent, { archiveVisibility: 'noarchived' });

  assert.equal(parent.children[1].collapsed, false);
  assert.equal(parent.children[1].children[0].collapsed, false);
});

test('isFullyExpanded ignores archived children under archiveVisibility "archived"', () => {
  const doc = docWithArchivedChild();
  const parent = doc.children[0];
  expandFully(parent, { archiveVisibility: 'archived' });
  // The archived child is deliberately still collapsed, but that alone
  // shouldn't make the parent count as "not fully expanded" under this policy.
  assert.equal(isFullyExpanded(parent, { archiveVisibility: 'archived' }), true);
  // Under 'noarchived', the same tree (archived child still collapsed from
  // the previous expandFully call) genuinely isn't fully expanded.
  assert.equal(isFullyExpanded(parent, { archiveVisibility: 'noarchived' }), false);
});

test('cycleFoldLevel with archiveVisibility "archived" never cascades onto an archived subtree, but a direct toggle still works', () => {
  const doc = docWithArchivedChild();
  const parent = doc.children[0];
  collapseFully(parent);

  cycleFoldLevel(parent, { archiveVisibility: 'archived' }); // -> children
  cycleFoldLevel(parent, { archiveVisibility: 'archived' }); // -> full (archived child excluded)
  const archivedChild = parent.children[1];
  assert.equal(archivedChild.collapsed, true);

  // Directly toggling the archived heading itself (e.g. via the chevron,
  // not the cycle gesture) still works — this only guards cascading
  // expansion onto it as a side effect of a parent's cycle.
  expandOneLevel(archivedChild);
  assert.equal(archivedChild.collapsed, false);
});
