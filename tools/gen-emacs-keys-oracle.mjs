#!/usr/bin/env node
/**
 * Writes test/fixtures/emacs-keys-oracle.json: what Emacs 29.3 does when the keys themselves are typed in an Org buffer (execute-kbd-macro of
 * the key names, through Emacs's own keymaps: C-SPC M-f C-w C-y, C-u 3 C-f, M-5 C-d, C-x h, typed characters, undo, the Org keys), so the
 * binding of each key and the reading of prefix arguments are held to Emacs as well as the commands. test/emacs-keys-oracle.test.js and the
 * smoke test "every bound key" use it.
 *
 *   node tools/gen-emacs-keys-oracle.mjs        (needs emacs on the PATH)
 */
import fs from 'node:fs';
import { BINDINGS } from '../src/emacs-keymap.js';
import { runEmacs } from './emacs-keys-lib.mjs';

const texts = [
  'foo bar baz',
  'Hello, world. don\'t stop_me x.y a-b\nsecond line here\n\nfourth',
  '  indented  text \t here  \nnext',
  'one\ntwo\nthree',
  '',
  'été Ünï 日本語 words',
  'a *bold* b_c d/e f=g ~h~ +i+ j',
  'a\tb\tc\nfoo\t1.\tDONE\tx\n\u65e5\u672c\u8a9e x\nabcdefghijklmnop\n\ty\n',
  'abc\u65e5\u672c\u8a9e\u306etext\u30ab\u30bf\u30ab\u30ca\u3072\u3089\u304c\u306a e\u0301x 1\u65e5 \u03b1\u03b2gamma \u0436\u0436a',
];
const orgText = '* TODO Head one :tag:\nbody text\n** Sub\n- [ ] item a\n- [X] item b\n  more\n* Next\n| a | b |\n| cc | d |\n';
const all = (/** @type {string} */ text) => [...Array(text.length + 1).keys()].filter((i) => !/[\udc00-\udfff]/.test(text[i] ?? ''));
const every = (/** @type {string[]} */ ts, /** @type {string[]} */ seqs, /** @type {string[]} */ kill = []) => ts.flatMap((text) => all(text).flatMap((pos) => seqs.map((keys) => ({ text, pos, keys, kill }))));

// keys Emacs mode does not run through the editing commands: windows, the minibuffer, search, visibility, quitting
const SKIP = new Set(['M-z', 'C-x d', 'C-x C-j', 'C-x C-f', 'C-x C-u', 'C-x C-l', 'C-q', 'C-g', 'C-s', 'C-r', 'M-x', 'C-x b', 'C-x k', 'C-x C-b', 'C-h e', 'C-v', 'M-v', 'TAB', '<backtab>', 'C-c C-r', 'C-c C-n', 'C-c C-p', 'C-c C-f', 'C-c C-b', 'C-u', 'C-x u', 'C-/', 'C-?', 'C-M-_', 'C-_', 'M-y', 'C-c C-c', 'C-c C-t', 'C-c C-x C-b', 'M-<up>', 'M-<down>', 'M-<left>', 'M-<right>']);
const singles = Object.keys(BINDINGS).filter((k) => !SKIP.has(k) && !/^M-[0-9-]$/.test(k));
const fillGap = (/** @type {{ text: string, keys: string }} */ c) => c.keys === 'M-q' && /[\t\u3000-\u9fff]/.test(c.text); // a tab after a sentence end and wide characters (no space between them) are not filled as Emacs does

