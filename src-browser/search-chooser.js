// @ts-check
// The top bar's Search button. A tap opens the search used last (Find, Match or Keyword search); a tap while one is showing, or a
// long press, opens the chooser: a sheet with the three ways to search and the saved queries.
import { parseCustomCommands } from '../src/agenda-commands.js';
import { openQueryView, runCommand } from './agenda-query-view.js';
import { S } from './app-state.js';
import { openContentSheet } from './bottom-sheet.js';
import { closeAllOverlayPanels } from './chrome.js';
import { render } from './render.js';
import { renderSearchPanel } from './search-ui.js';

const LAST_KEY = 'org-pwa-last-search';
const KINDS = ['find', 'tags', 'search'];
const LONG_PRESS_MS = 500;

/** @returns {'find' | 'tags' | 'search'} */
function lastSearch() {
  try {
    const stored = localStorage.getItem(LAST_KEY);
    if (stored && KINDS.includes(stored)) return /** @type {'find' | 'tags' | 'search'} */ (stored);
  } catch {
    /* storage unavailable: Find */
  }
  return 'find';
}

/** @param {'find' | 'tags' | 'search'} kind */
function remember(kind) {
  try {
    localStorage.setItem(LAST_KEY, kind);
  } catch {
    /* the choice just isn't kept */
  }
}

/** Opens the Search panel (the Find way); it stays open until closed. */
export function openFind() {
  remember('find');
  closeAllOverlayPanels();
  S.searchOpen = true;
  render();
  renderSearchPanel();
}

/** @param {'find' | 'tags' | 'search'} kind */
export function runSearch(kind) {
  if (kind === 'find') return openFind();
  remember(kind);
  closeAllOverlayPanels();
  openQueryView(kind);
}

/** True while one of the three searches is what the screen shows. */
function searchShowing() {
  return S.searchOpen || S.currentView === 'match' || S.currentView === 'searchview';
}

/** The sheet of searches: Find, Match, Keyword search, then the saved queries as chips. */
export function openSearchChooser() {
  /** @type {() => void} */ let close = () => {};
  close = openContentSheet({
    title: 'Search',
    build: (panel) => {
      /** @param {string} name @param {string} detail @param {string} keys @param {() => void} run */
      const row = (name, detail, keys, run) => {
        const b = document.createElement('button');
        b.style.cssText = 'display:flex;gap:12px;align-items:center;width:100%;min-height:64px;text-align:left;padding:8px;';
        const text = document.createElement('span');
        const n = document.createElement('div');
        n.textContent = name;
        n.style.cssText = 'font-size:16px;font-weight:600;';
        const d = document.createElement('div');
        d.textContent = detail;
        d.style.cssText = 'font-size:13px;opacity:0.7;line-height:1.3;margin-top:2px;';
        text.append(n, d);
        const k = document.createElement('span');
        k.textContent = keys;
        k.style.cssText = 'margin-left:auto;flex:none;font:12px ui-monospace,Menlo,monospace;opacity:0.7;border:1px solid var(--border-strong);border-radius:6px;padding:2px 7px;white-space:nowrap;';
        b.append(text, k);
        b.onclick = () => {
          close();
          run();
        };
        panel.appendChild(b);
      };
      row('Find', 'Type and see matches as you go. Narrow, replace, regex.', 'C-s', () => runSearch('find'));
      row('Match tags and state', 'work+urgent, /NEXT, Effort<1:00 across the agenda files.', 'C-c a m', () => runSearch('tags'));
      row('Keyword search', 'Words and phrases in headings and notes: +budget -draft.', 'C-c a s', () => runSearch('search'));
      const commands = parseCustomCommands(S.state.localVariables['org-agenda-custom-commands']);
      if (commands.length === 0) return;
      const head = document.createElement('div');
      head.textContent = 'Saved queries';
      head.style.cssText = 'font-size:12px;font-weight:700;opacity:0.6;margin:12px 4px 4px;text-transform:uppercase;letter-spacing:.04em;';
      const chips = document.createElement('div');
      chips.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;padding:0 4px;';
      for (const c of commands) {
        const chip = document.createElement('button');
        chip.style.cssText = 'min-height:44px;padding:0 14px;border-radius:22px;display:flex;align-items:center;gap:8px;';
        const key = document.createElement('b');
        key.textContent = c.key;
        key.style.fontFamily = 'ui-monospace,Menlo,monospace';
        chip.append(key, document.createTextNode(c.description || c.query));
        chip.onclick = () => {
          close();
          closeAllOverlayPanels();
          runCommand(c);
        };
        chips.appendChild(chip);
      }
      panel.append(head, chips);
    },
  });
}

/**
 * Wires the top-bar button: tap = the last search (or the chooser when one is already showing), long press = the chooser.
 * @param {HTMLElement} button
 */
export function wireSearchMenuButton(button) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */ let timer;
  let pressed = false;
  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  button.addEventListener('pointerdown', () => {
    pressed = false;
    cancel();
    timer = setTimeout(() => {
      pressed = true;
      openSearchChooser();
    }, LONG_PRESS_MS);
  });
  for (const type of ['pointerup', 'pointerleave', 'pointercancel']) button.addEventListener(type, cancel);
  button.addEventListener('contextmenu', (e) => e.preventDefault());
  button.addEventListener('click', (e) => {
    // the click that ends a long press is the long press, not a tap; a keyboard or scripted click has no press behind it
    const afterLongPress = pressed && e.detail > 0;
    pressed = false;
    if (afterLongPress) return;
    if (!S.state.doc) return;
    if (searchShowing()) openSearchChooser();
    else runSearch(lastSearch());
  });
}
