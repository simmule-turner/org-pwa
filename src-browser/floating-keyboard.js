// The floating keyboard: a small, draggable panel of the keys a phone's own
// on-screen keyboard has no way to type (Tab, the arrows, Shift) plus `g`,
// god-mode's most-used prefix, for using god-mode with no hardware Escape
// key. Shown only while god-mode was entered through the floating [g] button
// (S.floatingKeyboardOpen) -- see that button's handler in app.js.
//
// Every button feeds god-mode through dispatchGodModeKeystroke, the very
// same function a real keydown uses, so the two can't drift apart. The
// buttons never depend on the device's own keyboard delivering keydown:
// mobile browsers are unreliable at that (see the README), whereas a plain
// button tap always works. Letters typed on the device keyboard reach
// god-mode through the hidden input's beforeinput/input events as well as
// keydown -- see the bottom of this file.
//
// PLACEMENT. The panel is positioned relative to the MODE LINE, never the
// screen: its bottom is the mode line's own top edge (which the app already
// keeps above the device keyboard, see syncContentOffset) plus a "lift". So
// it can never sit under the device keyboard or cover the mode line, however
// the keyboard comes and goes or however far it was dragged.
import { S } from './app-state.js';
import { extraMenuBtn, floatingKeyboard, godModeBtn, godModeKeyboardInput, modelineBarEl } from './dom.js';
import { dispatchGodModeKeystroke } from './god-mode-palette.js';

export const FLOATING_BUTTON_SIZE = 44;
export const FLOATING_BUTTON_GAP = 10;

/** How far a press may travel and still count as a tap on the handle rather
 *  than the start of a drag. */
const TAP_SLOP_PX = 6;
const SCREEN_MARGIN = 8;

/** The six buttons that dispatch a key, in display order (Shift, which
 *  dispatches nothing itself, sits just before `g`). `rawKey` is what a real
 *  KeyboardEvent.key would be. Shift is applied per src/god-mode.js's own
 *  rules: named keys (Tab, the arrows) get the shiftKey flag; a printable
 *  letter carries its shift in the character itself (`g` becomes `G`), which
 *  is what distinguishes god-mode's M- prefix from its C-M- prefix. */
const KEYS = [
  { label: 'Tab', rawKey: 'Tab', aria: 'Tab' },
  { label: '\u2190', rawKey: 'ArrowLeft', aria: 'Left arrow' },
  { label: '\u2192', rawKey: 'ArrowRight', aria: 'Right arrow' },
  { label: '\u2191', rawKey: 'ArrowUp', aria: 'Up arrow' },
  { label: '\u2193', rawKey: 'ArrowDown', aria: 'Down arrow' },
  { label: 'g', shiftedLabel: 'G', rawKey: 'g', shiftedRawKey: 'G', aria: 'g' },
];

/** What a tap on `key` sends to god-mode, given whether Shift is armed. */
export function keystrokeFor(key, shiftArmed) {
  return { rawKey: shiftArmed && key.shiftedRawKey ? key.shiftedRawKey : key.rawKey, shiftKey: shiftArmed };
}

const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), Math.max(lo, hi));

/** Distance from the mode line's top edge up to where the panel sits by
 *  default: clear of the floating buttons stacked in the corner, so the [g]
 *  button that closes it is never underneath it. */
function defaultLift() {
  const extras = extraMenuBtn.style.display !== 'none';
  const stackHeight = 16 + FLOATING_BUTTON_SIZE + (extras ? FLOATING_BUTTON_SIZE + FLOATING_BUTTON_GAP : 0);
  return stackHeight + FLOATING_BUTTON_GAP;
}

function currentLift() {
  return S.floatingKeyboardPos ? S.floatingKeyboardPos.lift : defaultLift();
}

/** The bottom edge of the panel's allowed area, measured from the layout
 *  viewport's bottom: the mode line's height plus however far up the app has
 *  already lifted it to clear the device keyboard. */
function modeLineTopOffset() {
  return modelineBarEl.offsetHeight + (parseFloat(modelineBarEl.style.bottom) || 0);
}

/** Puts the panel where S.floatingKeyboardPos says (or the default), kept
 *  above the mode line and inside the visible area. Called after every
 *  render and from syncContentOffset, i.e. whenever the keyboard or viewport
 *  changes. */
export function positionFloatingKeyboard() {
  if (!S.floatingKeyboardOpen) return;
  const vv = window.visualViewport;
  const visibleHeight = vv ? vv.height : window.innerHeight;
  const maxLift = visibleHeight - modelineBarEl.offsetHeight - floatingKeyboard.offsetHeight;
  const lift = clamp(currentLift(), 0, maxLift);
  floatingKeyboard.style.top = 'auto';
  floatingKeyboard.style.bottom = modeLineTopOffset() + lift + 'px';
  if (S.floatingKeyboardPos) {
    const left = clamp(S.floatingKeyboardPos.left, 0, window.innerWidth - floatingKeyboard.offsetWidth);
    floatingKeyboard.style.left = left + 'px';
    floatingKeyboard.style.right = 'auto';
  } else {
    floatingKeyboard.style.left = 'auto';
    floatingKeyboard.style.right = SCREEN_MARGIN + 'px';
  }
}

