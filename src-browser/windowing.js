// @ts-check
// Row windowing: in a very long list only the rows near the screen are drawn; spacers of the right height stand in for the rest, so
// the browser lays out a few dozen rows instead of thousands. The arithmetic is src/window-math.js. This file does the DOM work: it
// keeps the drawn rows, measures them, corrects the scroll position when a measurement moves the content, and gives every caller that
// needs a particular row on screen one place to ask (ensureRowRendered / scrollToRow).
import { buildOffsets, estimateHeight, sameRanges, spacerHeights, windowRanges } from '../src/window-math.js';
import { scrollContainer } from './chrome.js';
import { contentAreaEl, outlineEl } from './dom.js';

const OVERSCAN_SCREENS = 2; // rows are drawn this many screens past the edge, on each side
const PIN_MS = 6000; // a row asked for by ensureRowRendered stays drawn this long (the highlight after a jump lasts as long)
const MAX_PASSES = 3; // measuring can change which rows are needed; settle in a few rounds
const MAX_LINES = 40;

/**
 * @typedef {{ key: object, build: () => HTMLElement, kind?: 'heading' | 'body', lines?: number }} WindowItem
 * @typedef {{ forced?: () => Iterable<object | null | undefined> }} WindowOptions
 * @typedef {{
 *   host: HTMLElement, items: WindowItem[], opts: WindowOptions, index: Map<object, number>, els: Map<number, HTMLElement>,
 *   heights: Float64Array, measured: Uint8Array, offsets: Float64Array, dirty: boolean, ranges: [number, number][],
 *   spacers: HTMLElement[], pinned: Set<number>, pinTimer: number, raf: number, dead: boolean, onScroll: () => void,
 *   average: { heading: number, body: number },
 * }} Mount
 */

/** Measured heights by row object, kept across renders, and a running average per kind of row for the ones not measured yet. */
const heightCache = {
  /** @type {WeakMap<object, number>} */ byKey: new WeakMap(),
  sum: { heading: 0, body: 0 },
  count: { heading: 0, body: 0 },
};

/** The one mount that is live. A holder object, not a module-level `let`. */
const live = /** @type {{ mount: Mount | null }} */ ({ mount: null });

/** @param {'heading' | 'body'} kind */
function averageOf(kind) {
  const n = heightCache.count[kind];
  return n > 0 ? heightCache.sum[kind] / n : 0;
}

/** The averages as they are now. A mount takes them once and keeps them: estimates that drift as rows are measured would move every
 * row below the screen, and with it the scroll position, on each frame of a scroll.
 * @returns {{ heading: number, body: number }} */
function currentAverages() {
  const heading = averageOf('heading');
  const body = averageOf('body');
  return { heading: heading || body, body: body || heading };
}

/** @param {Mount} m @param {WindowItem} item */
function estimateFor(m, item) {
  return estimateHeight(m.average[item.kind || 'body'], Math.min(MAX_LINES, item.lines || 1));
}

/** Records a measured height; returns true when it differs from what the offsets were built with.
 * @param {WindowItem} item @param {number} height */
function remember(item, height) {
  const kind = item.kind || 'body';
  const before = heightCache.byKey.get(item.key);
  if (before === undefined) {
    heightCache.sum[kind] += height;
    heightCache.count[kind] += 1;
  } else {
    heightCache.sum[kind] += height - before;
  }
  heightCache.byKey.set(item.key, height);
}

/** @param {Mount} m */
function refreshHeights(m) {
  const { items, heights, measured } = m;
  for (let i = 0; i < items.length; i += 1) {
    const known = heightCache.byKey.get(items[i].key);
    if (known !== undefined) {
      heights[i] = known;
      measured[i] = 1;
    } else {
      heights[i] = estimateFor(m, items[i]);
      measured[i] = 0;
    }
  }
  m.offsets = buildOffsets(heights);
  m.dirty = false;
}

function makeSpacer() {
  const el = document.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  el.dataset.windowSpacer = '1';
  el.style.cssText = 'height:0;margin:0;padding:0;border:0;pointer-events:none;flex:none';
  return el;
}

/** @param {Mount} m @param {number} k */
function spacerAt(m, k) {
  while (m.spacers.length <= k) m.spacers.push(makeSpacer());
  return m.spacers[k];
}

/** The indices that must stay drawn however far off screen: what the caller names, what holds focus, what was asked for.
 * @param {Mount} m */
