// examples/logging.org holds what Emacs 29.3 left after org-todo and the note typed for it (tools/gen-example-logging.mjs).
// The app must write the same text from the same file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import { findAncestorPath } from '../src/archive-model.js';
import { readLogSettings } from '../src/log-settings.js';
import { getClosedKeepWhenNoTodo, parseLocalVariables } from '../src/local-variables.js';
import { resolveTodoSequence, setTodoState } from '../src/todo-cycle.js';
import { applyTransitionEffects, writePendingNote } from '../src/todo-transition.js';

const text = readFileSync(new URL('../examples/logging.org', import.meta.url), 'utf8');
const unescape = (/** @type {string} */ s) => s.replace(/^,(\*|#\+)/gm, '$1');

/** @param {import('../src/types.js').Heading[]} nodes @param {string} title @returns {import('../src/types.js').Heading | undefined} */
function find(nodes, title) {
  for (const n of nodes) {
    if (n.title === title) return n;
    const f = find(n.children, title);
    if (f) return f;
  }
  return undefined;
}

const cases = [...text.matchAll(/^\* (.*)\n[\s\S]*?Before:\n#\+BEGIN_SRC org\n([\s\S]*?)\n#\+END_SRC\n\nAfter setting (\w+)(?: on =(.*?)=)?(?: and (?:leaving the note empty|typing the note "(.*)"))?:\n#\+BEGIN_SRC org\n([\s\S]*?)\n#\+END_SRC/gm)];

test('logging.org has its cases', () => {
  assert.equal(cases.length, 10);
});

for (const [full, title, before, state, on, note, after] of cases) {
  test(`logging.org: ${title}`, () => {
    const saved = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      const doc = parseOrg(unescape(before) + '\n');
      const heading = /** @type {import('../src/types.js').Heading} */ (on ? find(doc.children, on) : doc.children[0]);
      const sequence = resolveTodoSequence(doc, { todoKeywords: ['TODO'], doneKeywords: ['DONE'] });
      const from = heading.todo;
      setTodoState(heading, state, sequence);
      const path = [...(findAncestorPath(doc, heading) || []), heading];
      const settings = readLogSettings(doc, parseLocalVariables(serializeOrg(doc)), {}, path);
      const pending = applyTransitionEffects(heading, from, sequence, { settings, keepWhenNoTodo: getClosedKeepWhenNoTodo({}), now: new Date(2026, 9, 11, 16, 30) });
      const typed = full.includes('leaving the note empty') ? '' : note === undefined ? null : note.replace(/ \/ /g, '\n');
      if (pending && typed !== null) writePendingNote(pending, typed, settings);
      assert.equal(serializeOrg(doc).trimEnd(), unescape(after).trimEnd(), title);
    } finally {
      if (saved === undefined) delete process.env.TZ;
      else process.env.TZ = saved;
    }
  });
}

test('logging.org: where the app differs from Emacs', () => {
  // on the last heading of a file Emacs leaves a blank line after :END:; the app does not
  const doc = parseOrg('#+TODO: TODO NEXT(n!) | DONE(d!)\n* TODO Call Pat\n:PROPERTIES:\n:LOG_INTO_DRAWER: t\n:END:\n');
  const heading = doc.children[0];
  const sequence = resolveTodoSequence(doc);
  const from = heading.todo;
  setTodoState(heading, 'NEXT', sequence);
  const settings = readLogSettings(doc, parseLocalVariables(serializeOrg(doc)), {}, [heading]);
  applyTransitionEffects(heading, from, sequence, { settings, keepWhenNoTodo: false, now: new Date(2026, 9, 11, 16, 30) });
  assert.match(serializeOrg(doc), /:END:\n:LOGBOOK:[\s\S]*:END:\n$/);
});
