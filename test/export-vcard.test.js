
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import { exportToVcard } from '../src/export-vcard.js';

function docs(text, documentId = 'contacts.org') {
  return [{ documentId, doc: parseOrg(text) }];
}

test('a heading with no EMAIL property is silently skipped, not an error', () => {
  const vcf = exportToVcard(docs('* Not A Contact\nJust an ordinary heading.\n'));
  assert.equal(vcf, '');
});

test('a heading with EMAIL becomes a VCARD with FN, N, and EMAIL', () => {
  const vcf = exportToVcard(docs('* John Doe\n:PROPERTIES:\n:EMAIL: john.doe@example.com\n:END:\n'));
  assert.match(vcf, /BEGIN:VCARD/);
  assert.match(vcf, /VERSION:3\.0/);
  assert.match(vcf, /FN:John Doe/);
  assert.match(vcf, /N:Doe;John;;;/);
  assert.match(vcf, /EMAIL:john\.doe@example\.com/);
  assert.match(vcf, /END:VCARD/);
});

test('THE FEATURE: :IGNORE: t excludes an otherwise-valid contact entirely', () => {
  const vcf = exportToVcard(docs('* John Doe\n:PROPERTIES:\n:EMAIL: john.doe@example.com\n:IGNORE: t\n:END:\n'));
  assert.equal(vcf, '');
});

test(':IGNORE: with any other value does not exclude the contact', () => {
  const vcf = exportToVcard(docs('* John Doe\n:PROPERTIES:\n:EMAIL: john.doe@example.com\n:IGNORE: nil\n:END:\n'));
  assert.match(vcf, /BEGIN:VCARD/);
});

test('PHONE and CELL both map to TEL, CELL used when PHONE is absent', () => {
  const vcf1 = exportToVcard(docs('* A\n:PROPERTIES:\n:EMAIL: a@example.com\n:PHONE: +1-555-0100\n:END:\n'));
  assert.match(vcf1, /TEL:\+1-555-0100/);
  const vcf2 = exportToVcard(docs('* B\n:PROPERTIES:\n:EMAIL: b@example.com\n:CELL: +1-555-0200\n:END:\n'));
  assert.match(vcf2, /TEL:\+1-555-0200/);
});

test('WORK_PHONE maps to TEL;TYPE=WORK, distinct from plain PHONE', () => {
  const vcf = exportToVcard(
    docs('* A\n:PROPERTIES:\n:EMAIL: a@example.com\n:PHONE: +1-555-0100\n:WORK_PHONE: +1-555-0999\n:END:\n')
  );
  assert.match(vcf, /TEL:\+1-555-0100/);
  assert.match(vcf, /TEL;TYPE=WORK:\+1-555-0999/);
});

test('ADDRESS and ADR both map to ADR, placed in the street component, with commas correctly escaped', () => {
  const vcf = exportToVcard(docs('* A\n:PROPERTIES:\n:EMAIL: a@example.com\n:ADDRESS: 123 Main Street, New York, NY\n:END:\n'));
  assert.match(vcf, /ADR:;;123 Main Street\\, New York\\, NY;;;;/);
});

test('NICKNAME and NOTE map directly', () => {
  const vcf = exportToVcard(docs('* A\n:PROPERTIES:\n:EMAIL: a@example.com\n:NICKNAME: Ace\n:NOTE: Met at conference\n:END:\n'));
  assert.match(vcf, /NICKNAME:Ace/);
  assert.match(vcf, /NOTE:Met at conference/);
});

test('THE FEATURE: BDAY parses a bare YYYY-MM-DD with no description, unlike agenda.js\u2019s own stricter parseContactEvent', () => {
  const vcf = exportToVcard(docs('* John Doe\n:PROPERTIES:\n:EMAIL: john.doe@example.com\n:BIRTHDAY: 1985-05-12\n:END:\n'));
  assert.match(vcf, /BDAY:1985-05-12/);
});

test('BDAY also parses correctly when a trailing description is present (the org-contacts-anniversaries format)', () => {
  const vcf = exportToVcard(docs('* John Doe\n:PROPERTIES:\n:EMAIL: john.doe@example.com\n:BIRTHDAY: 1985-05-12 Birthday\n:END:\n'));
  assert.match(vcf, /BDAY:1985-05-12/);
});

