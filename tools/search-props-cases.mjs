// Case corpus for the search-props oracle (tags, property handling, match language, in-buffer TODO and tag settings).
// tools/gen-oracle-search-props.mjs runs every case through Emacs 29.3; test/oracle-search-props.test.js holds the app to the answers.

export const TAGS_DOC_TEXT = `#+FILETAGS: :ft1:ft2:
#+TAGS: [ Group : work home ]
#+TAGS: { @a : @b @c }
#+TAGS: [ Reg : {^proj_} ]
#+TAGS: proj_x proj_y private
* Top :work:
** Mid :private:
*** Leaf :home:proj_x:
**** Deep
** Mid2 :proj_y:
* Other :home:
** Child
*** Child two :work:home:
* Third :@a:
* Fourth :@b:@c:
* Fifth :ft1:
* Sixth :Group:
`;

export const TAG_QUERIES = [
  'work', '+work', '-work', 'home', 'work+home', 'work-home', 'work|home', 'private', 'proj_x', 'proj_y', '{^proj}', '{^p.*x$}', '+{^w}-home',
  'ft1', 'ft2', 'ft1+ft2', '-ft1', 'ft1|work', '{^ft}', 'Group', '+Group', '-Group', 'Group+private', 'Group|private', 'Reg', 'Reg-proj_x', '+Reg+home', '@a', '@b', '@c', '@a|@b', '@a+@b', 'nosuchtag', 'Work', 'WORK', '{^W}', '{^w}', 'PROJ_X', '{PROJ}', 'GROUP', 'group',
  'work/TODO', 'LEVEL=2', 'LEVEL=2+private', 'LEVEL>2+work', 'home-work', 'private-home', 'proj_x+private+home', 'ALLTAGS={work}', 'TAGS={work}', 'TAGS={^:home:$}', 'ALLTAGS={private.*home}',
];

export const TAG_SETTINGS = [
  { inherit: 't', exclude: 'nil' },
  { inherit: 'nil', exclude: 'nil' },
  { inherit: "'(\"work\")", exclude: 'nil' },
  { inherit: "'(\"work\" \"private\")", exclude: 'nil' },
  { inherit: '"^pro"', exclude: 'nil' },
  { inherit: '"^w"', exclude: 'nil' },
  { inherit: 't', exclude: "'(\"private\")" },
  { inherit: 't', exclude: "'(\"work\" \"ft1\")" },
  { inherit: "'(\"work\")", exclude: "'(\"work\")" },
  { inherit: 'nil', exclude: "'(\"work\")" },
  { inherit: '"^pro"', exclude: "'(\"proj_x\")" },
  { inherit: '"^W"', exclude: 'nil' },
  { inherit: "'(\"Work\")", exclude: 'nil' },
  { inherit: 't', exclude: "'(\"WORK\")" },
  { inherit: '"o"', exclude: 'nil' },
];

export const PROPS_DOC_TEXT = `#+PROPERTY: GLOB gv
#+PROPERTY: GLOB+ more
#+PROPERTY: Fileprop on file
#+CATEGORY: fcat
* TODO [#A] One :t1:
SCHEDULED: <2026-10-11 Sun> DEADLINE: <2026-10-20 Tue>
:PROPERTIES:
:P: 5
:Q: abc
:E:
:NUM: 1.5
:NEG: -2
:EXP: 1e3
:LIST: a b c
:LIST+: d
:CATEGORY: cat1
:Mixed: Hello World
:END:
body <2026-10-15 Thu>
** child
:PROPERTIES:
:P: 12
:END:
*** grandchild
**** DONE Closed one
CLOSED: [2026-10-01 Thu 10:00]
* NEXT [#C] two
:PROPERTIES:
:P: 7
:Q: ABC
:END:
** TODO Two kid [#B]
SCHEDULED: <2026-10-25 Sun>
* [#B] three
DEADLINE: <2026-10-09 Fri>
:PROPERTIES:
:P: abc
:NUM: 0
:END:
* four
:PROPERTIES:
:P: 05
:Q:
:END:
** Four kid :t1:
:PROPERTIES:
:Q: zzz
:END:
* five
:LOGBOOK:
- State "DONE" from "TODO" [2026-10-02 Fri 09:00]
:END:
body [2026-10-03 Sat] then <2026-10-04 Sun> and <2026-10-05 Mon>
* six
:PROPERTIES:
:WHEN: <2026-10-05 Mon>
:KEY+: tail
:END:
text with [2026-10-06 Tue]
* seven [#C] mid priority
* [#7] digit priority
* TODO fix [#B] later
* stamp <2026-10-07 Wed> in title
* eight
:PROPERTIES:
:LIST+: only plus
:KEY: base
:KEY+: one
:KEY+: two
:END:
** nine
:PROPERTIES:
:KEY+: three
:END:
*** ten
:PROPERTIES:
:KEY: reset
:END:
**** eleven
:PROPERTIES:
:KEY+: after reset
:END:
`;

