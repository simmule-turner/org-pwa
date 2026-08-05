import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import { parseStartupConfig, DEFAULT_STARTUP_CONFIG, getEffectiveVisibility, getEffectiveImageVisibility } from '../src/startup-config.js';

test('defaults apply when there is no #+STARTUP line at all', () => {
  const doc = parseOrg('* A heading');
  assert.deepEqual(parseStartupConfig(doc), DEFAULT_STARTUP_CONFIG);
});

test('parses a single #+STARTUP line covering both categories', () => {
  const doc = parseOrg('#+STARTUP: overview inlineimages\n* A heading');
  assert.deepEqual(parseStartupConfig(doc), {
    visibility: 'overview',
    imageVisibility: 'inlineimages',
    logDone: null,
  });
});

test('none, some, or both categories can be specified — unspecified ones keep their default', () => {
  const doc = parseOrg('#+STARTUP: inlineimages\n* A heading');
  assert.deepEqual(parseStartupConfig(doc), {
    visibility: 'showeverything',
    imageVisibility: 'inlineimages',
    logDone: null,
  });
});

test('within one line, the last conflicting keyword in the same category wins', () => {
  const doc = parseOrg('#+STARTUP: overview content showall\n* A heading');
  assert.equal(parseStartupConfig(doc).visibility, 'showall');
});

test('across multiple #+STARTUP lines, the later line wins for that category', () => {
  const doc = parseOrg(['#+STARTUP: overview', '#+STARTUP: showall', '* A heading'].join('\n'));
  assert.equal(parseStartupConfig(doc).visibility, 'showall');
});

test('multiple #+STARTUP lines can each set a different category without conflicting', () => {
  const doc = parseOrg(['#+STARTUP: overview', '#+STARTUP: inlineimages', '* A heading'].join('\n'));
  assert.deepEqual(parseStartupConfig(doc), {
    visibility: 'overview',
    imageVisibility: 'inlineimages',
    logDone: null,
  });
});

test('unrecognized #+STARTUP tokens are ignored rather than erroring — including the removed archived/noarchived, which were never real org syntax', () => {
  const doc = parseOrg('#+STARTUP: logdone archived noarchived hidestars overview\n* A heading');
  const config = parseStartupConfig(doc);
  assert.equal(config.visibility, 'overview');
  assert.equal('archiveVisibility' in config, false);
});

test('is case-sensitive to the #+STARTUP key but not fooled by unrelated #+ keywords', () => {
  const doc = parseOrg('#+title: My file\n#+STARTUP: overview\n* A heading');
  assert.equal(parseStartupConfig(doc).visibility, 'overview');
});

// ---- org-log-done via #+STARTUP: logdone / lognotedone ------------------

test('#+STARTUP: logdone sets logDone to \u0027time\u0027', () => {
  const doc = parseOrg('#+STARTUP: logdone\n* A heading');
  assert.equal(parseStartupConfig(doc).logDone, 'time');
});

test('#+STARTUP: lognotedone sets logDone to \u0027note\u0027', () => {
  const doc = parseOrg('#+STARTUP: lognotedone\n* A heading');
  assert.equal(parseStartupConfig(doc).logDone, 'note');
});

test('logdone/lognotedone combine correctly with the other #+STARTUP categories on the same line', () => {
  const doc = parseOrg('#+STARTUP: overview inlineimages logdone\n* A heading');
  const config = parseStartupConfig(doc);
  assert.equal(config.visibility, 'overview');
  assert.equal(config.imageVisibility, 'inlineimages');
  assert.equal(config.logDone, 'time');
});

test('a later #+STARTUP line\u0027s logdone/lognotedone wins over an earlier one, same as the other categories', () => {
  const doc = parseOrg(['#+STARTUP: logdone', '#+STARTUP: lognotedone', '* A heading'].join('\n'));
  assert.equal(parseStartupConfig(doc).logDone, 'note');
});

test('no logdone/lognotedone keyword anywhere leaves logDone null (no logging), matching real org\u0027s own actual default', () => {
  const doc = parseOrg('* A heading, no #+STARTUP at all');
  assert.equal(parseStartupConfig(doc).logDone, null);
});

// ---- getEffectiveVisibility (org-startup-folded, 3-layer precedence) -------

test('getEffectiveVisibility: falls back to the documented default (showeverything) when nothing anywhere sets it', () => {
  const doc = parseOrg('* A heading');
  assert.equal(getEffectiveVisibility(doc, {}, {}), 'showeverything');
});

