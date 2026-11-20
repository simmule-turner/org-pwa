// @ts-check
/**
 * Emacs mode of the Text view: the textarea stays the field the device keyboard types into, and the editing is Emacs's. Keys go through
 * the keymap (src/emacs-keymap.js) to the commands (src/emacs-edit.js) with Emacs's undo list, mark and kill ring; the result is
 * written back to the textarea, drawn with a block caret, a modeline and an echo line, and a panel gives a phone the keys it lacks.
 */
import { answerDisabled, syncExternal } from '../src/emacs-edit.js';
import { foldedExecute } from '../src/emacs-fold.js';
import { scrollWindow } from '../src/emacs-scroll.js';
import { BINDINGS, eventKey, feedKey, newKeyInput } from '../src/emacs-keymap.js';
import { newUndo } from '../src/emacs-undo.js';
import { bufferListLines } from '../src/emacs-buffers.js';
import { readMinibuffer, showList } from './emacs-minibuffer.js';
import { describeEditor, noteKeyLog } from './key-log.js';
import { deviceKeyboardShowing } from './floating-keyboard.js';

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

/** The characters a soft keyboard just put in the field, when that is what typing them at the caret (over the region, if there is one) would make:
 *  Emacs's own `self-insert-command` then does the typing, so the undo groups, the kill ring and the region are Emacs's.
 *  @param {{ text: string, pos: number, mark: number | null, active?: boolean }} st @param {string} value @returns {string | null} */
function composedTyping(st, value) {
  const region = st.active && st.mark !== null && st.mark !== st.pos;
  const from = region ? Math.min(st.pos, /** @type {number} */ (st.mark)) : st.pos;
  const to = region ? Math.max(st.pos, /** @type {number} */ (st.mark)) : st.pos;
  const length = value.length - (st.text.length - (to - from));
  if (length <= 0) return null;
  const typed = value.slice(from, from + length);
  return typed.includes('\n') || st.text.slice(0, from) + typed + st.text.slice(to) !== value ? null : typed;
}

/** The visibility commands, which the fold model runs. */
const FOLD_COMMANDS = new Set(['org-cycle', 'org-shifttab', 'org-fold-reveal']);

