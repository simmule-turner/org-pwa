// @ts-check
/**
 * Emacs mode of the Text view: the textarea stays the field the device keyboard types into, and the editing is Emacs's. Keys go through
 * the keymap (src/emacs-keymap.js) to the commands (src/emacs-edit.js) with Emacs's undo list, mark and kill ring; the result is
 * written back to the textarea, drawn with a block caret, a modeline and an echo line, and a panel gives a phone the keys it lacks.
 */
import { syncExternal } from '../src/emacs-edit.js';
import { foldedExecute } from '../src/emacs-fold.js';
import { scrollWindow } from '../src/emacs-scroll.js';
import { eventKey, feedKey, newKeyInput } from '../src/emacs-keymap.js';
import { newUndo } from '../src/emacs-undo.js';

/** The keys of a physical keyboard that move the caret, as the Emacs keys they stand for. */
const MOVES = /** @type {Record<string, string>} */ ({ ArrowLeft: 'C-b', ArrowRight: 'C-f', ArrowUp: 'C-p', ArrowDown: 'C-n', Home: 'C-a', End: 'C-e', Delete: 'C-d' });

/** The key under an Alt chord, from where it sits on the keyboard (a Mac types another character with Option held).
 * @param {KeyboardEvent} e */
function baseKey(e) {
  if (!e.altKey) return e.key;
  const letter = /^Key([A-Z])$/.exec(e.code);
  if (letter) return e.shiftKey ? letter[1] : letter[1].toLowerCase();
  const digit = /^Digit([0-9])$/.exec(e.code);
  if (digit) return digit[1];
  /** @type {Record<string, string[]>} */
  const symbols = { Minus: ['-', '_'], Comma: [',', '<'], Period: ['.', '>'], Backslash: ['\\', '|'], Slash: ['/', '?'], Space: [' ', ' '] };
  const pair = symbols[e.code];
  return pair ? pair[e.shiftKey ? 1 : 0] : e.key;
}

/** What was typed into `before` to make `after`, when that is all that happened to it; otherwise null.
 * @param {string} before @param {string} after @returns {string | null} */
