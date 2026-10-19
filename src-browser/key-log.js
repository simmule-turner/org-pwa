// @ts-check
// A short, in-memory trail of what happens around the floating keyboard in the Text view (taps, where the cursor was
// and ended up, focus, redraws), for working out why the cursor sometimes lands on another line on a phone. It is kept
// only in memory and only leaves the device when the person copies it ("Copy keyboard debug log" in the palette).

/** @type {{ t: number, what: string }[]} */
const entries = [];
const startedAt = Date.now();
const LIMIT = 500;
/** Where the last floating-keyboard tap left the cursor, and when: later selection changes are compared against it. */
const lastTap = { at: 0, expected: -1 };

/**
 * @param {string} what
 * @param {Record<string, unknown>} [detail]
 */
export function noteKeyLog(what, detail = {}) {
  const parts = Object.entries(detail).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`);
  entries.push({ t: Date.now() - startedAt, what: [what, ...parts].join(' ') });
  if (entries.length > LIMIT) entries.splice(0, entries.length - LIMIT);
}

/** @param {number} expected */
export function noteExpectedCaret(expected) {
  lastTap.at = Date.now();
  lastTap.expected = expected;
}

/** What the Text view's editor looks like right now, as a few short numbers.
 * @param {HTMLTextAreaElement} t */
export function describeEditor(t) {
  const before = t.value.slice(0, t.selectionStart);
  return {
    sel: [t.selectionStart, t.selectionEnd, t.selectionDirection],
    line: before.split('\n').length,
    col: t.selectionStart - before.lastIndexOf('\n') - 1,
    len: t.value.length,
    scroll: [Math.round(t.scrollTop), Math.round(t.scrollLeft)],
    focus: document.activeElement === t,
    mode: t.inputMode || '',
  };
}

/** Where the editor's own caret is drawn, measured on a hidden copy of the textarea, against where the coloured text layer
 *  puts the same character: a row number each (0 is the first row of text), plus the metrics both are drawn with. A row that
 *  differs from the cursor's line is what would look like the cursor jumping.
 * @param {HTMLTextAreaElement} t */
export function caretGeometry(t) {
  const cs = getComputedStyle(t);
  const lh = parseFloat(cs.lineHeight) || 1;
  const pad = parseFloat(cs.paddingTop) || 0;
  const mirror = document.createElement('div');
  mirror.style.cssText = `position:absolute;visibility:hidden;top:0;left:-9999px;overflow:hidden;box-sizing:border-box;width:${t.clientWidth}px;`;
  for (const prop of ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'white-space', 'overflow-wrap', 'word-break', 'tab-size', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left']) mirror.style.setProperty(prop, cs.getPropertyValue(prop));
  mirror.textContent = t.value.slice(0, t.selectionStart);
  const mark = document.createElement('span');
  mark.textContent = '\u200b';
  mirror.appendChild(mark);
  document.body.appendChild(mirror);
  const mirrorRow = Math.round((mark.offsetTop - pad) / lh);
  const mirrorX = Math.round(mark.offsetLeft);
  mirror.remove();
  /** @type {number | string} */
  let backRow = 'none';
  const back = t.parentElement && t.parentElement.querySelector('.te-back');
  const before = t.value.slice(0, t.selectionStart);
  const lineEl = back && /** @type {HTMLElement | undefined} */ (back.children[before.split('\n').length - 1]);
  if (back && lineEl) {
    const col = t.selectionStart - before.lastIndexOf('\n') - 1;
    const range = document.createRange();
    const walker = document.createTreeWalker(lineEl, 4 /* NodeFilter.SHOW_TEXT */);
    let left = col;
    let node = walker.nextNode();
    while (node && left > (node.textContent || '').length) {
      left -= (node.textContent || '').length;
      node = walker.nextNode();
    }
    if (node) {
      range.setStart(node, Math.min(left, (node.textContent || '').length));
      range.collapse(true);
      const r = range.getClientRects()[0] || lineEl.getBoundingClientRect();
      backRow = Math.round((r.top - back.getBoundingClientRect().top - pad) / lh);
    }
  }
  const bs = back ? getComputedStyle(back) : null;
  return {
    mirrorRow,
    mirrorX,
    backRow,
    ta: [cs.fontSize, cs.lineHeight, cs.whiteSpace, t.wrap, t.clientWidth, t.scrollWidth, cs.fontFamily.slice(0, 24)],
    back: bs ? [bs.fontSize, bs.lineHeight, bs.whiteSpace] : null,
  };
}

const editor = () => /** @type {HTMLTextAreaElement | null} */ (document.getElementById('document-text-edit-input'));

if (typeof document !== 'undefined') {
  document.addEventListener('selectionchange', () => {
    const t = editor();
    if (!t || document.activeElement !== t || Date.now() - lastTap.at > 4000) return;
    if (t.selectionStart === lastTap.expected && t.selectionEnd === lastTap.expected) return; // just what the tap set
    noteKeyLog('SELECTION CHANGED after a tap', { expected: lastTap.expected, ...describeEditor(t), msSinceTap: Date.now() - lastTap.at });
  });
  document.addEventListener('visibilitychange', () => noteKeyLog('visibility', { state: document.visibilityState }));
  document.addEventListener(
    'focusin',
    (e) => {
      const t = editor();
      if (t && e.target === t) noteKeyLog('editor focus', describeEditor(t));
    },
    true
  );
  document.addEventListener(
    'focusout',
    (e) => {
      const t = editor();
      if (t && e.target === t) noteKeyLog('editor blur', describeEditor(t));
    },
    true
  );
  document.addEventListener(
    'pointerdown',
    (e) => {
      const t = editor();
      if (t && e.target === t) noteKeyLog('touch in editor', { type: /** @type {PointerEvent} */ (e).pointerType, ...describeEditor(t) });
    },
    true
  );
  window.addEventListener('pagehide', () => noteKeyLog('pagehide'));
  window.addEventListener('pageshow', () => noteKeyLog('pageshow'));
}

/** The whole trail as text, newest last. */
export function keyLogText() {
  const head = [`user agent: ${navigator.userAgent}`, `standalone: ${/** @type {{ standalone?: boolean }} */ (navigator).standalone === true || matchMedia('(display-mode: standalone)').matches}`, `entries: ${entries.length} (the last ${LIMIT} kept)`, `now: ${new Date().toISOString()}`, ''];
  return [...head, ...entries.map((e) => `${(e.t / 1000).toFixed(1)}s ${e.what}`)].join('\n');
}
