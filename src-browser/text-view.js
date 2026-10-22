// @ts-check
// The Text view's editor: the textarea the document is edited in, with the coloring and line numbers drawn in a layer behind it,
// the tool row (undo, line numbers, wrap, size, line commands, find) and the row of keys a phone keyboard lacks.
//
// The textarea stays the real editor (its caret, selection, undo and input methods are the browser's own); its text is made
// transparent and the colored copy of the same text is drawn underneath, so what is typed is never rewritten by this code.
import { getDisplayLineNumbersMode, getDisplayLineNumbersType, getTextFontSize, getTextLineNumbers, getTextWrap } from '../src/local-variables.js';
import { displayedLineNumber } from '../src/line-numbers.js';
import { deleteLines, duplicateLines, indentLines, lineCount, lineNumberAt, lineRange, moveLines, newlineWithIndent } from '../src/text-edit.js';
import { locateDiaryEntry } from '../src/diary-entry.js';
import { highlight } from '../src/text-syntax.js';
import { S } from './app-state.js';
import { openActionSheet } from './bottom-sheet.js';
import { promptText } from './dialogs.js';
import { scrollContainer } from './chrome.js';
import { extraMenuBtn, godModeBtn, navBackBtn, searchBtn } from './dom.js';
import { setStatus } from './editing.js';
import { platform } from './platform.js';
import { caretGeometry, describeEditor, noteExpectedCaret, noteKeyLog } from './key-log.js';
import { commitGlobalVariableChange } from './settings-quick.js';

const SVG = {
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
  numbers: '<path d="M10 6h10M10 12h10M10 18h10"/><path d="M4 5.5 5.5 5v4M4 11h3l-3 4h3M4 17h3v2H4"/>',
  wrap: '<path d="M4 6h16M4 12h13a3 3 0 0 1 0 6h-4"/><path d="m15 15-2 3 2 3"/><path d="M4 18h5"/>',
  find: '<circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/>',
};

/** @type {WeakMap<HTMLTextAreaElement, () => void>} */
const refreshers = new WeakMap();
/** @type {WeakMap<HTMLTextAreaElement, (text: string) => void>} */
const statusLines = new WeakMap();

/** Selects the lines `landing` names in the Text view that is showing, and says where they came from.
 * @param {NonNullable<import('../src/types.js').AppState['textLanding']>} landing
 * @param {HTMLTextAreaElement | null} [target]
 * @returns {boolean} whether there was a Text view to select in */
export function landInTextView(landing, target = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('document-text-edit-input'))) {
  if (!target) return false;
  const found = locateDiaryEntry(target.value, landing);
  const say = statusLines.get(target);
  if (!found) {
    if (say) say('That entry is not in the file as it was when the Agenda read it \u2014 it may have been edited or moved.');
    return true;
  }
  selectLines(target, found.startLine, found.endLine);
  if (say) say(`${landing.source}: ${found.startLine === found.endLine ? `line ${found.startLine}` : `lines ${found.startLine}\u2013${found.endLine}`}, \u201c${landing.lineText}\u201d.`);
  return true;
}

/** Redraws the colors and line numbers after the text was changed from code (a replace) rather than typed. @param {HTMLTextAreaElement} textarea */
export function refreshTextEditor(textarea) {
  noteKeyLog('editor text refreshed');
  const refresh = refreshers.get(textarea);
  if (refresh) refresh();
}

/** Makes an edit as a typed one would be, so the browser's undo can take it back; the selection ends at selStart..selEnd.
 * @param {HTMLTextAreaElement} textarea
 * @param {{ from: number, to: number, insert: string, selStart: number, selEnd: number }} edit
 * @param {boolean} [quiet] */
export function applyTextEdit(textarea, edit, quiet = false) {
  if (textarea.readOnly) return;
  if (!quiet) textarea.focus(); // quiet: leave a hidden device keyboard hidden
  textarea.setSelectionRange(edit.from, edit.to);
  /** @type {{ done: boolean }} */
  const result = { done: false };
  try {
    result.done = document.activeElement !== textarea ? false : edit.insert === '' ? document.execCommand('delete') : document.execCommand('insertText', false, edit.insert);
  } catch {
    result.done = false;
  }
  if (!result.done) {
    textarea.setRangeText(edit.insert, edit.from, edit.to, 'end');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }
  textarea.setSelectionRange(edit.selStart, edit.selEnd);
}

