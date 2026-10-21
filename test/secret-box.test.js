import test from 'node:test';
import assert from 'node:assert/strict';
import { newKdf, deriveKey, encryptText, decryptText, makeCheck, verifyCheck, isEnvelope, isKdf } from '../src/secret-box.js';
import { sealConnection, revealConnection, lockedConnection, maskedConnection, MASK, hasEnvelopes, PROTECTED_FIELDS } from '../src/connection-secrets.js';

const FAST = 10000; // enough for tests; the app uses 600,000

test('a secret round-trips, and the envelope shows nothing of it', async () => {
  const kdf = newKdf(FAST);
  const key = await deriveKey('correct horse', kdf);
  const env = await encryptText('ghp_secret_token', key);
  assert.ok(isEnvelope(env));
  assert.ok(!JSON.stringify(env).includes('ghp_secret_token'));
  assert.equal(await decryptText(env, key), 'ghp_secret_token');
});

test('each encryption of the same text differs (a fresh IV)', async () => {
  const key = await deriveKey('pw', newKdf(FAST));
  const a = await encryptText('same', key);
  const b = await encryptText('same', key);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ct, b.ct);
});

test('a wrong passphrase, another salt, or a changed envelope fails', async () => {
  const kdf = newKdf(FAST);
  const key = await deriveKey('right', kdf);
  const env = await encryptText('secret', key);
  await assert.rejects(decryptText(env, await deriveKey('wrong', kdf)));
  await assert.rejects(decryptText(env, await deriveKey('right', newKdf(FAST))));
  const bytes = Buffer.from(env.ct, 'base64');
  bytes[0] ^= 1;
  await assert.rejects(decryptText({ ...env, ct: bytes.toString('base64') }, key));
});

test('the check tells a wrong passphrase from a right one', async () => {
  const kdf = newKdf(FAST);
  const key = await deriveKey('right', kdf);
  const check = await makeCheck(key);
  assert.equal(await verifyCheck(check, key), true);
  assert.equal(await verifyCheck(check, await deriveKey('wrong', kdf)), false);
  assert.equal(await verifyCheck({ nonsense: 1 }, key), false);
});

test('key settings are read from what is stored, and weak or odd ones are refused', async () => {
  assert.equal(isKdf(newKdf()), true);
  assert.equal(isKdf({ name: 'PBKDF2-SHA256', iter: 1, salt: 'AAAAAAAAAAAAAAAAAAAAAA==' }), false);
  assert.equal(isKdf({ name: 'other', iter: 600000, salt: 'AAAAAAAAAAAAAAAAAAAAAA==' }), false);
  await assert.rejects(deriveKey('pw', { name: 'PBKDF2-SHA256', iter: 5, salt: 'AAAAAAAAAAAAAAAAAAAAAA==' }));
});

test('only the logins are sealed; addresses stay readable; empty fields stay empty', async () => {
  const key = await deriveKey('pw', newKdf(FAST));
  const github = await sealConnection('github', { token: 'ghp_abc', owner: 'octocat', repo: 'notes', branch: 'main' }, key);
  assert.ok(isEnvelope(github.token) && isEnvelope(github.owner));
  assert.equal(github.repo, 'notes');
  assert.equal(github.branch, 'main');
  const dav = await sealConnection('webdav', { baseUrl: 'https://dav.example/', username: 'me', password: '' }, key);
  assert.ok(isEnvelope(dav.username));
  assert.equal(dav.password, '');
  assert.equal(dav.baseUrl, 'https://dav.example/');
  const cal = await sealConnection('caldav', { url: 'https://c/', contactsUrl: 'https://b/', username: 'u', password: 'p' }, key);
  assert.deepEqual(Object.keys(PROTECTED_FIELDS), ['github', 'webdav', 'caldav']);
  assert.ok(isEnvelope(cal.username) && isEnvelope(cal.password));
  assert.equal(cal.url, 'https://c/');
  assert.equal(JSON.stringify([github, dav, cal]).includes('ghp_abc'), false);
});

test('revealing gives the plain connection back, and the locked view hides the protected fields', async () => {
  const key = await deriveKey('pw', newKdf(FAST));
  const plain = { token: 'ghp_abc', owner: 'octocat', repo: 'notes', branch: 'main' };
  const sealed = await sealConnection('github', plain, key);
  assert.equal(hasEnvelopes('github', sealed), true);
  assert.equal(hasEnvelopes('github', plain), false);
  assert.deepEqual(await revealConnection('github', sealed, key), plain);
  assert.deepEqual(lockedConnection('github', sealed), { token: MASK, owner: MASK, repo: 'notes', branch: 'main', locked: true });
  await assert.rejects(revealConnection('github', sealed, await deriveKey('other', newKdf(FAST))));
});

test('the masked view keeps readable fields, masks set secrets and leaves empty ones empty', () => {
  assert.deepEqual(maskedConnection('webdav', { baseUrl: 'https://x', username: 'u', password: '' }), { baseUrl: 'https://x', username: MASK, password: '' });
});
