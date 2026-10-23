// Holds a change of TODO state to real Emacs: test/fixtures/todo-oracle.json was made by tools/gen-todo-oracle.mjs, which runs
// org-todo on a grid of headings, file settings and states in Emacs 29.3 and records the text it leaves. New York time.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import { getClosedKeepWhenNoTodo, parseLocalVariables } from '../src/local-variables.js';
import { readLogSettings } from '../src/log-settings.js';
import { resolveTodoSequence, setTodoState } from '../src/todo-cycle.js';
import { applyTransitionEffects } from '../src/todo-transition.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/todo-oracle.json', import.meta.url), 'utf8'));
const GLOBAL = { todoKeywords: ['TODO'], doneKeywords: ['DONE'] };

// Emacs re-aligns a heading's tags when its state changes (to org-tags-column); the app keeps their spacing
const squeezeTags = (t) => t.trimEnd().replace(/^(\*+ .*?\S)[ \t]{2,}(:[^\s:]+(?::[^\s:]+)*:)$/gm, '$1 $2');

function ours(c) {
  const doc = parseOrg(c.org);
  const heading = doc.children[0];
  const sequence = resolveTodoSequence(doc, GLOBAL);
  const from = heading.todo;
  if (c.state === '') heading.todo = null;
  else setTodoState(heading, c.state, sequence);
  const setting = readLogSettings(doc, parseLocalVariables(serializeOrg(doc)), {}, [heading]);
  applyTransitionEffects(heading, from, sequence, { settings: setting, keepWhenNoTodo: getClosedKeepWhenNoTodo({}), now: new Date(oracle.now.replace(' ', 'T')) });
  return serializeOrg(doc);
}

// Known differences (listed in ROADMAP.org); the test reports them without failing the run until they are fixed.
test(`a change of TODO state leaves the text Emacs leaves: ${oracle.cases.length} cases`, () => {
  const saved = process.env.TZ;
  process.env.TZ = oracle.tz;
  try {
    const wrong = [];
    for (const c of oracle.cases) {
      let got;
      try {
        got = ours(c);
      } catch (e) {
        got = 'ERROR ' + e.message;
      }
      if (squeezeTags(got) !== squeezeTags(c.emacs)) wrong.push(c);
    }
    if (process.env.TODO_ORACLE_REPORT) {
      const byHead = new Map();
      for (const c of wrong) byHead.set(c.head, (byHead.get(c.head) || 0) + 1);
      console.log(wrong.length, 'differ', [...byHead]);
    }
    assert.equal(wrong.length, 0, `${wrong.length} of ${oracle.cases.length} differ; first: ${JSON.stringify(wrong[0])}`);
  } finally {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  }
});
