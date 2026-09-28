import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, searchCommands, pushRecent } from '../src/command-palette.js';

const COMMANDS = [
  { id: 'todo', label: 'Cycle TODO state', orgName: 'org-todo', group: 'Heading' },
  { id: 'effort', label: 'Set effort estimate', orgName: 'org-set-effort', group: 'Heading' },
  { id: 'details', label: 'Edit details', orgName: 'org-schedule', group: 'Heading', keywords: ['deadline', 'timestamp', 'org-set-tags-command'] },
  { id: 'clock-in', label: 'Clock in', orgName: 'org-clock-in', group: 'Clocking' },
  { id: 'clock-out', label: 'Clock out', orgName: 'org-clock-out', group: 'Clocking' },
  { id: 'save', label: 'Save', orgName: 'save-buffer', group: 'Document' },
  { id: 'save-as', label: 'Save as', orgName: 'write-file', group: 'Document' },
  { id: 'agenda', label: 'Agenda', orgName: 'org-agenda', group: 'View' },
];
const ids = (results) => results.map((r) => r.command.id);

test('normalize: case, hyphens, underscores and runs of spaces', () => {
  assert.equal(normalize('  Org-Clock_In   '), 'org clock in');
  assert.equal(normalize(null), '');
  assert.equal(normalize(undefined), '');
});

test('an empty query lists everything in the listed order', () => {
  assert.deepEqual(ids(searchCommands(COMMANDS, '')), COMMANDS.map((c) => c.id));
  assert.deepEqual(ids(searchCommands(COMMANDS, '   ')), COMMANDS.map((c) => c.id));
});

test('an empty query puts recently used commands first, most recent first', () => {
  const results = searchCommands(COMMANDS, '', { recentIds: ['agenda', 'save'] });
  assert.deepEqual(ids(results).slice(0, 2), ['agenda', 'save']);
  assert.deepEqual(results.slice(0, 2).map((r) => r.recent), [true, true]);
  assert.equal(results[2].recent, false);
  assert.equal(results.length, COMMANDS.length);
});

test('a recent id that is no longer a command is ignored', () => {
  assert.equal(searchCommands(COMMANDS, '', { recentIds: ['gone'] }).length, COMMANDS.length);
});

test('every word must match: "clock out" finds only Clock out', () => {
  assert.deepEqual(ids(searchCommands(COMMANDS, 'clock out')), ['clock-out']);
});

test('a real Org command name finds the command, hyphens and all', () => {
  assert.deepEqual(ids(searchCommands(COMMANDS, 'org-set-effort')), ['effort']);
  assert.deepEqual(ids(searchCommands(COMMANDS, 'org-clock')), ['clock-in', 'clock-out']);
  assert.deepEqual(ids(searchCommands(COMMANDS, 'write-file')), ['save-as']);
});

test('the label works with or without hyphens either side: "clock in" finds org-clock-in', () => {
  assert.equal(ids(searchCommands(COMMANDS, 'clock in'))[0], 'clock-in');
});

test('a hyphenated word is matched as ONE phrase, so org-clock-in does not also find org-clock-out', () => {
  assert.deepEqual(ids(searchCommands(COMMANDS, 'org-clock-in')), ['clock-in']);
  assert.deepEqual(ids(searchCommands(COMMANDS, 'org_clock_out')), ['clock-out']);
});

test('a group name only matches at the start of one of its words, not inside one', () => {
  const commands = [{ id: 'a', label: 'Alpha', group: 'Clocking tools' }];
  assert.deepEqual(ids(searchCommands(commands, 'in')), [], '"in" is inside "Clocking" but starts none of its words');
  assert.deepEqual(ids(searchCommands(commands, 'clock')), ['a']);
  assert.deepEqual(ids(searchCommands(commands, 'tools')), ['a'], 'a later word of the group still matches at its start');
});

test('keywords find a command that names them nowhere else', () => {
  assert.deepEqual(ids(searchCommands(COMMANDS, 'deadline')), ['details']);
  assert.deepEqual(ids(searchCommands(COMMANDS, 'org-set-tags-command')), ['details']);
  assert.deepEqual(ids(searchCommands(COMMANDS, 'org-schedule')), ['details']);
});

test('matching is case-insensitive', () => {
  assert.deepEqual(ids(searchCommands(COMMANDS, 'EFFORT')), ['effort']);
});

test('a command that does not contain what was typed does not match', () => {
  assert.deepEqual(ids(searchCommands(COMMANDS, 'zzz')), []);
  assert.deepEqual(ids(searchCommands(COMMANDS, 'save zzz')), []);
});

test('a label that starts with the word outranks one that merely contains it', () => {
  // "save" starts Save and Save as; "buffer" is only inside their org name
  const results = ids(searchCommands(COMMANDS, 'save'));
  assert.deepEqual(results.slice(0, 2), ['save', 'save-as']);
});

test('a word starting a label word outranks a match inside a word', () => {
  const commands = [
    { id: 'inside', label: 'Reschedule everything' },
    { id: 'word', label: 'Then schedule it' },
  ];
  assert.deepEqual(ids(searchCommands(commands, 'schedule')), ['word', 'inside']);
});

test('label matches outrank org-name matches, which outrank group matches', () => {
  const commands = [
    { id: 'group', label: 'Alpha', group: 'Effort tools' },
    { id: 'org', label: 'Beta', orgName: 'org-set-effort' },
    { id: 'label', label: 'Effort' },
  ];
  assert.deepEqual(ids(searchCommands(commands, 'effort')), ['label', 'org', 'group']);
});

