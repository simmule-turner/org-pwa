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
  assert.deepEqual(contact.adrs, [{ value: '123 Main St, Springfield, IL, 62704, USA', label: null, type: null }]);
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
  const org = importVcardsAsOrgText(text, { style: 'flat' });
  assert.match(org, /^\* Alice$/m);
  assert.match(org, /:EMAIL: alice@example\.com/);
  assert.match(org, /:PHONE: 555-1234/);
});

test('flat style with only FN produces a bare heading, no empty :PROPERTIES: drawer at all', () => {
  const org = importVcardsAsOrgText('BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Alice\r\nEND:VCARD\r\n', { style: 'flat' });
  assert.equal(org, '* Alice');
});

test('flat style puts CATEGORIES on the heading line as real org tags', () => {
  const text = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Alice\r\nCATEGORIES:family,vip\r\nEMAIL:a@example.com\r\nEND:VCARD\r\n';
  const org = importVcardsAsOrgText(text, { style: 'flat' });
  assert.match(org, /^\* Alice {2}:family:vip:$/m);
});

test('flat style maps a WORK-typed TEL to WORK_PHONE and a non-work one to PHONE, matching export\u2019s own reverse mapping', () => {
  const text = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Alice\r\nTEL;TYPE=WORK:555-0002\r\nTEL;TYPE=CELL:555-0001\r\nEND:VCARD\r\n';
  const org = importVcardsAsOrgText(text, { style: 'flat' });
  assert.match(org, /:PHONE: 555-0001/);
  assert.match(org, /:WORK_PHONE: 555-0002/);
});

test('multiple contacts are separated by a blank line', () => {
  const text = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Alice\r\nEND:VCARD\r\nBEGIN:VCARD\r\nVERSION:3.0\r\nFN:Bob\r\nEND:VCARD\r\n';
  const org = importVcardsAsOrgText(text, { style: 'flat' });
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

  const importedOrgText = importVcardsAsOrgText(firstExport, { style: 'flat' });
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
  const importedOrgText = importVcardsAsOrgText(firstExport, { style: 'flat' });
  const reimportedDoc = parseOrg(importedOrgText);
  const secondExport = exportToVcard([{ documentId: 'doc2', doc: reimportedDoc }]);
  assert.match(secondExport, /FN:Bare Contact/);
  assert.match(secondExport, /NOTE:keep this contact/);
});

test('the imported org text itself round-trips correctly through this app\u2019s own org parser/serializer', () => {
  const org = importVcardsAsOrgText('BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Alice\r\nEMAIL:a@example.com\r\nCATEGORIES:family\r\nEND:VCARD\r\n', { style: 'flat' });
  const doc = parseOrg(org);
  assert.equal(doc.children[0].title, 'Alice');
  assert.deepEqual(doc.children[0].tags, ['family']);
  assert.equal(doc.children[0].properties.EMAIL, 'a@example.com');
});

// ---- Fixes from the Simmule Turner real-world vCard investigation --------

const REAL_MULTI_VALUE_VCARD = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'FN:Simmule Turner',
  'N:Turner;Simmule;;;',
  'EMAIL;TYPE=INTERNET;TYPE=HOME:simmule.turner@gmail.com',
  'EMAIL;TYPE=INTERNET;TYPE=WORK:simmule@google.com',
  'TEL;TYPE=CELL:+1.817.918.4392',
  'ADR;TYPE=WORK:;;200 Morris St;Durham;NC;27701;US',
  'ADR;TYPE=HOME:;;812 Summer Bloom CT;Durham;NC;27703;United States',
  'BDAY:19650127',
  'NOTE:Line one\\nLine two\\n\\nLine four',
  'CATEGORIES:Other Account,myContacts',
  'END:VCARD',
].join('\r\n');

test('THE FEATURE (fix 1): a NOTE with embedded newlines no longer truncates on re-parse in flat style -- the actual bug from the real-world report', () => {
  const org = importVcardsAsOrgText(REAL_MULTI_VALUE_VCARD, { style: 'flat' });
  const doc = parseOrg(org);
  const note = doc.children[0].properties.NOTE;
  // Every line must survive -- the original bug lost everything after
  // the first embedded newline when the generated text was re-parsed.
  assert.match(note, /Line one/);
  assert.match(note, /Line two/);
  assert.match(note, /Line four/);
});

