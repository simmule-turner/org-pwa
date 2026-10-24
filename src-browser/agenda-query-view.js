// @ts-check
// The Agenda's Match view (org-tags-view: `m`, and `M` for the unfinished TODO entries) and Search view (org-search-view: `s`), and the
// saved queries of org-agenda-custom-commands. The rows come from src/agenda-queries.js; here are the query box, the chips and the
// sheets. The Search panel stays the quick finder and can open its query here.
import { applyAgendaEffortView } from '../src/agenda.js';
import { parseCustomCommands, withCustomCommand } from '../src/agenda-commands.js';
import { entrySearchText, planSearch } from '../src/agenda-search.js';
import { matchViewItems, searchViewItems } from '../src/agenda-queries.js';
import { getAgendaSkipArchivedTrees, getAgendaSkipCommentTrees, getUsePropertyInheritance, getUseTagInheritance } from '../src/local-variables.js';
import { resolveTodoSequence } from '../src/todo-cycle.js';
import { aggregateAgendaDocs, aggregateSearchDocs, ensureAgendaFilesLoaded, ensureSearchExtraFilesLoaded } from './agenda-files.js';
import { buildHeadingRow, buildTodoEffortChip } from './agenda-view.js';
import { seedAgendaDefaults } from './agenda-seed.js';
import { S } from './app-state.js';
import { openContentSheet, openFormSheet } from './bottom-sheet.js';
import { GLOBAL_TODO_DEFAULT } from './constants.js';
import { outlineEl } from './dom.js';
import { setStatus } from './editing.js';
import { render } from './render.js';
import { commitGlobalVariableChange } from './settings-quick.js';
import { textInputStyle } from './ui-widgets.js';
import { buildViewFilterRow, filterItemsForView } from './view-filter-ui.js';
import { switchToView } from './views.js';

/** @typedef {{ kind: 'tags' | 'search', query: string, todoOnly: boolean, sortingStrategy: string | null, title: string, focusInput?: boolean }} QueryViewState */

const VARIABLE = 'org-agenda-custom-commands';
const GRAMMAR = 'Words: a phrase, or +word -word "a phrase" {regexp}. Start with * for headlines only, ! for TODO entries, : for whole words.';
const MATCH_HELP = 'Tags, properties and TODO state: work+urgent|blocked, Effort<"1:00", /TODO|NEXT. M lists only unfinished TODO entries.';

/** @returns {QueryViewState} */
function state() {
  const existing = /** @type {QueryViewState | undefined} */ (S.queryView);
  if (existing) return existing;
  const fresh = { kind: /** @type {'tags'} */ ('tags'), query: '', todoOnly: false, sortingStrategy: null, title: '', focusInput: true };
  S.queryView = fresh;
  return fresh;
}

/**
 * Shows the Match (`tags`) or Search (`search`) view with this query.
 * @param {'tags' | 'search'} kind
 * @param {{ query?: string, todoOnly?: boolean, sortingStrategy?: string | null, title?: string }} [options]
 */
export function openQueryView(kind, options = {}) {
  S.queryView = { kind, query: options.query ?? '', todoOnly: !!options.todoOnly, sortingStrategy: options.sortingStrategy ?? null, title: options.title ?? '', focusInput: true };
  const view = kind === 'tags' ? 'match' : 'searchview';
  if (S.currentView === view) render();
  else switchToView(view);
}

/** What the queries need of the settings and the open files. */
function queryOptions() {
  const vars = S.state.localVariables;
  const sequence = resolveTodoSequence(S.state.doc, GLOBAL_TODO_DEFAULT);
  const truthy = (/** @type {string | undefined} */ v) => !!v && v.trim() !== 'nil' && v.trim() !== '';
  return {
    skipArchived: getAgendaSkipArchivedTrees(vars),
    skipCommented: getAgendaSkipCommentTrees(vars),
    doneKeywords: sequence.doneKeywords,
    todoKeywords: sequence.todoKeywords,
    tagInheritance: getUseTagInheritance(vars),
    propertyInheritance: getUsePropertyInheritance(vars),
    sortingStrategy: vars['org-agenda-sorting-strategy'] || null,
    localVariables: vars,
    documentOrder: aggregateAgendaDocs().map((d) => d.documentId),
    alwaysBoolean: truthy(vars['org-agenda-search-view-always-boolean']),
    forceFullWords: truthy(vars['org-agenda-search-view-force-full-words']),
  };
}

