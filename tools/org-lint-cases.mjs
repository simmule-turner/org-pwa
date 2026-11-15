// Texts that tools/gen-org-lint-oracle.mjs gives to Emacs's org-lint (besides the ones in Org's test-org-lint.el): one entry per
// construct a checker looks at, with the near misses on both sides.
export const LINT_FILES = {
  'exists.org': '* foo\n#+name: nm\n<<tg>>\n* bar\n:PROPERTIES:\n:CUSTOM_ID: cid\n:END:\n#+begin_src emacs-lisp -l "; ref:%s"\n(+ 1 1) ; ref:one\n#+end_src\n',
};
export const LINT_CASES = [
  // duplicates
  '* A\n:PROPERTIES:\n:CUSTOM_ID: a\n:END:\n* B\n:PROPERTIES:\n:custom_id: a\n:END:\n* C\n:PROPERTIES:\n:CUSTOM_ID: a\n:END:\n',
  '* A\n:PROPERTIES:\n:CUSTOM_ID:\n:END:\n* B\n:PROPERTIES:\n:CUSTOM_ID:\n:END:\n',
  '#+name: foo\nPara 1\n\n#+name: foo\n| a |\n\n#+name: bar\n#+begin_src sh\nx\n#+end_src\n\n#+name: bar\n- item\n',
  '#+name: foo\n#+name: foo2\nPara\n\n#+label: foo2\nOther\n\n#+tblname: foo\n| a |\n',
  '#+NAME: Foo\nA\n\n#+name: foo\nB\n\n#+name: Foo\nC\n',
  '<<foo>> <<foo>> <<foo>>\n\n<<a   b>> <<a b>>\n\n<<<radio>>> <<<radio>>>\n',
  '[fn:1] one\n\n[fn:1] two\n\n[fn:2] x\n\n[fn:1] three\n[fn:2] y\n',
  // orphans and obsolete keywords
  '#+name: orphan\n\n#+caption: c\n\n#+attr_html: :width 3\n\n#+results: x\n\n#+header: :x y\n',
  '#+name: foo\n#+begin_src sh\nx\n#+end_src\n#+attr_latex: a\n',
  '#+data: x\n#+label: y\nPara\n\n#+source: s\n#+srcname: n\n#+resname: r\n#+tblname: t\n| a |\n\n#+result: x\n#+headers: :var x=1\n#+begin_src sh\nx\n#+end_src\n\n#+begin_example\n#+data: z\n#+end_example\n',
  // blocks
  '#+begin_html\nx\n#+end_html\n\n#+begin_ascii\nx\n#+end_ascii\n\n#+begin_Latex\nx\n#+end_Latex\n\n#+begin_foo\nx\n#+end_foo\n',
  '#+begin_export html\nx\n#+end_export\n#+begin_export\n#+end_export\n#+begin_export a b\n#+end_export\n',
  '#+begin_src\nx\n#+end_src\n\n#+begin_src -n 5\nx\n#+end_src\n\n#+begin_src emacs-lisp\nx\n#+end_src\n\n#+BEGIN_SRC python :results output\nx\n#+END_SRC\n',
  '#+begin_src sh\n#+begin_src\n#+end_src\n#+end_src\n',
  '#+begin_quote\n#+begin_foo\n#+end_quote\n#+end_foo\n',
  '#+begin_quote\nx\n\n#+end_quote\ntext\n#+end_quote\n',
  '#+begin_comment\n:DRAWER:\nSCHEDULED: <2012-03-29>\n  %%(foo)\n#+bogus\n#+end_comment\n',
  '#+begin_verse\nline [[nothing]] and [fn:1]\n#+end_verse\n\n[fn:1] def\n',
  // babel calls
  '#+call: foo(1)\n#+call: foo[:cache yes](1) :results raw\n#+call: foo(1) [:exports code]\n#+call:\n#+call: foo\n#+call: foo[bar](1)\n',
  '#+call: foo() barbaz yes\n#+call: foo() :barbaz yes\n#+call: foo[:bad yes]() :results verbatim\n#+call: foo[:results table drawer]() :cache maybe\n',
  'call_foo[barbaz yes]() call_foo[:barbaz yes]() call_foo(1) call_foo[:exports both none]()\n',
  'src_emacs-lisp[barbaz yes]{} src_emacs-lisp[:barbaz yes]{} src_python[:foo]{x} src_sh[:results raw html]{} src_{x}\n',
  // header args
  '#+property: header-args barbaz yes\n#+property: header-args :barbaz yes\n#+property: header-args:emacs-lisp :lexical t :bad 1\n#+property: header-args:python :session foo\n#+property: header-args+ :cache yes\n#+property: cache yes\n#+property: Results output\n#+property: dir /tmp\n#+property: foo bar\n',
  '* H\n:PROPERTIES:\n:HEADER-ARGS: barbaz yes\n:HEADER-ARGS+: :exports code :bad 2\n:header-args:emacs-lisp: :lexical t\n:header-args:python+: :session s\n:cache: yes\n:Dir: /tmp\n:END:\n',
  '#+header: :barbaz yes\n#+header: :cache maybe\n#+begin_src emacs-lisp :results foo :exports both none :bad x\n(+ 1 1)\n#+end_src\n',
  '#+header: :results file list\n#+header: :results output silent replace\n#+begin_src emacs-lisp :results raw html latex :hlines yes :colnames nil :noweb tangle :tangle-mode 0644 :var x=1 y=2 :file-mode (identity 1)\n(+ 1 1)\n#+end_src\n',
  '#+begin_src emacs-lisp :cache yes no :exports\nx\n#+end_src\n#+begin_src emacs-lisp :exports code :exports results\nx\n#+end_src\n#+begin_src emacs-lisp barbaz :results\nx\n#+end_src\n',
  '#+begin_src python :session x :tangle yes :eval never-export :lexical t :bad\nx\n#+end_src\n#+begin_src emacs-lisp :lexical foo\nx\n#+end_src\n#+begin_src emacs-lisp :results "raw html" :var a="b c" :comments link\nx\n#+end_src\n',
  // category
  '#+category: a\nx\n#+category: b\n\n#+CATEGORY: c\n',
  // links
  '[[(unknown)]] [[(foo)]]\n#+begin_src emacs-lisp -l "; ref:%s"\n(+ 1 1) ; ref:foo\n#+end_src\n#+begin_example\nx (ref:bar)\n#+end_example\n[[(bar)]] [[(one)]]\n',
  '[[#unknown]] [[#foo]] [[#bar]]\n* H\n:PROPERTIES:\n:CUSTOM_ID: foo\n:END:\n* I\n:PROPERTIES:\n:ID: bar\n:END:\n',
  '[[*unknown]] [[*foo]] [[*foo [1/2]]] [[*  foo   bar ]] [[unknown]] [[foo]] [[tg]] [[nm]] [[res]] [[a b]]\n* foo\n* foo bar\n<<tg>>\n#+name: nm\nx\n#+results: res\n: y\n<<a   b>>\n',
  '[[foo]]\n#+name: foo\n#+name: foo\nx\n\n[[Foo]]\n',
  '[[id:abc]] [[id:def][desc]] <id:ghi> id:jkl\n',
  '[[file:/Idonotexist.org]] [[file:Idonotexist.org]] [[file:exists.org]] [[/etc/passwd]] [[./nothere][d]] [[file:/ssh:host:/x]] [[file+emacs:foo.org]] [[file+sys:/etc/passwd]] [[file:a.org::*foo]]\n',
  '[[attachment:foo.txt]] <attachment:bar.txt> [[attachment:foo.txt::12][d]]\n',
  '[[https://example.org]] [[mailto:a@b.c]] [[elisp:(+ 1 1)]] [[shell:ls]] <https://example.org> https://example.org/x_y. [[doi:10.1/2]] doi:10.1/2\n',
  '[[A%20B]] [[%5Bfoo%5D]] [[A%2520B]] [[A B]] [[A%30B]] [[A%20%30B]] <file:A%20B> [[A B%]] [[file:A%20B.org]] [[https://x.org/a%20b]] [[a%25b]] [[%]]\n',
  '[[file:foo.org][desc [[inner]] more]] [[a][[[b]]]] [[a\\]b]] [[a\\\\][x]]\n',
  '#+link: gh https://github.com/%s\n#+link: pk file:/Idonotexist/%s\n#+link: nf nothing:\n[[gh:foo/bar]] [[pk:x.org]] [[nf:x]] [[zz:x]]\n',
  '* H [[#a]] :t:\n- tag [[#b]] :: x [[#c]]\n| [[#d]] | [fn:1] |\n\n[fn:1] def [[#e]]\n#+caption: [[#f]]\n',
  // setupfile, include, bibliography
  '#+setupfile: Idonotexist.org\n#+setupfile: "Idonotexist two.org"\n#+setupfile: https://x.org/a.org\n#+setupfile: exists.org\n#+setupfile: /ssh:host:/a.org\n#+setupfile: file:///tmp/x\n#+setupfile: www://x\n',
  '#+include:\n#+include: Idonotexist.org\n#+include: "Idonotexist.org::*foo"\n#+include: exists.org\n#+include: exists.org::*foo\n#+include: exists.org::*zzz\n#+include: "exists.org::#cid"\n#+include: exists.org::#nope\n#+include: exists.org::tg\n#+include: exists.org::nm\n#+include: exists.org::nope\n#+include: exists.org::(one)\n#+include: exists.org::(two)\n#+include: https://x.org/a.org::foo\n',
  '#+include: ::*H\n',
  '#+include: "::#nope"\n',
  '* H\n#+include: "exists.org" html\n#+include: "exists.org" export html\n#+include: exists.org Markdown :lines "1-2"\n#+include: exists.org src emacs-lisp\n',
  '#+bibliography: Idonotexist.bib\n#+bibliography: "Idonotexist two.bib"\n#+bibliography: /etc/passwd\n#+bibliography: /ssh:h:/x.bib\n',
  '[cite:@foo]\n',
  '[cite:@foo] [cite/t:@bar]\n#+print_bibliography:\n',
  '#+print_bibliography:\n',
  '[cite:foo] [cite:@foo [cite: @a;@b] [cite/x:@c;] [cite/:@d] [cite/a b:@e]\n',
  '=[cite:foo]= ~[cite:bar~ *[cite:baz* normal [cite:\n',
  '#+cite_export:\n#+cite_export: 2\n#+cite_export: basic bar baz qux\n#+cite_export: basic "bar\n#+cite_export: unknown\n#+cite_export: basic\n#+cite_export: basic "a b" c\n#+cite_export: csl x.csl\n#+cite_export: "basic"\n#+cite_export: (x)\n#+cite_export: nil\n',
  // options and macros
  '#+options: foobarbaz:t\n#+options: H:\n#+options: toc:nil num:t ^:{} foo:(a b) \\n:t\n#+options: a:b c:\n#+options: broken-links:mark title:nil H:3 tex:verbatim\n',
  '#+macro: wrongsignature $1 $2\n{{{wrongsignature(1, 2, 3)}}} {{{wrongsignature(1)}}} {{{wrongsignature}}} {{{wrongsignature(1,2)}}} {{{wrongsignature(1,2,3,4)}}}\n',
  '#+macro:\n#+macro: missingtemplate\n#+macro: unused $1 $3\n#+macro: ok $1 $2 $1\n#+macro: none text\n#+macro: ev (eval (+ 1 2))\n{{{none(a)}}} {{{none}}} {{{ev}}} {{{ev(1)}}}\n',
  '{{{undefined()}}} {{{keyword}}} {{{keyword(one, too many)}}} {{{keyword(a)}}} {{{n}}} {{{n(a,b,c)}}} {{{n(a,b)}}} {{{time(%Y)}}} {{{time}}} {{{property(a,b,c)}}} {{{property(a)}}} {{{property}}} {{{author}}} {{{author(x)}}} {{{title(a,b)}}} {{{input-file}}} {{{modification-time(%Y)}}} {{{date}}} {{{email}}} {{{results}}} {{{results(a)}}}\n',
  '#+macro: author $1 $2\n#+macro: dup a\n#+macro: dup b $1\n{{{author}}} {{{dup}}} {{{DUP(x)}}} {{{Dup}}}\n',
  '#+macro: m $1, $2\n{{{m(a\\, b, c)}}} {{{m(a,b,c\\,d)}}} {{{m( a , b )}}}\n',
  // properties
  '* H\n:PROPERTIES:\n:TODO: foo\n:CATEGORY: x\n:ID: i\n:tags: x\n:END:\n',
  '* H\n:PROPERTIES:\n:SOMETHING: foo\n:END:\n* I\nSCHEDULED: <2012-03-29>\n:PROPERTIES:\n:SOMETHING: foo\n:END:\n* J\nParagraph\n:PROPERTIES:\n:SOMETHING: foo\n:END:\n* K\n:PROPERTIES:\nThis is not a node property\n:END:\n* L\n\n:PROPERTIES:\n:A: b\n:END:\n',
  ':PROPERTIES:\n:SOMETHING: foo\n:END:\n\n# Comment\n:PROPERTIES:\n:A: b\n:END:\n',
  '# Comment\n:PROPERTIES:\n:SOMETHING: foo\n:END:\n* H\n',
  'Paragraph\n:PROPERTIES:\n:FOO: bar\n:END:\n',
  '* H\n:PROPERTIES:\n:EFFORT: something\n:Effort: 1:2\n:EFFORT: 1:23\n:EFFORT: 1h\n:EFFORT: 5\n:EFFORT:\n:EFFORT: 1d 2:00\n:EFFORT: 2h 3min\n:EFFORT: 1.5h\n:EFFORT: 1:23:45\n:EFFORT: 1 h\n:END:\n',
  // footnotes
  'Text[fn:1] [fn:2] [fn:3:inline] [fn::anon] [fn:4:x [fn:5] y] [fn:3] [fn:6\n\n[fn:1] one\n[fn:7] seven\n\n[fn:4] four\n',
  '* Footnotes\nI am not a footnote definition\n',
  '* Footnotes\n[fn:1] A footnote\n',
  '* Footnotes\n:PROPERTIES:\n:A: b\n:END:\n[fn:1] A\n# comment\n#+begin_comment\nx\n#+end_comment\n** COMMENT Sub\nstuff\n** Sub 2\n',
  '* Footnotes\n[fn:1] A\n\n#+name: x\n| a |\n',
  '* Footnotes\nSCHEDULED: <2012-03-29>\n[fn:1] A\n',
  '* FOOTNOTES\ntext\n* Footnotes :tag:\ntext\n',
  '* Footnotes\n\n[fn:1] A\n\n\n\npara after two blanks\n',
  // keywords etc.
  '#+keyword\n#+keyword:\n#+title Foo\n#+ foo\n#+begin\n#+END\n#+caption[x] foo\n#+caption[x]: foo\n#+results: x\n#+ATTR_HTML\n#+a:b\n#+a b: c\n#+: x\n#+TITLE:x\n',
  '#+begin_foo\n#+begin_foo\n#+end_foo\n#+end_foo bar\n#+END_x   \n#+begin: clocktable\n#+end:\n#+begin:\n#+end\n#+BEGIN_SRC\n',
  'SCHEDULED: <2012-03-29 thu.>\n* H\nText\nSCHEDULED: <2012-03-29 thu.>\n* I\nSCHEDULED: <2012-03-29 thu.>\n  DEADLINE: <2012-03-29 thu.>\n* J\n\nSCHEDULED: <2012-03-29 thu.>\n* K\n#+begin_src sh\nSCHEDULED: <2012-03-29 thu.>\n#+end_src\n:LOGBOOK:\nCLOSED: [2012-03-29 thu.]\n:END:\n* L\nCLOSED: [2012-03-29]\nscheduled: <2012-03-29>\n',
  ':DRAWER:\n:ODD:\n:END:\n\n:DRAWER:\n\n:LOGBOOK:\nx\n:END:\n:ODD:\n\n* H\n:PROPERTIES:\n:FOO: bar\n:END:\n:ODD2:\n#+begin_src sh\n:ODD3:\n#+end_src\n:END:\n',
  ':DRAWER:\n:END:\n\n:a:\ntext\n:b:\n:END:\n- item\n  :c:\n  :END:\n  :d:\n',
  '  %%(foo)\n%%(bar)\n- x\n  %%(baz)\n#+begin_src sh\n  %%(no)\n#+end_src\n',
  '* QUOTE H\n* COMMENT QUOTE H\n* TODO QUOTE H\n* QUOTE\n* QUOTES\n* TODO COMMENT QUOTE x\n',
  '* H :tag:tag2:\n* H :tag::tag2:\n* H :tag::\n* H ::\n* H :a:b::c:\n* H :::\n* H :tag:  \n* :x::y:\n',
  '* TODO Hello [#A] COMMENT :a::b:\n* COMMENT :a::b:\n** DONE :x:\n',
  '#+todo: TODO NEXT | DONE\n* NEXT QUOTE title\n',
  // object contexts
  '*bold [fn:1]* /it [[nope]]/ _u [[#x]]_ +s <<t>>+ ~c [[nope]]~ =v [fn:1]= @@html:[[nope]]@@ {{{undef}}}\n[fn:1] x\n',
  '| a [[x]] | <<t>> |\n| [fn:1] | {{{m}}} |\n|---+---|\n| *b [[y]]* |\n\n[fn:1] one\n',
  '- item [[a]]\n  - sub [[b]]\n\n    para [[c]]\n- tag :: [[d]]\n\n  #+begin_src sh\n  [[e]]\n  #+end_src\n1. one [fn:1]\n2) two [[f]]\n\n[fn:1] x\n',
  '* H [[a]]\n** H2 [fn:1] {{{m}}} <<t>>\n[fn:1] x\n',
  '#+begin_center\n[[a]]\n#+begin_quote\n[[b]]\n#+end_quote\n#+end_center\n:D:\n[[c]]\n:END:\n#+begin_foo\n[[d]]\n#+end_foo\n',
  '[[a][desc with [fn:1] and {{{m}}} and src_sh{x}]] src_sh[:exports code]{echo [[no]]}\n\n[fn:1] x\n',
  'a_b_c *x* [[c]] 2*3*4 a*b*c *a*b <<a>>b src_foo call_foo\n',
  // footnote definitions in contexts
  'Para[fn:1]\n[fn:1] def\nsecond line\n\n\n[fn:2] two\n[fn:3] three [fn:4]\n\n[fn:4] four\n',
  '- item\n  [fn:1] in item\n\n  para [fn:1]\n',
  '#+name: n\n[fn:1] named def\n\n[fn:2] x\n#+caption: c\n[fn:3] y\n',
  // lists with structure
  '- a\n- b\n\n  c\n\n\n- d\n\nText\n  - e\n- f\n  1. g\n  2. h\n- [ ] i\n- [X] j\n+ k\n* l\n',
  '- a\n  #+begin_src sh\n- not item\n  #+end_src\n- b\n  :D:\n  - c\n  :END:\n',
  // tables
  '| a | b |\n#+TBLFM: $1=1\n#+tblfm: $2=2\n\n+---+---+\n| x | y |\n+---+---+\n\n+---+\n\n|x|\n',
  // comments, fixed width, latex, hr
  '# comment\n# comment [[no]]\n: fixed [[no]]\n\\begin{equation}\n[[no]]\n\\end{equation}\n-----\n[[yes]]\n\\begin{foo}\n[[yes2]]\n',
  // misc
  '',
  '\n\n',
  'text without newline',
  '* H\n',
  '* H\n\n\n\n',
  '#+title: Hello\n#+author: Me\n\nText.\n',
  '#+name:\nx\n\n#+name:\ny\n',
  '#+name: a:b\n#+name: c: d\n#+name: e:f\n| x |\n\n#+name:x:y\n| x |\n',
  '#+caption: a [fn:1]\n#+name: z\n#+attr_html: :x\n#+begin_src sh\nx\n#+end_src\n\n[fn:1] x\n',
];

