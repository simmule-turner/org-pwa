// The corpus of tools/gen-oracle-capture-refile.mjs: archiving, the archive tag, refiling, refile targets and capture targets.
// Every case is run in Emacs 29.3 (clock 2026-10-11 16:30 New York, org-tags-column 0) and test/oracle-capture-refile.test.js holds the app to it.

/** @typedef {{ kind: 'archive' | 'archive-sibling' | 'toggle' | 'refile', files: Record<string, string>, find: string, to?: string, toFile?: string, vars?: Record<string, string> }} FileCase */
/** @typedef {{ kind: 'targets', files: Record<string, string>, current: string, spec: { file: string, criteria: Record<string, string | number> }[] }} TargetsCase */
/** @typedef {{ kind: 'capture', init: string, type: string, template: string, target: string[], opts: Record<string, unknown> }} CaptureCase */

const tree1 = '* Projects :work:\n** TODO [#A] File taxes :tax:\nSCHEDULED: <2026-10-20 Tue>\nSee the form.\n*** Gather receipts\n** Plan the year\n* Home\n** Chores\n';
const tree2 = '#+CATEGORY: finance\n#+FILETAGS: :office:\n* Projects :work:\n** Q4 :money:work:\n*** TODO Pay bills :tax:money:\nbody line\n*** DONE Old bill\nCLOSED: [2026-10-01 Thu 10:00]\n* Done\n';
const tree3 = '* A\n** B\n*** C\n**** Deep one\ntext\n***** Deeper\n* Next\n';
const tree4 = '* DONE Closed thing\nCLOSED: [2026-10-01 Thu 10:00]\n:PROPERTIES:\n:ID: abc\n:END:\n:LOGBOOK:\n- State "DONE" from "TODO" [2026-10-01 Thu 10:00]\n:END:\n- [X] a\n- [ ] b\n#+begin_src sh\n,* not a heading\n#+end_src\n* Other\n';
const tree5 = '* Parent\n:PROPERTIES:\n:CATEGORY: parentcat\n:END:\n** Child one\n** TODO Child two :t1:\n:PROPERTIES:\n:CATEGORY: owncat\n:END:\n';
const tree6 = '* Only heading\nno final newline';
const tree7 = '* [#B] Priority only\n* TODO Todo only\n* Tags only :a:b:\n* COMMENT Commented\n* Heading with ARCHIVE tag :ARCHIVE:\n';
const tree8 = '* P1\n** TODO One\n** TODO Two\n* P2 :x:\n** TODO One again\n';

/** Tree to find pairs. */
const FINDS = [
  [tree1, ['File taxes', 'Gather receipts', 'Home', 'Projects']],
  [tree2, ['Pay bills', 'Old bill', 'Q4', 'Projects']],
  [tree3, ['Deep one', 'Deeper', 'B', 'A']],
  [tree4, ['Closed thing']],
  [tree5, ['Child one', 'Child two', 'Parent']],
  [tree6, ['Only heading']],
  [tree7, ['Priority only', 'Todo only', 'Tags only', 'Commented', 'Heading with ARCHIVE tag']],
  [tree8, ['One', 'P2']],
];

const LOCATIONS = [
  null, // the default, %s_archive::
  '::* Archive',
  '::** Archive two',
  '::* From %s',
  'other.org::',
  'other.org::* Arc',
  'other.org::** Arc two',
  '%s_done::',
  '%s_done::* Done %s',
  '::',
];

