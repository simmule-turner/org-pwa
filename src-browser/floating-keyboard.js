// The floating keyboard: a small, draggable panel of the keys a phone's own
// on-screen keyboard has no way to type (Tab, the arrows, Shift) plus `g`,
// god-mode's most-used prefix, for using god-mode with no hardware Escape
// key. Shown only while god-mode was entered through the [g] toolbar button
// (S.floatingKeyboardOpen) -- see that button's handler in app.js.
//
// Every button feeds god-mode through dispatchGodModeKeystroke, the very
// same function a real keydown uses, so the two can't drift apart. Crucially
// the buttons never depend on the device's own keyboard delivering keydown
// events: on mobile browsers those are unreliable for isolated keystrokes
// (see the README), whereas a plain button tap always works.
import { S } from './app-state.js';
import { floatingKeyboard, godModeKeyboardInput } from './dom.js';
import { dispatchGodModeKeystroke } from './god-mode-palette.js';

/** The six buttons that dispatch a key, in display order. `rawKey` is what a
 *  real KeyboardEvent.key would be. Shift is applied per src/god-mode.js's
 *  own rules: named keys (Tab, the arrows) get the shiftKey flag; a printable
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

const DEFAULT_MARGIN = { right: 12, bottom: 96 };

/** What a tap on `key` sends to god-mode, given whether Shift is armed. */
export function keystrokeFor(key, shiftArmed) {
  return { rawKey: shiftArmed && key.shiftedRawKey ? key.shiftedRawKey : key.rawKey, shiftKey: shiftArmed };
}

/** Closes the floating keyboard's own state and dismisses the device keyboard
 *  -- the one place that happens, whether the person tapped [g] again, god-mode
 *  ended some other way, or the device keyboard was dismissed. */
export function closeFloatingKeyboard() {
  S.floatingKeyboardOpen = false;
  S.floatingKeyboardShiftArmed = false;
  if (document.activeElement === godModeKeyboardInput) godModeKeyboardInput.blur();
}

function styleButton(btn, { armed = false } = {}) {
  btn.type = 'button';
  btn.tabIndex = -1;
  btn.style.minWidth = '44px';
  btn.style.minHeight = '44px';
  btn.style.fontSize = '16px';
  btn.style.margin = '0';
  btn.style.padding = '0 6px';
  btn.style.border = '1px solid var(--border-strong)';
  btn.style.borderRadius = '8px';
  btn.style.background = armed ? 'var(--accent)' : 'var(--surface)';
  btn.style.color = armed ? '#fff' : 'var(--fg)';
  btn.style.touchAction = 'manipulation';
  btn.style.userSelect = 'none';
  btn.style.webkitUserSelect = 'none';
}

/** Makes `panel` draggable by `handle`, keeping it inside the viewport. */
function makeDraggable(panel, handle) {
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = panel.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;
    handle.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth);
      const maxTop = Math.max(0, window.innerHeight - panel.offsetHeight);
      const left = Math.min(Math.max(0, ev.clientX - offsetX), maxLeft);
      const top = Math.min(Math.max(0, ev.clientY - offsetY), maxTop);
      panel.style.left = left + 'px';
      panel.style.top = top + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      S.floatingKeyboardPos = { left, top };
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  });
}

/** Keeps the panel on screen and in sync with god-mode; called from render(). */
export function renderFloatingKeyboard() {
  // god-mode ended by some other route (a real Escape, a chord that opened
  // another panel, ...): follow it, so the two can never disagree.
  if (S.floatingKeyboardOpen && !S.godModeActive) closeFloatingKeyboard();

  if (!S.floatingKeyboardOpen) {
    floatingKeyboard.style.display = 'none';
    floatingKeyboard.innerHTML = '';
    return;
  }

  floatingKeyboard.innerHTML = '';
  floatingKeyboard.style.display = 'flex';
  floatingKeyboard.style.position = 'fixed';
  floatingKeyboard.style.zIndex = '900';
  floatingKeyboard.style.alignItems = 'center';
  floatingKeyboard.style.gap = '4px';
  floatingKeyboard.style.padding = '4px';
  floatingKeyboard.style.background = 'var(--modal-bg)';
  floatingKeyboard.style.border = '1px solid var(--border-strong)';
  floatingKeyboard.style.borderRadius = '10px';
  floatingKeyboard.style.boxShadow = '0 4px 14px rgba(0,0,0,0.35)';
  floatingKeyboard.setAttribute('role', 'toolbar');
  floatingKeyboard.setAttribute('aria-label', 'God-mode keys');
  if (S.floatingKeyboardPos) {
    floatingKeyboard.style.left = S.floatingKeyboardPos.left + 'px';
    floatingKeyboard.style.top = S.floatingKeyboardPos.top + 'px';
    floatingKeyboard.style.right = 'auto';
    floatingKeyboard.style.bottom = 'auto';
  } else {
    floatingKeyboard.style.left = 'auto';
    floatingKeyboard.style.top = 'auto';
    floatingKeyboard.style.right = DEFAULT_MARGIN.right + 'px';
    floatingKeyboard.style.bottom = DEFAULT_MARGIN.bottom + 'px';
  }

  const handle = document.createElement('div');
  handle.setAttribute('data-fk-handle', '');
  handle.setAttribute('aria-label', 'Drag to move');
  handle.textContent = '\u283f';
  handle.style.cursor = 'grab';
  handle.style.touchAction = 'none'; // so a drag moves the panel rather than scrolling the page
  handle.style.padding = '0 6px';
  handle.style.fontSize = '20px';
  handle.style.opacity = '0.6';
  handle.style.userSelect = 'none';
  handle.style.webkitUserSelect = 'none';
  floatingKeyboard.appendChild(handle);
  makeDraggable(floatingKeyboard, handle);

  const armed = S.floatingKeyboardShiftArmed;

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
