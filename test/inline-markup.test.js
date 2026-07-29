
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInline } from '../src/inline-markup.js';

test('parses plain text with no markup', () => {
  const nodes = parseInline('just some words');
  assert.deepEqual(nodes, [{ type: 'text', value: 'just some words' }]);
});

test('parses bold, italic, underline, strikethrough individually', () => {
  assert.deepEqual(parseInline('*Bold*'), [{ type: 'bold', children: [{ type: 'text', value: 'Bold' }] }]);
  assert.deepEqual(parseInline('/italic/'), [{ type: 'italic', children: [{ type: 'text', value: 'italic' }] }]);
  assert.deepEqual(parseInline('_underline_'), [
    { type: 'underline', children: [{ type: 'text', value: 'underline' }] },
  ]);
  assert.deepEqual(parseInline('+strikethrough+'), [
    { type: 'strikethrough', children: [{ type: 'text', value: 'strikethrough' }] },
  ]);
});

test('keeps code and verbatim literal — no recursive parsing inside them', () => {
  const nodes = parseInline('~code with *not bold* inside~');
  assert.deepEqual(nodes, [{ type: 'code', value: 'code with *not bold* inside' }]);

  const nodes2 = parseInline('=verbatim with /not italic/ inside=');
  assert.deepEqual(nodes2, [{ type: 'verbatim', value: 'verbatim with /not italic/ inside' }]);
});

test('parses nested emphasis of different marker types (combine example from the primer)', () => {
  const nodes = parseInline('_/*combine*/_');
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].type, 'underline');
  const italic = nodes[0].children[0];
  assert.equal(italic.type, 'italic');
  const bold = italic.children[0];
  assert.equal(bold.type, 'bold');
  assert.deepEqual(bold.children, [{ type: 'text', value: 'combine' }]);
});

test('code/verbatim as innermost markers under bold+underline', () => {
  // *_~inner-most~_*  ->  bold > underline > code(literal)
  const nodes = parseInline('*_~inner-most~_*');
  assert.equal(nodes[0].type, 'bold');
  const underline = nodes[0].children[0];
  assert.equal(underline.type, 'underline');
  assert.deepEqual(underline.children, [{ type: 'code', value: 'inner-most' }]);
});

test('does not treat mid-word asterisks as emphasis', () => {
  const nodes = parseInline('a*b*c is not emphasis');
  // No valid open (preceded by "a", not whitespace/punctuation) -> all plain text.
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].type, 'text');
  assert.equal(nodes[0].value, 'a*b*c is not emphasis');
});

test('parses a link with description', () => {
  const nodes = parseInline('See [[https://orgmode.org][a nice website]] for more.');
  const link = nodes.find((n) => n.type === 'link');
  assert.equal(link.target, 'https://orgmode.org');
  assert.equal(link.description, 'a nice website');
});

test('parses a bare link without a description', () => {
  const nodes = parseInline('[[earlier heading]]');
  assert.deepEqual(nodes, [{ type: 'link', target: 'earlier heading', description: null }]);
});

test('auto-detects a bare image link by file extension', () => {
  const nodes = parseInline('[[https://upload.wikimedia.org/x/Konigsberg_bridges.png]]');
  assert.deepEqual(nodes, [{ type: 'image', target: 'https://upload.wikimedia.org/x/Konigsberg_bridges.png' }]);
});

test('a link with an explicit description to an image is treated as a link, not auto-rendered', () => {
  const nodes = parseInline('[[photo.png][my photo]]');
  assert.equal(nodes[0].type, 'link');
  assert.equal(nodes[0].description, 'my photo');
});

test('parses an inline comment', () => {
  const nodes = parseInline('Example of an @@comment:like so@@ comment.');
  const comment = nodes.find((n) => n.type === 'comment');
  assert.equal(comment.value, 'like so');
});

test('mixed plain text and emphasis in one line', () => {
  const nodes = parseInline('Each extra *star* increases depth.');
  assert.deepEqual(nodes, [
    { type: 'text', value: 'Each extra ' },
    { type: 'bold', children: [{ type: 'text', value: 'star' }] },
    { type: 'text', value: ' increases depth.' },
  ]);
});