/** @returns {FileCase[]} */
function archiveCases() {
  /** @type {FileCase[]} */ const out = [];
  for (const [tree, finds] of FINDS) {
    for (const find of finds) {
      for (const loc of LOCATIONS) {
        out.push({ kind: 'archive', files: { 'notes.org': (loc === null ? '' : `#+ARCHIVE: ${loc}\n`) + tree }, find });
      }
    }
  }
  // a heading's own ARCHIVE property beats the file line
  for (const loc of ['::* Mine', 'other.org::* Mine', 'other.org::']) {
    out.push({ kind: 'archive', files: { 'notes.org': `#+ARCHIVE: ::* File\n* Projects :work:\n** TODO Plan :tax:\n:PROPERTIES:\n:ARCHIVE: ${loc}\n:END:\n** Other\n` }, find: 'Plan' });
    out.push({ kind: 'archive', files: { 'notes.org': `* Projects\n:PROPERTIES:\n:ARCHIVE: ${loc}\n:END:\n** TODO Plan\n** Other\n` }, find: 'Plan' });
  }
  // the target heading exists in different states
  const states = {
    'a heading with entries': '* Archive\n** DONE Old\nbody\n\n\n',
    'an empty heading': '* Archive\n',
    'a heading in the middle': '* Archive\n** DONE Old\n* Last\n',
    'a heading, deeper': '* Zone\n** Archive\n*** DONE Old\n',
    'text before the heading': 'intro\n* Other\n* Archive\ntext\n',
    'two headings of the name': '* Archive\n** One\n* Archive\n** Two\n',
  };
  for (const [, extra] of Object.entries(states)) {
    out.push({ kind: 'archive', files: { 'notes.org': `#+ARCHIVE: ::* Archive\n* Home\n** TODO Sweep\n` + extra }, find: 'Sweep' });
    out.push({ kind: 'archive', files: { 'notes.org': `#+ARCHIVE: other.org::* Archive\n* Home\n** TODO Sweep\n`, 'other.org': extra }, find: 'Sweep' });
    out.push({ kind: 'archive', files: { 'notes.org': `#+ARCHIVE: other.org::\n* Home\n** TODO Sweep\n`, 'other.org': extra }, find: 'Sweep' });
  }
  const archiveFiles = {
    'with its header': '# -*- mode: org -*-\n\n\nArchived entries from file /x/y.org\n\n* Old\n',
    'empty': '',
    'one blank line': '\n',
    'no final newline': '* Old',
    'text only': 'just text\n',
  };
  for (const [, text] of Object.entries(archiveFiles)) {
    out.push({ kind: 'archive', files: { 'notes.org': '* Home\n** TODO Sweep\n', 'notes.org_archive': text }, find: 'Sweep' });
    out.push({ kind: 'archive', files: { 'notes.org': '#+ARCHIVE: other.org::\n* Home\n** TODO Sweep\n', 'other.org': text }, find: 'Sweep' });
  }
  // archiving twice
  out.push({ kind: 'archive', files: { 'notes.org': '* Home\n** TODO Sweep\n** TODO Mop\n', 'notes.org_archive': '* Archived\n' }, find: 'Mop' });
  return out;
}


/** Archiving with the org-archive-* settings, to a date tree, and to the archive sibling.
 * @returns {FileCase[]} */
