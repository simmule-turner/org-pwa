// Extracted from app.js: ui widgets. These have no dependency on the app's shared mutable state,
// so they moved verbatim (see tools/ notes in CHANGELOG v412).
import { resolveMenuOrder } from '../src/menu-alias.js';

// Matches index.html's own @media (min-width: 900px) breakpoint exactly
// -- kept as a single named constant rather than two separately-typed
// "900px" literals in two different files, so a future change to one
// can't silently drift out of sync with the other.
export const WIDE_LAYOUT_QUERY = '(min-width: 900px)';

export function isWideLayout() {
  return window.matchMedia(WIDE_LAYOUT_QUERY).matches;
}

/**
 * Keeps the content area's top offset in sync with the fixed top bar's
 * actual rendered height. #topBar is `position: fixed` (real app-chrome
 * behavior — it must never scroll away, per explicit direction), which
 * takes it out of document flow entirely; without this, content behind
 * it would just be hidden underneath. The bar's height genuinely varies
 * (a File/View/Search panel opening or closing changes it, search
 * results growing/shrinking changes it), so a static CSS padding value
 * can't track it — this re-measures and re-applies on every call.
 * Cheap enough to call after every render/panel-toggle rather than try
 * to guess exactly when the height could have changed.
 */
// dvh tracks the ACTUAL visible viewport (correctly shrinking when an
// on-screen keyboard appears); vh stays pinned to the full keyboard-less
// screen height on most mobile browsers, which is what caused content to
// overflow past the visible area whenever, e.g., the search input got
// focused. Used wherever a JS-set inline style needs viewport-height
// units (CSS text can use the "declare twice, later one wins if
// understood" fallback trick directly; inline styles set via JS can't,
// so this checks support once instead).
export const VH_UNIT = typeof CSS !== 'undefined' && CSS.supports && CSS.supports('height', '1dvh') ? 'dvh' : 'vh';

// Slide-left gesture: cycles a heading through the three fold levels
// (collapsed -> one level -> fully expanded -> collapsed). Uses Pointer
// Events rather than separate touch/mouse handlers — one code path for
// touch, mouse, and pen, and Chromium (already required for File System
// Access) supports it fully. Never calls preventDefault, so normal
// vertical scrolling of the outline is completely unaffected; the
// direction/distance check is what tells a swipe apart from a scroll,
// not blocking the browser's own gesture handling.
export const SWIPE_THRESHOLD_PX = 40;

export function smallButton(label, ariaLabel, onClick) {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.setAttribute('aria-label', ariaLabel);
  btn.style.fontSize = '11px';
  btn.style.padding = '2px 6px';
  btn.onclick = onClick;
  return btn;
}

/** Attaches a long-press gesture to `el`: holding a touch/pointer down
 *  on it for `duration` ms fires `callback`, matching the Pointer
 *  Events API's own unified handling of touch/mouse/stylus alike
 *  rather than separately wiring touch* and mouse* events. Movement
 *  beyond a small threshold (a scroll starting on the same element,
 *  not a held press) or releasing early cancels the pending timer --
 *  a genuine long-press only fires once the full duration has
 *  elapsed with the pointer still down and still roughly in place.
 *  Sets `el`'s own `dataset.longPressFired` for one tick after firing,
 *  so a caller's own click handler (which still fires on release,
 *  same as any other tap) can check it and skip its own normal action
 *  -- the long-press's own callback already ran, a regular tap
 *  shouldn't also do something on top of that. */
export function attachLongPress(el, callback, duration = 600) {
  let timer = null;
  let startX = 0;
  let startY = 0;
  const MOVE_THRESHOLD = 10;

  const cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  el.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return; // only the primary button/touch -- not right-click etc.
    startX = e.clientX;
    startY = e.clientY;
    timer = setTimeout(() => {
      timer = null;
      el.dataset.longPressFired = '1';
      callback(e);
    }, duration);
  });
  el.addEventListener('pointermove', (e) => {
    if (!timer) return;
    if (Math.abs(e.clientX - startX) > MOVE_THRESHOLD || Math.abs(e.clientY - startY) > MOVE_THRESHOLD) cancel();
  });
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('pointerleave', cancel);
}

