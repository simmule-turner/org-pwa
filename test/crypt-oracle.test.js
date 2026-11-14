// org-crypt against Emacs 29.3: which text is encrypted, where the message goes, what comes back, and when a message is reused.
// The cipher is a stand-in that gives each message a counter, as tools/gen-crypt-oracle.mjs does in Emacs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { decryptEntries, decryptEntry, encryptEntries, encryptEntry } from '../src/org-crypt.js';

const cases = JSON.parse(fs.readFileSync(new URL('./fixtures/crypt-oracle.json', import.meta.url), 'utf8'));
const hex = (s) => Buffer.from(s, 'utf8').toString('hex');

for (const c of cases) {
  test(`org-crypt: ${c.name}`, async () => {
    let counter = 0;
    const cipher = {
      listKeys: (name) => (['alice', 'bob', 'carol'].includes(name) ? [name] : []),
      encrypt: async (plain, recipients) => `-----BEGIN PGP MESSAGE-----\n\n${hex(`${++counter}|${(recipients || []).join(',')}|${plain}`)}\n-----END PGP MESSAGE-----\n`,
      decrypt: async (armored) => {
        const s = Buffer.from(/\n\n([0-9a-f]+)\n-----END/.exec(armored)[1], 'hex').toString('utf8');
        return s.slice(s.indexOf('|', s.indexOf('|') + 1) + 1);
      },
    };
    const options = { cipher, key: c.key === undefined ? '' : c.key, matcher: c.matcher, reuse: new Map() };
    let text = c.text;
    const lineStart = (n) => text.split('\n').slice(0, n).join('\n').length + (n ? 1 : 0);
    let result;
    try {
      for (const op of c.ops) {
        if (op.do === 'replace') text = text.replace(op.from, () => op.to);
        else if (op.do === 'encrypt-entries') text = await encryptEntries(text, options);
        else if (op.do === 'decrypt-entries') text = await decryptEntries(text, options);
        else if (op.do === 'encrypt-entry') text = await encryptEntry(text, lineStart(op.line), options);
        else text = await decryptEntry(text, lineStart(op.line), options);
      }
      result = text;
    } catch (e) {
      result = 'ERROR ' + e.message;
    }
    assert.equal(result, c.expected);
  });
}