test('THE FEATURE (fix 2): flat style keeps the FIRST address consistently, matching email/phone -- an earlier version kept the LAST due to an overwritten scalar', () => {
  const org = importVcardsAsOrgText(REAL_MULTI_VALUE_VCARD, { style: 'flat' });
  const doc = parseOrg(org);
  assert.match(doc.children[0].properties.ADDRESS, /200 Morris St/); // work, parsed first -- not home, parsed second
});

test('THE FEATURE (fix 3): tree style preserves BOTH addresses as separate address-work/address-home headings, not just one', () => {
  const org = importVcardsAsOrgText(REAL_MULTI_VALUE_VCARD, { style: 'tree' });
  assert.match(org, /200 Morris St/);
  assert.match(org, /812 Summer Bloom CT/);
  assert.match(org, /:FIELDTYPE: address-work/);
  assert.match(org, /:FIELDTYPE: address-home/);
});

test('tree style preserves every email as its own heading too, none dropped', () => {
  const org = importVcardsAsOrgText(REAL_MULTI_VALUE_VCARD, { style: 'tree' });
  assert.match(org, /simmule\.turner@gmail\.com/);
  assert.match(org, /simmule@google\.com/);
});

test('THE FEATURE (fix 4): tree style wraps a note in a real #+BEGIN_VERSE block, preserving every line break exactly, not collapsed into the heading title', () => {
  const org = importVcardsAsOrgText(REAL_MULTI_VALUE_VCARD, { style: 'tree' });
  assert.match(org, /\*\* Note\n/);
  assert.match(org, /#\+BEGIN_VERSE\nLine one\nLine two\n\nLine four\n#\+END_VERSE/);
});

test('the tree-style #+BEGIN_VERSE note block parses back into real body content, not a heading title, confirmed directly against this app\u2019s own org parser', () => {
  const org = importVcardsAsOrgText(REAL_MULTI_VALUE_VCARD, { style: 'tree' });
  const doc = parseOrg(org);
  const contact = doc.children[0];
  const noteHeading = contact.children.find((c) => c.title === 'Note');
  assert.ok(noteHeading, 'expected a heading titled "Note"');
  const block = noteHeading.body.find((b) => b.type === 'block' && b.name === 'VERSE');
  assert.ok(block, 'expected a VERSE block in the Note heading\u2019s own body');
  assert.deepEqual(block.lines, ['Line one', 'Line two', '', 'Line four']);
});

test('THE FEATURE (full round trip): export -> import (tree) -> export produces a vCard with every email, both addresses, and the full note text, nothing dropped', () => {
  const original = parseOrg(importVcardsAsOrgText(REAL_MULTI_VALUE_VCARD, { style: 'tree' }));
  const reexported = exportToVcard([{ documentId: 'doc1', doc: original }], { style: 'tree' });
  const [reparsed] = parseVcards(reexported);
  assert.deepEqual(
    reparsed.emails.map((e) => e.value).sort(),
    ['simmule.turner@gmail.com', 'simmule@google.com'].sort()
  );
  assert.equal(reparsed.adrs.length, 2);
  assert.ok(reparsed.adrs.some((a) => a.value.includes('200 Morris St') && a.type === 'WORK'));
  assert.ok(reparsed.adrs.some((a) => a.value.includes('812 Summer Bloom CT') && a.type === 'HOME'));
  assert.equal(reparsed.note, 'Line one\nLine two\n\nLine four');
  assert.equal(reparsed.bday, '1965-01-27');
});

test('a note heading with no VERSE/QUOTE block at all (backward compatibility) still exports using its own title', () => {
  const doc = parseOrg(
    ['* Alice', ':PROPERTIES:', ':KIND: individual', ':FIELDTYPE: name', ':END:', '** An old-style note as the title', ':PROPERTIES:', ':FIELDTYPE: note', ':END:'].join(
      '\n'
    )
  );
  const vcf = exportToVcard([{ documentId: 'doc1', doc }], { style: 'tree' });
  assert.match(vcf, /NOTE:An old-style note as the title/);
});

test('a note wrapped in #+BEGIN_QUOTE (not VERSE) is also read correctly on export -- either block name is accepted', () => {
  const doc = parseOrg(
    [
      '* Alice',
      ':PROPERTIES:',
      ':KIND: individual',
      ':FIELDTYPE: name',
      ':END:',
      '** Note',
      ':PROPERTIES:',
      ':FIELDTYPE: note',
      ':END:',
      '#+BEGIN_QUOTE',
      'Quoted note text',
      '#+END_QUOTE',
    ].join('\n')
  );
  const vcf = exportToVcard([{ documentId: 'doc1', doc }], { style: 'tree' });
  assert.match(vcf, /NOTE:Quoted note text/);
});

// ---- Google Contacts export handling (8th ADR field, "\:" unescaping) ----

test('THE FEATURE: the default import style is now tree, not flat -- flat has a real ceiling, tree does not', () => {
  const text = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Alice\r\nEMAIL:a@example.com\r\nEND:VCARD\r\n';
  const org = importVcardsAsOrgText(text); // no style specified at all
  assert.match(org, /:KIND: individual/); // this marker only appears in tree style
});

test('THE FEATURE: an 8th ADR component (Google\u2019s own LABEL) is preserved separately from the 7 structured components, confirmed against the exact real-world vCard -- neither discarded for the other', () => {
  const text = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'FN:Simmule Turner',
    'ADR;TYPE=HOME:;;812 Summer Bloom CT;Durham;NC;27703;United States;812 Summer Bloom CT\\nDurham\\, NC 27703\\nUnited States',
    'EMAIL:a@example.com',
    'END:VCARD',
  ].join('\r\n');
  const [contact] = parseVcards(text);
  assert.equal(contact.adrs[0].value, '812 Summer Bloom CT, Durham, NC, 27703, United States');
  assert.equal(contact.adrs[0].label, '812 Summer Bloom CT\nDurham, NC 27703\nUnited States');
});