export function textInputStyle(el, compact) {
  if (!compact) {
    el.style.width = '100%';
    el.style.maxWidth = '100%';
    el.style.minWidth = '0';
  }
  el.style.minHeight = '40px';
  el.style.fontSize = '16px';
  el.style.padding = '6px 8px';
  el.style.boxSizing = 'border-box';
  el.style.border = '1px solid var(--border-strong)';
  el.style.borderRadius = '6px';
  el.style.background = 'var(--bg)';
  el.style.color = 'var(--fg)';
  el.style.font = 'inherit';
  // iOS Safari specifically: native form-control chrome (select's own
  // dropdown affordance, a button matched to this same sizing) doesn't
  // fully respect max-width/box-sizing the way Chrome's does -- the
  // same documented fix already used for the date/time inputs below.
  el.style.webkitAppearance = 'none';
  el.style.appearance = 'none';
  if (el.tagName === 'SELECT') {
    // appearance:none also strips the native dropdown-arrow indicator
    // -- replaced with a CSS chevron so the "this is a dropdown, not a
    // text field" affordance survives the fix above rather than being
    // silently lost.
    el.style.backgroundImage =
      "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpath d='M5 7l5 5 5-5'/%3E%3C/svg%3E\")";
    el.style.backgroundRepeat = 'no-repeat';
    el.style.backgroundPosition = 'right 8px center';
    el.style.backgroundSize = '16px';
    el.style.paddingRight = '28px';
  }
}

/** Populates `selectEl` with <option> elements from `options` (an
 *  array of {value, label} pairs), marking whichever matches
 *  `currentValue` as selected -- the single source of truth for this
 *  boilerplate, previously duplicated verbatim between the Quick
 *  Settings select-type field and the weather auto-refresh-interval
 *  dropdown, a real drift risk (and the two had, in fact, already
 *  drifted apart in a followup fix before this consolidation).
 *  Clears any existing <option> children first, so it's also safe to
 *  call again on an already-populated select (e.g. after a value
 *  change re-renders the same dropdown). */
export function populateSelectOptions(selectEl, options, currentValue) {
  selectEl.innerHTML = '';
  for (const opt of options) {
    const optionEl = document.createElement('option');
    optionEl.value = opt.value;
    optionEl.textContent = opt.label;
    if (opt.value === currentValue) optionEl.selected = true;
    selectEl.appendChild(optionEl);
  }
}

/** Matches a button's own sizing to textInputStyle's entry-field
 *  convention -- for a button that needs to sit on the same row as
 *  an actual entry field (a select, an input) and look consistent
 *  with it, overriding the broader .panel button rule's own larger
 *  touch-target sizing (correct for buttons generally -- a deliberate
 *  44px minimum for touch targets -- but visibly mismatched here,
 *  which is exactly the bug this fixes). Also applies the same iOS
 *  appearance:none fix textInputStyle needs, for the same underlying
 *  reason: native button chrome not fully respecting box-sizing. */
export function entryFieldButtonStyle(btn) {
  btn.style.minHeight = '40px';
  btn.style.padding = '6px 8px';
  btn.style.fontSize = '16px';
  btn.style.webkitAppearance = 'none';
  btn.style.appearance = 'none';
}

export function fieldRow(labelText, inputEl) {
  const row = document.createElement('div');
  row.style.marginBottom = '8px';
  row.style.boxSizing = 'border-box';
  row.style.width = '100%';
  row.style.maxWidth = '100%';
  const l = document.createElement('label');
  l.textContent = labelText;
  l.style.fontSize = '12px';
  l.style.opacity = '0.75';
  l.style.display = 'block';
  l.style.marginBottom = '2px';
  row.appendChild(l);
  row.appendChild(inputEl);
  return row;
}

