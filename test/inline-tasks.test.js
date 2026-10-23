import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseOrg } from '../src/org-parser.js';
import { exportToOdt } from '../src/export-odt.js';
import { setInlineTaskLevel, readInlineTaskLevel } from '../src/inline-tasks.js';

const src = '* One\ntext\n\n*************** TODO Fix it :w:\nbody\n*************** END\n\nafter\n';
test.after(() => setInlineTaskLevel(null));

test('ODT export writes an inline task as a bordered title over its text', () => {
  setInlineTaskLevel(15);
  const dir = mkdtempSync(path.join(tmpdir(), 'inline-odt-'));
  writeFileSync(path.join(dir, 't.odt'), exportToOdt(parseOrg(src)));
  execFileSync('unzip', ['-o', '-q', path.join(dir, 't.odt'), '-d', dir]);
  const content = readFileSync(path.join(dir, 'content.xml'), 'utf8');
  assert.match(content, /<text:p text:style-name="OrgInlineTaskHeading"><text:span text:style-name="OrgTodo">TODO<\/text:span> Fix it/);
  assert.ok(content.indexOf('OrgInlineTaskHeading') < content.indexOf('>body\n<') && content.indexOf('>body\n<') < content.indexOf('>after\n<'));
});

test('org-inlinetask is read from org-modules, the Lisp init, or a require', () => {
  assert.equal(readInlineTaskLevel({}), null);
  assert.equal(readInlineTaskLevel({ 'org-modules': '(org-inlinetask)' }), 15);
  assert.equal(readInlineTaskLevel({ 'org-modules': 'org-inlinetask', 'org-inlinetask-min-level': '10' }), 10);
  assert.equal(readInlineTaskLevel({ 'org-xx-lisp-init': "(add-to-list 'org-modules 'org-inlinetask)" }), 15);
  assert.equal(readInlineTaskLevel({ 'org-xx-lisp-init': "(require 'org-inlinetask)\n(setq org-inlinetask-min-level 12)" }), 12);
});
