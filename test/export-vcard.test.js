
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import { exportToVcard } from '../src/export-vcard.js';
import { parseVcards, importVcardsAsOrgText } from '../src/import-vcard.js';

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

test('THE FEATURE: a flat-style contact with a phone but no email now correctly exports, per real RFC 6350 -- only FN is mandatory, email is optional', () => {
  const vcf = exportToVcard(docs('* Alice\n:PROPERTIES:\n:PHONE: 555-1234\n:END:\n'));
  assert.match(vcf, /FN:Alice/);
  assert.match(vcf, /TEL:555-1234/);
  assert.doesNotMatch(vcf, /EMAIL/);
});

test('a flat-style heading with NO recognized contact property at all is still not treated as a contact -- FN alone (its own title, which every heading trivially has) isn\u2019t enough for bulk export, matching real org-contacts-matcher\u2019s own actual logic', () => {
  const vcf = exportToVcard(docs('* Just a regular heading\nSome unrelated body text.\n'));
  assert.equal(vcf, '');
});

test('an empty result (no valid contacts anywhere) produces an empty string, not a malformed empty file', () => {
  const vcf = exportToVcard(docs('* Just a heading\nNo email here.\n'));
  assert.equal(vcf, '');
});

// ---- scope as an array (narrow-scope export) -------------------------

test('THE FEATURE: scope as an array of headings exports only those headings\u2019 own subtrees', () => {
  const parsed = parseOrg(
    '* Alice\n:PROPERTIES:\n:EMAIL: alice@example.com\n:END:\n* Bob\n:PROPERTIES:\n:EMAIL: bob@example.com\n:END:\n* Carol\n:PROPERTIES:\n:EMAIL: carol@example.com\n:END:\n'
  );
  const [alice, , carol] = parsed.children;
  const vcf = exportToVcard([{ documentId: 'doc1', doc: parsed }], { scope: [alice, carol] });
  assert.match(vcf, /FN:Alice/);
  assert.doesNotMatch(vcf, /FN:Bob/);
  assert.match(vcf, /FN:Carol/);
});

test('a single heading (not wrapped in an array) still works exactly as before, for the existing "Choose a heading" call site', () => {
  const parsed = parseOrg('* Alice\n:PROPERTIES:\n:EMAIL: alice@example.com\n:END:\n* Bob\n:PROPERTIES:\n:EMAIL: bob@example.com\n:END:\n');
  const [alice] = parsed.children;
  const vcf = exportToVcard([{ documentId: 'doc1', doc: parsed }], { scope: alice });
  assert.match(vcf, /FN:Alice/);
  assert.doesNotMatch(vcf, /FN:Bob/);
});

test('an array scope correctly exports each heading\u2019s own descendants too, not just the heading itself', () => {
  const parsed = parseOrg('* Team\n** Alice\n:PROPERTIES:\n:EMAIL: alice@example.com\n:END:\n* Solo\n:PROPERTIES:\n:EMAIL: solo@example.com\n:END:\n');
  const [team, solo] = parsed.children;
  const vcf = exportToVcard([{ documentId: 'doc1', doc: parsed }], { scope: [team, solo] });
  assert.match(vcf, /FN:Alice/);
  assert.match(vcf, /FN:Solo/);
});

test('an array scope with an ancestor/descendant overlap exports the shared contact only once, not twice', () => {
  const parsed = parseOrg('* Team\n** Alice\n:PROPERTIES:\n:EMAIL: alice@example.com\n:END:\n');
  const [team] = parsed.children;
  const [alice] = team.children;
  // Team and Alice are both in scope, and Alice is Team's own descendant --
  // without deduplication, Alice would be exported twice.
  const vcf = exportToVcard([{ documentId: 'doc1', doc: parsed }], { scope: [team, alice] });
  const matches = vcf.match(/FN:Alice/g) || [];
  assert.equal(matches.length, 1);
});

// ---- tree style --------------------------------------------------------

function treeDocs(orgText) {
  return [{ documentId: 'doc1', doc: parseOrg(orgText) }];
}

test('THE FEATURE: tree style exports a contact structured per the real org-vcard tree spec', () => {
  const doc = treeDocs(
    [
      '* Joan Smith',
      ':PROPERTIES:',
      ':KIND: individual',
      ':FIELDTYPE: name',
      ':END:',
      '** Mobile',
      '*** 0000 999 999',
      ':PROPERTIES:',
      ':FIELDTYPE: cell',
      ':END:',
      '** Email',
      '*** Work',
      '**** address1@example.com',
      ':PROPERTIES:',
      ':FIELDTYPE: email-work',
      ':END:',
    ].join('\n')
  );
  const vcf = exportToVcard(doc, { style: 'tree' });
  assert.match(vcf, /FN:Joan Smith/);
  assert.match(vcf, /TEL;TYPE=CELL:0000 999 999/);
  assert.match(vcf, /EMAIL;TYPE=WORK:address1@example\.com/);
});

