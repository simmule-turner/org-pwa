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
// PLACEMENT. The panel always sits above the mode line (which the app already
// keeps above the device keyboard, see syncContentOffset) and above the floating
// buttons, so it can never be hidden behind the device keyboard or cover either.
// If the keyboard comes up under it, it is pushed up -- and then STAYS there when
// the keyboard goes away: it never moves down on its own, only when dragged.
//
// LIFETIME. The panel follows god-mode ([g], Escape, another panel opening), not
// the device keyboard: hiding the keyboard leaves both alone, and the panel's
// own keyboard key shows or hides it again.
import { S } from './app-state.js';
import { extraMenuBtn, floatingKeyboard, godModeBtn, godModeKeyboardInput, modelineBarEl } from './dom.js';
import { getGodModeButton } from '../src/local-variables.js';
import { dispatchGodModeKeystroke } from './god-mode-palette.js';
import { setFloatingKeyboardPos } from './settings.js';
import { kv } from './singletons.js';
import { safeAreaTop } from './ui-widgets.js';

export const FLOATING_BUTTON_SIZE = 44;
export const FLOATING_BUTTON_GAP = 10;

/** How far a press may travel and still count as a tap on the handle rather
 *  than the start of a drag. */
const TAP_SLOP_PX = 6;
const SCREEN_MARGIN = 8;
/** Keys are narrower than a full touch target wide (they stay 44px tall) so the
 *  panel, with its keyboard key, still fits a 360px-wide screen. */
const KEY_MIN_WIDTH = 34;
/** How much of the screen the app must have lifted its mode line for, before
 *  the device keyboard counts as showing. */
const KEYBOARD_INSET_PX = 80;

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

/** The floating S also shifts the next key typed on the DEVICE keyboard, which
 *  has no Shift+Enter (or Shift+anything-but-a-letter) of its own to send:
 *  tap g, tap S, then tap Return, and god-mode sees Shift+Enter (M-S-RET).
 *  Applies the armed Shift to a keystroke that came from the device keyboard
 *  and, like the floating buttons, consumes it -- one-shot, whichever keyboard
 *  the next key comes from. A letter becomes its capital (the shift a printable
 *  key carries in the character itself, see KEYS); a named key such as Enter
 *  gets the shiftKey flag. */
export function withArmedShift(rawKey, shiftKey) {
  if (!S.floatingKeyboardShiftArmed) return { rawKey, shiftKey };
  S.floatingKeyboardShiftArmed = false;
  // only a plain single character changes case (a few, like the German sharp s, would become two)
  const upper = rawKey.length === 1 && rawKey.toUpperCase().length === 1 ? rawKey.toUpperCase() : rawKey;
  return { rawKey: upper, shiftKey: true };
}

const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), Math.max(lo, hi));

/** The room the panel must leave above the mode line so it never covers the
 *  floating buttons stacked in the corner -- above all the [g] that closes it. */
function buttonClearance() {
  const extras = extraMenuBtn.style.display !== 'none';
  return 16 + FLOATING_BUTTON_SIZE + (extras ? FLOATING_BUTTON_SIZE + FLOATING_BUTTON_GAP : 0) + FLOATING_BUTTON_GAP;
}

/** The mode line's top edge, measured up from the layout viewport's bottom: its
 *  height plus however far the app has already lifted it to clear the device
 *  keyboard. */
function modeLineTopOffset() {
  return modelineBarEl.offsetHeight + (parseFloat(modelineBarEl.style.bottom) || 0);
}

/** The lowest the panel may sit: clear of the mode line and of the floating buttons above it. */
function lowestBottom() {
  return modeLineTopOffset() + buttonClearance();
}

/** The highest it may sit and still be entirely on screen, and below the status bar. */
function highestBottom() {
  const vv = window.visualViewport;
  return window.innerHeight - (vv ? vv.offsetTop : 0) - safeAreaTop() - floatingKeyboard.offsetHeight;
}

/** Where the panel wants to be, before the limits: where it was last left, or
 *  -- before it has been moved or pushed anywhere -- just above the buttons. */