/** What the Tab key does here: indent the selected lines, or put two spaces at the cursor.
 * @param {HTMLTextAreaElement} textarea
 * @param {boolean} [quiet] leave a hidden device keyboard hidden */
function textViewTab(textarea, quiet = false) {
  const { selectionStart: a, selectionEnd: b, value } = textarea;
  if (value.slice(a, b).includes('\n')) {
    const edit = indentLines(value, a, b, 1);
    if (edit) applyTextEdit(textarea, edit, quiet);
  } else applyTextEdit(textarea, { from: a, to: b, insert: '  ', selStart: a + 2, selEnd: a + 2 }, quiet);
}

/** A key from the floating keyboard, acting on the text: arrows move the cursor (with Shift they extend the selection),
 *  Tab indents, a letter is typed. Never takes focus, so a device keyboard that was put away stays away. `prefix` is
 *  the g or G armed on the panel: with g, up and down move a page, left and right go to the start and end of the line;
 *  with G, up and down go to the start and end of the text.
 * @param {HTMLTextAreaElement} textarea @param {string} rawKey @param {boolean} shift @param {string} [prefix] */
export function sendKeyToTextView(textarea, rawKey, shift, prefix = '') {
  const beforeTap = describeEditor(textarea);
  const { selectionStart: a, selectionEnd: b, value } = textarea;
  if (rawKey === 'Tab') return textViewTab(textarea, true);
  if (rawKey.length === 1) {
    const ch = shift ? rawKey.toUpperCase() : rawKey;
    return applyTextEdit(textarea, { from: a, to: b, insert: ch, selStart: a + 1, selEnd: a + 1 }, true);
  }
  const backward = textarea.selectionDirection === 'backward';
  const focus = backward ? a : b;
  const anchor = backward ? b : a;
  let to;
  if (rawKey === 'ArrowLeft') to = prefix === 'g' ? value.lastIndexOf('\n', focus - 1) + 1 : !shift && a !== b ? a : Math.max(0, focus - 1);
  else if (rawKey === 'ArrowRight') to = prefix === 'g' ? (value.indexOf('\n', focus) === -1 ? value.length : value.indexOf('\n', focus)) : !shift && a !== b ? b : Math.min(value.length, focus + 1);
  else if (rawKey === 'ArrowUp' || rawKey === 'ArrowDown') {
    const up = rawKey === 'ArrowUp';
    const col = focus - (value.lastIndexOf('\n', focus - 1) + 1);
    /** One line up or down, to column `col` or the line's end. @param {number} from */
    const oneLine = (from) => {
      const lineStart = value.lastIndexOf('\n', from - 1) + 1;
      if (up) {
        if (lineStart === 0) return 0;
        const prevStart = value.lastIndexOf('\n', lineStart - 2) + 1;
        return Math.min(prevStart + col, lineStart - 1);
      }
      const lineEnd = value.indexOf('\n', from);
      if (lineEnd === -1) return value.length;
      const nextEnd = value.indexOf('\n', lineEnd + 1);
      return Math.min(lineEnd + 1 + col, nextEnd === -1 ? value.length : nextEnd);
    };
    if (prefix === 'G') to = up ? 0 : value.length;
    else if (prefix === 'g') {
      // a page: the lines showing above the floating keyboard, less one for context
      const box = textarea.getBoundingClientRect();
      const panel = document.getElementById('floatingKeyboard');
      const panelBox = panel && panel.style.display !== 'none' ? panel.getBoundingClientRect() : null;
      const shown = panelBox && panelBox.top > box.top && panelBox.top < box.bottom ? panelBox.top - box.top : box.height;
      const lines = Math.max(1, Math.floor(shown / (parseFloat(getComputedStyle(textarea).lineHeight) || 24)) - 1);
      to = focus;
      for (let i = 0; i < lines; i++) to = oneLine(to);
    } else to = oneLine(focus);
  } else return;
  if (shift) textarea.setSelectionRange(Math.min(anchor, to), Math.max(anchor, to), to < anchor ? 'backward' : 'forward');
  else textarea.setSelectionRange(to, to);
  // the cursor's line must end up in the part of the editor that can be seen: the floating keyboard sits over the bottom of
  // the editor, and the browser does not scroll a cursor moved by script into view at all
  const line = value.slice(0, to).split('\n').length - 1;
  const el = /** @type {HTMLElement | undefined} */ (textarea.parentElement?.querySelector('.te-back')?.children[line]);
  if (el) {
    const box = textarea.getBoundingClientRect();
    // from the line's layout position, not its drawn one: the coloured layer follows the scroll a frame later
    const row = { top: box.top - textarea.scrollTop + el.offsetTop, bottom: box.top - textarea.scrollTop + el.offsetTop + el.offsetHeight };
    const panel = document.getElementById('floatingKeyboard');
    const panelBox = panel && panel.style.display !== 'none' ? panel.getBoundingClientRect() : null;
    const covered = panelBox && panelBox.top > box.top && panelBox.top < box.bottom ? panelBox.top - 6 : box.bottom;
    const limit = Math.min(box.bottom - 2, covered);
    if (row.top < box.top) textarea.scrollTop -= box.top - row.top;
    else if (row.bottom > limit) textarea.scrollTop += row.bottom - limit;
    if (textarea.wrap === 'off') {
      // a long line runs off the side: keep the character the cursor is on in view, past the line numbers and short of the edge
      const x = box.left - textarea.scrollLeft + caretGeometry(textarea).mirrorX;
      const left = box.left + (parseFloat(getComputedStyle(textarea).paddingLeft) || 0);
      if (x < left) textarea.scrollLeft -= left - x;
      else if (x > box.right - 24) textarea.scrollLeft += x - (box.right - 24);
    }
  }
  noteExpectedCaret(to);
  noteKeyLog('key', { key: rawKey, shift, from: beforeTap, to, after: describeEditor(textarea), geo: caretGeometry(textarea) });
}

