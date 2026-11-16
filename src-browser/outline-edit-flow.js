// @ts-check
// The outline editing commands Org binds to M-left, M-right, C-c ;, C-c ^ on a heading, and org-insert-property-drawer: promote or demote
// one heading, toggle COMMENT, sort the children (or the top-level entries), insert a property drawer.
import { S } from './app-state.js';
import { commitAndRender, setStatus } from './editing.js';
import { openGridChoiceModal, promptText } from './dialogs.js';
import { render } from './render.js';
import { demoteHeading, demoteHeadingOnly, demoteInlineTask, elementRange, insertDrawerIn, insertInlineTask, insertPropertyDrawer, insertStructureTemplateIn, promoteHeading, promoteHeadingOnly, promoteInlineTask, toggleComment } from '../src/heading-edit.js';
import { inlineTaskDefaultState, inlineTaskLevel } from '../src/inline-tasks.js';
import { readStructureTemplates } from '../src/structure-template.js';
import { toggleHeading } from '../src/text-commands.js';
import { headingLineIndex, serializeOrg } from '../src/org-parser.js';
import { replaceDocText } from '../src/archive-text.js';
import { headingAtLine } from './text-commands-flow.js';
import { readFromMinibuffer } from './minibuffer-prompt.js';
import { sortEntries } from '../src/outline-sort.js';
import { readFunction } from '../src/table-sort-lisp.js';
import { readPriorityRange } from '../src/priorities.js';

/** @typedef {import('../src/types.js').Heading} Heading */

/** @param {Heading | null | undefined} target */
const headingOf = (target) => target || S.keyboardFocusedHeading || null;

/** org-promote and org-demote: the heading alone changes level.
 * @param {'promote' | 'demote'} way @param {Heading | null} [target] */
export function shiftHeadingOnly(way, target) {
  const heading = headingOf(target);
  if (!heading || !S.state.doc) return;
  const min = inlineTaskLevel();
  if (min !== null && heading.level >= min) {
    // org-metaleft and org-metaright on an inline task: the task and its END line move together
    const { error } = /** @type {{ error: string | null }} */ ((way === 'promote' ? promoteInlineTask : demoteInlineTask)(S.state.doc, heading));
    if (error) setStatus(error);
    else commitAndRender(way === 'promote' ? 'Promoted inline task' : 'Demoted inline task');
    return;
  }
  const ok = (way === 'promote' ? promoteHeadingOnly : demoteHeadingOnly)(S.state.doc, heading);
  if (ok) commitAndRender(way === 'promote' ? 'Promoted heading' : 'Demoted heading');
  else setStatus('Cannot promote to level 0.  UNDO to recover if necessary');
}

/** org-promote-subtree and org-demote-subtree.
 * @param {'promote' | 'demote'} way @param {Heading | null} [target] */
export function shiftSubtree(way, target) {
  const heading = headingOf(target);
  if (!heading || !S.state.doc) return;
  if ((way === 'promote' ? promoteHeading : demoteHeading)(S.state.doc, heading)) commitAndRender(way === 'promote' ? 'Promoted subtree' : 'Demoted subtree');
  else setStatus(way === 'promote' ? "Already top-level — can't promote further." : 'No preceding sibling to demote under.');
}

/** org-inlinetask-insert-task (C-c C-x t): an inline task under the focused heading's text. @param {Heading | null} [target] @param {boolean} [noState] */
export function insertInlineTaskCommand(target, noState = false) {
  const heading = headingOf(target);
  if (!heading || !S.state.doc) return;
  const { error } = /** @type {{ error: string | null }} */ (insertInlineTask(S.state.doc, heading, noState ? null : inlineTaskDefaultState()));
  if (error) setStatus(error);
  else commitAndRender('Inserted inline task');
}

/** org-toggle-comment. @param {Heading | null} [target] */
export function toggleCommentCommand(target) {
  const heading = headingOf(target);
  if (!heading || !S.state.doc) return;
  toggleComment(heading);
  commitAndRender('Toggled COMMENT');
}

/** org-insert-property-drawer. @param {Heading | null} [target] */
export function insertPropertyDrawerCommand(target) {
  const heading = headingOf(target);
  if (!heading || !S.state.doc) return;
  if (insertPropertyDrawer(S.state.doc, heading)) commitAndRender('Inserted property drawer');
  else setStatus('This entry already has a property drawer.');
}

/**
 * org-sort-entries: asks the way Emacs does (one key for the kind of sort, a capital for reversed), then sorts the children of the heading,
 * or the top-level entries when there is none.
 * @param {Heading | null} [target] @param {boolean} [withCase]
 */