export const PROP_QUERIES = [
  'P>5', 'P>=5', 'P<5', 'P<=5', 'P=5', 'P<>5', 'P>"5"', 'P<"6"', 'P="5"', 'P<>"5"', 'P={^[0-9]}', 'P={^[0-9]+$}', 'P<>{^[0-9]}', 'P>6.5', 'P>-1', 'P=05', 'P="05"', 'P=0',
  'Q="abc"', 'Q<>"abc"', 'Q>"abb"', 'Q<"abd"', 'Q={abc}', 'Q={^A}', 'Q="ABC"', 'Q=""', 'Q<>""', 'Q>""',
  'E=""', 'E<>""', 'E=0', 'E>0', 'E={^$}', 'NUM>1', 'NUM=1.5', 'NUM<0', 'NUM>=0', 'NUM<=0', 'NUM=0.0', 'NEG<0', 'NEG=-2', 'NEG>-3', 'EXP>999', 'EXP=1000', 'EXP="1e3"',
  'LIST="a b c d"', 'LIST={d$}', 'GLOB="gv more"', 'GLOB={more}', 'Fileprop="on file"', 'Fileprop<>"x"', 'Mixed="Hello World"', 'Mixed={hello}', 'Mixed={^Hello}', 'MIXED="Hello World"', 'mixed="Hello World"',
  'CATEGORY="cat1"', 'CATEGORY="fcat"', 'CATEGORY<>"fcat"', 'CATEGORY={^f}', 'CATEGORY=fcat',
  'ITEM="One"', 'ITEM={^t}', 'ITEM<>"One"', 'ITEM={two}', 'ITEM="three"', 'ITEM>"o"',
  'PRIORITY="A"', 'PRIORITY="B"', 'PRIORITY="C"', 'PRIORITY<"B"', 'PRIORITY>"B"', 'PRIORITY<>"B"', 'PRIORITY={^[AC]}',
  'TODO="TODO"', 'TODO="NEXT"', 'TODO="DONE"', 'TODO=""', 'TODO<>""', 'TODO={^T}', '-TODO="TODO"', 'TODO="todo"',
  'SCHEDULED<"<2026-10-12>"', 'SCHEDULED>"<2026-10-12>"', 'SCHEDULED="<2026-10-11 Sun>"', 'SCHEDULED<>"<2026-10-11>"', 'SCHEDULED>="<2026-10-11>"', 'SCHEDULED<="<2026-10-11>"', 'SCHEDULED<"<today>"', 'SCHEDULED>"<today>"', 'SCHEDULED<="<today>"', 'SCHEDULED<"<+1w>"', 'SCHEDULED>"<-1w>"', 'SCHEDULED<"<now>"', 'SCHEDULED<"<tomorrow>"', 'SCHEDULED<"<+2d>"',
  'DEADLINE<"<2026-10-21>"', 'DEADLINE>"<2026-10-09>"', 'DEADLINE<"<today>"', 'DEADLINE={2026-10}', 'DEADLINE=""', 'DEADLINE<>""', 'DEADLINE<"<+3d>"', 'DEADLINE<"<+2m>"', 'DEADLINE<"<2026-10-20 Tue 12:00>"',
  'CLOSED<"[2026-10-02]"', 'CLOSED>"[2026-09-30]"', 'CLOSED<"<today>"', 'CLOSED<>""', 'CLOSED={2026}',
  'TIMESTAMP>"<2026-10-14>"', 'TIMESTAMP<"<2026-10-16>"', 'TIMESTAMP={10-15}', 'TIMESTAMP_IA={.}', 'TIMESTAMP<>""',
  'BLOCKED="t"', 'BLOCKED=""', 'BLOCKED<>""', 'CLOCKSUM>0', 'ALLTAGS={t1}', 'TAGS={t1}', 'TAGS=""', 'TAGS<>""', 'FILE={fx}', 'FILE="fx.org"',
  'nosuch="x"', 'nosuch<>"x"', 'nosuch=0', 'nosuch>0', 'nosuch={x}', 'nosuch=""',
  'P>5+Q="abc"', 'P>5|Q="abc"', 'P>5-Q="abc"', 'P>5+t1', 't1+P>5', 't1-P>5', 'P>5+LEVEL=1', 'LEVEL=1+P<>5', 'P>5|P<5', 'P<5|P>5|NUM>1', 'P>5+Q={^a}+NUM>1', 'TIMESTAMP={10-07}', 'ITEM={\\[#C\\]}', 'ITEM={seven}', 'TIMESTAMP={2026}', 'TIMESTAMP={10-03}', 'TIMESTAMP={10-04}', 'TIMESTAMP_IA={10-03}', 'TIMESTAMP_IA={10-02}', 'TIMESTAMP_IA={10-06}', 'TIMESTAMP_IA<>""', 'TIMESTAMP=""', 'WHEN={10-05}', 'KEY="base one two"', 'KEY="base one two three"', 'KEY="reset"', 'KEY="reset after reset"', 'KEY={^base}', 'KEY+="tail"', 'KEY+={one}', 'LIST={only}', 'KEY<>""', 'PRIORITY="7"', 'PRIORITY>"B"', 'PRIORITY<"B"', 'PRIORITY=7', 'PRIORITY>5', 'PRIORITY="C"/TODO', 'PRIORITY="B"/TODO', 'ITEM={mid}', 'ITEM={fix}', 'TODO="TODO"+PRIORITY="B"', 'P>5/TODO', 'P>5/!', 'P>5/NEXT|TODO', 'LEVEL>1+P>5', 'LEVEL<3-P>5',
  'TODO="TODO"+P>5', 'TODO="TODO"|PRIORITY="C"', '+P>5-t1', '-P>5', '-P>5+LEVEL=1', 'P>5&Q="abc"', 'P>5&P<20',
  'P>', 'P=', 'P>5+', 'P>5|', '|P>5', 'P>>5', 'P=>5', 'P<=>5', 'P>=<5', 'P{abc}', 'P=abc', 'P=ab c', 'P=a|b', 'P={a|b}', 'P={a\\|b}', 'P={abc', 'P="abc', 'P="a""b"', 'P={}', 'P=""', 'P=\'5\'', 'P = 5', 'P> 5', ' P>5',
];

