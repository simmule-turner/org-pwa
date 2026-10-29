// Holds the app to Emacs 29.3 (Org 9.6) on tags, properties, the match language and in-buffer TODO settings.
// The fixture is written by tools/gen-oracle-search-props.mjs from tools/search-props-cases.mjs.
// ORACLE_REPORT=1 prints every mismatch instead of failing on the first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg } from '../src/org-parser.js';
import { searchDocuments, searchDocumentsByMatchQuery } from '../src/search.js';
import { getAllowedEffortValues } from '../src/effort-values.js';
import { parsePropertyInheritance, parseTagInheritance } from '../src/tag-inheritance.js';
import { resolveTodoSequence, resolveTodoSequences } from '../src/todo-cycle.js';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/oracle-search-props.json', import.meta.url), 'utf8'));
const report = process.env.ORACLE_REPORT === '1';

/** Cases where the app knowingly differs from Emacs: `kind|key` -> why. Nothing is listed here without a reason. */
const KNOWN_DEVIATIONS = new Map([
  // org-element (what export reads) and org-heading-components (what the buffer commands read) disagree in these; the app has one parser and follows the buffer commands, so the org-element view differs
  ['heading|* TODO', 'the app reads it like org-heading-components (TODO keyword, empty title); org-element: title "TODO"'],
  ['heading|* DONE', 'the app reads it like org-heading-components (DONE keyword, empty title); org-element: title "DONE"'],
  ['heading|* TODO :tag:', 'the app reads it like org-heading-components (tag "tag", empty title); org-element: title ":tag:"'],
  ['heading|* TODO [#A] :tag:', 'the app reads it like org-heading-components (tag "tag", empty title); org-element: title ":tag:"'],
  ['heading|* TODO [#A][#B]', 'the app reads it like org-heading-components (no priority, title "[#A][#B]"); org-element: priority A, title "[#B]"'],
  // the search is field-based, not a raw buffer scan (see each reason); a deliberate design difference
]);

/** Runs `check`; with ORACLE_REPORT=1 a failure is printed instead of thrown. @param {string} id @param {() => void} check */
function holds(id, check) {
  const known = KNOWN_DEVIATIONS.has(id);
  /** @type {unknown} */ let failure = null;
  try {
    check();
  } catch (e) {
    failure = e;
  }
  if (known) {
    if (!failure) throw new Error(`${id} now matches Emacs; remove it from KNOWN_DEVIATIONS`);
    return;
  }
  if (!failure) return;
  if (report) console.log('MISMATCH', id, '::', String(/** @type {Error} */ (failure).message).split('\n')[0]);
  else throw failure;
}

/** The 1-based position of each heading in document order. @param {import('../src/types.js').Doc} doc */
function headingIndex(doc) {
  /** @type {Map<unknown, number>} */ const index = new Map();
  /** @param {import('../src/types.js').Heading[]} nodes */
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.type !== 'heading') continue;
      index.set(n, index.size + 1);
      walk(n.children || []);
    }
  };
  walk(doc.children);
  return index;
}

for (const scenario of fixture.scenarios) {
  const { inherit, exclude, propInherit } = scenario.settings;
  const label = `${scenario.kind} inherit=${inherit} exclude=${exclude} prop=${propInherit ?? 'nil'}`;
  test(`match queries under ${label} select what Emacs selects`, () => {
    const savedTz = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      const doc = parseOrg(scenario.org);
      const index = headingIndex(doc);
      const policy = parseTagInheritance(inherit, exclude);
      const now = new Date(2026, 9, 11, 16, 30);
            for (const { query, emacs } of scenario.cases) {
        if (emacs.error) continue; // Emacs's own failure (a bug in org-make-tags-matcher); the app leaves such text unread
        holds(`match|${label}|${query}`, () => {
          const got = searchDocumentsByMatchQuery([{ documentId: 'fx.org', doc }], query, {
            useTagInheritance: policy, usePropertyInheritance: parsePropertyInheritance(propInherit ?? 'nil') ?? false, doneKeywords: resolveTodoSequence(doc).doneKeywords, now,
          }).map((r) => index.get(r.heading));
          assert.deepEqual(got, emacs.ok, `got ${JSON.stringify(got)} want ${JSON.stringify(emacs.ok)}`);
        });
      }
    } finally {
      if (savedTz === undefined) delete process.env.TZ;
      else process.env.TZ = savedTz;
    }
  });
}

/** What the app reads of a heading line, in the shape the oracle records. @param {string} spec @param {string} line */
function appHeading(spec, line) {
  const h = parseOrg(spec + line + '\n').children[0];
  return h ? { level: h.level, todo: h.todo || null, priority: h.priority ? h.priority.charCodeAt(0) : null, title: h.title, tags: h.tags || [] } : null;
}

