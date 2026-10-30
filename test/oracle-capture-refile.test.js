// Holds archiving, the archive tag, refiling, refile targets and capture targets to Emacs 29.3 over a wide corpus:
// test/fixtures/oracle-capture-refile.json was made by tools/gen-oracle-capture-refile.mjs from tools/oracle-capture-refile-cases.mjs
// (clock 2026-10-11 16:30 New York, org-tags-column 0). Each file case is the files before and the files Emacs leaves after
// org-archive-subtree, org-toggle-archive-tag or org-refile; a targets case is the list org-refile-get-targets offers; a capture case is
// the file org-capture leaves after filing at a file+olp target. A case the app does not match is named in KNOWN with the reason.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg, serializeOrg } from '../src/org-parser.js';
import { removeHeading } from '../src/heading-edit.js';
import { appendRefiled, archiveInPlace, buildArchivedClone, endsDocument, getArchiveLocation, insertAtArchiveLocation, isArchivedInPlace, parseArchiveLocation, resolveArchiveFileId, unarchiveInPlace } from '../src/archive-model.js';
import { collectSubtreeHeadings, getRefileCandidates, parseRefileTargetsWithErrors } from '../src/refile.js';
import { fileCapture, resolveOlpTarget } from '../src/capture-template.js';
import { KNOWN, knownFor } from './support/oracle-capture-refile-known.js';

const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/oracle-capture-refile.json', import.meta.url), 'utf8'));
const DIR = '/home/me/org';

/** @param {any[]} nodes @param {string} title @returns {any} */
function findTitle(nodes, title) {
  for (const n of nodes) {
    if (n.title === title) return n;
    const f = findTitle(n.children, title);
    if (f) return f;
  }
  return undefined;
}

/** @param {string} t */
const endLine = (t) => (t === '' || t.endsWith('\n') ? t : t + '\n');

/** What the app leaves for a file case (the files by name), or 'ERROR ...'. @param {any} c */
function ourFiles(c) {
  const prev = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    /** @type {Record<string, any>} */ const docs = {};
    for (const [name, t] of Object.entries(c.files)) docs[name] = parseOrg(/** @type {string} */ (t));
    const src = docs['notes.org'];
    const heading = findTitle(src.children, c.find) || findTitle(src.children, 'COMMENT ' + c.find);
    if (!heading) return 'ERROR no heading';
    const now = new Date(2026, 9, 11, 16, 30);
    if (c.kind === 'toggle') {
      if (isArchivedInPlace(heading)) unarchiveInPlace(heading);
      else archiveInPlace(heading, { now });
    } else if (c.kind === 'refile') {
      const doc = docs[c.toFile || 'notes.org'];
      const target = findTitle(doc.children, c.to);
      if (doc === src && collectSubtreeHeadings(heading).has(target)) return 'ERROR Cannot refile to position inside the tree or region';
      removeHeading(src, heading);
      appendRefiled(doc, target, heading);
    } else {
      const { filePart, headlinePart } = parseArchiveLocation(getArchiveLocation(src, heading));
      const targetId = resolveArchiveFileId(filePart, DIR + '/notes.org');
      const infile = targetId === null || targetId === DIR + '/notes.org';
      const clone = buildArchivedClone(src, heading, DIR + '/notes.org', { now, infile });
      const tailRemoved = infile && endsDocument(src, heading);
      removeHeading(src, heading);
      const name = targetId === null ? 'notes.org' : targetId.split('/').pop() || '';
      const created = !(name in docs);
      docs[name] ||= parseOrg('');
      insertAtArchiveLocation(docs[name], clone, headlinePart, { sourceFileId: DIR + '/notes.org', targetFileId: targetId ?? DIR + '/notes.org', created, tailRemoved });
    }
    // the file layer ends a written file with a line break; the serializer leaves the last line as it is
    return Object.fromEntries(Object.entries(docs).map(([n, d]) => [n, endLine(serializeOrg(d))]));
  } catch (e) {
    return 'ERROR ' + /** @type {Error} */ (e).message;
  } finally {
    if (prev === undefined) delete process.env.TZ;
    else process.env.TZ = prev;
  }
}

