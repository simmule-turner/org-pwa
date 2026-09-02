import test from 'node:test';
import assert from 'node:assert/strict';
import { emacsRegexToJs, EmacsRegexError } from '../src/emacs-regex.js';

// ---- THE core behavior: unescaped ( ) { } | are literal ------------------

test('THE FEATURE: an unescaped ( is literal text, matching real Emacs semantics', () => {
  const re = emacsRegexToJs('meeting (draft)');
  assert.equal(re.test('a meeting (draft) note'), true);
  assert.equal(re.test('a meetingXdraftY note'), false);
});

test('THE FEATURE: an unescaped { } is literal text', () => {
  const re = emacsRegexToJs('config{prod}');
  assert.equal(re.test('config{prod}.json'), true);
});

test('THE FEATURE: an unescaped | is literal text', () => {
  const re = emacsRegexToJs('this | that');
  assert.equal(re.test('this | that'), true);
});

test('an ordinary phrase with several parens searches correctly with no escaping needed at all', () => {
  const re = emacsRegexToJs('call (Tue) re: budget (Q3)');
  assert.equal(re.test('call (Tue) re: budget (Q3) numbers'), true);
});

// ---- real grouping/alternation/intervals need a backslash ----------------

test('\\( \\) is a real capturing group', () => {
  const re = emacsRegexToJs('\\(foo\\|bar\\)baz');
  assert.equal(re.test('foobaz'), true);
  assert.equal(re.test('barbaz'), true);
  assert.equal(re.test('bazbaz'), false);
});

test('\\(?: is a shy (non-capturing) group', () => {
  const re = emacsRegexToJs('\\(?:foo\\|bar\\)baz');
  assert.equal(re.test('foobaz'), true);
  assert.equal(re.exec('foobaz').length, 1); // no capture group recorded
});

test('\\{n\\} \\{n,\\} \\{n,m\\} are interval counts', () => {
  assert.equal(emacsRegexToJs('a\\{3\\}').test('aaa'), true);
  assert.equal(emacsRegexToJs('a\\{3\\}').test('aa'), false);
  assert.equal(emacsRegexToJs('a\\{2,\\}').test('aa'), true);
  assert.equal(emacsRegexToJs('^a\\{2,4\\}$').test('aaa'), true);
  assert.equal(emacsRegexToJs('^a\\{2,4\\}$').test('a'), false);
  assert.equal(emacsRegexToJs('^a\\{2,4\\}$').test('aaaaa'), false);
});

test('backreferences use the same bare \\1-\\9 syntax as JS', () => {
  const re = emacsRegexToJs('\\(\\w+\\) \\1');
  assert.equal(re.test('hello hello'), true);
  assert.equal(re.test('hello world'), false);
});

test('nested groups with alternation', () => {
  const re = emacsRegexToJs('\\(foo\\(bar\\)?\\)');
  assert.equal(re.test('foo'), true);
  assert.equal(re.test('foobar'), true);
});

// ---- character classes ----------------------------------------------------

test('ordinary character classes work the same as JS', () => {
  assert.equal(emacsRegexToJs('[abc]').test('b'), true);
  assert.equal(emacsRegexToJs('[^abc]').test('d'), true);
  assert.equal(emacsRegexToJs('[a-z]+').test('hello'), true);
});

test('a ] immediately after [ or [^ is a literal member, not the closer', () => {
  assert.equal(emacsRegexToJs('[]a]').test(']'), true);
  assert.equal(emacsRegexToJs('[]a]').test('a'), true);
});

test('POSIX classes work anywhere inside a bracket expression, not just alone', () => {
  assert.equal(emacsRegexToJs('[[:digit:]]+').test('123'), true);
  assert.equal(emacsRegexToJs('[[:alpha:][:digit:]]+').test('a1b2'), true);
  assert.equal(emacsRegexToJs('[[:space:]]').test(' '), true);
  assert.equal(emacsRegexToJs('[[:upper:]][[:lower:]]+').test('Hello'), true);
});

test('THE FEATURE: a POSIX class combined with literal characters in the same bracket expression', () => {
  const re = emacsRegexToJs('[[:digit:]xyz]+');
  assert.equal(re.test('123xyz'), true);
});

test('an unknown POSIX class throws a clear error', () => {
  assert.throws(() => emacsRegexToJs('[[:bogus:]]'), EmacsRegexError);
});

