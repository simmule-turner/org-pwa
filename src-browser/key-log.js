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

/**
 * Whether row N of the coloured layer is at the height of row N of the textarea: the textarea's rows are laid out on a hidden copy of
 * it (the whole text in one block, as the textarea has it) and each line's top is compared with the top of the coloured layer's row.
 * A drift is what puts a selection a few lines away from the text it holds.
 * @param {HTMLTextAreaElement} t @param {Element} back @param {CSSStyleDeclaration} cs
 */
function rowDrift(t, back, cs) {
  const mirror = document.createElement('div');
  mirror.style.cssText = `position:absolute;visibility:hidden;top:0;left:-9999px;box-sizing:border-box;width:${t.clientWidth}px;padding:0;margin:0;border:0;white-space:${cs.whiteSpace};overflow-wrap:${cs.overflowWrap};word-break:${cs.wordBreak};`;
  for (const prop of ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'tab-size']) mirror.style.setProperty(prop, cs.getPropertyValue(prop));
  const node = document.createTextNode(t.value);
  mirror.appendChild(node);
  document.body.appendChild(mirror);
  const base = mirror.getBoundingClientRect().top;
  const lh = parseFloat(cs.lineHeight) || 1;
  const lines = t.value.split('\n');
  const rows = Math.min(lines.length, back.children.length);
  const range = document.createRange();
  const backTop = back.getBoundingClientRect().top;
  const pad = parseFloat(getComputedStyle(back).paddingTop) || 0;
  let offset = 0;
  let firstDrift = -1;
  let last = 0;
  let previousTop = -lh;
  /** @type {number | null} */
  let calibration = null;
  /** @type {Array<Record<string, unknown>>} */
  const steps = [];
  for (let i = 0; i < rows; i++) {
    // measured on the first plain character of the line (the box of a glyph from another font, an emoji say, stands at another height);
    // a line without one has nothing to measure, and its row is taken as the one after the row before
    let own = previousTop + lh;
    const plain = lines[i].search(/[\x20-\x7e]/);
    if (plain >= 0) {
      range.setStart(node, offset + plain);
      range.setEnd(node, offset + plain + 1);
      const rect = range.getClientRects()[0];
      if (rect) own = rect.top - base;
    }
    previousTop = own;
    const drawn = back.children[i].getBoundingClientRect().top - backTop - pad;
    if (calibration === null) calibration = drawn - own; // a glyph's box starts a little below its row's top: the same for every row
    const drift = Math.round((drawn - own - calibration) * 10) / 10;
    if (Math.abs(drift - last) >= 0.5 && steps.length < 6) {
      // the drift changed at this row: the row before it, or this one, is taller in one layer than the other
      steps.push({ line: i + 1, driftNow: drift, change: Math.round((drift - last) * 10) / 10, start: lines[i].slice(0, 14), codes: [...lines[i].slice(0, 14)].filter((c) => (c.codePointAt(0) || 0) > 0x2000 || (c.codePointAt(0) || 0) > 0xffff).map((c) => 'U+' + (c.codePointAt(0) || 0).toString(16)).join(' ') });
      if (firstDrift < 0) firstDrift = i + 1;
    }
    last = drift;
    offset += lines[i].length + 1;
  }
  mirror.remove();
  return { rows, lineHeight: lh, firstDriftLine: firstDrift, driftAtLastRow: last, steps, textareaHeight: t.scrollHeight, layerHeight: Math.round(back.getBoundingClientRect().height) };
}

/**
 * Whether the coloured layer of the Text view lays its text out like the textarea over it, which does the selecting and cutting. The
 * textarea's layout is measured on a hidden copy with its own styles (regular weight, one row per line), the coloured layer's from the
 * rows it draws. A row that differs is where a selection would look to be on other characters than the ones it holds. Also how wide the
 * same text is in regular and in bold weight (the coloured layer sets headings in bold, the textarea does not), and the page scale.
 * @param {HTMLTextAreaElement} t
 * @returns {Record<string, unknown> | null} null when there is no coloured layer
 */
