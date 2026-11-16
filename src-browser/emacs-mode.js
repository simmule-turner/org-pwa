// @ts-check
/**
 * Emacs mode of the Text view: the textarea stays the field the device keyboard types into, and the editing is Emacs's. Keys go through
 * the keymap (src/emacs-keymap.js) to the commands (src/emacs-edit.js) with Emacs's undo list, mark and kill ring; the result is
 * written back to the textarea, drawn with a block caret, a modeline and an echo line, and a panel gives a phone the keys it lacks.
 */
import { execute, syncExternal } from '../src/emacs-edit.js';
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

/** What a read-only buffer still allows: moving, the mark and copying. */
const READ_ONLY_OK = new Set(['forward-char', 'backward-char', 'org-beginning-of-line', 'org-end-of-line', 'forward-word', 'backward-word', 'beginning-of-buffer', 'end-of-buffer', 'next-line', 'previous-line', 'set-mark-command', 'exchange-point-and-mark', 'kill-ring-save']);

/** @param {string} text @param {number} pos */
const lineAndColumn = (text, pos) => {
  const before = text.slice(0, pos);
  return { line: before.split('\n').length, column: pos - (before.lastIndexOf('\n') + 1) };
};

/**
 * @param {object} o
 * @param {HTMLTextAreaElement} o.textarea
 * @param {HTMLElement} o.root  the editor, where the modeline, the echo line and a docked panel go
 * @param {HTMLElement} o.wrap  the text and its layers, where a floating panel goes
 * @param {HTMLElement} o.find  a layer laid out as the text is
 * @param {HTMLElement} o.keys  the row of keys the panel sits above
 * @param {string} o.name  the buffer's name for the modeline
 * @param {{ panel: 'docked' | 'floating', adjusted: boolean, folded: boolean, clipboard: boolean }} o.options
 * @param {(edit: { from: number, to: number, insert: string, selStart: number, selEnd: number }, quiet: boolean) => void} o.applyEdit
 * @param {() => void} o.tab  the Tab key of the Text view
 * @param {(panel: 'docked' | 'floating') => void} o.setPanel  keeps the panel's place in the settings
 * @param {{ readText: () => Promise<string>, writeText: (text: string) => Promise<void> }} o.clipboard
 * @returns {{ press: (key: string) => void, refresh: () => void, panel: HTMLElement, placePanel: (where: 'docked' | 'floating') => void }}
 */
export function attachEmacsMode(o) {
  const { textarea, root, wrap, find, keys } = o;
  const initial = textarea.value;
  const ctx = {
    /** @type {import('../src/emacs-edit.js').EditState} */
    st: { text: initial, pos: textarea.selectionStart, mark: null, kill: [], active: false, undo: newUndo(), yank: { adjusted: o.options.adjusted, folded: o.options.folded } },
    input: newKeyInput(),
    sticky: { ctrl: false, alt: false },
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

  const modeline = document.createElement('div');
  modeline.className = 'te-modeline';
  const echo = document.createElement('div');
  echo.className = 'te-echo';
  echo.setAttribute('role', 'status');
  root.insertBefore(modeline, keys);
  root.insertBefore(echo, keys);

  /** @param {string} text */
  const say = (text) => {
    echo.textContent = text;
  };

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
      if (textarea.value !== st.text) {
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

  /** The block caret, laid out as the text is, and the modeline. */
  function draw() {
    const { st } = ctx;
    layer.style.cssText = find.style.cssText;
    layer.style.transform = find.style.transform;
    const at = st.text[st.pos];
    const block = document.createElement('span');
    block.className = 'te-block';
    block.textContent = at === undefined || at === '\n' ? ' ' : at;
    layer.replaceChildren(st.text.slice(0, st.pos), block);
    const { line, column } = lineAndColumn(st.text, st.pos);
    const room = textarea.scrollHeight - textarea.clientHeight;
    const where = room <= 1 ? 'All' : textarea.scrollTop <= 0 ? 'Top' : textarea.scrollTop >= room - 1 ? 'Bot' : `${Math.round((textarea.scrollTop / room) * 100)}%`;
    const changed = st.text !== initial ? '**' : '--';
    modeline.textContent = `-U:${changed}-  ${o.name}   ${where}   (${line},${column})   (Org)${st.active ? '   Mark set' : ''}`;
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

  // ---- keys
  /** Feeds one key, named as Emacs names it. @param {string} rawKey @returns {boolean} whether Emacs mode took it */
  function press(rawKey) {
    adopt();
    const fed = feedKey(ctx.input, rawKey);
    ctx.input = fed.input;
    const { result } = fed;
    if (result.type === 'unhandled') return false;
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
    refreshClipboard();
    let before = ctx.st;
    if (result.command === 'org-yank' && o.options.clipboard && ctx.clip && ctx.clip !== before.kill[0]) before = { ...before, kill: [ctx.clip, ...before.kill], yankAt: 0 };
    const after = execute(before, result.command, result.char, result.prefix);
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

  /** @param {InputEvent} e */
  function onBeforeInput(e) {
    if (ctx.applying || e.isComposing) return;
    const type = e.inputType;
    if (type === 'historyUndo') {
      e.preventDefault();
      press('C-/');
    } else if (type === 'historyRedo') {
      e.preventDefault();
      say('Redo: C-/ after another command undoes the undo');
    } else if (type === 'deleteContentBackward') {
      e.preventDefault();
      press('DEL');
    } else if (type === 'deleteContentForward') {
      e.preventDefault();
      press('C-d');
    } else if (type === 'insertText' && e.data && !e.data.includes('\n')) {
      e.preventDefault();
      for (const ch of e.data) {
        const name = ctx.sticky.ctrl || ctx.sticky.alt ? eventKey({ key: ch, ctrlKey: ctx.sticky.ctrl, altKey: ctx.sticky.alt }) : ch;
        if (name) press(name);
        setSticky(false, false);
      }
    }
  }

  // ---- the panel
  const panel = document.createElement('div');
  panel.className = 'te-keypanel';
  panel.setAttribute('role', 'toolbar');
  panel.setAttribute('aria-label', 'Emacs keys');
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
    panel.append(b);
    buttons[label] = b;
    return b;
  };
  /** @param {boolean} ctrl @param {boolean} alt */
  function setSticky(ctrl, alt) {
    ctx.sticky.ctrl = ctrl;
    ctx.sticky.alt = alt;
    buttons.Ctrl?.setAttribute('aria-pressed', String(ctrl));
    buttons.Alt?.setAttribute('aria-pressed', String(alt));
  }
  button('Esc', 'Escape (Meta for the next key)', () => void press('ESC'));
  button('Ctrl', 'Control for the next key', () => setSticky(!ctx.sticky.ctrl, ctx.sticky.alt));
  button('Alt', 'Alt (Meta) for the next key', () => setSticky(ctx.sticky.ctrl, !ctx.sticky.alt));
  button('Tab', 'Tab', () => {
    ctx.input = newKeyInput();
    adopt();
    o.tab();
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
    (floating ? wrap : root).insertBefore(panel, floating ? null : keys);
  }
  placePanel(o.options.panel);

  textarea.addEventListener('keydown', onKeyDown);
  textarea.addEventListener('beforeinput', (e) => onBeforeInput(/** @type {InputEvent} */ (e)));
  textarea.addEventListener('input', () => {
    if (ctx.applying) return;
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
  return { press, refresh, panel, placePanel };
}