// Wraps a row element and any number of optional extra elements (action
// menu, the combined heading-text editor, etc.) stacked below it in a
// plain block container — this is what lets a single renderRow() call
// produce "several stacked pieces" without changing render()'s
// one-element-per-row assumption.
export function withActionMenu(rowEl, ...extras) {
  const present = extras.filter(Boolean);
  if (present.length === 0) return rowEl;
  const wrap = document.createElement('div');
  wrap.appendChild(rowEl);
  for (const el of present) wrap.appendChild(el);
  return wrap;
}

/**
 * Makes a textarea grow to fit its content instead of scrolling
 * internally — appropriate for a focused edit (a heading's text, its
 * properties, a single paragraph), where the amount of content is
 * modest and scrolling inside a small box just to see what you're
 * editing is more friction than it's worth. Deliberately NOT used for
 * the whole-document plain-text editor (View → Text), which stays
 * bounded with its own internal scroll — that one really can hold an
 * entire file's worth of text, where growing the whole page to fit it
 * would defeat the fixed-app-shell layout instead of serving it.
 */
export function autoGrowTextarea(textarea) {
  textarea.style.resize = 'none';
  textarea.style.overflow = 'hidden';
  const resize = () => {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
  };
  textarea.addEventListener('input', resize);
  // Called once immediately, after the caller has set the textarea's
  // initial value — sizes it correctly from the start rather than only
  // growing in response to the user's own typing.
  requestAnimationFrame(resize);
}

// Matches a leading icon/emoji at the start of a button's own label --
// a single "Extended_Pictographic" character, optionally followed by
// a variation selector (U+FE0F, the "render as emoji not text" hint
// many of these glyphs carry) or a zero-width-joined second
// pictographic (for a compound emoji like the "person + laptop"
// family), plus any trailing whitespace before the label text itself
// starts. Deliberately does NOT match a bare navigation glyph like
// "‹"/"«"/"→" -- those are punctuation, not Extended_Pictographic, and
// read correctly at the normal text size already; only a genuine
// icon-style glyph gets the larger, separately-sized treatment below.
export const LEADING_ICON_RE = /^(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)(\s*)/u;

export function menuButton(label, onClick, disabled) {
  const btn = document.createElement('button');
  const match = LEADING_ICON_RE.exec(label);
  if (match) {
    const icon = document.createElement('span');
    icon.textContent = match[1];
    icon.style.fontSize = '1.3em'; // relative to the button's own font-size, so this scales correctly wherever this button ends up (a .panel button's 15px, a wizardButton's larger sizing, etc.) rather than a fixed px value that would only be correct in one context
    icon.style.verticalAlign = '-0.1em'; // nudges the larger glyph back down to align with the label text's own baseline, rather than sitting visibly high
    btn.appendChild(icon);
    btn.appendChild(document.createTextNode(match[2] + label.slice(match[0].length)));
  } else {
    btn.textContent = label;
  }
  btn.disabled = !!disabled;
  btn.onclick = onClick;
  return btn;
}

/** Appends a menu's own buttons to `container`, in whichever order
 *  org-xx-menu-aliases specifies for that menu, or the app's own
 *  default order otherwise -- see this function's own doc comment
 *  above (requiredMenuButton) and the block comment just above this
 *  one for the full "opt-in, all-or-nothing" reordering rule this
 *  implements.
 *
 *  `labeledButtons` is an array of { label, btn } in the app's own
 *  default order -- btn may be null (already omitted via
 *  aliasedMenuButton's own alias==='' rule for a non-required
 *  button); a null entry is simply skipped wherever it lands in the
 *  final order. An alias-map entry naming a label that isn't among
 *  labeledButtons at all (typo, or a stale reference to a button
 *  that no longer exists) is silently dropped from the reordering,
 *  the same tolerant-of-the-unexpected approach every other
 *  recognized-subset parser in this codebase already takes. */
export function appendMenuButtonsInOrder(container, aliasMap, labeledButtons) {
  const order = resolveMenuOrder(
    aliasMap,
    labeledButtons.map(({ label }) => label)
  );
  for (const label of order) {
    const entry = labeledButtons.find((lb) => lb.label === label);
    if (entry && entry.btn) container.appendChild(entry.btn);
  }
}