export function layerAlignment(t) {
  const back = t.parentElement && t.parentElement.querySelector('.te-back');
  if (!back) return null;
  const cs = getComputedStyle(t);
  const mirror = document.createElement('div');
  mirror.style.cssText = 'position:absolute;visibility:hidden;top:0;left:-9999px;white-space:pre;';
  for (const prop of ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'tab-size', 'font-variant-ligatures', 'font-kerning', 'font-feature-settings', 'text-rendering', 'font-synthesis']) mirror.style.setProperty(prop, cs.getPropertyValue(prop));
  const span = document.createElement('span');
  mirror.appendChild(span);
  document.body.appendChild(mirror);
  const width = (/** @type {string} */ text, weight = '') => {
    span.style.fontWeight = weight;
    span.textContent = text;
    return span.getBoundingClientRect().width;
  };
  const lines = t.value.split('\n');
  const rows = Math.min(lines.length, back.children.length, 400);
  const range = document.createRange();
  /** @type {Array<Record<string, unknown>>} */
  const off = [];
  let worst = 0;
  let differing = 0;
  for (let i = 0; i < rows; i++) {
    range.selectNodeContents(back.children[i]);
    const drawn = range.getBoundingClientRect().width;
    const own = width(lines[i] || '​');
    const diff = drawn - own;
    if (Math.abs(diff) < 0.5) continue;
    differing++;
    worst = Math.max(worst, Math.abs(diff));
    if (off.length < 4) off.push({ line: i + 1, textarea: Math.round(own * 10) / 10, drawn: Math.round(drawn * 10) / 10, classes: [...new Set(Array.from(back.children[i].querySelectorAll('span')).map((x) => x.className))].join(' '), start: (lines[i] || '').slice(0, 12) });
  }
  const vertical = rowDrift(t, back, cs);
  const sample = '0123456789abcdefghij';
  const regular = width(sample, '400');
  const bold = width(sample, '700');
  mirror.remove();
  const bs = getComputedStyle(back);
  const vv = window.visualViewport;
  return {
    rowsChecked: rows,
    rowsDiffering: differing,
    worstPx: Math.round(worst * 10) / 10,
    offenders: off,
    vertical,
    sameTextWidth: { regular: Math.round(regular * 100) / 100, bold: Math.round(bold * 100) / 100 },
    fonts: { textarea: cs.fontFamily, layer: bs.fontFamily, size: [cs.fontSize, bs.fontSize], ligatures: [cs.fontVariantLigatures, bs.fontVariantLigatures], kerning: [cs.fontKerning, bs.fontKerning] },
    scale: { devicePixelRatio: window.devicePixelRatio, pageScale: vv ? vv.scale : null, wrap: t.wrap, clientWidth: t.clientWidth, layerWidth: Math.round(back.getBoundingClientRect().width) },
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
  for (const type of ['cut', 'copy']) {
    document.addEventListener(
      type,
      (e) => {
        const t = editor();
        if (t && e.target === t) noteKeyLog(type, { ...describeEditor(t), selectedLength: t.selectionEnd - t.selectionStart });
      },
      true
    );
  }
  window.addEventListener('pagehide', () => noteKeyLog('pagehide'));
  window.addEventListener('pageshow', () => noteKeyLog('pageshow'));
}

/** The whole trail as text, newest last. */
export function keyLogText() {
  const head = [`user agent: ${navigator.userAgent}`, `standalone: ${/** @type {{ standalone?: boolean }} */ (navigator).standalone === true || matchMedia('(display-mode: standalone)').matches}`, `entries: ${entries.length} (the last ${LIMIT} kept)`, `now: ${new Date().toISOString()}`, ''];
  const t = editor();
  const layers = t ? layerAlignment(t) : null;
  if (layers) head.push(`text layers: ${JSON.stringify(layers)}`, '');
  return [...head, ...entries.map((e) => `${(e.t / 1000).toFixed(1)}s ${e.what}`)].join('\n');
}
