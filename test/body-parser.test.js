
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBody } from '../src/body-parser.js';

test('parses an ordered list with a nested unordered sublist', () => {
  const lines = [
    '1. Milk',
    '2. Eggs',
    '   - Organic',
    '3. Cheese',
    '   + Parmesan',
    '   + Mozzarella',
  ];
  const [list] = parseBody(lines);
  assert.equal(list.type, 'list');
  assert.equal(list.items.length, 3);
  assert.equal(list.items[0].text, 'Milk');
  assert.equal(list.items[0].ordered, true);

  const eggs = list.items[1];
  assert.equal(eggs.text, 'Eggs');
  assert.equal(eggs.children.length, 1);
  assert.equal(eggs.children[0].items[0].text, 'Organic');
  assert.equal(eggs.children[0].items[0].ordered, false);

  const cheese = list.items[2];
  assert.equal(cheese.children[0].items.length, 2);
  assert.equal(cheese.children[0].items[1].text, 'Mozzarella');
});

test('parses checkbox states', () => {
  const lines = ['- [ ] not started', '- [-] in progress', '- [X] complete'];
  const [list] = parseBody(lines);
  assert.deepEqual(
    list.items.map((it) => it.checkbox),
    [' ', '-', 'X']
  );
});

test('parses tag lists (checkbox + tag together)', () => {
  const lines = ['- [ ] fruits :: get apples', '- [X] veggies :: get carrots'];
  const [list] = parseBody(lines);
  assert.equal(list.items[0].tag, 'fruits');
  assert.equal(list.items[0].text, 'get apples');
  assert.equal(list.items[0].checkbox, ' ');
  assert.equal(list.items[1].tag, 'veggies');
  assert.equal(list.items[1].checkbox, 'X');
});

test('parses a table with header/rule/body rows', () => {
  const lines = [
    '| Tool         | Literate programming? | Languages |',
    '|--------------+------------------------+-----------|',
    '| Javadoc      | partial                | Java      |',
    '| Org-mode     | yes                    | any       |',
  ];
  const [table] = parseBody(lines);
  assert.equal(table.type, 'table');
  assert.equal(table.rows.length, 4);
  assert.equal(table.rows[1].type, 'rule');
  assert.deepEqual(table.rows[0].cells, ['Tool', 'Literate programming?', 'Languages']);
  assert.deepEqual(table.rows[3].cells, ['Org-mode', 'yes', 'any']);
});

test('captures a trailing #+TBLFM line with the table', () => {
  const lines = ['| a | b |', '| 1 | 2 |', '#+TBLFM: $3=$1+$2'];
  const [table] = parseBody(lines);
  assert.equal(table.tblfm, '$3=$1+$2');
});

test('parses a src block with language param', () => {
  const lines = ['#+begin_src emacs-lisp', '(message "Hello world")', '#+end_src'];
  const [block] = parseBody(lines);
  assert.equal(block.type, 'block');
  assert.equal(block.name, 'SRC');
  assert.equal(block.params, 'emacs-lisp');
  assert.deepEqual(block.lines, ['(message "Hello world")']);
});

test('parses a comment block containing a nested src block without breaking on the inner END', () => {
  const lines = [
    '#+begin_comment',
    'This is a block comment.',
    '#+begin_src emacs-lisp',
    '(+ 1 2)',
    '#+end_src',
    '#+end_comment',
  ];
  const [block] = parseBody(lines);
  assert.equal(block.name, 'COMMENT');
  assert.deepEqual(block.lines, ['This is a block comment.', '#+begin_src emacs-lisp', '(+ 1 2)', '#+end_src']);
});

test('parses mixed content: paragraph, list, table, block in sequence', () => {
  const lines = [
    'Some intro text.',
    '',
    '- one',
    '- two',
    '',
    '| a | b |',
    '',
    '#+begin_example',
    'monospace',
    '#+end_example',
  ];
  const nodes = parseBody(lines);
  assert.deepEqual(
    nodes.map((n) => n.type),
    ['paragraph', 'list', 'table', 'block']
  );
});

test('attaches parsed inline markup to a paragraph', () => {
  const [para] = parseBody(['This is *bold* text.']);
  assert.equal(para.inlineLines[0][1].type, 'bold');
});

test('attaches parsed inline markup to a list item', () => {
  const [list] = parseBody(['- some /italic/ text']);
  const item = list.items[0];
  assert.ok(item.inline.some((n) => n.type === 'italic'));
});

test('attaches parsed inline markup to table cells', () => {
  const [table] = parseBody(['| *bold header* | plain |']);
  assert.equal(table.rows[0].cellsInline[0][0].type, 'bold');
  assert.equal(table.rows[0].cellsInline[1][0].type, 'text');
});

test('a plain paragraph with no lists/tables/blocks', () => {
  const lines = ['Line one.', 'Line two.'];
  const [para] = parseBody(lines);
  assert.equal(para.type, 'paragraph');
  assert.deepEqual(para.lines, ['Line one.', 'Line two.']);
});
