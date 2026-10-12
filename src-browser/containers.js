// @ts-check
// Behavior shared by the app's popups (the "ui-overlay" / "ui-container" classes in index.html): Tab stays inside the open popup,
// and focus goes back to what had it when the popup opened.

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
/** @type {WeakMap<HTMLElement, Element | null>} */
const openers = new WeakMap();

/** Notes what has focus now, once per opening, so closing can give it back.
 * @param {HTMLElement} overlay */
export function rememberOpener(overlay) {
  if (!openers.has(overlay)) openers.set(overlay, document.activeElement);
}

/** Gives focus back to what had it when the popup opened, if it is still on the page.
 * @param {HTMLElement} overlay */
export function restoreOpener(overlay) {
  const el = openers.get(overlay);
  openers.delete(overlay);
  if (el instanceof HTMLElement && el.isConnected) el.focus();
}

/** Makes Tab and Shift+Tab cycle through the popup's own controls instead of leaving it. Safe to call again for the same overlay.
 * @param {HTMLElement} overlay */
export function containTab(overlay) {
  if (overlay.dataset.tabContained) return;
  overlay.dataset.tabContained = '1';
  overlay.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const items = [...overlay.querySelectorAll(FOCUSABLE)].filter((el) => el instanceof HTMLElement && el.offsetParent !== null);
    if (items.length === 0) return;
    const first = /** @type {HTMLElement} */ (items[0]);
    const last = /** @type {HTMLElement} */ (items[items.length - 1]);
    const active = document.activeElement;
    if (!overlay.contains(active)) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  });
}

/** Arrow-key use of a popup menu: Up/Down/Home/End move between its rows, Enter or Space runs the one in focus. Focus goes to the
 *  first row when the menu opens or is redrawn, unless it is already inside. Safe to call again for the same menu.
 * @param {HTMLElement} menu */
export function enhanceMenu(menu) {
  if (!menu.dataset.menuKeys) {
    menu.dataset.menuKeys = '1';
    menu.addEventListener('keydown', (e) => {
      const rows = /** @type {HTMLElement[]} */ ([...menu.querySelectorAll('[role="menuitem"][tabindex="0"]')]);
      if (rows.length === 0) return;
      const at = rows.indexOf(/** @type {HTMLElement} */ (document.activeElement));
      let next = -1;
      if (e.key === 'ArrowDown') next = at < 0 ? 0 : Math.min(rows.length - 1, at + 1);
      else if (e.key === 'ArrowUp') next = at < 0 ? rows.length - 1 : Math.max(0, at - 1);
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = rows.length - 1;
      else if ((e.key === 'Enter' || e.key === ' ') && at >= 0) {
        e.preventDefault();
        rows[at].click();
        return;
      }
      if (next >= 0) {
        e.preventDefault();
        rows[next].focus();
      }
    });
  }
  if (menu.contains(document.activeElement)) return;
  const first = /** @type {HTMLElement | null} */ (menu.querySelector('[role="menuitem"][tabindex="0"]'));
  if (first) first.focus({ preventScroll: true });
}
