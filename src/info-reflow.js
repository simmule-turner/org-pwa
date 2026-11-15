// @ts-check
// Info files are filled to about 70 columns, so on a narrow screen every line of a paragraph wraps a second time. Reflowing joins the lines of
// ordinary paragraphs, and of bullet items, into one line each, so the screen wraps them to its own width. Lines that mean something where
// they break stay as they are: menus, examples and code, tables, the rule under a heading, and any paragraph whose lines are not filled.

/** A line that starts a bullet item: its bullet and the indent of its text. @param {string} line @returns {{ indent: number, text: number } | null} */
function bulletOf(line) {
  const m = /^( *)(?:•|[-*+]|[0-9]+[.)]) +/.exec(line);
  return m ? { indent: m[1].length, text: m[0].length } : null;
}

/** @param {string} line */
const indentOf = (line) => /^ */.exec(line)?.[0].length ?? 0;

/** A line that is no prose: a menu entry, a rule, code, a table row. @param {string} line */
function isFixedLine(line) {
  const body = line.trimStart();
  return (
    /^\* /.test(line) ||
    /^([*=.\-~])\1{2,}$/.test(body) ||
    /^[#$>%;]/.test(body) ||
    /\t/.test(line) ||
    / {3,}/.test(body) ||
    /[|]/.test(line)
  );
}

/** The longest line that makeinfo fills to is 79 columns; a prose line that is cut short is not a filled one. */
const FILLED_MIN = 40;
const FILLED_MAX = 80;

/**
 * The text of a node (without its header line) with the lines of each prose paragraph joined, and, for each position of the original text
 * (and the one past its end), where that position is in the new text.
 * @param {string} text
 * @returns {{ text: string, map: Int32Array }}
 */
export function reflowInfoText(text) {
  const lines = text.split('\n');
  /** @type {number[]} */
  const starts = [];
  let at = 0;
  for (const line of lines) {
    starts.push(at);
    at += line.length + 1;
  }
  // which line is joined to the one before it
  const joined = new Array(lines.length).fill(false);
  let i = 0;
  while (i < lines.length) {
    if (lines[i].trim() === '' || isFixedLine(lines[i])) {
      i++;
      continue;
    }
    // a paragraph: its first line, and the lines after it that sit under its text
    const bullet = bulletOf(lines[i]);
    const hang = bullet ? bullet.text : indentOf(lines[i]);
    let j = i + 1;
    while (j < lines.length && lines[j].trim() !== '' && !bulletOf(lines[j]) && indentOf(lines[j]) === hang && !isFixedLine(lines[j])) j++;
    const filled = lines.slice(i, j - 1).every((l) => l.length >= FILLED_MIN && l.length <= FILLED_MAX);
    if (filled) for (let k = i + 1; k < j; k++) joined[k] = true;
    i = Math.max(j, i + 1);
  }
  let out = '';
  const map = new Int32Array(text.length + 1);
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    if (joined[n]) {
      const lead = indentOf(line);
      // the break and the indent after it become one space, and a position in them is at that space
      const gone = starts[n] - 1;
      out += ' ';
      for (let p = gone; p < starts[n] + lead; p++) map[p] = out.length - 1;
      for (let p = lead; p < line.length; p++) map[starts[n] + p] = out.length + (p - lead);
      out += line.slice(lead);
    } else {
      if (n > 0) {
        map[starts[n] - 1] = out.length;
        out += '\n';
      }
      for (let p = 0; p < line.length; p++) map[starts[n] + p] = out.length + p;
      out += line;
    }
  }
  map[text.length] = out.length;
  return { text: out, map };
}