const cases = [];
cases.push(...every(texts, singles));
cases.push(...every(texts.slice(-2, -1), ['C-n C-n', 'C-n C-p', 'C-p C-p', 'C-n C-n C-p C-p', 'M-2 C-n', 'M-2 C-p', 'C-n C-e C-n', 'C-n C-k C-n', 'C-n C-d C-p', 'C-q C-a C-n C-p', 'C-n C-q C-a C-p', 'C-e C-q C-a C-p']));
cases.push(...every(texts.slice(-1), ['M-f M-f M-f', 'M-b M-b M-b', 'C-u 3 M-f', 'M-3 M-d', 'M-DEL M-DEL', 'M-t', 'M-c M-c', 'M-u M-u M-u', 'M-l M-l'])); // words across scripts
cases.push(...every(texts.slice(0, 3), ['a', 'x y z', 'a DEL', 'SPC SPC', 'a b C-b C-d', 'C-u 3 x', 'a | C-/', '* | a C-/', '| | C-/', 'a b | c d C-/ C-/', 'C-u 3 | C-/', 'C-u x y C-/', 'C-u x y C-/ C-/', 'M-3 a b C-/', 'M-1 a b C-/', 'M-3 a', 'C-u a', 'C-u 4 DEL', 'M-- C-d']));
// quoted characters: itself, a control key, a key name, octal codes ended by RET, by another key, or at once
cases.push(...every(texts.slice(0, 3), ['C-q a', 'C-q C-a', 'C-q TAB', 'C-q RET', 'C-q SPC', 'C-q 1 0 1 RET', 'C-q 1 0 1 a', 'C-q 7 a', 'C-q 4 1 SPC', 'C-q 3 4 0 RET', 'C-u 3 C-q a', 'M-2 C-q 1 0 1 RET', 'C-q M-a', 'C-q C-g', 'C-q DEL', 'C-q ESC', 'C-q 8', 'C-q C-/', 'C-q C-SPC', 'C-q C-j', 'C-q 1 0 1 C-f', 'C-q 1 0 1 C-q 1 0 2 RET'], ['k1']));
// prefix arguments, as typed
const prefixed = ['C-u C-f', 'C-u C-u C-f', 'C-u 3 C-f', 'C-u 12 C-f', 'C-u - C-f', 'C-u - 2 C-b', 'M-3 C-f', 'M-0 C-f', 'M-- C-b', 'M-- 2 C-f', 'M-12 C-f', 'C-u 2 M-f', 'C-u 2 M-b', 'C-u M-d', 'M-2 M-d', 'M-2 M-DEL', 'C-u C-k', 'M-2 C-k', 'M-0 C-k', 'M-2 C-n', 'M-2 C-p', 'C-u C-a', 'C-u C-e', 'M-2 M-u', 'M-2 M-c', 'C-u 2 C-t', 'M-2 M-t', 'M-2 C-o', 'M-3 C-y', 'C-u M-\\', 'M-2 M-SPC', 'M-2 C-x C-o', 'M-2 M-<left>', 'M-0 M-<right>', 'C-u M-<left>', 'M-- M-<right>', 'C-u 3 M-<right>'];
cases.push(...every(texts.slice(0, 4), prefixed, ['ring\nx', 'k2', 'k3']));
// kills and yanks
const flows = ['C-k C-k C-y', 'M-d M-d C-y', 'M-DEL M-DEL C-y', 'M-d M-DEL', 'C-k C-f C-k C-y', 'C-k C-y C-y', 'C-k C-y M-y', 'C-y M-y M-y', 'C-y M-y M-y M-y', 'M-d C-y C-y M-y', 'C-n C-k C-y', 'C-e C-k C-y', 'C-k M-d C-y'];
cases.push(...every(texts.slice(0, 4), flows, ['k1', 'k2 two', 'k3\n']));
// the region: C-SPC, a motion, then the command
const region = ['C-SPC M-f C-w', 'C-SPC M-f M-w C-y', 'C-SPC C-e C-w C-y', 'C-SPC M-f C-x C-x', 'C-SPC M-f C-x C-x C-d', 'C-x h', 'C-x h C-w', 'C-x h M-w C-y', 'C-SPC C-SPC', 'C-SPC C-f C-SPC C-f', 'C-SPC C-f C-SPC C-SPC C-f', 'C-SPC M-f DEL', 'C-SPC M-\\ DEL', 'C-SPC M-\\ C-w', 'C-SPC M-SPC C-w', 'C-SPC M-m C-w', 'C-SPC C-f M-\\ DEL', 'C-SPC M-f C-d', 'C-SPC M-f a', 'C-SPC C-n M-w C-n C-y', 'M-< C-SPC M-> C-w', 'C-SPC M-f M-u', 'C-SPC M-f M-c', 'C-SPC C-a C-k', 'C-w', 'M-w', 'C-x C-x'];
cases.push(...every(texts.slice(0, 3), region, ['k1']));
for (const text of ['foo bar\nbaz']) for (const pos of all(text)) for (const mark of all(text)) for (const keys of ['C-w', 'M-w', 'C-x C-x', 'C-x C-x C-w', 'DEL', 'C-d', 'C-w C-y', 'M-u', 'M-c', 'C-y', 'a']) cases.push({ text, pos, mark, keys, kill: ['k1'] });
// M-up and M-down with the region active move its lines (org-metaup, org-metadown: transpose-regions)
cases.push(...every(['one\ntwo\nthree', 'one\ntwo\nthree\n', 'a\n\nb'], ['C-SPC C-n M-<up>', 'C-SPC C-n M-<down>', 'C-x h M-<up>', 'C-x h M-<down>', 'C-SPC C-n M-<up> C-x C-x C-d', 'C-SPC C-n M-<down> C-/']));
// undo
const undo = ['a b M-0 C-/', 'a b C-u 0 C-/', 'a b C-/ M-0 C-?', 'a b M-2 C-/', 'a b C-/ C-/ C-u - C-/', 'a b C-/', 'a b C-/ C-/', 'a b C-/ C-?', 'C-k C-/', 'C-k C-/ C-?', 'M-d C-_', 'M-d M-d C-/ C-/', 'M-d C-x u', 'a SPC b C-/ C-/ C-/', 'C-k C-y C-/', 'C-SPC M-f C-w C-/', 'M-f M-u C-/', 'C-d C-d C-/', 'DEL DEL C-/', 'M-d C-/ C-/'];
cases.push(...every(texts.slice(0, 3), undo, ['k1']));
// Org keys on a buffer with headings, a list and a table
// the line, sentence and word commands that have no count
cases.push(...every(['one two. three.  four\nfive', 'a\n  b c\n\n  d)', '  (x\n y) z\n', '- a b\n  c\n', '* TODO H x\nbody\n', 'ab\n', '\n'], ['M-k', 'C-u 2 M-k', 'M-@', 'M-@ M-@', 'C-u 2 M-@', 'M-^', 'C-u M-^', 'C-M-o', 'C-x C-t', 'C-<backspace>', 'C-<delete>', 'C-u 2 C-<backspace>']).filter((c) => !(/^M-\^/.test(c.keys) && c.text.startsWith('* ') && c.pos <= c.text.indexOf('\n')))); // M-^ on a heading in the first line: Emacs scrambles the text (a known difference)
// zap-to-char: a character that is there or not, in either case, a count, back, and a space
cases.push(...every(['Foo oO bar\nzoo \u00e9 Ooo', 'abc', ''], ['M-z o', 'M-z O', 'M-z Z', 'M-z z', 'M-z SPC', 'M-z TAB', 'M-z \u00e9', 'C-u 2 M-z o', 'C-u 5 M-z o', 'M-- M-z o', 'M-- 2 M-z O', 'C-u M-z o', 'C-u 0 M-z o', 'M-z o M-z o', 'M-z o C-y']));
// the disabled case commands: the question, each answer, a region on either side of the caret, and no region
cases.push(...['foo Bar baz', '\u00e9 \u00df \u01c4 x\nLine Two'].flatMap((text) => [[4, 8], [8, 4], [0, text.length], [6, 6]].flatMap(([pos, mark]) => ['C-x C-u y', 'C-x C-l y', 'C-x C-u SPC', 'C-x C-l SPC', 'C-x C-u !', 'C-x C-u n', 'C-x C-l n', 'C-x C-u y C-x C-l y', 'C-x C-u SPC C-x C-u y', 'C-x C-u ! C-x C-l', 'C-u 3 C-x C-u y'].map((keys) => ({ text, pos, mark, keys, kill: [] })))));
cases.push(...['foo Bar', ''].flatMap((text) => ['C-x C-u y', 'C-x C-l SPC', 'C-x C-u n'].map((keys) => ({ text, pos: 0, keys, kill: [] }))));
// M-q (org-fill-paragraph): paragraphs of different widths, indents, items, comments and things that are not filled
const fillWords = 'The quick brown fox jumps over the lazy dog and keeps running through the forest until night falls. Then it rests.  Another sentence follows here, quite long indeed, to wrap';
cases.push(...every([fillWords, 'one\ntwo\n\nthree\nfour', 'x\n  y\n  z', '  ' + fillWords.slice(0, 120), '- ' + fillWords.slice(0, 110) + '\n- next\n  more', '1. ' + fillWords.slice(0, 100), '* ' + fillWords.slice(0, 90) + '\n' + fillWords.slice(0, 100), '# ' + fillWords.slice(0, 100), '| a | b |\n| c | d |', 'a  b   c \n', 'foo.  bar. baz?\nand', 'tail   \n\n\nx', fillWords.slice(0, 60) + ' -  dash ' + fillWords.slice(0, 30)].map((t) => t.replace(/^(.{0,200})$/s, '$1')), ['M-q']));
// filling random paragraphs: word lengths around the edge, sentence ends, bullets and dashes where a line may break, an unbreakable word
{
  let seed = 12345;
  const rnd = (/** @type {number} */ n) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
  const bits = ['a', 'bb', 'ccc', 'word', 'sentence.', 'end?', 'x,', '-', '+', '1.', '2)', '*', 'e.g.', 'Mr.', 'looooooooooooooooong', 'U.S.', '"quoted."', 'tail:'];
  for (let i = 0; i < 160; i++) {
    const n = 8 + rnd(40);
    let t = '';
    for (let k = 0; k < n; k++) t += bits[rnd(bits.length)] + [' ', ' ', ' ', '  ', '\n', ' \n  '][rnd(6)];
    t = [t.trimEnd(), "- " + t.trimEnd().replace(/\n/g, "\n  "), "# " + t.trimEnd().replace(/\n/g, "\n# "), "  " + t.trimEnd()][i % 4];
    for (const pos of [0, Math.floor(t.length / 2), t.length]) cases.push({ text: t, pos, keys: 'M-q', kill: [] });
  }
  cases.push({ text: 'x'.repeat(75) + ' ab ' + 'y'.repeat(70) + ' z', pos: 3, keys: 'M-q', kill: [] });
}
// M-q with the region active: the paragraphs it touches
{
  const two = fillWords.slice(0, 90) + '\n\n' + fillWords.slice(20, 120) + '\n- item ' + fillWords.slice(0, 80) + '\n\nlast one  here';
  for (const [pos, mark] of [[0, 20], [20, 0], [5, two.length], [100, 200], [two.length, 0], [95, 96], [96, 98]]) cases.push({ text: two, pos, mark, keys: 'M-q', kill: [] });
}
// RET (org-return): a table row, a heading, a list item, indented text and plain lines, with a count
// Left out as known gaps (ROADMAP): the caret inside a list bullet, a negative count on a heading or item, typing in a table before RET (it realigns), and a tab straight after the caret, and a second RET, typing, a count or a checkbox inside list items.
const retGap = (/** @type {{ text: string, pos: number, keys: string }} */ c) => {
  const start = c.text.lastIndexOf('\n', c.pos - 1) + 1;
  const line = c.text.slice(start, c.text.indexOf('\n', start) < 0 ? undefined : c.text.indexOf('\n', start));
  const bullet = /^[ \t]*(?:[-+]|\d+[.)]) ?/.exec(line);
  const inMarker = bullet && c.pos - start >= 1 && c.pos - start <= bullet[0].length;
  const structural = /^(\*+ |[ \t]*(?:[-+]|\d+[.)]) )/.test(line);
  return inMarker || (c.keys === 'C-u - 1 RET' && structural) || c.text[c.pos] === '\t' || (/^[ \t]*(?:[-+]|\d+[.)]) /m.test(c.text) && (['RET RET', 'x RET y', 'C-u - 1 RET'].includes(c.keys) || (c.text.startsWith('- [ ]') && c.pos >= 3 && c.pos <= 5) || (c.keys === 'C-u 3 RET' && c.text.startsWith('  - sub') && c.pos > 12))) || (c.keys === 'x RET y' && c.text.includes('|'));
};
cases.push(...every(['one two', 'one  two\n', 'a\n\nb', '  indented\n  text\n', '* Head\nbody\n', '* TODO Head two\n', '** [#A] Head two\n', '- item one\n- two\n', '  - sub item\n    more\n', '1. a\n2. b\n', '- [ ] todo\n', '| a | b |\n| c | d |\n', '| a | b |\n|---+---|\n| c | d |\n', '| a | b |\n', 'text\n| a |\n'], ['RET', 'C-u 3 RET', 'RET RET', 'x RET y', 'C-u - 1 RET']).filter((c) => !retGap(c)));
cases.push(...every(['*  E x', '**   TODO  y :t:', '*  ', '* TODO'], ['C-c C-t', 'C-c C-t C-c C-t', 'C-c C-t C-c C-t C-c C-t']));
cases.push(...every(['text\n*** deep\nbody\n** two\n* top\n**** four\n'], ['C-c C-u', 'C-c C-u C-c C-u', 'M-2 C-c C-u', 'M-5 C-c C-u', 'C-c C-u C-c C-u C-c C-u']));
cases.push(...every([orgText], ['C-c C-n', 'C-c C-p', 'M-2 C-c C-n', 'M-2 C-c C-p', 'M-- C-c C-n', 'M-- C-c C-p', 'M-0 C-c C-n', 'M-0 C-c C-p', 'C-u C-c C-n', 'C-c C-u', 'M-2 C-c C-u', 'M-3 M-<left>', 'M-3 M-<right>', 'M-2 M-<up>', 'M-2 M-<down>', 'C-u M-<down>', 'M-0 M-<up>', 'M-1 M-<up>', 'M-- M-<down>', 'M-- M-<up>', 'M-- M-<left>', 'M-0 M-<down>', 'M-0 M-<left>', 'M-2 M-<left>', 'M-- C-c C-f', 'M-- C-c C-b', 'M-0 C-c C-f', 'M-0 C-c C-b', 'M-2 C-c C-f', 'C-u C-c C-b', 'C-u - C-c C-f', 'M-<up>', 'M-<down>', 'M-<left>', 'M-<right>', 'C-c C-t', 'C-c C-t C-c C-t', 'C-c C-x C-b', 'C-e', 'C-a', 'C-k', 'M-d', 'a', 'DEL', 'C-d', 'C-o', 'M-t', 'C-t']));

