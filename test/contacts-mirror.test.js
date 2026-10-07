import test from 'node:test';
import assert from 'node:assert/strict';
import { UNSAVED_DOCUMENT_ID } from '../src/agenda.js';
import { parseOrg } from '../src/org-parser.js';
import { buildContactResources, contactUid, isOurContactResource, nextContactsSyncState, planContactsSync, resourceNameForContactUid, vcardText } from '../src/contacts-mirror.js';

const docs = (...texts) => texts.map((text, i) => ({ documentId: `c${i}.org`, doc: parseOrg(text) }));
const jane = '* Jane Doe\n:PROPERTIES:\n:EMAIL: jane@example.com\n:PHONE: 555-0100\n:END:\n';

test('each contact is one vCard with a UID after VERSION, CRLF line ends, stored under an orgpwa-....vcf name', () => {
  const resources = buildContactResources(docs(jane));
  assert.equal(resources.size, 1);
  const [[name, resource]] = [...resources];
  assert.match(name, /^orgpwa-.+\.vcf$/);
  assert.ok(isOurContactResource(name));
  const lines = resource.vcf.split('\r\n');
  assert.deepEqual(lines.slice(0, 3), ['BEGIN:VCARD', 'VERSION:3.0', `UID:${resource.uid}`]);
  assert.ok(lines.includes('FN:Jane Doe') && lines.includes('EMAIL:jane@example.com'));
  assert.equal(lines[lines.length - 2], 'END:VCARD');
  assert.equal(lines[lines.length - 1], '', 'ends with a line break');
  assert.equal(resource.documentId, 'c0.org');
  assert.ok(!resource.vcf.includes('\n') || resource.vcf.split('\n').every((l, i, a) => i === a.length - 1 || l.endsWith('\r')), 'every break is CRLF');
});

test('a contact\u2019s :ID: is its UID, and nothing about it changes between runs, so an unchanged contact sends nothing', () => {
  const text = '* Jane Doe\n:PROPERTIES:\n:ID: 6f1e-abc\n:EMAIL: jane@example.com\n:END:\n';
  const first = buildContactResources(docs(text));
  const second = buildContactResources(docs(text));
  const [[name, a]] = [...first];
  assert.equal(a.uid, '6f1e-abc@org-pwa');
  assert.deepEqual([...second.keys()], [name]);
  assert.equal(second.get(name).hash, a.hash);
  assert.deepEqual(planContactsSync(second, { [name]: { hash: a.hash, doc: 'c0.org' } }), { puts: [], deletes: [], unchanged: 1 });
});

test('editing a contact changes its fingerprint (so it is sent again) and keeps its name', () => {
  const before = buildContactResources(docs('* Jane\n:PROPERTIES:\n:ID: j1\n:EMAIL: old@example.com\n:END:\n'));
  const after = buildContactResources(docs('* Jane\n:PROPERTIES:\n:ID: j1\n:EMAIL: new@example.com\n:END:\n'));
  const [[name, b]] = [...before];
  assert.deepEqual([...after.keys()], [name]);
  assert.notEqual(after.get(name).hash, b.hash);
  assert.deepEqual(planContactsSync(after, { [name]: { hash: b.hash, doc: 'c0.org' } }).puts, [name]);
});

test('two contacts with one name get different UIDs and files, in one file and across files', () => {
  const same = '* Sam\n:PROPERTIES:\n:PHONE: 1\n:END:\n* Sam\n:PROPERTIES:\n:PHONE: 2\n:END:\n';
  const inOne = buildContactResources(docs(same));
  assert.equal(inOne.size, 2);
  assert.equal(new Set([...inOne.values()].map((r) => r.uid)).size, 2);
  const inTwo = buildContactResources(docs('* Sam\n:PROPERTIES:\n:PHONE: 1\n:END:\n', '* Sam\n:PROPERTIES:\n:PHONE: 2\n:END:\n'));
  assert.equal(inTwo.size, 2);
  assert.equal(new Set([...inTwo.values()].map((r) => r.uid)).size, 2);
});