export const PROP_SETTINGS = [
  { inherit: 't', exclude: 'nil', propInherit: 'nil' },
  { inherit: 't', exclude: 'nil', propInherit: 't' },
  { inherit: 't', exclude: 'nil', propInherit: "'(\"P\")" },
  { inherit: 't', exclude: 'nil', propInherit: "'(\"p\" \"KEY\" \"GLOB\")" },
  { inherit: 't', exclude: 'nil', propInherit: '"^[PQ]"' },
  { inherit: 't', exclude: 'nil', propInherit: '"^[pq]"' },
  { inherit: 't', exclude: 'nil', propInherit: '"^LIST"' },
];

// Files whose #+FILETAGS: line takes different forms; every heading is asked for the same tags.
export const FILETAG_FORMS = [':a:b:', 'a b', 'a:b', ':a:b', 'a:b:', ' :a:b: ', ':a::b:', 'a  b', ':a: :b:', 'a,b', 'a-b b', ':über:a:', '', ':', 'A a'];
export const FILETAG_QUERIES = ['a', 'b', 'a+b', 'a|b', '-a', 'own', 'a+own', 'über', 'A', 'a-b', 'a,b', 'ALLTAGS={a}', 'ALLTAGS={b}'];

export const TODO_DOC = `#+TODO: TODO NEXT | DONE
#+CATEGORY: top
* Alpha :work:urgent:
:PROPERTIES:
:Effort: 2:00
:END:
** TODO [#A] Alpha child :home:
** DONE Alpha done :work:
* TODO [#B] Beta :home:
** NEXT [#C] Beta kid
*** Beta grandkid
* DONE Gamma :work:family:
* Delta :family:
** TODO Delta sub :work:
* TODO Epsilon :urgent:
`;