/** Selects lines startLine..endLine (1-based) and scrolls so they show about a third of the way down.
 * @param {HTMLTextAreaElement} textarea @param {number} startLine @param {number} endLine */
export function selectLines(textarea, startLine, endLine) {
  const from = lineRange(textarea.value, startLine);
  const to = lineRange(textarea.value, Math.max(startLine, endLine));
  textarea.focus({ preventScroll: true });
  textarea.setSelectionRange(from.start, to.end);
  const lh = parseFloat(getComputedStyle(textarea).lineHeight) || 20;
  textarea.scrollTop = Math.max(0, (from.line - 1) * lh - textarea.clientHeight / 3);
}

/** @param {string} label @param {string} svg @param {() => void} onClick @param {boolean} [pressed] */
function iconButton(label, svg, onClick, pressed) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'te-btn';
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${svg}</svg>`;
  if (pressed !== undefined) btn.setAttribute('aria-pressed', String(pressed));
  btn.onclick = onClick;
  return btn;
}

/** @param {string} label @param {string} text @param {() => void} onClick */
function textButton(label, text, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'te-btn';
  btn.setAttribute('aria-label', label);
  btn.textContent = text;
  btn.onclick = onClick;
  return btn;
}

/** A row of buttons that do not take the focus (and the on-screen keyboard) away from the text. @param {string} extra */
function row(extra = '') {
  const el = document.createElement('div');
  el.className = `te-row ${extra}`.trim();
  el.addEventListener('pointerdown', (e) => {
    if (/** @type {HTMLElement} */ (e.target).closest('button')) e.preventDefault();
  });
  return el;
}

/**
 * Builds the editor around `textarea`.
 * @param {object} o
 * @param {HTMLTextAreaElement} o.textarea  the textarea, not yet in the page
 * @param {import('../src/text-syntax.js').SyntaxKind} o.kind
 * @param {HTMLElement | null} [o.extraRow]  a row of tools for this kind of file (the diary's)
 * @param {boolean} o.compact  a narrowed subtree: no line numbers
 * @param {string} o.height  the CSS height of the whole editor
 * @returns {{ root: HTMLElement, status: (text: string) => void }}
 */
export function buildTextEditor({ textarea, kind, extraRow = null, compact, height }) {
  const root = document.createElement('div');
  root.className = 'te-root';
  root.style.height = height;

  const wrap = document.createElement('div');
  wrap.className = 'te-wrap';
  const gutter = document.createElement('div');
  gutter.className = 'te-gutter';
  const back = document.createElement('div');
  back.className = 'te-back';
  back.setAttribute('aria-hidden', 'true');
  textarea.classList.add('te-input');
  wrap.append(gutter, back, textarea);

  /** @type {{ text: string | null }} */
  const drawn = { text: null };
  const vars = () => /** @type {Record<string, string>} */ (S.state.localVariables || S.globalVariables || {});

  /** Line numbers show when the Text view's own setting says so, or when `display-line-numbers-mode` is on. */
  const showNumbers = () => getTextLineNumbers(vars()) || getDisplayLineNumbersMode(vars());

  /** `relative` and `visual` count from the line the cursor is on, which keeps its absolute number; `t` leaves it to the CSS counter. */
  function renumber() {
    const type = getDisplayLineNumbersType(vars());
    wrap.classList.toggle('te-attr', type !== 'absolute');
    if (type === 'absolute') return;
    const current = textarea.value.slice(0, textarea.selectionStart).split('\n').length;
    Array.from(back.children).forEach((ln, i) => {
      /** @type {HTMLElement} */ (ln).dataset.n = String(displayedLineNumber(type, i + 1, current, i, current - 1));
    });
  }
  for (const ev of ['keyup', 'click', 'focus']) textarea.addEventListener(ev, renumber);

  function layout() {
    // iOS zooms the page when a field under 16px is focused, so there the text is never smaller than that
    const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const size = ios ? Math.max(16, getTextFontSize(vars())) : getTextFontSize(vars());
    const lh = Math.round(size * 1.5);
    const wrapOn = getTextWrap(vars());
    const numbers = showNumbers() && !compact;
    const digits = Math.max(2, String(lineCount(textarea.value)).length);
    wrap.style.fontSize = `${size}px`;
    wrap.style.setProperty('--te-fs', `${size}px`);
    wrap.style.lineHeight = `${lh}px`;
    wrap.style.setProperty('--te-gutter', numbers ? `calc(${digits}ch + 12px)` : '0px');
    wrap.classList.toggle('te-nums', numbers);
    gutter.style.display = numbers ? 'block' : 'none';
    gutter.style.width = numbers ? `calc(${digits}ch + 12px)` : '0';
    const padLeft = numbers ? 'calc(var(--te-gutter) + 8px)' : '10px';
    for (const el of [back, textarea]) {
      el.style.padding = `10px 10px 10px ${padLeft}`;
      el.style.whiteSpace = wrapOn ? 'pre-wrap' : 'pre';
      el.style.overflowWrap = wrapOn ? 'break-word' : 'normal';
      el.style.wordBreak = 'normal';
      el.style.font = `${size}px/${lh}px ui-monospace, monospace`;
      el.style.tabSize = '4';
    }
    textarea.wrap = wrapOn ? 'soft' : 'off';
    textarea.style.overflowX = wrapOn ? 'hidden' : 'auto';
    back.style.boxSizing = 'border-box';
    back.style.width = wrapOn ? `${textarea.clientWidth}px` : 'max-content';
    back.style.minWidth = wrapOn ? '' : '100%';
    sync();
  }

  function sync() {
    back.style.transform = `translate(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px)`;
  }

  function draw() {
    const text = textarea.value;
    if (text === drawn.text) return;
    drawn.text = text;
    const lines = highlight(kind, text);
    const frag = document.createDocumentFragment();
    for (const segs of lines) {
      const ln = document.createElement('div');
      ln.className = 'te-ln';
      if (segs.length === 0) ln.appendChild(document.createTextNode('​'));
      for (const seg of segs) {
        if (seg.cls) {
          const span = document.createElement('span');
          span.className = seg.cls;
          span.textContent = seg.text;
          ln.appendChild(span);
        } else ln.appendChild(document.createTextNode(seg.text));
      }
      frag.appendChild(ln);
    }
    back.replaceChildren(frag);
    const digits = Math.max(2, String(lines.length).length);
    renumber();
    if (!compact && showNumbers() && wrap.style.getPropertyValue('--te-gutter') !== `calc(${digits}ch + 12px)`) layout();
  }

  /** @type {{ frame: number }} */
  const pending = { frame: 0 };
  function schedule() {
    if (pending.frame) return;
    pending.frame = requestAnimationFrame(() => {
      pending.frame = 0;
      draw();
      sync();
    });
  }
  refreshers.set(textarea, () => {
    drawn.text = null;
    draw();
  });
  textarea.addEventListener('input', schedule);
  textarea.addEventListener('scroll', sync, { passive: true });
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => layout()).observe(wrap);

  // Enter keeps the indentation of the line; Tab and Shift+Tab indent and outdent a selection of several lines
  textarea.addEventListener('keydown', (e) => {
    if (textarea.readOnly || e.isComposing || e.keyCode === 229) return;
    const { selectionStart: a, selectionEnd: b, value } = textarea;
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      const insert = newlineWithIndent(value, a);
      if (insert === '\n') return; // nothing to keep: the browser's own Enter
      e.preventDefault();
      applyTextEdit(textarea, { from: a, to: b, insert, selStart: a + insert.length, selEnd: a + insert.length });
    } else if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey && value.slice(a, b).includes('\n')) {
      e.preventDefault();
      const edit = indentLines(value, a, b, e.shiftKey ? -1 : 1);
      if (edit) applyTextEdit(textarea, edit);
    }
  });

  // ---- tools
  const editable = !textarea.readOnly;
  /** @param {() => void} fn */
  const undoable = (fn) => () => {
    textarea.focus();
    fn();
  };
  const tools = row();
  const undo = iconButton('Undo', SVG.undo, undoable(() => document.execCommand('undo')));
  const redo = iconButton('Redo', SVG.redo, undoable(() => document.execCommand('redo')));
  undo.disabled = redo.disabled = !editable;
  const numbersBtn = iconButton('Line numbers', SVG.numbers, () =>
      void (async () => {
        const shown = showNumbers();
        await commitGlobalVariableChange('org-xx-text-line-numbers', shown ? 'nil' : 't');
        if (shown && getDisplayLineNumbersMode(vars())) await commitGlobalVariableChange('display-line-numbers-mode', 'nil');
        numbersBtn.setAttribute('aria-pressed', String(showNumbers()));
        layout();
      })(), showNumbers());
  const wrapBtn = iconButton('Wrap lines', SVG.wrap, () => void commitGlobalVariableChange('org-xx-text-wrap', getTextWrap(vars()) ? 'nil' : 't').then(() => (wrapBtn.setAttribute('aria-pressed', String(getTextWrap(vars()))), layout())), getTextWrap(vars()));
  /** @param {number} delta */
  const resize = (delta) => () =>
    void commitGlobalVariableChange('org-xx-text-font-size', String(Math.max(9, Math.min(28, getTextFontSize(vars()) + delta)))).then(layout);
  const smaller = textButton('Smaller text', 'A−', resize(-1));
  smaller.style.fontSize = '12px';
  const larger = textButton('Larger text', 'A+', resize(1));
  larger.style.fontSize = '16px';
  const lineBtn = textButton('Line commands', 'Line…', () => openLineMenu(textarea, editable));
  lineBtn.style.fontSize = '12px';
  const findBtn = iconButton('Find', SVG.find, () => searchBtn.click());
  tools.append(undo, redo);
  if (!compact) tools.append(numbersBtn);
  tools.append(wrapBtn, smaller, larger, lineBtn, findBtn);

  // ---- keys
  const keys = row('te-keys');
  const tab = textButton('Tab', 'Tab', () => textViewTab(textarea));
  tab.style.fontSize = '13px';
  keys.appendChild(tab);
  for (const ch of ['*', '/', '%', '(', ')', '&', '-', ':', '<', '>']) {
    keys.appendChild(
      textButton(`Insert ${ch}`, ch, () => {
        const { selectionStart: a, selectionEnd: b } = textarea;
        applyTextEdit(textarea, { from: a, to: b, insert: ch, selStart: a + 1, selEnd: a + 1 });
      })
    );
  }
  for (const btn of keys.querySelectorAll('button')) /** @type {HTMLButtonElement} */ (btn).disabled = !editable;

  const status = document.createElement('div');
  status.className = 'te-status';
  status.hidden = true;
  status.onclick = () => (status.hidden = true);

  root.append(tools);
  if (extraRow) root.appendChild(extraRow);
  root.append(wrap, keys, status);
  textarea.addEventListener('focus', schedule);

  // The editor fills what is left of the scrolling pane below it (the pane already stops above the bottom bar and the on-screen
  // keyboard), so the key row stays at the bottom of the visible area whether or not the keyboard is up, and the pane itself
  // never has to scroll to reach the top of the text or the keys.
  const box = scrollContainer();
  function fit() {
    if (!root.isConnected) return;
    box.scrollTop = 0;
    const top = root.getBoundingClientRect().top - box.getBoundingClientRect().top;
    root.style.height = `${Math.max(160, box.clientHeight - top)}px`;
    // The key row stays where it is but ends beside the round buttons floating in the bottom corners (Back on the left, Extras
    // and [g] on the right) rather than running under them; it scrolls sideways within what is left.
    const edge = box.getBoundingClientRect();
    let left = 0;
    let right = 0;
    for (const btn of [navBackBtn, extraMenuBtn, godModeBtn]) {
      if (getComputedStyle(btn).display === 'none') continue;
      const r = btn.getBoundingClientRect();
      if (r.top >= edge.bottom || r.bottom <= keys.getBoundingClientRect().top) continue; // not beside the key row
      if (r.left + r.width / 2 < edge.left + edge.width / 2) left = Math.max(left, r.right - edge.left + 8);
      else right = Math.max(right, edge.right - r.left + 8);
    }
    keys.style.marginLeft = `${left}px`;
    keys.style.marginRight = `${right}px`;
  }
  const watch = () => {
    if (!root.isConnected) {
      sizeWatch.disconnect();
      buttonWatch.disconnect();
      window.removeEventListener('resize', watch);
      window.visualViewport?.removeEventListener('resize', watch);
      return;
    }
    fit();
  };
  const sizeWatch = typeof ResizeObserver === 'function' ? new ResizeObserver(watch) : { observe() {}, disconnect() {} };
  sizeWatch.observe(box);
  const buttonWatch = new MutationObserver(watch); // a button shown or hidden (Back appears after a jump)
  for (const btn of [navBackBtn, extraMenuBtn, godModeBtn]) buttonWatch.observe(btn, { attributes: true, attributeFilter: ['style'] });
  window.addEventListener('resize', watch);
  window.visualViewport?.addEventListener('resize', watch);
  textarea.addEventListener('focus', () => setTimeout(fit, 350)); // the keyboard may still be moving in

  // the first drawing waits until the editor is in the page, so it can be measured
  queueMicrotask(() => {
    fit();
    layout();
    drawn.text = null;
    draw();
    sync();
  });
  const say = (/** @type {string} */ text) => {
    status.textContent = text;
    status.hidden = false;
  };
  statusLines.set(textarea, say);
  return { root, status: say };
}

/** The Line… sheet: go to a line, and the commands that work on whole lines.
 * @param {HTMLTextAreaElement} textarea @param {boolean} editable */
function openLineMenu(textarea, editable) {
  const sel = () => ({ a: textarea.selectionStart, b: textarea.selectionEnd, text: textarea.value });
  /** @param {(text: string, a: number, b: number) => ReturnType<typeof moveLines>} make */
  const run = (make) => () => {
    const { a, b, text } = sel();
    const edit = make(text, a, b);
    if (edit) applyTextEdit(textarea, edit);
  };
  const { a, text } = sel();
  openActionSheet({
    title: 'Lines and text',
    subtitle: `Line ${lineNumberAt(text, a)} of ${lineCount(text)}`,
    actions: [
      {
        label: 'Go to line…',
        onClick: async () => {
          const answer = await promptText(`Go to line (1–${lineCount(textarea.value)}):`, String(lineNumberAt(textarea.value, textarea.selectionStart)), { okLabel: 'Go' });
          if (answer === null) return;
          const n = Number.parseInt(answer, 10);
          if (!Number.isFinite(n)) return;
          const { line, start } = lineRange(textarea.value, n);
          selectLines(textarea, line, line);
          textarea.setSelectionRange(start, start);
        },
      },
      { label: 'Select all', onClick: () => (textarea.focus(), textarea.select()) },
      {
        label: 'Copy all',
        onClick: async () => {
          try {
            await platform.clipboard.writeText(textarea.value);
            setStatus('Copied to clipboard.');
          } catch {
            // no clipboard access: select the text so the device's own Copy finishes the job
            textarea.focus();
            textarea.select();
            setStatus('Text selected \u2014 use your device\u2019s own Copy.');
          }
        },
      },
      { label: 'Duplicate line', disabled: !editable, onClick: run((t, x, y) => duplicateLines(t, x, y)) },
      { label: 'Delete line', disabled: !editable, danger: true, onClick: run((t, x, y) => deleteLines(t, x, y)) },
      { label: 'Move line up', disabled: !editable, onClick: run((t, x, y) => moveLines(t, x, y, -1)) },
      { label: 'Move line down', disabled: !editable, onClick: run((t, x, y) => moveLines(t, x, y, 1)) },
      { label: 'Indent', disabled: !editable, onClick: run((t, x, y) => indentLines(t, x, y, 1)) },
      { label: 'Outdent', disabled: !editable, onClick: run((t, x, y) => indentLines(t, x, y, -1)) },
    ],
  });
}
