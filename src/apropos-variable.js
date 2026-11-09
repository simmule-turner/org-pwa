// @ts-check
/**
 * apropos-variable: the variables whose names match a word, a list of words or a regexp, each with its description and value, as the
 * *Apropos* buffer of Emacs lists them. The pattern follows `apropos`: one word matches as a substring, a list of words matches the
 * names that hold at least two of them, and a pattern with regexp characters is a regexp. Case does not matter.
 */

/** @typedef {{ name: string, doc: string, value: string }} VariableEntry */

const REGEXP_CHARS = /[\\^$*+?.[\]]/;

/** A name test for `pattern`; null when it is a regexp that does not compile.
 * @param {string} pattern @returns {((name: string) => boolean) | null} */
function matcher(pattern) {
  if (REGEXP_CHARS.test(pattern)) {
    try {
      const re = new RegExp(pattern, 'i');
      return (name) => re.test(name);
    } catch {
      return null;
    }
  }
  const words = [...new Set(pattern.toLowerCase().split(/\s+/).filter(Boolean))];
  if (words.length <= 1) return (name) => words.length === 1 && name.toLowerCase().includes(words[0]);
  return (name) => words.filter((w) => name.toLowerCase().includes(w)).length >= 2;
}

/** The text with its words on lines of at most `width` columns, the lines after the first indented by `indent` spaces.
 * @param {string} text @param {number} indent @param {number} width */
function fill(text, indent, width) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else line = line ? line + ' ' + word : word;
  }
  if (line) lines.push(line);
  return lines.join('\n' + ' '.repeat(indent));
}

/** A value as Emacs prints it: `'time` is the symbol `time`.
 * @param {string} raw */
export function printedValue(raw) {
  return raw.replace(/^'/, '');
}

/**
 * The text of the *Apropos* buffer for `pattern`, or null with the message Emacs gives when no variable matches.
 * @param {string} pattern @param {VariableEntry[]} entries
 * @returns {{ ok: true, text: string } | { ok: false, message: string }}
 */
export function aproposVariable(pattern, entries) {
  const test = matcher(pattern.trim());
  if (!test) return { ok: false, message: `Invalid regexp: ${pattern}` };
  const found = entries.filter((e) => test(e.name)).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  if (!found.length) return { ok: false, message: `No apropos matches for \`${pattern}'` };
  const blocks = found.map((e) => `${e.name}\n  User option: ${fill(e.doc || '(not documented)', 15, 55)}\n  Value: ${e.value}`);
  return { ok: true, text: `Type RET on a type label to view its full documentation.\n\n${blocks.join('\n')}\n` };
}
