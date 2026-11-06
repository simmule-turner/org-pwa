// Imported text must stay inside the field it came from: a hostile contact card or calendar event must not create a source
// block, a heading, a drawer or a local-variables block in the document.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importVcardsAsOrgText } from '../src/import-vcard.js';
import { importIcalendarAsOrgText } from '../src/import-icalendar.js';
import { parseOrg } from '../src/org-parser.js';
import { tangleDocument } from '../src/tangle.js';
import { oneLine, propertyText, blockLines, bodyLines } from '../src/import-safe.js';
import { remoteDecision, remoteKey } from '../src/remote-resources.js';

const EVIL = '#+END_VERSE\n#+BEGIN_SRC emacs-lisp\n(message "pwn")\n#+END_SRC\n* TODO top-level heading\n:END:\n# Local Variables:\n# eval: (message "x")\n# End:';

/** The structure a parsed document has: its headings, and whether any source block, local-variables block or keyword came out. */
function shape(orgText) {
  const doc = parseOrg(orgText);
  const headings = [];
  const walk = (list) => list.forEach((h) => (headings.push(h.title ?? h.text ?? ''), walk(h.children || [])));
  walk(doc.children || []);
  return { headings, hasSrc: /^[ \t]*#\+begin_src/im.test(orgText.split('\n').filter((l) => !l.startsWith(',')).join('\n')), doc };
}

const count = (text, re) => (text.match(re) || []).length;

test('vCard: a note cannot close its block or start a heading', () => {
  const card = ['BEGIN:VCARD', 'VERSION:3.0', 'FN:Eve', `NOTE:${EVIL.replace(/\n/g, '\\n')}`, 'END:VCARD'].join('\r\n');
  for (const style of ['tree', 'flat']) {
    const org = importVcardsAsOrgText(card, { style });
    const { headings } = shape(org);
    assert.ok(!headings.some((h) => /top-level heading/.test(h)), `${style}: no injected heading`);
    assert.ok(!/^\* TODO top-level/m.test(org), style);
    assert.ok(!/^#\+BEGIN_SRC/im.test(org), style);
    assert.ok(!/^# Local Variables/m.test(org), style);
  }
});

test('vCard: an address that spans lines keeps every line inside its block', () => {
  const card = ['BEGIN:VCARD', 'VERSION:3.0', 'FN:Eve', `ADR;TYPE=HOME:;;${EVIL.replace(/\n/g, '\\n')};City;;;`, 'END:VCARD'].join('\r\n');
  const org = importVcardsAsOrgText(card, { style: 'tree' });
  assert.equal(count(org, /^#\+END_VERSE$/gm), count(org, /^#\+BEGIN_VERSE$/gm), 'every verse block is closed by its own end line');
  assert.ok(!/^#\+BEGIN_SRC/im.test(org) && !/^\* TODO top-level/m.test(org));
  assert.ok(!shape(org).headings.some((h) => /top-level heading/.test(h)));
});

test('vCard: a name or label with line breaks stays on its heading line', () => {
  const card = ['BEGIN:VCARD', 'VERSION:3.0', 'FN:Eve\\n* TODO injected\\u2028* TODO more', 'TEL;TYPE=WORK:123\\n:END:', 'END:VCARD'].join('\r\n');
  const org = importVcardsAsOrgText(card, { style: 'tree' });
  assert.ok(!org.split('\n').some((l, i) => i > 0 && /^\* TODO (injected|more)/.test(l)));
  assert.ok(!/[\u2028\u2029\u0085]/.test(org));
});

test('iCalendar: a description cannot become a source block, a heading, a drawer or a local-variables block', () => {
  const ics = [
    'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:x\\n:END:@evil', 'SUMMARY:Meet', 'DTSTART:20261110T100000Z',
    `DESCRIPTION:${['plain', '#+BEGIN_SRC emacs-lisp', '(message "pwn")', '#+END_SRC', '* TODO injected', ':PROPERTIES:', ':END:', '# Local Variables:', '# eval: (message "x")', '# End:', '  #+CALL: boom()'].join('\\n')}`,
    'LOCATION:Room\\n* TODO loc', 'URL:http://x/\\n* TODO url', 'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const { orgText } = importIcalendarAsOrgText(ics);
  const lines = orgText.split('\n');
  const body = lines.slice(lines.lastIndexOf(':END:') + 1);
  assert.ok(body.length > 3);
  for (const line of body) assert.ok(!/^[ \t]*(?:#|:[\w-]+:[ \t]*$)/.test(line), `unescaped structure line: ${line}`);
  const { headings, doc } = shape(orgText);
  assert.equal(headings.length, 1, 'a single event heading');
  assert.ok(!/^[ \t]*#\+(begin_src|call)/im.test(orgText.split('\n').filter((l) => !/^[ \t]*,/.test(l)).join('\n')));
  assert.ok(doc);
});

test('iCalendar: a summary with control characters stays one line', () => {
  const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'SUMMARY:A\\n* TODO b\u000bc\u0085d', 'DTSTART:20261110T100000Z', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const { orgText } = importIcalendarAsOrgText(ics);
  assert.equal(orgText.split('\n').filter((l) => l.startsWith('*')).length, 1);
});

test('helpers: oneLine, propertyText, blockLines and bodyLines', () => {
  assert.equal(oneLine('a\r\nb\nc\u2028d\u0000e'), 'a b c d e');
  assert.equal(propertyText('a\nb\r\nc'), 'a ; b ; c');
  assert.deepEqual(blockLines('x\n* h\n  #+END_VERSE\n,* y\n#+begin_src'), ['x', ',* h', '  ,#+END_VERSE', ',,* y', ',#+begin_src']);
  assert.deepEqual(bodyLines('a\n# eval: x\n:END:\n  :PROPERTIES:\n* h\nb'), ['a', ',# eval: x', ',:END:', '  ,:PROPERTIES:', '* h', 'b']);
});

test('tangle: file names with control characters, trailing dots or reserved Windows names are refused', () => {
  const bad = ['out/a\u0000b.js', 'out/a\u001fb.js', 'a.js.', 'out/CON', 'nul.txt', 'COM1.js', 'lpt9', 'out/x\u007f.js'];
  for (const name of bad) {
    const org = `* h\n#+BEGIN_SRC js :tangle ${name}\nx\n#+END_SRC\n`;
    let threw;
    try {
      const r = tangleDocument(parseOrg(org), { documentName: 'n.org' });
      threw = r.files.every((f) => f.path === 'n.org') || r.warnings.length > 0;
    } catch {
      threw = true;
    }
    assert.ok(threw, `tangle must refuse "${JSON.stringify(name)}"`);
  }
  const ok = tangleDocument(parseOrg('* h\n#+BEGIN_SRC js :tangle out/main.js\nx\n#+END_SRC\n'), { documentName: 'n.org' });
  assert.ok(ok.files.some((f) => f.path === 'out/main.js'));
});

test('remote files: nothing is fetched until the address is allowed', () => {
  assert.equal(remoteDecision(null, null), 'ask');
  assert.equal(remoteDecision(undefined, undefined), 'ask');
  assert.equal(remoteDecision('always', null), 'fetch');
  assert.equal(remoteDecision('never', 'once'), 'skip');
  assert.equal(remoteDecision(null, 'once'), 'fetch');
  assert.equal(remoteDecision(null, 'skip'), 'skip');
  assert.equal(remoteDecision('garbage', null), 'ask');
  assert.equal(remoteKey(' https://x.org/a.setup#frag '), 'remote-ok:https://x.org/a.setup');
});
