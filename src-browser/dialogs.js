// Extracted from app.js: dialogs.
import { getHeadingText, setHeadingText } from '../src/body-edit.js';
import { formatOrgTimestamp } from '../src/org-timestamp.js';
import { S } from './app-state.js';
import { scrollContainer } from './chrome.js';
import { commitAndRender, setStatus } from './editing.js';
import { render } from './render.js';
import { fieldRow, keepOverlayInVisibleViewport, menuButton, modalFieldRow, modalOverlayCleanups, tableActionButton, textInputStyle } from './ui-widgets.js';

/** Same explicit sizing as wizardButton (needed outside a .panel-
 *  classed container, where the app's normal button styling doesn't
 *  reach) but WITHOUT flex:1 -- for a button meant to sit alongside a
 *  sibling in the same row, sized to its own content, rather than
 *  stretching alone to fill the whole row the way a lone wizardButton
 *  is meant to. */
export function confirmDialog(message, { confirmLabel = 'Delete', cancelLabel = 'Cancel', danger = true } = {}) {
  return new Promise((resolve) => {
    S.confirmDialogOpen = true;
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.background = 'rgba(0,0,0,0.6)';
    overlay.style.zIndex = '10000';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.padding = '16px';
    overlay.style.boxSizing = 'border-box';

    const modal = document.createElement('div');
    modal.className = 'panel';
    modal.style.background = 'var(--modal-bg)';
    modal.style.color = 'var(--fg)';
    modal.style.border = '1px solid var(--border-strong)';
    modal.style.borderRadius = '10px';
    modal.style.padding = '16px';
    modal.style.width = '100%';
    modal.style.maxWidth = '420px';
    modal.style.boxSizing = 'border-box';
    modal.style.display = 'flex';
    modal.style.flexDirection = 'column';
    modal.style.gap = '14px';

    const messageEl = document.createElement('div');
    messageEl.textContent = message;
    messageEl.style.fontSize = '15px';
    messageEl.style.lineHeight = '1.4';
    modal.appendChild(messageEl);

    const buttonRow = document.createElement('div');
    buttonRow.className = 'panel-row';
    buttonRow.style.justifyContent = 'flex-end';
    buttonRow.style.gap = '8px';

    let stopTrackingViewport = () => {};
    function finish(result) {
      S.confirmDialogOpen = false;
      document.removeEventListener('keydown', onKeyDown, true);
      stopTrackingViewport();
      overlay.remove();
      resolve(result);
    }

    const cancelBtn = tableActionButton(cancelLabel, () => finish(false));
    const confirmBtn = tableActionButton(confirmLabel, () => finish(true));
    // Cancel is the one that should visually read as "the recommended
    // choice" on sight -- filled, high-contrast -- since on a touch
    // device there's no visible keyboard-focus indicator to lean on at
    // all, unlike desktop. The destructive button stays plain and
    // unfilled: clearly marked as dangerous via color, but never
    // visually competing with Cancel for "the one to tap."
    cancelBtn.style.background = 'var(--accent)';
    cancelBtn.style.color = '#fff';
    cancelBtn.style.borderColor = 'var(--accent)';
    cancelBtn.style.fontWeight = '600';
    if (danger) {
      confirmBtn.style.background = 'transparent';
      confirmBtn.style.color = 'var(--danger, #d33)';
      confirmBtn.style.borderColor = 'var(--danger, #d33)';
    }

    buttonRow.appendChild(cancelBtn);
    buttonRow.appendChild(confirmBtn);
    modal.appendChild(buttonRow);
    overlay.appendChild(modal);

    // Tapping the dark backdrop itself (not the modal or either button)
    // is the same as Cancel -- the safe, non-destructive outcome for any
    // tap that wasn't clearly, deliberately aimed at a specific button.
    overlay.onclick = (e) => {
      if (e.target === overlay) finish(false);
    };

    function onKeyDown(e) {
      // Capture phase, ahead of the global god-mode handler's own guard
      // (which also checks confirmDialogOpen and steps aside) -- belt
      // and suspenders against any other listener racing this dialog.
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish(false);
      }
      // Enter is deliberately NOT intercepted here: cancelBtn already
      // has native focus below, so a native Enter-on-focused-button
      // activates Cancel on its own, the same way it would for any
      // other focused button in the app -- no special-casing needed.
    }
    document.addEventListener('keydown', onKeyDown, true);

    document.body.appendChild(overlay);
    stopTrackingViewport = keepOverlayInVisibleViewport(overlay); // starts below the status bar, and follows the keyboard
    cancelBtn.focus();
  });
}

