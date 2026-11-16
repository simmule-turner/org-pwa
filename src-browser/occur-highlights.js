// @ts-check
// The highlights of a sparse tree (`org-occur-highlights`): the matched text of the visible outline, kept until the next edit, the next
// sparse tree or C-c C-c, as Emacs keeps them.
import { S } from './app-state.js';

const NAME = 'org-occur';
const PAINTED = { on: false };

/** Takes the painted highlight away, when there is one. */
function unpaint() {
  if (!PAINTED.on) return;
  CSS.highlights.delete(NAME);
  PAINTED.on = false;
}

/** Paints the text the sparse tree matched. Called after the outline is drawn. */
export function paintOccurHighlights() {
  const texts = S.occurHighlights;
  if (!texts || !texts.length || !S.sparseNarrowScope) {
    unpaint();
    return;
  }
  const outline = document.getElementById('outline');
  if (!outline) return;
  const re = new RegExp(texts.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
  /** @type {Range[]} */
  const ranges = [];
  const walker = document.createTreeWalker(outline, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = node.nodeValue || '';
    for (const m of value.matchAll(re)) {
      const range = new Range();
      range.setStart(node, /** @type {number} */ (m.index));
      range.setEnd(node, /** @type {number} */ (m.index) + m[0].length);
      ranges.push(range);
    }
  }
  CSS.highlights.set(NAME, new Highlight(...ranges));
  PAINTED.on = true;
}

/** `org-remove-occur-highlights`. @returns {boolean} whether there were any */
export function clearOccurHighlights() {
  const had = Boolean(S.occurHighlights);
  S.occurHighlights = null;
  unpaint();
  return had;
}