test('with googleMode explicitly off, an 8th ADR component is ignored entirely -- matching real RFC 6350\u2019s own strict 7-component ADR definition, not Google\u2019s own non-standard extension of it', () => {
  const text = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'FN:Simmule Turner',
    'ADR;TYPE=HOME:;;812 Summer Bloom CT;Durham;NC;27703;United States;812 Summer Bloom CT\\nDurham\\, NC 27703\\nUnited States',
    'EMAIL:a@example.com',
    'END:VCARD',
  ].join('\r\n');
  const [contact] = parseVcards(text, { googleMode: false });
  assert.equal(contact.adrs[0].value, '812 Summer Bloom CT, Durham, NC, 27703, United States');
  assert.equal(contact.adrs[0].label, null);
});

test('THE FEATURE: the real, standard LABEL="..." parameter syntax (vCard 4.0\u2019s own correct form) is also recognized, not just Google\u2019s own 8th-value-component convention', () => {
  const text = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Simmule Turner\r\nADR;TYPE=WORK;LABEL="200 Morris St\\nDurham, NC 27701\\nUS":;;200 Morris St;Durham;NC;27701;US\r\nEND:VCARD\r\n';
  const [contact] = parseVcards(text);
  assert.equal(contact.adrs[0].value, '200 Morris St, Durham, NC, 27701, US');
  assert.equal(contact.adrs[0].label, '200 Morris St\nDurham, NC 27701\nUS');
  assert.equal(contact.adrs[0].type, 'WORK');
});

test('a normal, 7-component ADR (no Google label) is unaffected by googleMode either way', () => {
  const text = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Alice\r\nADR:;;123 Main St;Springfield;IL;62704;USA\r\nEND:VCARD\r\n';
  const [withGoogle] = parseVcards(text, { googleMode: true });
  const [withoutGoogle] = parseVcards(text, { googleMode: false });
  assert.equal(withGoogle.adrs[0].value, '123 Main St, Springfield, IL, 62704, USA');
  assert.equal(withoutGoogle.adrs[0].value, '123 Main St, Springfield, IL, 62704, USA');
});

test('THE FEATURE: "\\\\:" is unescaped to ":" when googleMode is on, confirmed against the exact real-world report', () => {
  const text = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Alice\r\nNOTE:Permanent address\\:\\n\\nSimmule Turner\r\nEND:VCARD\r\n';
  const [contact] = parseVcards(text, { googleMode: true });
  assert.match(contact.note, /Permanent address:/);
  assert.doesNotMatch(contact.note, /address\\:/);
});

