import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SIZE_LIMITS,
  SizeLimitError,
  assertWithinCeiling,
  assertWithinLimit,
  base64Bytes,
  checkSize,
  formatSize,
  parseSize,
  setSizeLimits,
  sizeLimitsOf,
  textCeiling,
  utf8Length,
} from '../src/size-limits.js';
import { VARIABLE_CATALOG } from '../src/variable-catalog.js';
import { mergeGlobalAndLocalVariables } from '../src/global-variables.js';
import { getSizeLimits } from '../src/size-limits.js';

const KB = 1024;
const MB = 1024 * KB;

test('parseSize reads the sizes a variable holds, and nil', () => {
  assert.equal(parseSize('500KB'), 500 * KB);
  assert.equal(parseSize('2 MB'), 2 * MB);
  assert.equal(parseSize('1.5m'), 1.5 * MB);
  assert.equal(parseSize('1048576'), MB);
  assert.equal(parseSize('"2MB"'), 2 * MB, 'a Lisp string');
  for (const none of ['nil', '0']) assert.equal(parseSize(none), 0);
  for (const bad of ['off', 'big', '-1MB', '2 parsecs', '']) assert.equal(parseSize(bad), null);
});

test('formatSize writes sizes back, off for 0', () => {
  assert.equal(formatSize(0), 'off');
  assert.equal(formatSize(500 * KB), '500 KB');
  assert.equal(formatSize(1.5 * MB), '1.5 MB');
  assert.equal(formatSize(12), '12 bytes');
});

test('the default limits are the ones agreed: 500 KB asks and 2 MB refuses an Org file, 3 MB image, 20 MB asks and 95 MB refuses an attachment', () => {
  const d = DEFAULT_SIZE_LIMITS;
  assert.deepEqual([d.orgFile.warn, d.orgFile.max, d.image.max, d.attachment.warn, d.attachment.max], [500 * KB, 2 * MB, 3 * MB, 20 * MB, 95 * MB]);
  assert.deepEqual([d.bibliography.max, d.setupfile.max, d.fetchTimeoutSeconds], [5 * MB, 1 * MB, 30]);
});

test('checkSize: ok up to and including the warn limit, then warn, then refuse above max', () => {
  assert.equal(checkSize('orgFile', 500 * KB).ok, true);
  const warn = checkSize('orgFile', 500 * KB + 1, undefined, 'big.org');
  assert.equal(warn.ok, 'warn');
  assert.match(warn.message, /"big\.org" is 500 KB\. This is large and may be slow\. Open anyway\?/);
  assert.equal(checkSize('orgFile', 2 * MB).ok, 'warn');
  const refuse = checkSize('orgFile', 2 * MB + 1, undefined, 'big.org');
  assert.equal(refuse.ok, false);
  assert.match(refuse.message, /over the 2 MB limit.*org-xx-size-limit-org-file in Global Variables/);
});

test('a limit set to nil never warns or refuses', () => {
  const limits = sizeLimitsOf({ 'org-xx-size-limit-org-file': 'nil', 'large-file-warning-threshold': 'nil' });
  assert.equal(checkSize('orgFile', 500 * MB, limits).ok, true);
  assert.equal(textCeiling(limits), 0, 'no ceiling when a text kind has no limit');
});

test('sizeLimitsOf reads the settings, keeps the default for what is unset, and names a value that is not a size', () => {
  const limits = sizeLimitsOf({ 'org-xx-size-limit-image': '1MB', 'org-xx-fetch-timeout': '10' });
  assert.equal(limits.image.max, MB);
  assert.equal(limits.attachment.warn, 20 * MB);
  assert.throws(() => sizeLimitsOf({ 'org-xx-size-limit-attachment-warn': 'banana' }), /org-xx-size-limit-attachment-warn is "banana"/);
  assert.throws(() => sizeLimitsOf({ 'org-xx-fetch-timeout': 'soon' }), /org-xx-fetch-timeout is "soon"/);
  assert.equal(limits.fetchTimeoutSeconds, 10);
  assert.equal(sizeLimitsOf({ 'org-xx-fetch-timeout': 'nil' }).fetchTimeoutSeconds, 0);
  assert.deepEqual(sizeLimitsOf(null), DEFAULT_SIZE_LIMITS);
});

test('the catalog prints the limits the app has by default', () => {
  const by = Object.fromEntries(VARIABLE_CATALOG.map((c) => [c.name, c.default]));
  const d = DEFAULT_SIZE_LIMITS;
  for (const [name, bytes] of /** @type {[string, number][]} */ ([
    ['large-file-warning-threshold', d.orgFile.warn], ['org-xx-size-limit-org-file', d.orgFile.max], ['org-xx-size-limit-image', d.image.max],
    ['org-xx-size-limit-attachment-warn', d.attachment.warn], ['org-xx-size-limit-attachment', d.attachment.max],
    ['org-xx-size-limit-bibliography', d.bibliography.max], ['org-xx-size-limit-setupfile', d.setupfile.max], ['org-xx-size-limit-include', d.include.max],
  ])) assert.equal(parseSize(by[name]), bytes, name);
  assert.equal(by['org-xx-fetch-timeout'], String(d.fetchTimeoutSeconds));
});

test('changing a setting changes the limits in force', () => {
  try {
    mergeGlobalAndLocalVariables({ 'org-xx-size-limit-org-file': '10MB' }, {});
    assert.equal(getSizeLimits().orgFile.max, 10 * MB);
    mergeGlobalAndLocalVariables({}, {});
    assert.equal(getSizeLimits().orgFile.max, 2 * MB);
  } finally {
    setSizeLimits(sizeLimitsOf({}));
  }
});

test('assertWithinLimit and assertWithinCeiling throw a SizeLimitError that names the file', () => {
  assert.doesNotThrow(() => assertWithinLimit('orgFile', 2 * MB));
  assert.throws(() => assertWithinLimit('orgFile', 2 * MB + 1, 'a.org'), (e) => e instanceof SizeLimitError && e.kind === 'orgFile' && e.bytes === 2 * MB + 1 && /a\.org/.test(e.message));
  assert.equal(textCeiling(), 5 * MB);
  assert.doesNotThrow(() => assertWithinCeiling(5 * MB));
  assert.throws(() => assertWithinCeiling(5 * MB + 1, 'x'), SizeLimitError);
});

test('utf8Length counts bytes, not characters; base64Bytes counts what base64 holds', () => {
  assert.equal(utf8Length('abc'), 3);
  assert.equal(utf8Length('é'), 2);
  assert.equal(utf8Length('€'), 3);
  assert.equal(utf8Length('😀'), 4);
  assert.equal(utf8Length('😀') , Buffer.byteLength('😀'));
  assert.equal(base64Bytes(Buffer.from('hello').toString('base64')), 5);
  assert.equal(base64Bytes(Buffer.from('hell').toString('base64')), 4);
  assert.equal(base64Bytes(Buffer.from('hel').toString('base64')), 3);
});
