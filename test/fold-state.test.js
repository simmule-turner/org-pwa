
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import { toggleFold, flattenVisibleRows } from '../src/outline-view-model.js';
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

test('THE EXACT REQUEST: show2levels shows headings through depth 2 only, matching real Emacs org-mode\u2019s own confirmed behavior', () => {
  const doc = deepDoc();
  applyStartupVisibility(doc, { visibility: 'show2levels' });
  const titles = flattenVisibleRows(doc)
    .filter((r) => r.rowType === 'heading')
    .map((r) => r.node.title);
  assert.deepEqual(titles, ['Grandparent', 'Parent A', 'Parent B']);
});

test('THE EXACT REQUEST: show3levels shows headings through depth 3, matching real Emacs org-mode\u2019s own confirmed behavior', () => {
  const doc = deepDoc();
  applyStartupVisibility(doc, { visibility: 'show3levels' });
  const titles = flattenVisibleRows(doc)
    .filter((r) => r.rowType === 'heading')
    .map((r) => r.node.title);
  assert.deepEqual(titles, ['Grandparent', 'Parent A', 'Child A1', 'Child A2', 'Parent B', 'Child B1']);
});

test('show4levels reveals the whole deepDoc() structure, since it\u2019s only 4 levels deep', () => {
  const doc = deepDoc();
  applyStartupVisibility(doc, { visibility: 'show4levels' });
  const titles = flattenVisibleRows(doc)
    .filter((r) => r.rowType === 'heading')
    .map((r) => r.node.title);
  assert.deepEqual(titles, ['Grandparent', 'Parent A', 'Child A1', 'Child A2', 'Grandchild A2a', 'Parent B', 'Child B1']);
});

test('THE FIX: showNlevels hides body text at EVERY visible level, not just the deepest one, matching real Emacs org-mode\u2019s own confirmed behavior', () => {
  const doc = parseOrg('* Level 1\nText at level 1.\n** Level 2\nText at level 2.\n');
  applyStartupVisibility(doc, { visibility: 'show2levels' });
  assert.equal(doc.children[0].bodyHidden, true);
  assert.equal(doc.children[0].children[0].bodyHidden, true);
});

// ---- the bug: 'content'/'showall'/'showeverything' ignoring archive status ----

test('THE BUG THIS FIXES: content mode used to unfold an archived subtree\'s children on file open, ignoring archiveVisibility entirely', () => {
  const doc = docWithArchivedChild();
  applyStartupVisibility(doc, { visibility: 'content' }, 'archived');

  const parent = doc.children[0];
  const archivedChild = parent.children[1]; // "Archived child :ARCHIVE:"
  const regularChild = parent.children[0]; // "Regular child"

  assert.equal(archivedChild.collapsed, true); // stays shut, unlike everything else in content mode
  assert.equal(regularChild.collapsed, false); // content mode still unfolds non-archived headings normally
});

test('showall and showeverything have the same bug fixed the same way', () => {
  for (const visibility of ['showall', 'showeverything']) {
    const doc = docWithArchivedChild();
    applyStartupVisibility(doc, { visibility }, 'archived');
    const archivedChild = doc.children[0].children[1];
    assert.equal(archivedChild.collapsed, true, `failed for visibility=${visibility}`);
  }
});

test('archiveVisibility: "noarchived" restores the old (now correctly opt-in) behavior of expanding archived headings too', () => {
  const doc = docWithArchivedChild();
  applyStartupVisibility(doc, { visibility: 'content' }, 'noarchived');
  const archivedChild = doc.children[0].children[1];
  assert.equal(archivedChild.collapsed, false);
});

test('an archived heading\'s own descendants still get their default collapsed/bodyHidden set (not force-collapsed themselves), so expanding the archived heading later shows them in the right state', () => {
  const doc = docWithArchivedChild();
  applyStartupVisibility(doc, { visibility: 'content' }, 'archived');
  const archivedChild = doc.children[0].children[1];
  const archivedGrandchild = archivedChild.children[0]; // "Archived grandchild"
  // The grandchild itself isn't archived, so it gets the normal content-mode
  // default (expanded, body hidden) — only the archived node itself is forced shut.
  assert.equal(archivedGrandchild.collapsed, false);
  assert.equal(archivedGrandchild.bodyHidden, true);
});

