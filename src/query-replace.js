import { editParagraphText, editListItemText, setTableCell } from './body-edit.js';
import { renameHeading } from './heading-edit.js';

/** Walks `doc` in the same order search.js's own walkBodyForMatches
 *  does, collecting one accessor record per text-bearing node that can
 *  be safely written back to: { heading, type, label, getText, setText }.
 *  getText()/setText(newFullText) always operate on the CURRENT, full
 *  underlying text for that node -- re-read fresh each call, not
 *  snapshotted once, since an earlier replacement within the SAME node
 *  (a paragraph can contain more than one match) changes what the next
 *  getText() call sees. `label` is a short, human-readable description
 *  of where this text lives, for the replace prompt's own display. */
function collectReplaceTargets(doc) {
  const targets = [];

  function addHeading(heading) {
    targets.push({
      heading,
      type: 'heading',
      label: 'heading',
      getText: () => heading.title,
      setText: (t) => renameHeading(heading, t),
    });
    walkBody(heading, heading.body);
    for (const child of heading.children || []) addHeading(child);
  }

  function walkList(heading, items) {
    for (const item of items) {
      targets.push({
        heading,
        type: 'list-item',
        label: 'list item',
        getText: () => item.text,
        setText: (t) => editListItemText(heading, item, t),
      });
      for (const nested of item.children || []) walkList(heading, nested.items);
    }
  }

  function walkBody(heading, bodyNodes) {
    for (const node of bodyNodes || []) {
      if (node.type === 'paragraph') {
        targets.push({
          heading,
          type: 'paragraph',
          label: 'paragraph',
          getText: () => node.lines.join(' '),
          setText: (t) => editParagraphText(heading, node, t),
        });
      } else if (node.type === 'list') {
        walkList(heading, node.items);
      } else if (node.type === 'table') {
        node.rows.forEach((row, rowIndex) => {
          if (row.type !== 'row') return;
          row.cells.forEach((cellText, colIndex) => {
            targets.push({
              heading,
              type: 'table',
              label: 'table cell',
              getText: () => node.rows[rowIndex].cells[colIndex],
              setText: (t) => setTableCell(heading, node, rowIndex, colIndex, t),
            });
          });
        });
      }
      // Block content is deliberately skipped -- no dedicated setter
      // exists that safely preserves its own #+begin/#+end wrapper
      // lines, and guessing one risks corrupting the block's own
      // structure rather than just its content.
    }
  }

  for (const heading of doc.children || []) addHeading(heading);
  return targets;
}

/**
 * Drives an Emacs-style interactive query-replace over `doc`: finds
 * every occurrence of `re` (a global-flagged RegExp) across every
 * replace target in document order, offering one at a time via
 * `current()`, and advancing via `replace()` / `skip()` / `replaceAll()`
 * / `quit()` -- the same y/n/!/q vocabulary real Emacs's own
 * query-replace-regexp uses. `replacement` is the literal replacement
 * text; `$1`-`$9` within it refer to the match's own capture groups,
 * the same convention both Emacs and JS already share.
 *
 * State is NOT re-queried from the document on every step -- each
 * target's own getText()/setText() pair is called fresh every time,
 * so edits made through this walk are immediately visible to
 * subsequent matches within the same node, and safely isolated from
 * matches in every other node (each has its own, independent text).
 */
function createQueryReplace(doc, re, replacement) {
  let targetCount = collectReplaceTargets(doc).length;
  let targetIndex = 0;
  let searchFrom = 0; // position within the CURRENT target's own text to resume searching from
  let replacedCount = 0;
  let done = false;
  let pendingMatch = null; // { target, match } for the match currently awaiting a decision

  const globalRe = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');

  function findNext() {
    while (targetIndex < targetCount) {
      const target = collectReplaceTargets(doc)[targetIndex];
      const text = target.getText();
      globalRe.lastIndex = searchFrom;
      const m = globalRe.exec(text);
      if (m) {
        // A zero-length match (e.g. a pattern that can match nothing,
        // like `x*`) would otherwise loop forever at the same position
        // -- advancing by at least one character is what real Emacs's
        // own query-replace does too in this same situation.
        searchFrom = m.index + Math.max(m[0].length, 1);
        pendingMatch = { target, match: m, text };
        return pendingMatch;
      }
      targetIndex++;
      searchFrom = 0;
    }
    pendingMatch = null;
    done = true;
    return null;
  }

  function current() {
    if (done) return null;
    return pendingMatch || findNext();
  }

  function applyReplacement(target, match) {
    const text = target.getText();
    const replaced = replacement.replace(/\$(\d)/g, (_, n) => match[n] ?? '');
    const newText = text.slice(0, match.index) + replaced + text.slice(match.index + match[0].length);
    target.setText(newText);
    replacedCount++;
    // The replacement text can be a different length than what it
    // replaced -- resume searching right after the NEW text's own end,
    // not the old match's, so a replacement containing the pattern
    // itself doesn't get matched again immediately.
    searchFrom = match.index + replaced.length;
    pendingMatch = null;
  }

  return {
    /** The match currently awaiting a decision, or null if the walk is
     *  finished. Advances to the next match automatically the first
     *  time this is called after a decision was made. */
    current,
    /** Replaces the current match with `replacement` and advances. */
    replace() {
      const c = current();
      if (!c) return;
      applyReplacement(c.target, c.match);
    },
    /** Leaves the current match untouched and advances. */
    skip() {
      if (!current()) return;
      pendingMatch = null;
    },
    /** Replaces the current match and every remaining one, with no
     *  further prompting, matching real Emacs's own `!` behavior. */
    replaceAll() {
      let c = current();
      while (c) {
        applyReplacement(c.target, c.match);
        c = current();
      }
    },
    /** Stops the walk entirely, leaving the current (and every later)
     *  match untouched. */
    quit() {
      done = true;
      pendingMatch = null;
    },
    isDone: () => done,
    replacedCount: () => replacedCount,
  };
}

export { createQueryReplace, collectReplaceTargets };
