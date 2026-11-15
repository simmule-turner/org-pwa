#!/usr/bin/env node
/**
 * Writes test/fixtures/oracle-babel-ops.json: what Emacs 29.3 (Org 9.6) does for the Babel commands (C-c C-c on inline blocks and
 * #+CALL: lines, the Library of Babel, next/previous block, where-is/remove result, execute buffer/subtree, sbe in table formulas),
 * for the cases of tools/oracle-babel-ops-cases.mjs.  Emacs runs in a temporary directory, so :file results never touch this tree.
 *   node tools/gen-oracle-babel-ops.mjs   (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { opsCases } from './oracle-babel-ops-cases.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-babel-ops-'));
const input = path.join(dir, 'in.json');
const output = path.join(dir, 'out.json');
fs.writeFileSync(input, JSON.stringify(opsCases));
const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(root, 'tools', 'oracle-babel-ops.el')], { cwd: dir, env: { ...process.env, ORACLE_IN: input, ORACLE_OUT: output }, encoding: 'utf8', timeout: 900_000 });
if (!fs.existsSync(output)) throw new Error(r.stderr);
const results = JSON.parse(fs.readFileSync(output, 'utf8'));
fs.writeFileSync(path.join(root, 'test', 'fixtures', 'oracle-babel-ops.json'), JSON.stringify({ emacs: 'Emacs 29.3 / Org 9.6.15', cases: opsCases.map((c, i) => ({ ...c, want: c.op === 'sbe' ? results[i].replace('\u2038', '') : results[i] })) }, null, 1) + '\n');
fs.rmSync(dir, { recursive: true, force: true });
console.log(`${opsCases.length} cases`);