/** A focused, Promise-based date/time-picker popup for the %^t/%^T/%^u/
 *  %^U capture-template prompts (see capture-template.js's own
 *  scanPrompts) -- reuses confirmDialog's own overlay+modal shape and
 *  buildTimestampFieldGroup's own native <input type="date">/
 *  <input type="time"> pattern (including its iOS-specific appearance
 *  fix), but deliberately simpler: no repeater, no delay-warning --
 *  neither makes sense for inserting one timestamp's own text into a
 *  field, unlike planning a recurring/advance-warned SCHEDULED/
 *  DEADLINE. `kind` is { active, hasTime }, exactly scanPrompts' own
 *  prompt.timestamp shape.
 *
 *  Resolves the formatted timestamp string on OK, or null on Cancel/
 *  Escape/tapping the backdrop -- the caller leaves the field's own
 *  text completely untouched on null, so whatever the person had
 *  already typed or erased there survives exactly as it was. Unlike
 *  confirmDialog's own convention (Cancel filled/prominent, the safe
 *  choice for a destructive confirmation), OK is the prominent action
 *  here -- neither choice is dangerous, and picking a date is the
 *  whole point of opening this -- and OK starts disabled, only
 *  enabling once a real date is actually entered, so it can never
 *  fire on an empty/invalid pick. */
export function openTimestampPickerPopup(kind) {
  return new Promise((resolve) => {
    S.timestampPickerOpen = true;
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.background = 'rgba(0,0,0,0.6)';
    overlay.style.zIndex = '10000';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.padding = '16px';
    overlay.style.boxSizing = 'border-box';

    const modal = document.createElement('div');
    modal.className = 'panel';
    modal.style.background = 'var(--modal-bg)';
    modal.style.color = 'var(--fg)';
    modal.style.border = '1px solid var(--border-strong)';
    modal.style.borderRadius = '10px';
    modal.style.padding = '16px';
    modal.style.width = '100%';
    modal.style.maxWidth = '420px';
    modal.style.boxSizing = 'border-box';
    modal.style.display = 'flex';
    modal.style.flexDirection = 'column';
    modal.style.gap = '14px';

    const titleEl = document.createElement('div');
    titleEl.textContent = (kind.active ? 'Active' : 'Inactive') + (kind.hasTime ? ' date & time' : ' date');
    titleEl.style.fontSize = '15px';
    titleEl.style.fontWeight = '600';
    modal.appendChild(titleEl);

    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    textInputStyle(dateInput);
    dateInput.style.webkitAppearance = 'none'; // same iOS fix buildTimestampFieldGroup's own date input already needed
    dateInput.style.appearance = 'none';
    modal.appendChild(fieldRow('Date', dateInput));

    let timeInput = null;
    if (kind.hasTime) {
      timeInput = document.createElement('input');
      timeInput.type = 'time';
      textInputStyle(timeInput);
      timeInput.style.webkitAppearance = 'none';
      timeInput.style.appearance = 'none';
      modal.appendChild(fieldRow('Time (optional)', timeInput));
    }

    const buttonRow = document.createElement('div');
    buttonRow.className = 'panel-row';
    buttonRow.style.justifyContent = 'flex-end';
    buttonRow.style.gap = '8px';

    let stopTrackingViewport = () => {};
    function finish(result) {
      S.timestampPickerOpen = false;
      document.removeEventListener('keydown', onKeyDown, true);
      stopTrackingViewport();
      overlay.remove();
      resolve(result);
    }

    const cancelBtn = tableActionButton('Cancel', () => finish(null));
    const okBtn = tableActionButton('OK', () => {
      if (!dateInput.value) return; // shouldn't be reachable while disabled, but never substitute an empty/invalid pick regardless
      const [y, m, d] = dateInput.value.split('-').map(Number);
      const date = new Date(y, m - 1, d);
      const time = kind.hasTime && timeInput.value ? timeInput.value : null;
      finish(formatOrgTimestamp({ date, time, active: kind.active }));
    });
    okBtn.disabled = true;
    okBtn.style.background = 'var(--accent)';
    okBtn.style.color = '#fff';
    okBtn.style.borderColor = 'var(--accent)';
    okBtn.style.fontWeight = '600';
    dateInput.addEventListener('input', () => {
      okBtn.disabled = !dateInput.value;
    });

    buttonRow.appendChild(cancelBtn);
    buttonRow.appendChild(okBtn);
    modal.appendChild(buttonRow);
    overlay.appendChild(modal);

    overlay.onclick = (e) => {
      if (e.target === overlay) finish(null);
    };

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish(null);
      }
    }
    document.addEventListener('keydown', onKeyDown, true);

    document.body.appendChild(overlay);
    stopTrackingViewport = keepOverlayInVisibleViewport(overlay); // starts below the status bar, and follows the keyboard
    dateInput.focus();
  });
}

