// @ts-check
// The chip row under the Agenda's and the TODO view's controls: Tag, State, Category, and optionally more chips of the view's own
// (the TODO view adds its Sort). A chip with a choice made shows it and an x to clear it. The choices live in S.viewFilter and
// last for the session, like the effort view. A change redraws the view through `onChange`.
import { applyViewFilter, emptyViewFilter, filterRegexp, viewFilterActive, viewFilterChoices } from '../src/agenda-filter.js';
import { addFilterTags } from './tag-display.js';
import { S } from './app-state.js';
import { openChoiceSheet, openFormSheet } from './bottom-sheet.js';
import { setStatus } from './editing.js';

const CHIP_STYLE = 'min-height:44px;padding:0 14px;border-radius:22px;font-size:14px;white-space:nowrap;';

/** @param {string[]} values @param {string} one @param {string} many */
function chipText(values, one, many) {
  if (values.length === 0) return one + ' ▾';
  return values.length === 1 ? `${one}: ${values[0]}` : `${many}: ${values.length}`;
}

/** The text of a chip that may carry values to show and values to hide.
 * @param {string[]} shown @param {string[]} hidden @param {string} one @param {string} many @param {boolean} all */
function modeChipText(shown, hidden, one, many, all) {
  if (shown.length === 0 && hidden.length === 0) return one + ' ▾';
  const parts = [];
  if (shown.length) parts.push(all && shown.length > 1 ? `${many}: all ${shown.length}` : chipText(shown, one, many));
  if (hidden.length) parts.push(hidden.length === 1 ? `not ${hidden[0]}` : `not ${hidden.length}`);
  return parts.join(' · ');
}

const MODE_LABELS = /** @type {Record<string, string>} */ ({
  any: 'Show only items with any of these',
  all: 'Show only items with all of these',
  none: 'Hide items with any of these',
});

/**
 * @param {any[]} items  every item of the view, before filtering, so the choices cover all of them
 * @param {() => void} onChange
 * @param {HTMLElement[]} [extraChips]  more chips for the end of the row
 * @param {import('../src/tag-inheritance.js').AgendaViewType} [view]
 * @param {boolean} [compact]  only the Tag, State, Category and extra chips: no Search and Top headings (the Match and Keyword search views)
 * @returns {HTMLElement}
 */
