import test from 'node:test';
import assert from 'node:assert/strict';
import { findScrollingAncestor } from '../src/scroll-util.js';

/** A minimal mock element -- just enough of the real DOM element shape
 *  for findScrollingAncestor to walk: scrollHeight/clientHeight (the
 *  overflow check), parentElement (the walk itself), and an id purely
 *  for making test assertions/failure messages readable. */
function mockEl({ id, scrollHeight = 100, clientHeight = 100, overflowY = 'visible', parentElement = null }) {
  return { id, scrollHeight, clientHeight, overflowY, parentElement };
}

function mockDoc(bodyEl) {
  return { body: bodyEl };
}

function mockWin(overflowYByEl) {
  return { getComputedStyle: (el) => ({ overflowY: overflowYByEl.get(el) || el.overflowY }) };
}

test('THE FIX: mobile layout -- #outline never actually overflows (no overflow-y:auto CSS rule applies on a narrow screen), #contentArea (its parent) does -- returns #contentArea, not #outline itself', () => {
  const body = mockEl({ id: 'body' });
  const contentArea = mockEl({ id: 'contentArea', scrollHeight: 2000, clientHeight: 800, overflowY: 'auto', parentElement: body });
  // #outline on mobile: scrollHeight === clientHeight (never overflows), no overflow-y:auto rule even applies
  const outline = mockEl({ id: 'outline', scrollHeight: 500, clientHeight: 500, overflowY: 'visible', parentElement: contentArea });

  const result = findScrollingAncestor(outline, mockDoc(body), mockWin(new Map()));
  assert.equal(result.id, 'contentArea', 'must walk up past #outline (which never overflows on mobile) to find the real scrolling container');
});

test('THE FIX: desktop layout -- #outline itself has overflow-y:auto AND actually overflows -- returns #outline directly, no need to walk further', () => {
  const body = mockEl({ id: 'body' });
  // #contentArea on desktop: overflow-y:auto is still present in the CSS, but doesn't actually trigger (per index.html's own comment) -- not overflowing here
  const contentArea = mockEl({ id: 'contentArea', scrollHeight: 800, clientHeight: 800, overflowY: 'auto', parentElement: body });
  const outline = mockEl({ id: 'outline', scrollHeight: 2000, clientHeight: 800, overflowY: 'auto', parentElement: contentArea });

  const result = findScrollingAncestor(outline, mockDoc(body), mockWin(new Map()));
  assert.equal(result.id, 'outline');
});

test('an element with overflow-y:auto but NOT actually overflowing (scrollHeight === clientHeight) is correctly skipped, not returned just because the CSS property is set', () => {
  const body = mockEl({ id: 'body' });
  const contentArea = mockEl({ id: 'contentArea', scrollHeight: 2000, clientHeight: 800, overflowY: 'auto', parentElement: body });
  const outline = mockEl({ id: 'outline', scrollHeight: 400, clientHeight: 400, overflowY: 'auto', parentElement: contentArea }); // has the CSS property, but genuinely isn't overflowing right now

  const result = findScrollingAncestor(outline, mockDoc(body), mockWin(new Map()));
  assert.equal(result.id, 'contentArea', 'CSS overflow-y:auto alone is not enough -- must actually be overflowing too');
});

test('an element that overflows but has overflow-y:visible (not auto/scroll) is correctly skipped -- overflowing content alone doesn\u2019t make it a scroll container', () => {
  const body = mockEl({ id: 'body' });
  const contentArea = mockEl({ id: 'contentArea', scrollHeight: 2000, clientHeight: 800, overflowY: 'auto', parentElement: body });
  // Overflowing, but overflow-y:visible -- this is NOT what actually scrolls, just content spilling out visually
  const middle = mockEl({ id: 'middle', scrollHeight: 1000, clientHeight: 300, overflowY: 'visible', parentElement: contentArea });
  const outline = mockEl({ id: 'outline', scrollHeight: 400, clientHeight: 400, overflowY: 'visible', parentElement: middle });

  const result = findScrollingAncestor(outline, mockDoc(body), mockWin(new Map()));
  assert.equal(result.id, 'contentArea');
});

test('nothing overflowing anywhere -- falls back to the original element itself, a harmless no-op (nothing is scrolled either way)', () => {
  const body = mockEl({ id: 'body' });
  const contentArea = mockEl({ id: 'contentArea', scrollHeight: 400, clientHeight: 400, overflowY: 'auto', parentElement: body });
  const outline = mockEl({ id: 'outline', scrollHeight: 300, clientHeight: 300, overflowY: 'visible', parentElement: contentArea });

  const result = findScrollingAncestor(outline, mockDoc(body), mockWin(new Map()));
  assert.equal(result, outline);
});

test('the walk stops at document.body and does not go further up (html/window), even if body itself technically overflows', () => {
  const body = mockEl({ id: 'body', scrollHeight: 5000, clientHeight: 800, overflowY: 'auto' }); // no parentElement set -- walk must stop here regardless
  const outline = mockEl({ id: 'outline', scrollHeight: 300, clientHeight: 300, overflowY: 'visible', parentElement: body });

  const result = findScrollingAncestor(outline, mockDoc(body), mockWin(new Map()));
  assert.equal(result, outline, 'body itself is excluded from consideration -- the loop\u2019s own stop condition, not a scrolling candidate');
});

test('subpixel rounding tolerance: scrollHeight exceeding clientHeight by less than 1px does not count as overflowing', () => {
  const body = mockEl({ id: 'body' });
  const contentArea = mockEl({ id: 'contentArea', scrollHeight: 800.4, clientHeight: 800, overflowY: 'auto', parentElement: body });
  const outline = mockEl({ id: 'outline', scrollHeight: 300, clientHeight: 300, overflowY: 'visible', parentElement: contentArea });

  const result = findScrollingAncestor(outline, mockDoc(body), mockWin(new Map()));
  assert.equal(result.id, 'outline', 'a sub-1px difference is rounding noise, not real overflow -- should fall through to the no-op fallback');
});

test('overflow-y:scroll (not just auto) is also correctly recognized as scrollable', () => {
  const body = mockEl({ id: 'body' });
  const contentArea = mockEl({ id: 'contentArea', scrollHeight: 2000, clientHeight: 800, overflowY: 'scroll', parentElement: body });
  const outline = mockEl({ id: 'outline', scrollHeight: 300, clientHeight: 300, overflowY: 'visible', parentElement: contentArea });

  const result = findScrollingAncestor(outline, mockDoc(body), mockWin(new Map()));
  assert.equal(result.id, 'contentArea');
});
