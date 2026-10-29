// Case corpus for tools/gen-oracle-lists.mjs: list shapes, cookie documents and footnote texts, chosen to hit defaults,
// boundaries, malformed input and unusual-but-valid input.
const H = '* H\n';
export const LISTS = {
  // bullets and their variants
  dash: H + '- a\n- b\n- c\n',
  plus: H + '+ a\n+ b\n',
  starIndented: H + ' * a\n * b\n',
  mixedBullets: H + '- a\n+ b\n* c\n',
  oneItem: H + '- only\n',
  empty: H + '-\n- b\n',
  emptyLast: H + '- a\n-\n',
  bareDashNoSpace: H + '-a\n- b\n',
  tabbed: H + '-\ta\n-\tb\n',
  // ordered
  numbered: H + '1. a\n2. b\n3. c\n',
  numberedWrong: H + '1. a\n5. b\n2. c\n',
  numberedFromThree: H + '3. a\n4. b\n',
  numberedParen: H + '1) a\n2) b\n',
  tenItems: H + Array.from({ length: 11 }, (_, i) => `${i + 1}. i${i + 1}`).join('\n') + '\n',
  nineItems: H + Array.from({ length: 9 }, (_, i) => `${i + 1}. i${i + 1}`).join('\n') + '\n',
  counterFirst: H + '1. [@5] a\n2. b\n3. c\n',
  counterMiddle: H + '1. a\n2. [@7] b\n3. c\n',
  counterTwo: H + '1. [@3] a\n2. b\n3. [@10] c\n4. d\n',
  counterBullet: H + '- [@5] a\n- b\n',
  alpha: H + 'a. x\nb. y\n',
  alphaParen: H + 'a) x\nb) y\n',
  mixedOrdered: H + '1. a\n- b\n2. c\n',
  // nesting
  nested: H + '- a\n  - a1\n  - a2\n    - deep\n- b\n',
  nestedOrdered: H + '1. a\n   1. a1\n   2. a2\n2. b\n3. c\n',
  nestedMixed: H + '1. a\n   - x\n   - y\n2. b\n   1. z\n',
  nestedParen: H + '1) a\n   1) a1\n2) b\n',
  deepNest4: H + '- a\n  - b\n    - c\n      - d\n- e\n',
  nestedThenOut: H + '- a\n  - b\n- c\n  - d\n',
  oddIndent: H + '- a\n   - b\n - c\n',
  // text, blanks, paragraphs
  continuation: H + '- a\n  more of a\n- b\n\ntail\n',
  blankBetween: H + '- a\n\n- b\n\n- c\n',
  twoBlanksEnd: H + '- a\n- b\n\n\n- c\n',
  paragraphBetween: H + '- a\n\npara\n\n- b\n',
  textIndentedUnder: H + '- a\n\n  second para of a\n- b\n',
  textAfterList: H + '- a\n- b\ntext right after\n',
  textBefore: H + 'intro\n- a\n- b\n',
  indentedList: H + 'text\n  - a\n  - b\n',
  listInDrawer: H + ':LOGBOOK:\n- a\n- b\n:END:\n',
  drawerOnly: H + ':LOGBOOK:\n- a\n:END:\n',
  drawerNested: H + ':LOGBOOK:\n- a\n  - a1\n  - a2\n- b\n:END:\n',
  drawerChecks: H + ':LOGBOOK:\n- [ ] a\n- [X] b\n:END:\n',
  drawerOrdered: H + ':LOGBOOK:\n1. a\n2. b\n3. c\n:END:\n',
  drawerOther: H + ':FOO:\n- a\n- b\n:END:\n',
  drawerAfterText: H + 'text\n:LOGBOOK:\n- a\n- b\n:END:\nmore\n',
  blockOnly: H + '#+begin_example\n- a\n#+end_example\n',
  blockChecks: H + '#+begin_quote\n- [ ] a\n- [X] b\n#+end_quote\n',
  blockSrc: H + '#+begin_src org\n1. a\n2. b\n#+end_src\n',
  listInBlock: H + '#+begin_example\n- a\n- b\n#+end_example\n- c\n',
  listAfterTable: H + '| x |\n- a\n',
  tableInItem: H + '- a\n  | x | y |\n  | 1 | 2 |\n- b\n',
  srcInItem: H + '- a\n  #+begin_src sh\n  echo hi\n  #+end_src\n- b\n',
  // descriptions
  description: H + '- t :: d\n- u :: e\n- v :: f\n',
  descEmptyTerm: H + '-  :: d\n- u :: e\n',
  descNoSpace: H + '- t::d\n- u :: e\n',
  descMixed: H + '- t :: d\n- plain\n- u :: e\n',
  descNested: H + '- t :: d\n  - u :: e\n',
  descOrdered: H + '1. t :: d\n2. u :: e\n',
  descChecked: H + '- [ ] t :: d\n- [X] u :: e\n',
  // checkboxes
  checks: H + '- [ ] a\n- [X] b\n- [-] c\n- d\n',
  checksOrdered: H + '1. [ ] a\n2. [X] b\n3. [ ] c\n',
  checkLower: H + '- [x] a\n- [ ] b\n',
  checkNoSpace: H + '- [] a\n- [ ] b\n',
  checkSpaces: H + '- [  ] a\n- [ ] b\n',
  checkInText: H + '- a [ ] b\n- [ ] c\n',
  checkAlone: H + '- [ ]\n- [X]\n',
  nestedChecks: H + '- [-] a\n  - [ ] a1\n  - [X] a2\n- [X] b\n',
  nestedAllDone: H + '- [ ] a\n  - [X] a1\n  - [X] a2\n- [ ] b\n',
  nestedAllOpen: H + '- [ ] a\n  - [ ] a1\n  - [ ] a2\n- [ ] b\n',
  nestedPartial: H + '- [X] a\n  - [ ] a1\n  - [X] a2\n- [ ] b\n',
  nestedDeep: H + '- [ ] a\n  - [ ] b\n    - [ ] c\n      - [ ] d\n',
  nestedDeepMixed: H + '- [ ] a\n  - [X] b\n    - [ ] c\n    - [X] d\n  - [ ] e\n',
  nestedNoBoxParent: H + '- a\n  - [ ] a1\n  - [X] a2\n',
  nestedBoxParentNoBoxKids: H + '- [ ] a\n  - a1\n  - a2\n',
  nestedOrderedChecks: H + '1. [ ] a\n   1. [X] a1\n   2. [ ] a2\n2. [ ] b\n',
  nestedDescChecks: H + '- [ ] t :: d\n  - [X] u :: e\n',
  checkWithCookieItem: H + '- [ ] a [0/2]\n  - [ ] a1\n  - [X] a2\n',
  checkWithPercentItem: H + '- [ ] a [%]\n  - [ ] a1\n  - [X] a2\n  - [X] a3\n',
  cookieHeading: '* H [0/2]\n- [ ] a\n- [X] b\n',
  cookieHeadingPct: '* H [%]\n- [ ] a\n- [X] b\n- [X] c\n',
  cookieEmptyHeading: '* H [/]\n- [ ] a\n- [X] b\n',
  cookieBlankHeading: '* H [ ]\n- [ ] a\n',
  cookieTwoHeading: '* H [/] [%]\n- [ ] a\n- [X] b\n- [ ] c\n',
  cookieItemText: H + '- [ ] a [/]\n  - [ ] a1\n- b [1/1]\n  - [X] b1\n',
  cookieRecursive: '* H [/]\n:PROPERTIES:\n:COOKIE_DATA: recursive\n:END:\n- [ ] a\n** Kid\n- [X] k\n',
  cookieCheckboxData: '* H [/]\n:PROPERTIES:\n:COOKIE_DATA: checkbox\n:END:\n- [ ] a\n- [X] b\n',
  cookieTodoData: '* H [/]\n:PROPERTIES:\n:COOKIE_DATA: todo\n:END:\n- [ ] a\n** TODO x\n',
  subheadingChecks: '* H [/]\n- [ ] a\n** Sub [/]\n- [X] s\n',
  twoLists: H + '- [ ] a\n- [X] b\n\ntext\n\n- [ ] c\n',
  // malformed
  boxesWrongParent: H + '- [X] a\n  - [ ] a1\n- [ ] b\n',
  boxesWrongParent2: H + '- [ ] a\n  - [X] a1\n  - [X] a2\n',
  boxDashBadState: H + '- [-] a\n  - [X] a1\n  - [X] a2\n',
  boxDashNoKids: H + '- [-] a\n- [ ] b\n',
  weirdSpacing: H + '-   a\n-    b\n',
  trailingSpaces: H + '- a   \n- b  \n',
  longItem: H + '- ' + 'word '.repeat(60) + '\n- b\n',
  unicode: H + '- é ü\n- 日本語\n',
  noHeading: '- a\n- b\n',
  noHeadingChecks: '- [ ] a\n- [X] b\n',
  afterPlanning: '* TODO H\nSCHEDULED: <2026-01-01 Thu>\n- [ ] a\n- [X] b\n',
  afterProps: '* H\n:PROPERTIES:\n:A: 1\n:END:\n- a\n- b\n',
};
export const LIST_OPS = ['toggle', 'insert-after', 'insert-todo', 'cut', 'repair'];