function forcedIndices(m) {
  /** @type {Set<number>} */
  const out = new Set(m.pinned);
  for (const key of (m.opts.forced && m.opts.forced()) || []) {
    const at = key ? m.index.get(key) : undefined;
    if (at !== undefined) out.add(at);
  }
  const active = document.activeElement;
  const holder = active && m.host.contains(active) ? active.closest('[data-wi]') : null;
  if (holder) out.add(Number(/** @type {HTMLElement} */ (holder).dataset.wi));
  return out;
}

/** Brings the DOM to exactly the rows in `ranges` with the spacers between, touching only what changed.
 * @param {Mount} m @param {[number, number][]} ranges */
function applyRanges(m, ranges) {
  /** @type {Set<number>} */
  const want = new Set();
  for (const [s, e] of ranges) for (let i = s; i < e; i += 1) want.add(i);
  for (const [i, el] of m.els) {
    if (want.has(i)) continue;
    el.remove();
    m.els.delete(i);
  }
  const gaps = spacerHeights(m.offsets, ranges);
  for (let k = ranges.length + 1; k < m.spacers.length; k += 1) m.spacers[k].remove();
  m.spacers.length = Math.max(1, Math.min(m.spacers.length, ranges.length + 1));
  let cursor = spacerAt(m, 0);
  gaps.forEach((height, k) => {
    const spacer = spacerAt(m, k);
    spacer.style.height = height + 'px';
    if (k > 0) {
      if (cursor.nextSibling !== spacer) m.host.insertBefore(spacer, cursor.nextSibling);
      cursor = spacer;
    }
    if (k >= ranges.length) return;
    const [s, e] = ranges[k];
    for (let i = s; i < e; i += 1) {
      let el = m.els.get(i);
      if (!el) {
        el = m.items[i].build();
        el.dataset.wi = String(i);
        m.els.set(i, el);
      }
      if (cursor.nextSibling !== el) m.host.insertBefore(el, cursor.nextSibling);
      cursor = el;
    }
  });
  m.ranges = ranges;
}

/** Measures the drawn rows; true when any differs from the height the offsets assumed.
 * @param {Mount} m */
function measure(m) {
  let changed = false;
  for (const [i, el] of m.els) {
    const height = el.getBoundingClientRect().height;
    if (!m.measured[i] || Math.abs(height - m.heights[i]) > 0.5) changed = true;
    remember(m.items[i], height);
  }
  if (changed) m.dirty = true;
  return changed;
}

/** The drawn row nearest the top of the screen that is actually on screen, or -1: the one whose position is held steady.
 * @param {Mount} m @param {number} viewTop @param {number} viewBottom */
function firstVisibleRow(m, viewTop, viewBottom) {
  let best = -1;
  for (const [i, el] of m.els) {
    if (best !== -1 && i > best) continue;
    const rect = el.getBoundingClientRect();
    if (rect.bottom > viewTop && rect.top < viewBottom) best = i;
  }
  return best;
}

/** Draws the rows for the current scroll position. Safe to call at any time.
 * @param {Mount} m */
function sync(m) {
  if (m.dead) return;
  if (!m.spacers[0].isConnected) {
    destroy(m);
    return;
  }
  if (m.host.getClientRects().length === 0) return; // hidden: nothing can be measured
  const scroller = scrollContainer();
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    if (m.dirty) refreshHeights(m);
    const scrollerRect = scroller.getBoundingClientRect();
    const viewTop = scrollerRect.top + scroller.clientTop;
    const viewHeight = scroller.clientHeight || window.innerHeight;
    const listTop = m.spacers[0].getBoundingClientRect().top;
    const top = viewTop - listTop;
    const ranges = windowRanges({ offsets: m.offsets, top, bottom: top + viewHeight, overscan: viewHeight * OVERSCAN_SCREENS, forced: forcedIndices(m) });
    const anchor = firstVisibleRow(m, viewTop, viewTop + viewHeight);
    const anchorTop = anchor === -1 ? 0 : /** @type {HTMLElement} */ (m.els.get(anchor)).getBoundingClientRect().top;
    const unchanged = sameRanges(ranges, m.ranges);
    if (!unchanged) applyRanges(m, ranges);
    const moved = measure(m);
    if (m.dirty) {
      refreshHeights(m);
      applyRanges(m, m.ranges); // new spacer heights from the measured rows
    }
    if (anchor !== -1 && m.els.has(anchor)) {
      const shift = /** @type {HTMLElement} */ (m.els.get(anchor)).getBoundingClientRect().top - anchorTop;
      if (Math.abs(shift) > 0.5) scroller.scrollTop += shift;
    }
    if (unchanged && !moved) break;
  }
}