test('ties go to the recently used command, then to the listed order', () => {
  const commands = [
    { id: 'a', label: 'Open thing' },
    { id: 'b', label: 'Open other' },
    { id: 'c', label: 'Open third' },
  ];
  assert.deepEqual(ids(searchCommands(commands, 'open')), ['a', 'b', 'c']);
  assert.deepEqual(ids(searchCommands(commands, 'open', { recentIds: ['c'] })), ['c', 'a', 'b']);
  assert.deepEqual(ids(searchCommands(commands, 'open', { recentIds: ['b', 'c'] })), ['b', 'c', 'a']);
});

test('recency breaks ties but never lifts a worse match above a better one', () => {
  const commands = [
    { id: 'good', label: 'Effort' },
    { id: 'weak', label: 'Something', keywords: ['effort'] },
  ];
  assert.deepEqual(ids(searchCommands(commands, 'effort', { recentIds: ['weak'] })), ['good', 'weak']);
});

test('pushRecent: moves to the front, deduplicates, and caps', () => {
  assert.deepEqual(pushRecent([], 'a'), ['a']);
  assert.deepEqual(pushRecent(['a', 'b', 'c'], 'b'), ['b', 'a', 'c']);
  assert.deepEqual(pushRecent(['a', 'b', 'c'], 'd', 3), ['d', 'a', 'b']);
  const many = Array.from({ length: 20 }, (_, i) => 'x' + i);
  assert.equal(pushRecent(many, 'new').length, 8);
  assert.equal(pushRecent(many, 'new')[0], 'new');
});

test('pushRecent does not modify its input', () => {
  const original = ['a', 'b'];
  pushRecent(original, 'c');
  assert.deepEqual(original, ['a', 'b']);
});

test('a label that STARTS with the word outranks one where it is a later word', () => {
  const commands = [
    { id: 'later', label: 'Then schedule it' },
    { id: 'first', label: 'Schedule it' },
  ];
  assert.deepEqual(ids(searchCommands(commands, 'schedule')), ['first', 'later']);
});

// ---- the registry (src-browser/god-mode-palette.js) --------------------------
// the browser modules aren't importable in Node, so the palette registry is checked by reading the
// source: a chord() entry naming a key the god-mode table doesn't have would
// throw the first time someone ran that command.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// the palette registry and the god-mode table live together in this module (they were in app.js)
const APP = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src-browser', 'god-mode-palette.js'), 'utf8');

function godModeKeys() {
  const start = APP.indexOf('const GOD_MODE_ACTIONS = {');
  assert.ok(start > 0, 'GOD_MODE_ACTIONS not found');
  const end = APP.indexOf('\n};\n', start);
  const body = APP.slice(start, end);
  const keys = new Set();
  for (const m of body.matchAll(/^  (?:'([^']+)'|([A-Za-z<>-]+)): /gm)) keys.add(m[1] || m[2]);
  return keys;
}

function paletteSource() {
  const start = APP.indexOf('function paletteCommandList()');
  const end = APP.indexOf('/** Opens the palette.', start);
  assert.ok(start > 0 && end > start, 'palette registry not found');
  return APP.slice(start, end);
}

test('registry: every chord() the palette runs exists in the god-mode table', () => {
  const keys = godModeKeys();
  const used = [...paletteSource().matchAll(/chord\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(used.length > 10, 'expected the registry to use many chords');
  const missing = used.filter((c) => !keys.has(c));
  assert.deepEqual(missing, [], `palette uses chords the god-mode table lacks: ${missing.join(', ')}`);
});

test('registry: every key shown next to a command is a real god-mode binding', () => {
  const keys = godModeKeys();
  const shown = [...paletteSource().matchAll(/keys: '([^']+)'/g)].map((m) => m[1]);
  const missing = shown.filter((k) => !keys.has(k));
  assert.deepEqual(missing, [], `keys advertised in the palette but not bound: ${missing.join(', ')}`);
});

test('registry: command ids are unique', () => {
  const ids = [...paletteSource().matchAll(/\bid: '([^']+)'/g)].map((m) => m[1]);
  assert.ok(ids.length > 30);
  assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), []);
});

test('registry: every "needs" names a real availability check', () => {
  const declared = new Set([...APP.slice(APP.indexOf('const PALETTE_NEEDS = {')).matchAll(/^  (\w+): /gm)].map((m) => m[1]));
  const used = new Set();
  for (const m of paletteSource().matchAll(/needs: (\[[^\]]*\]|HEAD)/g)) {
    for (const name of m[1].matchAll(/'(\w+)'/g)) used.add(name[1]);
  }
  for (const name of used) assert.ok(declared.has(name), `unknown need "${name}"`);
});

test('a hyphenated word must appear as that phrase: the same words in another order do not match', () => {
  const commands = [
    { id: 'phrase', label: 'One', orgName: 'org-clock-in' },
    { id: 'scrambled', label: 'Two', orgName: 'org-in-place-clock' },
  ];
  assert.deepEqual(ids(searchCommands(commands, 'org-clock-in')), ['phrase']);
  // typed with spaces, they're separate words and either order is fine
  assert.deepEqual(ids(searchCommands(commands, 'org clock in')).sort(), ['phrase', 'scrambled']);
});
