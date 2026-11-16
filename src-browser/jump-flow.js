// @ts-check
// C-c C-j (org-goto) and C-c C-r (org-reveal): jump to a heading of this file by its outline path, and open the outline around a heading.
import { findAncestorPath } from '../src/archive-model.js';
import { showContext } from '../src/context-reveal.js';
import { expandFully } from '../src/fold-state.js';
import { S } from './app-state.js';
import { setStatus } from './editing.js';
import { readFromMinibuffer } from './minibuffer-prompt.js';
import { navigateToHeading } from './navigation.js';
import { render } from './render.js';
import { markRingPush } from './text-commands-flow.js';

/** @typedef {import('../src/types.js').Heading} Heading */

/** org-goto (C-c C-j) with the completion interface (`outline-path-completion`): asks for an outline path, then goes there. */
export async function gotoCommand() {
  const doc = S.state.doc;
  if (!doc) return;
  const max = Number.parseInt(S.state.localVariables['org-goto-max-level'] ?? '5', 10) || 5; // org-goto-max-level
  /** @type {Map<string, Heading>} */
  const paths = new Map();
  /** @param {Heading[]} list @param {string[]} above */
  const walk = (list, above) => {
    for (const heading of list) {
      const path = [...above, heading.title];
      if (heading.level <= max) {
        if (!paths.has(path.join('/'))) paths.set(path.join('/'), heading);
        walk(heading.children, path);
      }
    }
  };
  walk(doc.children, []);
  S.godModeActive = false; // the minibuffer is about to ask a question
  const answer = await readFromMinibuffer('Goto: ', '', [...paths.keys()]);
  if (answer === null) return setStatus('Quit');
  const heading = paths.get(answer.trim());
  if (!heading) return setStatus('Invalid target location');
  markRingPush();
  navigateToHeading(heading, { context: 'org-goto' });
}

/**
 * org-reveal (C-c C-r): opens the outline around the focused heading, as lineage; `C-u` also shows the entries on the way (canonical);
 * `C-u C-u` goes to the parent and shows its whole tree.
 * @param {Heading | null} heading @param {number} [prefix] 1, 4 or 16
 */
export function revealCommand(heading, prefix = 1) {
  const doc = S.state.doc;
  if (!doc || !heading) return;
  if (prefix === 16) {
    const parent = (findAncestorPath(doc, heading) || []).pop();
    if (parent) expandFully(parent);
  } else showContext(doc, heading, prefix === 4 ? 'canonical' : 'lineage');
  render();
}
