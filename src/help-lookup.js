// @ts-check
/**
 * Finds where the Help (README.org) documents a name, for `[[help:NAME]]` links. Pure: README text and NAME in,
 * the line and the heading that holds it out.
 *
 * First match wins, in this order: a settings-table row whose first cell is `~NAME~`; a heading, or a list item
 * label, that is NAME; the first line containing `~NAME~`.
 */

/** @typedef {{ line: number, headingIndex: number }} HelpHit  (headingIndex counts headings in document order; -1 = before the first) */

/** @param {string} s */
const norm = (s) => s.trim().toLowerCase();

/**
 * @param {string} text
 * @param {string} name
 * @returns {HelpHit | null}
 */
export function lookupHelp(text, name) {
  const wanted = norm(name);
  if (!wanted) return null;
  const lines = text.split('\n');
  /** @type {number[]} */
  const headingAt = [];
  let heading = -1;
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*#\+begin_/i.test(l)) inBlock = true;
    else if (/^\s*#\+end_/i.test(l)) inBlock = false;
    else if (!inBlock && /^\*+ /.test(l)) heading++;
    headingAt.push(heading);
  }
  const tilde = '~' + name.trim() + '~';
  /** @type {(test: (l: string) => boolean) => HelpHit | null} */
  const first = (test) => {
    for (let i = 0; i < lines.length; i++) if (test(lines[i])) return { line: i, headingIndex: headingAt[i] };
    return null;
  };
  return (
    first((l) => l.startsWith('|') && norm(l.slice(1).split('|')[0]) === '~' + wanted + '~') ||
    first((l) => {
      const m = /^\*+ (?:[A-Z]+ )?(.*?)(?:\s+:[\w@:]+:)?\s*$/.exec(l);
      return m !== null && norm(m[1].replace(/^~(.*)~$/, '$1')) === wanted;
    }) ||
    first((l) => {
      const m = /^\s*(?:[-+*]|\d+[.)])\s+\*?~?([^~*:]+?)~?\*?(?:\s*::|\.|\s+-\s|\s*$)/.exec(l);
      return m !== null && /^\s*[-+]/.test(l) && norm(m[1]) === wanted;
    }) ||
    first((l) => l.includes(tilde))
  );
}
