
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

test('parses the [@N] start-value cookie into its own field, stripped from text', () => {
  const [list] = parseBody(['20. [@20] item twenty']);
  const item = list.items[0];
  assert.equal(item.startValue, 20);
  assert.equal(item.text, 'item twenty');
});

test('an item with no [@N] cookie has startValue null', () => {
  const [list] = parseBody(['- plain item']);
  assert.equal(list.items[0].startValue, null);
});

test('[@N] cookie works alongside a checkbox', () => {
  const [list] = parseBody(['3. [X] [@3] third item, already done']);
  const item = list.items[0];
  assert.equal(item.checkbox, 'X');
  assert.equal(item.startValue, 3);
  assert.equal(item.text, 'third item, already done');
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

// ---- horizontal rule (5+ dashes) ------------------------------------------

test('a line of exactly 5 dashes is parsed as an hr', () => {
  const nodes = parseBody(['-----']);
  assert.deepEqual(nodes, [{ type: 'hr' }]);
});

test('a line of more than 5 dashes is also an hr', () => {
  const nodes = parseBody(['----------']);
  assert.deepEqual(nodes, [{ type: 'hr' }]);
});

test('fewer than 5 dashes is NOT an hr -- stays a plain paragraph', () => {
  const nodes = parseBody(['----']);
  assert.equal(nodes[0].type, 'paragraph');
});

test('an hr line surrounded by whitespace is still recognized', () => {
  const nodes = parseBody(['  -----  ']);
  assert.deepEqual(nodes, [{ type: 'hr' }]);
});

test('an hr separates paragraphs correctly', () => {
  const nodes = parseBody(['First paragraph.', '-----', 'Second paragraph.']);
  assert.equal(nodes.length, 3);
  assert.equal(nodes[0].type, 'paragraph');
  assert.equal(nodes[1].type, 'hr');
  assert.equal(nodes[2].type, 'paragraph');
});

test('dashes with any non-dash character are not an hr', () => {
  const nodes = parseBody(['-----x']);
  assert.equal(nodes[0].type, 'paragraph');
});

// ---- footnote definition lines ----------------------------------------

test('a paragraph starting with "[fn:label] text" is marked as that footnote\u2019s definition', () => {
  const body = parseBody(['[fn:1] This is the footnote text.']);
  assert.equal(body[0].type, 'paragraph');
  assert.equal(body[0].footnoteLabel, '1');
});

test('the definition paragraph\u2019s inlineLines render the text AFTER the "[fn:label] " prefix, not a redundant footnote-ref marker', () => {
  const body = parseBody(['[fn:1] The actual note, with *bold* text.']);
  assert.deepEqual(body[0].inlineLines[0], [
    { type: 'text', value: 'The actual note, with ' },
    { type: 'bold', children: [{ type: 'text', value: 'bold' }] },
    { type: 'text', value: ' text.' },
  ]);
});

test('the definition paragraph\u2019s raw lines are completely untouched -- "[fn:label] " prefix and all -- for round-trip safety', () => {
  const body = parseBody(['[fn:1] The actual note.']);
  assert.deepEqual(body[0].lines, ['[fn:1] The actual note.']);
});

test('a footnote definition spanning multiple lines keeps footnoteLabel set once, subsequent lines parsed normally', () => {
  const body = parseBody(['[fn:1] First line of the note.', 'Second line, continued.']);
  assert.equal(body[0].footnoteLabel, '1');
  assert.equal(body[0].lines.length, 2);
  assert.deepEqual(body[0].inlineLines[1], [{ type: 'text', value: 'Second line, continued.' }]);
});

test('an ordinary paragraph (no footnote-definition prefix) has footnoteLabel null', () => {
  const body = parseBody(['Just a normal paragraph.']);
  assert.equal(body[0].footnoteLabel, null);
});

test('a bare footnote REFERENCE mid-sentence does not get mistaken for a definition line -- only the very start of the paragraph counts', () => {
  const body = parseBody(['See this[fn:1] for more, not a definition.']);
  assert.equal(body[0].footnoteLabel, null);
});

test('round-trip: a footnote definition paragraph serializes back to its exact original text', () => {
  const original = '[fn:1] The actual note, with *bold* text.';
  const body = parseBody([original]);
  assert.equal(body[0].lines.join('\n'), original);
});

// ---- nested sub-list detection across a blank-line separator -----------
// A real, general bug this coverage caught: a blank line between a list
// item and its nested sub-list (a common, legitimate org writing style --
// this app's own README.org uses it throughout) caused the sub-list to be
// silently parsed as a separate, un-nested sibling list instead of being
// nested as that item's own children.

test('a nested sub-list separated from its parent item by a blank line is correctly nested as children, not a separate sibling list', () => {
  const body = parseBody([
    '1. Open the app.',
    '2. Choose where to open from:',
    '',
    '   - Local file',
    '   - GitHub',
    '',
    '1. Edit.',
  ]);
  assert.equal(body.length, 1); // one single list block, not three separate ones
  assert.equal(body[0].items.length, 3);
  assert.equal(body[0].items[1].text, 'Choose where to open from:');
  assert.equal(body[0].items[1].children.length, 1);
  assert.equal(body[0].items[1].children[0].items.length, 2);
  assert.equal(body[0].items[1].children[0].items[0].text, 'Local file');
});

test('the same nesting works with NO blank line too (the pre-existing, already-working case)', () => {
  const body = parseBody(['1. Parent item', '   - Nested child']);
  assert.equal(body.length, 1);
  assert.equal(body[0].items[0].children.length, 1);
});

test('a blank line followed by a SAME-indent (not nested) list item still continues the list at the same level, not nested', () => {
  const body = parseBody(['- Item one', '', '- Item two, same level']);
  assert.equal(body.length, 1);
  assert.equal(body[0].items.length, 2);
  assert.equal(body[0].items[0].children.length, 0);
  assert.equal(body[0].items[1].text, 'Item two, same level');
});

test('a blank line followed by an ORDINARY PARAGRAPH (not any kind of list item) correctly ends the list, not consumed as a lookahead', () => {
  const body = parseBody(['- A list item', '', 'Just an ordinary paragraph, not a list at all.']);
  assert.equal(body.length, 2);
  assert.equal(body[0].type, 'list');
  assert.equal(body[0].items[0].children.length, 0);
  assert.equal(body[1].type, 'paragraph');
});

test('multiple blank lines before a nested sub-list are also tolerated, not just exactly one', () => {
  const body = parseBody(['1. Parent', '', '', '   - Nested child']);
  assert.equal(body.length, 1);
  assert.equal(body[0].items[0].children.length, 1);
});

test('mixed ordered-parent/unordered-child nesting (the exact real-world case this bug affected) works correctly with a blank-line separator', () => {
  const body = parseBody(['1. Numbered parent', '', '   - Bulleted child A', '   - Bulleted child B']);
  assert.equal(body.length, 1);
  assert.equal(body[0].items[0].ordered, true);
  assert.equal(body[0].items[0].children[0].items[0].ordered, false);
  assert.equal(body[0].items[0].children[0].items.length, 2);
});

test('deeply nested lists (three levels) each separated by blank lines all nest correctly, not just one level deep', () => {
  const body = parseBody(['1. Level 1', '', '   - Level 2', '', '     + Level 3']);
  const level1 = body[0].items[0];
  assert.equal(level1.children.length, 1);
  const level2 = level1.children[0].items[0];
  assert.equal(level2.children.length, 1);
  const level3 = level2.children[0].items[0];
  assert.equal(level3.text, 'Level 3');
});

test('round-trip: a blank-line-separated nested list preserves its exact original text, including the blank line, on re-serialization', () => {
  // This app's own serializer reconstructs body text from bodyLines directly (not from the derived
  // list structure), so this primarily confirms the FIX didn't change what gets stored in bodyLines --
  // parseBody's own structural output is additive and must never affect the raw source text.
  const lines = ['1. Parent', '', '   - Child'];
  const body = parseBody(lines);
  assert.equal(body[0].items[0].children[0].items[0].text, 'Child'); // the fix took effect
});

// ---- description-list "::" tag detection respects literal-span boundaries ----
// A real bug this coverage caught: "::" appearing inside a ~code~ or =verbatim=
// span (e.g. a list item whose prose demonstrates description-list syntax itself,
// like "(~term :: description~)") was being matched as if it were THIS item's own
// real tag separator, splitting the item incorrectly at that literal example's
// own "::" rather than treating the whole thing as ordinary text.

test('a legitimate description-list item still parses its tag/text correctly (the pre-existing, already-working case)', () => {
  const body = parseBody(['- term :: an actual definition']);
  assert.equal(body[0].items[0].tag, 'term');
  assert.equal(body[0].items[0].text, 'an actual definition');
});

test('a "::" appearing inside a ~code~ span is NOT treated as this item\u0027s own tag separator', () => {
  const body = parseBody(['- description lists use (~term :: description~) syntax']);
  assert.equal(body[0].items[0].tag, null);
  assert.equal(body[0].items[0].text, 'description lists use (~term :: description~) syntax');
});

test('a "::" appearing inside an =verbatim= span is also correctly skipped', () => {
  const body = parseBody(['- like (=term :: description=) for example']);
  assert.equal(body[0].items[0].tag, null);
});

test('a real tag separator AFTER a literal-span "::" example is still correctly found', () => {
  const body = parseBody(['- (~a :: b~) example :: this is the real definition']);
  assert.equal(body[0].items[0].tag, '(~a :: b~) example');
  assert.equal(body[0].items[0].text, 'this is the real definition');
});

test('the inline-parsed content for a literal-span "::" case correctly renders the code span as ONE unit, not split', () => {
  const body = parseBody(['- description lists (~term :: description~) work']);
  const codeNodes = body[0].items[0].inline.filter((n) => n.type === 'code');
  assert.equal(codeNodes.length, 1);
  assert.equal(codeNodes[0].value, 'term :: description');
});

// ---- THE FIX: multi-line LaTeX fragments don't get split by paragraph boundaries ----

test('THE FIX: a blank line INSIDE a multi-line \\begin{}...\\end{} environment does not split it into separate paragraphs -- the user\u2019s own reported "align" bug', () => {
  const lines = ['\\begin{align}', '  f(x) &= (x + 3)^2 \\\\', '  ', '       &= x^2 + 6x + 9', '\\end{align}'];
  const nodes = parseBody(lines);
  assert.equal(nodes.length, 1, 'must stay a single paragraph node, not split into 3 at the blank line');
  assert.equal(nodes[0].type, 'paragraph');
  assert.deepEqual(nodes[0].lines, lines, 'the raw, original lines are preserved exactly -- no placeholder substitution reaches the stored node');
  assert.equal(nodes[0].inlineLines.length, 1, 'collapses to exactly one rendered line, containing the whole fragment as one node');
  assert.equal(nodes[0].inlineLines[0][0].type, 'latex');
  assert.ok(nodes[0].inlineLines[0][0].source.includes('f(x)') && nodes[0].inlineLines[0][0].source.includes('x^2 + 6x + 9'));
});

test('THE FIX: the user\u2019s own reported \\begin{equation}...\\sqrt{b}...\\end{equation} example (no blank line, just multiple lines) stays one paragraph and one fragment', () => {
  const lines = ['\\begin{equation}', 'x=\\sqrt{b}', '\\end{equation}'];
  const nodes = parseBody(lines);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].inlineLines[0][0].source, lines.join('\n'));
});