/** Closes the floating keyboard's own state and dismisses the device keyboard
 *  -- the one place that happens, whether the person tapped [g] again, god-mode
 *  ended some other way, or the device keyboard was dismissed. */
export function closeFloatingKeyboard() {
  S.floatingKeyboardOpen = false;
  S.floatingKeyboardShiftArmed = false;
  S.floatingKeyboardMinimized = false;
  resetGodModeKeyboardInput();
  if (document.activeElement === godModeKeyboardInput) godModeKeyboardInput.blur();
}

function styleButton(btn, { armed = false } = {}) {
  btn.type = 'button';
  btn.tabIndex = -1;
  btn.style.minWidth = '40px';
  btn.style.minHeight = FLOATING_BUTTON_SIZE + 'px';
  btn.style.fontSize = '16px';
  btn.style.margin = '0';
  btn.style.padding = '0 4px';
  btn.style.border = '1px solid var(--border-strong)';
  btn.style.borderRadius = '8px';
  btn.style.background = armed ? 'var(--accent)' : 'var(--surface)';
  btn.style.color = armed ? '#fff' : 'var(--fg)';
  btn.style.touchAction = 'manipulation';
  btn.style.userSelect = 'none';
  btn.style.webkitUserSelect = 'none';
}

/** The move area. Dragging it moves the panel; a plain tap (a press that
 *  never travels past TAP_SLOP_PX) minimizes the panel to just this handle so
 *  what's behind it can be seen, and a tap on the minimized handle restores it. */
function wireHandle(handle) {
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation(); // the app's document-level pointerdown clears the status line
    const startX = e.clientX;
    const startY = e.clientY;
    const left0 = floatingKeyboard.getBoundingClientRect().left;
    const lift0 = currentLift();
    let dragging = false;
    handle.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!dragging && Math.hypot(dx, dy) <= TAP_SLOP_PX) return;
      dragging = true;
      S.floatingKeyboardPos = { left: left0 + dx, lift: lift0 - dy };
      positionFloatingKeyboard();
    };
    const finish = (isTap) => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', cancel);
      if (isTap) {
        S.floatingKeyboardMinimized = !S.floatingKeyboardMinimized;
        renderFloatingKeyboard();
      }
    };
    const up = () => finish(!dragging);
    const cancel = () => finish(false);
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', cancel);
  });
}

/** Builds/shows/hides the panel and keeps the [g] button's look in step with
 *  it; called from render(). */
export function renderFloatingKeyboard() {
  // god-mode ended by some other route (a real Escape, a chord that opened
  // another panel, ...): follow it, so the two can never disagree.
  if (S.floatingKeyboardOpen && !S.godModeActive) closeFloatingKeyboard();

  const open = S.floatingKeyboardOpen;
  godModeBtn.style.opacity = open ? '0.95' : '0.35';
  godModeBtn.style.zIndex = open ? '901' : '50'; // above the panel, so it is always tappable to close it
  godModeBtn.setAttribute('aria-pressed', open ? 'true' : 'false');

  if (!open) {
    floatingKeyboard.style.display = 'none';
    floatingKeyboard.innerHTML = '';
    return;
  }

  const minimized = S.floatingKeyboardMinimized;
  const armed = S.floatingKeyboardShiftArmed;

  floatingKeyboard.innerHTML = '';
  floatingKeyboard.style.display = 'flex';
  floatingKeyboard.style.position = 'fixed';
  floatingKeyboard.style.zIndex = '900';
  floatingKeyboard.style.alignItems = 'center';
  floatingKeyboard.style.gap = '3px';
  floatingKeyboard.style.padding = '3px';
  floatingKeyboard.style.maxWidth = 'calc(100vw - ' + 2 * SCREEN_MARGIN + 'px)';
  floatingKeyboard.style.boxSizing = 'border-box';
  floatingKeyboard.style.background = 'var(--modal-bg)';
  floatingKeyboard.style.border = '1px solid var(--border-strong)';
  floatingKeyboard.style.borderRadius = '10px';
  floatingKeyboard.style.boxShadow = '0 4px 14px rgba(0,0,0,0.35)';
  floatingKeyboard.setAttribute('role', 'toolbar');
  floatingKeyboard.setAttribute('aria-label', 'God-mode keys');

  const handle = document.createElement('div');
  handle.setAttribute('data-fk-handle', '');
  handle.setAttribute('role', 'button');
  handle.setAttribute('aria-label', minimized ? 'Restore keyboard (drag to move)' : 'Minimize keyboard (drag to move)');
  handle.setAttribute('aria-expanded', minimized ? 'false' : 'true');
  handle.textContent = '\u283f';
  handle.style.cursor = 'grab';
  handle.style.touchAction = 'none'; // so a drag moves the panel rather than scrolling the page
  handle.style.display = 'flex';
  handle.style.alignItems = 'center';
  handle.style.justifyContent = 'center';
  handle.style.minWidth = minimized ? FLOATING_BUTTON_SIZE + 'px' : '28px';
  handle.style.minHeight = FLOATING_BUTTON_SIZE + 'px';
  handle.style.fontSize = '20px';
  handle.style.opacity = minimized ? '0.9' : '0.6';
  handle.style.userSelect = 'none';
  handle.style.webkitUserSelect = 'none';
  floatingKeyboard.appendChild(handle);
  wireHandle(handle);

  if (!minimized) {
    const shiftBtn = document.createElement('button');
    shiftBtn.textContent = 'S';
    shiftBtn.setAttribute('aria-label', 'Shift');
    shiftBtn.setAttribute('aria-pressed', armed ? 'true' : 'false');
    shiftBtn.setAttribute('data-fk-shift', '');
    styleButton(shiftBtn, { armed });
    shiftBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation(); // keeps the app's document-level pointerdown (which clears the status line) out of it
      S.floatingKeyboardShiftArmed = !S.floatingKeyboardShiftArmed;
      renderFloatingKeyboard();
    });

    for (const key of KEYS) {
      const btn = document.createElement('button');
      btn.textContent = armed && key.shiftedLabel ? key.shiftedLabel : key.label;
      btn.setAttribute('aria-label', key.aria);
      btn.setAttribute('data-fk-key', key.rawKey);
      styleButton(btn);
      // pointerdown, not click, and preventDefault: a button tap would
      // otherwise move focus off the hidden input, which looks exactly like
      // the device keyboard being dismissed (see the input's blur handler).
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation(); // else the document-level pointerdown clears the god-mode indicator this tap just set
        const { rawKey, shiftKey } = keystrokeFor(key, S.floatingKeyboardShiftArmed);
        S.floatingKeyboardShiftArmed = false; // one-shot: consumed by this tap
        dispatchGodModeKeystroke(rawKey, shiftKey);
      });
      if (key.rawKey === 'g') floatingKeyboard.appendChild(shiftBtn); // layout: T \u2190 \u2192 \u2191 \u2193 S g
      floatingKeyboard.appendChild(btn);
    }
  }

  positionFloatingKeyboard();
}

