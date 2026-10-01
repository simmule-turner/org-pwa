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

// id -> orgName (or null) for every static palette command, read from the registry source
function paletteOrgNames() {
  const src = paletteSource();
  const starts = [...src.matchAll(/\bid: '([^']+)'/g)];
  return starts.map((m, n) => {
    const chunk = src.slice(m.index, n + 1 < starts.length ? starts[n + 1].index : src.length);
    const org = /orgName: '([^']+)'/.exec(chunk);
    return { id: m[1], orgName: org ? org[1] : null };
  });
}

test('registry: every real Emacs/Org function name is unique, so a quoted function in an Extras entry resolves to exactly one command', () => {
  const names = paletteOrgNames().map((e) => e.orgName).filter(Boolean);
  assert.ok(names.length > 30, 'expected many commands to carry a real function name');
  assert.deepEqual(names.filter((n, i) => names.indexOf(n) !== i), []);
});

test('registry: the palette commands WITHOUT a real Emacs/Org name are exactly the exceptions the README lists (this app\u2019s own, with no Emacs equivalent)', () => {
  const without = paletteOrgNames().filter((e) => !e.orgName).map((e) => e.id).sort();
  assert.deepEqual(without, ['history', 'new']);
});

test('registry: Unarchive carries org-unarchive-subtree, the name proposed for Org itself and used by the org-unarchive package', () => {
  const byId = Object.fromEntries(paletteOrgNames().map((e) => [e.id, e.orgName]));
  assert.equal(byId.unarchive, 'org-unarchive-subtree');
});

test('registry: the Outline and Text views carry the Emacs major-mode names org-mode and text-mode, so an Extras entry can switch views', () => {
  const byId = Object.fromEntries(paletteOrgNames().map((e) => [e.id, e.orgName]));
  assert.equal(byId['view-org'], 'org-mode');
  assert.equal(byId['view-text'], 'text-mode');
});

test('registry: the names Extras entries used to hard-code are all palette commands now, under their real names', () => {
  const names = new Set(paletteOrgNames().map((e) => e.orgName));
  for (const name of ['org-clock-out', 'org-clock-cancel', 'org-clock-in-last', 'calendar', 'org-table-recalculate-buffer-tables', 'org-cut-subtree', 'org-paste-subtree', 'org-org-export-as-org']) {
    assert.ok(names.has(name), `${name} should be a palette command`);
  }
  // the two that were invented or wrong are NOT names any more
  assert.ok(!names.has('org-xx-calendar') && !names.has('org-clock-continue'));
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

// ---- capture templates and Extras entries as commands --------------------------

import { dynamicCommandSpecs } from '../src/command-palette.js';

test('dynamicCommandSpecs: one command per capture template, named "Capture: <description>"', () => {
  const specs = dynamicCommandSpecs({ templates: [{ key: 't', description: 'Todo' }, { key: 'j', description: 'Journal entry' }] });
  assert.deepEqual(specs.map((s) => s.label), ['Capture: Todo', 'Capture: Journal entry']);
  assert.deepEqual(specs.map((s) => s.id), ['capture:t', 'capture:j']);
  assert.ok(specs.every((s) => s.group === 'Capture' && s.source === 'capture'));
  assert.deepEqual(specs.map((s) => s.index), [0, 1]);
});

test('dynamicCommandSpecs: Extras entries are named "Extras: <label>", and separators are skipped', () => {
  const specs = dynamicCommandSpecs({ extraEntries: [{ type: 'function', label: 'Tracking' }, { type: 'separator' }, { type: 'function', label: 'Weekly review' }] });
  assert.deepEqual(specs.map((s) => s.label), ['Extras: Tracking', 'Extras: Weekly review']);
  assert.deepEqual(specs.map((s) => s.index), [0, 2], 'index is the entry\'s own position, separators included');
  assert.ok(specs.every((s) => s.group === 'Extras' && s.source === 'extra'));
});

test('dynamicCommandSpecs: ids stay unique when two entries would collide', () => {
  const specs = dynamicCommandSpecs({ templates: [{ key: 't', description: 'A' }, { key: 't', description: 'B' }], extraEntries: [{ label: 'Same' }, { label: 'Same' }] });
  assert.equal(new Set(specs.map((s) => s.id)).size, 4);
});

test('dynamicCommandSpecs: a template without a description falls back on its key, and one with neither is skipped', () => {
  const specs = dynamicCommandSpecs({ templates: [{ key: 'x' }, { description: 'Only text' }, {}], extraEntries: [{ label: '  ' }, null] });
  assert.deepEqual(specs.map((s) => s.label), ['Capture: x', 'Capture: Only text']);
});

test('dynamicCommandSpecs: nothing configured, nothing added', () => {
  assert.deepEqual(dynamicCommandSpecs(), []);
  assert.deepEqual(dynamicCommandSpecs({ templates: [], extraEntries: [] }), []);
});

test('the template key is a search keyword, so typing it finds the template', () => {
  const specs = dynamicCommandSpecs({ templates: [{ key: 'j', description: 'Journal' }, { key: 'q', description: 'Quick note' }] });
  const found = searchCommands(specs, 'j').map((r) => r.command.id);
  assert.equal(found[0], 'capture:j');
});

test('dynamic commands are found by name, group and "capture" alike', () => {
  const specs = dynamicCommandSpecs({ templates: [{ key: 't', description: 'Todo' }], extraEntries: [{ label: 'Tracking' }] });
  assert.deepEqual(searchCommands(specs, 'tracking').map((r) => r.command.id), ['extra:Tracking']);
  assert.deepEqual(searchCommands(specs, 'capture todo').map((r) => r.command.id), ['capture:t']);
  assert.equal(searchCommands(specs, 'extras').length, 1);
});