/** A line of the entry's text that holds a match, for a row whose title has none.
 * @param {import('../src/types.js').Heading} heading @param {RegExp[]} patterns */
function snippetFor(heading, patterns) {
  if (!patterns.length || patterns.every((re) => re.test(heading.title))) return null;
  for (const line of entrySearchText(heading).split('\n').slice(1)) {
    const text = line.trim();
    if (text && !/^:[A-Za-z_]+:/.test(text) && patterns.some((re) => re.test(text))) return text.length > 90 ? text.slice(0, 89) + '…' : text;
  }
  return null;
}

export function renderQueryView() {
  seedAgendaDefaults();
  ensureAgendaFilesLoaded();
  let q = state();
  const wanted = S.currentView === 'searchview' ? 'search' : 'tags';
  if (q.kind !== wanted) {
    // arrived from the View menu rather than from openQueryView: start a fresh query of this kind
    q = { kind: wanted, query: '', todoOnly: false, sortingStrategy: null, title: '', focusInput: true };
    S.queryView = q;
  }
  if (q.kind === 'search') ensureSearchExtraFilesLoaded();
  const isMatch = q.kind === 'tags';
  outlineEl.innerHTML = '';
  const container = document.createElement('div');
  container.style.padding = '8px 12px';

  const title = document.createElement('h2');
  title.textContent = isMatch ? 'Match tags and state' : 'Keyword search';
  title.setAttribute('data-query-title', '');
  title.style.cssText = 'margin:4px 0 10px;font-size:20px;font-weight:700;';
  container.appendChild(title);

  // the query on a line of its own, full width; Commands and Save… under it, with TODO only (Match) at the right
  const input = document.createElement('input');
  input.type = 'text';
  input.value = q.query;
  input.placeholder = isMatch ? 'work+urgent|blocked/TODO' : 'budget -draft, "Q4 plan", {regexp}';
  input.setAttribute('aria-label', isMatch ? 'Tags match' : 'Search words');
  input.setAttribute('data-query-input', '');
  input.autocapitalize = 'off';
  input.autocomplete = 'off';
  input.spellcheck = false;
  textInputStyle(input);
  input.style.fontFamily = 'ui-monospace, Menlo, monospace';
  input.style.display = 'block';
  input.style.width = '100%';
  input.style.boxSizing = 'border-box';
  input.style.marginBottom = '8px';
  container.appendChild(input);

  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:8px;';
  /** @param {string} label @param {string} aria @param {() => void} onClick */
  const chip = (label, aria, onClick) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.setAttribute('aria-label', aria);
    b.style.cssText = 'min-height:44px;padding:0 16px;font-size:15px;white-space:nowrap;';
    b.onclick = onClick;
    return b;
  };
  actions.appendChild(chip('Commands', 'Agenda commands', () => openAgendaCommands()));
  actions.appendChild(chip('Save…', 'Save this query as an agenda command', () => saveQueryAsCommand(q.kind, q.query, q.todoOnly)));
  if (isMatch) {
    const label = document.createElement('label');
    label.style.cssText = 'margin-left:auto;display:flex;align-items:center;gap:8px;min-height:44px;font-size:14px;white-space:nowrap;';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = q.todoOnly;
    box.style.cssText = 'width:22px;height:22px;margin:0;';
    box.setAttribute('aria-label', 'List only the unfinished TODO entries');
    box.onchange = () => {
      q.todoOnly = box.checked;
      render();
    };
    label.append(box, document.createTextNode('TODO only'));
    actions.appendChild(label);
  }
  container.appendChild(actions);

  const heading = document.createElement('div');
  heading.style.cssText = 'font-size:12px;opacity:0.7;margin-bottom:8px;line-height:1.4;';
  heading.textContent = q.title ? `${q.title}: ` : '';
  const caption = document.createElement('span');
  caption.textContent = isMatch ? (q.todoOnly ? 'TODO entries with TAGS match' : 'Headlines with TAGS match') : 'Search words';
  heading.appendChild(caption);
  container.appendChild(heading);

  const results = document.createElement('div');
  results.setAttribute('data-query-results', '');
  container.appendChild(results);
  outlineEl.appendChild(container);

  function fill() {
    results.innerHTML = '';
    const note = (/** @type {string} */ text, error = false) => {
      const el = document.createElement('div');
      el.style.cssText = 'font-size:13px;padding:12px 2px;line-height:1.4;' + (error ? 'color:#c0392b;' : 'opacity:0.65;');
      el.textContent = text;
      results.appendChild(el);
    };
    if (!/\S/.test(q.query) && !isMatch) return note(GRAMMAR);
    if (!/\S/.test(q.query) && isMatch) return note(MATCH_HELP);
    const options = { ...queryOptions(), todoOnly: q.todoOnly };
    if (q.sortingStrategy) options.sortingStrategy = q.sortingStrategy;
    let items;
    try {
      items = isMatch ? matchViewItems(aggregateAgendaDocs(), q.query, options) : searchViewItems(aggregateSearchDocs(), q.query, options);
    } catch (err) {
      return note(String(/** @type {Error} */ (err).message || err), true);
    }
    /** @type {RegExp[]} */ let patterns = [];
    if (!isMatch) {
      try {
        patterns = planSearch(q.query, options).positives.filter((re) => re.source !== '(?:)');
      } catch {
        patterns = [];
      }
    }
    results.appendChild(buildViewFilterRow(items, fill, [buildTodoEffortChip()], isMatch ? 'todo' : 'search', true));
    const shown = filterItemsForView(items, isMatch ? 'todo' : 'search', true);
    const rows = S.agendaEffortFilter ? applyAgendaEffortView(shown, { filter: S.agendaEffortFilter }) : shown;
    const count = document.createElement('div');
    count.setAttribute('data-query-count', '');
    count.style.cssText = 'font-size:12px;opacity:0.65;margin:6px 2px;';
    count.textContent = rows.length === 1 ? '1 entry' : `${rows.length} entries`;
    results.appendChild(count);
    if (rows.length === 0) return note('Nothing matches.');
    const today = new Date();
    for (const item of rows) {
      const heading = /** @type {import('../src/types.js').Heading} */ (item.heading);
      results.appendChild(buildHeadingRow(item, today, isMatch ? 'tags' : 'search', isMatch ? {} : { highlight: patterns, snippet: snippetFor(heading, patterns) }));
    }
  }

  let timer = 0;
  input.oninput = () => {
    q.query = input.value;
    clearTimeout(timer);
    timer = window.setTimeout(fill, 150);
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') {
      clearTimeout(timer);
      fill();
      input.blur();
    }
  };
  fill();
  if (q.focusInput) {
    q.focusInput = false;
    if (!q.query) input.focus();
  }
}