function storedBottom() {
  return S.floatingKeyboardPos ? S.floatingKeyboardPos.bottom : modelineBarEl.offsetHeight + buttonClearance();
}

/** Where the panel actually sits: where it wants to be, pushed up if the mode
 *  line or the device keyboard has come up under it, and kept on screen. */
function effectiveBottom() {
  const low = lowestBottom();
  return clamp(Math.max(storedBottom(), low), low, highestBottom());
}

/** How long the keyboard and viewport must stay quiet before a push is kept. */
const SETTLE_MS = 200;

/** Keeps where the panel was pushed to. When the device keyboard comes up and
 *  covers the panel it is pushed up above it; this makes that the panel's place,
 *  so when the keyboard goes away again the panel STAYS -- it never drops back
 *  down on its own (only dragging lowers it). Waits for the viewport to settle so
 *  a value seen mid-way through the keyboard's animation is not kept. */
function holdPosition() {
  S.floatingKeyboardSettleTimer = null;
  if (!S.floatingKeyboardOpen) return;
  const now = effectiveBottom();
  if (now > storedBottom() + 0.5) {
    S.floatingKeyboardPos = { left: S.floatingKeyboardPos ? S.floatingKeyboardPos.left : null, bottom: now };
  }
}

/** Puts the panel where it belongs: above the mode line and the floating
 *  buttons, inside the visible area, and -- unless it has been pushed up by the
 *  device keyboard or dragged elsewhere -- in its default corner. Called after
 *  every render and from syncContentOffset, i.e. whenever the keyboard or
 *  viewport changes. */
export function positionFloatingKeyboard() {
  if (!S.floatingKeyboardOpen) return;
  floatingKeyboard.style.top = 'auto';
  floatingKeyboard.style.bottom = effectiveBottom() + 'px';
  const left = S.floatingKeyboardPos ? S.floatingKeyboardPos.left : null;
  if (left != null) {
    floatingKeyboard.style.left = clamp(left, 0, window.innerWidth - floatingKeyboard.offsetWidth) + 'px';
    floatingKeyboard.style.right = 'auto';
  } else {
    floatingKeyboard.style.left = 'auto';
    floatingKeyboard.style.right = SCREEN_MARGIN + 'px';
  }
  syncKeyboardToggle();
  clearTimeout(S.floatingKeyboardSettleTimer);
  S.floatingKeyboardSettleTimer = setTimeout(holdPosition, SETTLE_MS);
}

/** Closes the floating keyboard's own state and dismisses the device keyboard
 *  -- the one place that happens, whether the person tapped [g] again, god-mode
 *  ended some other way, or the device keyboard was dismissed. */
export function closeFloatingKeyboard() {
  clearTimeout(S.floatingKeyboardSettleTimer);
  S.floatingKeyboardSettleTimer = null;
  S.floatingKeyboardOpen = false;
  S.floatingKeyboardShiftArmed = false;
  S.floatingKeyboardMinimized = false;
  resetGodModeKeyboardInput();
  if (document.activeElement === godModeKeyboardInput) godModeKeyboardInput.blur();
}

function styleButton(btn, { armed = false } = {}) {
  btn.type = 'button';
  btn.tabIndex = -1;
  btn.style.minWidth = KEY_MIN_WIDTH + 'px';
  btn.style.minHeight = FLOATING_BUTTON_SIZE + 'px';
  btn.style.fontSize = '16px';
  btn.style.margin = '0';
  btn.style.padding = '0 2px';
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
    const bottom0 = effectiveBottom();
    let dragging = false;
    handle.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!dragging && Math.hypot(dx, dy) <= TAP_SLOP_PX) return;
      dragging = true;
      // stored within the limits, so dragging back the other way responds at once
      S.floatingKeyboardPos = {
        left: clamp(left0 + dx, 0, window.innerWidth - floatingKeyboard.offsetWidth),
        bottom: clamp(bottom0 - dy, lowestBottom(), highestBottom()),
      };
      positionFloatingKeyboard();
    };
    const finish = (isTap) => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', cancel);
      // Only a drag the person made is remembered. The panel being pushed up by the device keyboard is not:
      // that is a one-off adjustment, and saving it would make a temporary push the panel's place for good.
      if (dragging && S.floatingKeyboardPos) setFloatingKeyboardPos(kv, S.floatingKeyboardPos).catch(() => {});
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