export const TODO_QUERIES = [
  '/TODO', '/!', '/!TODO', '/NEXT', '/DONE', '/TODO|NEXT', '/TODO|DONE', '/-TODO', '/!-TODO', '/NEXT|DONE|TODO', '/', '//', '/TODO/', 'work/TODO', 'work/DONE', 'work/!', 'work/!DONE', 'work/!TODO|NEXT', 'work|home/TODO', 'work/TODO|home/DONE', 'urgent/TODO', '-work/TODO', '-work/!', 'home+family/', 'family/DONE', '/todo', '/TODO NEXT', '/TODO,NEXT', '/{^T}', '/{^N\\|^D}', '/"TODO"', '/TODO&NEXT', '/&TODO', '/+TODO', '/-DONE', '/-TODO-NEXT', '/-TODO|-NEXT', 'LEVEL=1/TODO', 'LEVEL=1/!', 'LEVEL=2/DONE',
  '/|', '/TODO|', '/|TODO', '/ ', '/nosuch', '/-', '/+', '/TODO|||NEXT', '/!|', '/{^N}|{^D}', '/{N}', '/{}', 'work/TODO|', 'work/|', '/!TODO|DONE', '/!{^T}', 'Effort>"1:00"/TODO', 'Effort>"1:00"/!', '/!NEXT',
];

export const TODO_SETTINGS = [{ inherit: 't', exclude: 'nil', propInherit: 'nil' }];

// Heading lines: Emacs (org-heading-components) and the heading's own tags.
const KW = '#+TODO: TODO(t) NEXT(n!) WAIT(w@/!) | DONE(d!) CANCELED(c@)\n';
export const HEADING_SPEC = KW;
export const HEADING_LINES = [
  '* Plain', '** Second level', '*** Third level title', '* TODO Task', '* TODO', '* DONE', '* DONE Finished', '* NEXT [#A] Priority', '* TODO [#A] Pri and title', '* TODO [#a] lower priority', '* TODO [#1] numeric priority',
  '* [#A] only priority', '* [#A]', '* [#B] Title [#C] second cookie', '* TODO [#A] Title :tag:', '* TODO Title :tag1:tag2:', '* Title :tag:', '* Title    :tag:', '* Title\t:tag:', '* Title :tag:  ', '* Title:tag:',
  '* Title :tag', '* Title tag:', '* Title ::', '* Title :a::b:', '* Title :a:b', '* Title :a b:', '* Title :a-b:', '* Title :a_b:', '* Title :a@b:', '* Title :a#b:', '* Title :a%b:', '* Title :über:', '* Title :日本:', '* Title :A:b:C:', '* Title :1:2:', '* Title :a.b:', '* Title :a,b:', '* Title :a/b:',
  '* :tag:', '* :a:b:', '* TODO :tag:', '* TODO [#A] :tag:', '*  Two spaces', '*  TODO Two spaces todo', '* TODO  Two spaces after', '* TODO  [#A]  spaced', '*\tTabbed', '*', '* ', '** ', '*not a heading', '* TODOS not a todo', '* todo lowercase', '* Todo Mixed', '* TODO: colon after', '* TODO. dot after', '* TODO-ish',
  '* WAIT Waiting', '* CANCELED Cancelled', '* CANCELLED spelled other way', '* COMMENT Commented', '* COMMENT TODO commented todo', '* TODO COMMENT todo commented', '* ARCHIVE not special', '* Title :ARCHIVE:', '* TODO Title :ARCHIVE:work:',
  '* Title with [[link][desc]] :tag:', '* Title [1/2] cookie :tag:', '* Title [33%] :tag:', '* Title <2026-10-11 Sun> :tag:', '* Title *bold* :tag:', '* [#A] [#B] two priorities', '* TODO [#A][#B]', '* TODO[#A] glued', '* TODO [# A]', '* TODO [#AB] long priority', '* TODO [#] empty priority',
  '* Title ending with colon:', '* Title : with spaces', '* a :t:  more text', '* :', '* ::', '* :::', '* a :', '* a ::', '* a :::',
  '******** deep', '* Ünïcode Titlé', '* 日本語 title :日本:', '* emoji 😀 title :tag:',
  '* TODO\tTabbed todo', '* TODO\t[#A]\tTabbed priority\t:tag:',
];

