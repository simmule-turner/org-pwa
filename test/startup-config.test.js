import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import { parseStartupConfig, DEFAULT_STARTUP_CONFIG } from '../src/startup-config.js';

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
