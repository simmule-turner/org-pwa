// @ts-check
/**
 * The inputs of test/fixtures/oracle-org-settings.json: whole Org documents for the macro expander, the file-local variables
 * (`-*-` line and Local Variables block), the `#+OPTIONS:` keyword and the `#+STARTUP:` words. Emacs 29.3 answers each.
 */

/** @type {{ kind: 'macro' | 'locals' | 'options' | 'startup', src: string }[]} */
export const CASES = [];
/** @param {'macro' | 'locals' | 'options' | 'startup'} kind @param {string[]} docs */
const add = (kind, docs) => docs.forEach((src) => CASES.push({ kind, src }));

// ---- macros ----
const uses = [
  '{{{title}}}', '{{{author}}}', '{{{email}}}', '{{{date}}}', '{{{date(%Y)}}}', '{{{date(%Y-%m-%d %a)}}}', '{{{date(%B %e)}}}', '{{{date(%H:%M)}}}',
  '{{{keyword(TITLE)}}}', '{{{keyword(title)}}}', '{{{keyword(NOPE)}}}', '{{{keyword()}}}', '{{{keyword}}}', '{{{keyword(FOO)}}}', '{{{keyword(foo)}}}',
  '{{{n}}}', '{{{n}}} {{{n}}}', '{{{n(a)}}} {{{n(a)}}} {{{n(b)}}}', '{{{n(a,-)}}}', '{{{n(a)}}}{{{n(a,-)}}}', '{{{n(a,5)}}} {{{n(a)}}}', '{{{n(a,x)}}}',
  '{{{n(a)}}}{{{n(a,0)}}}{{{n(a)}}}', '{{{n( a )}}}', '{{{n(a,  -)}}}',
  '{{{property(ID)}}}', '{{{property(x)}}}', '{{{property(X)}}}', '{{{property(NOPE)}}}', '{{{property(x,Other)}}}', '{{{property(x,#cid)}}}', '{{{property(x,Nope)}}}',
  '{{{greet}}}', '{{{greet()}}}', '{{{greet(a)}}}', '{{{greet(a,b)}}}', '{{{greet(a\\,b)}}}', '{{{greet( a , b )}}}', '{{{greet(a,b,c,d)}}}', '{{{greet(,b)}}}', '{{{greet(a,)}}}',
  '{{{two(x,y)}}}', '{{{two(x)}}}', '{{{two}}}', '{{{nested(q)}}}', '{{{noargs}}}', '{{{noargs(zzz)}}}', '{{{dollar(1)}}}', '{{{multi}}}', '{{{multi(a)}}}',
  '{{{missing}}}', '{{{missing(a)}}}', '{{{Greet(a)}}}', '{{{GREET(a)}}}', '{{{ greet(a)}}}', '{{{greet (a)}}}', '{{{greet(a)}}', '{{greet(a)}}', '{{{}}}', '{{{1a}}}', '{{{a-b}}}', '{{{a_b}}}',
  '{{{greet(a)}}} and {{{greet(b)}}}', '*{{{greet(a)}}}*', '=\u007b\u007b\u007bgreet(a)}}}=', '~{{{greet(a)}}}~', '[[{{{greet(a)}}}]]', '[[file:{{{greet(a)}}}.org]]', '[[http://x/{{{greet(a)}}}][d]]', '| {{{greet(a)}}} | x |',
  '{{{greet(a(b))}}}', '{{{greet("a,b")}}}', '{{{greet(a\\\\,b)}}}', '{{{greet(a\\b)}}}', '{{{greet(\\,)}}}', '{{{greet(a,,b)}}}', '{{{greet(a, )}}}',
  '{{{recur}}}', '{{{lisp(3)}}}', '{{{lisp(a,b)}}}', '{{{lisp}}}', '{{{lisperr}}}', '{{{lispnil}}}', '{{{lispstr(x)}}}', '{{{lispsum(2,3)}}}', '{{{lispnum}}}',
];
const defs = [
  '#+MACRO: greet Hello $1 and $2',
  '#+MACRO: two $1-$2',
  '#+MACRO: nested [{{{greet($1,z)}}}]',
  '#+MACRO: noargs plain',
  '#+MACRO: dollar $10 and $1',
  '#+MACRO: multi line one\\\\nline two $1',
  '#+MACRO: recur {{{recur}}}!',
  '#+MACRO: lisp (eval (+ 1 (string-to-number $1)))',
  '#+MACRO: lisperr (eval (error "boom"))',
  '#+MACRO: lispnil (eval nil)',
  '#+MACRO: lispstr (eval (upcase $1))',
  '#+MACRO: lispsum (eval (+ (string-to-number $1) (string-to-number $2)))',
  '#+MACRO: lispnum (eval 42)',
  '#+MACRO: x   spaced   value',
  '#+MACRO: bare',
  '#+MACRO:',
  '#+macro: lower works',
  '#+MACRO: greet again $1',
];
const header = [
  '#+TITLE: My Title', '#+AUTHOR: Jane Doe', '#+EMAIL: j@x.org', '#+DATE: <2024-03-05 Tue 14:30>', '#+FOO: one', '#+FOO: two',
];
const base = (extra = '') => [...header, ...defs, extra].join('\n');
for (const u of uses) {
  CASES.push({ kind: 'macro', src: `${base()}\n\nbefore ${u} after\n` });
}
// built-ins with various headers
const builtinDocs = [];
for (const hdr of [
  [], ['#+TITLE: T'], ['#+TITLE: A', '#+TITLE: B'], ['#+AUTHOR: X', '#+AUTHOR: Y'], ['#+DATE: 2024-03-05'], ['#+DATE: [2024-03-05 Tue]'], ['#+DATE: <2024-03-05 Tue>--<2024-03-06 Wed>'],
  ['#+DATE:'], ['#+DATE: <2024-03-05 Tue>', '#+DATE: <2024-03-06 Wed>'], ['#+DATE: July 4'], ['#+TITLE:'], ['#+TITLE: with {{{author}}}', '#+AUTHOR: Z'],
  ['#+title: lower'], ['#+Author: mixed'], ['#+EMAIL: a@b'], ['#+EMAIL: a@b', '#+EMAIL: c@d'], ['#+DATE: <2024-03-05 Tue 14:30>'],
]) {
  for (const u of ['{{{title}}}', '{{{author}}}', '{{{email}}}', '{{{date}}}', '{{{date(%Y/%m/%d)}}}', '{{{date(%A)}}}', '{{{keyword(DATE)}}}', '{{{keyword(TITLE)}}}']) builtinDocs.push(`${hdr.join('\n')}\n\ntext ${u} end\n`);
}
add('macro', builtinDocs);
// structure: headings, lists, tables, blocks, drawers
add('macro', [
  '#+MACRO: m M\n* H {{{m}}} title\n  body {{{m}}}\n',
  '#+MACRO: m M\n* H\n:PROPERTIES:\n:A: {{{m}}}\n:END:\ntext\n',
  '#+MACRO: m M\n- item {{{m}}}\n  - sub {{{m}}}\n',
  '#+MACRO: m M\n| a | {{{m}}} |\n|---+---|\n| {{{m}}} | b |\n',
  '#+MACRO: m M\n#+BEGIN_SRC sh\necho {{{m}}}\n#+END_SRC\n{{{m}}}\n',
  '#+MACRO: m M\n#+BEGIN_EXAMPLE\n{{{m}}}\n#+END_EXAMPLE\n{{{m}}}\n',
  '#+MACRO: m M\n#+BEGIN_QUOTE\n{{{m}}}\n#+END_QUOTE\n',
  '#+MACRO: m M\n#+BEGIN_VERSE\n{{{m}}}\n#+END_VERSE\n',
  '#+MACRO: m M\n#+BEGIN_COMMENT\n{{{m}}}\n#+END_COMMENT\n{{{m}}}\n',
  '#+MACRO: m M\n#+BEGIN_EXPORT html\n{{{m}}}\n#+END_EXPORT\n{{{m}}}\n',
  '#+MACRO: m M\n: fixed {{{m}}}\n{{{m}}}\n',
  '#+MACRO: m M\n# comment {{{m}}}\n{{{m}}}\n',
  '#+MACRO: m M\n#+CAPTION: cap {{{m}}}\ntext\n',
  '#+MACRO: m M\n#+NAME: n{{{m}}}\ntext\n',
  '#+MACRO: m M\n#+FOO: {{{m}}}\n{{{keyword(FOO)}}}\n',
  '#+MACRO: m M\n[fn:1] note {{{m}}}\n\ntext[fn:1]\n',
  '#+MACRO: m M\n* TODO H :tag:\nSCHEDULED: <2024-03-05 Tue> {{{m}}}\n',
  '#+MACRO: m M\n* H\n:LOGBOOK:\n- note {{{m}}}\n:END:\n',
  '#+MACRO: m M\n* H\n#+BEGIN_CENTER\n{{{m}}}\n#+END_CENTER\n',
  '#+MACRO: m M\n* H\n:MYDRAWER:\n{{{m}}}\n:END:\n',
  '#+MACRO: m M\ntext {{{m}}}\\\\\nnext {{{m}}}\n',
  '#+MACRO: m M\n* A\n:PROPERTIES:\n:x: 1\n:END:\ntext {{{property(x)}}}\n** B\ntext {{{property(x)}}}\n',
  '#+MACRO: m M\n* A\n:PROPERTIES:\n:x: 1\n:ID: abc\n:CUSTOM_ID: cid\n:END:\n* B\ntext {{{property(x,A)}}} {{{property(ID,A)}}} {{{property(x,#cid)}}}\n',
  '* A\n:PROPERTIES:\n:x: top\n:END:\n{{{property(x)}}}\n* B\n{{{property(x)}}}\n',
  '#+PROPERTY: x global\n* A\n{{{property(x)}}}\n',
  '{{{property(x)}}}\n',
  '#+MACRO: m M\n  {{{m}}}\n\n\n{{{m}}}\n',
  '#+MACRO: m M\n\t{{{m}}}\n',
  '#+MACRO: m M\r\ntext {{{m}}}\r\n',
  '#+MACRO: m \u00e9\u00e8 $1\ntext {{{m(\u4e2d\u6587)}}} \u2603\n',
  '#+MACRO: m $1$1$1\ntext {{{m(ab)}}}\n',
  '#+MACRO: m a\\nb\ntext {{{m}}}\n',
  '#+MACRO: m \\$1 $1\ntext {{{m(z)}}}\n',
  '#+MACRO: m $$1\ntext {{{m(z)}}}\n',
  '#+MACRO: m $0 $1\ntext {{{m(z)}}}\n',
  '#+MACRO: m $a\ntext {{{m(z)}}}\n',
  '#+MACRO: m ${1}\ntext {{{m(z)}}}\n',
  '#+MACRO: m $ 1\ntext {{{m(z)}}}\n',
  '#+MACRO: m a\n#+MACRO: m b\ntext {{{m}}}\n',
  '#+MACRO: title mine\ntext {{{title}}}\n',
  '#+MACRO: n mine\ntext {{{n}}} {{{n(a)}}}\n',
  '#+MACRO: date mine\n#+DATE: x\ntext {{{date}}}\n',
  '#+MACRO: keyword mine\ntext {{{keyword(TITLE)}}}\n',
  '#+MACRO: property mine\ntext {{{property(x)}}}\n',
  '#+MACRO: a {{{b}}}\n#+MACRO: b {{{a}}}\ntext {{{a}}}\n',
  '#+MACRO: a {{{b($1)}}}\n#+MACRO: b <$1>\ntext {{{a(x)}}}\n',
  '#+MACRO: a {{{b(1,2)}}}\n#+MACRO: b $2$1\ntext {{{a}}}\n',
  '#+MACRO: a ($1)\ntext {{{a(x,y)}}}\n',
  '#+MACRO: a $1\ntext {{{a(  spaced  )}}}\n',
  '#+MACRO: a $1|$2\ntext {{{a( x , y )}}}\n',
  '#+MACRO: a $1\ntext {{{a(x\ny)}}}\n',
  '#+MACRO: a (eval (concat "<" $1 ">"))\ntext {{{a(x)}}} {{{a}}}\n',
  '#+MACRO: a (eval (format "%s-%s" $1 $2))\ntext {{{a(x,y)}}} {{{a(x)}}}\n',
  '#+MACRO: a (eval (number-to-string (* 2 (string-to-number $1))))\ntext {{{a(21)}}}\n',
  '#+MACRO: a (eval (mapconcat (quote identity) (list $1 $2) "+"))\ntext {{{a(p,q)}}}\n',
  '#+MACRO: a (eval (if $1 "yes" "no"))\ntext {{{a(x)}}} {{{a}}}\n',
  '#+MACRO: a (eval (length $1))\ntext {{{a(hello)}}}\n',
  '#+MACRO: a (eval (symbol-name (quote foo)))\ntext {{{a}}}\n',
  '#+MACRO: a (eval (list 1 2))\ntext {{{a}}}\n',
  '#+MACRO: a (eval t)\ntext {{{a}}}\n',
  '#+MACRO: a (eval "str")\ntext {{{a}}}\n',
  '#+MACRO: a (eval 1.5)\ntext {{{a}}}\n',
  '#+MACRO: a (eval (progn))\ntext {{{a}}}\n',
  '#+MACRO: a (eval (car 5))\ntext {{{a}}}\n',
  '#+MACRO: a (eval (undefined-fn))\ntext {{{a}}}\n',
  '#+MACRO: a (eval (+ 1\ntext {{{a}}}\n',
  '#+MACRO: a (eval) tail\ntext {{{a}}}\n',
  '#+MACRO: a (evaluate 1)\ntext {{{a}}}\n',
  '#+MACRO: a (eval 1) trailing\ntext {{{a}}}\n',
  '#+MACRO: a  (eval 1)\ntext {{{a}}}\n',
]);
// lisp macros that use $-vars many times
for (const body of ['(+ 1 2)', '(string-to-number "12")', '(format "%03d" 7)', '(upcase "abc")', '(concat "a" "b")', '(substring "hello" 1 3)', '(/ 1 0)', '(list "a" "b")', '(quote (1 . 2))', '(if t 1 2)', '(let ((x 3)) (* x x))', '(mapcar (lambda (x) (* x x)) (list 1 2 3))', '(format-time-string "%Y" (encode-time 0 0 0 1 1 2020))', '(org-link-make-string "http://x" "d")', '(string-join (list "a" "b") ", ")', '(or nil "fallback")', '(identity $1)', '(string-to-number $1)', '(format "%S" $1)', '(format "%s" $2)', '(length (or $1 ""))']) {
  add('macro', [`#+MACRO: m (eval ${body})\ntext {{{m(7,8)}}} end\n`, `#+MACRO: m (eval ${body})\ntext {{{m}}} end\n`]);
}

