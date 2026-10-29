// The corpus for the outline oracle: heading lines (parsing) and outlines (structure edits). Shared by the generator and the test.
const stars = ['*', '**', '***'];
const todos = ['', 'TODO ', 'DONE ', 'todo ', 'NEXT ', 'TODO  ', 'TODOX ', 'TODO'];
const prios = ['', '[#A] ', '[#C] ', '[#a] ', '[#10] ', '[#AB] ', '[# ] ', '[#A]', '[#B]  '];
const titles = ['', 'Title', 'Two words', ' leading', 'trailing  ', 'a:b', 'has :x: inside', '*bold* and /it/', '[[link][desc]]', 'cookie [1/2] x', '<2026-10-05 Mon> due', 'COMMENT', 'COMMENT hidden', 'COMMENT  two', 'COMMENTED', 'comment low', 'ARCHIVE', '100% done', 'x [#A] y', 'TODO inside', '#+KEYWORD', 'é ünïcode', 'a\tb'];
const tags = ['', ' :a:', ' :a:b:', ' :a b:', ' ::', ' :a::b:', ' :@home:', ' :a-b:', ' :é:', ' :a:  ', '\t:a:', ':a:', ' :ARCHIVE:', ' :a_b#c%d:', ' :a:b', ' a:b:', ' :1:'];
export const headingLines = [];
const seen = new Set();
const add = (l) => { if (!seen.has(l)) { seen.add(l); headingLines.push(l); } };
for (const s of stars) for (const t of todos) add(`${s} ${t}Title`);
for (const s of ['*', '***']) for (const p of prios) add(`${s} ${p}Title`), add(`${s} TODO ${p}Title`);
for (const ti of titles) for (const s of ['*', '**']) add(`${s} ${ti}`), add(`${s} TODO ${ti}`), add(`${s} ${ti} :t:`);
for (const tg of tags) for (const ti of ['', 'Title']) add(`* ${ti}${tg}`), add(`* TODO [#B] ${ti}${tg}`);
for (const l of ['*', '* ', '*  ', '**', '*x', '*\tx', '* x', '*  x', '  * x', ' * x', '*\u00a0x', '* \tx', '*TODO x', '****** deep', '* TODO', '* TODO ', '* DONE', '* [#A]', '* [#A] ', '* :a:', '* TODO :a:', '* TODO [#A] :a:', '* COMMENT :a:', '* COMMENT TODO x', '* TODO COMMENT x', '* [#A] TODO x', '* TODO\tx', '* x :a:\t', '* x\u00a0:a:', '*\u00a0TODO x']) add(l);
export const todoSettings = [
  { name: 'default', header: '' },
  { name: 'custom', header: '#+TODO: TODO NEXT | DONE CANCELED\n' },
  { name: 'two lines', header: '#+TODO: A B | C\n#+TODO: X | Y\n' },
  { name: 'only done', header: '#+TODO: | FINISHED\n' },
];
export const headingKeywordLines = ['* NEXT x', '* CANCELED x', '* A x', '* C x', '* X x', '* Y x', '* B [#A] x', '* FINISHED x', '* TODO x', '* DONE x'];

// Outlines for structure edits
export const docs = {
  tree: '* A\n** A1\n*** A1a\n** A2\n* B\n** B1\n* C\n',
  body: '* A\ntext a\n** A1\ntext a1\n*** A1a\n** A2\n* B\nbody b\n* C\n',
  deep: '* A\n** A1\n*** A1a\n**** A1a1\n** A2\n',
  tagged: '* TODO [#A] A :x:\nSCHEDULED: <2026-10-05 Mon>\n** DONE A1 :y:\n* B\n',
  folded: '* A\n:PROPERTIES:\n:ID: 1\n:END:\n** A1\n- item\n  more\n| a | b |\n* B\n',
  skip: '* A\n*** A1\n* B\n**** B1\n** B2\n',
  single: '* Only\n',
  empty: '*\n** \n* x\n',
  preamble: '#+TITLE: t\nintro\n* A\n** A1\n* B\n',
  nofinal: '* A\n** A1\n* B',
  blank: '* A\n\n** A1\n\n\n* B\n\n',
  block: '* A\n#+BEGIN_SRC sh\n,* not a heading\n#+END_SRC\n** A1\n* B\n',
  stars: '* A\n*bold* line\n** A1\n  * list star\n* B\n',
  tags: '* A  :a:b:\n** A1                                                     :tag:\n* B :c:\n',
  comment: '* COMMENT A\n** A1\n* ARCHIVE B :ARCHIVE:\n',
  todos: '* TODO A\n** DONE A1\nCLOSED\n* NEXT B\n',
  drawers: '* A\n:LOGBOOK:\n- note\n:END:\n** A1\nSCHEDULED: <2026-10-05 Mon>\n:PROPERTIES:\n:X: 1\n:END:\n* B\n',
  lvl2first: '** A\n* B\n',
  crlf: '* A\r\n** A1\r\n* B\r\n',
  trailsp: '* A   \n** A1  :x:  \n* B\n',
};
export const ops = ['promote', 'demote', 'up', 'down', 'delete', 'insert-after', 'copy'];
// org-tags-column values tried on the outlines that have tags (Emacs's own default is -77, the app's 0)
export const tagDocs = ['tagged', 'tags', 'comment', 'trailsp'];
export const tagColumns = [0, 40, -40, -77];
