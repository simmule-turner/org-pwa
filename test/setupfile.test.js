import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import { cacheSetupFile, missingSetupFiles, refreshSetupKeywords, setupFilePath } from '../src/setupfile.js';

test('setupfile: path as written, quotes and file: removed', () => {
  assert.equal(setupFilePath('"file:~/a b.setup"'), '~/a b.setup');
});

test('setupfile: keywords from the file appear in doc.keywords but never in the saved text', () => {
  cacheSetupFile('t1.setup', '#+TITLE: From setup\n#+TODO: WAIT | GONE\nnot a keyword\n');
  const text = '#+SETUPFILE: t1.setup\n#+AUTHOR: me\n* WAIT thing\n';
  const doc = parseOrg(text);
  assert.ok(doc.keywords.some((k) => k.key === 'TITLE' && k.value === 'From setup' && k.virtual));
  assert.equal(doc.children[0].todo, 'WAIT');
  assert.equal(serializeOrg(doc), text);
});

test('setupfile: nested files are followed once, cycles stop', () => {
  cacheSetupFile('a.setup', '#+SETUPFILE: b.setup\n#+LANGUAGE: de\n');
  cacheSetupFile('b.setup', '#+SETUPFILE: a.setup\n#+OPTIONS: toc:nil\n');
  const doc = parseOrg('#+SETUPFILE: a.setup\n* x\n');
  const keys = doc.keywords.filter((k) => k.virtual).map((k) => k.key);
  assert.deepEqual(keys.sort(), ['LANGUAGE', 'OPTIONS']);
});

test('setupfile: a refreshed live document gains keywords once the text arrives', () => {
  const doc = parseOrg('#+SETUPFILE: late.setup\n* x\n');
  assert.deepEqual(missingSetupFiles(['#+SETUPFILE: late.setup']), ['late.setup']);
  assert.equal(refreshSetupKeywords(doc), false);
  cacheSetupFile('late.setup', '#+TITLE: Late\n');
  assert.equal(refreshSetupKeywords(doc), true);
  assert.equal(doc.keywords.at(-1).value, 'Late');
  assert.equal(refreshSetupKeywords(doc), false);
});