/** Opens a large, near-full-width popup with a big (15+ row),
 *  wrapping, vertically-scrolling textarea for comfortably viewing
 *  and editing one field's own full content -- the inline text boxes
 *  in Settings are kept deliberately small (Refile targets / Agenda
 *  files' own established size), so this is where the actual editing
 *  happens for anything longer than a couple of words. Cancel
 *  discards any change and closes without calling `onSave` at all;
 *  OK calls `onSave(newValue)` then closes; Reset (shown only when
 *  `onReset` is given AND `value` actually differs from
 *  `defaultValue` -- there's nothing to reset back to otherwise) does
 *  whatever the field's own inline reset control already does, then
 *  closes without calling `onSave`. */
/** Locks the background page from scrolling while a modal overlay is
 *  open, and returns a function that restores it exactly as it was.
 *
 *  BUG FIX: a fully-covering, high-z-index overlay does NOT, by
 *  itself, stop a touch-drag gesture from scrolling whatever's behind
 *  it -- painting order and scroll-chaining are separate concerns on
 *  mobile, and this app's own popups (openTextFieldPopup,
 *  openMultiFieldPopup) never locked the underlying scroll container
 *  at all, letting a drag that started on the dimmed backdrop scroll
 *  the Settings panel behind it. Two layers, matching the standard,
 *  well-established fix for this exact class of bug: (1) `overflow:
 *  hidden` on both `document.body` and whichever element this app's
 *  own scrollContainer() currently considers the real scrolling pane
 *  (it differs by layout width -- see that function's own docs), and
 *  (2) a `touchmove` listener on the overlay's own backdrop
 *  specifically (never on the popup's own textarea/fields, which
 *  still need to scroll normally) that calls preventDefault() for any
 *  touch that didn't start on an element the popup itself owns. */
export function lockBackgroundScroll(overlay) {
  const scrollEl = scrollContainer();
  const previousBodyOverflow = document.body.style.overflow;
  const previousScrollElOverflow = scrollEl.style.overflow;
  document.body.style.overflow = 'hidden';
  scrollEl.style.overflow = 'hidden';

  const preventBackdropTouchMove = (e) => {
    if (e.target === overlay) e.preventDefault();
  };
  overlay.addEventListener('touchmove', preventBackdropTouchMove, { passive: false });

  return () => {
    document.body.style.overflow = previousBodyOverflow;
    scrollEl.style.overflow = previousScrollElOverflow;
    overlay.removeEventListener('touchmove', preventBackdropTouchMove);
  };
}

export function showModalOverlay(overlayEl) {
  overlayEl.style.display = 'flex';
  if (!modalOverlayCleanups.has(overlayEl)) {
    const stopTrackingViewport = keepOverlayInVisibleViewport(overlayEl);
    const unlockScroll = lockBackgroundScroll(overlayEl);
    modalOverlayCleanups.set(overlayEl, () => {
      stopTrackingViewport();
      unlockScroll();
    });
  }
}

/** The heading action menu's own "Edit text" entry point -- editingHeadingText
 *  is set by the caller (before render(), so that same pass hides this
 *  heading's own body-content rows underneath) and cleared here on both
 *  Cancel and OK. Uses a fixed, unique overlay id so a render() pass
 *  while the popup is already open (from some unrelated trigger) can't
 *  accidentally open a second, duplicate one. */
