// @ts-check
/**
 * A textarea that shows folded text but answers as if it held all of it: `value`, the selection and `setRangeText` speak in buffer positions,
 * while the field itself shows each hidden stretch as `...`. Everything that reads or writes the text (the editing commands, Save, the Line
 * menu) goes on working on the buffer; only the picture is folded.
 */
import { adjustHidden, foldView, settleHidden } from '../src/org-fold.js';

/** @typedef {import('../src/org-fold.js').Range} Range */

/** @param {string} a @param {string} b @returns {{ head: number, tail: number }} how much of the start and end the two share */
function common(a, b) {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  return { head, tail };
}

/** The fold view of each textarea that has one, for what draws the text. @type {WeakMap<HTMLTextAreaElement, () => ReturnType<typeof foldView>>} */
const views = new WeakMap();

/** The text a field shows (folded text as `...`), and how its places map to the buffer's; the buffer's own text with an identity map when it is not folded.
 * @param {HTMLTextAreaElement} ta */
export function shownView(ta) {
  const view = views.get(ta);
  return view ? view() : null;
}

/**
 * @param {HTMLTextAreaElement} ta
 * @returns {{ setHidden: (hidden: Range[]) => void, hidden: () => Range[], view: () => ReturnType<typeof foldView>, apply: (next: string, edits: Array<{ from: number, removed: string, inserted: number }>) => void }}
 */
export function foldTextarea(ta) {
  const proto = HTMLTextAreaElement.prototype;
  const valueProp = /** @type {PropertyDescriptor} */ (Object.getOwnPropertyDescriptor(proto, 'value'));
  const startProp = /** @type {PropertyDescriptor} */ (Object.getOwnPropertyDescriptor(proto, 'selectionStart'));
  const endProp = /** @type {PropertyDescriptor} */ (Object.getOwnPropertyDescriptor(proto, 'selectionEnd'));
  let text = valueProp.get?.call(ta) ?? '';
  /** @type {Range[]} */
  let hidden = [];
  let view = foldView(text, hidden);
  /** Tells what draws the field's text that the picture changed. */
  const shownChanged = () => ta.dispatchEvent(new Event('te-fold'));

  /** Writes the fold's picture into the field, keeping the caret at the same buffer place. @param {number} anchor @param {number} focus @param {'forward' | 'backward' | 'none'} [dir] */
  function paint(anchor, focus, dir = 'none') {
    view = foldView(text, hidden);
    if (valueProp.get?.call(ta) !== view.display) valueProp.set?.call(ta, view.display);
    ta.setSelectionRange(Math.min(anchor, focus), Math.max(anchor, focus), dir);
    shownChanged();
  }

  /** Takes in what the browser changed in the field (typing, IME, paste, execCommand): the difference becomes an edit of the buffer. */
  function reconcile() {
    const dom = valueProp.get?.call(ta) ?? '';
    if (dom === view.display) return;
    const { head, tail } = common(view.display, dom);
    const from = view.toBuffer(head);
    const to = view.toBuffer(view.display.length - tail);
    const insert = dom.slice(head, dom.length - tail);
    const caret = startProp.get?.call(ta) ?? 0;
    text = text.slice(0, from) + insert + text.slice(Math.max(from, to));
    hidden = adjustHidden(hidden, from, Math.max(from, to) - from, insert.length);
    const mapped = foldView(text, hidden);
    const spot = from + insert.length;
    view = mapped;
    if (dom !== mapped.display) {
      valueProp.set?.call(ta, mapped.display);
      ta.setSelectionRange(mapped.toDisplay(spot), mapped.toDisplay(spot));
      shownChanged();
    } else ta.setSelectionRange(caret, caret);
  }

  /** @param {string} next replaces the whole buffer */
  function replace(next) {
    const { head, tail } = common(text, next);
    hidden = adjustHidden(hidden, head, text.length - head - tail, next.length - head - tail);
    text = next;
    paint(next.length, next.length);
  }

  Object.defineProperty(ta, 'value', {
    configurable: true,
    get() {
      reconcile();
      return text;
    },
    set(v) {
      reconcile();
      replace(String(v));
    },
  });
  Object.defineProperty(ta, 'selectionStart', {
    configurable: true,
    get() {
      reconcile();
      return view.toBuffer(startProp.get?.call(ta) ?? 0);
    },
    set(v) {
      reconcile();
      startProp.set?.call(ta, view.toDisplay(v));
    },
  });
  Object.defineProperty(ta, 'selectionEnd', {
    configurable: true,
    get() {
      reconcile();
      return view.toBuffer(endProp.get?.call(ta) ?? 0);
    },
    set(v) {
      reconcile();
      endProp.set?.call(ta, view.toDisplay(v));
    },
  });
  const realRange = proto.setSelectionRange;
  ta.setSelectionRange = (/** @type {number} */ a, /** @type {number} */ b, /** @type {'forward' | 'backward' | 'none' | undefined} */ dir) => {
    reconcile();
    realRange.call(ta, view.toDisplay(a), view.toDisplay(b), dir);
  };
  ta.setRangeText = /** @type {HTMLTextAreaElement['setRangeText']} */ ((/** @type {string} */ r, /** @type {number} */ from, /** @type {number} */ to, /** @type {SelectionMode | undefined} */ mode) => {
    reconcile();
    const a = from ?? view.toBuffer(startProp.get?.call(ta) ?? 0);
    const b = to ?? view.toBuffer(endProp.get?.call(ta) ?? 0);
    const next = text.slice(0, a) + r + text.slice(b);
    hidden = adjustHidden(hidden, a, b - a, r.length);
    text = next;
    const end = a + r.length;
    const [x, y] = mode === 'select' ? [a, end] : mode === 'start' ? [a, a] : mode === 'end' ? [end, end] : [Math.min(view.toBuffer(startProp.get?.call(ta) ?? 0), next.length), Math.min(view.toBuffer(endProp.get?.call(ta) ?? 0), next.length)];
    view = foldView(text, hidden);
    valueProp.set?.call(ta, view.display);
    realRange.call(ta, view.toDisplay(x), view.toDisplay(y));
    shownChanged();
  });

  views.set(ta, () => {
    reconcile();
    return view;
  });
  return {
    /** Shows these stretches folded. @param {Range[]} next */
    setHidden(next) {
      reconcile();
      const a = view.toBuffer(startProp.get?.call(ta) ?? 0);
      const b = view.toBuffer(endProp.get?.call(ta) ?? 0);
      hidden = next.filter(([x, y]) => y > x);
      view = foldView(text, hidden);
      valueProp.set?.call(ta, view.display);
      realRange.call(ta, view.toDisplay(a), view.toDisplay(b));
      shownChanged();
    },
    /** The text after a command: the stretches follow each edit it made, and the field shows the result. @param {string} next @param {Array<{ from: number, removed: string, inserted: number }>} edits */
    apply(next, edits) {
      reconcile();
      for (const e of edits) hidden = adjustHidden(hidden, e.from, e.removed.length, e.inserted);
      text = next;
      hidden = settleHidden(text, hidden);
      view = foldView(text, hidden);
      valueProp.set?.call(ta, view.display);
      shownChanged();
    },
    hidden: () => hidden,
    view: () => {
      reconcile();
      return view;
    },
  };
}