test('ids that sanitize to the same text still end up with different UIDs and files', () => {
  const clash = '* A\n:PROPERTIES:\n:ID: x y\n:PHONE: 1\n:END:\n* B\n:PROPERTIES:\n:ID: x-y\n:PHONE: 2\n:END:\n';
  const resources = buildContactResources(docs(clash));
  assert.equal(resources.size, 2);
  assert.equal(new Set([...resources.values()].map((r) => r.uid)).size, 2);
});

test('Flat and Tree contacts both go, plain headings do not, and unsaved documents are never mirrored', () => {
  const mixed = '* Flat Fran\n:PROPERTIES:\n:EMAIL: f@example.com\n:END:\n* Tree Tom\n:PROPERTIES:\n:KIND: individual\n:FIELDTYPE: name\n:END:\n** t@example.com\n:PROPERTIES:\n:FIELDTYPE: email\n:END:\n* Plain heading\n';
  const names = [...buildContactResources(docs(mixed)).values()].map((r) => r.vcf.match(/^FN:(.*)$/m)[1]).sort();
  assert.deepEqual(names, ['Flat Fran', 'Tree Tom']);
  const unsaved = [{ documentId: UNSAVED_DOCUMENT_ID, doc: parseOrg(jane) }, { documentId: 'a.org', doc: null }, { documentId: '', doc: parseOrg(jane) }];
  assert.equal(buildContactResources(unsaved).size, 0);
});

test('only files this app named are its own: an orgpwa- .vcf, never a calendar file or a contact somebody else made', () => {
  assert.ok(isOurContactResource('orgpwa-jane-1a2b.vcf'));
  assert.ok(!isOurContactResource('jane.vcf'));
  assert.ok(!isOurContactResource('orgpwa-jane.ics'));
  assert.ok(!isOurContactResource('3f2a9c.vcf'));
});

test('vcardText keeps a UID a card already has, rather than writing a second', () => {
  assert.deepEqual(vcardText(['BEGIN:VCARD', 'VERSION:3.0', 'UID:mine', 'FN:X', 'END:VCARD'], 'other').split('\r\n').filter((l) => l.startsWith('UID')), ['UID:mine']);
});

test('a contact removed from a file that loaded is deleted from the server; one whose file did not load is kept', () => {
  const wanted = buildContactResources(docs('* Jane\n:PROPERTIES:\n:ID: j\n:EMAIL: j@example.com\n:END:\n'));
  const previous = { 'orgpwa-gone-1.vcf': { hash: 'h', doc: 'c0.org' }, 'orgpwa-elsewhere-2.vcf': { hash: 'h', doc: 'other.org' } };
  const plan = planContactsSync(wanted, previous, { loadedDocs: new Set(['c0.org']) });
  assert.deepEqual(plan.deletes, ['orgpwa-gone-1.vcf'], 'other.org did not load, so its contact stays');
  assert.equal(plan.puts.length, 1);
});

test('what is remembered after a run: what was sent, and what failed is left to try again', () => {
  const wanted = buildContactResources(docs('* A\n:PROPERTIES:\n:ID: a\n:PHONE: 1\n:END:\n* B\n:PROPERTIES:\n:ID: b\n:PHONE: 2\n:END:\n'));
  const [nameA, nameB] = [...wanted.keys()];
  const next = nextContactsSyncState({}, wanted, { putOk: new Set([nameA]), deleteOk: new Set() });
  assert.deepEqual(Object.keys(next), [nameA], 'B failed, so it is not remembered as sent');
  assert.deepEqual(next[nameA], { hash: wanted.get(nameA).hash, doc: 'c0.org' });
  assert.ok(nameB);
});

test('names and UIDs are stable functions of the id', () => {
  assert.equal(resourceNameForContactUid('a@org-pwa'), resourceNameForContactUid('a@org-pwa'));
  assert.notEqual(resourceNameForContactUid('a@org-pwa'), resourceNameForContactUid('b@org-pwa'));
  assert.equal(contactUid('f.org', { title: 'Jane Doe', properties: {} }, 0), 'f.org-Jane-Doe-contact-0@org-pwa');
});
