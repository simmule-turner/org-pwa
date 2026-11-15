// @ts-check
// The outline editing commands Org binds to M-left, M-right, C-c ;, C-c ^ on a heading, and org-insert-property-drawer: promote or demote
// one heading, toggle COMMENT, sort the children (or the top-level entries), insert a property drawer.
import { S } from './app-state.js';
import { commitAndRender, setStatus } from './editing.js';
import { openGridChoiceModal, promptText } from './dialogs.js';
import { render } from './render.js';
import { demoteHeading, demoteHeadingOnly, insertPropertyDrawer, promoteHeading, promoteHeadingOnly, toggleComment } from '../src/heading-edit.js';
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
  const kinds = [['a', 'Alphabetic'], ['n', 'Numeric'], ['p', 'Priority'], ['o', 'TODO order'], ['t', 'Time'], ['s', 'Scheduled'], ['d', 'Deadline'], ['c', 'Created'], ['r', 'Property…'], ['f', 'Function…']];
  openGridChoiceModal({
    label: `Sort ${what}: [a]lpha [n]umeric [p]riority p[r]operty todo[o]rder [f]unc [t]ime [s]cheduled [d]eadline [c]reated. A/N/P/R/O/F/T/S/D/C means reversed:`,
    buttons: kinds.flatMap(([key, text]) => [false, true].map((reversed) => {
      const type = reversed ? key.toUpperCase() : key;
      const onClick = key === 'r' ? byProperty(type) : key === 'f' ? byFunction(type) : () => run(type);
      return { key: type, text: reversed ? `${text.replace('…', '')}, reversed${text.endsWith('…') ? '…' : ''}` : text, onClick };
    })),
  });
}