export function buildViewFilterRow(items, onChange, extraChips = [], view = 'agenda', compact = false) {
  const row = document.createElement('div');
  row.setAttribute('data-view-filter', '');
  row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px;';
  addFilterTags(items, view);
  const choices = viewFilterChoices(items);
  const filter = S.viewFilter || (S.viewFilter = emptyViewFilter());

  /** A chip with a ✕ when something is chosen.
   * @param {string} text @param {string} title @param {boolean} active @param {() => void} open @param {() => void} clearIt */
  const shell = (text, title, active, open, clearIt) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;align-items:center;';
    const button = document.createElement('button');
    button.textContent = text;
    button.setAttribute('aria-label', `Filter by ${title}`);
    button.style.cssText = CHIP_STYLE + (active ? 'border-color:var(--accent);font-weight:700;border-top-right-radius:0;border-bottom-right-radius:0;' : '');
    button.onclick = open;
    wrap.appendChild(button);
    if (active) {
      const clear = document.createElement('button');
      clear.textContent = '✕';
      clear.setAttribute('aria-label', `Clear the ${title} filter`);
      clear.style.cssText = CHIP_STYLE + 'padding:0 12px;border-color:var(--accent);border-top-left-radius:0;border-bottom-left-radius:0;border-left:0;';
      clear.onclick = () => {
        clearIt();
        onChange();
      };
      wrap.appendChild(clear);
    }
    return wrap;
  };

  /** @param {'tags'|'todos'|'categories'} field @param {string} one @param {string} many @param {string} title @param {[string, number][]} offered */
  const chip = (field, one, many, title, offered) => {
    const notField = /** @type {'notTags'|'notTodos'|'notCategories'} */ ({ tags: 'notTags', todos: 'notTodos', categories: 'notCategories' }[field]);
    const shown = filter[field];
    const hidden = filter[notField] || (filter[notField] = []);
    const allMode = field === 'tags' && !!filter.tagsAll;
    const active = shown.length > 0 || hidden.length > 0;
    const open = () => {
      const modeNow = shown.length === 0 && hidden.length > 0 ? 'none' : allMode ? 'all' : 'any';
      const current = modeNow === 'none' ? hidden : shown;
      // keep a chosen value on offer even when the items in view no longer carry it, so it can still be unchecked
      const known = new Set(offered.map(([v]) => v));
      const all = [...offered, .../** @type {[string, number][]} */ (current.filter((v) => !known.has(v)).map((v) => [v, 0]))];
      /** @type {[string, string][]} */ const modes = field === 'tags' ? [['any', MODE_LABELS.any], ['all', MODE_LABELS.all], ['none', MODE_LABELS.none]] : [['any', MODE_LABELS.any], ['none', MODE_LABELS.none]];
      openChoiceSheet({
        title,
        choices: all,
        selected: current,
        modes,
        mode: modeNow,
        onApply: (values, mode, cleared) => {
          if (cleared) {
            filter[field] = [];
            filter[notField] = [];
            if (field === 'tags') filter.tagsAll = false;
          } else {
            if (mode !== modeNow) {
              if (modeNow === 'none') filter[notField] = [];
              else filter[field] = [];
            }
            if (mode === 'none') filter[notField] = values;
            else filter[field] = values;
            if (field === 'tags') filter.tagsAll = mode === 'all';
          }
          onChange();
        },
      });
    };
    const clearIt = () => {
      filter[field] = [];
      filter[notField] = [];
      if (field === 'tags') filter.tagsAll = false;
    };
    return shell(modeChipText(shown, hidden, one, many, allMode), title, active, open, clearIt);
  };

  row.appendChild(chip('tags', 'Tag', 'Tags', 'Tags', choices.tags));
  row.appendChild(chip('todos', 'State', 'States', 'TODO states', choices.todos));
  row.appendChild(chip('categories', 'Category', 'Categories', 'Categories', choices.categories));
  for (const extra of extraChips) row.appendChild(extra);

  if (!compact) {
    // Search: a regular expression the row's text (keyword, title, tags) must match, or must not (Emacs's = filter)
    const regexps = filter.regexps || (filter.regexps = []);
    const notRegexps = filter.notRegexps || (filter.notRegexps = []);
    const searchText = regexps.length + notRegexps.length === 0 ? 'Search ▾' : regexps.length + notRegexps.length > 1 ? `Search: ${regexps.length + notRegexps.length}` : `Search: ${regexps[0] || 'not ' + notRegexps[0]}`;
    row.appendChild(
      shell(
        searchText,
        'text',
        regexps.length + notRegexps.length > 0,
        () => {
          /** @type {HTMLInputElement} */ let input;
          /** @type {HTMLInputElement} */ let hide;
          openFormSheet({
            title: 'Search the rows',
            subtitle: 'A regular expression, not case sensitive, matched against the keyword, title and tags.',
            submitLabel: 'Apply',
            build: (panel) => {
              input = document.createElement('input');
              input.type = 'text';
              input.setAttribute('autocapitalize', 'off');
              input.setAttribute('aria-label', 'Regular expression');
              input.value = regexps[0] ?? notRegexps[0] ?? '';
              input.style.cssText = 'width:100%;min-height:var(--target);font-size:var(--text-body);box-sizing:border-box;';
              const label = document.createElement('label');
              label.style.cssText = 'display:flex;align-items:center;gap:12px;min-height:var(--target);font-size:var(--text-body);';
              hide = document.createElement('input');
              hide.type = 'checkbox';
              hide.checked = regexps.length === 0 && notRegexps.length > 0;
              hide.style.cssText = 'width:22px;height:22px;';
              label.append(hide, document.createTextNode('Hide the rows that match instead'));
              panel.append(input, label);
              input.focus();
            },
            onSubmit: () => {
              const text = input.value.trim();
              if (text !== '' && filterRegexp(text) === null) {
                setStatus('Not a valid Emacs regular expression \u2014 filter not changed.');
                return false;
              }
              filter.regexps = text && !hide.checked ? [text] : [];
              filter.notRegexps = text && hide.checked ? [text] : [];
              onChange();
            },
          });
        },
        () => {
          filter.regexps = [];
          filter.notRegexps = [];
        }
      )
    );

    // Top heading: only the items under the chosen top-level headings (Emacs's ^ filter)
    const tops = filter.tops || (filter.tops = []);
    row.appendChild(
      shell(
        chipText(tops, 'Top heading', 'Top headings'),
        'top-level heading',
        tops.length > 0,
        () => {
          const known = new Set(choices.tops.map(([v]) => v));
          const all = [...choices.tops, .../** @type {[string, number][]} */ (tops.filter((v) => !known.has(v)).map((v) => [v, 0]))];
          openChoiceSheet({
            title: 'Top-level headings',
            choices: all,
            selected: tops,
            onApply: (values) => {
              filter.tops = values;
              onChange();
            },
          });
        },
        () => {
          filter.tops = [];
        }
      )
    );
  }
  return row;
}

/** The items that pass the chosen filter. */
export function filterItemsForView(/** @type {any[]} */ items, /** @type {import('../src/tag-inheritance.js').AgendaViewType} */ view = 'agenda', compact = false) {
  addFilterTags(items, view);
  // a compact row has no Search or Top headings chip, so a text or heading filter set in another view must not hide rows here
  const filter = compact && S.viewFilter ? { ...S.viewFilter, regexps: [], notRegexps: [], tops: [] } : S.viewFilter;
  return applyViewFilter(items, filter);
}

export { viewFilterActive };