// Keyword settings lines: Emacs's org-todo-keywords-1, org-done-keywords, org-todo-sets and the fast keys.
export const TODO_SPECS = [
  '#+TODO: TODO | DONE', '#+TODO: TODO NEXT | DONE', '#+TODO: TODO NEXT DONE', '#+TODO: A B C', '#+TODO: A', '#+TODO: |', '#+TODO: | DONE', '#+TODO: TODO |', '#+TODO: ', '#+TODO:',
  '#+TODO: TODO(t) | DONE(d)', '#+TODO: TODO(t!) | DONE(d!)', '#+TODO: TODO(t@) | DONE(d@/!)', '#+TODO: WAIT(w@/!) | DONE(d!/!)', '#+TODO: A(a) B | C(c)', '#+TODO: A(a) B(a) | C(c)', '#+TODO: A(a) | B(a)', '#+TODO: TODO(t) NEXT(n) | DONE(d)\n#+TODO: BUG(b) KNOWN(k) | FIXED(f)',
  '#+SEQ_TODO: TODO | DONE', '#+TYP_TODO: Fred Sara Lucy | Done', '#+TYP_TODO: Fred(f) Sara(s) | Lucy(l)', '#+SEQ_TODO: A | B\n#+TYP_TODO: C | D', '#+TODO: A | B\n#+SEQ_TODO: C | D', '#+TODO: A | B\n#+TODO: C | D\n#+TODO: E | F',
  '#+TODO: TODO | DONE | CANCELED', '#+TODO: TODO | DONE |', '#+TODO: TODO(t | DONE', '#+TODO: TODO(t)) | DONE', '#+TODO: TODO () | DONE', '#+TODO: TODO( ) | DONE', '#+TODO: TODO(tt) | DONE', '#+TODO: TODO(T) | DONE(D)', '#+TODO: TODO(t) | DONE(t)',
  '#+TODO: TODO TODO | DONE', '#+TODO: TODO | TODO', '#+TODO: A | B\n#+TODO: A | C', '#+TODO: todo | done', '#+TODO: To_Do | Do-ne', '#+TODO: TODO:x | DONE', '#+TODO: 1ST | 2ND', '#+TODO: Ünï | Dønë', '#+TODO: TODO\t|\tDONE',
  '#+todo: TODO | DONE', '#+Todo: TODO | DONE', '#+TODO:TODO | DONE', '  #+TODO: TODO | DONE',
  '#+TODO: TODO(t) | DONE(d)\n#+TODO: LATER(l)', '#+TODO: !x | y', '#+TODO: a!b | c', '#+TODO: A(a/!) | B(b/@)', '#+TODO: A(a@/@) | B', '#+TODO: A(@) | B', '#+TODO: A(!) | B', '#+TODO: A(/!) | B',
  '#+TODO: A B | C D E', '#+TODO: A B C D E F G | H', '#+TODO: A(a) B(b) C(c) D(d) | E(e) F(f)', '#+TODO: A(1) B(2) | C(3)', '#+TODO: A(\\n) | B', '#+TODO: A ( a ) | B',
];