/** A vertical dropdown-menu container -- the .menu-list counterpart to
 *  a plain .panel-row, for the app's own top-level navigation menus
 *  (File/View/More, Export/backend-picker). */
/** Positions `panelEl` (a .popup-menu element, already display:block
 *  with its own content rendered) as a floating popup anchored near
 *  `buttonEl`'s own current position -- see this function's own
 *  top-level docs above for why this can't just be a fixed CSS
 *  offset the way extraMenuPanel's own corner-anchored popup is. */
export function positionPopupNearButton(panelEl, buttonEl) {
  const btnRect = buttonEl.getBoundingClientRect();
  const margin = 8;
  const vv = window.visualViewport;
  const viewportWidth = vv ? vv.width : window.innerWidth;
  const viewportHeight = vv ? vv.height : window.innerHeight;
  const maxWidth = Math.min(viewportWidth * 0.75, 420, viewportWidth - margin * 2);
  panelEl.style.maxWidth = maxWidth + 'px';

  // Measured AFTER max-width is set, since wrapped text reflows to it,
  // changing the panel's own natural height.
  const panelHeight = panelEl.offsetHeight;
  const panelWidth = panelEl.offsetWidth;

  let left = btnRect.left;
  if (left + panelWidth > viewportWidth - margin) left = viewportWidth - margin - panelWidth;
  if (left < margin) left = margin;

  let top = btnRect.bottom + 4;
  if (top + panelHeight > viewportHeight - margin && btnRect.top - panelHeight - 4 > margin) {
    top = btnRect.top - panelHeight - 4; // not enough room below -- open above instead
  }

  panelEl.style.left = left + 'px';
  panelEl.style.top = top + 'px';
}

/** Builds one <div>-based popup-menu item -- the div/onclick-based
 *  counterpart to menuButton (which builds a <button>), matching
 *  Extras' own existing item-construction approach exactly, so every
 *  popup menu in this app (File/View/More/Export/the New-Open-Save-As
 *  backend picker, alongside Extras itself) is built the identical
 *  way, not merely restyled to resemble it. Icon-prefix parsing
 *  (LEADING_ICON_RE) matches menuButton's own exactly. A <div> has no
 *  native disabled attribute -- .menu-list-item-disabled (CSS) plus
 *  aria-disabled stand in for it, with the click handler simply never
 *  attached at all rather than attached-but-blocked. */
export function menuDivItem(label, onClick, disabled) {
  const el = document.createElement('div');
  el.className = 'menu-list-item';
  el.setAttribute('role', 'menuitem');
  const match = LEADING_ICON_RE.exec(label);
  if (match) {
    const icon = document.createElement('span');
    icon.textContent = match[1];
    icon.style.fontSize = '1.3em';
    icon.style.verticalAlign = '-0.1em';
    el.appendChild(icon);
    el.appendChild(document.createTextNode(match[2] + label.slice(match[0].length)));
  } else {
    el.textContent = label;
  }
  if (disabled) {
    el.classList.add('menu-list-item-disabled');
    el.setAttribute('aria-disabled', 'true');
  } else {
    el.onclick = onClick;
  }
  return el;
}

/** The div-item counterpart to aliasedMenuButton -- same org-xx-menu-
 *  aliases lookup/omission semantics exactly (see aliasedMenuButton's
 *  own docs for the full "menu:Label;alias" rules), just producing a
 *  menuDivItem instead of a menuButton. */
export function aliasedMenuDivItem(aliasMap, label, onClick, disabled) {
  const alias = aliasMap ? aliasMap[label] : undefined;
  if (alias === '') return null; // explicitly omitted
  const el = menuDivItem(alias || label, onClick, disabled);
  if (alias) el.setAttribute('aria-label', label);
  return el;
}

/** The div-item counterpart to requiredMenuButton -- never omitted,
 *  same as requiredMenuButton's own semantics. */
export function requiredMenuDivItem(aliasMap, label, onClick, disabled) {
  const alias = aliasMap ? aliasMap[label] : undefined;
  const el = menuDivItem(alias || label, onClick, disabled);
  if (alias) el.setAttribute('aria-label', label);
  return el;
}