export function openHeadingTextEditor(heading) {
  const originalText = getHeadingText(heading);
  const overlay = openTextFieldPopup({
    label: 'Edit heading text',
    value: originalText,
    placeholder: 'All content for this heading — lists, notes, etc. — as org text',
    resetInPlace: true,
    onCancel: () => {
      S.editingHeadingText = null;
      render();
    },
    onSave: (newText) => {
      S.editingHeadingText = null;
      setHeadingText(heading, newText);
      commitAndRender('Edited heading body text');
    },
  });
  overlay.id = 'heading-text-edit-popup';
}

export function openTextFieldPopup({ label, value, defaultValue, onSave, onReset, onCancel, resetInPlace, placeholder, choices }) {
  const overlay = document.createElement('div');
  overlay.style.position = 'fixed';
  overlay.style.inset = '0'; // fallback for a browser without visualViewport; keepOverlayInVisibleViewport overrides top/left/width/height directly when it's available
  overlay.style.background = 'rgba(0,0,0,0.6)';
  overlay.style.zIndex = '10000';
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.padding = '16px';
  overlay.style.boxSizing = 'border-box';
  overlay.style.overflow = 'hidden'; // the modal itself scrolls (see textarea below); the backdrop never should

  const modal = document.createElement('div');
  modal.className = 'panel'; // normal, touch-friendly button/input sizing (44px targets), matching the rest of this app
  modal.style.background = 'var(--modal-bg)'; // opaque -- var(--surface) is a barely-visible tint meant for layering over --bg, not a standalone solid background
  modal.style.color = 'var(--fg)';
  modal.style.border = '1px solid var(--border-strong)';
  modal.style.borderRadius = '10px';
  modal.style.padding = '16px';
  modal.style.width = '100%';
  modal.style.maxWidth = '760px';
  modal.style.maxHeight = '100%';
  modal.style.display = 'flex';
  modal.style.flexDirection = 'column';
  modal.style.gap = '10px';
  modal.style.boxSizing = 'border-box';
  overlay.appendChild(modal);

  const titleEl = document.createElement('div');
  titleEl.textContent = label;
  titleEl.style.fontWeight = '700';
  titleEl.style.fontSize = '15px';
  titleEl.style.flexShrink = '0';
  modal.appendChild(titleEl);

  // Optional quick-picks (Effort_ALL's allowed values, for the effort
  // prompt): one tap saves that value, like choosing from a completion list.
  if (choices && choices.length > 0) {
    const chipRow = document.createElement('div');
    chipRow.setAttribute('data-quick-picks', '');
    chipRow.style.display = 'flex';
    chipRow.style.flexWrap = 'wrap';
    chipRow.style.gap = '6px';
    chipRow.style.flexShrink = '0';
    for (const choice of choices) {
      const chip = menuButton(choice, async () => {
        await onSave(choice);
        close();
      });
      chip.setAttribute('data-quick-pick', choice);
      chipRow.appendChild(chip);
    }
    modal.appendChild(chipRow);
  }

  const textarea = document.createElement('textarea');
  textarea.value = value !== undefined && value !== null ? value : '';
  if (placeholder) textarea.placeholder = placeholder;
  textarea.rows = 20;
  textarea.style.width = '100%';
  textarea.style.boxSizing = 'border-box';
  textarea.style.fontFamily = 'monospace';
  textarea.style.fontSize = '14px';
  textarea.style.whiteSpace = 'pre-wrap';
  textarea.style.overflowWrap = 'break-word';
  textarea.style.overflowY = 'auto';
  textarea.style.overscrollBehavior = 'contain';
  textarea.style.resize = 'vertical';
  textarea.style.flex = '1 1 auto';
  textarea.style.minHeight = '0';
  modal.appendChild(textarea);

  const btnRow = document.createElement('div');
  btnRow.style.display = 'flex';
  btnRow.style.justifyContent = 'flex-end';
  btnRow.style.gap = '8px';
  btnRow.style.flexShrink = '0';
  modal.appendChild(btnRow);

  const stopTrackingViewport = keepOverlayInVisibleViewport(overlay);
  const unlockScroll = lockBackgroundScroll(overlay);
  S.textFieldPopupOpen = true;

  function close() {
    S.textFieldPopupOpen = false;
    document.removeEventListener('keydown', onKeyDown, true);
    stopTrackingViewport();
    unlockScroll();
    document.body.removeChild(overlay);
  }

  function onKeyDown(e) {
    // Capture phase, ahead of the global god-mode handler's own guard
    // (which also checks textFieldPopupOpen and steps aside) -- same
    // belt-and-suspenders reasoning as confirmDialog's own onKeyDown.
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (onCancel) onCancel();
      close();
    }
  }
  document.addEventListener('keydown', onKeyDown, true);

  btnRow.appendChild(
    menuButton('Cancel', () => {
      if (onCancel) onCancel();
      close();
    })
  );

  if (resetInPlace) {
    btnRow.appendChild(
      menuButton('Reset', () => {
        textarea.value = value !== undefined && value !== null ? value : '';
        textarea.focus();
      })
    );
  } else if (onReset && value !== defaultValue) {
    btnRow.appendChild(
      menuButton('Reset', async () => {
        await onReset();
        close();
      })
    );
  }

  btnRow.appendChild(
    menuButton('OK', async () => {
      await onSave(textarea.value);
      close();
    })
  );

  document.body.appendChild(overlay);
  textarea.focus();
  return overlay;
}