function insertedText(before, after) {
  if (after.length <= before.length) return null;
  let head = 0;
  while (head < before.length && before[head] === after[head]) head++;
  let tail = 0;
  while (tail < before.length - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
  return head + tail === before.length ? after.slice(head, after.length - tail) : null;
}

/** The visibility commands, which the fold model runs. */
const FOLD_COMMANDS = new Set(['org-cycle', 'org-shifttab', 'org-fold-reveal']);

/** What a read-only buffer still allows: moving, the mark and copying. */
const READ_ONLY_OK = new Set(['forward-char', 'backward-char', 'org-beginning-of-line', 'org-end-of-line', 'forward-word', 'backward-word', 'beginning-of-buffer', 'end-of-buffer', 'next-line', 'previous-line', 'set-mark-command', 'exchange-point-and-mark', 'kill-ring-save', 'org-forward-sentence', 'org-backward-sentence', 'isearch-forward', 'isearch-backward', 'scroll-up-command', 'scroll-down-command']);

/**
 * @param {object} o
 * @param {HTMLTextAreaElement} o.textarea
 * @param {HTMLElement} o.wrap  the text and its layers, where a floating panel goes
 * @param {HTMLElement} o.find  a layer laid out as the text is
 * @param {HTMLElement} o.keys  the row of keys that scrolls sideways; a docked panel's keys go at its start
 * @param {(text: string) => void} o.say  the echo area (the status line under the mode line)
 * @param {() => void} o.onMove  the caret moved: the mode line shows its place
 * @param {{ panel: 'docked' | 'floating', adjusted: boolean, folded: boolean, clipboard: boolean }} o.options
 * @param {(edit: { from: number, to: number, insert: string, selStart: number, selEnd: number }, quiet: boolean) => void} o.applyEdit
 * @param {(forward: boolean) => void} o.search  C-s and C-r: open Find, or go to the next match
 * @param {() => void} o.tab  the Tab key of the Text view
 * @param {(panel: 'docked' | 'floating') => void} o.setPanel  keeps the panel's place in the settings
 * @param {{ readText: () => Promise<string>, writeText: (text: string) => Promise<void> }} o.clipboard
 * @param {{ view: () => ReturnType<typeof import('../src/org-fold.js').foldView>, hidden: () => Array<[number, number]>, apply: (text: string, edits: Array<{ from: number, removed: string, inserted: number }>) => void, run: (command: string, pos: number, prefix: { n: number, universal: boolean } | undefined) => { handled: boolean, msg: string } }} o.fold  the folded text: how it is shown, and TAB, S-TAB and C-c C-r
 * @returns {{ press: (key: string) => void, refresh: () => void, placePanel: (where: 'docked' | 'floating') => void, setMark: (pos: number) => void }}
 */
export function attachEmacsMode(o) {
  const { textarea, wrap, find, keys, say } = o;
  const initial = textarea.value;
  const ctx = {
    /** @type {import('../src/emacs-edit.js').EditState} */
    st: { text: initial, pos: textarea.selectionStart, mark: null, kill: [], active: false, undo: newUndo(), yank: { adjusted: o.options.adjusted, folded: o.options.folded } },
    input: newKeyInput(),
    sticky: { ctrl: false, alt: false, shift: false },
    applying: false,
    /** @type {[number, number, string]} */
    shown: [-1, -1, 'none'],
    /** @type {string | null} */
    clip: null,
  };

  wrap.classList.add('te-emacs');
  const layer = document.createElement('div');
  layer.className = 'te-caret';
  layer.setAttribute('aria-hidden', 'true');
  wrap.insertBefore(layer, textarea);

  // ---- the kill ring and the device clipboard
  const refreshClipboard = () => {
    if (!o.options.clipboard) return;
    o.clipboard.readText().then(
      (text) => {
        ctx.clip = text;
      },
      () => {} // the device may not let the page read it; the kill ring then stays the app's own
    );
  };
  /** @param {import('../src/emacs-edit.js').EditState} before @param {import('../src/emacs-edit.js').EditState} after */
  const syncKillRing = (before, after) => {
    if (!o.options.clipboard || after.kill[0] === undefined || after.kill[0] === before.kill[0]) return;
    ctx.clip = after.kill[0];
    o.clipboard.writeText(after.kill[0]).catch(() => {});
  };

  // ---- the textarea and the state
  /** Takes the textarea as it is now into the state: text changed by the browser, a selection made by touch. */
  function adopt() {
    const { value, selectionStart: a, selectionEnd: b, selectionDirection: dir } = textarea;
    if (value !== ctx.st.text) {
      ctx.st = syncExternal(ctx.st, value, b);
      ctx.shown = [-1, -1, 'none'];
      return;
    }
    if (a === ctx.shown[0] && b === ctx.shown[1] && dir === ctx.shown[2]) return;
    if (a === b) ctx.st = { ...ctx.st, pos: a, active: false };
    else ctx.st = dir === 'backward' ? { ...ctx.st, pos: a, mark: b, active: true } : { ...ctx.st, pos: b, mark: a, active: true };
  }

  /** Writes the state into the textarea and the layers. */
  function show() {
    const { st } = ctx;
    ctx.applying = true;
    try {
      if (textarea.value !== st.text && o.fold.hidden().length) {
        o.fold.apply(st.text, st.applied ?? []);
        textarea.dispatchEvent(new Event('input', { bubbles: true })); // whatever follows the text hears of it
      } else if (textarea.value !== st.text) {
        const old = textarea.value;
        let head = 0;
        while (head < old.length && head < st.text.length && old[head] === st.text[head]) head++;
        let tail = 0;
        while (tail < old.length - head && tail < st.text.length - head && old[old.length - 1 - tail] === st.text[st.text.length - 1 - tail]) tail++;
        o.applyEdit({ from: head, to: old.length - tail, insert: st.text.slice(head, st.text.length - tail), selStart: st.pos, selEnd: st.pos }, true);
      }
      const region = st.active && st.mark !== null && st.mark !== st.pos;
      const a = region ? Math.min(st.pos, /** @type {number} */ (st.mark)) : st.pos;
      const b = region ? Math.max(st.pos, /** @type {number} */ (st.mark)) : st.pos;
      const dir = region ? (st.pos < /** @type {number} */ (st.mark) ? 'backward' : 'forward') : 'none';
      textarea.setSelectionRange(a, b, dir);
      ctx.shown = [a, b, textarea.selectionDirection];
    } finally {
      ctx.applying = false;
    }
    draw();
    keepCaretInView();
  }

  /** The block caret, laid out as the text is. */
  function draw() {
    const { st } = ctx;
    layer.style.cssText = find.style.cssText;
    layer.style.transform = find.style.transform;
    const { display, toDisplay } = o.fold.view();
    const d = toDisplay(st.pos);
    const at = display[d];
    const block = document.createElement('span');
    block.className = 'te-block';
    block.textContent = at === undefined || at === '\n' ? ' ' : at;
    layer.replaceChildren(display.slice(0, d), block);
    o.onMove();
  }

  /** The caret stays on screen after a command moved it (the textarea scrolls to its own caret only when it is typed at). */
  function keepCaretInView() {
    const block = layer.querySelector('.te-block');
    if (!(block instanceof HTMLElement)) return;
    const top = block.offsetTop;
    const height = block.offsetHeight || 20;
    if (top < textarea.scrollTop) textarea.scrollTop = top;
    else if (top + height > textarea.scrollTop + textarea.clientHeight - 10) textarea.scrollTop = top + height - textarea.clientHeight + 10;
    if (textarea.wrap === 'off') {
      const left = block.offsetLeft;
      if (left < textarea.scrollLeft) textarea.scrollLeft = Math.max(0, left - 20);
      else if (left + block.offsetWidth > textarea.scrollLeft + textarea.clientWidth - 20) textarea.scrollLeft = left + block.offsetWidth - textarea.clientWidth + 40;
    }
    layer.style.transform = find.style.transform;
  }

  /** C-v and M-v: the text scrolls a screen less two lines, or the lines the prefix says, and the caret goes the same number of lines.
   *  @param {boolean} forward @param {{ n: number, universal: boolean } | undefined} prefix */
  function scrollPage(forward, prefix) {
    const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 20;
    const text = ctx.st.text;
    const starts = [0];
    for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
    const lineOf = (/** @type {number} */ pos) => {
      let lo = 0;
      let hi = starts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= pos) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    };
    const r = scrollWindow({
      lines: starts.length,
      start: Math.round(textarea.scrollTop / lineHeight),
      point: lineOf(ctx.st.pos),
      height: Math.max(3, Math.floor(textarea.clientHeight / lineHeight)),
      count: prefix && !prefix.universal ? prefix.n : null,
      forward,
    });
    if (r.error) {
      say(r.error);
      return;
    }
    if (r.bol) ctx.st = { ...ctx.st, pos: starts[r.point] };
    ctx.st = { ...ctx.st, last: forward ? 'scroll-up-command' : 'scroll-down-command' };
    say('');
    show();
    textarea.scrollTop = r.start * lineHeight;
    layer.style.transform = find.style.transform;
  }

  // ---- keys
  /** Feeds one key, named as Emacs names it. @param {string} rawKey @returns {boolean} whether Emacs mode took it */
  function press(rawKey) {
    adopt();
    const fed = feedKey(ctx.input, rawKey);
    ctx.input = fed.input;
    const { result } = fed;
    if (result.type === 'unhandled') {
      if (rawKey.startsWith('C-') || rawKey.startsWith('M-')) {
        say(`${rawKey} is undefined`);
        return true; // the browser's own meaning of the key (reload, save, close) is not wanted in the editor
      }
      return false;
    }
    if (result.type === 'pending') {
      say(result.echo);
      return true;
    }
    if (result.type === 'quit') {
      ctx.st = { ...ctx.st, active: false, last: 'keyboard-quit' };
      say('Quit');
      show();
      return true;
    }
    if (result.type === 'error') {
      say(result.message);
      return true;
    }
    if (result.command === 'execute-extended-command') {
      say('M-x is not available yet');
      return true;
    }
    if (textarea.readOnly && !READ_ONLY_OK.has(result.command)) {
      say('Buffer is read-only');
      return true;
    }
    if (result.command === 'isearch-forward' || result.command === 'isearch-backward') {
      ctx.st = { ...ctx.st, active: false, last: result.command };
      o.search(result.command === 'isearch-forward');
      return true;
    }
    if (result.command === 'scroll-up-command' || result.command === 'scroll-down-command') {
      scrollPage(result.command === 'scroll-up-command', result.prefix);
      return true;
    }
    if (FOLD_COMMANDS.has(result.command)) {
      const ran = o.fold.run(result.command, ctx.st.pos, result.prefix);
      if (ran.handled) {
        ctx.st = { ...ctx.st, active: false, last: result.command };
        say(ran.msg);
        show();
        return true;
      }
      ctx.input = newKeyInput();
      o.tab(); // not on a heading: the Text view's own Tab
      return true;
    }
    refreshClipboard();
    let before = ctx.st;
    if (result.command === 'org-yank' && o.options.clipboard && ctx.clip && ctx.clip !== before.kill[0]) before = { ...before, kill: [ctx.clip, ...before.kill], yankAt: 0 };
    const after = foldedExecute(before, o.fold.hidden(), result.command, result.char, result.prefix);
    ctx.st = after;
    syncKillRing(before, after);
    say(after.error ?? '');
    show();
    return true;
  }

  /** @param {KeyboardEvent} e */
  function onKeyDown(e) {
    if (e.isComposing || e.keyCode === 229 || e.metaKey) return;
    const control = e.ctrlKey || ctx.sticky.ctrl;
    const meta = e.altKey || ctx.sticky.alt;
    if (e.key === 'Tab' && !control && !meta) {
      if (press(e.shiftKey || ctx.sticky.shift ? '<backtab>' : 'TAB')) e.preventDefault();
      setSticky(false, false);
      return;
    }
    const plainMove = !control && !meta && (e.key in MOVES || e.key === 'Escape');
    if (!control && !meta && !plainMove) {
      if (e.key === 'Enter' || e.key === 'Tab') ctx.input = newKeyInput(); // keys that are not Emacs's here end a prefix
      return;
    }
    const base = e.key in MOVES && !control && !meta ? MOVES[e.key] : baseKey(e);
    const name = base.startsWith('C-') ? base : eventKey({ key: base, ctrlKey: control, altKey: meta });
    if (!name) return;
    if (press(name)) {
      e.preventDefault();
      setSticky(false, false);
    } else if (!['Control', 'Alt'].includes(e.key)) setSticky(false, false);
  }

  /** Whether the next thing typed belongs to a command: Ctrl or Alt held from the panel, or a prefix (ESC, C-x, C-u) already typed. */
  const commandPending = () => ctx.sticky.ctrl || ctx.sticky.alt || ctx.input.pending.length > 0 || Boolean(ctx.input.arg);

  /** Characters typed as keys: with Ctrl or Alt held from the panel the first one is that key with the modifier. @param {string} data */
  function typeChars(data) {
    for (const ch of data) {
      const name = ctx.sticky.ctrl || ctx.sticky.alt ? eventKey({ key: ch, ctrlKey: ctx.sticky.ctrl, altKey: ctx.sticky.alt }) : ch;
      if (name) press(name);
      setSticky(false, false);
    }
  }

  /** @param {InputEvent} e */
  function onBeforeInput(e) {
    if (ctx.applying || e.isComposing) return;
    const type = e.inputType;
    if (type === 'historyUndo') {
      e.preventDefault();
      press('C-/');
    } else if (type === 'historyRedo') {
      e.preventDefault();
      press('C-?');
    } else if (type === 'deleteContentBackward') {
      e.preventDefault();
      press('DEL');
    } else if (type === 'deleteContentForward') {
      e.preventDefault();
      press('C-d');
    } else if (type === 'insertText' && e.data && !e.data.includes('\n')) {
      e.preventDefault();
      typeChars(e.data);
    }
  }

  // ---- the panel
  const panel = document.createElement('div'); // the floating panel; docked, its keys sit at the start of the key row
  panel.className = 'te-keypanel';
  panel.setAttribute('role', 'toolbar');
  panel.setAttribute('aria-label', 'Emacs keys');
  const keyButtons = /** @type {HTMLButtonElement[]} */ ([]);
  /** @type {Record<string, HTMLButtonElement>} */
  const buttons = {};
  /** @param {string} label @param {string} title @param {() => void} act */
  const button = (label, title, act) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'te-btn te-key';
    b.textContent = label;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('pointerdown', (e) => e.preventDefault()); // the text keeps the focus, and the device keyboard stays as it is
    b.addEventListener('click', () => {
      act();
      if (document.activeElement !== textarea && textarea.inputMode !== 'none') textarea.focus({ preventScroll: true });
    });
    keyButtons.push(b);
    buttons[label] = b;
    return b;
  };
  /** @param {boolean} ctrl @param {boolean} alt @param {boolean} [shift] */
  function setSticky(ctrl, alt, shift = false) {
    ctx.sticky.ctrl = ctrl;
    ctx.sticky.alt = alt;
    ctx.sticky.shift = shift;
    buttons.Ctrl?.setAttribute('aria-pressed', String(ctrl));
    buttons.Alt?.setAttribute('aria-pressed', String(alt));
    buttons.Shift?.setAttribute('aria-pressed', String(shift));
    if (ctrl || alt || shift) say(`${ctrl ? 'C-' : ''}${alt ? 'M-' : ''}${shift ? 'S-' : ''}`); // the echo area shows what is held, as Emacs shows a prefix
  }
  button('Esc', 'Escape (Meta for the next key)', () => void press('ESC'));
  button('Ctrl', 'Control for the next key', () => setSticky(!ctx.sticky.ctrl, ctx.sticky.alt, ctx.sticky.shift));
  button('Meta', 'Meta for the next key', () => setSticky(ctx.sticky.ctrl, !ctx.sticky.alt, ctx.sticky.shift));
  button('Shift', 'Shift for the next key', () => setSticky(ctx.sticky.ctrl, ctx.sticky.alt, !ctx.sticky.shift));
  button('Tab', 'Tab (with Shift: S-TAB)', () => {
    const name = ctx.sticky.shift ? '<backtab>' : 'TAB';
    setSticky(false, false);
    if (!press(name)) o.tab();
  });
  button('←', 'Left', () => void press('C-b'));
  button('↑', 'Up', () => void press('C-p'));
  button('↓', 'Down', () => void press('C-n'));
  button('→', 'Right', () => void press('C-f'));
  button('C-g', 'Quit', () => void press('C-g'));
  button('C-SPC', 'Set the mark', () => void press('C-SPC'));
  button('C-x', 'C-x prefix', () => void press('C-x'));
  button('C-u', 'Universal argument', () => void press('C-u'));
  button('C-/', 'Undo', () => void press('C-/'));
  button('⌨', 'Show or hide the device keyboard', () => {
    textarea.inputMode = textarea.inputMode === 'none' ? 'text' : 'none';
    if (textarea.inputMode !== 'none') textarea.focus();
  });
  const placeBtn = button('Float', 'Float the key panel over the text, or dock it', () => o.setPanel(panel.classList.contains('te-floating') ? 'docked' : 'floating'));

  /** @param {'docked' | 'floating'} where */
  function placePanel(where) {
    const floating = where === 'floating';
    panel.classList.toggle('te-floating', floating);
    placeBtn.textContent = floating ? 'Dock' : 'Float';
    if (floating) {
      panel.replaceChildren(...keyButtons);
      wrap.append(panel);
    } else {
      panel.remove();
      keys.prepend(...keyButtons);
    }
  }
  placePanel(o.options.panel);

  textarea.addEventListener('keydown', onKeyDown);
  textarea.addEventListener('beforeinput', (e) => onBeforeInput(/** @type {InputEvent} */ (e)));
  textarea.addEventListener('input', () => {
    if (ctx.applying) return;
    // A soft keyboard composes what is typed and cannot be stopped from putting it in the field. When it is a key of a command (Ctrl or Alt held
    // from the panel, or after ESC or C-x), the field goes back to the buffer and the characters are the command's keys.
    if (commandPending() && textarea.value !== ctx.st.text) {
      const typed = insertedText(ctx.st.text, textarea.value);
      if (typed !== null) {
        show();
        typeChars(typed);
        return;
      }
    }
    adopt();
    draw();
  });
  textarea.addEventListener('scroll', () => {
    layer.style.transform = find.style.transform;
  }, { passive: true });
  document.addEventListener('selectionchange', () => {
    if (ctx.applying || document.activeElement !== textarea) return;
    adopt();
    draw();
  });
  textarea.addEventListener('focus', refreshClipboard);
  show();
  const refresh = () => {
    adopt();
    draw();
  };
  /** The mark goes to `pos` without a region (a search left it where it began). @param {number} pos */
  const setMark = (pos) => {
    adopt();
    ctx.st = { ...ctx.st, mark: pos, active: false };
  };
  return { press, refresh, placePanel, setMark };
}