// ---- sub/superscript -------------------------------------------------

test('a_b parses as a bare subscript "b" (default t mode)', () => {
  const nodes = parseInline('a_b');
  assert.deepEqual(nodes, [
    { type: 'text', value: 'a' },
    { type: 'subscript', value: 'b' },
  ]);
});

test('a^b parses as a bare superscript "b" (default t mode)', () => {
  const nodes = parseInline('a^b');
  assert.deepEqual(nodes, [
    { type: 'text', value: 'a' },
    { type: 'superscript', value: 'b' },
  ]);
});

test('a bare multi-character script is captured in full, not just one character', () => {
  const nodes = parseInline('x_abc');
  assert.deepEqual(nodes, [
    { type: 'text', value: 'x' },
    { type: 'subscript', value: 'abc' },
  ]);
});

test('a_{b} (braced) parses the same as the bare form in t mode', () => {
  const nodes = parseInline('a_{b}');
  assert.deepEqual(nodes, [
    { type: 'text', value: 'a' },
    { type: 'subscript', value: 'b' },
  ]);
});

test('a braced multi-character script works too', () => {
  const nodes = parseInline('x_{alpha}');
  assert.deepEqual(nodes, [
    { type: 'text', value: 'x' },
    { type: 'subscript', value: 'alpha' },
  ]);
});

test('a leading sign in a bare script is included', () => {
  const nodes = parseInline('x^-1');
  assert.deepEqual(nodes, [
    { type: 'text', value: 'x' },
    { type: 'superscript', value: '-1' },
  ]);
});

test('_ or ^ with no preceding character is never a script (needs something directly before it)', () => {
  const nodes = parseInline('_b');
  assert.equal(nodes.some((n) => n.type === 'subscript'), false);
});

test('_ or ^ preceded by whitespace is never a script', () => {
  const nodes = parseInline('x _b');
  assert.equal(nodes.some((n) => n.type === 'subscript'), false);
});

test('an unmatched opening brace falls through to literal text rather than throwing', () => {
  const nodes = parseInline('x_{unterminated');
  assert.equal(nodes.some((n) => n.type === 'subscript'), false);
});

// ---- org-use-sub-superscripts: nil mode -------------------------------

test("mode 'nil' disables subscript/superscript entirely, even the braced form", () => {
  const nodes = parseInline('a_b and a^b and a_{c}', { subSuperscriptMode: 'nil' });
  assert.equal(nodes.some((n) => n.type === 'subscript' || n.type === 'superscript'), false);
});

// ---- org-use-sub-superscripts: '{}' mode -------------------------------

test("mode '{}' only interprets the braced form -- a bare a_b is left as literal", () => {
  const nodes = parseInline('a_b', { subSuperscriptMode: '{}' });
  assert.equal(nodes.some((n) => n.type === 'subscript'), false);
  assert.deepEqual(nodes, [{ type: 'text', value: 'a_b' }]);
});

test("mode '{}' still interprets a_{b}", () => {
  const nodes = parseInline('a_{b}', { subSuperscriptMode: '{}' });
  assert.deepEqual(nodes, [
    { type: 'text', value: 'a' },
    { type: 'subscript', value: 'b' },
  ]);
});

// ---- disambiguation from underline ------------------------------------

test('_underline text_ at the start of a line is still parsed as underline, not subscript', () => {
  const nodes = parseInline('_underline text_');
  assert.deepEqual(nodes, [{ type: 'underline', children: [{ type: 'text', value: 'underline text' }] }]);
});

test('_underline_ after whitespace is still underline, not subscript', () => {
  const nodes = parseInline('word _underline_ word');
  assert.equal(nodes.some((n) => n.type === 'underline'), true);
  assert.equal(nodes.some((n) => n.type === 'subscript'), false);
});

test('subscript still works correctly alongside unrelated underline elsewhere in the same line', () => {
  const nodes = parseInline('a_b and _underline_');
  assert.equal(nodes.some((n) => n.type === 'subscript'), true);
  assert.equal(nodes.some((n) => n.type === 'underline'), true);
});

// ---- bare URL auto-linking (the reported bug) --------------------------