/** Whether the device keyboard is really up: the hidden input has focus AND the
 *  app has lifted its mode line to clear a keyboard. Focus alone would not do:
 *  Android's back gesture can hide the keyboard and leave the field focused. On a
 *  desktop there is no on-screen keyboard, so this is never true there. */
function deviceKeyboardShowing() {
  return document.activeElement === godModeKeyboardInput && keyboardLift() > KEYBOARD_INSET_PX;
}

/** How far the device keyboard has pushed the page up, however the platform shows it: the app lifts its mode line when
 *  the visual viewport shrinks (a browser), and when the window itself shrinks (an Android WebView) it is how far it
 *  is now below the tallest it has been at this width (see syncContentOffset). */
function keyboardLift() {
  const lifted = parseFloat(modelineBarEl.style.bottom) || 0;
  const base = S.viewportBaseline;
  const shrunk = base && base.width === window.innerWidth ? base.height - window.innerHeight : 0;
  return Math.max(lifted, shrunk);
}

/** Lights the panel's keyboard key while the device keyboard is showing. Cheap,
 *  and safe to call when the panel is not there. */
export function syncKeyboardToggle() {
  const btn = floatingKeyboard.querySelector('[data-fk-keyboard]');
  if (!btn) return;
  const showing = deviceKeyboardShowing();
  btn.setAttribute('aria-pressed', showing ? 'true' : 'false');
  styleButton(btn, { armed: showing });
}

/** Whether the [g] button is enabled (the org-xx-god-mode-button quick
 *  setting): the open document's own merged variables when there is one, the
 *  global ones otherwise, so it is right on the empty start screen too. */
function godModeButtonEnabled() {
  return getGodModeButton(S.state.localVariables || S.globalVariables);
}

/** Builds/shows/hides the panel and keeps the [g] button's look in step with
 *  it; called from render(). */
export function renderFloatingKeyboard() {
  const enabled = godModeButtonEnabled();
  godModeBtn.style.display = enabled ? 'flex' : 'none';
  // turned off while the panel is up (its only way to close is that button):
  // end god-mode, and the line below takes the panel down with it
  if (!enabled && S.floatingKeyboardOpen) S.godModeActive = false;
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
  // a thick border in the theme's accent colour (with a faint glow of it), so the
  // panel is easy to pick out from whatever it is floating over
  floatingKeyboard.style.border = '3px solid var(--accent)';
  floatingKeyboard.style.borderRadius = '10px';
  floatingKeyboard.style.boxShadow = '0 0 8px 1px var(--accent), 0 4px 14px rgba(0,0,0,0.35)';
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
    // hides / shows the device keyboard without touching god-mode
    const keyboardBtn = document.createElement('button');
    keyboardBtn.textContent = '\u2328';
    keyboardBtn.setAttribute('aria-label', 'Device keyboard: tap to hide or show');
    keyboardBtn.setAttribute('data-fk-keyboard', '');
    styleButton(keyboardBtn);
    // pointerdown only keeps focus where it is until the click decides; the
    // focus call itself is in the click, which is what iOS counts as the tap
    // that may bring the keyboard up
    keyboardBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    keyboardBtn.addEventListener('click', () => {
      const wasShowing = deviceKeyboardShowing();
      godModeKeyboardInput.blur();
      if (!wasShowing) godModeKeyboardInput.focus({ preventScroll: true }); // blur first so an already-focused field brings the keyboard back
      syncKeyboardToggle();
    });
    floatingKeyboard.appendChild(keyboardBtn);

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
    const { rawKey, shiftKey } = withArmedShift(ch === '\n' ? 'Enter' : ch, ch.length === 1 && ch !== ch.toLowerCase());
    dispatchGodModeKeystroke(rawKey, shiftKey);
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