/** Opens a popup form with several related fields together (each a
 *  modalFieldRow), Cancel/Save at a fixed location -- used
 *  by the GitHub/WebDAV sync settings below, where all of a single
 *  repository's own fields are edited and saved as one unit rather
 *  than each having its own separate save action. `fields` is an
 *  array of `{ key, label, type: 'text'|'password', value,
 *  placeholder }`; `onSave` receives `{ [key]: currentInputValue }`
 *  for every field, already trimmed for 'text' fields (a password
 *  field's own leading/trailing whitespace is preserved, since it
 *  might genuinely be part of the password). */
export function openButtonChoiceModal({ label, buttons }) {
  const overlay = document.createElement('div');
  overlay.style.position = 'fixed';
  overlay.style.inset = '0';
  overlay.style.background = 'rgba(0,0,0,0.6)';
  overlay.style.zIndex = '10000';
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.padding = '16px';
  overlay.style.boxSizing = 'border-box';
  overlay.style.overflow = 'hidden';

  const modal = document.createElement('div');
  modal.className = 'panel';
  modal.style.background = 'var(--modal-bg)';
  modal.style.color = 'var(--fg)';
  modal.style.border = '1px solid var(--border-strong)';
  modal.style.borderRadius = '10px';
  modal.style.padding = '18px';
  modal.style.width = '100%';
  modal.style.maxWidth = '420px';
  modal.style.maxHeight = '100%';
  modal.style.overflowY = 'auto';
  modal.style.overscrollBehavior = 'contain';
  modal.style.boxSizing = 'border-box';
  overlay.appendChild(modal);

  const labelEl = document.createElement('div');
  labelEl.style.fontSize = '13px';
  labelEl.style.marginBottom = '10px';
  labelEl.textContent = label;
  modal.appendChild(labelEl);

  const row = document.createElement('div');
  row.className = 'panel-row';
  modal.appendChild(row);

  const stopTrackingViewport = keepOverlayInVisibleViewport(overlay);
  const unlockScroll = lockBackgroundScroll(overlay);
  S.buttonChoiceModalOpen = true;

  function close() {
    S.buttonChoiceModalOpen = false;
    document.removeEventListener('keydown', onKeyDown, true);
    stopTrackingViewport();
    unlockScroll();
    document.body.removeChild(overlay);
  }

  function onKeyDown(e) {
    // Capture phase, ahead of the global god-mode handler's own guard
    // (which also checks buttonChoiceModalOpen and steps aside) -- same
    // belt-and-suspenders reasoning as confirmDialog's own onKeyDown.
    // This primitive has no built-in "Cancel" semantics of its own (its
    // buttons are entirely caller-defined -- see openAttachChoicePrompt's
    // own explicit Cancel button, a no-op onClick), so Escape here only
    // ever dismisses the overlay -- it never invokes any button's onClick.
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }
  document.addEventListener('keydown', onKeyDown, true);

  for (const { text, onClick, disabled } of buttons) {
    row.appendChild(
      menuButton(
        text,
        async () => {
          close();
          await onClick();
        },
        disabled
      )
    );
  }

  document.body.appendChild(overlay);
  return overlay;
}

/** A modal of buttons in a two-column grid, styled like the Capture template picker: a small dim heading, left-aligned buttons at
 *  least 44px tall, and a Close row. `buttons` is [{ key, text, onClick, disabled }]. A button with a `key` runs when that key is
 *  pressed (case matters: `o` and `O` are different buttons), and always shows the key as a badge. `showKeys` is for a phone keyboard: it focuses a hidden field so typed letters arrive. */