/** The target list the app offers for a targets case, as [file, outline path] pairs. @param {any} c */
function ourTargets(c) {
  const text = c.spec
    .map((/** @type {any} */ s) => `${s.file} ${(Object.keys(s.criteria).length ? Object.entries(s.criteria).map(([k, v]) => `${k}=${v}`).join(' ') : 'maxlevel=1000')}`.trim())
    .join('; ');
  /** @type {Record<string, any>} */ const docs = {};
  for (const [name, t] of Object.entries(c.files)) docs[name] = parseOrg(/** @type {string} */ (t));
  const parsed = parseRefileTargetsWithErrors(text);
  if (parsed.errors.length) return 'ERROR';
  const entries = parsed.entries;
  const agenda = Object.keys(c.files);
  return getRefileCandidates(entries, docs, c.current, agenda).map((/** @type {any} */ x) => [x.documentId, x.outlinePath.join('/')]);
}

/** The file the app leaves for a capture case. @param {any} c */
function ourCapture(c) {
  try {
    const doc = parseOrg(c.init);
    const target = resolveOlpTarget(doc, c.target, { allowCreate: false, unique: true });
    if (!target) return 'ERROR no target';
    fileCapture(doc, target, c.type, c.template, !!c.opts.prepend, false, '', '', { ...c.opts });
    return serializeOrg(doc);
  } catch (e) {
    return 'ERROR ' + /** @type {Error} */ (e).message;
  }
}

/** @param {any} c */
function check(c) {
  if (c.kind === 'targets') {
    const want = c.emacs.error ? 'ERROR' : c.emacs.names || [];
    let got = ourTargets(c);
    if (want !== 'ERROR' && got !== 'ERROR') got = got.map(([f, n]) => [f.split('/').pop(), n]);
    return { ok: JSON.stringify(got) === JSON.stringify(want), got, want };
  }
  if (c.kind === 'capture') {
    const want = c.emacs.text;
    const got = ourCapture(c);
    const ok = want.startsWith('ERROR') ? String(got).startsWith('ERROR') : got === want;
    return { ok, got, want };
  }
  const got = ourFiles(c);
  if (c.emacs.error) return { ok: typeof got === 'string' && got.startsWith('ERROR'), got, want: 'ERROR ' + c.emacs.error };
  const want = c.emacs.files;
  if (typeof got === 'string') return { ok: false, got, want };
  return { ok: JSON.stringify(Object.keys(got).sort()) === JSON.stringify(Object.keys(want).sort()) && Object.keys(want).every((n) => got[n] === want[n]), got, want };
}

test('archiving, refiling, refile targets and capture targets give what Emacs gives, except for the listed deviations', () => {
  const bad = [];
  for (const c of oracle.cases) {
    const r = check(c);
    if (!r.ok && !knownFor(c)) bad.push({ kind: c.kind, files: c.files, init: c.init, find: c.find, to: c.to, spec: c.spec, target: c.target, type: c.type, got: r.got, want: r.want });
  }
  assert.equal(bad.length, 0, `${bad.length} of ${oracle.cases.length} differ without a known-deviation rule\n` + JSON.stringify(bad.slice(0, 3), null, 1));
});

test('every known-deviation rule still matches a case the app gets wrong', () => {
  for (const rule of KNOWN) {
    const hit = oracle.cases.some((c) => rule.match(c) && !check(c).ok);
    assert.ok(hit, `rule "${rule.id}" no longer matches a failing case: remove it`);
  }
});

test('(dump) the failing cases, when ORACLE_DUMP names a file', { skip: !process.env.ORACLE_DUMP }, () => {
  const out = oracle.cases.map((c, i) => ({ i, c, r: check(c) })).filter((x) => !x.r.ok).map((x) => ({ i: x.i, kind: x.c.kind, files: x.c.files, init: x.c.init, find: x.c.find, to: x.c.to, toFile: x.c.toFile, spec: x.c.spec, target: x.c.target, type: x.c.type, template: x.c.template, opts: x.c.opts, got: x.r.got, want: x.r.want }));
  fs.writeFileSync(/** @type {string} */ (process.env.ORACLE_DUMP), JSON.stringify(out, null, 1));
});

test('the corpus is wide', () => {
  const kinds = oracle.cases.reduce((/** @type {Record<string, number>} */ m, /** @type {any} */ c) => ((m[c.kind] = (m[c.kind] || 0) + 1), m), {});
  assert.ok(kinds.archive > 250 && kinds.toggle >= 20 && kinds.refile >= 50 && kinds.targets > 50 && kinds.capture > 200, JSON.stringify(kinds));
});