// ---- file-local variables ----
add('locals', [
  '', '* a\n', '# -*- fill-column: 40 -*-\n', '# -*- fill-column: 40; tab-width: 4 -*-\n', '-*- fill-column: 40 -*-\n', ';; -*- fill-column: 40 -*-\n', '#+TITLE: x -*- fill-column: 40 -*-\n',
  '# -*- mode: org -*-\n', '# -*- mode: org; fill-column: 40 -*-\n', '# -*- fill-column: 40; mode: org -*-\n', '# -*- org -*-\n', '# -*- Org -*-\n', '# -*- fill-column:40;tab-width:4-*-\n',
  '# -*- fill-column: 40;; tab-width: 4 -*-\n', '# -*- fill-column: 40; -*-\n', '# -*- ; -*-\n', '# -*- -*-\n', '# -*-   fill-column  :  40   -*-\n', '# -*- fill-column: abc -*-\n',
  '# -*- foo: "a;b" -*-\n', '# -*- foo: (a b) -*-\n', '# -*- foo: \'(a b) -*-\n', '# -*- foo: nil -*-\n', '# -*- foo: t -*-\n', '# -*- foo: 1.5 -*-\n', '# -*- foo: -3 -*-\n', '# -*- foo: bar -*-\n', '# -*- foo: "x" -*-\n',
  '# -*- foo: 1; foo: 2 -*-\n', '# -*- Foo: 1 -*-\n', '# -*- foo-bar: 1 -*-\n', '# -*- foo_bar: 1 -*-\n', '# -*- foo.bar: 1 -*-\n', '# -*- foo: [1 2] -*-\n', '# -*- foo: ?a -*-\n', '# -*- foo: #x10 -*-\n',
  '# -*- eval: (message "x") -*-\n', '# -*- coding: utf-8 -*-\n', '# -*- lexical-binding: t -*-\n', '# -*- coding: utf-8; org-startup-folded: content -*-\n',
  '\n# -*- fill-column: 40 -*-\n', '* a\n# -*- fill-column: 40 -*-\n', '#!/bin/sh\n# -*- fill-column: 40 -*-\n', '#!/bin/sh -*- fill-column: 40 -*-\n',
  '# -*- fill-column: 40 -*- junk\n', 'junk -*- fill-column: 40 -*-\n', '# -*- fill-column: 40 -*- -*- tab-width: 4 -*-\n', '# -*- a: 1 -*- x -*- b: 2 -*-\n',
  '# Local Variables:\n# fill-column: 40\n# End:\n', '# Local Variables:\n# fill-column: 40\n', '# Local Variables:\n# End:\n', '* a\n# Local Variables:\n# fill-column: 40\n# tab-width: 4\n# End:\n',
  '# local variables:\n# fill-column: 40\n# end:\n', '# LOCAL VARIABLES:\n# fill-column: 40\n# END:\n', '#  Local Variables:\n#  fill-column: 40\n#  End:\n', '# Local Variables:\n#fill-column: 40\n# End:\n',
  '# Local Variables:\n# fill-column : 40\n# End:\n', '# Local Variables:\n# fill-column:40\n# End:\n', '# Local Variables:\n# fill-column:   40   \n# End:\n', '# Local Variables:\n# fill-column: 40 ; tab-width: 4\n# End:\n',
  '# Local Variables:\n# foo: "a b"\n# End:\n', '# Local Variables:\n# foo: (a b c)\n# End:\n', '# Local Variables:\n# foo: \'(a b c)\n# End:\n', '# Local Variables:\n# foo: (a\n# b)\n# End:\n',
  '# Local Variables:\n# foo: 1\n# foo: 2\n# End:\n', '# Local Variables:\n# foo: 1\n# bar: 2\n# End:\n', '# Local Variables:\n# mode: org\n# End:\n', '# Local Variables:\n# mode: text\n# End:\n', '# Local Variables:\n# eval: (setq x 1)\n# End:\n',
  '# Local Variables:\n# coding: utf-8\n# End:\n', '# Local Variables:\n# foo: nil\n# End:\n', '# Local Variables:\n# foo: t\n# End:\n', '# Local Variables:\n# foo:\n# End:\n', '# Local Variables:\n# : 1\n# End:\n',
  '# Local Variables:\n# foo: 1\n#\n# bar: 2\n# End:\n', '# Local Variables:\n# foo: 1\n\n# bar: 2\n# End:\n', '# Local Variables:\n# foo: 1\ntext\n# bar: 2\n# End:\n', '# Local Variables:\n# foo: 1\n# End:\n# bar: 2\n',
  '# Local Variables:\n# foo: "multi\n# line"\n# End:\n', '# Local Variables:\n# foo: a\\\n# b\n# End:\n', '# Local Variables:\n# foo: 1 ;; comment\n# End:\n', '# Local Variables:\n# foo: "unterminated\n# End:\n', '# Local Variables:\n# foo: (unterminated\n# End:\n',
  '# Local Variables:\n# fill-column: 40\n# End:\n# Local Variables:\n# tab-width: 4\n# End:\n', '# Local Variables:\n# a: 1\n# End:\ntext\n# Local Variables:\n# b: 2\n# End:\n', '# -*- a: 1 -*-\n# Local Variables:\n# b: 2\n# End:\n', '# -*- a: 1 -*-\n# Local Variables:\n# a: 2\n# End:\n',
  ';; Local Variables:\n;; fill-column: 40\n;; End:\n', '% Local Variables:\n% fill-column: 40\n% End:\n', 'Local Variables:\nfill-column: 40\nEnd:\n', '/* Local Variables: */\n/* fill-column: 40 */\n/* End: */\n', '# Local Variables: #\n# fill-column: 40 #\n# End: #\n',
  '# Local Variables:\n# org-agenda-start-on-weekday: 0\n# org-cycle-open-archived-trees: t\n# End:\n', '# Local Variables:\n# org-todo-keywords: ((sequence "A" "B"))\n# End:\n', '# Local Variables:\n# org-tag-alist: (("a" . ?a))\n# End:\n',
  '# Local Variables:\n# org-startup-folded: content\n# End:\n', '# Local Variables:\n# org-log-done: \'time\n# End:\n', '# Local Variables:\n# org-log-done: (quote time)\n# End:\n', '# Local Variables:\n# fill-column: 4o\n# End:\n',
  '# Local Variables:\n# foo: ?\\C-a\n# End:\n', '# Local Variables:\n# foo: "\\n"\n# End:\n', '# Local Variables:\n# foo: "é"\n# End:\n', '# Local Variables:\n# foo: ;\n# End:\n', '# Local Variables:\n# foo: ,x\n# End:\n', '# Local Variables:\n# foo: `(a ,b)\n# End:\n',
  '# Local Variables:\n# foo: 1 2\n# End:\n', '# Local Variables:\n# foo: )\n# End:\n', '# Local Variables:\n# 1foo: 1\n# End:\n', '# Local Variables:\n# foo bar: 1\n# End:\n', '# Local Variables:\n# foo:: 1\n# End:\n',
  '# Local Variables:\r\n# fill-column: 40\r\n# End:\r\n', '\t# Local Variables:\n\t# fill-column: 40\n\t# End:\n', '  # Local Variables:\n  # fill-column: 40\n  # End:\n', '# Local Variables:\n  # fill-column: 40\n# End:\n',
]);

