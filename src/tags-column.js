// @ts-check
/**
 * `org-tags-column`: where the tags of a heading line sit when the line is written again. 0 puts them one space after the title
 * (the default here; Emacs's is -77), a positive number starts them at that column, a negative one ends them at that column
 * (right-aligned); a title too long for either keeps one space (`org-align-tags`).
 */

let column = 0;

/** @param {number} n */
export function setTagsColumn(n) {
  column = Number.isFinite(n) ? Math.trunc(n) : 0;
}

export function getTagsColumn() {
  return column;
}

/** The value of `org-tags-column` in a variables map (a number, or a string holding one); 0 when unset or unreadable.
 * @param {Record<string, unknown> | null | undefined} vars */
export function tagsColumnOf(vars) {
  const raw = vars ? vars['org-tags-column'] : undefined;
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
  return raw === undefined || raw === '' || !Number.isFinite(n) ? 0 : Math.trunc(n);
}

/** Display width of a string, wide (CJK) characters counting two columns.
 * @param {string} s */
export function textWidth(s) {
  let w = 0;
  for (const ch of s) {
    const c = /** @type {number} */ (ch.codePointAt(0));
    w += (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe6f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x20000 && c <= 0x3fffd) ? 2 : 1;
  }
  return w;
}

/** The heading line with its tags: `head` is the line up to the title, `tags` the `:a:b:` string.
 * @param {string} head @param {string} tags @param {number} col */
export function withTags(head, tags, col) {
  const used = textWidth(head);
  if (col === 0) return `${head} ${tags}`;
  const start = col > 0 ? col : -col - textWidth(tags);
  return head + ' '.repeat(Math.max(1, start - used)) + tags;
}