test('BUG FIX: a bare https:// URL with no brackets and no description auto-links', () => {
  const nodes = parseInline('https://nickhigham.wordpress.com/');
  assert.deepEqual(nodes, [{ type: 'link', target: 'https://nickhigham.wordpress.com/', description: null }]);
});

test('a bare URL surrounded by prose text auto-links, leaving the surrounding text intact', () => {
  const nodes = parseInline('See https://example.com/page for more.');
  assert.deepEqual(nodes, [
    { type: 'text', value: 'See ' },
    { type: 'link', target: 'https://example.com/page', description: null },
    { type: 'text', value: ' for more.' },
  ]);
});

test('trailing sentence punctuation is excluded from the auto-linked URL', () => {
  const nodes = parseInline('Visit https://example.com/page.');
  const link = nodes.find((n) => n.type === 'link');
  assert.equal(link.target, 'https://example.com/page');
  const trailingText = nodes.find((n) => n.type === 'text' && n.value.includes('.'));
  assert.ok(trailingText, 'the trailing period must remain as separate plain text');
});

test('a bare URL ending in an image extension auto-renders as an image, same as the bracketed form', () => {
  const nodes = parseInline('https://example.com/photo.png');
  assert.deepEqual(nodes, [{ type: 'image', target: 'https://example.com/photo.png' }]);
});

test('mailto: auto-links as a bare URL', () => {
  const nodes = parseInline('Contact mailto:someone@example.com today');
  const link = nodes.find((n) => n.type === 'link');
  assert.equal(link.target, 'mailto:someone@example.com');
});

test('non-URL-like text with a colon does NOT get misread as a link (e.g. a time)', () => {
  const nodes = parseInline('meeting at 10:30 today');
  assert.equal(nodes.some((n) => n.type === 'link'), false);
});

test('an unsupported scheme is not auto-linked, even though it has "word:word" shape', () => {
  const nodes = parseInline('see e.g. ratio 3:4 for reference');
  assert.equal(nodes.some((n) => n.type === 'link'), false);
});

test('the bracketed [[...]] form still works exactly as before -- no regression', () => {
  const nodes = parseInline('[[https://example.com][My Link]]');
  assert.deepEqual(nodes, [{ type: 'link', target: 'https://example.com', description: 'My Link' }]);
});

// ---- angle-bracket <...> auto-link form (real org's other recognized form) --

test('an angle-bracket-wrapped URL auto-links, with the brackets consumed', () => {
  const nodes = parseInline('See <https://example.com/page> for details');
  assert.deepEqual(nodes, [
    { type: 'text', value: 'See ' },
    { type: 'link', target: 'https://example.com/page', description: null },
    { type: 'text', value: ' for details' },
  ]);
});

test('angle brackets mean trailing punctuation inside them is NOT stripped (the boundary is explicit)', () => {
  const nodes = parseInline('<https://example.com/page.>');
  const link = nodes.find((n) => n.type === 'link');
  assert.equal(link.target, 'https://example.com/page.');
});

// ---- doi: scheme ---------------------------------------------------------

test('a bracketed doi: link is recognized (already worked, confirming no regression)', () => {
  const nodes = parseInline('[[doi:10.1145/1327452.1327492]]');
  assert.deepEqual(nodes, [{ type: 'link', target: 'doi:10.1145/1327452.1327492', description: null }]);
});

test('a bare doi: link auto-links -- the new feature', () => {
  const nodes = parseInline('See doi:10.1145/1327452.1327492 for the paper');
  const link = nodes.find((n) => n.type === 'link');
  assert.equal(link.target, 'doi:10.1145/1327452.1327492');
});

// ---- file:/github:/webdav: bare auto-linking ---------------------------

test('a bare file: link auto-links', () => {
  const nodes = parseInline('see file:~/notes.org for the source');
  const link = nodes.find((n) => n.type === 'link');
  assert.equal(link.target, 'file:~/notes.org');
});

test('a bare github: link auto-links', () => {
  const nodes = parseInline('tracked in github:journal/2026.org');
  const link = nodes.find((n) => n.type === 'link');
  assert.equal(link.target, 'github:journal/2026.org');
});
