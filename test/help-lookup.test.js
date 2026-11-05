import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lookupHelp } from '../src/help-lookup.js';
import { resolveLinkTarget } from '../src/link-resolve.js';
import { parseOrg } from '../src/org-parser.js';

const README = ['intro with ~org-todo~', '* Settings', '| Name | What |', '| ~org-tags-column~ | Column for tags |', '** Capture', '- ~capture~ :: starts it', '* Tail', '#+begin_src org', '* not a heading', '#+end_src', 'see ~zzz~'].join('\n');

test('help lookup prefers a settings row, then a heading or label, then any mention', () => {
  assert.deepEqual(lookupHelp(README, 'org-tags-column'), { line: 3, headingIndex: 0 });
  assert.deepEqual(lookupHelp(README, 'Capture'), { line: 4, headingIndex: 1 });
  assert.deepEqual(lookupHelp(README, 'capture'), { line: 4, headingIndex: 1 });
  assert.deepEqual(lookupHelp(README, 'zzz'), { line: 10, headingIndex: 2 });
  assert.deepEqual(lookupHelp(README, 'org-todo'), { line: 0, headingIndex: -1 });
  assert.equal(lookupHelp(README, 'nope'), null);
  assert.equal(lookupHelp(README, ''), null);
});

test('a help: link resolves to a help target', () => {
  assert.deepEqual(resolveLinkTarget(parseOrg('* A'), 'help:org-todo'), { type: 'help', name: 'org-todo' });
});
