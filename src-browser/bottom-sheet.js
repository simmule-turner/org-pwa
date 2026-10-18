// @ts-check
// A sheet that slides up from the bottom of the screen: a list of actions, or a list of choices with check boxes. Thumb-height
// rows (the shared tap size), a Cancel at the bottom, a tap outside or Escape closes it. Nothing in the page moves while it is open.
import { containTab, rememberOpener, restoreOpener } from './containers.js';
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
  overlay.className = 'ui-overlay';
  overlay.style.touchAction = 'none';
  const panel = document.createElement('div');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', title);
  panel.className = 'ui-container';
  panel.style.cssText = 'overflow-y:auto;overscroll-behavior:contain;touch-action:pan-y;padding:var(--space-2) var(--space-4) calc(var(--space-4) + env(safe-area-inset-bottom, 0px));';
  const grip = document.createElement('div');
  grip.className = 'ui-grip';
  panel.appendChild(grip);
  const heading = document.createElement('div');
  heading.textContent = title;
  heading.style.cssText = 'font-size:var(--text-body);font-weight:700;overflow-wrap:anywhere;';
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
    restoreOpener(overlay);
  }
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', onKeyDown, true);
  rememberOpener(overlay);
  containTab(overlay);
  document.body.appendChild(overlay);
  unlock = lockBackgroundScroll(overlay);
  return { overlay, panel, close };
}

/** @param {string} label @param {() => void} onClick */
function cancelButton(label, onClick) {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.style.cssText = 'display:block;width:100%;min-height:var(--target);margin-top:var(--space-3);font-size:var(--text-body);';
  btn.className = 'ui-cancel';
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
      'display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:1px;width:100%;min-height:var(--target);padding:6px 4px;border:0;border-radius:0;background:none;text-align:left;font-size:var(--text-body);' +
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
  const cancel = cancelButton('Cancel', close);
  panel.appendChild(cancel);
  cancel.focus();
  return close;
}

/**
 * A list of choices with check boxes. Apply passes the checked values; Clear passes none. With `modes`, a row of radio buttons
 * above the list says what the checked values do (show only these, hide these, ...); Apply then also passes the chosen mode.
 * @param {{ title: string, choices: [string, number][], selected: string[], onApply: (values: string[], mode: string, cleared: boolean) => void, modes?: [string, string][], mode?: string }} opts
 * @returns {() => void} close
 */
export function openChoiceSheet({ title, choices, selected, onApply, modes = [], mode = '' }) {
  const { panel, close } = buildSheet(title, choices.length === 0 ? 'Nothing here to choose from.' : undefined);
  let chosenMode = mode || (modes[0] ? modes[0][0] : '');
  if (modes.length > 1) {
    const group = document.createElement('div');
    group.setAttribute('role', 'radiogroup');
    group.style.cssText = 'display:flex;flex-direction:column;margin:4px 0 8px;';
    for (const [value, label] of modes) {
      const row = document.createElement('label');
      row.style.cssText = 'display:flex;align-items:center;gap:12px;min-height:var(--target);font-size:var(--text-body);cursor:pointer;';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'choice-mode';
      radio.value = value;
      radio.checked = value === chosenMode;
      radio.style.cssText = 'width:22px;height:22px;flex-shrink:0;';
      radio.onchange = () => {
        chosenMode = value;
      };
      row.append(radio, document.createTextNode(label));
      group.appendChild(row);
    }
    panel.appendChild(group);
  }
  /** @type {Map<string, HTMLInputElement>} */ const boxes = new Map();
  for (const [value, count] of choices) {
    const row = document.createElement('label');
    row.style.cssText = 'display:flex;align-items:center;gap:12px;min-height:var(--target);font-size:var(--text-body);cursor:pointer;';
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
  apply.style.cssText = 'flex:1 1 0;min-height:var(--target);font-size:var(--text-body);font-weight:700;background:var(--accent);color:#fff;border-color:var(--accent);';
  apply.onclick = () => {
    close();
    onApply([...boxes].filter(([, b]) => b.checked).map(([v]) => v), chosenMode, false);
  };
  const clear = document.createElement('button');
  clear.textContent = 'Clear';
  clear.style.cssText = 'flex:1 1 0;min-height:var(--target);font-size:var(--text-body);';
  clear.onclick = () => {
    close();
    onApply([], chosenMode, true);
  };
  buttons.append(clear, apply);
  panel.appendChild(buttons);
  const cancel = cancelButton('Cancel', close);
  panel.appendChild(cancel);
  cancel.focus();
  return close;
}

/**
 * A sheet with content the caller builds, and a Close button.
 * @param {{ title: string, subtitle?: string, build: (panel: HTMLElement) => void }} opts
 * @returns {() => void} close
 */
export function openContentSheet({ title, subtitle, build }) {
  const { panel, close } = buildSheet(title, subtitle);
  build(panel);
  const done = cancelButton('Close', close);
  panel.appendChild(done);
  done.focus();
  return close;
}

/**
 * A sheet with a form the caller builds, a Cancel (highlighted) and a submit button. `onSubmit` returns false to keep the sheet
 * open (the form shows why); otherwise it closes. Phone: slides up from the bottom; laptop: the same panel, centred.
 * @param {{ title: string, subtitle?: string, build: (panel: HTMLElement) => void, submitLabel: string, onSubmit: () => boolean | void | Promise<boolean | void> }} opts
 * @returns {{ close: () => void, submit: () => void }}
 */
export function openFormSheet({ title, subtitle, build, submitLabel, onSubmit }) {
  const { panel, close } = buildSheet(title, subtitle);
  build(panel);
  const buttons = document.createElement('div');
  buttons.style.cssText = 'display:flex;gap:8px;margin-top:var(--space-3);';
  const cancel = cancelButton('Cancel', close);
  cancel.style.marginTop = '0';
  cancel.style.width = 'auto';
  cancel.style.flex = '1 1 0';
  const submit = document.createElement('button');
  submit.textContent = submitLabel;
  submit.style.cssText = 'flex:1 1 0;min-height:var(--target);font-size:var(--text-body);font-weight:700;background:var(--accent);color:#fff;border-color:var(--accent);';
  let busy = false;
  submit.onclick = async () => {
    if (busy) return;
    busy = true;
    try {
      if ((await onSubmit()) !== false) close();
    } finally {
      busy = false;
    }
  };
  buttons.append(cancel, submit);
  panel.appendChild(buttons);
  return { close, submit: () => submit.click() };
}
