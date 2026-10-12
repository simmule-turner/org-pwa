// @ts-check
// The chip row under the Agenda's and the TODO view's controls: Tag, State, Category, and optionally more chips of the view's own
// (the TODO view adds its Sort). A chip with a choice made shows it and an x to clear it. The choices live in S.viewFilter and
// last for the session, like the effort view. A change redraws the view through `onChange`.
import { applyViewFilter, emptyViewFilter, viewFilterActive, viewFilterChoices } from '../src/agenda-filter.js';
import { S } from './app-state.js';
import { openChoiceSheet } from './bottom-sheet.js';

const CHIP_STYLE = 'min-height:44px;padding:0 14px;border-radius:22px;font-size:14px;white-space:nowrap;';

/** @param {string[]} values @param {string} one @param {string} many */
function chipText(values, one, many) {
  if (values.length === 0) return one + ' ▾';
  return values.length === 1 ? `${one}: ${values[0]}` : `${many}: ${values.length}`;
}

/**
 * @param {any[]} items  every item of the view, before filtering, so the choices cover all of them
 * @param {() => void} onChange
 * @param {HTMLElement[]} [extraChips]  more chips for the end of the row
 * @returns {HTMLElement}
 */
export function buildViewFilterRow(items, onChange, extraChips = []) {
  const row = document.createElement('div');
  row.setAttribute('data-view-filter', '');
  row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px;';
  const choices = viewFilterChoices(items);
  const filter = S.viewFilter || (S.viewFilter = emptyViewFilter());

  /** @param {'tags'|'todos'|'categories'} field @param {string} one @param {string} many @param {string} title @param {[string, number][]} offered */
  const chip = (field, one, many, title, offered) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;align-items:center;';
    const active = filter[field].length > 0;
    const open = document.createElement('button');
    open.textContent = chipText(filter[field], one, many);
    open.setAttribute('aria-label', `Filter by ${title}`);
    open.style.cssText = CHIP_STYLE + (active ? 'border-color:var(--accent);font-weight:700;border-top-right-radius:0;border-bottom-right-radius:0;' : '');
    open.onclick = () => {
      // keep a chosen value on offer even when the items in view no longer carry it, so it can still be unchecked
      const known = new Set(offered.map(([v]) => v));
      const all = [...offered, .../** @type {[string, number][]} */ (filter[field].filter((v) => !known.has(v)).map((v) => [v, 0]))];
      openChoiceSheet({
        title,
        choices: all,
        selected: filter[field],
        onApply: (values) => {
          filter[field] = values;
          onChange();
        },
      });
    };
    wrap.appendChild(open);
    if (active) {
      const clear = document.createElement('button');
      clear.textContent = '✕';
      clear.setAttribute('aria-label', `Clear the ${title} filter`);
      clear.style.cssText = CHIP_STYLE + 'padding:0 12px;border-color:var(--accent);border-top-left-radius:0;border-bottom-left-radius:0;border-left:0;';
      clear.onclick = () => {
        filter[field] = [];
        onChange();
      };
      wrap.appendChild(clear);
    }
    return wrap;
  };

  row.appendChild(chip('tags', 'Tag', 'Tags', 'Tags', choices.tags));
  row.appendChild(chip('todos', 'State', 'States', 'TODO states', choices.todos));
  row.appendChild(chip('categories', 'Category', 'Categories', 'Categories', choices.categories));
  for (const extra of extraChips) row.appendChild(extra);
  return row;
}

/** The items that pass the chosen filter. */
export function filterItemsForView(/** @type {any[]} */ items) {
  return applyViewFilter(items, S.viewFilter);
}

export { viewFilterActive };