// org-occur (the sparse tree of a regexp): the headings that own a match.
export const OCCUR_DOC = `* TODO [#A] First heading :work:urgent:
SCHEDULED: <2026-10-11 Sun> DEADLINE: <2026-10-20 Tue>
:PROPERTIES:
:Effort: 1:00
:CUSTOM_ID: first-id
:END:
:LOGBOOK:
- State "TODO" from "NEXT" [2026-10-01 Thu 09:00] \\\\
  note text
:END:
Paragraph with foo and Foo and FOO.
- list item one
- [ ] checkbox item
| a | b |
|---+---|
| table cell | 42 |
#+BEGIN_SRC python
print("source line")
#+END_SRC
** Second :home:
CLOSED: [2026-10-02 Fri 10:00]
Second body line
with two lines
*** Third deep
text café ünïcode 日本語
* DONE Fourth
# a comment line
#+CAPTION: caption text
Final line.
* Fifth \\(parens\\) [brackets] a.b a+b $dollar ^caret
`;

export const OCCUR_REGEXPS = [
  'foo', 'FOO', 'Foo', 'fOo', 'First', 'first', 'heading', 'Second', 'Third', 'Fourth', 'Fifth', 'nothing-here',
  '^\\*+ ', '^\\* ', '^\\*\\* ', '^\\*\\*\\* ', '\\*', '^\\*', 'heading$', '^First', '^$', '$', '^', '\\`', "\\'", 'x*', '.', '.*', '..',
  ':work:', ':urgent:', ':home:', 'work', 'urgent', 'home', ':PROPERTIES:', 'Effort', 'effort', '1:00', 'CUSTOM_ID', 'first-id', ':END:', ':LOGBOOK:', 'LOGBOOK', 'State', 'note text', 'NEXT',
  'SCHEDULED', 'DEADLINE', 'CLOSED', 'scheduled', '<2026-10-11', '2026-10-1', '\\[2026-10-0[12]', 'Sun>', 'Thu', '<[0-9]+-',
  'Paragraph', 'list item', '- \\[ \\]', 'checkbox', 'table cell', '| a |', '^|', '|---+---|', '42', '[[:digit:]]+', '[0-9]\\{2\\}', '[[:upper:]]\\{3\\}', '[[:alpha:]]+ing', '[[:space:]]\\{2,\\}',
  '#\\+BEGIN', '#\\+END', 'print', 'source line', 'python', '# a comment', 'CAPTION', 'caption text', 'Final line', 'Final line\\.', 'two lines', 'with two',
  'café', 'CAFÉ', 'ünï', 'ÜNÏ', '日本', '日本語', 'caf.', 'caf[eé]',
  '\\(foo\\|bar\\)', 'foo\\|Final', 'foo\\|', '\\|foo', '\\(foo\\)\\1', '\\(.\\)\\1', '\\(o\\)\\1', 'a\\{2\\}', 'o\\{2,3\\}', 'o\\{1\\}', 'fo*', 'fo+', 'fo?', 'fo+?', 'fo*?', '[fF]oo', '[^a-z ]+', '[a-c]\\{3\\}',
  '\\<foo\\>', '\\bfoo\\b', '\\Bo\\B', '\\_<TODO\\_>', '\\<TODO', 'TODO\\>', '\\w+@', '\\w\\{9,\\}', '\\sw+', '\\s-+$', '\\S-+ \\S-+ \\S-+ \\S-+ \\S-+ ', '\\W\\W',
  '(parens)', '\\\\(parens\\\\)', '\\(parens\\)', '\\[brackets\\]', '\\[brackets', 'a\\.b', 'a.b', 'a\\+b', 'a+b', '\\$dollar', '$dollar', '\\^caret', '^caret', 'caret$',
  '\\(', '\\)', '[', ']', '*', '+', '?', '\\{', '\\}', 'a\\{2', 'a\\{x\\}', '\\(?:foo\\)', '\\(?1:foo\\)', '[[:nosuchclass:]]', '[z-a]', '\\1', '\\(a\\)\\2', '\\', 'foo\\',
];

// Plain text searches: the case-insensitive substring Emacs's org-occur finds with the text quoted.
export const OCCUR_PLAIN = ['foo', 'FOO', 'First', 'work', 'Effort', 'checkbox', 'cell', 'print(', '(parens)', 'a.b', 'a+b', '$dollar', '^caret', '[brackets]', 'café', '日本', 'x', 'o', 'note', 'Sun>', '2026', '*', '|', '#+', '\\'];