test('tree style works with the alternative, equally-valid structure the real org-vcard README also documents (a grouping heading above the contact)', () => {
  const doc = treeDocs(
    [
      '* People',
      '** Joan Smith',
      ':PROPERTIES:',
      ':KIND: individual',
      ':FIELDTYPE: name',
      ':END:',
      '*** Cell',
      '**** 0000 999 999',
      ':PROPERTIES:',
      ':FIELDTYPE: cell',
      ':END:',
      '*** Email',
      '**** address1@example.com',
      ':PROPERTIES:',
      ':FIELDTYPE: email-work',
      ':PREFERRED:',
      ':END:',
    ].join('\n')
  );
  const vcf = exportToVcard(doc, { style: 'tree' });
  assert.match(vcf, /FN:Joan Smith/);
  assert.match(vcf, /TEL;TYPE=CELL:0000 999 999/);
  assert.match(vcf, /EMAIL;TYPE=WORK:address1@example\.com/);
});

test('THE FEATURE: a tree-style contact with a phone but no email now correctly exports, per real RFC 6350 -- only FN is mandatory, email is optional', () => {
  const doc = treeDocs(
    ['* Joan Smith', ':PROPERTIES:', ':KIND: individual', ':FIELDTYPE: name', ':END:', '** Cell', '*** 0000 999 999', ':PROPERTIES:', ':FIELDTYPE: cell', ':END:'].join(
      '\n'
    )
  );
  const vcf = exportToVcard(doc, { style: 'tree' });
  assert.match(vcf, /FN:Joan Smith/);
  assert.match(vcf, /TEL;TYPE=CELL:0000 999 999/);
  assert.doesNotMatch(vcf, /EMAIL/);
});

test('a bare contact heading with zero recognized descendant fields still exports a minimal, valid vCard (just FN\\/N), per real RFC 6350', () => {
  const doc = treeDocs(['* Joan Smith', ':PROPERTIES:', ':KIND: individual', ':FIELDTYPE: name', ':END:'].join('\n'));
  const vcf = exportToVcard(doc, { style: 'tree' });
  assert.match(vcf, /FN:Joan Smith/);
  assert.match(vcf, /BEGIN:VCARD/);
  assert.match(vcf, /END:VCARD/);
});

test('a heading missing KIND: individual, or FIELDTYPE: name, is not treated as a contact in tree style', () => {
  const doc = treeDocs('* Just a regular heading\n:PROPERTIES:\n:FIELDTYPE: name\n:END:\n');
  assert.equal(exportToVcard(doc, { style: 'tree' }), '');
  const doc2 = treeDocs('* Also not a contact\n:PROPERTIES:\n:KIND: individual\n:END:\n');
  assert.equal(exportToVcard(doc2, { style: 'tree' }), '');
});

test('tree style respects scope the same way flat style does', () => {
  const doc = treeDocs(
    [
      '* Alice',
      ':PROPERTIES:',
      ':KIND: individual',
      ':FIELDTYPE: name',
      ':END:',
      '** Email',
      '*** a@example.com',
      ':PROPERTIES:',
      ':FIELDTYPE: email',
      ':END:',
      '* Bob',
      ':PROPERTIES:',
      ':KIND: individual',
      ':FIELDTYPE: name',
      ':END:',
      '** Email',
      '*** b@example.com',
      ':PROPERTIES:',
      ':FIELDTYPE: email',
      ':END:',
    ].join('\n')
  );
  const [alice] = doc[0].doc.children;
  const vcf = exportToVcard(doc, { style: 'tree', scope: alice });
  assert.match(vcf, /FN:Alice/);
  assert.doesNotMatch(vcf, /FN:Bob/);
});

// ---- address-work/address-home fieldtypes, and note-as-VERSE-block -------

test('THE FEATURE: address-work and address-home fieldtypes export as ADR;TYPE=WORK and ADR;TYPE=HOME', () => {
  const doc = treeDocs(
    [
      '* Alice',
      ':PROPERTIES:',
      ':KIND: individual',
      ':FIELDTYPE: name',
      ':END:',
      '** 1 Work Way',
      ':PROPERTIES:',
      ':FIELDTYPE: address-work',
      ':END:',
      '** 2 Home Ave',
      ':PROPERTIES:',
      ':FIELDTYPE: address-home',
      ':END:',
    ].join('\n')
  );
  const vcf = exportToVcard(doc, { style: 'tree' });
  assert.match(vcf, /ADR;TYPE=WORK:;;1 Work Way;;;;/);
  assert.match(vcf, /ADR;TYPE=HOME:;;2 Home Ave;;;;/);
});

test('THE FEATURE: a note in a #+BEGIN_VERSE block exports its real, full multi-line text, not the heading title', () => {
  const doc = treeDocs(
    ['* Alice', ':PROPERTIES:', ':KIND: individual', ':FIELDTYPE: name', ':END:', '** Note', ':PROPERTIES:', ':FIELDTYPE: note', ':END:', '#+BEGIN_VERSE', 'Line one', 'Line two', '#+END_VERSE'].join(
      '\n'
    )
  );
  const vcf = exportToVcard(doc, { style: 'tree' });
  assert.match(vcf, /NOTE:Line one\\nLine two/);
});

