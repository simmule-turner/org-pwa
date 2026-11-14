// org-crypt's cipher (src/pgp.js, OpenPGP.js) against gpg: what one writes, the other reads, with a passphrase and with keys.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { keyMatches, makePgpCipher, mergeKeys, openPgp, readKeyBlock } from '../src/pgp.js';

const PLAIN = 'Account: 12345  \nPIN: 0000\n\n** Child\n  indented ünï\n';
const hasGpg = spawnSync('gpg', ['--version']).status === 0;

async function newKey(passphrase) {
  const pgp = await openPgp();
  const { privateKey } = await pgp.generateKey({ type: 'ecc', curve: 'curve25519', userIDs: [{ name: 'Alice Example', email: 'alice@example.com' }], passphrase, format: 'armored' });
  return privateKey;
}

test('a key block is read with its user IDs, and the secret part is kept apart', async () => {
  const [key] = await readKeyBlock(await newKey('pw'));
  assert.match(key.fingerprint, /^[0-9A-F]{40}$/);
  assert.deepEqual(key.userIds, ['Alice Example <alice@example.com>']);
  assert.match(key.publicArmored, /BEGIN PGP PUBLIC KEY BLOCK/);
  assert.match(key.privateArmored, /BEGIN PGP PRIVATE KEY BLOCK/);
  await assert.rejects(readKeyBlock('nothing'), /No PGP key/);
});

test('keys are found as gpg --list-keys finds them', async () => {
  const [key] = await readKeyBlock(await newKey('pw'));
  for (const name of ['alice', 'ALICE EXAMPLE', 'example.com', '<alice@example.com>', '@example.com', '=Alice Example <alice@example.com>', key.fingerprint, '0x' + key.fingerprint.slice(-16), key.fingerprint.slice(-8).toLowerCase()]) assert.ok(keyMatches(key, name), name);
  for (const name of ['', 'bob', '<example.com>', '=Alice', '@alice']) assert.ok(!keyMatches(key, name), name);
});

test('a key that is imported again keeps what it had and gains the secret part', async () => {
  const [full] = await readKeyBlock(await newKey('pw'));
  const onlyPublic = { ...full, privateArmored: undefined };
  delete onlyPublic.privateArmored;
  assert.equal(mergeKeys([onlyPublic], [full])[0].privateArmored, full.privateArmored);
  assert.equal(mergeKeys([full], [onlyPublic]).length, 1);
});

test('a passphrase message is read back, and a wrong passphrase is asked for again', async () => {
  const asked = [];
  const answers = ['one', 'wrong', 'one'];
  const cipher = makePgpCipher({ keyring: () => [], askPassphrase: async (r) => { asked.push(r); return answers.shift(); } });
  const message = await cipher.encrypt(PLAIN, null);
  assert.match(message, /^-----BEGIN PGP MESSAGE-----\n/);
  assert.ok(message.endsWith('-----END PGP MESSAGE-----\n'));
  assert.equal(await cipher.decrypt(message), PLAIN);
  assert.deepEqual(asked.map((a) => [a.kind, !!a.retry]), [['new', false], ['message', false], ['message', true]]);
  const wrong = makePgpCipher({ keyring: () => [], askPassphrase: async () => 'nope' });
  await assert.rejects(wrong.decrypt(message), /Bad passphrase/);
});

test('a message for a key is read back with the secret key and its passphrase', async () => {
  const ring = await readKeyBlock(await newKey('kp'));
  const cipher = makePgpCipher({ keyring: () => ring, askPassphrase: async (r) => { assert.equal(r.kind, 'key'); return 'kp'; } });
  const message = await cipher.encrypt(PLAIN, cipher.listKeys('alice'));
  assert.equal(await cipher.decrypt(message), PLAIN);
  const noSecret = makePgpCipher({ keyring: () => ring.map((k) => ({ ...k, privateArmored: undefined })), askPassphrase: async () => 'kp' });
  await assert.rejects(noSecret.decrypt(message), /No secret key/);
});

test('gpg reads what the cipher writes, and the cipher reads what gpg writes', { skip: !hasGpg }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gnupg-'));
  fs.chmodSync(home, 0o700);
  const env = { ...process.env, GNUPGHOME: home };
  const gpg = (args, input) => execFileSync('gpg', ['--batch', '--pinentry-mode', 'loopback', ...args], { env, input, stdio: ['pipe', 'pipe', 'ignore'] }).toString();
  // a passphrase, both ways
  const cipher = makePgpCipher({ keyring: () => [], askPassphrase: async () => 'secret' });
  const sym = path.join(home, 'sym.asc');
  fs.writeFileSync(sym, await cipher.encrypt(PLAIN, null));
  assert.equal(gpg(['--passphrase', 'secret', '-d', sym]), PLAIN);
  const fromGpg = gpg(['--passphrase', 'secret', '--armor', '--textmode', '-c', '-o', '-'], PLAIN);
  assert.equal(await cipher.decrypt(fromGpg), PLAIN);
  // keys, both ways
  const armored = await newKey('kp');
  const ring = await readKeyBlock(armored);
  const keyed = makePgpCipher({ keyring: () => ring, askPassphrase: async () => 'kp' });
  const keyFile = path.join(home, 'key.asc');
  fs.writeFileSync(keyFile, armored);
  gpg(['--passphrase', 'kp', '--import', keyFile]);
  const pk = path.join(home, 'pk.asc');
  fs.writeFileSync(pk, await keyed.encrypt(PLAIN, keyed.listKeys('alice@example.com')));
  assert.equal(gpg(['--passphrase', 'kp', '-d', pk]), PLAIN);
  const toKey = gpg(['--armor', '--textmode', '--trust-model', 'always', '-r', 'alice@example.com', '-e', '-o', '-'], PLAIN);
  assert.equal(await keyed.decrypt(toKey), PLAIN);
});