function archiveSettingCases() {
  /** @type {FileCase[]} */ const out = [];
  const trees = [
    [tree1, ['File taxes', 'Gather receipts', 'Plan the year']],
    [tree2, ['Pay bills', 'Old bill', 'Q4']],
    [tree3, ['Deep one', 'B']],
    [tree4, ['Closed thing']],
    [tree5, ['Child two']],
    ['#+TODO: TODO NEXT | DONE CANC\n* Projects :work:\n** NEXT Plan :tax:\n** CANC Dropped\n** Other\n', ['Plan', 'Dropped', 'Other']],
  ];
  const locations = [null, '::* Archive', 'other.org::* Arc', 'other.org::'];
  const sets = [
    { 'org-archive-reversed-order': 't' },
    { 'org-archive-mark-done': 't' },
    { 'org-archive-mark-done': '"DONE"' },
    { 'org-archive-mark-done': '"CANC"' },
    { 'org-archive-mark-done': '"NOPE"' },
    { 'org-archive-save-context-info': "'(time)" },
    { 'org-archive-save-context-info': 'nil' },
    { 'org-archive-save-context-info': "'(file olpath)" },
    { 'org-archive-save-context-info': "'(ltags itags)" },
    { 'org-archive-save-context-info': "'(todo category)" },
    { 'org-archive-save-context-info': "'(olpath category itags ltags todo file time)" },
    { 'org-archive-subtree-add-inherited-tags': 'nil' },
    { 'org-archive-subtree-add-inherited-tags': 't' },
    { 'org-archive-subtree-add-inherited-tags': "'infile" },
    { 'org-archive-file-header-format': 'nil' },
    { 'org-archive-file-header-format': '"* Header for %s\\n\\n"' },
    { 'org-archive-reversed-order': 't', 'org-archive-mark-done': 't', 'org-archive-subtree-add-inherited-tags': 't' },
  ];
  for (const [tree, finds] of trees) {
    for (const find of finds) {
      for (const loc of locations) {
        for (const vars of sets) out.push({ kind: 'archive', files: { 'notes.org': (loc === null ? '' : `#+ARCHIVE: ${loc}\n`) + tree }, find, vars });
      }
    }
  }
  // the target in different states, reversed
  const states = ['* Archive\n** DONE Old\nbody\n\n\n', '* Archive\n', '* Archive\n** DONE Old\n* Last\n', '* Zone\n** Archive\n*** DONE Old\n', 'intro\n* Archive\ntext\n* Z\n'];
  for (const extra of states) {
    for (const rev of ['t', 'nil']) {
      out.push({ kind: 'archive', files: { 'notes.org': `#+ARCHIVE: ::* Archive\n* Home\n** TODO Sweep\n` + extra }, find: 'Sweep', vars: { 'org-archive-reversed-order': rev } });
      out.push({ kind: 'archive', files: { 'notes.org': `#+ARCHIVE: other.org::* Archive\n* Home\n** TODO Sweep\n`, 'other.org': extra }, find: 'Sweep', vars: { 'org-archive-reversed-order': rev } });
      out.push({ kind: 'archive', files: { 'notes.org': `#+ARCHIVE: other.org::\n* Home\n** TODO Sweep\n`, 'other.org': extra }, find: 'Sweep', vars: { 'org-archive-reversed-order': rev } });
    }
  }
  // the archive sibling
  const sib = {
    'none': '* H\n',
    'before': '* H\n* Archive :ARCHIVE:\n',
    'after': '* Archive :ARCHIVE:\n* H\n',
    'with entries': '* H\n* Archive :ARCHIVE:\n** A\n** B\ntext\n',
    'other levels': '* Archive :ARCHIVE:\n* Top\n** H\n',
    'nested, one there': '* Top\n** H\n** Archive :ARCHIVE:\n*** Old\n* Next\n',
    'nested, none': '* Top\n** H\n*** Child\nbody\n* Next\n',
    'deep': '* A\n** B\n*** C\n**** H\n**** Z\n',
    'two siblings': '* H\n* K\n',
    'heading with todo': '* TODO [#A] H :x:\nSCHEDULED: <2026-10-20 Tue>\nbody\n\n* After\n',
    'blank lines': '* H\n\n* Archive :ARCHIVE:\n\n** A\n\n',
    'a tagged archive': '* H\n* Archive :other:ARCHIVE:\n** A\n',
    'wrong tag': '* H\n* Archive :other:\n',
    'no final newline': '* H\n* Archive :ARCHIVE:',
    'children done': '* TODO Top [%]\n** TODO H\n** DONE Two\n',
    'preamble': '#+TITLE: x\ntext\n* H\nbody\n',
    'archived': '* H :ARCHIVE:\n* Other\n',
  };
  for (const [, text] of Object.entries(sib)) {
    const finds = [...text.matchAll(/^\*+ (?:TODO |DONE )?(?:\[#.\] )?([^\s:]+)/gm)].map((m) => m[1]).filter((t, i, a) => a.indexOf(t) === i && t !== 'Archive' && t !== 'Top' || t === 'Top');
    for (const find of finds) {
      for (const vars of [{}, { 'org-archive-reversed-order': 't' }, { 'org-archive-sibling-heading': '"Done"' }, { 'org-archive-sibling-heading': '"Archive"', 'org-archive-tag': '"OLD"' }]) {
        out.push({ kind: 'archive-sibling', files: { 'notes.org': text }, find, vars });
      }
    }
  }
  // a date tree
  const dtTrees = {
    'plain': '* A\n** TODO B\n* C\n',
    'closed': '* A\n** DONE B\nCLOSED: [2025-03-04 Tue 10:00]\n* C\n',
    'closed on the parent': '* DONE A\nCLOSED: [2025-03-04 Tue 10:00]\n** TODO B\n',
    'last': '* A\n* TODO B',
    'with body': '* A\n** TODO B\nbody\n\n** TODO D\n',
    'sibling after': '* A\n* TODO B\n* C\n',
    'only': '* TODO B\n',
    'jan': '* DONE B\nCLOSED: [2024-01-31 Wed 23:59]\n',
    'future': '* DONE B\nCLOSED: [2027-12-01 Wed 08:00]\n* Z\n',
    'tags and category': '#+CATEGORY: cat\n#+FILETAGS: :f:\n* P :p:\n** TODO B :b:\n* Q\n',
  };
  const dtStates = {
    'none': '',
    'year there': '* 2026\n',
    'month there': '* 2026\n** 2026-10 October\n',
    'day there': '* 2026\n** 2026-10 October\n*** 2026-10-11 Sunday\n',
    'day with entries': '* 2026\n** 2026-10 October\n*** 2026-10-11 Sunday\n**** Existing\ntext\n',
    'day with a blank': '* 2026\n** 2026-10 October\n*** 2026-10-11 Sunday\n**** Existing\ntext\n\n',
    'day followed': '* 2026\n** 2026-10 October\n*** 2026-10-11 Sunday\n**** Existing\ntext\n*** 2026-10-12 Monday\n',
    'day followed blank': '* 2026\n** 2026-10 October\n*** 2026-10-11 Sunday\n**** Existing\n\n*** 2026-10-12 Monday\n',
    'earlier days': '* 2026\n** 2026-10 October\n*** 2026-10-05 Monday\n',
    'other years': '* 2025\n** 2025-03 March\n*** 2025-03-04 Tuesday\n* 2027\n',
    'sub heading there': '* 2026\n** 2026-10 October\n*** 2026-10-11 Sunday\n**** Foo\ntext\n**** Bar\n',
    'DATE_TREE': '* Journal\n:PROPERTIES:\n:DATE_TREE: t\n:END:\n',
  };
  const dtLocs = ['::datetree/', '::datetree/*', '::datetree/** Foo', '::datetree/* Foo %s', 'other.org::datetree/', 'other.org::datetree/* Foo'];
  for (const [, tree] of Object.entries(dtTrees)) {
    const find = tree.includes('TODO B') || tree.includes('DONE B') ? 'B' : 'A';
    for (const loc of dtLocs) {
      for (const [, st] of Object.entries(dtStates)) {
        if (loc.startsWith('other.org')) out.push({ kind: 'archive', files: { 'notes.org': `#+ARCHIVE: ${loc}\n${tree}`, 'other.org': st }, find });
        else out.push({ kind: 'archive', files: { 'notes.org': `#+ARCHIVE: ${loc}\n${st && !tree.endsWith('\n') ? tree + '\n' : tree}${st}` }, find });
      }
    }
    for (const ts of ['inactive', 'active', 'nil']) out.push({ kind: 'archive', files: { 'notes.org': `#+ARCHIVE: ::datetree/\n${tree}` }, find, vars: { 'org-datetree-add-timestamp': ts === 'nil' ? 'nil' : `'${ts}` } });
    out.push({ kind: 'archive', files: { 'notes.org': `#+ARCHIVE: ::datetree/\n${tree}` }, find, vars: { 'org-archive-reversed-order': 't' } });
    out.push({ kind: 'archive', files: { 'notes.org': `#+ARCHIVE: ::datetree/* Foo\n${tree}` }, find, vars: { 'org-archive-reversed-order': 't' } });
  }
  return out;
}

/** @returns {FileCase[]} */
function toggleCases() {
  const heads = [
    '* Plain',
    '* TODO Task',
    '* TODO [#A] Task :a:',
    '* Task :a:b:',
    '* Archived :ARCHIVE:',
    '* Archived two :a:ARCHIVE:',
    '* Archived three :ARCHIVE:a:',
    '** Level two :x:',
    '*** DONE Level three :ARCHIVE:',
    '* Heading   with   spaces',
    '* Task with a very long title that goes on and on and on and on and on and on and on and on :tag:',
    '* COMMENT Quiet',
    '* Task\nSCHEDULED: <2026-10-20 Tue>\nbody',
  ];
  return heads.flatMap((h) => {
    const title = h.split('\n')[0].replace(/^\*+ (?:TODO |DONE |COMMENT )?(?:\[#.\] )?/, '').replace(/ +:[^ ]*:$/, '');
    return [{ kind: /** @type {const} */ ('toggle'), files: { 'notes.org': h + '\n* After\n' }, find: title }, { kind: /** @type {const} */ ('toggle'), files: { 'notes.org': '#+FILETAGS: :f:\n* Top\n' + h + '\n' }, find: title }];
  });
}

/** @returns {FileCase[]} */
function refileCases() {
  /** @type {FileCase[]} */ const out = [];
  const docs = [tree1, tree2, tree3, tree4 + '* Last :x:\nlast body\n', tree8];
  const pairs = [
    [tree1, 'File taxes', 'Home'], [tree1, 'File taxes', 'Chores'], [tree1, 'Plan the year', 'Gather receipts'], [tree1, 'Home', 'Projects'],
    [tree1, 'Gather receipts', 'Home'], [tree1, 'Chores', 'Projects'], [tree1, 'Plan the year', 'Projects'],
    [tree2, 'Pay bills', 'Done'], [tree2, 'Old bill', 'Done'], [tree2, 'Q4', 'Done'], [tree2, 'Done', 'Projects'],
    [tree3, 'Deep one', 'Next'], [tree3, 'Deeper', 'A'], [tree3, 'B', 'Next'], [tree3, 'Next', 'C'], [tree3, 'A', 'Next'],
    [tree4, 'Closed thing', 'Other'], [tree8, 'One', 'P2'], [tree8, 'P1', 'P2'], [tree8, 'P2', 'P1'],
    [tree1, 'Projects', 'Chores'], [tree3, 'A', 'Deeper'], [tree3, 'A', 'B'],
  ];
  for (const [t, find, to] of pairs) out.push({ kind: 'refile', files: { 'notes.org': t }, find, to });
  void docs;
  // to another file
  const targets = {
    'a heading': '* Inbox\n** Old\n* Done\n',
    'an empty file with one heading': '* Inbox\n',
    'a deep heading': '* A\n** B\n*** Inbox\n',
    'a heading with text': '* Inbox\nsome text\n\n\n',
    'a heading at the end, no final newline': '* Inbox\n** Old',
    'a target followed by a sibling': '* Inbox\n** Old\n* Next\n',
  };
  for (const text of Object.values(targets)) {
    for (const find of ['File taxes', 'Gather receipts', 'Home', 'Plan the year']) {
      out.push({ kind: 'refile', files: { 'notes.org': tree1, 'other.org': text }, find, to: 'Inbox', toFile: 'other.org' });
    }
    out.push({ kind: 'refile', files: { 'notes.org': tree3, 'other.org': text }, find: 'Deeper', to: 'Inbox', toFile: 'other.org' });
    out.push({ kind: 'refile', files: { 'notes.org': tree4, 'other.org': text }, find: 'Closed thing', to: 'Inbox', toFile: 'other.org' });
  }
  return out;
}

const dtree = '#+TODO: TODO NEXT | DONE\n* Projects :work:\n** TODO [#A] Taxes :tax:\n*** Gather\n** Plan\n* Home :home:\n** TODO Chores\n*** NEXT Sweep\n** Garden\n* Done :work:\n** DONE Old\n';
const mtree = '#+TODO: TODO NEXT | DONE\n* Alpha\n** Beta\n*** Gamma\n**** TODO Delta\n* NEXT Next one :work:\n** Child\n';

/** @returns {TargetsCase[]} */
function targetsCases() {
  /** @type {TargetsCase[]} */ const out = [];
  const specs = [
    [{}], [{ maxlevel: 1 }], [{ maxlevel: 2 }], [{ maxlevel: 3 }], [{ level: 1 }], [{ level: 2 }], [{ level: 3 }], [{ tag: 'work' }], [{ tag: 'home' }], [{ tag: 'tax' }],
    [{ todo: 'TODO' }], [{ todo: 'NEXT' }], [{ todo: 'DONE' }], [{ regexp: 'e' }], [{ regexp: 'Pl' }], [{ regexp: 'TODO' }],
    [{ tag: 'nothere' }], [{ maxlevel: 0 }],
    [{ level: 1 }, { level: 3 }], [{ tag: 'work' }, { todo: 'TODO' }], [{ maxlevel: 1 }, { maxlevel: 2 }],
  ];
  for (const s of specs) {
    out.push({ kind: 'targets', files: { 'notes.org': dtree }, current: 'notes.org', spec: s.map((criteria) => ({ file: 'current', criteria })) });
    out.push({ kind: 'targets', files: { 'notes.org': mtree }, current: 'notes.org', spec: s.map((criteria) => ({ file: 'current', criteria })) });
    out.push({ kind: 'targets', files: { 'notes.org': mtree, 'other.org': dtree }, current: 'notes.org', spec: s.map((criteria) => ({ file: 'other.org', criteria })) });
  }
  out.push({ kind: 'targets', files: { 'notes.org': mtree, 'other.org': dtree }, current: 'notes.org', spec: [{ file: 'current', criteria: { maxlevel: 1 } }, { file: 'other.org', criteria: { level: 2 } }] });
  out.push({ kind: 'targets', files: { 'notes.org': mtree, 'other.org': dtree }, current: 'notes.org', spec: [{ file: 'other.org', criteria: { maxlevel: 1 } }, { file: 'current', criteria: { maxlevel: 1 } }] });
  out.push({ kind: 'targets', files: { 'notes.org': mtree, 'other.org': dtree }, current: 'notes.org', spec: [{ file: 'agenda-files', criteria: { maxlevel: 1 } }] });
  out.push({ kind: 'targets', files: { 'notes.org': mtree }, current: 'notes.org', spec: [{ file: 'current', criteria: { maxlevel: 2 } }, { file: 'current', criteria: { maxlevel: 3 } }] });
  out.push({ kind: 'targets', files: { 'notes.org': '* Same\n** Same\n* Same\n' }, current: 'notes.org', spec: [{ file: 'current', criteria: { maxlevel: 2 } }] });
  out.push({ kind: 'targets', files: { 'notes.org': '' }, current: 'notes.org', spec: [{ file: 'current', criteria: { maxlevel: 2 } }] });
  out.push({ kind: 'targets', files: { 'notes.org': 'only text\n' }, current: 'notes.org', spec: [{ file: 'current', criteria: { maxlevel: 2 } }] });
  out.push({ kind: 'targets', files: { 'notes.org': '* TODO [#A] Fancy :a:b:\n** Child\n' }, current: 'notes.org', spec: [{ file: 'current', criteria: { maxlevel: 2 } }] });
  return out;
}

/** @returns {CaptureCase[]} */
function captureCases() {
  /** @type {CaptureCase[]} */ const out = [];
  const inits = [
    '* A\n** B\n** C\n* D\n',
    '* A\n** B\n*** Deep\n',
    '* A\nbody\n** B\nbbody\n- i1\n',
    '* A\n** B\n| x | y |\n',
    '* A\n** B\n',
    '* A\n* A\n** B\n',
    '',
    '* B\n',
    '* A\n** B\n** B\n',
  ];
  const targets = [['A', 'B'], ['A'], ['A', 'B', 'C'], ['B'], ['Nope'], ['A', 'Nope']];
  const types = [['entry', '* New'], ['item', 'new'], ['checkitem', 'new'], ['plain', 'text'], ['table-line', '| a | b |']];
  for (const init of inits) for (const target of targets) for (const [type, template] of types) {
    out.push({ kind: 'capture', init, type, template, target, opts: {} });
  }
  for (const [type, template] of types) for (const opts of [{ prepend: true }, { emptyLines: 1 }, { prepend: true, emptyLines: 1 }]) {
    out.push({ kind: 'capture', init: '* A\n** B\n- i1\n| x | y |\n** C\n', type, template, target: ['A', 'B'], opts });
  }
  return out;
}

export const FILE_CASES = [...archiveCases(), ...archiveSettingCases(), ...toggleCases(), ...refileCases()];
export const TARGET_CASES = targetsCases();
export const CAPTURE_CASES = captureCases();