test('an unparseable BIRTHDAY value is silently omitted, not an error', () => {
  const vcf = exportToVcard(docs('* John Doe\n:PROPERTIES:\n:EMAIL: john.doe@example.com\n:BIRTHDAY: not a date\n:END:\n'));
  assert.match(vcf, /BEGIN:VCARD/);
  assert.doesNotMatch(vcf, /BDAY/);
});

test('the birthdayProperty option honors a custom property key, matching org-contacts-birthday-property', () => {
  const vcf = exportToVcard(docs('* John Doe\n:PROPERTIES:\n:EMAIL: john.doe@example.com\n:EVENT: 1990-01-01\n:END:\n'));
  assert.doesNotMatch(vcf, /BDAY/); // default key BIRTHDAY, not present -- no BDAY
  const vcfCustom = exportToVcard(
    docs('* John Doe\n:PROPERTIES:\n:EMAIL: john.doe@example.com\n:EVENT: 1990-01-01\n:END:\n'),
    { birthdayProperty: 'EVENT' }
  );
  assert.match(vcfCustom, /BDAY:1990-01-01/);
});

test('a single-word headline (company, mononym) splits into just a family name with an empty given name', () => {
  const vcf = exportToVcard(docs('* Acme\n:PROPERTIES:\n:EMAIL: contact@acme.example\n:END:\n'));
  assert.match(vcf, /N:Acme;;;;/);
});

test('a long field value is folded per RFC 2425 (75-octet continuation lines)', () => {
  const longNote = 'N'.repeat(200);
  const vcf = exportToVcard(docs(`* A\n:PROPERTIES:\n:EMAIL: a@example.com\n:NOTE: ${longNote}\n:END:\n`));
  const rawLines = vcf.split('\r\n');
  for (const line of rawLines) {
    assert.ok(line.length <= 75, `line exceeds 75 octets: "${line.slice(0, 20)}..." (${line.length})`);
  }
  // Continuation lines start with a single space.
  const noteLineIndex = rawLines.findIndex((l) => l.startsWith('NOTE:'));
  assert.ok(noteLineIndex !== -1);
  assert.ok(rawLines[noteLineIndex + 1].startsWith(' '));
});

test('multiple documents are aggregated into one .vcf, each contact its own VCARD', () => {
  const docA = { documentId: 'a.org', doc: parseOrg('* Alice\n:PROPERTIES:\n:EMAIL: alice@example.com\n:END:\n') };
  const docB = { documentId: 'b.org', doc: parseOrg('* Bob\n:PROPERTIES:\n:EMAIL: bob@example.com\n:END:\n') };
  const vcf = exportToVcard([docA, docB]);
  assert.match(vcf, /FN:Alice/);
  assert.match(vcf, /FN:Bob/);
  assert.equal((vcf.match(/BEGIN:VCARD/g) || []).length, 2);
});

test('multiple contacts in one document each get their own VCARD', () => {
  const vcf = exportToVcard(
    docs('* Alice\n:PROPERTIES:\n:EMAIL: alice@example.com\n:END:\n* Bob\n:PROPERTIES:\n:EMAIL: bob@example.com\n:END:\n')
  );
  assert.equal((vcf.match(/BEGIN:VCARD/g) || []).length, 2);
});

test('a heading nested under a non-contact heading is still found and exported', () => {
  const vcf = exportToVcard(docs('* People\n** Alice\n:PROPERTIES:\n:EMAIL: alice@example.com\n:END:\n'));
  assert.match(vcf, /FN:Alice/);
});

test('scope restricts the export to just that heading\u2019s own subtree', () => {
  const doc = parseOrg(
    '* Alice\n:PROPERTIES:\n:EMAIL: alice@example.com\n:END:\n* Team\n** Bob\n:PROPERTIES:\n:EMAIL: bob@example.com\n:END:\n'
  );
  const teamHeading = doc.children.find((h) => h.title === 'Team');
  const vcf = exportToVcard([{ documentId: 'x.org', doc }], { scope: teamHeading });
  assert.doesNotMatch(vcf, /FN:Alice/);
  assert.match(vcf, /FN:Bob/);
});

