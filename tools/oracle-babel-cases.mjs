// The corpus for tools/gen-oracle-babel.mjs: every case is { kind, ...input }.  Kinds: blocks (the blocks Org finds in a text, with
// language, body, name and header arguments), noweb / nowebp (expansion of <<references>>, and which :noweb values allow it),
// tangle (the files org-babel-tangle writes), export (the text the export step leaves) and exec (an emacs-lisp block run once).

/** A small seeded random generator, so the corpus is the same on every run. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const R = rng(20261029);
const pick = (list) => list[Math.floor(R() * list.length)];
const some = (list, max) => {
  const n = Math.floor(R() * (max + 1));
  const out = [];
  for (let i = 0; i < n; i++) out.push(pick(list));
  return out;
};

// ---- blocks: header arguments and their inheritance --------------------------------------------------------------------------

const FILE_LINES = [
  '#+PROPERTY: header-args :results output',
  '#+PROPERTY: header-args :results table :exports both',
  '#+PROPERTY: header-args+ :var a=1',
  '#+PROPERTY: header-args :var a=1 :var b=2',
  '#+PROPERTY: header-args:js :exports results :tangle js.js',
  '#+PROPERTY: header-args:js+ :var j=5',
  '#+PROPERTY: header-args:emacs-lisp :results value silent',
  '#+PROPERTY: header-args:python :results output',
  '#+PROPERTY: header-args :session main :cache yes',
  '#+PROPERTY: header-args :noweb yes',
  '#+PROPERTY: header-args :tangle yes :mkdirp yes :comments link',
  '#+PROPERTY: header-args :dir /tmp :hlines yes',
  '#+PROPERTY: header-args :eval never',
  '#+PROPERTY: header-args :wrap quote',
  '#+PROPERTY: header-args :shebang "#!/bin/sh"',
  '#+PROPERTY: Header-Args :results raw',
  '#+PROPERTY: header-args',
  '#+PROPERTY: other thing',
  '#+PROPERTY: header-args :results "output"',
  '#+PROPERTY: header-args :results replace :exports code',
  '#+PROPERTY: header-args :results append',
  '#+PROPERTY: header-args :colnames yes :rownames yes',
  '#+PROPERTY: header-args :padline no :no-expand',
  '#+PROPERTY: header-args:sh :results output :shebang "#!/bin/bash"',
  '#+PROPERTY: header-args:JS :results raw',
  '#+PROPERTY: header-args :var t=tbl[1,0] :var s="a b"',
];
const HEADING_PROPS = [
  ':header-args: :results table',
  ':header-args+: :var c=3',
  ':header-args:js: :tangle out.js',
  ':header-args:js+: :var d=4 :exports none',
  ':header-args:emacs-lisp: :results output',
  ':HEADER-ARGS: :cache yes',
  ':header-args: :var c=9',
  ':header-args+: :results list',
  ':header-args: ',
  ':CUSTOM_ID: x',
  ':header-args:python: :session py',
  ':header-args: :results silent :exports results',
  ':header-args+: :tangle yes',
  ':header-args:js: :results output',
  ':header-args+: :noweb no-export',
  ':header-args:js+: :results append',
];
const BLOCK_HEADERS = ['#+HEADER: :var h=1', '#+HEADERS: :results scalar', '#+header: :exports code', '#+HEADER: :tangle yes', '#+HEADER: :var a=7 :cache no', '#+HEADER: :results drawer', '#+HEADER:'];
const BLOCK_PARAMS = [
  '', ':results html', ':results output :exports results', ':var a=5', ':var a=5 b="x y"', ':tangle no', ':session', ':session s2', ':noweb-ref r1', ':results value',
  ':results table replace', ':results silent', ':exports both :cache yes', ':tangle out/x.js :mkdirp yes', ':var l=\'(1 2 3)\'', ':no-expand', ':comments org :padline no',
  ':results file :file out.png', ':var x=tbl', ':hlines yes :colnames no', ':results output raw', ':results pp', ':eval no-export', ':noweb yes', ':noweb-sep "--"',
  ':results vector', ':results code', ':results drawer', ':results file raw', ':results none', ':exports none', ':var a=1 :var a=2', ':results output :results table',
];
const LANGS = ['js', 'emacs-lisp', 'python', 'sh', 'JS', 'Emacs-Lisp', 'elisp', 'javascript', 'C++', 'c'];

function argsDoc() {
  const lines = [];
  for (const l of some(FILE_LINES, 3)) lines.push(l);
  const depth = Math.floor(R() * 4);
  for (let d = 1; d <= depth; d++) {
    lines.push('*'.repeat(d) + ' H' + d);
    const props = some(HEADING_PROPS, 2);
    if (props.length) lines.push(':PROPERTIES:', ...props, ':END:');
  }
  lines.push(...some(BLOCK_HEADERS, 2));
  lines.push(`#+begin_src ${pick(LANGS)} ${pick(BLOCK_PARAMS)}`.replace(/ +$/, ''), 'body', '#+end_src');
  if (R() < 0.3) lines.push('', `#+begin_src ${pick(LANGS)} ${pick(BLOCK_PARAMS)}`.replace(/ +$/, ''), 'two', '#+end_src');
  return lines.join('\n') + '\n';
}

// one block's text after the language, written in ways Org must split correctly
const SYNTAX = [
  ':var a=1', ':var a=1 b=2', ':var a=1 :var b=2', ':var a = 1', ':var a= 1', ':var a =1', ':var a="x :y"', ':var a=(list 1 2)', ':var a=(list 1 (quote (2 3)))', ':var a=\'(1 "b" c)',
  ':var tbl=other[1:2,0]', ':var a=1  :var b=2', ':var a=1\t:var b=2', ':tangle "a b.js"', ':tangle a-b.js', ':results "output"', ':results output "raw"', ':results "output raw"', ':dir ~/x', ':dir "~/a b"',
  ':no-expand', ':no-expand :results output', ':RESULTS output', ':Results Output', ':results OUTPUT', ':exports', ':exports ', ':results', ':cache', ':tangle', ':mkdirp',
  ':results output :results table', ':results table :results output', ':results output silent', ':results replace silent', ':results append prepend', ':results file raw', ':results html drawer',
  ':results raw html', ':results code org', ':results scalar verbatim', ':results list vector', ':results value output', ':results output value', ':results discard', ':results none replace',
  ':exports code results', ':exports results both', ':exports none code', ':exports both none', ':exports', ':exports bogus',
  ':colnames \'("a" "b")', ':colnames yes :rownames yes', ':colnames nil', ':hlines no', ':hlines yes :hlines no', ':rownames', ':colnames',
  ':var x="a:b"', ':var x="a :b"', ':var x=":a"', ':wrap src js', ':wrap "src js"', ':post foo(*this*)', ':post foo(*this*, 1)', ':file-desc "d e"', ':file out.png :file-ext png',
  ':session  s', ':session "my s"', ':session none', ':lexical yes', ':lexical t', ':lexical no', ':eval never-export', ':eval query', ':eval yes',
  ':noweb-ref', ':noweb-ref a b', ':noweb-sep ""', ':noweb-sep "\\n"', ':noweb-prefix no', ':tangle-mode (identity #o755)', ':tangle-mode o755', ':tangle-mode "rwxr-xr-x"',
  ':shebang "#!/usr/bin/env node"', ':shebang #!/bin/sh', ':comments both', ':comments no', ':comments', ':padline yes', ':padline no', ':prologue "p"', ':epilogue "e;f"', ':prologue "a :b"',
  ':results output :file x.txt', ':var l=\'(1 2) :results table', ':var l=\'(1 2)', ':var v=[1 2 3]', ':var s=\'sym', ':var f=3.5 g=-2 h=1e3', ':var n=nil', ':var t=t', ':var u=undefined-name',
  ':var a=1 :cache yes', ':cache yes :var a=1', ':timeout 3', ':net example.org', ':location yes',
  ':foo bar', ':foo-bar baz', ':_x y', ':1 y', ':x', ':=', ': x', '::x y', ':x y :: z', 'a=1', 'results output', ':results output  ', ':results\toutput',
  '-n', '-n :results output', '-n -r -k', '-l "[%s]" :results output', '+n 5 :var a=1', '-i :var a=1', '-r (ref:%s)', ':var a=1 -n', ':results output (ref:x)', '-n (ref:a) :results output',
];

function syntaxDoc(lang, params, extra = '') {
  return `${extra}#+begin_src ${lang} ${params}\nbody\n#+end_src\n`.replace(/ \n/, '\n');
}

// ---- blocks: finding blocks and reading their bodies --------------------------------------------------------------------------

const BODY_TEXTS = [
  '* H\n  #+begin_src js -n -r (ref:a)\n    one (ref:x)\n    two\n  ,* star\n  ,#+x\n\n  #+end_src\n',
  '#+NAME: nm\n#+begin_src js\nx\n#+end_src\n#+BEGIN_EXAMPLE\n#+begin_src js\nin\n#+end_src\n#+END_EXAMPLE\n',
  '#+begin_src\nnolang\n#+end_src\n#+begin_src C++ :tangle a\nc\n#+end_src\n#+begin_src Emacs-Lisp\n(x)\n#+end_src\n',
  '#+begin_src js\nnever closed\n',
  '* COMMENT H\n#+begin_src js\nc\n#+end_src\n',
  '#+begin_src js :var a=1\n\tb\n\t\tc\n#+end_src\n',
  '#+begin_src js\n\n\nlead blank\n\n\n#+end_src\n',
  '#+begin_src js\n#+end_src\n',
  '#+begin_src js\n\n#+end_src\n',
  '#+begin_src js\none\n  two\n    three\n#+end_src\n',
  '  #+begin_src js\n  one\n   two\n  #+end_src\n',
  '  #+begin_src js\none\ntwo\n  #+end_src\n',
  '#+begin_src js\n  one\n\n  two  \n  #+end_src\n',
  '#+begin_src js\ntrailing   \nspaces\t\n#+end_src\n',
  '#+begin_src js\n,* escaped\n,#+KEY: v\n,,* double\n, * not\n#+end_src\n',
  '#+begin_src js\n  ,* escaped indented\n  ,#+KEY: v\n#+end_src\n',
  '#+begin_src js\n* not escaped\n#+end_src\n',
  '#+BEGIN_SRC js\nupper\n#+END_SRC\n',
  '#+Begin_Src js\nmixed\n#+End_Src\n',
  '#+begin_src js\none\n#+end_src\n#+begin_src js\ntwo\n#+end_src\n',
  '#+begin_src js\none\n#+end_src\n\n\n#+begin_src js\ntwo\n#+end_src\n',
  '#+begin_src js\nouter\n#+begin_src js\ninner\n#+end_src\n',
  '#+begin_src js\nouter\n#+end_src\n#+end_src\n',
  '#+begin_src js\nx\n#+end_src junk\n',
  '#+begin_src js\nx\n  #+end_src\n',
  '#+begin_src js extra words :results output\nx\n#+end_src\n',
  '#+begin_src js\t:results output\nx\n#+end_src\n',
  '#+begin_src js   \nx\n#+end_src\n',
  '#+begin_src   js\nx\n#+end_src\n',
  '#+begin_srcjs\nx\n#+end_src\n',
  '#+begin_src js\nx\n#+end_srcjs\n',
  '#+begin_example\n#+begin_src js\nin example\n#+end_src\n#+end_example\n',
  '#+begin_quote\n#+begin_src js\nin quote\n#+end_src\n#+end_quote\n',
  '#+begin_center\n#+begin_src js\nin center\n#+end_src\n#+end_center\n',
  '#+begin_verse\n#+begin_src js\nin verse\n#+end_src\n#+end_verse\n',
  '#+begin_comment\n#+begin_src js\nin comment\n#+end_src\n#+end_comment\n',
  '#+begin_export html\n#+begin_src js\nin export\n#+end_src\n#+end_export\n',
  '#+begin_src js\nA\n#+end_src\n#+begin_example\nB\n#+end_example\n#+begin_src js\nC\n#+end_src\n',
  ':DRAWER:\n#+begin_src js\nin drawer\n#+end_src\n:END:\n',
  '* H\n:LOGBOOK:\n#+begin_src js\nin logbook\n#+end_src\n:END:\n',
  '* H\n:PROPERTIES:\n:ID: x\n:END:\n#+begin_src js\nafter props\n#+end_src\n',
  '- item\n  #+begin_src js\n  in item\n  #+end_src\n- next\n',
  '- item\n  #+begin_src js\n  in item\n  #+end_src\n  more\n',
  '1. item\n   #+begin_src js\n   one\n    two\n   #+end_src\n',
  '[fn:1] note\n#+begin_src js\nafter footnote\n#+end_src\n',
  '| a | b |\n#+begin_src js\nafter table\n#+end_src\n',
  '# comment\n#+begin_src js\nafter comment\n#+end_src\n',
  '#+NAME: one\n#+NAME: two\n#+begin_src js\nx\n#+end_src\n',
  '#+NAME:   spaced name  \n#+begin_src js\nx\n#+end_src\n',
  '#+name: lower\n#+begin_src js\nx\n#+end_src\n',
  '#+NAME:\n#+begin_src js\nx\n#+end_src\n',
  '#+NAME: sep\n\n#+begin_src js\nx\n#+end_src\n',
  '#+NAME: cap\n#+CAPTION: c\n#+begin_src js\nx\n#+end_src\n',
  '#+CAPTION: c\n#+NAME: cap2\n#+begin_src js\nx\n#+end_src\n',
  '#+NAME: n\n#+ATTR_HTML: :a b\n#+begin_src js\nx\n#+end_src\n',
  '#+NAME: after\n#+begin_src js\nx\n#+end_src\n#+NAME: later\n',
  '#+NAME: tbl\n| 1 | 2 |\n#+begin_src js\nx\n#+end_src\n',
  '#+NAME: with space\n#+begin_src js\nx\n#+end_src\n',
  '#+NAME: a:b\n#+begin_src js\nx\n#+end_src\n',
  '#+NAME: [x]\n#+begin_src js\nx\n#+end_src\n',
  '#+begin_src js\nx\n#+end_src\n#+NAME: below\n',
  '* ARCHIVED :ARCHIVE:\n#+begin_src js\narch\n#+end_src\n',
  '* TODO H :tag:\n#+begin_src js\nwith tag\n#+end_src\n** Sub\n#+begin_src js\nsub\n#+end_src\n',
  '* H\ntext\n#+begin_src js\nA\n#+end_src\n* H2\n#+begin_src js\nB\n#+end_src\n',
  '#+begin_src js\n日本語 ünï\n#+end_src\n',
  '#+begin_src js\n nbsp lead\n#+end_src\n',
  '#+begin_src js\n\ttab lead\n\tsecond\n#+end_src\n',
  '#+begin_src js\n\t  mixed\n\t  lead\n#+end_src\n',
  '#+begin_src js\n    four\n  two\n      six\n#+end_src\n',
  '#+begin_src js\n    four\n\n  two\n#+end_src\n',
  '  #+begin_src js\n    four\n  #+end_src\n',
  '   #+begin_src js\n \n   a\n   #+end_src\n',
  '#+begin_src js :results output\n(ref:one) text\nfoo (ref:two)\n#+end_src\n',
  '#+begin_src js -r\nfoo (ref:two)\n#+end_src\n',
  '#+begin_src js -l "<<%s>>"\nfoo <<two>>\n#+end_src\n',
  '#+begin_src js -n 5 -k\nfoo\n#+end_src\n',
  '#+begin_src js +n 5\nfoo\n#+end_src\n',
  '#+begin_src js -i\nfoo\n#+end_src\n',
  '#+begin_src js :var a=1\n#+end_src\n',
  '#+begin_src js\nA\n#+end_src\n#+RESULTS:\n: A\n',
  '#+begin_src js\nA\n#+end_src\n\n#+RESULTS: named\n: A\n',
  '#+begin_src emacs-lisp\n(+ 1 2)\n#+end_src\n',
  '#+begin_src org\n* not a heading\n#+end_src\n',
  '#+begin_src org\n,* escaped heading\n#+end_src\n',
  '#+begin_src text\n\n\n\n#+end_src\n',
  '#+begin_src js\nlast line no newline\n#+end_src',
  '#+begin_src js\nx\n#+end_src\n\n\n\n',
  '\n\n#+begin_src js\nx\n#+end_src\n',
  '#+begin_src js\r\nx\r\n#+end_src\r\n',
  '#+begin_src js\n sep\n#+end_src\n',
  '#+begin_src js\n#+begin_src\nx\n#+end_src\n#+end_src\n',
  '#+BEGIN_SRC js\nA\n#+end_src\n',
  '#+begin_src js\nA\n#+END_SRC\n',
  '#+begin_src JS\nA\n#+end_src\n',
  '#+begin_src emacs_lisp\nA\n#+end_src\n',
  '#+begin_src c++\nA\n#+end_src\n',
  '#+begin_src sh\nA\n#+end_src\n',
  '#+begin_src {}\nA\n#+end_src\n',
  '#+begin_src js:results output\nA\n#+end_src\n',
];


// ---- noweb ------------------------------------------------------------------------------------------------------------------

const NOWEB_VALUES = ['yes', 'no', 'tangle', 'no-export', 'strip-export', 'strip-tangle', 'eval', 'yes tangle', 'tangle eval', 'nil', 'XYZ', 'Yes', 'export', 'no-export strip-tangle'];

const CHUNKS = [
  ['a', 'alpha'],
  ['b', 'one\ntwo'],
  ['c', '  indented\n    more'],
  ['d', 'x <<a>> y'],
  ['e', '<<b>>\n<<a>>'],
  ['f', ''],
  ['g', 'tail  '],
  ['h', '\nleading blank'],
  ['i', 'trailing blank\n'],
];
const HOST_BODIES = [
  '<<a>>',
  '<<b>>',
  '  <<b>>',
  '// <<b>>',
  '# <<c>>',
  'before <<a>> after',
  '<<a>> <<a>>',
  '<<a>>\n<<b>>',
  '<<d>>',
  '<<e>>',
  '<<f>>',
  'x<<f>>y',
  '<<g>> end',
  '<<h>>',
  '<<i>>',
  '<< a >>',
  '<<a >>',
  '<< a>>',
  '<<missing>>',
  '<<a>',
  '<a>>',
  '<<<a>>>',
  '<<a>><<b>>',
  '  - <<c>>',
  '<<self>>',
  '<<a(1)>>',
  '<<a()>>',
  '<<a b>>',
  'no references',
  '<<ref1>>',
  '<<ref1>>\n<<ref2>>',
  '> <<ref1>>',
];
const REF_BLOCKS = [
  '#+begin_src js :noweb-ref ref1\nfirst\n#+end_src\n\n#+begin_src js :noweb-ref ref1\nsecond\n#+end_src\n',
  '#+begin_src js :noweb-ref ref1 :noweb-sep ", "\nfirst\n#+end_src\n\n#+begin_src js :noweb-ref ref1 :noweb-sep ";"\nsecond\n#+end_src\n#+begin_src js :noweb-ref ref2\nonly\n#+end_src\n',
  '#+begin_src js :noweb-ref ref1 :noweb-sep ""\nfirst\n#+end_src\n\n#+begin_src js :noweb-ref ref1\nsecond\n#+end_src\n',
  '#+begin_src js :noweb-ref ref1 :noweb-prefix no\nfirst\nlines\n#+end_src\n',
  '#+NAME: ref2\n#+begin_src js :noweb-ref ref1\nboth\n#+end_src\n',
  '',
];
const HOST_ARGS = ['', ' :noweb yes', ' :noweb-prefix no', ' :noweb-prefix nil', ' :noweb-sep "|"', ' :noweb no-export', ' :noweb tangle'];
const CHUNK_ARGS = ['', ' :noweb yes', ' :noweb no', ' :noweb-prefix no', ' :noweb tangle', ' :noweb strip-export'];

function nowebDoc() {
  const chunks = [];
  for (const [name, body] of CHUNKS) if (R() < 0.7) chunks.push(`#+NAME: ${name}\n#+begin_src js${pick(CHUNK_ARGS)}\n${body}\n#+end_src\n`);
  const host = pick(HOST_BODIES);
  const refs = pick(REF_BLOCKS);
  const hostBlock = `${R() < 0.15 ? '#+NAME: self\n' : ''}#+begin_src ${pick(['js', 'emacs-lisp'])}${pick(HOST_ARGS)}\n${host}\n#+end_src\n`;
  const parts = [...chunks, refs, hostBlock].filter(Boolean);
  // the host is always the last block, whatever else is in the file
  return parts.join('\n');
}

// ---- tangle -----------------------------------------------------------------------------------------------------------------

const TANGLE_ARGS = ['', ':tangle yes', ':tangle no', ':tangle out.js', ':tangle sub/dir/out.txt :mkdirp yes', ':tangle out.js :shebang "#!/usr/bin/env node"', ':tangle out.sh :tangle-mode (identity #o755)',
  ':tangle out.js :padline no', ':tangle out.js :padline yes', ':tangle out.js :comments link', ':tangle out.js :comments org', ':tangle out.js :comments both', ':tangle out.js :comments noweb',
  ':tangle out.js :comments yes', ':tangle out.js :noweb yes', ':tangle out.js :noweb tangle', ':tangle out.js :noweb no', ':tangle out.js :noweb strip-tangle', ':tangle out.js :no-expand',
  ':tangle out.js :var x=5', ':tangle out.js :var x="s"', ':tangle out.js :var x=5 :var y=(+ 1 2)', ':tangle out.js :noweb-ref part', ':noweb-ref part', ':tangle other.js', ':tangle "q q.js"',
  ':tangle ./rel.js', ':tangle out.js :eval never', ':tangle out.js :session s', ':tangle out.js :results output', ':tangle out.js :exports none'];
const TANGLE_LANGS = ['js', 'javascript', 'python', 'sh', 'emacs-lisp', 'elisp', 'c', 'C', 'text', 'org', 'ruby', 'css', 'html', 'unknownlang'];
const TANGLE_BODIES = ['one', 'one\ntwo', '  indented\n  more', '<<part>>', 'before\n<<named>>\nafter', '// <<named>>', '', 'trailing  ', '\nlead', 'x\n\n\ny', 'console.log(x)', '(message "hi")'];

function tangleDoc() {
  const parts = [];
  if (R() < 0.3) parts.push(pick(['#+PROPERTY: header-args :tangle yes', '#+PROPERTY: header-args :tangle out.js', '#+PROPERTY: header-args :comments link', '#+PROPERTY: header-args:js :tangle js.js', '#+PROPERTY: header-args :mkdirp yes :tangle sub/f.txt', '#+PROPERTY: header-args :padline no']));
  const n = 1 + Math.floor(R() * 4);
  for (let i = 0; i < n; i++) {
    if (R() < 0.35) parts.push('*'.repeat(1 + Math.floor(R() * 2)) + ' ' + pick(['Setup', 'Code', 'Main part', 'A [1/2] heading', '']) + (R() < 0.2 ? '\n:PROPERTIES:\n:header-args: ' + pick([':tangle yes', ':tangle t.js', ':comments org']) + '\n:END:' : ''));
    const name = R() < 0.3 ? `#+NAME: ${pick(['named', 'part', 'other'])}\n` : '';
    parts.push(`${name}#+begin_src ${pick(TANGLE_LANGS)}${(() => { const a = pick(TANGLE_ARGS); return a ? ' ' + a : ''; })()}\n${pick(TANGLE_BODIES)}\n#+end_src`);
    if (R() < 0.2) parts.push('Some prose between blocks.');
  }
  return parts.join('\n') + '\n';
}

// ---- export -----------------------------------------------------------------------------------------------------------------

const EXPORT_ARGS = ['', ':exports code', ':exports results', ':exports both', ':exports none', ':exports nothing', ':results output', ':noweb yes', ':noweb strip-export', ':noweb no-export', ':noweb tangle',
  ':noweb yes :exports both', ':exports both :results replace', ':var a=1', ':exports results :var a=1', ':eval never', ':eval no-export :exports both', ':session s :exports both', ':tangle out.js', ':hlines yes'];
const EXPORT_RESULTS = ['', '', '#+RESULTS:\n: 42', '#+RESULTS:\n: one\n: two', '#+RESULTS:\n| a | b |\n| 1 | 2 |', '#+RESULTS:\n- x\n- y', '#+RESULTS:\n#+begin_example\nraw\n#+end_example', '#+RESULTS: named\n: by name', '\n#+RESULTS:\n: after blank', '#+RESULTS:\n:results:\ndrawer text\n:end:'];
const EXPORT_BODIES = ['(+ 1 2)', 'code\nmore code', '<<ref>>', 'x <<ref>> y', '  indented', '', '<<missing>>'];

function exportDoc() {
  const parts = [];
  if (R() < 0.2) parts.push(pick(['#+PROPERTY: header-args :exports both', '#+PROPERTY: header-args :exports results', '#+PROPERTY: header-args :noweb yes', '#+PROPERTY: header-args :exports none']));
  parts.push('#+NAME: ref\n#+begin_src js\nREFTEXT\n#+end_src');
  const n = 1 + Math.floor(R() * 3);
  for (let i = 0; i < n; i++) {
    if (R() < 0.3) parts.push('* ' + pick(['Section', 'Code [1/2]']) + (R() < 0.2 ? '\n:PROPERTIES:\n:header-args: ' + pick([':exports both', ':exports none', ':noweb yes']) + '\n:END:' : ''));
    const name = R() < 0.25 ? `#+NAME: ${pick(['named', 'b1'])}\n` : '';
    const cap = R() < 0.1 ? '#+CAPTION: A caption\n' : '';
    const a = pick(EXPORT_ARGS);
    parts.push(`${cap}${name}#+begin_src ${pick(['js', 'emacs-lisp', 'python', 'sh'])}${a ? ' ' + a : ''}\n${pick(EXPORT_BODIES)}\n#+end_src`);
    const r = pick(EXPORT_RESULTS);
    if (r) parts.push(r);
    if (R() < 0.3) parts.push('Prose line.');
  }
  return parts.join('\n') + '\n';
}

// ---- exec -------------------------------------------------------------------------------------------------------------------

const EXEC_BODIES = ['(+ 1 2)', '"text"', "'(1 2 3)", "'((1 2) (3 4))", "'((\"a\" \"b\") (1 2))", "'(\"x\" nil t)", 'nil', 't', '3.5', "'sym", '(vector 1 2)', "'(1 . 2)", '(list)', '"multi\nline"',
  '(concat "a" "b")', '(progn 1 2)', '(princ "printed")', '(print 42)', '(princ 1) (princ 2)', '(message "hi") 5', '(error "boom")', '(foo)', '(+ 1', '(let ((x 2)) (* x x))', "'hline", "'((1 2) hline (3 4))",
  '(/ 1 0)', '"a: b"', '"  lead"', "'(\"a\\nb\")", '(format "%d items" 3)', '1 2 3', '', '; just a comment', '(mapcar (lambda (x) (* x x)) (list 1 2 3))', '(number-to-string 12)', '?a', '1e3', '-0.5', '"| pipe |"', '"* star"', '"#+KEY: v"', '(list "a b" "c")', "'((a . 1) (b . 2))"];
const EXEC_ARGS = ['', ':results value', ':results output', ':results table', ':results list', ':results scalar', ':results verbatim', ':results raw', ':results org', ':results code', ':results drawer', ':results html',
  ':results latex', ':results silent', ':results none', ':results replace', ':results append', ':results prepend', ':results output raw', ':results value raw', ':results value list', ':results value verbatim',
  ':results output code', ':results output drawer', ':results value table', ':wrap quote', ':wrap example', ':wrap src js', ':results output :wrap quote', ':var x=5', ':var x="s"', ':var x=5 :var y=6', ":var l='(1 2 3)", ':hlines yes',
  ':colnames yes', ':rownames yes', ':cache yes', ':cache no', ':session', ':lexical t', ':lexical yes', ':exports both', ':eval never', ':eval no', ':eval yes', ':noweb yes', ':post foo', ':results file', ':file out.txt', ':results value :file out.txt'];
const EXEC_EXISTING = ['', '', '', '\n#+RESULTS:\n: old', '\n#+RESULTS:\n: old\n: old2', '\n#+RESULTS:\n| a |\n| b |', '\n#+RESULTS[abcdef]:\n: hashed', '\n\n#+RESULTS:\n: after blank', '\n#+RESULTS: other\n: for other', '\n#+RESULTS:\n- one\n- two', '\n#+RESULTS:\n#+begin_example\nold\n#+end_example'];

function execDoc() {
  const body = pick(EXEC_BODIES);
  const a = pick(EXEC_ARGS);
  const extra = R() < 0.25 ? pick([' :results output', ' :results table', ' :results append', ' :wrap quote']) : '';
  const name = R() < 0.3 ? `#+NAME: ${pick(['calc', 'b1'])}\n` : '';
  const head = R() < 0.25 ? `:PROPERTIES:\n:header-args:emacs-lisp: ${pick([':results output', ':results silent', ':results table', ':results append'])}\n:END:\n` : '';
  const props = R() < 0.1 ? '#+PROPERTY: header-args:emacs-lisp :results output\n' : '';
  const noweb = a.includes('noweb') && R() < 0.8 ? '#+NAME: part\n#+begin_src emacs-lisp :results silent\n(+ 10 1)\n#+end_src\n' : '';
  const hostBody = a.includes('noweb') && R() < 0.8 ? '<<part>>' : body;
  const existing = pick(EXEC_EXISTING);
  const table = a.includes('x=') || a.includes('colnames') || a.includes('rownames') || a.includes('hlines') ? '#+NAME: tbl\n| h1 | h2 |\n|----+----|\n| 1  | 2  |\n| 3  | 4  |\n\n' : '';
  const tail = R() < 0.3 ? '\nProse after.' : '';
  return `${props}* H\n${head}${table}${noweb}${name}#+begin_src emacs-lisp${a ? ' ' + a : ''}${extra}\n${hostBody}\n#+end_src${existing}${tail}\n`;
}

export function buildCases() {
  const cases = [];
  // header arguments and their inheritance, over generated documents
  for (let i = 0; i < 700; i++) cases.push({ kind: 'blocks', text: argsDoc() });
  // header-argument syntax, with and without a file-level default to merge into
  for (const s of SYNTAX) {
    cases.push({ kind: 'blocks', text: syntaxDoc('js', s) });
    cases.push({ kind: 'blocks', text: syntaxDoc('emacs-lisp', s, '#+PROPERTY: header-args :results output :var a=0\n#+PROPERTY: header-args:emacs-lisp :exports both\n#+HEADER: :var h=1\n') });
  }
  for (const t of BODY_TEXTS) cases.push({ kind: 'blocks', text: t });
  // the same texts with a header-args property above the heading holding them
  for (const t of BODY_TEXTS.slice(0, 25)) cases.push({ kind: 'blocks', text: '#+PROPERTY: header-args :results output\n' + t });
  // which :noweb values allow expansion where
  for (const value of NOWEB_VALUES) for (const context of ['tangle', 'eval', 'export']) cases.push({ kind: 'nowebp', value, context });
  // expansion of references in the last block of a text
  for (let i = 0; i < 400; i++) {
    const text = nowebDoc();
    cases.push({ kind: 'noweb', text, index: (text.match(/#\+begin_src/gi) || []).length - 1 });
  }
  // files written by tangle
  for (let i = 0; i < 400; i++) cases.push({ kind: 'tangle', text: tangleDoc(), name: 'doc.org' });
  // what the export step leaves of each block
  for (let i = 0; i < 400; i++) cases.push({ kind: 'export', text: exportDoc() });
  // an emacs-lisp block run once (the last block of the text)
  for (let i = 0; i < 500; i++) {
    const text = execDoc();
    cases.push({ kind: 'exec', text, index: (text.match(/#\+begin_src/gi) || []).length - 1 });
  }
  return cases;
}