/** Same idea as menuButton, but with explicit comfortable sizing
 *  (matching the .panel button convention) for use outside a
 *  .panel-classed container — e.g. the timestamp wizard's Save/Cancel,
 *  which otherwise fell back to bare, unstyled, visually cramped
 *  buttons since nothing in their ancestor chain provided sizing. */
export function wizardButton(label, onClick) {
  const btn = menuButton(label, onClick);
  btn.style.flex = '1';
  btn.style.fontSize = '15px';
  btn.style.padding = '10px 14px';
  btn.style.minHeight = '44px';
  return btn;
}

export function tableActionButton(label, onClick, disabled) {
  const btn = menuButton(label, onClick, disabled);
  btn.style.fontSize = '15px';
  btn.style.padding = '10px 14px';
  btn.style.minHeight = '44px';
  return btn;
}

/** The height of whatever the page draws underneath at the top of the screen: an Android status bar, an iPhone's notch. The
 *  page declares viewport-fit=cover, so it is drawn edge to edge, and anything fixed to the top has to start below this
 *  (it is 0 in a browser tab). Read back through env(), the only way a page can ask. */
export function safeAreaTop() {
  let probe = document.getElementById('safeAreaProbe');
  if (!probe) {
    probe = document.createElement('div');
    probe.id = 'safeAreaProbe';
    probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top, 0px)';
    document.body.appendChild(probe);
  }
  return parseFloat(getComputedStyle(probe).paddingTop) || 0;
}

/** Keeps a fixed-position overlay element aligned with the ACTUALLY
 *  visible viewport, even while an on-screen keyboard is open -- the
 *  same visualViewport-based technique already used for #topBar (see
 *  that code's own comments for the full research/reasoning), applied
 *  here since a modal's own focused field opens the keyboard
 *  immediately, and a plain "position: fixed; inset: 0" alone stays
 *  pinned to the LARGER layout viewport, letting the modal appear to
 *  drift or "scroll" out of the visible area as the keyboard opens
 *  and closes. Returns a cleanup function removing every listener
 *  this attaches -- unlike #topBar's own deliberately permanent ones,
 *  a modal's own listeners must not outlive the modal itself. */
export function keepOverlayInVisibleViewport(overlay) {
  const vv = window.visualViewport;
  function reposition() {
    if (!vv) return; // inset: 0 (already set by the caller) is the correct fallback
    // below the status bar, so nothing in the overlay (a menu, a dialog, the top of a tall form) can end up under it
    const inset = safeAreaTop();
    overlay.style.top = vv.offsetTop + inset + 'px';
    overlay.style.left = vv.offsetLeft + 'px';
    overlay.style.width = vv.width + 'px';
    overlay.style.height = Math.max(0, vv.height - inset) + 'px';
  }
  reposition();
  const cleanups = [];
  function on(target, evt, handler) {
    target.addEventListener(evt, handler);
    cleanups.push(() => target.removeEventListener(evt, handler));
  }
  if (vv) {
    on(vv, 'resize', reposition);
    on(vv, 'scroll', reposition);
  }
  on(window, 'scroll', reposition);
  on(window, 'resize', reposition);
  const focusHandler = () => setTimeout(reposition, 350);
  on(document, 'focusin', focusHandler);
  on(document, 'focusout', focusHandler);
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}

// Shared show/hide for the three modal overlays that still work by
// toggling a fixed, shared element's own display (refilePanel,
// capturePanel, doneNotePanel) rather than being built fresh by a
// single open()/close() pair the way openGeneralEditor/
// openButtonChoiceModal are -- each of their own several render
// functions calls these instead of touching style.display directly,
// so the viewport-tracking/background-scroll-lock setup (the same
// mechanism every other modal in this app already uses) happens
// exactly once per "session" regardless of which or how many of
// those render functions actually do the showing.
export const modalOverlayCleanups = new Map();

export function hideModalOverlay(overlayEl) {
  overlayEl.style.display = 'none';
  const cleanup = modalOverlayCleanups.get(overlayEl);
  if (cleanup) {
    cleanup();
    modalOverlayCleanups.delete(overlayEl);
  }
}

