// The *Org Agenda* text of custom commands (src/agenda-buffer.js) against Emacs 29.3: test/fixtures/command-text.json was made by
// tools/gen-command-text-oracle.mjs from tools/command-text-cases.mjs. Composite commands, stuck projects and commands with settings of
// their own: each block's heading (or the one org-agenda-overriding-header gives), its rows in Emacs's prefix format, the line of "="
// between blocks, an agenda block's days, org-agenda-files named by a command, and the filter presets. Today is 2026-10-11 16:30.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg } from '../src/org-parser.js';
import { resolveTodoSequence } from '../src/todo-cycle.js';
import { parseCustomCommands } from '../src/agenda-commands.js';
import { blockPlan, commandBufferText } from '../src/agenda-buffer.js';
import { parseAgendaFilesVar } from '../src/local-variables.js';
import { CASES, FILES } from '../tools/command-text-cases.mjs';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/command-text.json', import.meta.url), 'utf8'));
const docs = Object.entries(FILES).map(([documentId, text]) => ({ documentId, doc: parseOrg(text) }));
const mini = [docs[0]];
const sequence = resolveTodoSequence(docs[0].doc, ['TODO', 'DONE']);

/** The app names a file by its scheme: `local:other.org` is the Emacs case's "other.org". @param {string} commands */
const forApp = (commands) => commands.replace(/"(mini|other)\.org"/g, '"local:$1.org"');

for (const [id, commands, vars] of CASES) {
  const want = oracle.cases.find((/** @type {{ id: string }} */ c) => c.id === id);
  test(`command text: ${id}`, () => {
    assert.ok(want && !want.error, `Emacs gave text for ${id}`);
    const savedTz = process.env.TZ;
    process.env.TZ = oracle.tz;
    try {
      const command = parseCustomCommands(forApp(commands)).find((c) => c.key === 'x');
      assert.ok(command, 'the command reads');
      const ctx = {
        docs: mini,
        searchDocs: mini,
        options: { todoKeywords: sequence.todoKeywords, doneKeywords: sequence.doneKeywords, now: new Date(2026, 9, 11, 16, 30), localVariables: vars, documentOrder: ['mini.org', 'other.org'] },
        filesDocs: (names) => {
          const keys = parseAgendaFilesVar(names).map((k) => k.replace(/^local:/, ''));
          return docs.filter((d) => keys.includes(d.documentId)).sort((a, b) => keys.indexOf(a.documentId) - keys.indexOf(b.documentId));
        },
      };
      const text = commandBufferText(command, ctx);
      const lines = text.split('\n').map((l) => l.trimEnd());
      while (lines.length && lines[lines.length - 1] === '') lines.pop();
      assert.deepEqual(lines, want.lines);
      // the hint under the heading of a single command, which the live screen shows
      const plan = command.type === 'block' ? null : blockPlan(command, {}, true, ctx);
      assert.equal(plan && !plan.agenda ? plan.hint : '', want.hint ?? '');
    } finally {
      if (savedTz === undefined) delete process.env.TZ;
      else process.env.TZ = savedTz;
    }
  });
}
