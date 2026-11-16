// @ts-check
/**
 * Folding in the Text view's Emacs mode, on the app's own fold model: TAB, S-TAB and C-c C-r change the same per-heading flags the outline
 * does (src/fold-state.js, src/context-reveal.js), and the text shows what those flags hide. The text is parsed when a command needs it.
 */
import { parseOrg } from '../src/org-parser.js';
import { applyStartupVisibility, captureFolds, cycleFoldLevel, restoreFolds } from '../src/fold-state.js';
import { showContext } from '../src/context-reveal.js';
import { getCycleOpenArchivedTrees } from '../src/local-variables.js';
import { flatHeadings, headings, hiddenRanges, syncFlags } from '../src/org-fold.js';
import { S } from './app-state.js';
import { cycleGlobalFolds } from './fold-commands.js';

/**
 * @param {HTMLTextAreaElement} textarea  the folding textarea (src-browser/fold-textarea.js)
 * @param {{ setHidden: (hidden: Array<[number, number]>) => void, hidden: () => Array<[number, number]> }} facade
 */
export function textFolds(textarea, facade) {
  /** @type {import('../src/types.js').Doc | null} */
  let doc = null;
  let docText = '';
  /** The document as the text is now, with the folds it had. */
  function current() {
    const text = textarea.value;
    if (doc && docText === text) return doc;
    const next = parseOrg(text);
    const before = doc ?? S.state.doc;
    if (before) restoreFolds(next, captureFolds(before));
    doc = next;
    docText = text;
    return next;
  }
  /** @param {import('../src/types.js').Doc} d */
  function publish(d) {
    if (S.state.doc) restoreFolds(S.state.doc, captureFolds(d)); // the outline shows the same folds
    facade.setHidden(hiddenRanges(textarea.value, d));
  }
  const archive = () => (getCycleOpenArchivedTrees(S.state.localVariables) ? 'noarchived' : 'archived');
  return {
    /** The text opens as the outline is: folded by #+STARTUP, or as it was left. */
    start() {
      publish(current());
    },
    /**
     * @param {string} command `org-cycle`, `org-shifttab` or `org-fold-reveal`
     * @param {number} pos @param {{ n: number, universal: boolean } | undefined} prefix
     * @returns {{ handled: boolean, msg: string }}
     */
    run(command, pos, prefix) {
      const text = textarea.value;
      const d = current();
      syncFlags(text, d, facade.hidden());
      const flat = flatHeadings(d);
      const lines = headings(text);
      if (flat.length !== lines.length) return { handled: false, msg: '' };
      const here = lines.filter((h) => h.start <= pos).length - 1; // the heading the entry of point belongs to
      const onLine = here >= 0 && pos <= lines[here].eol;
      let msg = '';
      if (command === 'org-shifttab' || (command === 'org-cycle' && prefix?.universal)) {
        if (command === 'org-shifttab' && prefix && !prefix.universal) {
          const n = prefix.n;
          applyStartupVisibility(d, { visibility: n <= 1 ? 'overview' : n <= 5 ? `show${n}levels` : 'content' }, archive());
          S.lastGlobalFoldState = 'showeverything'; // the next S-TAB gives the overview
          msg = `Content view to level: ${n}`;
        } else msg = cycleGlobalFolds(d) === 'overview' ? 'OVERVIEW' : 'SHOW ALL';
      } else if (command === 'org-cycle') {
        if (!onLine) return { handled: false, msg: '' };
        const state = cycleFoldLevel(flat[here], { archiveVisibility: archive() });
        msg = state === 'children' ? 'CHILDREN' : state === 'full' ? 'SUBTREE' : 'FOLDED';
      } else if (command === 'org-fold-reveal') {
        if (here < 0) return { handled: true, msg: '' };
        showContext(d, flat[here], prefix?.universal ? 'canonical' : 'lineage', onLine);
      }
      publish(d);
      return { handled: true, msg };
    },
  };
}
