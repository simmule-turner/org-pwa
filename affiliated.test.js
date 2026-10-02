import test from 'node:test';
import assert from 'node:assert/strict';
import { splitAffiliated, parseAttrOptions, cssLength, imageOptions, captionText } from '../src/affiliated.js';

test('only the leading run of affiliated-keyword lines is split off; the rest is untouched', () => {
  const { affiliated, rest } = splitAffiliated(['#+NAME: fig:one', '#+caption: A cat', '#+ATTR_HTML: :width 300', '[[file:cat.png]]', '#+CAPTION: later, not leading']);
  assert.deepEqual(affiliated.map((a) => [a.key, a.value]), [['NAME', 'fig:one'], ['CAPTION', 'A cat'], ['ATTR_HTML', ':width 300']]);
  assert.deepEqual(rest, ['[[file:cat.png]]', '#+CAPTION: later, not leading']);
});

test('ordinary paragraphs and other keywords are not affiliated', () => {
  assert.deepEqual(splitAffiliated(['Some text', '#+CAPTION: x']).affiliated, []);
  assert.deepEqual(splitAffiliated(['#+TITLE: Not affiliated', 'text']).affiliated, []);
  assert.deepEqual(splitAffiliated(['#+BEGIN_SRC js']).affiliated, []);
  assert.deepEqual(splitAffiliated([]), { affiliated: [], rest: [] });
});

test('the keywords org treats as affiliated are recognized, with an optional short caption in brackets', () => {
  const lines = ['#+NAME: n', '#+CAPTION[short]: Long caption', '#+ATTR_LATEX: :width 5cm', '#+HEADER: :var x=1', '#+HEADERS: :results silent', '#+RESULTS:'];
  assert.deepEqual(splitAffiliated(lines).affiliated.map((a) => a.key), ['NAME', 'CAPTION', 'ATTR_LATEX', 'HEADER', 'HEADERS', 'RESULTS']);
  assert.equal(captionText(splitAffiliated(lines).affiliated), 'Long caption');
});

test('several captions are joined with a space, as org does', () => {
  assert.equal(captionText(splitAffiliated(['#+CAPTION: First part', '#+CAPTION: and the second']).affiliated), 'First part and the second');
  assert.equal(captionText([]), '');
});

test('attribute options: each value runs up to the next :option', () => {
  assert.deepEqual(parseAttrOptions(':width 300 :alt A fluffy cat :align center'), { width: '300', alt: 'A fluffy cat', align: 'center' });
  assert.deepEqual(parseAttrOptions(':width 50%'), { width: '50%' });
  assert.deepEqual(parseAttrOptions(''), {});
  assert.deepEqual(parseAttrOptions('no options here'), {});
});

test('a size is only accepted if it is a plain length, so nothing arbitrary reaches a style', () => {
  assert.equal(cssLength('300'), '300px');
  assert.equal(cssLength('50%'), '50%');
  assert.equal(cssLength('12.5em'), '12.5em');
  assert.equal(cssLength('5cm'), null);
  assert.equal(cssLength('300; background:url(x)'), null);
  assert.equal(cssLength('expression(alert(1))'), null);
  assert.equal(cssLength(undefined), null);
});

test('image options come from ATTR_HTML, falling back to ATTR_ORG, and ATTR_HTML wins when both give one', () => {
  const org = splitAffiliated(['#+ATTR_ORG: :width 200 :height 100']).affiliated;
  assert.deepEqual(imageOptions(org), { width: '200px', height: '100px', center: false });
  const both = splitAffiliated(['#+ATTR_ORG: :width 200', '#+ATTR_HTML: :width 80% :align center']).affiliated;
  assert.deepEqual(imageOptions(both), { width: '80%', height: null, center: true });
  assert.deepEqual(imageOptions([]), { width: null, height: null, center: false });
});