export function openGridChoiceModal({ label, buttons, showKeys = false }) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;overflow:hidden;';
  const modal = document.createElement('div');
  modal.className = 'panel';
  modal.style.cssText = 'background:var(--modal-bg);color:var(--fg);border:1px solid var(--border-strong);border-radius:10px;padding:18px;width:100%;max-width:460px;max-height:100%;overflow-y:auto;overscroll-behavior:contain;box-sizing:border-box;';
  overlay.appendChild(modal);

  const heading = document.createElement('div');
  heading.style.cssText = 'font-size:12px;opacity:0.65;margin-bottom:8px;overflow-wrap:anywhere;';
  heading.textContent = label;
  modal.appendChild(heading);

  const stopTrackingViewport = keepOverlayInVisibleViewport(overlay);
  const unlockScroll = lockBackgroundScroll(overlay);
  S.buttonChoiceModalOpen = true;

  function close() {
    S.buttonChoiceModalOpen = false;
    document.removeEventListener('keydown', onKeyDown, true);
    stopTrackingViewport();
    unlockScroll();
    if (overlay.parentNode) document.body.removeChild(overlay);
  }
  const choose = async (button) => {
    close();
    await button.onClick();
  };
  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const button = buttons.find((b) => b.key === e.key && !b.disabled);
    if (!button) return;
    e.preventDefault();
    e.stopPropagation();
    choose(button);
  }
  document.addEventListener('keydown', onKeyDown, true);

  // A phone's keyboard does not send keydown with the letter (it reports "Unidentified" and delivers the text as an input event), so
  // when this was opened from the keyboard (showKeys) a hidden field takes the focus and reads the typed text from beforeinput/input.
  let typing = null;
  if (showKeys) {
    typing = document.createElement('input');
    typing.type = 'text';
    typing.setAttribute('aria-label', 'Press a key');
    typing.setAttribute('autocapitalize', 'off');
    typing.setAttribute('autocomplete', 'off');
    typing.setAttribute('autocorrect', 'off');
    typing.spellcheck = false;
    typing.style.cssText = 'position:absolute;left:0;top:0;width:1px;height:1px;opacity:0;border:0;padding:0;';
    const feed = (text) => {
      for (const ch of text) {
        const button = buttons.find((b) => b.key === ch && !b.disabled);
        if (button) {
          choose(button);
          return;
        }
      }
    };
    typing.addEventListener('beforeinput', (e) => {
      if (e.inputType === 'insertText' && e.data) {
        e.preventDefault();
        feed(e.data);
      }
    });
    typing.addEventListener('input', () => {
      const text = typing.value;
      typing.value = '';
      if (text) feed(text);
    });
    modal.appendChild(typing);
  }

  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px;';
  for (const button of buttons) {
    const el = document.createElement('button');
    el.style.cssText = 'text-align:left;padding:10px 12px;border:1px solid var(--border-strong);border-radius:8px;background:var(--bg);color:var(--fg);font-size:14px;min-height:44px;display:flex;align-items:center;gap:8px;';
    if (button.disabled) {
      el.disabled = true;
      el.style.opacity = '0.5';
    }
    if (button.key) {
      const badge = document.createElement('span');
      badge.textContent = button.key;
      badge.style.cssText = 'font-size:11px;font-family:monospace;border:1px solid var(--border-strong);border-radius:4px;padding:1px 5px;opacity:0.7;flex-shrink:0;';
      el.appendChild(badge);
    }
    const text = document.createElement('span');
    text.textContent = button.text;
    el.appendChild(text);
    el.onclick = () => choose(button);
    grid.appendChild(el);
  }
  modal.appendChild(grid);

  const closeRow = document.createElement('div');
  closeRow.className = 'panel-row';
  closeRow.style.marginTop = '6px';
  closeRow.appendChild(menuButton('Close', close));
  modal.appendChild(closeRow);

  document.body.appendChild(overlay);
  if (typing) typing.focus();
  return overlay;
}

