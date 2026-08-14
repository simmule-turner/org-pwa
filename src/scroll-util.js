/**
 * findScrollingAncestor: finds the nearest ancestor of `el` (inclusive)
 * that is actually scrolling right now -- has more content than fits
 * (scrollHeight > clientHeight) and a computed overflow-y that lets it
 * scroll at all.
 *
 * Why this exists as its own function, not just inline logic: this
 * app's own layout has TWO different possible scrolling containers
 * depending on screen width. #contentArea has overflow-y:auto
 * unconditionally; #outline/#sidePanel only get their own overflow-y:auto
 * CSS rule inside the >=900px desktop media query. On a phone, #outline
 * never actually overflows at all -- its parent, #contentArea, does. A
 * caller that reads/writes scrollTop on a specific, hardcoded element
 * (e.g. always #outline, assuming that's "the" scroll container) is
 * therefore silently wrong on whichever layout that element ISN'T
 * actually the scrolling one for -- a confirmed, real bug (see
 * renderSettingsView's own use of this in app.js): "Check for updates"
 * was faithfully saving and restoring the scroll position of an element
 * that never actually scrolls on mobile, always reading back 0.
 *
 * This is a plain CSS/layout fact, true on both iOS and Android equally
 * -- not a platform-specific quirk. Walking up to find whichever
 * ancestor is ACTUALLY overflowing right now, rather than assuming a
 * specific element, fixes this correctly on both the mobile
 * (#contentArea) and desktop (the target element itself) layouts
 * without branching on screen width directly, and stays correct if the
 * CSS breakpoints ever change later.
 */
export function findScrollingAncestor(el, doc = document, win = window) {
  let node = el;
  while (node && node !== doc.body) {
    if (node.scrollHeight > node.clientHeight + 1) {
      // +1 tolerance for subpixel rounding
      const style = win.getComputedStyle(node);
      if (style.overflowY === 'auto' || style.overflowY === 'scroll') return node;
    }
    node = node.parentElement;
  }
  return el; // nothing found actually overflowing -- harmless no-op either way, since nothing's scrolled
}
