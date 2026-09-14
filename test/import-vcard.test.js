import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg } from '../src/org-parser.js';
import { exportToVcard } from '../src/export-vcard.js';
import { parseVcards, importVcardsAsOrgText } from '../src/import-vcard.js';

// ---- parseVcards --------------------------------------------------------

test('THE FEATURE: parses a minimal vCard with only FN, per real RFC 6350 -- only FN is required', () => {
  const contacts = parseVcards('BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Alice\r\nEND:VCARD\r\n');
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].fn, 'Alice');
  assert.deepEqual(contacts[0].emails, []);
});

test('a vCard block with no FN at all is skipped entirely, not imported as a nameless contact', () => {
  const contacts = parseVcards('BEGIN:VCARD\r\nVERSION:3.0\r\nEMAIL:a@example.com\r\nEND:VCARD\r\n');
  assert.equal(contacts.length, 0);
});

test('multiple VCARD blocks in one file are all parsed', () => {
  const text = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Alice\r\nEND:VCARD\r\nBEGIN:VCARD\r\nVERSION:3.0\r\nFN:Bob\r\nEND:VCARD\r\n';
  const contacts = parseVcards(text);
  assert.deepEqual(
    contacts.map((c) => c.fn),
    ['Alice', 'Bob']
  );
});

test('EMAIL/TEL with TYPE params are captured correctly, including multiple of each', () => {
  const text = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Alice\r\nEMAIL;TYPE=WORK:work@example.com\r\nEMAIL;TYPE=HOME:home@example.com\r\nTEL;TYPE=CELL:555-0001\r\nTEL;TYPE=WORK:555-0002\r\nEND:VCARD\r\n';
  const [contact] = parseVcards(text);
  assert.deepEqual(contact.emails, [
    { value: 'work@example.com', type: 'WORK' },
    { value: 'home@example.com', type: 'HOME' },
  ]);
  assert.deepEqual(contact.tels, [
    { value: '555-0001', type: 'CELL' },
    { value: '555-0002', type: 'WORK' },
  ]);
});

test('a bare TEL/EMAIL with no TYPE param at all is still captured, with type null', () => {
  const text = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Alice\r\nTEL:555-0000\r\nEND:VCARD\r\n';
  const [contact] = parseVcards(text);
  assert.deepEqual(contact.tels, [{ value: '555-0000', type: null }]);
});

test('ADR is joined into one readable string from its own non-empty components', () => {
  const text = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Alice\r\nADR:;;123 Main St;Springfield;IL;62704;USA\r\nEND:VCARD\r\n';
  const [contact] = parseVcards(text);
  assert.equal(contact.adr, '123 Main St, Springfield, IL, 62704, USA');
});

test('a folded (multi-line, continuation-indented) vCard line is correctly unfolded', () => {
  const text = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Alice\r\nNOTE:This is a long note that got\r\n  folded onto a second line\r\nEND:VCARD\r\n';
  const [contact] = parseVcards(text);
  assert.equal(contact.note, 'This is a long note that got folded onto a second line');
});

test('escaped characters (\\\\, \\;, \\,, \\n) in a value are correctly unescaped', () => {
  const text = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Smith\\, Alice\r\nNOTE:Line one\\nLine two\r\nEND:VCARD\r\n';
  const [contact] = parseVcards(text);
  assert.equal(contact.fn, 'Smith, Alice');
  assert.equal(contact.note, 'Line one\nLine two');
});

test('CATEGORIES is split into an array of individual tag strings', () => {
  const text = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Alice\r\nCATEGORIES:family,vip\r\nEND:VCARD\r\n';
  const [contact] = parseVcards(text);
  assert.deepEqual(contact.categories, ['family', 'vip']);
});

test('an unrecognized property is silently ignored, not an error, and doesn\u2019t block the rest of the contact', () => {
  const text = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Alice\r\nX-SOME-UNKNOWN-PROP:whatever\r\nEMAIL:a@example.com\r\nEND:VCARD\r\n';
  const [contact] = parseVcards(text);
  assert.equal(contact.fn, 'Alice');
  assert.equal(contact.emails[0].value, 'a@example.com');
});

test('BDAY in both real vCard basic forms (dashed and bare) is stored raw by parseVcards; normalization happens in the org builders', () => {
  const dashed = parseVcards('BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Alice\r\nBDAY:1990-05-14\r\nEND:VCARD\r\n');
  const bare = parseVcards('BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Bob\r\nBDAY:19900514\r\nEND:VCARD\r\n');
  assert.equal(dashed[0].bday, '1990-05-14');
  assert.equal(bare[0].bday, '19900514');
});

test('a malformed line (no colon at all) is skipped without aborting the rest of the block', () => {
  const text = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Alice\r\nTHIS LINE HAS NO COLON\r\nEMAIL:a@example.com\r\nEND:VCARD\r\n';
  const [contact] = parseVcards(text);
  assert.equal(contact.fn, 'Alice');
  assert.equal(contact.emails[0].value, 'a@example.com');
});

// ---- importVcardsAsOrgText: flat style -----------------------------------

test('THE FEATURE: flat style produces a heading with a :PROPERTIES: drawer for a contact with fields', () => {
  const text = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Alice\r\nEMAIL:alice@example.com\r\nTEL:555-1234\r\nEND:VCARD\r\n';
  const org = importVcardsAsOrgText(text);
  assert.match(org, /^\* Alice$/m);
  assert.match(org, /:EMAIL: alice@example\.com/);
  assert.match(org, /:PHONE: 555-1234/);
});

test('flat style with only FN produces a bare heading, no empty :PROPERTIES: drawer at all', () => {
  const org = importVcardsAsOrgText('BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Alice\r\nEND:VCARD\r\n');
  assert.equal(org, '* Alice');
});