/** The sheet of agenda commands: the built-in views and the ones in org-agenda-custom-commands. */
export function openAgendaCommands() {
  const commands = parseCustomCommands(S.state.localVariables[VARIABLE]);
  /** @type {() => void} */ let close = () => {};
  close = openContentSheet({
    title: 'Agenda commands',
    build: (panel) => {
      /** @param {string} key @param {string} name @param {string} detail @param {() => void} run */
      const row = (key, name, detail, run) => {
        const b = document.createElement('button');
        b.style.cssText = 'display:flex;gap:12px;align-items:center;width:100%;min-height:52px;text-align:left;padding:6px 8px;';
        const k = document.createElement('span');
        k.textContent = key;
        k.style.cssText = 'min-width:28px;text-align:center;font:700 15px ui-monospace,Menlo,monospace;border:1px solid var(--border-strong);border-radius:8px;padding:4px 0;';
        const t = document.createElement('span');
        t.textContent = name;
        b.append(k, t);
        if (detail) {
          const d = document.createElement('span');
          d.textContent = detail;
          d.style.cssText = 'margin-left:auto;font:12px ui-monospace,Menlo,monospace;opacity:0.65;';
          b.appendChild(d);
        }
        b.onclick = () => {
          close();
          run();
        };
        panel.appendChild(b);
      };
      /** @param {string} text */
      const group = (text) => {
        const g = document.createElement('div');
        g.textContent = text;
        g.style.cssText = 'font-size:12px;font-weight:700;opacity:0.6;margin:12px 4px 4px;text-transform:uppercase;letter-spacing:.04em;';
        panel.appendChild(g);
      };
      group('Built in');
      row('a', 'Agenda', '', () => switchToView('agenda'));
      row('t', 'Global TODO list', '', () => switchToView('tasklist'));
      row('m', 'Match a tags, property or TODO query', '', () => openQueryView('tags'));
      row('s', 'Search for keywords', '', () => openQueryView('search'));
      group(`Yours · ${VARIABLE}`);
      if (commands.length === 0) {
        const none = document.createElement('div');
        none.style.cssText = 'font-size:13px;opacity:0.65;padding:6px 8px;line-height:1.4;';
        none.textContent = 'None yet. Search or Match, then Save… to keep a query under a key.';
        panel.appendChild(none);
      }
      for (const c of commands) row(c.key, c.description || c.query, c.query, () => runCommand(c));
    },
  });
}

