/**
 * Reads the worked examples of examples/emacs-mode.org: each "Keys: ~...~" line is followed by two example blocks, the buffer before and the
 * buffer after, with ‸ marking the caret. Shared by tools/gen-emacs-examples-oracle.mjs and test/emacs-examples.test.js.
 */
import fs from 'node:fs';

const CARET = '‸';

/** @param {string} lines the lines of an example block, with Org's comma quoting still on @returns {string} */
const unquote = (lines) => lines.split('\n').map((l) => l.replace(/^(,*)(,)(\*|#\+)/, '$1$3')).join('\n');

/** @param {string} file @returns {{ title: string, keys: string, before: string, after: string }[]} */
export function readExamples(file = new URL('../examples/emacs-mode.org', import.meta.url).pathname) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  /** @type {{ title: string, keys: string, before: string, after: string }[]} */
  const out = [];
  let title = '';
  for (let i = 0; i < lines.length; i++) {
    const h = /^\*\* (.*)$/.exec(lines[i]);
    if (h) title = h[1];
    const k = /^Keys: ~(.*)~$/.exec(lines[i]);
    if (!k) continue;
    const blocks = [];
    for (let j = i + 1; blocks.length < 2 && j < lines.length; j++) {
      if (lines[j] !== '#+begin_example') continue;
      const end = lines.indexOf('#+end_example', j);
      blocks.push(unquote(lines.slice(j + 1, end).join('\n')));
      j = end;
    }
    if (blocks.length !== 2) throw new Error(`the example "${title}" needs a before and an after block`);
    out.push({ title, keys: k[1], before: blocks[0], after: blocks[1] });
  }
  return out;
}

/** The buffer and caret of a block. @param {string} block @returns {{ text: string, pos: number }} */
export function splitCaret(block) {
  const pos = block.indexOf(CARET);
  if (pos < 0 || block.indexOf(CARET, pos + 1) >= 0) throw new Error(`an example block needs exactly one ${CARET}: ${JSON.stringify(block)}`);
  return { text: block.replace(CARET, ''), pos };
}

/** A buffer and caret as an example block. @param {string} text @param {number} pos */
export const withCaret = (text, pos) => text.slice(0, pos) + CARET + text.slice(pos);
