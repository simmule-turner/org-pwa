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
  validateSizeSetting,
  validateTimeoutSetting,
} from '../src/size-limits.js';
import { QUICK_SETTINGS_FIELDS } from '../src-browser/settings-fields.js';
import { mergeGlobalAndLocalVariables } from '../src/global-variables.js';
import { getSizeLimits } from '../src/size-limits.js';

const KB = 1024;
const MB = 1024 * KB;

test('parseSize reads sizes people type, and off', () => {
  assert.equal(parseSize('500KB'), 500 * KB);
  assert.equal(parseSize('2 MB'), 2 * MB);
  assert.equal(parseSize('1.5m'), 1.5 * MB);
  assert.equal(parseSize('1048576'), MB);
  for (const off of ['off', 'nil', 'none', 'no', '0']) assert.equal(parseSize(off), 0);
  for (const bad of ['big', '-1MB', '2 parsecs', '']) assert.equal(parseSize(bad), null);
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
  assert.match(refuse.message, /over the 2 MB limit.*Settings > Sync and storage > Size limits/);
});

test('a limit set to off never warns or refuses', () => {
  const limits = sizeLimitsOf({ 'org-xx-size-limit-org-file': 'off', 'large-file-warning-threshold': 'off' });
  assert.equal(checkSize('orgFile', 500 * MB, limits).ok, true);
  assert.equal(textCeiling(limits), 0, 'no ceiling when a text kind has no limit');
});

test('sizeLimitsOf reads the settings and falls back to the default for anything unreadable', () => {
  const limits = sizeLimitsOf({ 'org-xx-size-limit-image': '1MB', 'org-xx-size-limit-attachment-warn': 'banana', 'org-xx-fetch-timeout': '10' });
  assert.equal(limits.image.max, MB);
  assert.equal(limits.attachment.warn, 20 * MB);
  assert.equal(limits.fetchTimeoutSeconds, 10);
  assert.equal(sizeLimitsOf({ 'org-xx-fetch-timeout': 'off' }).fetchTimeoutSeconds, 0);
  assert.deepEqual(sizeLimitsOf(null), DEFAULT_SIZE_LIMITS);
});

test('settings validation says what is wrong and accepts good values', () => {
  assert.equal(validateSizeSetting('3MB'), null);
  assert.equal(validateSizeSetting('off'), null);
  assert.match(validateSizeSetting('lots'), /lots/);
  assert.equal(validateTimeoutSetting('30'), null);
  assert.equal(validateTimeoutSetting('off'), null);
  assert.match(validateTimeoutSetting('soon'), /soon/);
  assert.match(validateTimeoutSetting('99999'), /99999/);
});

test('every Size limits setting is a text field with a default and a validator that accepts that default', () => {
  const fields = QUICK_SETTINGS_FIELDS.filter((f) => f.section === 'Size limits');
  assert.equal(fields.length, 9);
  for (const f of fields) {
    assert.equal(f.type, 'text');
    assert.equal(f.validate(f.default), null, f.key);
    assert.match(f.key, /^(org-xx-(size-limit-|fetch-timeout)|large-file-warning-threshold$)/);
  }
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