// ---- #+OPTIONS ----
const optionWords = ['toc:t', 'toc:nil', 'toc:2', 'toc:0', 'toc:10', 'toc:-1', 'toc:1.5', 'toc:abc', 'toc:', 'toc:headlines', 'toc:T', 'toc:NIL', 'toc:(a)', 'num:t', 'num:nil', 'num:2', 'num:0', 'num:abc', 'num:', 'num:-1', 'author:t', 'author:nil', 'author:foo', 'author:', 'date:t', 'date:nil', 'date:foo', 'date:', 'creator:t', 'creator:nil', 'creator:comment', 'creator:foo', 'creator:', 'creator:T', '^:t', '^:nil', '^:{}', '^:foo', '^:', "':t", "':nil", '*:nil', '-:nil', '::nil', '\\n:t', 'e:nil', 'f:nil', 'p:t', 'pri:t', 'tags:nil', 'tags:not-in-toc', 'todo:nil', 'tasks:nil', 'tasks:todo', 'tasks:("A")', 'tex:nil', 'tex:verbatim', 'title:nil', 'email:t', 'stat:nil', 'inline:nil', 'broken-links:t', 'broken-links:mark', 'broken-links:nil', 'broken-links:foo', 'broken-links:', 'timestamp:nil', 'html-postamble:nil', 'd:nil', 'd:(not "LOGBOOK")', 'd:("A" "B")', 'd:t', 'H:3', 'H:0', 'arch:headline', 'arch:nil', 'c:t', 'prop:t', 'prop:("a")', 'unknown:1', 'toc:2 num:nil', 'toc:nil toc:3', 'num:nil  author:nil', 'toc:2\tnum:nil', 'toc:2  ', '  toc:2', 'toc:2num:nil', 'toc: 2', 'toc :2', 'TOC:2', 'Toc:2', 'toc:2:3', 'toc::2', ':2', ':', 'toc', 'nil', 'toc:2 garbage num:nil', 'toc:"2"', 'toc:2,', '^:{} num:nil toc:1 author:nil date:nil creator:t', 'broken-links:mark toc:3'];
add('options', optionWords.map((w) => `#+OPTIONS: ${w}\n`));
add('options', [
  '', '#+OPTIONS:\n', '#+OPTIONS: \n', '#+OPTIONS: toc:2\n#+OPTIONS: num:nil\n', '#+OPTIONS: toc:2\n#+OPTIONS: toc:nil\n', '#+OPTIONS: toc:nil\n#+OPTIONS: toc:3\n', '#+options: toc:2\n', '#+Options: toc:2\n',
  '* h\n#+OPTIONS: toc:2\n', 'text\n#+OPTIONS: toc:2\n', '#+OPTIONS: toc:2 num:nil\n#+OPTIONS: author:nil\n', '#+OPTIONS: toc:2\ntext\n#+OPTIONS: num:nil\n', '#+OPTIONS: ^:{} ^:nil\n', '#+OPTIONS: author:nil author:t\n',
  '#+OPTIONS: toc:2 toc:\n', '#+OPTIONS: toc:\n#+OPTIONS: toc:2\n', '#+OPTIONS: toc:2 \\\n  num:nil\n', '  #+OPTIONS: toc:2\n', '#+OPTIONS:toc:2\n', '#+OPTIONS:\ttoc:2\n', '#+BEGIN_SRC org\n#+OPTIONS: toc:2\n#+END_SRC\n',
  '#+BEGIN_EXAMPLE\n#+OPTIONS: toc:2\n#+END_EXAMPLE\n', '# #+OPTIONS: toc:2\n', ': #+OPTIONS: toc:2\n',
]);