test('a heading line is read the way org-element reads it', () => {
  for (const { line, emacs } of fixture.headings.cases) {
    holds(`heading|${line}`, () => {
      const got = appHeading(fixture.headings.spec, line);
      const el = emacs.element;
      if (!emacs.heading) {
        assert.equal(got, null, `${JSON.stringify(line)} is not a heading`);
        return;
      }
      assert.ok(got, `${JSON.stringify(line)} is a heading`);
      // the app keeps COMMENT in the title (see comment-model.js) and drops the empty tags org-element reports for "::"
      const title = el.commented ? emacs.title ?? '' : el.title;
      assert.deepEqual(got, { level: el.level, todo: el.todo, priority: el.priority, title, tags: el.tags.filter(Boolean) }, JSON.stringify(line));
    });
  }
});

test('a heading line is read the way the buffer commands read it (org-heading-components)', () => {
  for (const { line, emacs } of fixture.headings.cases) {
    holds(`interactive|${line}`, () => {
      const got = appHeading(fixture.headings.spec, line);
      if (!emacs.heading) {
        assert.equal(got, null);
        return;
      }
      assert.ok(got);
      assert.deepEqual(got, { level: emacs.level, todo: emacs.todo, priority: emacs.priority, title: emacs.title ?? '', tags: emacs.tags }, JSON.stringify(line));
    });
  }
});

test('#+TODO lines define the keyword sets Emacs defines', () => {
  for (const { spec, emacs } of fixture.specs) {
    if (emacs.error) continue; // Emacs signals an error for the line (an empty fast key); nothing to compare
    holds(`spec|${spec}`, () => {
      const doc = parseOrg(spec + '\n* x\n');
      const seqs = resolveTodoSequences(doc);
      const one = resolveTodoSequence(doc);
      const real = (/** @type {string[]} */ list) => list.filter((k) => k !== '|'); // a stray "|" after the first one is a done keyword in Emacs, but org-todo-sets leaves it out
      assert.deepEqual([...new Set(real(seqs.flatMap((q) => q.todoKeywords.concat(q.doneKeywords))))], [...new Set(emacs.keywords)], 'keywords (each once, set by set)');
      assert.deepEqual(one.doneKeywords, emacs.done, 'done keywords');
      assert.deepEqual(seqs.map((s) => real(s.todoKeywords.concat(s.doneKeywords))), emacs.sets, 'sets');
      const keys = new Map(emacs.keys.map((/** @type {{ k: string, c: string | false }} */ x) => [x.k, x.c]));
      for (const [kw, key] of Object.entries(one.keySpecs)) assert.equal(keys.get(kw), key, `fast key of ${kw}`);
    });
  }
});

test('a regexp search finds the headings org-occur finds', () => {
  const doc = parseOrg(fixture.occur.org);
  const index = headingIndex(doc);
  const docs = [{ documentId: 'fx.org', doc }];
  /** @param {string} query @param {boolean} useRegex */
  const found = (query, useRegex) => [...new Set(searchDocuments(docs, query, { useRegex }).map((r) => index.get(r.heading) ?? 0))].sort((a, b) => a - b);
  for (const { query, emacs } of fixture.occur.regexp) {
    if (emacs.error && emacs.error.startsWith('SKIPPED')) continue; // org-occur would loop on a regexp that matches nothing
    holds(`occur|${query}`, () => {
      if (emacs.error) {
        assert.throws(() => found(query, true), `${JSON.stringify(query)} is an invalid regexp in Emacs: ${emacs.error}`);
        return;
      }
      const got = found(query, true);
      assert.deepEqual(got, emacs.ok, `regexp ${JSON.stringify(query)} got ${JSON.stringify(got)} want ${JSON.stringify(emacs.ok)}`);
    });
  }
  for (const { query, emacs } of fixture.occur.plain) {
    holds(`occur-plain|${query}`, () => {
      const got = found(query, false);
      assert.deepEqual(got, emacs.ok, `text ${JSON.stringify(query)} got ${JSON.stringify(got)} want ${JSON.stringify(emacs.ok)}`);
    });
  }
});

test('the allowed effort values are the ones org-property-get-allowed-values answers', () => {
  fixture.allowed.forEach((/** @type {{ org: string, heading: number, global: string | null, emacs: { ok?: string[], error?: string } }} */ c, i) => {
    holds(`allowed|${i}|${JSON.stringify(c.org)}${c.global ? ' global ' + c.global : ''}`, () => {
      const doc = parseOrg(c.org);
      const headings = [...headingIndex(doc).keys()];
      const ask = () => getAllowedEffortValues({ doc, heading: headings[c.heading - 1], globalProperties: c.global ? `Effort_ALL: ${c.global}` : '' });
      if (c.emacs.error) assert.throws(ask, { message: c.emacs.error });
      else assert.deepEqual(ask(), c.emacs.ok);
    });
  });
});
