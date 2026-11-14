// examples/crypt.org: the entries gpg encrypted open with the app's cipher, and a plain entry becomes a message gpg opens.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { decryptEntries, encryptEntries } from '../src/org-crypt.js';
import { makePgpCipher, readKeyBlock } from '../src/pgp.js';

const text = fs.readFileSync(new URL('../examples/crypt.org', import.meta.url), 'utf8');

// The example key was made on the day of the release, after the fixed clock `npm test` runs under; OpenPGP checks signature times against the clock.
const withRealClock = async (/** @type {() => Promise<void>} */ fn) => {
  const fixed = globalThis.Date;
  globalThis.Date = /** @type {DateConstructor} */ (Object.getPrototypeOf(fixed).now ? Object.getPrototypeOf(fixed) : fixed);
  try { await fn(); } finally { globalThis.Date = fixed; }
};

test('the example entries open with their passphrase and with the example key', () => withRealClock(async () => {
  const ring = await readKeyBlock(fs.readFileSync(new URL('../examples/crypt-example-key.asc', import.meta.url), 'utf8'));
  const cipher = makePgpCipher({ keyring: () => ring, askPassphrase: async () => 'example' });
  const out = await decryptEntries(text, { cipher, key: '' });
  assert.match(out, /Bank PIN: 4711/);
  assert.match(out, /Recovery code: x7q2-91ma/);
  assert.doesNotMatch(out, /^-----BEGIN PGP MESSAGE/m);
  const again = await encryptEntries(out, { cipher, key: '' });
  assert.match(again, /\* Waiting to be encrypted :crypt:\n:PROPERTIES:\n:ID: [^\n]+\n:END:\n-----BEGIN PGP MESSAGE-----/);
  assert.doesNotMatch(again, /correct-horse/);
}));