// org-property-get-allowed-values for Effort: [org, heading position, global Effort_ALL or null].
export const ALLOWED_CASES = [
  ['* H\n:PROPERTIES:\n:Effort_ALL: 0 0:30 1:00\n:END:\n', 1, null],
  ['* P\n:PROPERTIES:\n:Effort_ALL: 0 0:30 1:00\n:END:\n** H\n', 2, null],
  ['* P\n:PROPERTIES:\n:Effort_ALL: 0 0:30\n:END:\n** M\n:PROPERTIES:\n:Effort_ALL: 2:00 3:00\n:END:\n*** H\n', 3, null],
  ['#+PROPERTY: Effort_ALL 0 0:15 0:30\n* H\n', 1, null],
  ['#+PROPERTY: Effort_ALL 0 0:15 0:30\n* H\n:PROPERTIES:\n:Effort_ALL: 5:00\n:END:\n', 1, null],
  ['#+PROPERTY: Effort_ALL 0 0:15\n#+PROPERTY: Effort_ALL+ 1:00\n* H\n', 1, null],
  ['#+PROPERTY: Effort_ALL+ 1:00\n* H\n', 1, null],
  ['* H\n', 1, '0:15 0:30 1:00'],
  ['* H\n', 1, null],
  ['#+PROPERTY: Effort_ALL 0 1:00\n* H\n', 1, '0:15 0:30'],
  ['#+PROPERTY: Effort_ALL+ 1:00\n* H\n', 1, '0:15 0:30'],
  ['* H\n:PROPERTIES:\n:Effort_ALL: 0 0:30\n:Effort_ALL+: 1:00 2:00\n:END:\n', 1, null],
  ['* P\n:PROPERTIES:\n:Effort_ALL: 0 0:30\n:END:\n** H\n:PROPERTIES:\n:Effort_ALL+: 4:00\n:END:\n', 2, null],
  ['* P\n:PROPERTIES:\n:Effort_ALL: 0 0:30\n:Effort_ALL+: 9:00\n:END:\n** H\n:PROPERTIES:\n:Effort_ALL+: 4:00\n:END:\n', 2, null],
  ['* H\n:PROPERTIES:\n:Effort_ALL: 0 abc 0:30 1:xx 2h 3:00 4\n:END:\n', 1, null],
  ['* H\n:PROPERTIES:\n:Effort_ALL: 0:30 0:30 1:00 0:30\n:END:\n', 1, null],
  ['* H\n:PROPERTIES:\n:Effort_ALL: "0:30" 1:00\n:END:\n', 1, null],
  ['* H\n:PROPERTIES:\n:Effort_ALL: "a b" 1:00\n:END:\n', 1, null],
  ['* H\n:PROPERTIES:\n:Effort_ALL:\n:END:\n', 1, null],
  ['* P\n:PROPERTIES:\n:Effort_ALL: 1:00\n:END:\n** H\n:PROPERTIES:\n:Effort_ALL:\n:END:\n', 2, null],
  ['* H\n:PROPERTIES:\n:effort_all: 1:00 2:00\n:END:\n', 1, null],
  ['#+PROPERTY: effort_all 1:00 2:00\n* H\n', 1, null],
  ['* H\n:PROPERTIES:\n:Effort_ALL: 1:00\tTAB 2:00\n:END:\n', 1, null],
  ['* H\n:PROPERTIES:\n:Effort_ALL:    1:00     2:00   \n:END:\n', 1, null],
  ['* H\n:PROPERTIES:\n:Effort_ALL: 0:30 1:00\n:END:\n', 1, '5:00'],
  ['* H\n:PROPERTIES:\n:Effort_ALL: 0 0:30\n:END:\n* Other\n', 2, null],
  ['* H\n:PROPERTIES:\n:Effort_ALL: 1d 2d 0:30 1:30:00 90 1.5 -1 +2 1e2\n:END:\n', 1, null],
];