// Documents run through org-update-statistics-cookies on the whole buffer.
const C = [];
const doc = (s) => C.push(s);
for (const t of ['[/]', '[%]', '[0/0]', '[5/9]', '[100%]', '[ ]', '[//]', '[1/]', '[/1]', '[%%]', '[50%] ']) {
  doc(`* H ${t}\n- [X] a\n- [ ] b\n`);
  doc(`* H ${t}\n- [X] a\n- [X] b\n- [X] c\n`);
  doc(`* H ${t}\n- [ ] a\n`);
  doc(`* H ${t}\nno boxes\n`);
}
doc('* H [/]\n- [X] a\n  - [ ] n\n  - [X] m\n- [-] b\n  - [X] x\n');
doc('* H [/]\n1. [X] a\n2. [ ] b\n3. [X] c\n');
doc('* H [/]\n- [X] a :: d\n- [ ] b :: e\n');
doc('* H [%]\n- [X] a\n- [ ] b\n- [ ] c\n');
doc('* H [%]\n- [X] a\n- [X] b\n- [ ] c\n');
doc('* H [%]\n' + Array.from({ length: 7 }, (_, i) => `- [${i < 3 ? 'X' : ' '}] i${i}`).join('\n') + '\n');
doc('* H [%]\n' + Array.from({ length: 3 }, () => '- [X] x').join('\n') + '\n- [ ] y\n');
doc('* H [/]\n- [X] a [/]\n  - [X] b\n  - [ ] c\n- [ ] d [%]\n  - [X] e\n');
doc('* H [/]\n- [ ] a\n  text\n  - [X] b\n- [X] c\n');
doc('* H [/]\n- [ ] a\n\n  - [X] b\n');
doc('* H [/]\n- a [ ]\n- [X] b\n');
doc('* H [/]\n-[X] a\n- [X] b\n');
doc('* H [/] [/]\n- [X] a\n');
doc('* H [1/2] and [%] text\n- [X] a\n- [ ] b\n');
doc('* TODO H [/]\n- [X] a\n- [ ] b\n');
doc('* TODO H [/] :tag:\n- [X] a\n- [ ] b\n');
doc('* H [/]\n:PROPERTIES:\n:COOKIE_DATA: checkbox\n:END:\n- [X] a\n** TODO k\n');
doc('* H [/]\n:PROPERTIES:\n:COOKIE_DATA: todo\n:END:\n- [X] a\n** TODO k\n** DONE j\n');
doc('* H [/]\n:PROPERTIES:\n:COOKIE_DATA: todo recursive\n:END:\n** TODO a\n*** DONE b\n*** TODO c\n');
doc('* H [/]\n:PROPERTIES:\n:COOKIE_DATA: checkbox recursive\n:END:\n- [X] a\n** k\n- [ ] b\n*** kk\n- [X] c\n');
doc('* H [%]\n:PROPERTIES:\n:COOKIE_DATA: todo\n:END:\n** TODO a\n** DONE b\n** DONE c\n** CANCELED d\n');
doc('* H [/]\n:PROPERTIES:\n:COOKIE_DATA: nonsense\n:END:\n- [X] a\n');
doc('* H [/]\n** TODO a\n** DONE b\n** c\n');
doc('* H [/]\n** TODO a\n*** DONE b\n');
doc('* H [/]\n** DONE a\n** DONE b\n');
doc('* H [%]\n** TODO a\n');
doc('* P [/]\n** C1 [/]\n- [X] a\n** C2 [/]\n- [ ] b\n');
doc('* P [/]\n- [X] own\n** TODO C1\n');
doc('* [/] H\n- [X] a\n');
doc('* H [/]\n#+begin_example\n- [X] a\n#+end_example\n- [ ] b\n');
doc('* H [/]\n:LOGBOOK:\n- [X] a\n:END:\n- [ ] b\n');
doc('* H [/]\n- [X] a\n  #+begin_src sh\n  - [ ] fake\n  #+end_src\n');
doc('* H [/]\n- [X] a\n- [X] b\n- [X] c\n- [X] d\n- [X] e\n- [X] f\n- [X] g\n- [ ] h\n- [ ] i\n- [ ] j\n');
doc('* H [%]\n- [X] a\n- [ ] b\n- [ ] c\n- [ ] d\n- [ ] e\n- [ ] f\n');
doc('* H [/]\n- [-] a\n  - [-] b\n    - [X] c\n    - [ ] d\n  - [ ] e\n');
doc('* H [/]\n- [ ] a\n  - [X] b\n  - [X] c\n');
doc('* H [/]\n- [X] a\n  - [ ] b\n');
doc('* H [/]\n  - [X] a\n  - [ ] b\n');
doc('* H [/]\n1) [X] a\n2) [ ] b\n');
doc('* H [/]\n+ [X] a\n+ [ ] b\n');
doc('* H [/]\n- [x] a\n- [ ] b\n');
doc('* H [/]\n- [ ]a\n- [X] b\n');
export const COOKIES = C;