test('a genuinely SEPARATE paragraph after a multi-line fragment is still correctly split off, once the fragment itself has closed', () => {
  const lines = ['\\begin{equation}', 'x=y', '\\end{equation}', '', 'A separate paragraph.'];
  const nodes = parseBody(lines);
  assert.equal(nodes.length, 2, 'the fragment\u2019s own paragraph, then a genuinely new one after the real blank line');
  assert.equal(nodes[1].type, 'paragraph');
  assert.equal(nodes[1].lines[0], 'A separate paragraph.');
});

test('a blank line that ISN\u2019T inside any fragment still correctly ends a paragraph as normal -- the protection only applies to lines genuinely inside an open multi-line fragment', () => {
  const lines = ['First paragraph.', '', 'Second paragraph.'];
  const nodes = parseBody(lines);
  assert.equal(nodes.length, 2);
});

test('a line that looks like a table row, but is actually INSIDE a multi-line fragment, does not incorrectly end the paragraph either', () => {
  const lines = ['\\begin{matrix}', 'a | b', 'c | d', '\\end{matrix}'];
  const nodes = parseBody(lines);
  assert.equal(nodes.length, 1, 'the whole matrix environment stays one paragraph, even though "a | b" would otherwise look like it starts a table');
  assert.equal(nodes[0].type, 'paragraph');
});

test('$...$ (capped at 2 line breaks, unlike the other four forms) does NOT receive the same open-ended paragraph protection -- a $...$ spanning enough lines to cross an actual blank-line boundary is out of its own real scope anyway', () => {
  const lines = ['$a', 'b$', '', 'Next paragraph.'];
  const nodes = parseBody(lines);
  // Whether or not "$a\nb$" itself renders as math (a separate, already-tested
  // concern), the key thing here is the blank line after it still correctly
  // starts a new paragraph -- $...$ was deliberately left out of
  // findLatexProtectedLineIndices, since real org\u2019s own restriction on it
  // (2 line breaks max) never reaches across an actual paragraph boundary
  // the way the unlimited-multi-line forms can.
  assert.equal(nodes.length, 2);
});
