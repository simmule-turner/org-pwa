// examples/capture-functions.org holds what Emacs 29.3 left after org-capture filed templates that use Lisp functions: a target function
// (file+function) and :prepare-finalize (tools/gen-example-capture-functions.mjs). The app must file the same text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import { scanPrompts } from '../src/capture-template.js';
import { captureInto } from '../src/capture-run.js';
import { captureTemplatesFromLisp } from '../src/capture-lisp.js';
import { launchFromShare } from '../src/capture-shared.js';
import { setTagsColumn } from '../src/tags-column.js';
import { parseNamedTables, parseTableConstants, recalculateTable } from '../src/table-formula.js';

setTagsColumn(-77); // Emacs's default org-tags-column, which the file was made with
const text = readFileSync(new URL('../examples/capture-functions.org', import.meta.url), 'utf8');
const unescape = (/** @type {string} */ s) => s.replace(/^,(\*|#\+)/gm, '$1');
const block = (/** @type {string} */ sec, /** @type {string} */ label, /** @type {string} */ lang) => {
  const m = new RegExp(`^${label}:\\n#\\+BEGIN_SRC ${lang}\\n([\\s\\S]*?)\\n?#\\+END_SRC`, 'm').exec(sec);
  assert.ok(m, `${label} in ${sec.split('\n')[0]}`);
  return m[1];
};
const sections = text.split(/^\* /m).slice(1).filter((s) => /^Captured on /m.test(s));

/** The options of filing a template into `doc`, with the table recalculated as the Capture panel does. @param {import('../src/types.js').CaptureTemplate} template */
export const placeFor = (template) => (/** @type {import('../src/types.js').Doc} */ doc) => ({
  emptyLines: template.emptyLines,
  emptyLinesBefore: template.emptyLinesBefore,
  emptyLinesAfter: template.emptyLinesAfter,
  tableLinePos: template.tableLinePos,
  recalculate: (/** @type {import('../src/types.js').Table} */ table) => {
    try {
      return recalculateTable(table, { hourZeroPad: false, constants: parseTableConstants(doc), tables: parseNamedTables(doc), userCall: () => null });
    } catch {
      return null;
    }
  },
});

test('the file has its twelve cases', () => {
  assert.equal(sections.length, 12);
});

for (const sec of sections) {
  const title = sec.split('\n')[0];
  test(`capture-functions.org, "${title}": the app files what Emacs filed`, () => {
    const when = /^Captured on (\d+)-(\d+)-(\d+) \w+ (\d+):(\d+)(, (\d+) times)?(, after one capture on (\d+)-(\d+)-(\d+))?\./m.exec(sec);
    assert.ok(when);
    const { templates, notes } = captureTemplatesFromLisp(block(sec, 'In the Lisp init', 'emacs-lisp'));
    assert.deepEqual(notes, []);
    const keys = /^Templates captured, in order: (.*)\.$/m.exec(sec)?.[1].split(', ') ?? [templates[0].key];
    const fields = (/** @type {string} */ label) => {
      /** @type {Record<string, string>} */ const out = {};
      let name = '';
      for (const line of block(sec, label, 'text').split('\n')) {
        const m = /^- (.+?): (.*)$/.exec(line);
        if (m) out[(name = m[1])] = m[2];
        else out[name] += '\n' + line.replace(/^ {4}/, '');
      }
      return out;
    };
    const answers = /^Answers to the prompts:/m.test(sec) ? fields('Answers to the prompts') : {};
    const typed = /^Typed at the cursor/m.test(sec) ? fields('Typed at the cursor \\(=%\\?=\\)') : {};
    const shared = /^Shared into the app:/m.test(sec) ? launchFromShare(fields('Shared into the app')).shared : null;
    const doc = parseOrg(unescape(block(sec, 'Before, [a-z.]+', 'org')) + '\n');
    const at = (/** @type {number[]} */ [y, mo, d, h, mi]) => new Date(y, mo - 1, d, h, mi);
    const times = [];
    if (when[8]) times.push(at([+when[9], +when[10], +when[11], 8, 0]));
    for (let i = 0; i < +(when[7] || 1); i++) times.push(at([+when[1], +when[2], +when[3], +when[4], +when[5]]));
    for (const now of times) {
      for (const key of keys) {
        const template = /** @type {import('../src/types.js').CaptureTemplate} */ (templates.find((t) => t.key === key));
        assert.ok(template, key);
        const asked = scanPrompts(template.template, { shared }).map((p) => (p.prompt === 'Text' ? typed[key] : answers[p.prompt] ?? answers[p.timestamp ? 'date' : '']) ?? '');
        const r = captureInto(doc, template, { now, answers: asked, context: { shared }, place: placeFor(template) });
        assert.deepEqual(r.ok ? 'ok' : r.message, 'ok');
      }
    }
    assert.equal(serializeOrg(doc), unescape(block(sec, 'After, [a-z.]+', 'org')) + '\n');
  });
}
