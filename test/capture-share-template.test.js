import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import { expandTemplate, insertCapture, resolveOlpTarget } from '../src/capture-template.js';
import { launchFromShare } from '../src/capture-shared.js';
import { DEFAULT_CAPTURE_TEMPLATES } from '../src-browser/settings.js';
import { validateCaptureTemplates } from '../src-browser/doc-helpers.js';

// The built-in "Web page or text" template: what ends up in the document for what Android's Share sheet hands over.
const template = DEFAULT_CAPTURE_TEMPLATES.find((t) => t.key === 'w');
const NOW = new Date(2026, 9, 5, 9, 30);

/** Runs the template for a share, as the capture form would: `answers` are the prompts in order (the title, then the note). */
function capture(docText, rawShare, answers) {
  const doc = parseOrg(docText);
  const { shared } = launchFromShare(rawShare);
  const text = expandTemplate(template.template, { now: NOW, shared, promptAnswers: answers }).text;
  const target = resolveOlpTarget(doc, template.olp, { now: NOW });
  insertCapture(target, template.type, text);
  return serializeOrg(doc);
}

test('the default templates are all valid, and the share template is among them, first', () => {
  assert.equal(validateCaptureTemplates(DEFAULT_CAPTURE_TEMPLATES), null);
  assert.equal(DEFAULT_CAPTURE_TEMPLATES[0].key, 'w');
  assert.equal(template.type, 'plain');
});

test('a shared web page becomes a heading that is a link to it, titled as the page is, with when it was captured', () => {
  const out = capture('* Inbox\n', { title: 'Org mode compact guide', text: 'https://orgmode.org/guide/' }, ['', 'read this later']);
  assert.match(out, /^\* Inbox\n\n?\*\* \[\[https:\/\/orgmode\.org\/guide\/\]\[Org mode compact guide\]\]\n:PROPERTIES:\n/);
  assert.match(out, /:CREATED: \[2026-10-05 Mon 09:30\]/);
  assert.match(out, /read this later/);
  assert.equal(out.match(/^\*\* /gm).length, 1, 'one new heading');
});

test('shared text from a document, with no link, goes in the body under the title that was typed', () => {
  const out = capture('* Inbox\n', { text: 'The quick brown fox\njumps over the lazy dog.' }, ['A fox', '']);
  assert.match(out, /^\* Inbox\n\n?\*\* A fox\n:PROPERTIES:\n/);
  assert.match(out, /\n {2}The quick brown fox\n {2}jumps over the lazy dog\./, 'every line of the excerpt is indented under the heading');
  assert.doesNotMatch(out, /\[\[/, 'no link, since none was shared');
});

test('a link shared with some text keeps both: the link as the heading, the text in the body', () => {
  const out = capture('* Inbox\n', { title: 'A recipe', text: 'Try this on Sunday\nhttps://example.com/recipe' }, ['', '']);
  assert.match(out, /^\* Inbox\n\n?\*\* \[\[https:\/\/example\.com\/recipe\]\[A recipe\]\]\n/);
  assert.match(out, / {2}Try this on Sunday/);
});

test('the Inbox heading is created if the document has none, and an existing one is reused', () => {
  const created = capture('* Something else\n', { title: 'T', text: 'https://example.com/' }, ['', '']);
  assert.match(created, /^\* Something else\n+\* Inbox\n+\*\* \[\[https:\/\/example\.com\/\]\[T\]\]/);
  const twice = capture(capture('* Inbox\n', { title: 'One', text: 'https://a.example/' }, ['', '']), { title: 'Two', text: 'https://b.example/' }, ['', '']);
  assert.equal(twice.match(/^\* Inbox$/gm).length, 1, 'still a single Inbox');
  assert.equal(twice.match(/^\*\* /gm).length, 2, 'two captures under it');
});