export function askSortEntries(target, withCase = false) {
  const doc = S.state.doc;
  if (!doc) return;
  const heading = headingOf(target);
  const what = heading ? 'children' : 'top-level';
  /** @param {string} type @param {import('../src/outline-sort.js').SortOptions} [extra] */
  const run = (type, extra = {}) => {
    try {
      if (heading) heading.collapsed = false; // org-fold-show-subtree
      sortEntries(doc, heading, type, { withCase, priorityDefault: readPriorityRange(S.state.localVariables).default, ...extra });
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
      render();
      return;
    }
    commitAndRender('Sorted entries');
  };
  const byProperty = (/** @type {string} */ type) => async () => {
    const property = await promptText('Property:', '', { okLabel: 'Sort' });
    if (property === null || property === '') return;
    run(type, { property, propertyOf: (h, name) => h.properties[name] ?? null });
  };
  const byFunction = (/** @type {string} */ type) => async () => {
    const keyName = await promptText('Function for extracting keys:', '', { okLabel: 'Next' });
    if (keyName === null) return;
    const key = readFunction(keyName, false);
    if ('error' in key) {
      setStatus(key.error);
      render();
      return;
    }
    const compareName = await promptText("Function for comparing keys (empty for default `sort-subr' predicate):", '', { okLabel: 'Sort' });
    if (compareName === null) return;
    const compare = readFunction(compareName, true);
    if ('error' in compare) {
      setStatus(compare.error);
      render();
      return;
    }
    run(type, { keyFn: /** @type {import('../src/elisp-data.js').LObj} */ (key.fn), compareFn: compare.fn });
  };
  /** @type {[string, string][]} */
  const kinds = [['a', 'Alphabetic'], ['n', 'Numeric'], ['p', 'Priority'], ['o', 'TODO order'], ['t', 'Time'], ['s', 'Scheduled'], ['d', 'Deadline'], ['c', 'Created'], ['k', 'Clocking'], ['r', 'Property…'], ['f', 'Function…']];
  openGridChoiceModal({
    label: `Sort ${what}: [a]lpha [n]umeric [p]riority p[r]operty todo[o]rder [f]unc [t]ime [s]cheduled [d]eadline [c]reated cloc[k]ing. A/N/P/R/O/F/T/S/D/C/K means reversed:`,
    buttons: kinds.flatMap(([key, text]) => [false, true].map((reversed) => {
      const type = reversed ? key.toUpperCase() : key;
      const onClick = key === 'r' ? byProperty(type) : key === 'f' ? byFunction(type) : () => run(type);
      return { key: type, text: reversed ? `${text.replace('…', '')}, reversed${text.endsWith('…') ? '…' : ''}` : text, onClick };
    })),
  });
}

/** The lines of the focused paragraph, list item, table or block, for a block or drawer to wrap; null when no such row is focused.
 * @param {Heading} heading */
function focusedElementRange(heading) {
  const row = S.keyboardFocusedBodyRow;
  if (!row || row.heading !== heading) return null;
  return elementRange(heading, row.rowType === 'list-item' ? row.item : row.node);
}

/**
 * org-insert-structure-template (C-c C-,): asks for a key of org-structure-template-alist (or any block type), then wraps the focused
 * element in that block, or adds an empty block after the heading's text.
 * @param {Heading | null} [target]
 */
export async function insertStructureTemplateCommand(target) {
  const heading = headingOf(target);
  if (!heading || !S.state.doc) return;
  const templates = readStructureTemplates(S.state.localVariables['org-structure-template-alist']);
  const answer = await readFromMinibuffer('Select a key (or type a block type): ', '', templates.map(([key, type]) => `${key} ${type}`));
  if (answer === null || answer.trim() === '') return;
  const typed = answer.trim();
  const type = templates.find(([key]) => key === typed)?.[1] ?? templates.find(([key, name]) => `${key} ${name}` === typed)?.[1] ?? typed;
  let language = '';
  if (/^(src|export)$/.test(type)) {
    const asked = await readFromMinibuffer(type === 'src' ? 'Language: ' : 'Export backend: ');
    if (asked === null) return;
    language = asked.trim();
  }
  insertStructureTemplateIn(S.state.doc, heading, type, focusedElementRange(heading), language);
  commitAndRender(`Inserted ${type} block`);
}

/**
 * org-insert-drawer (C-c C-x d): asks for the drawer's name, then wraps the focused element in it, or adds an empty drawer after the heading's text.
 * @param {Heading | null} [target]
 */
export async function insertDrawerCommand(target) {
  const heading = headingOf(target);
  if (!heading || !S.state.doc) return;
  const name = await readFromMinibuffer('Drawer: ');
  if (name === null) return;
  if (!/^[\w-]+$/.test(name)) {
    setStatus('Invalid drawer name');
    return;
  }
  insertDrawerIn(S.state.doc, heading, name, focusedElementRange(heading));
  commitAndRender(`Inserted ${name} drawer`);
}

/**
 * org-toggle-heading (C-c *) in the outline: the focused heading becomes plain text, or the focused paragraph or list item becomes a heading
 * one level below the entry it is in.
 * @param {Heading | null} [target]
 */
export function toggleHeadingCommand(target) {
  const heading = headingOf(target);
  const doc = S.state.doc;
  if (!heading || !doc) return;
  const range = focusedElementRange(heading);
  const at = headingLineIndex(doc).lines.get(heading);
  if (!at) return;
  const line = range ? at.line + 1 + range.from : at.line;
  const next = toggleHeading(serializeOrg(doc), line, line);
  if (next === null) {
    setStatus('Cannot toggle heading from here');
    return;
  }
  replaceDocText(doc, next);
  S.keyboardFocusedBodyRow = null;
  S.keyboardFocusedHeading = headingAtLine(doc, line);
  commitAndRender('Toggled heading');
}
