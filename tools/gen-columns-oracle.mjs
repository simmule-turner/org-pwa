#!/usr/bin/env node
/**
 * Writes test/fixtures/columns-oracle.json: the table Emacs's `#+BEGIN: columnview` dynamic block writes for a document, a column
 * format and the block's parameters (org-update-dblock in Emacs 29.3), together with the document as Emacs leaves it afterward
 * (summaries are written back into the properties of the parents).
 *   node tools/gen-columns-oracle.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DOC1 = `#+TITLE: Plan
#+COLUMNS: %25ITEM %TODO %3PRIORITY %TAGS %10Effort(Est){:} %CLOCKSUM
* Project
:PROPERTIES:
:Effort: 0:30
:Cost: 5
:END:
** TODO [#A] Design :ui:
DEADLINE: <2026-12-01 Tue>
:PROPERTIES:
:Effort: 2:00
:Cost: 10.5
:Owner: ann
:END:
:LOGBOOK:
CLOCK: [2026-11-01 Sun 09:00]--[2026-11-01 Sun 10:30] =>  1:30
:END:
** DONE Build :dev:ui:
SCHEDULED: <2026-11-20 Fri>
:PROPERTIES:
:Effort: 1d 2:00
:Cost: 20
:Owner: bob
:END:
:LOGBOOK:
CLOCK: [2026-11-02 Mon 09:00]--[2026-11-02 Mon 12:00] =>  3:00
:END:
*** TODO Sub one
:PROPERTIES:
:Effort: 0:45
:END:
*** Sub two [1/2]
:PROPERTIES:
:Effort: 0:15
:Cost: 1
:END:
* Notes :misc:
:PROPERTIES:
:Owner: carl
:END:
Text here.
** Idea | with bar
** Deep
*** Deeper
**** Deepest
`;
const DOC2 = `* Tasks
** TODO Write
:PROPERTIES:
:Done: [ ]
:Score: 3
:Time: 1:15
:Range: 10-20
:END:
** TODO Read
:PROPERTIES:
:Done: [X]
:Score: 5
:Time: 0:45
:Range: 5-15
:END:
** Rest
:PROPERTIES:
:Done: [X]
:Score: 1.5
:Time: 2:00
:Range: 8
:END:
`;
const DOC3 = `* A
:PROPERTIES:
:COLUMNS: %ITEM(What) %Cost{+;%.1f} %Hours{:}
:Cost_ALL: 1 2 3
:END:
** x
:PROPERTIES:
:Cost: 1
:Hours: 1:00
:END:
** y
:PROPERTIES:
:Cost: 2.25
:Hours: 2:30
:END:
* B
** z
:PROPERTIES:
:Cost: 3
:END:
`;
const DOC4 = `* Tasks
** one
:PROPERTIES:
:Cost: 3
:END:
** two
:PROPERTIES:
:Cost: 4
:END:
*** two-a
:PROPERTIES:
:Cost: 1
:END:
*** two-b
:PROPERTIES:
:Cost: 2
:END:
** three
`;
const FMTS = [
  '%ITEM %TODO %Effort',
  '%30ITEM(Task) %TODO %3PRIORITY %TAGS',
  '%ITEM %DEADLINE %SCHEDULED %CLOCKSUM',
  '%ITEM %Effort{:} %Cost{+} %Owner',
  '%ITEM %Cost{+;%.2f} %Effort{:max}',
  '%ITEM %Cost{min} %Cost(Max){max} %Cost(Mean){mean}',
  '%ITEM %Cost{$}',
  '%ITEM %Effort{:min} %Effort(Mean){:mean}',
  '%ITEM %5CATEGORY %ALLTAGS',
  '%ITEM %Missing',
  '%TODO %ITEM',
  '%8ITEM',
];
const cases = [];
for (const fmt of FMTS) cases.push({ doc: DOC1, params: `:id global :format "${fmt}"`, name: 'fmt' });
cases.push({ doc: DOC1, params: ':id global' });
cases.push({ doc: DOC1, params: ':id global :maxlevel 2' });
cases.push({ doc: DOC1, params: ':id global :maxlevel 1' });
cases.push({ doc: DOC1, params: ':id global :hlines t' });
cases.push({ doc: DOC1, params: ':id global :hlines 1' });
cases.push({ doc: DOC1, params: ':id global :hlines 2 :indent t' });
cases.push({ doc: DOC1, params: ':id global :indent t' });
cases.push({ doc: DOC1, params: ':id global :vlines t' });
cases.push({ doc: DOC1, params: ':id global :skip-empty-rows t :format "%ITEM %Owner"' });
cases.push({ doc: DOC1, params: ':id global :exclude-tags ("ui")' });
cases.push({ doc: DOC1, params: ':id global :match "+ui"' });
cases.push({ doc: DOC1, params: ':id global :match "Cost>5"' });
cases.push({ doc: DOC1, params: ':id global :match "TODO=\\"TODO\\""' });
cases.push({ doc: DOC1, params: ':id global :match "LEVEL=2" :maxlevel 2' });
for (const fmt of ['%ITEM %Done{X} %Score{+} %Time{:} %Range{est+}', '%ITEM %Done{X/} %Score{max} %Time{:mean}', '%ITEM %Done{X%} %Score{mean;%.2f} %Time{:max}', '%ITEM %Range{est+;ignored}'])
  cases.push({ doc: DOC2, params: `:id global :format "${fmt}"` });
cases.push({ doc: DOC3, params: ':id global' });
cases.push({ doc: DOC3, params: ':id global :format "%ITEM %Cost{+}"' });
cases.push({ doc: DOC4, params: ':id global :format "%ITEM %Cost{+}"' });
cases.push({ doc: DOC4, params: ':id global :format "%ITEM %Cost{+;%03d}"' });
cases.push({ doc: DOC4, params: ':id global :format "%ITEM %Cost{max}" :skip-empty-rows t' });
// local: the block sits under "Block", whose subtree is the view
for (const params of [':id local', ':id local :format "%ITEM %Cost{+}"', ':id local :maxlevel 2 :format "%ITEM %Cost{+}"', ':id local :hlines t'])
  cases.push({ doc: '* Top\n:PROPERTIES:\n:Cost: 9\n:END:\n* Block\n:PROPERTIES:\n:Cost: 1\n:END:\n#BLOCK#\n** c1\n:PROPERTIES:\n:Cost: 2\n:END:\n** c2\n*** c2a\n:PROPERTIES:\n:Cost: 5\n:END:\n* After\n', params, local: true });
cases.push({ doc: '* Block\n#BLOCK#\n** x\n', params: ':id local', local: true });
cases.push({ doc: '#+COLUMNS: %ITEM %Cost\n* One\n:PROPERTIES:\n:Cost: 4\n:END:\n#BLOCK#\n', params: ':id global', local: true });

// more shapes: the default format, archived and commented subtrees, IDs, file-level properties, ages, titles and notes in the block
cases.push({ doc: '* Alpha\n** TODO Beta :x:\n*** Gamma\n', params: ':id global' });
cases.push({ doc: '* Alpha\n:PROPERTIES:\n:Cost: 1\n:END:\n** Beta :ARCHIVE:\n:PROPERTIES:\n:Cost: 2\n:END:\n*** Beta1\n** COMMENT Gamma\n:PROPERTIES:\n:Cost: 4\n:END:\n*** Gamma1\n** Delta\n:PROPERTIES:\n:Cost: 8\n:END:\n', params: ':id global :format "%ITEM %Cost{+}"' });
cases.push({ doc: '* Alpha\n** Beta\n:PROPERTIES:\n:ID: abc\n:Cost: 1\n:END:\n*** Beta1\n:PROPERTIES:\n:Cost: 2\n:END:\n*** Beta2\n:PROPERTIES:\n:Cost: 3\n:END:\n** Other\n', params: ':id "abc" :format "%ITEM %Cost{+}"' });
cases.push({ doc: '#+PROPERTY: COLUMNS %ITEM %Cost{+}\n* Alpha\n** Beta\n:PROPERTIES:\n:Cost: 2\n:END:\n', params: ':id global' });
cases.push({ doc: ':PROPERTIES:\n:COLUMNS: %ITEM(File) %Cost{+}\n:END:\n* Alpha\n** Beta\n:PROPERTIES:\n:Cost: 2\n:END:\n', params: ':id global' });
cases.push({ doc: '#+COLUMNS: %ITEM(Name) %Cost{+}\n#+PROPERTY: COLUMNS %ITEM %Owner\n* Alpha\n:PROPERTIES:\n:Owner: x\n:END:\n', params: ':id global' });
cases.push({ doc: '* Alpha\n:PROPERTIES:\n:Age: 1d 3h\n:END:\n** Beta\n:PROPERTIES:\n:Age: 2:00\n:END:\n** Gamma\n:PROPERTIES:\n:Age: 30min\n:END:\n', params: ':id global :format "%ITEM %Age{@max} %Age(Min){@min} %Age(Mean){@mean}"' });
cases.push({ doc: '* Alpha\n:PROPERTIES:\n:Cost: 1\n:END:\n', params: ':id global :format "%ITEM %Cost{foo}"' });
cases.push({ doc: '* Alpha\n:PROPERTIES:\n:Cost: 1\n:END:\n', params: ':id global :format "%ITEM %TODO{+} %Cost{+;%d}"' });
cases.push({ doc: '* Alpha\n** Beta\n:PROPERTIES:\n:Cost: 1\n:END:\n** Gamma\n:PROPERTIES:\n:Cost: 2\n:END:\n', params: ':id global :format "%ITEM(Task name) %Cost(Total){+}"' });
cases.push({ doc: '* Alpha\n:PROPERTIES:\n:COLUMNS: %ITEM %Cost{+}\n:END:\n** Beta\n:PROPERTIES:\n:Cost: 2\n:END:\n*** Beta1\n:PROPERTIES:\n:Cost: 5\n:END:\n* Zeta\n#BLOCK#\n', params: ':id local', local: true });
cases.push({ doc: '* Alpha\n:PROPERTIES:\n:COLUMNS: %ITEM %Cost{+}\n:END:\n** Beta\n:PROPERTIES:\n:Cost: 2\n:END:\n#BLOCK#\n*** Beta1\n:PROPERTIES:\n:Cost: 5\n:END:\n* Zeta\n', params: ':id local', local: true });
cases.push({ doc: '* Alpha\n** TODO Task [1/3] [fn:1] x\n** [1/2] lead\n** Beta <<t>> y src_js{1} z\n', params: ':id global :format "%ITEM %TODO"' });
cases.push({ doc: '* Alpha\n:PROPERTIES:\n:Cost: 1\n:END:\n', params: ':id global :format "%ITEM %Cost{+}"', content: '#+CAPTION: Cost table\n| old |\n' });
cases.push({ doc: '* Alpha\n:PROPERTIES:\n:Cost: 1\n:END:\n** Beta\n:PROPERTIES:\n:Cost: 2\n:END:\n', params: ':id global :format "%ITEM %Cost{+} %Twice"', content: '| old |\n#+TBLFM: $3=$2*2\n' });

cases.push({ doc: '* Alpha\n** Beta\n:PROPERTIES:\n:Cost: 2\n:END:\n', params: ':id global :format "%ITEM %Cost{+} %Twice %Three"', content: '| old |\n#+TBLFM: $3=$2*2\n#+TBLFM: $4=$2*3\n' });
cases.push({ doc: '* Alpha\n** Beta\n:PROPERTIES:\n:Cost: 2\n:END:\n', params: ':id global :format "%ITEM %Cost{+} %Twice" :vlines t', content: '| old |\n#+TBLFM: $4=$3*2\n' });
cases.push({ doc: '* Alpha\n** Beta\n:PROPERTIES:\n:Cost: 2\n:END:\n', params: ':id global :format "%ITEM %Cost{+}"', content: '| old |\n#+TBLFM: @>$2=vsum(@I..@II)\n' });

cases.push({ doc: '#+TITLE: x\n#BLOCK#\n* Alpha\n:PROPERTIES:\n:Cost: 3\n:END:\n** Beta\n:PROPERTIES:\n:Cost: 4\n:END:\n', params: ':id global :format "%ITEM %Cost{+}"', local: true });

cases.push({ doc: '* Alpha\n:LOGBOOK:\nCLOCK: [2026-11-01 Sun 09:00]--[2026-11-01 Sun 10:30] =>  1:30\nCLOCK: [2026-11-02 Mon 09:00]\n:END:\n** Beta\n:LOGBOOK:\nCLOCK: [2026-11-03 Tue 09:00]--[2026-11-03 Tue 10:00] =>  1:00\n:END:\n', params: ':id global :format "%ITEM %CLOCKSUM %CLOCKSUM_T"' });

const q = (s) => JSON.stringify(s);
const prepared = cases.map((c) => {
  const block = `#+BEGIN: columnview ${c.params}\n${c.content ?? ''}#+END:`;
  const text = c.doc.includes('#BLOCK#') ? c.doc.replace('#BLOCK#', block) : c.doc.replace(/\n?$/, '\n') + `* Report\n${block}\n`;
  return { ...c, text };
});
const el = `
(require 'org) (require 'org-colview) (require 'json) (require 'cl-lib)
(setq org-id-locations-file "/nonexistent/ids" org-id-track-globally nil)
(defun run-case (text)
  (with-temp-buffer
    (org-mode)
    (insert text)
    (goto-char (point-min))
    (re-search-forward "^#\\\\+BEGIN: columnview")
    (beginning-of-line)
    (condition-case err
        (progn (org-update-dblock) (substring-no-properties (buffer-string)))
      (error (concat "ERROR " (error-message-string err))))))
(let (out)
  ${prepared.map((c) => `(push (run-case ${q(c.text)}) out)`).join('\n  ')}
  (princ (json-encode (vconcat (nreverse out)))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'columns-'));
const file = path.join(dir, 'run.el');
fs.writeFileSync(file, el);
const r = spawnSync('emacs', ['--batch', '-Q', '-l', file], { encoding: 'utf8', maxBuffer: 1 << 26 });
const m = r.stdout.match(/\[.*\]$/s);
if (!m) { console.error(r.stdout.slice(-1500), r.stderr.slice(-2000)); process.exit(1); }
const outs = JSON.parse(m[0]);
fs.writeFileSync(new URL('../test/fixtures/columns-oracle.json', import.meta.url), JSON.stringify({ cases: prepared.map((c, i) => ({ text: c.text, emacs: outs[i] })) }, null, 1) + '\n');
console.log(`${prepared.length} cases, ${outs.filter((o) => o.startsWith('ERROR')).length} errors`);