export const FOOTNOTES = [
  'A[fn:1] B[fn:2] C[fn:3].\n\n[fn:3] three\n\n[fn:1] one\n\n[fn:2] two\n',
  '* H\nA[fn:1].\n* G\nB[fn:1].\n\n[fn:1] shared\n',
  'A[fn:1].\n\n[fn:1] one [[https://x.org][link]] and *bold*\n',
  'A[fn:1].\n\n[fn:1] one\n\n#+begin_src sh\necho\n#+end_src\n',
  'A[fn:1].\n\n[fn:1] one\n- list after\n',
  'A[fn:1].\n\n[fn:1]one-no-space\n',
  'A[fn:1].\n\n[fn:1]\n',
  'A[fn:1].\n\n[fn:1] \n',
  'A [fn:1] with space before.\n\n[fn:1] note\n',
  'A[fn:1][fn:2] adjacent.\n\n[fn:1] a\n\n[fn:2] b\n',
  'A[fn:1],[fn:2].\n\n[fn:1] a\n\n[fn:2] b\n',
  '[fn:1] def at start\n[fn:2] second def\n\nA[fn:1][fn:2].\n',
  'A[fn:Z] B[fn:a] C[fn:B].\n\n[fn:Z] z\n\n[fn:a] a\n\n[fn:B] b\n',
  'A[fn:01] B[fn:1].\n\n[fn:01] zero\n\n[fn:1] one\n',
  'A[fn:-1] B[fn:+1].\n\n[fn:-1] m\n\n[fn:+1] p\n',
  'A[fn:a b] B[fn:c].\n\n[fn:c] c\n',
  'A[fn:x:inline with ] bracket].\n',
  'A[fn:x:inline [with] brackets] done.\n',
  'A[fn::] empty inline.\n',
  'A[fn:x:] empty named.\n',
  'A[fn:] bare.\n',
  'A[fn] bare no colon.\n',
  'A[fn:1:one] B[fn:1] C[fn:1].\n',
  'A[fn::first] B[fn::second] C[fn::third].\n',
  'A[fn::x\n\ny] across paragraphs.\n',
  '* H\nA[fn:1].\n\n* Footnotes\n** Nested heading\nstuff\n\n[fn:1] one\n',
  '* Footnotes\n[fn:1] one\n\n* H\nA[fn:1].\n',
  '* H\nA[fn:1].\n\n* Notes\n[fn:1] one\n',
  '* H\nA[fn:1].\n\n* Footnotes\n\n\n[fn:1] one\n\n\n',
  '* H\nA[fn:1].\n\n* Footnotes\nsome text\n[fn:1] one\n',
  '* H\nA[fn:1].\n* Footnotes\n[fn:1] one\n* After footnotes\nB.\n',
  '* H\nA[fn:1].\n\n[fn:1] one\n* Footnotes\n',
  '* H :ARCHIVE:\nA[fn:1].\n\n[fn:1] one\n',
  '#+TITLE: x\n#+STARTUP: fninline\nA[fn:1].\n\n[fn:1] one\n',
  'A[fn:1].\n\n-----\n\n[fn:1] one\n',
  'A[fn:1].\n\n[fn:1] one\n\n-----\nafter rule\n',
  'A[fn:1].\n\n[fn:1] one\n\n#+TBLFM: x\n',
  '| a[fn:1] |\n|---|\n| b[fn:2] |\n\n[fn:1] a\n\n[fn:2] b\n',
  '1. one[fn:1]\n2. two[fn:2]\n\n[fn:1] a\n\n[fn:2] b\n',
  '- [ ] box[fn:1]\n\n[fn:1] a\n',
  '- tag :: desc[fn:1]\n\n[fn:1] a\n',
  '#+begin_example\nA[fn:1]\n#+end_example\n\n[fn:1] one\n',
  '#+begin_verse\nA[fn:1]\n#+end_verse\n\n[fn:1] one\n',
  '#+begin_center\nA[fn:1]\n#+end_center\n\n[fn:1] one\n',
  '#+begin_comment\nA[fn:1]\n#+end_comment\nB[fn:1].\n\n[fn:1] one\n',
  '#+begin_src emacs-lisp\n(a "[fn:1]")\n#+end_src\n\n[fn:1] one\n',
  '\\begin{equation}\nx[fn:1]\n\\end{equation}\nB[fn:1].\n\n[fn:1] one\n',
  '$x[fn:1]$ and B[fn:1].\n\n[fn:1] one\n',
  'Link [[file:a[fn:1].org]] B[fn:1].\n\n[fn:1] one\n',
  '<<target[fn:1]>> B[fn:1].\n\n[fn:1] one\n',
  '* H\n:PROPERTIES:\n:ID: [fn:1]\n:END:\nB[fn:1].\n\n[fn:1] one\n',
  '* H\nSCHEDULED: <2026-01-01 Thu>\nA[fn:1].\n\n[fn:1] one\n',
  '#+CAPTION: cap[fn:1]\n| a |\n\n[fn:1] one\n',
  'Text[fn:1]\n\n[fn:1] one\n\n[fn:1] one again\n',
  'Text[fn:1] [fn:1:inline same label]\n\n[fn:1] one\n',
  'A[fn:1] B[fn:2]\n\n[fn:2] two\n\n[fn:1] one\nmulti\n\npara\n\n[fn:3] three\n',
  '\n\n\nA[fn:1].\n\n[fn:1] one\n',
  'A[fn:1].\n\n[fn:1] one\n\n\n\n\nfar\n',
  'only text\n',
  '',
];