/** What a read-only buffer still allows: moving, the mark and copying. */
const READ_ONLY_OK = new Set(['dired', 'dired-jump', 'find-file', 'forward-char', 'backward-char', 'org-beginning-of-line', 'org-end-of-line', 'forward-word', 'backward-word', 'beginning-of-buffer', 'end-of-buffer', 'next-line', 'previous-line', 'set-mark-command', 'exchange-point-and-mark', 'kill-ring-save', 'org-forward-sentence', 'org-backward-sentence', 'isearch-forward', 'isearch-backward', 'scroll-up-command', 'scroll-down-command']);

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
  const { textarea, wrap, find, keys } = o;
  /** The echo area's messages, as `*Messages*` keeps them. @type {string[]} */
  const messages = [];
  /** @type {string[]} */
  const commandHistory = [];
  /** @param {string} text */
  const say = (text) => {
    if (text && messages[messages.length - 1] !== text) messages.push(text);
    if (messages.length > 1000) messages.shift();
    o.say(text);
  };
  const initial = textarea.value;
  const ctx = {
    /** @type {import('../src/emacs-edit.js').EditState} */
    st: { text: initial, pos: textarea.selectionStart, mark: null, kill: [], active: false, undo: newUndo(), yank: { adjusted: o.options.adjusted, folded: o.options.folded } },
    input: newKeyInput(),
    /** The echo of the keys of an unfinished sequence or prefix argument (`C-u 5-`). */
    pendingEcho: '',
    sticky: { ctrl: false, alt: false, shift: false },
    applying: false,
    /** @type {[number, number, string]} */
    shown: [-1, -1, 'none'],
    /** @type {string | null} */
    clip: null,
    /** Counts the page's own writes to the clipboard: a read that began before one is out of date when it ends. */
    clipWritten: /** @type {Promise<void>} */ (Promise.resolve()),
    held: /** @type {Promise<unknown> | null} */ (null),
    yankWait: /** @type {Promise<unknown> | null} */ (null),
  };

  wrap.classList.add('te-emacs');
  const layer = document.createElement('div');
  layer.className = 'te-caret';
  layer.setAttribute('aria-hidden', 'true');
  wrap.insertBefore(layer, textarea);

  // ---- the kill ring and the device clipboard
  // The device clipboard is read only when a yank asks for it: a read on every key or every touch makes iOS show its Paste prompt each time.
  const readClipboard = () =>
    ctx.clipWritten
      .then(() => o.clipboard.readText()) // after our own write of a kill has ended, so the read is not of the text before it
      .then(
        (text) => {
          ctx.clip = text;
        },
        () => {} // the device may not let the page read it; the kill ring then stays the app's own
      );
  /** @param {import('../src/emacs-edit.js').EditState} before @param {import('../src/emacs-edit.js').EditState} after */
  const syncKillRing = (before, after) => {
    if (!o.options.clipboard || after.kill[0] === undefined || after.kill === before.kill) return; // a kill makes a new ring, even when its text equals the one before
    ctx.clip = after.kill[0];
    ctx.clipWritten = o.clipboard.writeText(after.kill[0]).catch(() => {});
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
    // a tap or drag is a command of its own (`mouse-set-point`): the goal column of C-n and C-p and the appending of kills start over
    const touched = { goal: null, last: 'mouse-set-point' };
    if (a === b) ctx.st = { ...ctx.st, ...touched, pos: a, active: false };
    else ctx.st = dir === 'backward' ? { ...ctx.st, ...touched, pos: a, mark: b, active: true } : { ...ctx.st, ...touched, pos: b, mark: a, active: true };
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
  /** Feeds one key, named as Emacs names it. @param {string} rawKey @param {boolean} [replay] the key was held back and now runs @returns {boolean} whether Emacs mode took it */
  function press(rawKey, replay = false, kept = false) {
    if (ctx.held && !replay) { // a yank is waiting for the clipboard: the keys after it wait their turn
      const later = ctx.held.then(() => {
        ctx.yankWait = null;
        press(rawKey, true);
        return ctx.yankWait ?? undefined; // a yank among the held keys holds the ones after it as well
      });
      ctx.held = later;
      void later.then(() => {
        if (ctx.held === later) ctx.held = null;
      });
      return true;
    }
    if (!kept) adopt(); // (kept: the field was already changed by the keyboard, and the state is what it was before)
    if (ctx.st.asking && rawKey !== 'C-g') { // a disabled command (C-x C-u) waits for y, SPC, ! or n
      const before = ctx.st;
      ctx.st = answerDisabled(before, rawKey) ?? before;
      ctx.input = newKeyInput();
      say(ctx.st.error ?? ctx.st.message ?? '');
      syncKillRing(before, ctx.st);
      show();
      return true;
    }
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
      ctx.pendingEcho = result.echo;
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
    const ran = runCommand(result);
    if (result.again) press(result.again); // the key that ended a character code is typed as itself
    return ran;
  }

  /** Runs a command by its Emacs name, from a key or from M-x. @param {{ command: string, char?: string, prefix?: { n: number, universal: boolean } }} result @returns {boolean} */
  function runCommand(result) {
    if (result.command === 'execute-extended-command') {
      void extendedCommand();
      return true;
    }
    if (BUFFER_COMMANDS.has(result.command)) {
      void bufferCommand(result.command);
      return true;
    }
    if (result.command === 'dired' || result.command === 'dired-jump' || result.command === 'find-file') { // the Files list, in the folder of the current file
      void import('./file-screen.js').then((m) => m.openFileScreen('open', { dired: true, jump: result.command === 'dired-jump' }));
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
    const execute = () => {
      let before = ctx.st;
      if (result.command === 'org-yank' && o.options.clipboard && ctx.clip && ctx.clip !== before.kill[0]) before = { ...before, kill: [ctx.clip, ...before.kill], yankAt: 0 };
      const after = foldedExecute(before, o.fold.hidden(), result.command, result.char, result.prefix);
      ctx.st = { ...after, message: undefined };
      syncKillRing(before, after);
      say(after.error ?? after.message ?? ''); // the echo area: the error, or what the command prints ("Mark set", "Undo")
      show();
    };
    if (result.command === 'org-yank' && o.options.clipboard) {
      const done = readClipboard().then(execute);
      ctx.yankWait = done;
      if (!ctx.held) { // otherwise the keys held back already carry on after it
        ctx.held = done;
        void done.then(() => {
          if (ctx.held === done) ctx.held = null;
        });
      }
    } else execute();
    return true;
  }

  // ---- M-x and the buffer commands
  const BUFFER_COMMANDS = new Set(['switch-to-buffer', 'kill-buffer', 'list-buffers', 'view-echo-area-messages']);
  /** The Emacs mode commands M-x offers: those with a key, less the argument keys. */
  const modeCommands = () => [...new Set(Object.values(BINDINGS))].filter((c) => !['digit-argument', 'negative-argument', 'universal-argument', 'self-insert-command', 'org-force-self-insert', 'quoted-insert', 'execute-extended-command'].includes(c));

  async function extendedCommand() {
    const { findPaletteCommandByOrgName, paletteCommandList, runPaletteCommand } = await import('./god-mode-palette.js');
    /** @type {string[]} */ const palette = [];
    for (const c of paletteCommandList()) if (c.orgName) palette.push(c.orgName);
    const names = [...new Set([...modeCommands(), ...palette])].sort();
    const typed = await readMinibuffer({ host: wrap, prompt: 'M-x ', candidates: names, requireMatch: true, history: commandHistory, message: say });
    textarea.focus();
    if (typed === null) {
      say('Quit');
      return;
    }
    commandHistory.unshift(typed);
    say(`M-x ${typed}`);
    if (modeCommands().includes(typed)) {
      ctx.input = newKeyInput();
      runCommand({ command: typed });
      return;
    }
    const command = findPaletteCommandByOrgName(typed);
    if (command) {
      adopt();
      runPaletteCommand(command, null);
    }
  }

  /** The open files, in tab order, with the one showing. */
  async function openBuffers() {
    const { S } = await import('./app-state.js');
    const { documentDisplayLabel } = await import('./sync-helpers.js');
    return S.documentSessions.map((/** @type {import('../src/types.js').TabSession} */ session) => {
      const active = session.tabId === S.activeTabId;
      const id = active ? S.state.documentId : session.state.documentId;
      const doc = active ? S.state.doc : session.state.doc;
      return { tabId: session.tabId, active, name: documentDisplayLabel(id, doc), modified: active ? S.isDirty : session.isDirty, file: String(id) };
    });
  }

  /** @param {string} command */
  async function bufferCommand(command) {
    const buffers = await openBuffers();
    if (command === 'view-echo-area-messages') {
      await showList({ host: wrap, title: '*Messages*', lines: messages.length ? messages : ['(no messages yet)'] });
      textarea.focus();
      return;
    }
    if (command === 'list-buffers') {
      const lines = bufferListLines(buffers, buffers.findIndex((b) => b.active));
      await showList({
        host: wrap,
        title: '*Buffer List*',
        lines,
        onPick: (index) => {
          const picked = buffers[index - 2];
          if (picked) void import('./tabs.js').then((t) => t.switchToTab(picked.tabId));
        },
      });
      return;
    }
    const names = [...buffers.map((b) => b.name), '*Messages*'];
    const current = buffers.find((b) => b.active);
    const others = buffers.filter((b) => !b.active);
    const prompt = command === 'kill-buffer' ? `Kill buffer (default ${current?.name ?? ''}): ` : `Switch to buffer (default ${others[0]?.name ?? current?.name ?? ''}): `;
    const typed = await readMinibuffer({ host: wrap, prompt, candidates: names, fold: true, message: say });
    textarea.focus();
    if (typed === null) {
      say('Quit');
      return;
    }
    const wanted = typed === '' ? (command === 'kill-buffer' ? current : others[0] ?? current) : buffers.find((b) => b.name === typed);
    const tabs = await import('./tabs.js');
    if (typed === '*Messages*') {
      await showList({ host: wrap, title: '*Messages*', lines: messages.length ? messages : ['(no messages yet)'] });
      textarea.focus();
      return;
    }
    if (!wanted) {
      say(command === 'kill-buffer' ? `No buffer named ${typed}` : `No buffer named ${typed} (the files are the open tabs)`);
      return;
    }
    if (command === 'kill-buffer') await tabs.closeTab(wanted.tabId);
    else tabs.switchToTab(wanted.tabId);
  }

  /** @param {KeyboardEvent} e */
  function onKeyDown(e) {
    noteKeyLog('emacs keydown', { key: e.key, code: e.code, keyCode: e.keyCode, composing: e.isComposing, state: { pos: ctx.st.pos, sel: [textarea.selectionStart, textarea.selectionEnd] } });
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
      if (e.key === 'Enter' && !e.shiftKey && !textarea.readOnly) { // RET is Emacs's: org-return, or the end of a C-q code (C-q 1 0 1 RET drops the Return; C-q RET inserts it)
        if (press('RET')) e.preventDefault();
        setSticky(false, false);
        return;
      }
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

  /** Characters typed as keys: with Ctrl or Alt held from the panel the first one is that key with the modifier. @param {string} data @param {boolean} [kept] whether the keyboard has already put them in the field */
  function typeChars(data, kept = false) {
    for (const ch of data) {
      const name = ctx.sticky.ctrl || ctx.sticky.alt ? eventKey({ key: ch, ctrlKey: ctx.sticky.ctrl, altKey: ctx.sticky.alt }) : ch;
      if (name) press(name, false, kept);
      setSticky(false, false);
    }
  }

  /** The kind of edit the page just did itself, until the browser's own `input` event for it has been seen. @type {string | null} */
  let handledEdit = null;
  /** When the page last made an edit itself (`performance.now()`): a browser's own edit that follows closely, of any kind, is taken back. */
  let handledAt = -Infinity;
  /** @param {InputEvent} e */
  function onBeforeInput(e) {
    noteKeyLog('emacs beforeinput', { type: e.inputType, data: e.data, composing: e.isComposing, cancelable: e.cancelable, applying: ctx.applying, state: { pos: ctx.st.pos, sel: [textarea.selectionStart, textarea.selectionEnd] } });
    if (ctx.applying || e.isComposing) return;
    const type = e.inputType;
    if (!['historyUndo', 'historyRedo', 'deleteContentBackward', 'deleteContentForward', 'insertText', 'insertLineBreak', 'insertParagraph'].includes(type)) return;
    if (type === 'insertText' && (!e.data || e.data.includes('\n'))) return;
    // A browser can refuse to let the page cancel an edit (a soft keyboard's, on some phones). It then makes the edit itself, on the range it
    // planned before this event; doing the command as well would delete or type twice, so the edit is left to the browser and taken in as it is.
    e.preventDefault();
    if (!e.defaultPrevented) {
      noteKeyLog('emacs beforeinput could not be canceled: left to the browser');
      return;
    }
    // some browsers make the edit anyway, after the command: the `input` event of the same kind that follows is that edit, and is taken back
    handledEdit = type;
    handledAt = performance.now();
    setTimeout(() => {
      handledEdit = null;
    }, 0);
    if (type === 'historyUndo') press('C-/');
    else if (type === 'historyRedo') press('C-?');
    else if (type === 'deleteContentBackward') press('DEL');
    else if (type === 'deleteContentForward') press('C-d');
    else if (type === 'insertLineBreak' || type === 'insertParagraph') press('RET');
    else typeChars(/** @type {string} */ (e.data));
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
      const had = document.activeElement === textarea;
      // Android's back gesture puts the keyboard away and leaves the text focused; the edit a key makes would bring it back,
      // so while the keyboard is away the text takes no input method for a moment
      const away = had && textarea.inputMode !== 'none' && !deviceKeyboardShowing();
      if (away) textarea.inputMode = 'none';
      noteKeyLog('panel key', { key: label, ...describeEditor(textarea), keyboardAway: away });
      act();
      if (away) setTimeout(() => { if (textarea.inputMode === 'none') textarea.inputMode = ''; }, 250);
      if (had && document.activeElement !== textarea && !promptField() && textarea.inputMode !== 'none') textarea.focus({ preventScroll: true }); // the text keeps the focus it had (a prompt keeps its own); a keyboard put away stays away
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
    buttons.Meta?.setAttribute('aria-pressed', String(alt));
    buttons.Shift?.setAttribute('aria-pressed', String(shift));
    // the echo area shows what is held after the keys typed so far (C-u 5 C-), as Emacs shows a prefix
    const typed = ctx.input.pending.length > 0 || ctx.input.arg ? ctx.pendingEcho.replace(/-$/, '') : '';
    const held = `${ctrl ? 'C-' : ''}${alt ? 'M-' : ''}${shift ? 'S-' : ''}`;
    if (ctrl || alt || shift) say(typed ? `${typed} ${held}` : held);
    else if (typed) say(`${typed}-`);
  }
  /** The text field of a prompt (Find, the minibuffer) that has the focus: the panel's keys go there rather than to the text. */
  const promptField = () => ((document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) && document.activeElement !== textarea ? document.activeElement : null);
  /** Sends a key to the prompt as a keyboard event, with the modifiers the panel holds. @param {string} key @returns {boolean} whether a prompt had the focus */
  function toPrompt(key) {
    const field = promptField();
    if (!field) return false;
    const init = { key, bubbles: true, cancelable: true, ctrlKey: ctx.sticky.ctrl, altKey: ctx.sticky.alt, shiftKey: ctx.sticky.shift };
    setSticky(false, false);
    field.dispatchEvent(new KeyboardEvent('keydown', init));
    return true;
  }
  /** An arrow key: the prompt's (history, the next match) or the text's. @param {string} key @param {string} emacs */
  const arrow = (key, emacs) => () => void (toPrompt(key) || press(emacs));
  // Meta, Ctrl, Shift, Tab, the arrows, the device keyboard and the panel's place: every other key is typed with them (C-g is Ctrl and g)
  button('Meta', 'Meta for the next key', () => setSticky(ctx.sticky.ctrl, !ctx.sticky.alt, ctx.sticky.shift));
  button('Ctrl', 'Control for the next key', () => setSticky(!ctx.sticky.ctrl, ctx.sticky.alt, ctx.sticky.shift));
  button('Shift', 'Shift for the next key', () => setSticky(ctx.sticky.ctrl, ctx.sticky.alt, !ctx.sticky.shift));
  button('Tab', 'Tab (with Shift: S-TAB)', () => {
    if (toPrompt('Tab')) return;
    const name = ctx.sticky.shift ? '<backtab>' : 'TAB';
    setSticky(false, false);
    if (!press(name)) o.tab();
  });
  button('←', 'Left', arrow('ArrowLeft', 'C-b'));
  button('↑', 'Up', arrow('ArrowUp', 'C-p'));
  button('↓', 'Down', arrow('ArrowDown', 'C-n'));
  button('→', 'Right', arrow('ArrowRight', 'C-f'));
  button('⌨', 'Show or hide the device keyboard', () => {
    textarea.inputMode = textarea.inputMode === 'none' ? 'text' : 'none';
    if (textarea.inputMode !== 'none') textarea.focus();
  });
  const placeBtn = button('Float', 'Float the key panel over the text, or dock it', () => o.setPanel(panel.classList.contains('te-floating') ? 'docked' : 'floating'));

  // With Ctrl or Meta held from the panel, the next character typed into a prompt is that key with the modifier (Ctrl and g quit the search).
  /** @type {string | null} */ let beforeTyping = null;
  document.addEventListener('beforeinput', (e) => {
    const field = promptField();
    if (!wrap.isConnected || !field || e.target !== field || !(ctx.sticky.ctrl || ctx.sticky.alt)) return;
    if (e.inputType === 'insertText' && e.data) {
      e.preventDefault();
      toPrompt(e.data[0]);
    } else beforeTyping = field.value; // a keyboard that composes what it types: the field goes back to what it was when the input comes
  }, true);
  document.addEventListener('input', (e) => {
    const field = promptField();
    if (beforeTyping === null || !field || e.target !== field) return;
    const typed = insertedText(beforeTyping, field.value);
    field.value = beforeTyping;
    beforeTyping = null;
    if (typed) {
      e.stopPropagation();
      toPrompt(typed[0]);
    }
  }, true);

  /** @param {'docked' | 'floating'} where */
  function placePanel(where) {
    const floating = where === 'floating';
    panel.classList.toggle('te-floating', floating);
    placeBtn.textContent = floating ? 'Dock' : 'Float';
    // the row's own Tab repeats the panel's, and docked, the panel is the whole row: symbols are typed on the device keyboard
    for (const key of Array.from(keys.children)) if (key instanceof HTMLElement && !keyButtons.includes(/** @type {HTMLButtonElement} */ (key))) key.style.display = floating && key.textContent !== 'Tab' ? '' : 'none';
    if (floating) {
      panel.replaceChildren(...keyButtons);
      wrap.append(panel);
    } else {
      panel.remove();
      keys.prepend(...keyButtons);
    }
  }
  placePanel(o.options.panel);

  /** What of the composition now going on has already been taken as the keys of a command. */
  let composeFed = '';
  /** The caret and the text when that was last taken, to tell a composition that goes on from a new one. */
  let composeAt = -1;
  let composeText = '';
  textarea.addEventListener('compositionend', () => {
    composeFed = '';
  });
  textarea.addEventListener('keydown', onKeyDown);
  textarea.addEventListener('beforeinput', (e) => onBeforeInput(/** @type {InputEvent} */ (e)));
  textarea.addEventListener('input', (e) => {
    noteKeyLog('emacs input', { type: /** @type {InputEvent} */ (e).inputType, applying: ctx.applying, handled: handledEdit, editor: describeEditor(textarea), text: ctx.st.text === textarea.value ? 'same' : 'differs' });
    if (ctx.applying) return;
    if (handledEdit !== null && /** @type {InputEvent} */ (e).inputType === handledEdit) {
      handledEdit = null;
      show(); // the browser made the edit too: the text goes back to what the command made it
      return;
    }
    // a line break the keyboard made itself (it would not let the page cancel it) is RET all the same, with its count
    const kind = /** @type {InputEvent} */ (e).inputType;
    if ((kind === 'insertLineBreak' || kind === 'insertParagraph') && !textarea.readOnly && textarea.value !== ctx.st.text && insertedText(ctx.st.text, textarea.value) === '\n') {
      show();
      press('RET');
      return;
    }
    // Android keyboards can add a second edit of another kind right after the one the page made (a Backspace that also removes the character
    // after the caret): within a moment of the page's own edit, whatever else changed the field is undone.
    if (!(/** @type {InputEvent} */ (e).isComposing) && performance.now() - handledAt < 400 && textarea.value !== ctx.st.text) {
      noteKeyLog('emacs input: extra edit after ours taken back');
      show();
      return;
    }
    // A soft keyboard composes what is typed and cannot be stopped from putting it in the field. When it is a key of a command (Ctrl or Alt held
    // from the panel, or after ESC or C-x), the field goes back to the buffer and the characters are the command's keys.
    const composing = Boolean(/** @type {InputEvent} */ (e).isComposing);
    if (!composing) composeFed = '';
    // the composition got shorter: a Backspace on a keyboard that deletes inside what it is composing (the keys it was sent are `u5`, now it holds `u`)
    if (composing && composeFed !== '' && commandPending() && ctx.st.pos === composeAt && ctx.st.text === composeText) {
      const left = textarea.value === ctx.st.text ? '' : insertedText(ctx.st.text, textarea.value);
      if (left !== null && left.length < composeFed.length && composeFed.startsWith(left)) {
        const removed = composeFed.length - left.length;
        composeFed = '';
        show();
        for (let i = 0; i < removed; i++) press('DEL');
        setSticky(false, false);
        return;
      }
    }
    if (commandPending() && textarea.value !== ctx.st.text) {
      const typed = insertedText(ctx.st.text, textarea.value);
      if (typed !== null) {
        // the keyboard puts the word before the caret in its composition and sends it whole again with each key: only what follows what was already taken as keys is new
        // (a keyboard that never ends a composition is told apart by the buffer: once a key has moved the caret or changed the text, it is a new one)
        const goingOn = composing && composeFed !== '' && typed.startsWith(composeFed) && ctx.st.pos === composeAt && ctx.st.text === composeText;
        const fresh = goingOn ? typed.slice(composeFed.length) : typed;
        composeFed = composing ? typed : '';
        composeAt = ctx.st.pos;
        composeText = ctx.st.text;
        show();
        typeChars(fresh);
        return;
      }
    }
    // letters a soft keyboard composes: typed by Emacs's own command rather than taken in as the browser's edit
    if (composing && !commandPending() && !ctx.held && !textarea.readOnly) {
      const typed = composedTyping(ctx.st, textarea.value);
      if (typed) {
        typeChars(typed, true);
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