test('flat style puts CATEGORIES on the heading line as real org tags', () => {
  const text = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Alice\r\nCATEGORIES:family,vip\r\nEMAIL:a@example.com\r\nEND:VCARD\r\n';
  const org = importVcardsAsOrgText(text);
  assert.match(org, /^\* Alice {2}:family:vip:$/m);
});

test('flat style maps a WORK-typed TEL to WORK_PHONE and a non-work one to PHONE, matching export\u2019s own reverse mapping', () => {
  const text = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Alice\r\nTEL;TYPE=WORK:555-0002\r\nTEL;TYPE=CELL:555-0001\r\nEND:VCARD\r\n';
  const org = importVcardsAsOrgText(text);
  assert.match(org, /:PHONE: 555-0001/);
  assert.match(org, /:WORK_PHONE: 555-0002/);
});

test('multiple contacts are separated by a blank line', () => {
  const text = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Alice\r\nEND:VCARD\r\nBEGIN:VCARD\r\nVERSION:3.0\r\nFN:Bob\r\nEND:VCARD\r\n';
  const org = importVcardsAsOrgText(text);
  assert.equal(org, '* Alice\n\n* Bob');
});

test('a file with no valid contacts produces an empty string', () => {
  assert.equal(importVcardsAsOrgText('BEGIN:VCARD\r\nVERSION:3.0\r\nEMAIL:a@example.com\r\nEND:VCARD\r\n'), '');
});

// ---- importVcardsAsOrgText: tree style ------------------------------------

test('THE FEATURE: tree style produces the real org-vcard tree structure', () => {
  const text = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Alice\r\nEMAIL;TYPE=WORK:a@example.com\r\nEND:VCARD\r\n';
  const org = importVcardsAsOrgText(text, { style: 'tree' });
  assert.match(org, /^\* Alice$/m);
  assert.match(org, /:KIND: individual/);
  assert.match(org, /:FIELDTYPE: name/);
  assert.match(org, /^\*\* a@example\.com$/m);
  assert.match(org, /:FIELDTYPE: email-work/);
});

test('tree style produces a separate heading for EACH value of the same type, unlike flat style\u2019s single-property limitation', () => {
  const text = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Alice\r\nEMAIL:one@example.com\r\nEMAIL:two@example.com\r\nEND:VCARD\r\n';
  const org = importVcardsAsOrgText(text, { style: 'tree' });
  assert.match(org, /one@example\.com/);
  assert.match(org, /two@example\.com/);
});

// ---- round-trip: export -> import -> export produces equivalent results --

test('THE FEATURE (round-trip, flat): exporting a real contact, importing the result, and exporting again produces an equivalent vCard', () => {
  const original = parseOrg('* Alice Smith\n:PROPERTIES:\n:EMAIL: alice@example.com\n:PHONE: 555-1234\n:NOTE: A note\n:END:\n');
  const firstExport = exportToVcard([{ documentId: 'doc1', doc: original }]);
  assert.match(firstExport, /FN:Alice Smith/);

  const importedOrgText = importVcardsAsOrgText(firstExport);
  const reimportedDoc = parseOrg(importedOrgText);
  const secondExport = exportToVcard([{ documentId: 'doc2', doc: reimportedDoc }]);

  assert.match(secondExport, /FN:Alice Smith/);
  assert.match(secondExport, /EMAIL:alice@example\.com/);
  assert.match(secondExport, /TEL:555-1234/);
  assert.match(secondExport, /NOTE:A note/);
});

test('round-trip (tree): the same export -> import -> export cycle works for tree style', () => {
  const original = parseOrg(
    ['* Joan Smith', ':PROPERTIES:', ':KIND: individual', ':FIELDTYPE: name', ':END:', '** Cell', '*** 0000 999 999', ':PROPERTIES:', ':FIELDTYPE: cell', ':END:'].join(
      '\n'
    )
  );
  const firstExport = exportToVcard([{ documentId: 'doc1', doc: original }], { style: 'tree' });
  assert.match(firstExport, /FN:Joan Smith/);
  assert.match(firstExport, /TEL;TYPE=CELL:0000 999 999/);

  const importedOrgText = importVcardsAsOrgText(firstExport, { style: 'tree' });
  const reimportedDoc = parseOrg(importedOrgText);
  const secondExport = exportToVcard([{ documentId: 'doc2', doc: reimportedDoc }], { style: 'tree' });

  assert.match(secondExport, /FN:Joan Smith/);
  assert.match(secondExport, /TEL;TYPE=CELL:0000 999 999/);
});

test('round-trip (flat, no optional fields at all): a bare FN-only contact survives the full cycle unchanged', () => {
  const original = parseOrg('* Bare Contact\n:PROPERTIES:\n:NOTE: keep this contact\n:END:\n');
  const firstExport = exportToVcard([{ documentId: 'doc1', doc: original }]);
  const importedOrgText = importVcardsAsOrgText(firstExport);
  const reimportedDoc = parseOrg(importedOrgText);
  const secondExport = exportToVcard([{ documentId: 'doc2', doc: reimportedDoc }]);
  assert.match(secondExport, /FN:Bare Contact/);
  assert.match(secondExport, /NOTE:keep this contact/);
});

test('the imported org text itself round-trips correctly through this app\u2019s own org parser/serializer', () => {
  const org = importVcardsAsOrgText('BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Alice\r\nEMAIL:a@example.com\r\nCATEGORIES:family\r\nEND:VCARD\r\n');
  const doc = parseOrg(org);
  assert.equal(doc.children[0].title, 'Alice');
  assert.deepEqual(doc.children[0].tags, ['family']);
  assert.equal(doc.children[0].properties.EMAIL, 'a@example.com');
});