test('with googleMode explicitly off, "\\\\:" is left untouched -- not a standard vCard escape, so left as-is rather than guessed at', () => {
  const text = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Alice\r\nNOTE:Permanent address\\:here\r\nEND:VCARD\r\n';
  const [contact] = parseVcards(text, { googleMode: false });
  assert.match(contact.note, /address\\:here/);
});

test('THE FEATURE: a Google ADR label now gets its own readable #+BEGIN_VERSE block in tree style, alongside (not instead of) the structured value as the heading\u2019s own title', () => {
  const text = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'FN:Simmule Turner',
    'ADR;TYPE=HOME:;;812 Summer Bloom CT;Durham;NC;27703;United States;812 Summer Bloom CT\\nDurham\\, NC 27703\\nUnited States',
    'EMAIL:a@example.com',
    'END:VCARD',
  ].join('\r\n');
  const org = importVcardsAsOrgText(text, { style: 'tree' });
  assert.match(org, /\*\* 812 Summer Bloom CT, Durham, NC, 27703, United States\n/); // the structured value, as the title
  assert.match(org, /#\+BEGIN_VERSE\n812 Summer Bloom CT\nDurham, NC 27703\nUnited States\n#\+END_VERSE/); // the label, as a separate body block
});

test('THE FEATURE: flat style preserves the label too, as a separate :ADDRESS_LABEL: property alongside :ADDRESS:', () => {
  const text = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'FN:Simmule Turner',
    'ADR;TYPE=HOME:;;812 Summer Bloom CT;Durham;NC;27703;United States;812 Summer Bloom CT\\nDurham\\, NC 27703\\nUnited States',
    'EMAIL:a@example.com',
    'END:VCARD',
  ].join('\r\n');
  const org = importVcardsAsOrgText(text, { style: 'flat' });
  assert.match(org, /:ADDRESS: 812 Summer Bloom CT, Durham, NC, 27703, United States/);
  assert.match(org, /:ADDRESS_LABEL: 812 Summer Bloom CT ; Durham, NC 27703 ; United States/);
});

test('THE FEATURE (full real-world round trip): the exact Simmule Turner vCard, with googleMode on and tree style (both defaults), preserves every email, both addresses (structured value AND label), and the complete note text', () => {
  const fullText = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'FN:Simmule Turner',
    'N:Turner;Simmule;;;',
    'EMAIL;TYPE=INTERNET;TYPE=HOME:simmule.turner@gmail.com',
    'EMAIL;TYPE=INTERNET;TYPE=WORK:simmule@google.com',
    'TEL;TYPE=CELL:+1.817.918.4392',
    'ADR;TYPE=WORK:;;200 Morris St;Durham;NC;27701;US;200 Morris St\\nDurham\\, NC 27701\\nUS',
    'ADR;TYPE=HOME:;;812 Summer Bloom CT;Durham;NC;27703;United States;812 Summer Bloom CT\\nDurham\\, NC 27703\\nUnited States',
    'BDAY:19650127',
    'NOTE:Permanent address\\:\\n\\nSimmule Turner\\n3600 N Duke St',
    'CATEGORIES:Other Account,myContacts',
    'END:VCARD',
  ].join('\r\n');
  const org = importVcardsAsOrgText(fullText); // both defaults: style: 'tree', googleMode: true
  assert.match(org, /simmule\.turner@gmail\.com/);
  assert.match(org, /simmule@google\.com/);
  assert.match(org, /\*\* 200 Morris St, Durham, NC, 27701, US\n/);
  assert.match(org, /200 Morris St\nDurham, NC 27701\nUS/);
  assert.match(org, /\*\* 812 Summer Bloom CT, Durham, NC, 27703, United States\n/);
  assert.match(org, /812 Summer Bloom CT\nDurham, NC 27703\nUnited States/);
  assert.match(org, /Permanent address:/); // the \: is gone
  assert.doesNotMatch(org, /address\\:/);
});

// ---- ORG, TITLE, URL, PHOTO (previously silently discarded) --------------