// Random documents made of the lines below (a seeded generator, so the fixture stays the same until the cases change): they reach
// the corners where blocks, drawers, lists, footnote definitions and keywords meet.
const VOCAB = [
  '* H1', '** H2 :tag:', '* TODO H3 [#A] :a::b:', '* COMMENT H4', '* Footnotes', '* QUOTE Q', '*** deep [[#cid]]',
  ':PROPERTIES:', ':CUSTOM_ID: cid', ':ID: i1', ':EFFORT: 1:00', ':EFFORT: x', ':TODO: x', ':header-args: :foo 1', ':END:',
  ':LOGBOOK:', ':DRAWER:', ':odd:', 'SCHEDULED: <2012-03-29 thu.>', 'DEADLINE: <2012-03-29>',
  '#+begin_src emacs-lisp :results foo', '#+begin_src', '#+begin_src sh -n 5 :cache maybe', '#+end_src', '#+begin_example', '#+end_example',
  '#+begin_quote', '#+end_quote', '#+begin_center', '#+end_center', '#+begin_html', '#+end_html', '#+begin_export', '#+end_export',
  '#+begin_comment', '#+end_comment', '#+begin_verse', '#+end_verse', '#+begin_foo bar', '#+end_foo', '#+begin: clocktable', '#+end:',
  '#+name: n1', '#+name: n1', '#+name: a:b', '#+caption: c', '#+attr_html: :x 1', '#+header: :cache maybe', '#+results:', '#+label: l',
  '#+call: f(1) [:x y]', '#+macro: m $1 $3', '#+options: foo:t H:', '#+title: T', '#+keyword', '#+category: c', '#+property: header-args :q 1',
  '#+include: nothing.org', '#+setupfile: nothing.org', '#+bibliography: nothing.bib', '#+cite_export: basic', '#+print_bibliography:',
  '- item [[a]]', '  - sub [fn:1]', '1. one', '2) two [[#x]]', '- tag :: desc', '- [ ] box', '  continuation [[b]]', '    deeper text',
  '[fn:1] def one', '[fn:2] def two [fn:1]', '[fn:1] dup', 'ref[fn:1] and [fn:3] and [fn::anon]',
  'plain *bold [[c]]* text', 'text {{{m(1)}}} {{{undef}}} <<t1>> <<t1>>', 'src_sh[:x]{y} call_f[:z](1)', '[[file:nothing.org]] [[*H1]] [[tg]] [[(r1)]]', '[cite:@k] [cite:bad', '=[cite:v]=',
  '| a | b |', '|---+---|', '| [[d]] | {{{m}}} |', '#+TBLFM: $1=2', '+---+', '# comment', ': fixed', '-----', '%%(diary)', '  %%(indented)',
  '', '', '', '  ', '\\begin{eq}', '\\end{eq}', 'ordinary paragraph line', 'another line',
];
function prng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
for (let seed = 1; seed <= 400; seed++) {
  const r = prng(seed);
  const n = 4 + Math.floor(r() * 12);
  const lines = [];
  for (let i = 0; i < n; i++) lines.push(VOCAB[Math.floor(r() * VOCAB.length)]);
  LINT_CASES.push(lines.join('\n') + (r() < 0.8 ? '\n' : ''));
}