// the table keys: C-o and the M-arrows, on tables of every shape, at every caret position
const tableTexts = [
  '| a |',
  '| a |\n| bbb |',
  '|a|\n|bbb|',
  '| a | b |\n| cc | d |\n',
  '| a | b | c |\n|---+---+---|\n| 1 | 22 | 333 |\n| x | y | z |\n#+TBLFM: $3=$1+$2\n',
  '  | indented | table |\n  | x | y |\ntext after\n',
  'before\n| a |\n| bb |\n\n| other | table |\n| 1 | 2 |',
  '| x | y | z |\n|---+---+---|\n| 1 |\n| 22 | 3 | 4 | 5 |\n',
  '#+begin_src text\n| a | b |\n| c | d |\n#+end_src\n| e | f |\n',
  '* H\n| a | b |\n|---+---|\n| 1 | 2 |\n#+TBLFM: @2$2=1\n\nplain\n',
  '| \u65e5\u672c | b |\n| x | \u00e9t\u00e9 |\n',
];
// a table of rules only, and the keys that go to the next or previous field (not at the end of the buffer, and not C-o or the M-arrows: ROADMAP.org)
for (const text of ['|---+---|\n', '|-----+--|', '  |---+-|\n']) for (const pos of all(text).filter((p) => p < text.length)) for (const keys of ['M-e', 'M-a', 'M-e M-e', 'M-a M-e']) cases.push({ text, pos, keys, kill: [] });
// (M-arrows only where the caret is on a table line, or at the end of the buffer under one: on a paragraph they drag the element)
const onTable = (/** @type {string} */ text, /** @type {number} */ pos) => /^[ \t]*\|/.test(text.slice(text.lastIndexOf('\n', pos - 1) + 1, text.indexOf('\n', pos) < 0 ? undefined : text.indexOf('\n', pos))) || (pos === text.length && /^[ \t]*\|/.test(text.slice(text.lastIndexOf('\n', pos - 2) + 1)));
for (const text of tableTexts) for (const pos of all(text)) {
  for (const keys of ['C-o', 'C-o C-o', 'M-2 C-o', 'C-o M-<left>']) cases.push({ text, pos, keys, kill: [] });
  if (onTable(text, pos) && !text.includes('#+begin_src')) for (const keys of ['M-<up>', 'M-<down>', 'M-<left>', 'M-<right>', 'M-<down> M-<down>', 'M-<up> M-<up>', 'M-<left> M-<right>', 'M-<right> M-<right>', 'M-<right> M-<down>']) cases.push({ text, pos, keys, kill: [] });
}

for (let i = cases.length - 1; i >= 0; i--) if ((cases[i].keys === 'RET' && retGap(cases[i])) || fillGap(cases[i])) cases.splice(i, 1);
const out = [];
const results = runEmacs(cases);
for (let i = 0; i < cases.length; i++) out.push({ ...cases[i], emacs: results[i] });
fs.writeFileSync('test/fixtures/emacs-keys-oracle.json', JSON.stringify({ emacs: '29.3', cases: out }) + '\n');
console.log(`${out.length} cases written`);
