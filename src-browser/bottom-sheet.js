// @ts-check
// A sheet that slides up from the bottom of the screen: a list of actions, or a list of choices with check boxes. Thumb-height
// rows (48px), a Cancel at the bottom, a tap outside or Escape closes it. Nothing in the page moves while it is open.
import { lockBackgroundScroll } from './dialogs.js';

/**
 * @typedef {{ label: string, hint?: string, disabled?: boolean, danger?: boolean, onClick: () => void }} SheetAction
 */

/** Builds the overlay and its panel, wires closing, and returns them with `close`.
 * @param {string} title
 * @param {string | undefined} subtitle
 */
function buildSheet(title, subtitle) {
  const overlay = document.createElement('div');
  overlay.setAttribute('data-bottom-sheet', '');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,0.5);touch-action:none;';
  const panel = document.createElement('div');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', title);
  panel.style.cssText =
    'width:100%;max-width:560px;max-height:82vh;overflow-y:auto;overscroll-behavior:contain;touch-action:pan-y;box-sizing:border-box;background:var(--modal-bg);color:var(--fg);' +
    'border:1px solid var(--border-strong);border-bottom:0;border-radius:16px 16px 0 0;padding:10px 16px calc(14px + env(safe-area-inset-bottom, 0px));';
  const grip = document.createElement('div');
  grip.style.cssText = 'width:40px;height:4px;border-radius:2px;background:var(--border-strong);margin:0 auto 10px;';
  panel.appendChild(grip);
  const heading = document.createElement('div');
  heading.textContent = title;
  heading.style.cssText = 'font-size:16px;font-weight:700;overflow-wrap:anywhere;';
  panel.appendChild(heading);
  if (subtitle) {
    const sub = document.createElement('div');
    sub.textContent = subtitle;
    sub.style.cssText = 'font-size:13px;opacity:0.65;margin:2px 0 6px;overflow-wrap:anywhere;';
    panel.appendChild(sub);
  }
  overlay.appendChild(panel);

  let unlock = () => {};
  const onKeyDown = (/** @type {KeyboardEvent} */ e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  function close() {
    document.removeEventListener('keydown', onKeyDown, true);
    unlock();
    overlay.remove();
  }
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', onKeyDown, true);
  document.body.appendChild(overlay);
  unlock = lockBackgroundScroll(overlay);
  return { overlay, panel, close };
}

/** @param {string} label @param {() => void} onClick */
function cancelButton(label, onClick) {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.style.cssText = 'display:block;width:100%;min-height:48px;margin-top:10px;font-size:16px;';
  btn.onclick = onClick;
  return btn;
}

/**
 * A list of actions. Choosing one closes the sheet first, then runs it.
 * @param {{ title: string, subtitle?: string, actions: SheetAction[] }} opts
 * @returns {() => void} close
 */
export function openActionSheet({ title, subtitle, actions }) {
  const { panel, close } = buildSheet(title, subtitle);
  for (const action of actions) {
    const btn = document.createElement('button');
    btn.style.cssText =
      'display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:1px;width:100%;min-height:48px;padding:6px 4px;border:0;border-radius:0;background:none;text-align:left;font-size:16px;' +
      (action.danger ? 'color:#c0392b;' : '');
    btn.disabled = !!action.disabled;
    const main = document.createElement('span');
    main.textContent = action.label;
    btn.appendChild(main);
    if (action.hint) {
      const hint = document.createElement('span');
      hint.textContent = action.hint;
      hint.style.cssText = 'font-size:12px;opacity:0.65;';
      btn.appendChild(hint);
    }
    btn.onclick = () => {
      close();
      action.onClick();
    };
    panel.appendChild(btn);
  }
  panel.appendChild(cancelButton('Cancel', close));
  return close;
}

/**
 * A list of choices with check boxes. Apply passes the checked values; Clear passes none.
 * @param {{ title: string, choices: [string, number][], selected: string[], onApply: (values: string[]) => void }} opts
 * @returns {() => void} close
 */
export function openChoiceSheet({ title, choices, selected, onApply }) {
  const { panel, close } = buildSheet(title, choices.length === 0 ? 'Nothing here to choose from.' : undefined);
  /** @type {Map<string, HTMLInputElement>} */ const boxes = new Map();
  for (const [value, count] of choices) {
    const row = document.createElement('label');
    row.style.cssText = 'display:flex;align-items:center;gap:12px;min-height:48px;font-size:16px;cursor:pointer;';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = selected.includes(value);
    box.style.cssText = 'width:22px;height:22px;flex-shrink:0;';
    boxes.set(value, box);
    const text = document.createElement('span');
    text.textContent = value;
    text.style.cssText = 'flex:1 1 auto;min-width:0;overflow-wrap:anywhere;';
    const n = document.createElement('span');
    n.textContent = String(count);
    n.style.cssText = 'font-size:13px;opacity:0.6;';
    row.append(box, text, n);
    panel.appendChild(row);
  }
  const buttons = document.createElement('div');
  buttons.style.cssText = 'display:flex;gap:8px;margin-top:10px;';
  const apply = document.createElement('button');
  apply.textContent = 'Apply';
  apply.style.cssText = 'flex:1 1 0;min-height:48px;font-size:16px;font-weight:700;background:var(--accent);color:#fff;border-color:var(--accent);';
  apply.onclick = () => {
    close();
    onApply([...boxes].filter(([, b]) => b.checked).map(([v]) => v));
  };
  const clear = document.createElement('button');
  clear.textContent = 'Clear';
  clear.style.cssText = 'flex:1 1 0;min-height:48px;font-size:16px;';
  clear.onclick = () => {
    close();
    onApply([]);
  };
  buttons.append(clear, apply);
  panel.appendChild(buttons);
  panel.appendChild(cancelButton('Cancel', close));
  return close;
}
