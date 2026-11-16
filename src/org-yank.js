// @ts-check
/**
 * `org-yank` (`C-y` in an Org buffer) on the text of a buffer: a kill that is a subtree is yanked specially. With
 * `org-yank-adjusted-subtrees` the tree is promoted or demoted to fit the headings around it (`org-paste-subtree`), and with
 * `org-yank-folded-subtrees` the caret ends at the next text after the tree. Positions are 0-based offsets.
 */
import { getTagsColumn, withTags } from './tags-column.js';

/** `org-kill-is-subtree-p`: the kill starts with a heading and no later heading has fewer stars. @param {string} txt */
export function killIsSubtree(txt) {
  const first = /^(?:[ \t\n\r]*?\n)?(\*+ )/.exec(txt);
  if (!first) return false;
  const level = first[1].length - 1;
  const start = first[0].length - first[1].length;
  const re = /^\*+ /gm;
  re.lastIndex = start + 1;
  for (let m = re.exec(txt); m; m = re.exec(txt)) if (m[0].length - 1 < level) return false;
  return true;
}

/** @param {string} text @param {number} pos */
const lineStart = (text, pos) => (pos <= 0 ? 0 : text.lastIndexOf('\n', pos - 1) + 1);
/** @param {string} text @param {number} pos */
const lineEnd = (text, pos) => {
  const i = text.indexOf('\n', pos);
  return i === -1 ? text.length : i;
};
/** The stars of the heading on the line of `pos`, or 0. @param {string} text @param {number} pos */
const levelAt = (text, pos) => /^(\*+) /.exec(text.slice(lineStart(text, pos), lineEnd(text, pos)))?.[1].length ?? 0;

/**
 * `org-paste-subtree` as `org-yank` calls it: the tree goes before the next heading (or at the end of the buffer) unless the caret is at
 * the start of a heading, and its level is made to fit the headings around.
 * @param {string} text @param {number} pos @param {string} tree
 * @returns {{ text: string, pos: number }} the text and the caret at the end of the tree
 */
export function pasteSubtreeForYank(text, pos, tree) {
  const oldLevel = /^\*+ /m.exec(tree)?.[0].length ?? 0;
  const bol = lineStart(text, pos);
  const line = text.slice(bol, lineEnd(text, pos));
  /** @type {number | null} */ let force = null;
  if (/^\*+[ \t]*$/.test(line) && text[pos] !== '*') force = /^\*+/.exec(line)?.[0].length ?? 0;
  else if (pos === bol && /^\*+ /.test(line)) force = levelAt(text, pos);
  let previous = 1;
  const headings = [...text.slice(0, pos).matchAll(/^\*+ /gm)].filter((m) => (m.index ?? 0) + m[0].length <= pos);
  const before = headings.at(-1);
  if (before) previous = before[0].length - 1;
  else if (levelAt(text, pos)) previous = levelAt(text, pos);
  let nextLevel = levelAt(text, pos);
  if (!nextLevel) {
    const following = /^\*+ /m.exec(text.slice(lineEnd(text, pos) < text.length ? lineEnd(text, pos) + 1 : text.length));
    nextLevel = following && lineEnd(text, pos) < text.length ? following[0].length - 1 : 1;
  }
  const level = force ?? Math.max(previous, nextLevel);
  const shift = oldLevel === 0 ? 0 : level - (oldLevel - 1);
  let out = text;
  let at = pos;
  if (force !== null) {
    out = text.slice(0, bol) + text.slice(pos);
    at = bol;
  }
  if (!(at === lineStart(out, at) && levelAt(out, at))) {
    const rest = lineEnd(out, at);
    const nextHeading = rest < out.length ? /^\*+ /m.exec(out.slice(rest + 1)) : null;
    at = nextHeading ? rest + 1 + (nextHeading.index ?? 0) : out.length;
    if (at > 0 && out[at - 1] !== '\n') {
      out = out.slice(0, at) + '\n' + out.slice(at);
      at += 1;
    }
  }
  const body = tree.endsWith('\n') ? tree : tree + '\n';
  const shifted = shift === 0 ? body : shiftHeadings(body, shift);
  out = out.slice(0, at) + shifted + out.slice(at);
  return { text: out, pos: at + shifted.length };
}

/** Promotes (negative) or demotes (positive) every heading of `tree` by `n` levels, as `org-map-region` with `org-demote` does.
 * @param {string} tree @param {number} n */
function shiftHeadings(tree, n) {
  return tree
    .split('\n')
    .map((l) => {
      const m = /^(\*+)( .*)$/.exec(l);
      if (!m) return l;
      const stars = '*'.repeat(Math.max(1, m[1].length + n));
      const tagged = /^(.*?)[ \t]+(:[^\s:]+(?::[^\s:]+)*:)[ \t]*$/.exec(m[2]);
      return tagged ? withTags(stars + tagged[1], tagged[2], getTagsColumn()) : stars + m[2];
    })
    .join('\n');
}

/**
 * `org-yank` of `kill` at `pos`.
 * @param {string} text @param {number} pos @param {string} kill
 * @param {{ adjusted: boolean, folded: boolean }} options `org-yank-adjusted-subtrees` and `org-yank-folded-subtrees`
 * @returns {{ text: string, pos: number, mark: number }}
 */
export function orgYank(text, pos, kill, options) {
  const bol = lineStart(text, pos);
  const subtree = killIsSubtree(kill) && (pos === bol || (/^[ \t]*$/.test(text.slice(pos, lineEnd(text, pos))) && /^\*+$/.test(text.slice(bol, pos))));
  const plain = () => ({ text: text.slice(0, pos) + kill + text.slice(pos), pos: pos + kill.length });
  if (!subtree) return { ...plain(), mark: pos };
  const pasted = options.adjusted ? pasteSubtreeForYank(text, pos, kill) : plain();
  if (!options.folded) return { ...pasted, mark: options.adjusted ? bol : pos };
  let end = pasted.pos;
  while (end < pasted.text.length && /[ \t\n\r]/.test(pasted.text[end])) end += 1;
  return { text: pasted.text, pos: lineStart(pasted.text, end), mark: pos };
}
