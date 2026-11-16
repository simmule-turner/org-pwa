// @ts-check
// Find on the Agenda, TODO, Match and Keyword search screens: Emacs's incremental search in an agenda buffer. Every match in the rows on
// screen is highlighted, one is current, and C-s / C-r (or the arrows) move between them; nothing is hidden and nothing leaves the screen.
import { emacsRegexToJs, EmacsRegexError } from '../src/elisp-regex.js';
import { S } from './app-state.js';
import { focusRowOfMark } from './agenda-row-focus.js';
import { outlineEl } from './dom.js';

const ROW_VIEWS = ['agenda', 'tasklist', 'match', 'searchview', 'command'];
// controls of the screen are not text to search; its headings are, as the lines of an agenda buffer are
const SKIP = 'button, input, textarea, select, label, [data-view-filter], [data-query-count], [data-find-skip]';
const HIT = 'find-hit';

const find = {
  /** @type {HTMLElement[]} */ marks: [],
  current: 0,
  problem: '',
  /** past the last match (or before the first) the search fails, and the next step wraps round, as in Emacs */
  failing: false,
  wrapped: false,
  /** @type {MutationObserver | null} */ observer: null,
  applying: false,
  scheduled: false,
};

/** True on the screens whose Find marks the rows in place. */
export function isRowFindView() {
  return ROW_VIEWS.includes(S.currentView);
}

/** The pattern the box means: smart case as in Emacs (a capital letter makes it case sensitive), plain text unless Regex is on. */
/** @param {string} query */
function patternFor(query) {
  const flags = /[A-Z]/.test(query) ? 'g' : 'gi';
  if (S.searchUseRegex) return emacsRegexToJs(query, flags);
  return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
}

function clearMarks() {
  const parents = new Set();
  for (const mark of find.marks) {
    const parent = mark.parentNode;
    if (!parent) continue;
    mark.replaceWith(document.createTextNode(mark.textContent || ''));
    parents.add(parent);
  }
  for (const parent of parents) parent.normalize();
  find.marks = [];
}

function paintCurrent() {
  find.marks.forEach((m, i) => {
    const on = i === find.current;
    m.style.cssText = 'color:inherit;border-radius:2px;padding:0 1px;' + (on ? 'background:#ffb74d;outline:2px solid var(--accent);' : 'background:#ffe38a;');
  });
  if (find.marks.length) focusRowOfMark(find.marks[find.current]); // the row of the current match is the focused row
}

function updateCount() {
  const el = document.getElementById('find-row-count');
  if (!el) return;
  const query = S.searchQuery;
  el.style.color = find.problem ? '#c0392b' : '';
  if (find.problem) el.textContent = find.problem;
  else if (!query) el.textContent = 'Type to mark matches on this screen. C-s and the arrows step, Enter stays on the match; Regex is in ⋯.';
  else if (find.marks.length === 0) el.textContent = 'Failing: no matches on this screen.';
  else el.textContent = `${find.failing ? 'Failing: ' : find.wrapped ? 'Wrapped: ' : ''}${find.current + 1} of ${find.marks.length} match${find.marks.length === 1 ? '' : 'es'} on this screen`;
}

function apply() {
  find.applying = true;
  find.observer?.disconnect();
  clearMarks();
  find.problem = '';
  const query = S.searchQuery;
  if (query) {
    /** @type {RegExp | null} */ let re = null;
    try {
      re = patternFor(query);
    } catch (err) {
      find.problem = 'Invalid regex: ' + (err instanceof EmacsRegexError ? err.message : String(/** @type {Error} */ (err).message || err));
    }
    if (re) {
      /** @type {Text[]} */ const nodes = [];
      const walker = document.createTreeWalker(outlineEl, 4 /* NodeFilter.SHOW_TEXT */);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = /** @type {Text} */ (n);
        if (text.nodeValue && text.nodeValue.trim() && text.parentElement && !text.parentElement.closest(SKIP)) nodes.push(text);
      }
      for (const node of nodes) {
        const value = /** @type {string} */ (node.nodeValue);
        const hits = [...value.matchAll(re)].filter((m) => m[0].length > 0);
        if (hits.length === 0) continue;
        const frag = document.createDocumentFragment();
        let at = 0;
        for (const m of hits) {
          const start = /** @type {number} */ (m.index);
          if (start > at) frag.appendChild(document.createTextNode(value.slice(at, start)));
          const mark = document.createElement('mark');
          mark.className = HIT;
          mark.textContent = m[0];
          frag.appendChild(mark);
          find.marks.push(mark);
          at = start + m[0].length;
        }
        if (at < value.length) frag.appendChild(document.createTextNode(value.slice(at)));
        node.replaceWith(frag);
      }
    }
  }
  if (find.current >= find.marks.length) find.current = 0;
  paintCurrent();
  updateCount();
  watch();
  find.applying = false;
}

function watch() {
  if (!find.observer) {
    find.observer = new MutationObserver(() => {
      if (find.applying || find.scheduled) return;
      find.scheduled = true;
      queueMicrotask(() => {
        find.scheduled = false;
        if (S.searchOpen && isRowFindView()) apply(); // the screen was redrawn under the marks: mark it again
      });
    });
  }
  find.observer.observe(outlineEl, { childList: true, subtree: true, characterData: true });
}

/** @param {{ reset?: boolean }} [options] reset: the query changed, so start at the first match and show it */
export function refreshRowFind({ reset = false } = {}) {
  if (reset) {
    find.current = 0;
    find.failing = false;
    find.wrapped = false;
  }
  apply();
  if (reset) find.marks[find.current]?.scrollIntoView({ block: 'center' });
}

/** Clears the marks and stops watching the screen: the search closed. */
export function stopRowFind() {
  find.observer?.disconnect();
  find.applying = true;
  clearMarks();
  find.applying = false;
  find.current = 0;
  find.failing = false;
  find.wrapped = false;
  find.problem = '';
}

/** C-s (delta 1) and C-r (delta -1): the next or previous match. Past the last one (or before the first) the search fails; one more press wraps round.
 * @param {number} delta */
export function stepRowFind(delta) {
  const n = find.marks.length;
  if (n === 0) return;
  const atEnd = delta > 0 ? find.current === n - 1 : find.current === 0;
  if (atEnd && !find.failing) {
    find.failing = true;
  } else if (atEnd) {
    find.failing = false;
    find.wrapped = true;
    find.current = delta > 0 ? 0 : n - 1;
  } else {
    find.failing = false;
    find.current += delta;
  }
  paintCurrent();
  updateCount();
  find.marks[find.current].scrollIntoView({ block: 'center' });
}

export { updateCount as updateRowFindCount };