export function openMultiFieldPopup({ label, fields, onSave }) {
  const overlay = document.createElement('div');
  overlay.style.position = 'fixed';
  overlay.style.inset = '0'; // fallback for a browser without visualViewport; keepOverlayInVisibleViewport overrides top/left/width/height directly when it's available
  overlay.style.background = 'rgba(0,0,0,0.6)';
  overlay.style.zIndex = '10000';
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.padding = '16px';
  overlay.style.boxSizing = 'border-box';
  overlay.style.overflow = 'hidden';

  const modal = document.createElement('div');
  modal.className = 'panel'; // normal, touch-friendly button sizing (44px targets), matching the rest of this app
  modal.style.background = 'var(--modal-bg)'; // opaque -- var(--surface) is a barely-visible tint meant for layering over --bg, not a standalone solid background
  modal.style.color = 'var(--fg)';
  modal.style.border = '1px solid var(--border-strong)';
  modal.style.borderRadius = '10px';
  modal.style.padding = '18px';
  modal.style.width = '100%';
  modal.style.maxWidth = '420px';
  modal.style.maxHeight = '100%';
  modal.style.overflowY = 'auto';
  modal.style.overscrollBehavior = 'contain';
  modal.style.boxSizing = 'border-box';
  overlay.appendChild(modal);

  const titleEl = document.createElement('div');
  titleEl.textContent = label;
  titleEl.style.fontWeight = '700';
  titleEl.style.fontSize = '15px';
  titleEl.style.marginBottom = '14px';
  modal.appendChild(titleEl);

  const fieldEntries = fields.map((f) => ({ key: f.key, type: f.type, entry: modalFieldRow(f.label, f.type, f.value, f.placeholder) }));
  for (const { entry } of fieldEntries) {
    modal.appendChild(entry.wrap);
  }

  const btnRow = document.createElement('div');
  btnRow.style.display = 'flex';
  btnRow.style.justifyContent = 'flex-end';
  btnRow.style.gap = '8px';
  btnRow.style.marginTop = '4px';
  modal.appendChild(btnRow);

  const stopTrackingViewport = keepOverlayInVisibleViewport(overlay);
  const unlockScroll = lockBackgroundScroll(overlay);

  function close() {
    stopTrackingViewport();
    unlockScroll();
    document.body.removeChild(overlay);
  }

  btnRow.appendChild(
    menuButton('Cancel', () => close())
  );
  btnRow.appendChild(
    menuButton('Reset', () => {
      for (const { key, type, entry } of fieldEntries) {
        const original = fields.find((f) => f.key === key).value;
        entry.input.value = original !== undefined && original !== null ? original : '';
      }
      fieldEntries[0]?.entry.input.focus();
    })
  );
  btnRow.appendChild(
    menuButton('OK', async () => {
      const values = {};
      for (const { key, type, entry } of fieldEntries) {
        values[key] = type === 'password' ? entry.input.value : entry.input.value.trim();
      }
      await onSave(values);
      close();
    })
  );

  document.body.appendChild(overlay);
  if (fieldEntries[0]) fieldEntries[0].entry.input.focus();
  return overlay;
}

/** Opens the native file picker and resolves with the picked file's
 *  own name, MIME type, and raw content as base64 -- the binary
 *  counterpart to pickTextFile just above, for attachments. `capture`
 *  (optional) is passed straight through to the input's own capture
 *  attribute -- 'environment' hints a mobile browser to offer the
 *  rear camera as a picker option alongside the usual photo library/
 *  file browser, the actual motivating case for this feature; most
 *  mobile browsers still offer the other options too even with this
 *  set, so it's additive, never a restriction. */
export function pickBinaryFile(capture, accept) {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (capture) input.setAttribute('capture', capture);
    if (accept) input.accept = accept;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (input.parentNode) input.parentNode.removeChild(input);
      if (!file) {
        reject(new Error('No file selected'));
        return;
      }
      setStatus('Reading file\u2026');
      render();
      const reader = new FileReader();
      reader.onload = () => {
        // reader.result is "data:<mime>;base64,<data>" -- everything after the first comma is the base64 payload itself.
        const dataUrl = reader.result;
        const commaIndex = dataUrl.indexOf(',');
        const base64 = commaIndex === -1 ? '' : dataUrl.slice(commaIndex + 1);
        resolve({ name: file.name, type: file.type, base64 });
      };
      reader.onerror = () => reject(reader.error || new Error('Could not read the picked file'));
      reader.readAsDataURL(file);
    });
    document.body.appendChild(input);
    input.click();
  });
}
