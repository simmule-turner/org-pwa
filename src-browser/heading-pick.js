// @ts-check
// A small picker for one heading of the open document: a filter box above the outline paths. Resolves to the heading, or null on cancel.
// Used by the Folder panel's Copy to heading and Move to heading.
import { S } from './app-state.js';
import { lockBackgroundScroll } from './dialogs.js';
import { keepOverlayInVisibleViewport, menuButton } from './ui-widgets.js';

/** @typedef {import('../src/types.js').Heading} Heading */

const MAX_SHOWN = 60;

/** Every heading of the document with its outline path, in file order.
 * @param {{ children?: Heading[] }} doc
 * @returns {{ heading: Heading, path: string }[]} */
function listHeadings(doc) {
  /** @type {{ heading: Heading, path: string }[]} */
  const out = [];
  /** @param {Heading[]} nodes @param {string} prefix */
  const walk = (nodes, prefix) => {
    for (const h of nodes) {
      const path = prefix ? `${prefix} / ${h.title}` : h.title;
      out.push({ heading: h, path });
      walk(h.children || [], path);
    }
  };
  walk(doc.children || [], '');
  return out;
}

/**
 * @param {string} label  what the pick is for
 * @param {Heading | null} [exclude]  the heading to leave out
 * @returns {Promise<Heading | null>}
 */
export function pickHeading(label, exclude = null) {
  return new Promise((resolve) => {
    const all = listHeadings(/** @type {import('../src/types.js').Doc} */ (S.state.doc)).filter((e) => e.heading !== exclude);
    const overlay = document.createElement('div');
    overlay.className = 'ui-overlay';
    overlay.style.overflow = 'hidden';
    const modal = document.createElement('div');
    modal.className = 'panel ui-container';
    modal.style.cssText = 'padding:14px;width:100%;max-width:520px;overflow-y:auto;overscroll-behavior:contain;';
    overlay.appendChild(modal);
    const title = document.createElement('div');
    title.style.cssText = 'font-size:13px;margin-bottom:8px;';
    title.textContent = label;
    modal.appendChild(title);
    const filter = document.createElement('input');
    filter.type = 'search';
    filter.placeholder = 'Filter headings';
    filter.setAttribute('aria-label', 'Filter headings');
    filter.style.cssText = 'width:100%;box-sizing:border-box;font:inherit;padding:6px 8px;margin-bottom:8px;';
    modal.appendChild(filter);
    const list = document.createElement('div');
    modal.appendChild(list);
    const stopTrackingViewport = keepOverlayInVisibleViewport(overlay);
    const unlockScroll = lockBackgroundScroll(overlay);
    const wasOpen = S.buttonChoiceModalOpen;
    S.buttonChoiceModalOpen = true;
    /** @param {Heading | null} result */
    const finish = (result) => {
      S.buttonChoiceModalOpen = wasOpen;
      stopTrackingViewport();
      unlockScroll();
      if (overlay.parentNode) document.body.removeChild(overlay);
      resolve(result);
    };
    const draw = () => {
      list.replaceChildren();
      const words = filter.value.toLowerCase().split(/\s+/).filter(Boolean);
      const matches = all.filter((e) => words.every((w) => e.path.toLowerCase().includes(w)));
      for (const e of matches.slice(0, MAX_SHOWN)) {
        const b = menuButton(e.path, () => finish(e.heading));
        b.style.display = 'block';
        b.style.width = '100%';
        b.style.textAlign = 'left';
        list.appendChild(b);
      }
      const note = document.createElement('div');
      note.style.cssText = 'font-size:12px;opacity:.65;margin:6px 0;';
      note.textContent = matches.length === 0 ? 'No heading matches.' : matches.length > MAX_SHOWN ? `Showing ${MAX_SHOWN} of ${matches.length} — type to narrow the list.` : '';
      if (note.textContent) list.appendChild(note);
    };
    filter.addEventListener('input', draw);
    const row = document.createElement('div');
    row.className = 'panel-row';
    row.appendChild(menuButton('Cancel', () => finish(null)));
    modal.appendChild(row);
    document.body.appendChild(overlay);
    draw();
    filter.focus();
  });
}