test('THE FEATURE: ORG, TITLE, URL, and PHOTO (URL only) are now mapped instead of silently discarded, confirmed against the exact real-world Simmule Turner vCard', () => {
  const text = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'FN:Simmule Turner',
    'ORG:Google',
    'TITLE:Engineering Manager',
    'URL:https://example.com/simmule',
    'PHOTO:https://lh3.googleusercontent.com/contacts/AG6tpzHCbxGgWGY_LF0pZr4Vbgx2aE65Jdjnyv9PhkkB1Aa7o-ogNqdW',
    'END:VCARD',
  ].join('\r\n');
  const [contact] = parseVcards(text);
  assert.equal(contact.org, 'Google');
  assert.equal(contact.jobTitle, 'Engineering Manager');
  assert.equal(contact.url, 'https://example.com/simmule');
  assert.equal(contact.photo, 'https://lh3.googleusercontent.com/contacts/AG6tpzHCbxGgWGY_LF0pZr4Vbgx2aE65Jdjnyv9PhkkB1Aa7o-ogNqdW');
});

test('PHOTO is left unmapped when it\u2019s base64-embedded data rather than a real URL -- inlining that much binary-as-text into an org property would bloat the file for no benefit', () => {
  const text = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Alice\r\nPHOTO;ENCODING=BASE64;TYPE=JPEG:/9j/4AAQSkZJRgABAQAAAQABAAD\r\nEND:VCARD\r\n';
  const [contact] = parseVcards(text);
  assert.equal(contact.photo, null);
});

test('ORG with several ";"-separated components (Company;Department;Unit) is joined the same way ADR\u2019s own components are', () => {
  const text = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Alice\r\nORG:Acme Corp;Engineering;Platform Team\r\nEND:VCARD\r\n';
  const [contact] = parseVcards(text);
  assert.equal(contact.org, 'Acme Corp, Engineering, Platform Team');
});

test('flat style writes :ORG:, :JOB_TITLE:, :URL:, :PHOTO: properties when present', () => {
  const text = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Alice\r\nORG:Acme\r\nTITLE:Engineer\r\nURL:https://acme.example\r\nPHOTO:https://acme.example/alice.jpg\r\nEND:VCARD\r\n';
  const org = importVcardsAsOrgText(text, { style: 'flat' });
  assert.match(org, /:ORG: Acme/);
  assert.match(org, /:JOB_TITLE: Engineer/);
  assert.match(org, /:URL: https:\/\/acme\.example/);
  assert.match(org, /:PHOTO: https:\/\/acme\.example\/alice\.jpg/);
});

test('tree style creates Organization/Job Title/URL/Photo headings when present', () => {
  const text = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Alice\r\nORG:Acme\r\nTITLE:Engineer\r\nURL:https://acme.example\r\nPHOTO:https://acme.example/alice.jpg\r\nEND:VCARD\r\n';
  const org = importVcardsAsOrgText(text, { style: 'tree' });
  assert.match(org, /\*\* Acme\n:PROPERTIES:\n:FIELDTYPE: org/);
  assert.match(org, /\*\* Engineer\n:PROPERTIES:\n:FIELDTYPE: job-title/);
  assert.match(org, /\*\* https:\/\/acme\.example\n:PROPERTIES:\n:FIELDTYPE: url/);
  assert.match(org, /\*\* https:\/\/acme\.example\/alice\.jpg\n:PROPERTIES:\n:FIELDTYPE: photo/);
});

test('THE FEATURE (full real-world round trip): ORG/TITLE/URL/PHOTO survive export -> import -> export unchanged, in both styles', () => {
  const original = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'FN:Simmule Turner',
    'ORG:Google',
    'TITLE:Engineering Manager',
    'URL:https://example.com/simmule',
    'PHOTO:https://lh3.googleusercontent.com/contacts/AG6tpzHCbxGgWGY_LF0pZr4Vbgx2aE65Jdjnyv9PhkkB1Aa7o-ogNqdW',
    'EMAIL:simmule@example.com',
    'END:VCARD',
  ].join('\r\n');
  for (const style of ['flat', 'tree']) {
    const orgText = importVcardsAsOrgText(original, { style });
    const doc = parseOrg(orgText);
    const reexported = exportToVcard([{ documentId: 'doc1', doc }], { style });
    assert.match(reexported, /ORG:Google/);
    assert.match(reexported, /TITLE:Engineering Manager/);
    assert.match(reexported, /URL:https:\/\/example\.com\/simmule/);
    assert.match(reexported, /PHOTO:https:\/\/lh3\.googleusercontent\.com/);
  }
});