/** One field row for openMultiFieldPopup below -- a real, single-line
 *  `<input>` (not labeledInput's own auto-growing textarea, which is
 *  built for a flex-wrap multi-field-per-row layout this modal
 *  deliberately doesn't use) with a consistent, deliberate vertical
 *  rhythm between fields, for a tighter, more custom form feel than
 *  reusing the general-purpose labeledInput as-is produced. */
export function modalFieldRow(labelText, type, value, placeholder) {
  const wrap = document.createElement('div');
  wrap.style.marginBottom = '14px';

  const labelEl = document.createElement('label');
  labelEl.textContent = labelText;
  labelEl.style.display = 'block';
  labelEl.style.fontSize = '13px';
  labelEl.style.fontWeight = '600';
  labelEl.style.opacity = '0.85';
  labelEl.style.marginBottom = '4px';
  wrap.appendChild(labelEl);

  const input = document.createElement('input');
  input.type = type;
  input.value = value || '';
  if (placeholder) input.placeholder = placeholder;
  input.style.width = '100%';
  input.style.boxSizing = 'border-box';
  input.style.font = 'inherit';
  input.style.fontSize = '15px';
  input.style.padding = '10px 12px';
  input.style.minHeight = '44px';
  input.style.border = '1px solid var(--border-strong)';
  input.style.borderRadius = '8px';
  input.style.background = 'var(--bg)';
  input.style.color = 'var(--fg)';
  wrap.appendChild(input);

  return { wrap, input };
}

export function labeledInput(labelText, type, value, placeholder) {
  const wrap = document.createElement('div');
  wrap.className = 'panel-field';
  const labelEl = document.createElement('label');
  labelEl.textContent = labelText;
  wrap.appendChild(labelEl);

  if (type === 'password') {
    // Stays a real <input type="password"> — masking requires it, and
    // there's no password-type textarea. A justified, narrow exception
    // to the "always wraps, never scrolls horizontally" rule elsewhere:
    // masked content isn't something wrapping would help read anyway.
    const input = document.createElement('input');
    input.type = 'password';
    input.value = value || '';
    if (placeholder) input.placeholder = placeholder;
    wrap.appendChild(input);
    return { wrap, input };
  }

  const input = document.createElement('textarea');
  input.rows = 1;
  input.value = value || '';
  if (placeholder) input.placeholder = placeholder;
  input.style.overflowWrap = 'anywhere';
  input.style.font = 'inherit';
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.preventDefault(); // one logical line — a repo/branch/URL/username, not multi-line content
  });
  autoGrowTextarea(input);
  wrap.appendChild(input);
  return { wrap, input };
}

/** Opens the native file picker and resolves with the picked file's raw
 *  text content. A minimal, standalone helper for settings import --
 *  deliberately not reusing pickAndImportFile, which is built for .org
 *  document import specifically and also caches the picked content
 *  into kv under an unrelated key for later re-reading; a one-off
 *  settings JSON file has no business being cached there. */
export function pickTextFile(accept) {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (input.parentNode) input.parentNode.removeChild(input);
      if (!file) {
        reject(new Error('No file selected'));
        return;
      }
      try {
        resolve(await file.text());
      } catch (err) {
        reject(err);
      }
    });
    document.body.appendChild(input);
    input.click();
  });
}

export function appendSnippetWithHighlight(container, snippet) {
  if (!snippet) return;
  const { text, highlightStart, highlightLength } = snippet;
  if (highlightStart < 0 || highlightLength <= 0) {
    container.appendChild(document.createTextNode(text));
    return;
  }
  const before = text.slice(0, highlightStart);
  const match = text.slice(highlightStart, highlightStart + highlightLength);
  const after = text.slice(highlightStart + highlightLength);
  if (before) container.appendChild(document.createTextNode(before));
  const mark = document.createElement('mark');
  mark.textContent = match;
  container.appendChild(mark);
  if (after) container.appendChild(document.createTextNode(after));
}
