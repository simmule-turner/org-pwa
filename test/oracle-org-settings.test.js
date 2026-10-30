import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOrg } from '../src/org-parser.js';
import { expandMacrosForExport } from '../src/export-macros.js';
import { parseLocalVariables } from '../src/local-variables.js';
import { parseExportOptions } from '../src/export-options.js';
import { parseStartupConfig } from '../src/startup-config.js';
import { startupLogWords } from '../src/log-settings.js';
import { Reader } from '../src/elisp-read.js';
import { print } from '../src/elisp-data.js';
import { KNOWN } from './support/oracle-org-settings-known.js';

// Emacs 29.3 (tools/gen-oracle-org-settings.mjs): macros, file-local variables, #+OPTIONS and #+STARTUP of whole documents.
const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/oracle-org-settings.json', import.meta.url), 'utf8'));

/** The text lines Emacs kept and the app kept, without the keyword lines (the app keeps those apart from the body). @param {string} s */
const textLines = (s) => s.replace(/^:(PROPERTIES|LOGBOOK):\n(?:.*\n)*?:END:\n?/gm, '').replace(/\u2019/g, "'").split('\n').filter((l) => !/^\s*(SCHEDULED|DEADLINE|CLOSED):/.test(l)).filter((l) => !/^#\+[A-Za-z_]+:/.test(l) && !/^\*+ /.test(l)).map((l) => l.trimEnd()).filter((l, i, a) => l !== '' || (i > 0 && a[i - 1] !== '')).join('\n').trim();

/** @param {{ kind: string, src: string }} c @returns {string} */
function app(c) {
  if (c.kind === 'macro') {
    try {
      const { doc } = expandMacrosForExport(parseOrg(c.src), null, new Date());
      const all = [...doc.bodyLines];
      /** @param {any[]} hs */
      const walk = (hs) => hs.forEach((h) => { all.push(...h.bodyLines); walk(h.children); });
      walk(doc.children);
      return textLines(all.join('\n'));
    } catch (e) { return 'ERROR ' + /** @type {Error} */ (e).message.replace(/\u2019/g, "'"); }
  }
  if (c.kind === 'locals') {
    const v = /** @type {Record<string, string>} */ (parseLocalVariables(c.src));
    return Object.entries(v).filter(([k]) => k !== 'mode').map(([k, raw]) => {
      try { return `${k}=${print(new Reader(raw).read(), true)}`; } catch { return `${k}=ERROR`; }
    }).sort().join('\u0001');
  }
  if (c.kind === 'options') {
    const o = parseExportOptions(parseOrg(c.src));
    return [`:with-toc=${o.toc === true ? 't' : o.toc === false ? 'nil' : o.toc}`, `:section-numbers=${o.num ? 't' : 'nil'}`, `:with-author=${o.author ? 't' : 'nil'}`, `:with-date=${o.date ? 't' : 'nil'}`, `:with-creator=${o.creator ? 't' : 'nil'}`].join('\n');
  }
  const doc = parseOrg(c.src);
  const cfg = parseStartupConfig(doc);
  const w = startupLogWords(doc);
  const folded = { overview: 't', showall: 'nil' }[/** @type {string} */ (cfg.visibility)] ?? cfg.visibility;
  const log = w.logDone === 'time' ? 'time' : w.logDone === 'note' ? 'note' : 'nil';
  return `folded=${folded} log-done=${log} images=${cfg.imageVisibility === 'inlineimages' ? 't' : 'nil'}`;
}

/** What Emacs said, cut down to the same facts. @param {{ kind: string, emacs: string }} c @returns {string} */
function emacs(c) {
  if (c.kind === 'macro') return c.emacs.startsWith('ERROR') ? c.emacs : textLines(c.emacs);
  if (c.kind === 'locals') {
    // the value of a name written twice is the last one, as the app's single map has it
    const m = new Map();
    for (const l of c.emacs.split('\u0001')) if (l && !l.startsWith('mode=')) m.set(l.slice(0, l.indexOf('=')), l);
    return [...m.values()].sort().join('\u0001');
  }
  if (c.kind === 'options') return c.emacs.split('\n').filter((l) => /^:(with-toc|section-numbers|with-author|with-date|with-creator)=/.test(l)).map((l) => l.replace(/^(:with-creator)=(?!t$).*/, '$1=nil').replace(/^(:with-(?:author|date))=(?!nil$).*/, '$1=t').replace(/^(:with-toc)=(?!nil$|-?\d+$).*/, '$1=t').replace(/^(:section-numbers)=(?!nil$).*/, '$1=t')).join('\n');
  const m = /folded=(\S+) log-done=(\S+) images=(\S+) /.exec(c.emacs) ?? [];
  return `folded=${m[1] === 'showeverything' ? 'showeverything' : m[1]} log-done=${m[2] === 'time' || m[2] === 'note' ? m[2] : 'nil'} images=${m[3]}`;
}

test('macros, file-local variables, #+OPTIONS and #+STARTUP give Emacs\'s answer, except the known deviations', () => {
  const bad = [];
  for (const c of oracle.cases) {
    const got = app(c);
    const want = emacs(c);
    if (got === want) continue;
    if (KNOWN.some((k) => k.kind === c.kind && k.match.test(c.src))) continue;
    bad.push({ kind: c.kind, src: c.src, got, want });
  }
  assert.deepEqual(bad.slice(0, 15), []);
  assert.equal(bad.length, 0);
});

test('every known deviation still covers a deviating document', () => {
  for (const k of KNOWN) assert.ok(oracle.cases.some((c) => c.kind === k.kind && k.match.test(c.src) && app(c) !== emacs(c)), k.reason);
});