// ---- #+STARTUP ----
const startWords = ['overview', 'content', 'showall', 'showeverything', 'show2levels', 'show3levels', 'show4levels', 'show5levels', 'show6levels', 'show1levels', 'inlineimages', 'noinlineimages', 'logdone', 'lognotedone', 'nologdone', 'logrepeat', 'lognoterepeat', 'nologrepeat', 'logdrawer', 'nologdrawer', 'logstatesreversed', 'nologstatesreversed', 'logreschedule', 'nologreschedule', 'lognotereschedule', 'logredeadline', 'lognoteredeadline', 'logrefile', 'lognoterefile', 'nologrefile', 'logdone logdrawer', 'indent', 'noindent', 'hidestars', 'showstars', 'odd', 'oddeven', 'hideblocks', 'nohideblocks', 'hidedrawers', 'nohidedrawers', 'entitiespretty', 'entitiesplain', 'fninline', 'nofninline', 'fnadjust', 'nofnadjust', 'fnauto', 'fnconfirm', 'fnplain', 'latexpreview', 'nolatexpreview', 'customtime', 'constcgs', 'constSI', 'align', 'noalign', 'shrink', 'noshrink', 'beamer', 'bogus', 'OVERVIEW', 'Content', 'LogDone', 'overview content', 'content overview', 'showall overview', 'overview showall', 'inlineimages noinlineimages', 'noinlineimages inlineimages', 'logdone lognotedone', 'lognotedone nologdone', 'nologdone logdone', 'overview bogus logdone', '  overview  ', 'overview\tcontent', 'overview,content', 'overview;content', 'show2levels show3levels', 'show3levels overview', 'logrepeat lognoterepeat nologrepeat', 'logdrawer nologdrawer logdrawer', 'nologdrawer logdrawer', 'lognoterepeat logrepeat', 'inlineimages logdone overview logdrawer logrepeat', ''];
add('startup', startWords.map((w) => `#+STARTUP: ${w}\n`));
add('startup', [
  '', '* h\n', '#+STARTUP: overview\n#+STARTUP: content\n', '#+STARTUP: content\n#+STARTUP: overview\n', '#+STARTUP: overview logdone\n#+STARTUP: nologdone\n', '#+STARTUP: logdone\n#+STARTUP: show3levels\n', '#+startup: overview\n', '#+Startup: overview\n',
  '* h\n#+STARTUP: overview\n', 'text\n#+STARTUP: overview\n', '#+STARTUP: overview\n\n#+BEGIN_SRC org\n#+STARTUP: content\n#+END_SRC\n', '#+STARTUP:\n#+STARTUP: content\n', '  #+STARTUP: content\n', '#+STARTUP:content\n', '# #+STARTUP: content\n',
  '#+STARTUP: logdrawer\n#+STARTUP: logrepeat\n#+STARTUP: lognoterepeat\n', '#+STARTUP: lognotedone\n#+STARTUP: logdone\n',
]);