test('a note in a #+BEGIN_QUOTE block (not VERSE) is also read correctly', () => {
  const doc = treeDocs(
    ['* Alice', ':PROPERTIES:', ':KIND: individual', ':FIELDTYPE: name', ':END:', '** Note', ':PROPERTIES:', ':FIELDTYPE: note', ':END:', '#+BEGIN_QUOTE', 'Quoted text', '#+END_QUOTE'].join('\n')
  );
  const vcf = exportToVcard(doc, { style: 'tree' });
  assert.match(vcf, /NOTE:Quoted text/);
});

test('a note heading with no block at all falls back to its own title, for backward compatibility', () => {
  const doc = treeDocs(
    ['* Alice', ':PROPERTIES:', ':KIND: individual', ':FIELDTYPE: name', ':END:', '** Just a plain title', ':PROPERTIES:', ':FIELDTYPE: note', ':END:'].join('\n')
  );
  const vcf = exportToVcard(doc, { style: 'tree' });
  assert.match(vcf, /NOTE:Just a plain title/);
});

// ---- Address label round-trip (Google's own ADR extension) ---------------

test('THE FEATURE: flat style writes the real LABEL="..." parameter when an :ADDRESS_LABEL: property is present', () => {
  const doc = docs(
    [
      '* Alice',
      ':PROPERTIES:',
      ':EMAIL: alice@example.com',
      ':ADDRESS: 200 Morris St, Durham, NC, 27701, US',
      ':ADDRESS_LABEL: 200 Morris St ; Durham, NC 27701 ; US',
      ':END:',
    ].join('\n')
  );
  const vcf = exportToVcard(doc);
  const [reparsed] = parseVcards(vcf);
  assert.equal(reparsed.adrs[0].value, '200 Morris St, Durham, NC, 27701, US');
  assert.equal(reparsed.adrs[0].label, '200 Morris St ; Durham, NC 27701 ; US');
});

test('flat style writes a plain ADR line (no LABEL param) when there is no :ADDRESS_LABEL: at all', () => {
  const doc = docs(['* Alice', ':PROPERTIES:', ':EMAIL: alice@example.com', ':ADDRESS: 123 Main St, Springfield', ':END:'].join('\n'));
  const vcf = exportToVcard(doc);
  assert.match(vcf, /ADR:;;123 Main St\\, Springfield;;;;/);
  assert.doesNotMatch(vcf, /LABEL=/);
});

test('THE FEATURE: tree style writes the real LABEL="..." parameter for an address heading that has both a title (structured value) and a #+BEGIN_VERSE body block (the label)', () => {
  const doc = treeDocs(
    [
      '* Alice',
      ':PROPERTIES:',
      ':KIND: individual',
      ':FIELDTYPE: name',
      ':END:',
      '** 200 Morris St, Durham, NC, 27701, US',
      ':PROPERTIES:',
      ':FIELDTYPE: address-work',
      ':END:',
      '#+BEGIN_VERSE',
      '200 Morris St',
      'Durham, NC 27701',
      'US',
      '#+END_VERSE',
    ].join('\n')
  );
  const vcf = exportToVcard(doc, { style: 'tree' });
  const [reparsed] = parseVcards(vcf);
  assert.equal(reparsed.adrs[0].value, '200 Morris St, Durham, NC, 27701, US');
  assert.equal(reparsed.adrs[0].label, '200 Morris St\nDurham, NC 27701\nUS');
  assert.equal(reparsed.adrs[0].type, 'WORK');
});

test('tree style writes a plain ADR;TYPE=WORK line (no LABEL param) for an address heading with only a title, no body block', () => {
  const doc = treeDocs(
    ['* Alice', ':PROPERTIES:', ':KIND: individual', ':FIELDTYPE: name', ':END:', '** 123 Main St', ':PROPERTIES:', ':FIELDTYPE: address-work', ':END:'].join('\n')
  );
  const vcf = exportToVcard(doc, { style: 'tree' });
  assert.match(vcf, /ADR;TYPE=WORK:;;123 Main St;;;;/);
  assert.doesNotMatch(vcf, /LABEL=/);
});

test('THE FEATURE (full real-world round trip): import the exact Simmule Turner vCard, export it back out, and confirm the label survives alongside the structured value -- both directions of "functionally equivalent"', () => {
  const originalVcard = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'FN:Simmule Turner',
    'N:Turner;Simmule;;;',
    'ADR;TYPE=WORK:;;200 Morris St;Durham;NC;27701;US;200 Morris St\\nDurham\\, NC 27701\\nUS',
    'EMAIL:a@example.com',
    'END:VCARD',
  ].join('\r\n');

  const orgText = importVcardsAsOrgText(originalVcard, { style: 'tree' });
  const doc = parseOrg(orgText);
  const reexported = exportToVcard([{ documentId: 'doc1', doc }], { style: 'tree' });

  const [reparsed] = parseVcards(reexported);
  assert.equal(reparsed.adrs[0].value, '200 Morris St, Durham, NC, 27701, US');
  assert.equal(reparsed.adrs[0].label, '200 Morris St\nDurham, NC 27701\nUS');
  assert.equal(reparsed.adrs[0].type, 'WORK');
});