test('an archived heading is excluded even with a valid EMAIL', () => {
  const vcf = exportToVcard(docs('* Alice :ARCHIVE:\n:PROPERTIES:\n:EMAIL: alice@example.com\n:END:\n'));
  assert.equal(vcf, '');
});

test('an empty result (no valid contacts anywhere) produces an empty string, not a malformed empty file', () => {
  const vcf = exportToVcard(docs('* Just a heading\nNo email here.\n'));
  assert.equal(vcf, '');
});

test('THE FEATURE: nameFilter (plain mode) matches only contacts whose own heading title contains the filter, case-insensitively', () => {
  const twoContacts = docs(
    '* Alice Smith\n:PROPERTIES:\n:EMAIL: alice@example.com\n:END:\n* Bob Jones\n:PROPERTIES:\n:EMAIL: bob@example.com\n:END:\n'
  );
  const vcf = exportToVcard(twoContacts, { nameFilter: 'alice' });
  assert.match(vcf, /FN:Alice Smith/);
  assert.doesNotMatch(vcf, /FN:Bob Jones/);
});

test('nameFilter matches ONLY the heading title, never a property value -- confirmed against the real org-contacts-export-as-vcard source, not assumed', () => {
  const twoContacts = docs(
    '* Alice\n:PROPERTIES:\n:EMAIL: alice@example.com\n:NOTE: mentions bob here\n:END:\n* Bob\n:PROPERTIES:\n:EMAIL: bob@example.com\n:END:\n'
  );
  const vcf = exportToVcard(twoContacts, { nameFilter: 'bob' });
  // Only Bob's own heading matches "bob" -- Alice's NOTE property
  // containing the word "bob" must NOT cause Alice to match too.
  assert.doesNotMatch(vcf, /FN:Alice/);
  assert.match(vcf, /FN:Bob/);
});

test('nameFilter (plain mode) treats special regex characters as literal text, not regex syntax', () => {
  const twoContacts = docs(
    '* Smith (Work)\n:PROPERTIES:\n:EMAIL: work@example.com\n:END:\n* Smith Home\n:PROPERTIES:\n:EMAIL: home@example.com\n:END:\n'
  );
  const vcf = exportToVcard(twoContacts, { nameFilter: 'Smith (Work)' });
  assert.match(vcf, /FN:Smith \(Work\)/);
  assert.doesNotMatch(vcf, /FN:Smith Home/);
});

test('THE FEATURE: nameFilter (regex mode) matches using a genuine regex pattern', () => {
  const threeContacts = docs(
    '* Alice\n:PROPERTIES:\n:EMAIL: a@example.com\n:END:\n* Alison\n:PROPERTIES:\n:EMAIL: b@example.com\n:END:\n* Bob\n:PROPERTIES:\n:EMAIL: c@example.com\n:END:\n'
  );
  const vcf = exportToVcard(threeContacts, { nameFilter: '^Ali', nameFilterRegex: true });
  assert.match(vcf, /FN:Alice/);
  assert.match(vcf, /FN:Alison/);
  assert.doesNotMatch(vcf, /FN:Bob/);
});

test('nameFilterRegex with an invalid pattern throws a clear, catchable error rather than silently matching nothing', () => {
  const contact = docs('* Alice\n:PROPERTIES:\n:EMAIL: a@example.com\n:END:\n');
  assert.throws(
    () => exportToVcard(contact, { nameFilter: '(unclosed', nameFilterRegex: true }),
    /Invalid regex/
  );
});

test('an empty or whitespace-only nameFilter is treated as no filter at all', () => {
  const twoContacts = docs(
    '* Alice\n:PROPERTIES:\n:EMAIL: a@example.com\n:END:\n* Bob\n:PROPERTIES:\n:EMAIL: b@example.com\n:END:\n'
  );
  const vcf = exportToVcard(twoContacts, { nameFilter: '   ' });
  assert.match(vcf, /FN:Alice/);
  assert.match(vcf, /FN:Bob/);
});
