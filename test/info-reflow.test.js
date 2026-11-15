// The Info reader's paragraph reflow (src/info-reflow.js): the lines of filled prose, and of bullet items, are joined so a narrow screen wraps
// them to its own width; menus, examples, tables, rules and lines that are not filled keep theirs; nothing but the breaks and the indents after
// them changes, and every position of the original text can be found again.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reflowInfoText } from '../src/info-reflow.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const L = (/** @type {string} */ word, /** @type {number} */ n) => (word + ' ').repeat(n).trimEnd(); // a filled line

const prose = [L('alpha', 11) + ' beta', L('gamma', 11) + ' delta', 'the end of it.'];

test('the lines of a filled paragraph become one line', () => {
  const { text } = reflowInfoText(prose.join('\n'));
  assert.equal(text, prose.join(' '));
});

test('a bullet item is joined under its bullet, and each item stays its own line', () => {
  const item = (/** @type {string} */ w) => [`   • ${L(w, 10)} ${w}`, `     ${L(w, 11)} ${w}`, '     last words.'];
  const { text } = reflowInfoText([...item('one'), ...item('two')].join('\n'));
  const lines = text.split('\n');
  assert.equal(lines.length, 2);
  assert.ok(lines[0].startsWith('   • one one') && lines[0].endsWith('last words.'));
  assert.ok(lines[1].startsWith('   • two two'));
});

test('blank lines, menus, rules, examples, tables and short lines keep their lines', () => {
  const keep = [
    '* Menu:',
    '',
    '* First entry::      What it is, said in words that wrap',
    '                     onto a second line.',
    '',
    'Heading',
    '*******',
    '',
    '     # Local Variables:',
    '     # org-agenda-start-on-weekday: 1',
    '     # End:',
    '',
    'Variable      Default      Effect',
    'org-log-done  nil          Where log items go',
    '',
    'a short line',
    'and another short one',
  ].join('\n');
  assert.equal(reflowInfoText(keep).text, keep);
});

test('a paragraph whose lines are not filled is left as it is, and a new paragraph starts at a blank line', () => {
  const text = [...prose, '', 'second paragraph that is short', 'and stays so'].join('\n');
  const out = reflowInfoText(text).text;
  assert.equal(out, [prose.join(' '), '', 'second paragraph that is short', 'and stays so'].join('\n'));
});

test('every position of the text is found again in the new one, and only breaks and indents go', () => {
  const text = ['Intro', '', ...prose, '', `   • ${L('x', 12)} one`, `     ${L('y', 12)} two`, '     three', '', '     # code'].join('\n');
  const { text: out, map } = reflowInfoText(text);
  assert.equal(map.length, text.length + 1);
  for (let i = 0; i < text.length; i++) if (!/\s/.test(text[i])) assert.equal(out[map[i]], text[i], `position ${i}`);
  assert.equal(out.replace(/\s+/g, ''), text.replace(/\s+/g, ''));
  assert.equal(map[text.length], out.length);
});

/** The nodes of an Info file (the text after each header line). @param {string} file */
function nodesOf(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8').split('\x1f\n').filter((n) => /^File:/.test(n)).map((n) => n.slice(n.indexOf('\n') + 1));
}

test('over every node of the shipped manual and the Info fixtures nothing is lost, positions hold, and examples keep their lines', () => {
  const files = ['org-pwa.info', ...fs.readdirSync(path.join(ROOT, 'test/fixtures/info')).filter((f) => /\.info$/.test(f)).map((f) => 'test/fixtures/info/' + f)];
  let joined = 0;
  for (const file of files) {
    for (const node of nodesOf(file)) {
      const { text, map } = reflowInfoText(node);
      assert.equal(text.replace(/\s+/g, ''), node.replace(/\s+/g, ''), `${file}: characters lost`);
      for (let i = 0; i < node.length; i++) if (!/\s/.test(node[i]) && text[map[i]] !== node[i]) assert.fail(`${file}: position ${i} is not found again`);
      joined += node.split('\n').length - text.split('\n').length;
      for (const code of node.split('\n').filter((l) => /^ {5}# /.test(l))) assert.ok(text.split('\n').includes(code), `${file}: the example line "${code}" was joined`);
    }
  }
  assert.ok(joined > 1000, `the manual's paragraphs are joined (${joined} lines)`);
});
