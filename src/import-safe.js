// @ts-check
/**
 * Text from an imported file (a contact card, a calendar event) is untrusted: written into an Org document as it
 * arrives, a line can start a heading, a source block, a drawer or a local-variables block. These helpers keep
 * each piece of imported text inside the field it was meant for.
 */

/** Line breaks and control characters other than a tab: the characters that end or corrupt a physical line. */
const BREAKS = /\r\n|[\r\n\u0085\u2028\u2029\v\f\u0000-\u0008\u000e-\u001f\u007f]/g;

/**
 * Text for a heading title or a one-line value: every line break becomes a space.
 * @param {string} text
 */
export function oneLine(text) {
  return text.replace(BREAKS, ' ').trim();
}

/**
 * Text for a `:PROPERTY:` value: every line break becomes " ; " so the parts stay readable.
 * @param {string} text
 */
export function propertyText(text) {
  return text.replace(/\r\n|[\r\n\u0085\u2028\u2029\v\f]/g, ' ; ').replace(BREAKS, ' ').trim();
}

/**
 * Lines for the inside of a block (`#+BEGIN_VERSE` ... `#+END_VERSE`), escaped as Org does (org-escape-code-in-string):
 * a line that starts a heading or a keyword gets a comma in front, so it cannot end the block or begin a heading. A comment
 * line is escaped too, because a local-variables block is found by its text wherever it sits in the file.
 * @param {string} text
 * @returns {string[]}
 */
export function blockLines(text) {
  return text.split(/\r\n|[\r\n\u0085\u2028\u2029\v\f]/).map((line) => line.replace(BREAKS, ' ').replace(/^([ \t]*)(,*(?:\*|#))/, '$1,$2'));
}

/**
 * Lines for body text outside any block, indented by the caller (an indented `*` cannot start a heading): a comment line
 * or keyword (`#+BEGIN_SRC`, `# Local Variables:`) and a line shaped like a drawer marker (`:END:`, `:PROPERTIES:`) get a
 * comma in front.
 * @param {string} text
 * @returns {string[]}
 */
export function bodyLines(text) {
  return text
    .split(/\r\n|[\r\n\u0085\u2028\u2029\v\f]/)
    .map((line) => line.replace(BREAKS, ' ').replace(/^([ \t]*)(,*#)/, '$1,$2').replace(/^([ \t]*)(:[\w-]+:[ \t]*)$/, '$1,$2'));
}