/** @param {Mount} m */
function schedule(m) {
  if (m.raf || m.dead) return;
  m.raf = requestAnimationFrame(() => {
    m.raf = 0;
    sync(m);
  });
}

/** @param {Mount} m */
function destroy(m) {
  m.dead = true;
  if (m.raf) cancelAnimationFrame(m.raf);
  clearTimeout(m.pinTimer);
  contentAreaEl.removeEventListener('scroll', m.onScroll);
  outlineEl.removeEventListener('scroll', m.onScroll);
  window.removeEventListener('resize', m.onScroll);
  m.host.style.removeProperty('overflow-anchor');
  if (live.mount === m) live.mount = null;
}

/** Stops windowing: the list is drawn in full again (or another screen owns the area). */
export function destroyWindow() {
  if (live.mount) destroy(live.mount);
}

/** True while a windowed list is on screen. */
export function windowingActive() {
  return !!live.mount && !live.mount.dead && live.mount.spacers[0].isConnected;
}

/**
 * Draws `items` into `host` (which must be empty) as a window. Replaces any earlier mount.
 * @param {HTMLElement} host
 * @param {WindowItem[]} items
 * @param {WindowOptions} [opts]
 */
export function mountWindow(host, items, opts = {}) {
  destroyWindow();
  const index = new Map();
  items.forEach((item, i) => index.set(item.key, i));
  /** @type {Mount} */
  const m = {
    host, items, opts, index, els: new Map(), heights: new Float64Array(items.length), measured: new Uint8Array(items.length),
    offsets: new Float64Array(1), dirty: true, ranges: [], spacers: [], pinned: new Set(), pinTimer: 0, raf: 0, dead: false,
    onScroll: () => schedule(m),
    average: currentAverages(),
  };
  refreshHeights(m);
  host.style.overflowAnchor = 'none'; // the scroll correction below is ours; the browser's own would add to it
  const first = spacerAt(m, 0);
  first.style.height = m.offsets[items.length] + 'px'; // the full height from the start, so the scroll position survives the first layout
  host.appendChild(first);
  live.mount = m;
  contentAreaEl.addEventListener('scroll', m.onScroll, { passive: true });
  outlineEl.addEventListener('scroll', m.onScroll, { passive: true });
  window.addEventListener('resize', m.onScroll, { passive: true });
  sync(m);
  m.average = currentAverages(); // now that rows were measured: estimates for the rest, fixed from here on
  m.dirty = true;
  sync(m);
}

/**
 * Makes sure the row for `target` (a heading, a list item or another row's node) is drawn, and returns its element; null when the
 * list is not windowed or the target is not in it. The row stays drawn for a few seconds, past the scroll that follows.
 * @param {object | null | undefined} target
 * @returns {HTMLElement | null}
 */
export function ensureRowRendered(target) {
  const m = live.mount;
  if (!target || !m || m.dead || !m.spacers[0].isConnected) return null;
  const at = m.index.get(target);
  if (at === undefined) return null;
  const have = m.els.get(at);
  if (have) return have;
  m.pinned.add(at);
  clearTimeout(m.pinTimer);
  m.pinTimer = window.setTimeout(() => {
    m.pinned.clear();
    schedule(m);
  }, PIN_MS);
  sync(m);
  return m.els.get(at) || null;
}

/**
 * Scrolls the row for `target` into view, drawing it first when it is not drawn. Returns its element, or null when the list is
 * not windowed or does not hold the target (the caller then looks the element up the way it always did).
 * @param {object | null | undefined} target
 * @param {ScrollIntoViewOptions} [options]
 */
export function scrollToRow(target, options = { block: 'nearest' }) {
  const el = ensureRowRendered(target);
  if (el) el.scrollIntoView(options);
  return el;
}

/** The key of every row of the windowed list, in order, or null when no list is windowed. */
export function windowItemKeys() {
  const m = live.mount;
  return m && !m.dead && m.spacers[0].isConnected ? m.items.map((item) => item.key) : null;
}