/** @param {import('../src/agenda-commands.js').CustomCommand} c */
export function runCommand(c) {
  if (c.type === 'agenda') return switchToView('agenda');
  if (c.type === 'alltodo') return switchToView('tasklist');
  openQueryView(c.type === 'search' ? 'search' : 'tags', { query: c.query, todoOnly: c.type === 'tags-todo', sortingStrategy: c.sortingStrategy, title: c.description });
}

/**
 * Asks for a key and a name, then adds the query to org-agenda-custom-commands (the app-wide variable).
 * @param {'tags' | 'search'} kind
 * @param {string} query
 * @param {boolean} todoOnly
 */
export function saveQueryAsCommand(kind, query, todoOnly) {
  if (!/\S/.test(query)) {
    setStatus('Type a query first.');
    return;
  }
  /** @type {HTMLInputElement} */ let key;
  /** @type {HTMLInputElement} */ let name;
  /** @type {HTMLElement} */ let problem;
  openFormSheet({
    title: 'Save as agenda command',
    subtitle: `${kind === 'tags' ? (todoOnly ? 'tags-todo' : 'tags') : 'search'}: ${query}`,
    submitLabel: 'Save',
    build: (panel) => {
      /** @param {string} label @param {string} value @param {string} hint */
      const field = (label, value, hint) => {
        const l = document.createElement('label');
        l.textContent = label;
        l.style.cssText = 'display:block;font-size:13px;margin:8px 0 4px;';
        const i = document.createElement('input');
        i.type = 'text';
        i.value = value;
        i.placeholder = hint;
        i.autocapitalize = 'off';
        textInputStyle(i);
        panel.append(l, i);
        return i;
      };
      key = field('Key (one or more letters, as in the C-c a dispatcher)', '', 'w');
      name = field('Name', '', 'Urgent work');
      problem = document.createElement('div');
      problem.style.cssText = 'color:#c0392b;font-size:13px;margin-top:6px;';
      panel.appendChild(problem);
    },
    onSubmit: async () => {
      const k = key.value.trim();
      if (!k) {
        problem.textContent = 'A command needs a key.';
        return false;
      }
      const taken = ['a', 't', 'm', 'M', 's', 'S'].includes(k);
      if (taken) {
        problem.textContent = `"${k}" is a built-in key.`;
        return false;
      }
      const text = withCustomCommand(S.state.localVariables[VARIABLE], {
        key: k,
        description: name.value.trim(),
        type: kind === 'search' ? 'search' : todoOnly ? 'tags-todo' : 'tags',
        query,
        sortingStrategy: null,
      });
      await commitGlobalVariableChange(VARIABLE, text);
      setStatus(`Saved as agenda command "${k}".`);
      return true;
    },
  });
}
