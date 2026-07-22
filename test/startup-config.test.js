import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import { parseStartupConfig, DEFAULT_STARTUP_CONFIG } from '../src/startup-config.js';

test('defaults apply when there is no #+STARTUP line at all', () => {
  const doc = parseOrg('* A heading');
  assert.deepEqual(parseStartupConfig(doc), DEFAULT_STARTUP_CONFIG);
});

test('parses a single #+STARTUP line covering all three categories', () => {
  const doc = parseOrg('#+STARTUP: overview inlineimages noarchived\n* A heading');
  assert.deepEqual(parseStartupConfig(doc), {
    visibility: 'overview',
    imageVisibility: 'inlineimages',
    archiveVisibility: 'noarchived',
  });
});

test('none, some, or all three categories can be specified — unspecified ones keep their default', () => {
  const doc = parseOrg('#+STARTUP: inlineimages\n* A heading');
  assert.deepEqual(parseStartupConfig(doc), {
    visibility: 'showeverything',
    imageVisibility: 'inlineimages',
    archiveVisibility: 'archived',
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
  const doc = parseOrg(
    ['#+STARTUP: overview', '#+STARTUP: inlineimages', '#+STARTUP: noarchived', '* A heading'].join('\n')
  );
  assert.deepEqual(parseStartupConfig(doc), {
    visibility: 'overview',
    imageVisibility: 'inlineimages',
    archiveVisibility: 'noarchived',
  });
});

test('unrecognized #+STARTUP tokens are ignored rather than erroring', () => {
  const doc = parseOrg('#+STARTUP: logdone hidestars overview\n* A heading');
  assert.equal(parseStartupConfig(doc).visibility, 'overview');
});

test('is case-sensitive to the #+STARTUP key but not fooled by unrelated #+ keywords', () => {
  const doc = parseOrg('#+title: My file\n#+STARTUP: overview\n* A heading');
  assert.equal(parseStartupConfig(doc).visibility, 'overview');
});