// ---- word/symbol boundaries ------------------------------------------------

test('\\< and \\> match word start/end', () => {
  const re = emacsRegexToJs('\\<cat\\>');
  assert.equal(re.test('the cat sat'), true);
  assert.equal(re.test('concatenate'), false);
});

test('\\_< and \\_> match symbol start/end (word chars plus - and _)', () => {
  const re = emacsRegexToJs('\\_<my-var\\_>');
  assert.equal(re.test('let my-var = 1'), true);
  assert.equal(re.test('let my-variable = 1'), false);
});

test('\\b and \\B pass through as JS word boundaries', () => {
  assert.equal(emacsRegexToJs('\\bcat\\b').test('a cat sat'), true);
  assert.equal(emacsRegexToJs('\\Bcat').test('concat'), true);
});

// ---- buffer/string anchors -------------------------------------------------

test('^ and $ are line anchors (multiline), matching real Emacs default behavior in a buffer', () => {
  const re = emacsRegexToJs('^second');
  assert.equal(re.test('first\nsecond line'), true);
});

test("\\` and \\' are whole-string anchors, distinct from line-anchored ^ and $", () => {
  const startRe = emacsRegexToJs("\\`first");
  assert.equal(startRe.test('first\nsecond'), true);
  assert.equal(startRe.test('not first\nsecond'), false);
  const endRe = emacsRegexToJs("end\\'");
  assert.equal(endRe.test('first\nend'), true);
  assert.equal(endRe.test('end\nfirst'), false);
});

// ---- \w \W \s- \sw ----------------------------------------------------------

test('\\w and \\W pass through to JS equivalents', () => {
  assert.equal(emacsRegexToJs('\\w+').test('hello'), true);
  assert.equal(emacsRegexToJs('\\W').test('!'), true);
});

test('\\s- and \\sw map to whitespace/word syntax classes', () => {
  assert.equal(emacsRegexToJs('a\\s-b').test('a b'), true);
  assert.equal(emacsRegexToJs('\\sw+').test('hello'), true);
});

// ---- error cases -----------------------------------------------------------

test('unmatched \\( throws a clear error', () => {
  assert.throws(() => emacsRegexToJs('\\(foo'), EmacsRegexError);
});

test('unmatched \\) throws a clear error', () => {
  assert.throws(() => emacsRegexToJs('foo\\)'), EmacsRegexError);
});

test('an unterminated character class throws a clear error', () => {
  assert.throws(() => emacsRegexToJs('[abc'), EmacsRegexError);
});

test('a trailing backslash throws a clear error', () => {
  assert.throws(() => emacsRegexToJs('foo\\'), EmacsRegexError);
});

test('an unterminated \\{ interval throws a clear error', () => {
  assert.throws(() => emacsRegexToJs('a\\{3'), EmacsRegexError);
});

test('a malformed interval body throws a clear error', () => {
  assert.throws(() => emacsRegexToJs('a\\{abc\\}'), EmacsRegexError);
});

test('syntax-table-dependent escapes throw a clear, specific error rather than silently miscompiling', () => {
  assert.throws(() => emacsRegexToJs('\\s<'), EmacsRegexError);
  assert.throws(() => emacsRegexToJs('\\s>'), EmacsRegexError);
  assert.throws(() => emacsRegexToJs('\\sc'), EmacsRegexError);
  assert.throws(() => emacsRegexToJs('\\S-'), EmacsRegexError);
});

// ---- flags -----------------------------------------------------------------

test('the m flag is always applied even if not explicitly passed', () => {
  const re = emacsRegexToJs('^b');
  assert.ok(re.flags.includes('m'));
});

test('an explicit i flag for case-insensitivity is honored, not added automatically otherwise', () => {
  assert.equal(emacsRegexToJs('CAT').test('cat'), false);
  assert.equal(emacsRegexToJs('CAT', 'i').test('cat'), true);
});

// ---- escaped literals pass straight through --------------------------------

test('escaped metacharacters mean the same literal thing in both dialects', () => {
  assert.equal(emacsRegexToJs('3\\.5').test('3.5'), true);
  assert.equal(emacsRegexToJs('3\\.5').test('3X5'), false);
  assert.equal(emacsRegexToJs('a\\*b').test('a*b'), true);
});