// ---- Letters typed on the device keyboard --------------------------------
//
// A physical keyboard, and some phone keyboards, deliver a keydown carrying
// the real key, which the app's global handler turns into a god-mode keystroke
// (and cancels, so no text is ever inserted). But most Android keyboards
// (Gboard among them) type through an input-method editor: every keydown
// arrives as key "Unidentified" (keyCode 229) and the actual letter shows up
// only as an input event -- a plain `insertText`, or text inside a composition.
// A handler that listened to keydown alone never saw those letters at all,
// which is exactly how it failed on Android. So the hidden input's own
// beforeinput/input events feed god-mode too, and the app's keydown handler
// ignores the keydowns that carry no key.

// State, on S like everything shared (app.js initialises it):
//   S.godModeInputFedLength -- how many characters of the hidden input's value
//     have already been sent on to god-mode, for the composition case where the
//     value grows in place;
//   S.godModeRecentKeydown -- { key, at } for a key the keydown path just
//     delivered, so the same keystroke arriving again as an input event (some
//     keyboards send both) is not counted twice.

export function resetGodModeKeyboardInput() {
  S.godModeInputFedLength = 0;
  if (godModeKeyboardInput) godModeKeyboardInput.value = '';
}

/** Called by app.js's keydown handler when it delivered `key` from the hidden input. */
export function noteKeydownDelivered(key) {
  S.godModeRecentKeydown = { key, at: Date.now() };
}

function feedText(text) {
  for (const ch of text) {
    if (!S.godModeActive) return;
    const recent = S.godModeRecentKeydown;
    if (recent && recent.key === ch && Date.now() - recent.at < 120) {
      S.godModeRecentKeydown = null; // the keydown path already sent this one
      continue;
    }
    // a printable letter carries its own shift in the character (see KEYS above)
    dispatchGodModeKeystroke(ch === '\n' ? 'Enter' : ch, ch.length === 1 && ch !== ch.toLowerCase());
  }
}

if (godModeKeyboardInput) {
  godModeKeyboardInput.addEventListener('beforeinput', (e) => {
    if (!S.godModeActive) return;
    if (e.inputType === 'insertText' && e.data) {
      e.preventDefault(); // this is a keystroke for god-mode, not text for the field
      feedText(e.data);
    } else if (e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph') {
      e.preventDefault();
      feedText('\n');
    }
    // composition text can't be cancelled; the input event below picks it up
  });

  godModeKeyboardInput.addEventListener('input', (e) => {
    const value = godModeKeyboardInput.value;
    if (S.godModeActive && value.length > S.godModeInputFedLength) feedText(value.slice(S.godModeInputFedLength));
    S.godModeInputFedLength = value.length;
    // clearing mid-composition can make some keyboards re-insert the text, so
    // only start over once the composition has ended
    if (!e.isComposing && value.length > 0) resetGodModeKeyboardInput();
  });

  godModeKeyboardInput.addEventListener('compositionend', () => resetGodModeKeyboardInput());
}