test('getEffectiveVisibility: Global Variables alone is honored', () => {
  const doc = parseOrg('* A heading');
  assert.equal(getEffectiveVisibility(doc, {}, { 'org-startup-folded': 'content' }), 'content');
});

test('getEffectiveVisibility: an explicit #+STARTUP: keyword overrides Global Variables', () => {
  const doc = parseOrg('#+STARTUP: overview\n* A heading');
  assert.equal(getEffectiveVisibility(doc, {}, { 'org-startup-folded': 'content' }), 'overview');
});

test('getEffectiveVisibility: Local Variables overrides both #+STARTUP: and Global Variables', () => {
  const doc = parseOrg('#+STARTUP: overview\n* A heading');
  assert.equal(
    getEffectiveVisibility(doc, { 'org-startup-folded': 'showall' }, { 'org-startup-folded': 'content' }),
    'showall'
  );
});

test('getEffectiveVisibility: a file with NO #+STARTUP: visibility keyword correctly falls through to Global Variables, not silently masked by parseStartupConfig\u2019s own default', () => {
  // The critical case this whole refactor exists for: a file with #+STARTUP: for
  // something else entirely (e.g. just logdone) must not be treated as having
  // "explicitly set showeverything" just because that's what parseStartupConfig's
  // own defaulted .visibility field happens to equal.
  const doc = parseOrg('#+STARTUP: logdone\n* A heading');
  assert.equal(getEffectiveVisibility(doc, {}, { 'org-startup-folded': 'content' }), 'content');
});

test('getEffectiveVisibility: accepts the Lisp quoted-symbol form (\u0027showall) equally to the bare word', () => {
  const doc = parseOrg('* A heading');
  assert.equal(getEffectiveVisibility(doc, { 'org-startup-folded': "'showall" }, {}), 'showall');
});

test('getEffectiveVisibility: an invalid value at a layer is treated as that layer not setting anything, falling through to the next', () => {
  const doc = parseOrg('* A heading');
  assert.equal(getEffectiveVisibility(doc, { 'org-startup-folded': 'garbage' }, { 'org-startup-folded': 'content' }), 'content');
});

// ---- getEffectiveImageVisibility (org-startup-with-inline-images, 3-layer) -

test('getEffectiveImageVisibility: falls back to the documented default (nil / noinlineimages) when nothing anywhere sets it', () => {
  const doc = parseOrg('* A heading');
  assert.equal(getEffectiveImageVisibility(doc, {}, {}), 'noinlineimages');
});

test('getEffectiveImageVisibility: Global Variables alone is honored', () => {
  const doc = parseOrg('* A heading');
  assert.equal(getEffectiveImageVisibility(doc, {}, { 'org-startup-with-inline-images': 't' }), 'inlineimages');
});

test('getEffectiveImageVisibility: an explicit #+STARTUP: keyword overrides Global Variables', () => {
  const doc = parseOrg('#+STARTUP: inlineimages\n* A heading');
  assert.equal(getEffectiveImageVisibility(doc, {}, { 'org-startup-with-inline-images': 'nil' }), 'inlineimages');
});

test('getEffectiveImageVisibility: Local Variables overrides both #+STARTUP: and Global Variables', () => {
  const doc = parseOrg('#+STARTUP: inlineimages\n* A heading');
  assert.equal(
    getEffectiveImageVisibility(doc, { 'org-startup-with-inline-images': 'nil' }, { 'org-startup-with-inline-images': 'nil' }),
    'noinlineimages'
  );
});

test('getEffectiveImageVisibility: a file with NO #+STARTUP: image keyword correctly falls through to Global Variables', () => {
  const doc = parseOrg('#+STARTUP: overview\n* A heading');
  assert.equal(getEffectiveImageVisibility(doc, {}, { 'org-startup-with-inline-images': 't' }), 'inlineimages');
});

test('getEffectiveImageVisibility: an explicit nil at a layer is correctly distinguished from that layer not setting anything at all', () => {
  // A layer explicitly saying "nil" must win over a lower layer saying "t" --
  // this only works if nil is represented distinctly from "unset", not collapsed
  // into the same falsy value.
  const doc = parseOrg('* A heading');
  assert.equal(getEffectiveImageVisibility(doc, { 'org-startup-with-inline-images': 'nil' }, { 'org-startup-with-inline-images': 't' }), 'noinlineimages');
});