// Random lines of inline pieces: emphasis, links, footnote references, macros, targets, citations, inline Babel.
const PIECES = [
  '*b*', '/i/', '_u_', '+s+', '~c~', '=v=', '*b [[#x]] c*', '/i [fn:1] j/', '=[cite:v]=', '~[cite:@c]~', '[[a]]', '[[a][d]]', '[[a][d [fn:1]]]', '[[https://x.org]]',
  '[[file:nothing.org][f]]', '[[*H]]', '[[#cid]]', '[[(r)]]', '<<t>>', '<<<rt>>>', '{{{m(1,2)}}}', '{{{m}}}', '[fn:1]', '[fn:2:in line]', '[fn::anon [fn:3]]', '[fn:4',
  '[cite:@k]', '[cite/t:@k;@l]', '[cite:foo]', '[cite:', '[cite/a_b:@k]', '[cite:@k [cite:@l]]', 'src_sh{x}', 'src_sh[:q 1]{x}', 'call_f(1)', 'call_f[:q 1](1)[:z 2]',
  '@@html:<b>@@', '<https://x.org>', 'https://x.org/y.', 'file:nothing.org', 'mailto:a@b.c', '2*3*4', 'a_b', 'a*b*c', ' ', ' ', 'word', 'text', '- ', '| ', '\\\\',
];
for (let seed = 1001; seed <= 1300; seed++) {
  const r = prng(seed);
  const lines = [];
  const nl = 1 + Math.floor(r() * 4);
  for (let l = 0; l < nl; l++) {
    const n = 2 + Math.floor(r() * 7);
    let line = r() < 0.15 ? '| ' : r() < 0.15 ? '- ' : r() < 0.1 ? '* ' : '';
    for (let i = 0; i < n; i++) line += PIECES[Math.floor(r() * PIECES.length)] + (r() < 0.7 ? ' ' : '');
    lines.push(line);
  }
  if (r() < 0.5) lines.push('', '[fn:1] def');
  LINT_CASES.push(lines.join('\n') + '\n');
}