test('overview mode is unaffected by the archive fix (everything was already collapsed either way)', () => {
  const doc = docWithArchivedChild();
  applyStartupVisibility(doc, { visibility: 'overview' }, 'archived');
  assert.equal(doc.children[0].children[0].collapsed, true); // regular child
  assert.equal(doc.children[0].children[1].collapsed, true); // archived child
});

// ---- three-state fold cycle --------------------------------------------

test('isFullyExpanded is true only when the heading and every descendant are expanded', () => {
  const doc = deepDoc();
  const grandparent = doc.children[0];
  applyStartupVisibility(doc, { visibility: 'overview' });
  assert.equal(isFullyExpanded(grandparent), false);

  function expandAll(h) {
    h.collapsed = false;
    h.drawersHidden = false;
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

test('THE BUG THIS FIXES: expandOneLevel clears bodyHidden, so the slide-left gesture can reveal a heading\'s own body content under #+STARTUP: content', () => {
  const doc = deepDoc();
  const grandparent = doc.children[0];
  applyStartupVisibility(doc, { visibility: 'content' });
  assert.equal(grandparent.bodyHidden, true); // content mode's default

  expandOneLevel(grandparent);
  assert.equal(grandparent.bodyHidden, false); // the fix
});

test('expandFully clears bodyHidden on the whole revealed subtree', () => {
  const doc = deepDoc();
  const grandparent = doc.children[0];
  applyStartupVisibility(doc, { visibility: 'content' });
  expandFully(grandparent);

  function allBodyVisible(h) {
    return !h.bodyHidden && h.children.every(allBodyVisible);
  }
  assert.equal(allBodyVisible(grandparent), true);
});

test('expandFully still skips bodyHidden-clearing (and everything else) for an archived child under archiveVisibility "archived"', () => {
  const doc = docWithArchivedChild();
  const parent = doc.children[0];
  applyStartupVisibility(doc, { visibility: 'content' }, 'archived');
  expandFully(parent, { archiveVisibility: 'archived' });

  const archivedChild = parent.children[1];
  assert.equal(archivedChild.collapsed, true); // stays shut, per the earlier archive fix
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
  // A leaf heading's own drawersHidden still has to reach false before
  // it counts as fully expanded -- correctly a 3-state cycle like any
  // other heading, not a special-cased 2-state one just because it has
  // no children of its own.
  assert.equal(cycleFoldLevel(leaf), 'full');
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

// ---- drawersHidden: the actual showall/showeverything distinction (covers BOTH property drawers and block content, per real org-mode) --------

test('applyStartupVisibility: showall reveals body/lists but keeps drawersHidden true (properties/blocks stay folded, matching real org)', () => {
  const doc = parseOrg('* A\nsome body text\n#+BEGIN_SRC js\nconsole.log(1);\n#+END_SRC');
  applyStartupVisibility(doc, { visibility: 'showall' });
  const heading = doc.children[0];
  assert.equal(heading.collapsed, false);
  assert.equal(heading.bodyHidden, false);
  assert.equal(heading.drawersHidden, true);
});

test('applyStartupVisibility: showeverything reveals body, properties, AND blocks', () => {
  const doc = parseOrg('* A\nsome body text\n:PROPERTIES:\n:ID: abc\n:END:');
  applyStartupVisibility(doc, { visibility: 'showeverything' });
  const heading = doc.children[0];
  assert.equal(heading.collapsed, false);
  assert.equal(heading.bodyHidden, false);
  assert.equal(heading.drawersHidden, false);
});

test('applyStartupVisibility: overview and content both keep drawersHidden true', () => {
  const doc1 = parseOrg('* A');
  applyStartupVisibility(doc1, { visibility: 'overview' });
  assert.equal(doc1.children[0].drawersHidden, true);

  const doc2 = parseOrg('* A');
  applyStartupVisibility(doc2, { visibility: 'content' });
  assert.equal(doc2.children[0].drawersHidden, true);
});

test('expandFully clears drawersHidden, matching how it already clears bodyHidden', () => {
  const doc = parseOrg('* A\n** B');
  applyStartupVisibility(doc, { visibility: 'showall' }); // drawersHidden: true initially
  const a = doc.children[0];
  assert.equal(a.drawersHidden, true);
  expandFully(a);
  assert.equal(a.drawersHidden, false);
  assert.equal(a.children[0].drawersHidden, false); // descendant too
});

test('REGRESSION THIS FIXES: isFullyExpanded correctly reports false when drawersHidden is still true, even though collapsed is false', () => {
  const doc = parseOrg('* A');
  applyStartupVisibility(doc, { visibility: 'showall' }); // collapsed: false, drawersHidden: true
  assert.equal(isFullyExpanded(doc.children[0]), false);
});

test('REGRESSION THIS FIXES: isFullyExpanded correctly reports false when bodyHidden is still true', () => {
  const doc = parseOrg('* A');
  applyStartupVisibility(doc, { visibility: 'content' }); // collapsed: false, bodyHidden: true
  assert.equal(isFullyExpanded(doc.children[0]), false);
});

test('cycleFoldLevel on a showall-loaded heading correctly advances straight to full (reveals blocks), not straight to collapse', () => {
  const doc = parseOrg('* A');
  applyStartupVisibility(doc, { visibility: 'showall' });
  const heading = doc.children[0];
  const result = cycleFoldLevel(heading);
  assert.equal(result, 'full');
  assert.equal(heading.drawersHidden, false);
});

test('cycleFoldLevel on a content-loaded heading correctly advances straight to full (reveals body), not straight to collapse', () => {
  const doc = parseOrg('* A\nbody text');
  applyStartupVisibility(doc, { visibility: 'content' });
  const heading = doc.children[0];
  const result = cycleFoldLevel(heading);
  assert.equal(result, 'full');
  assert.equal(heading.bodyHidden, false);
});

// ---- REGRESSION: archived headings must refuse to open via cycling, whether direct or cascading (real org: "An archived subtree does not open during visibility cycling") ----

test('cycleFoldLevel: swiping DIRECTLY on an archived, collapsed heading is a complete no-op (does not expand)', () => {
  const doc = parseOrg('* Parent\n** Archived child :ARCHIVE:\nsome archived content');
  const archivedChild = doc.children[0].children[0];
  applyStartupVisibility(doc, {}); // forces archivedChild.collapsed = true
  assert.equal(archivedChild.collapsed, true);

  const result = cycleFoldLevel(archivedChild, { archiveVisibility: 'archived' });
  assert.equal(archivedChild.collapsed, true, 'must stay collapsed -- real org refuses this regardless of direct vs cascading');
  assert.equal(result, 'collapsed');
});

test('cycleFoldLevel: repeated swipes on an archived heading never open it, no matter how many times', () => {
  const doc = parseOrg('* Archived :ARCHIVE:\nsome content');
  const archived = doc.children[0];
  applyStartupVisibility(doc, {});
  for (let i = 0; i < 5; i++) {
    cycleFoldLevel(archived, { archiveVisibility: 'archived' });
    assert.equal(archived.collapsed, true, `still collapsed after swipe ${i + 1}`);
  }
});

test('cycleFoldLevel: with archiveVisibility "noarchived" (org-cycle-open-archived-trees: t), an archived heading cycles completely normally', () => {
  const doc = parseOrg('* Archived :ARCHIVE:\nsome content');
  const archived = doc.children[0];
  applyStartupVisibility(doc, {}, 'noarchived'); // t means don't force-collapse at load either
  assert.equal(archived.collapsed, false);

  const result = cycleFoldLevel(archived, { archiveVisibility: 'noarchived' });
  assert.equal(result, 'full');
  assert.equal(archived.collapsed, false);
});

test('expandFully called directly on an archived heading is a complete no-op', () => {
  const doc = parseOrg('* Archived :ARCHIVE:\n** Child\nsome content');
  const archived = doc.children[0];
  applyStartupVisibility(doc, {});
  assert.equal(archived.collapsed, true);
  const childCollapsedBefore = archived.children[0].collapsed;

  expandFully(archived, { archiveVisibility: 'archived' });
  assert.equal(archived.collapsed, true, 'expandFully must refuse to touch an archived heading directly, not just its archived descendants');
  assert.equal(
    archived.children[0].collapsed,
    childCollapsedBefore,
    'nothing underneath should change either, since the whole call was refused before it even started walking'
  );
});

test('toggleFold: the chevron DOES open a collapsed archived heading -- deliberately different from swipe/cycleFoldLevel, this app\u2019s stand-in for Emacs\u2019s separate force-open mechanisms (C-c C-TAB etc.), not a second cycling implementation', () => {
  const doc = parseOrg('* Archived :ARCHIVE:\nsome content');
  const archived = doc.children[0];
  applyStartupVisibility(doc, {});
  assert.equal(archived.collapsed, true);

  const result = toggleFold(archived);
  assert.equal(archived.collapsed, false, 'the chevron must open it -- without this, archived content becomes permanently unreachable in a touch UI with no keyboard modifiers to fall back on');
  assert.equal(result, false);
});

test('toggleFold: an open archived heading can be re-collapsed via the chevron too, same as any other heading', () => {
  const doc = parseOrg('* Archived :ARCHIVE:\nsome content');
  const archived = doc.children[0];
  applyStartupVisibility(doc, {}, 'noarchived');
  assert.equal(archived.collapsed, false);

  const result = toggleFold(archived);
  assert.equal(archived.collapsed, true);
  assert.equal(result, true);
});

test('cycleFoldLevel: cascading from a PARENT still correctly skips an archived child too (the original, already-working case, re-confirmed alongside the direct-swipe fix)', () => {
  const doc = parseOrg('* Parent\n** Archived child :ARCHIVE:\nsome archived content\n** Normal child\nnormal content');
  applyStartupVisibility(doc, {});
  const parent = doc.children[0];
  const archivedChild = parent.children[0];

  cycleFoldLevel(parent, { archiveVisibility: 'archived' }); // starts fully expanded by default -> collapses
  cycleFoldLevel(parent, { archiveVisibility: 'archived' }); // -> one level
  cycleFoldLevel(parent, { archiveVisibility: 'archived' }); // -> full
  assert.equal(archivedChild.collapsed, true, 'cascading into it from the parent must still skip it, unchanged from before');
});

// ---- REGRESSION: properties revealed via full-expand must actually hide again on collapse (the reported bug: "swiped left, it showed properties, no way to make it go away") ----

test('REGRESSION: drawersHidden correctly resets across a full swipe cycle -- collapsed -> children -> full -> collapsed -> children -> full', () => {
  const doc = parseOrg('* Simmule :contact:\n:PROPERTIES:\n:fname: Simmule\n:END:');
  const heading = doc.children[0];
  applyStartupVisibility(doc, { visibility: 'overview' }); // starts collapsed, so the first cycleFoldLevel call below lands on the "children" step as intended
  assert.equal(heading.collapsed, true);

  cycleFoldLevel(heading); // -> children
  assert.equal(heading.drawersHidden, true, 'one-level step must not show properties');

  assert.equal(cycleFoldLevel(heading), 'full');
  assert.equal(heading.drawersHidden, false, 'full expand correctly reveals properties');

  assert.equal(cycleFoldLevel(heading), 'collapsed');
  assert.equal(heading.drawersHidden, true, 'THE ACTUAL BUG: collapsing must re-hide properties, not leave them stuck visible for the rest of the session');

  // And it has to keep working on every subsequent cycle too, not just the first one.
  assert.equal(cycleFoldLevel(heading), 'children');
  assert.equal(heading.drawersHidden, true);
  assert.equal(cycleFoldLevel(heading), 'full');
  assert.equal(heading.drawersHidden, false);
  assert.equal(cycleFoldLevel(heading), 'collapsed');
  assert.equal(heading.drawersHidden, true);
});

test('REGRESSION: drawersHidden also resets correctly via the chevron (toggleFold), not just the swipe gesture', () => {
  const doc = parseOrg('* Simmule :contact:\n:PROPERTIES:\n:fname: Simmule\n:END:');
  const heading = doc.children[0];
  applyStartupVisibility(doc, {});
  heading.collapsed = true;
  heading.drawersHidden = true;

  toggleFold(heading); // open
  assert.equal(heading.collapsed, false);
  assert.equal(heading.drawersHidden, false, 'the chevron is the full-reveal mechanism, so opening should reveal properties immediately -- this is also the ONLY way to ever see an archived heading\u2019s properties, since swipe refuses to touch archived headings at all');

  toggleFold(heading); // close
  assert.equal(heading.collapsed, true);
  assert.equal(heading.drawersHidden, true, 'closing via chevron must also re-hide properties -- same bug, same fix, different UI trigger');
});

test('REGRESSION: collapseFully resets drawersHidden for the whole subtree, not just the top heading', () => {
  const doc = parseOrg('* Parent\n** Child\n:PROPERTIES:\n:id: abc\n:END:');
  const parent = doc.children[0];
  const child = parent.children[0];
  applyStartupVisibility(doc, {});
  expandFully(parent); // reveals everything, including child's properties
  assert.equal(child.drawersHidden, false);

  collapseFully(parent);
  assert.equal(child.drawersHidden, true, 'a descendant\u2019s revealed properties must also re-hide when the whole subtree collapses, not just the heading collapseFully was called on directly');
});
