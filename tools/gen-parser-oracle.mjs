#!/usr/bin/env node
/**
 * Writes test/fixtures/parser-oracle.json: how Org's parser (org-element, Emacs 29.3) cuts a text into elements -- paragraphs, lists
 * and their items (bullet, checkbox, counter, tag), tables (org and table.el), blocks, dynamic blocks, drawers, fixed-width lines, rules,
 * LaTeX environments, footnote definitions, keywords -- over a corpus of small texts (each alone, after a paragraph, and before one).
 * test/parser-oracle.test.js holds parseElements (src/org-elements.js) and parseBody (src/body-parser.js) to it; the outline code is in
 * test/support/parser-skeleton.js.
 *
 *   node tools/gen-parser-oracle.mjs        (needs emacs on the PATH)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emacsOutline, emacsSignature, emacsCoarse } from '../test/support/parser-skeleton.js';

const S=[];
const L=(s)=>s.split('|||').forEach(x=>S.push(x.replace(/\\n/g,'\n').replace(/\\t/g,'\t')));
L(String.raw`- a|||- a\n- b|||+ a|||  * a|||  * a\n  * b|||1. a|||1) a|||a. a|||A) a|||a) a|||10. a|||- |||-|||-a|||- a\n  b|||- a\nb|||- a\n\n  b|||- a\n\nb|||- a\n\n\nb|||- a\n  - b|||- a\n - b|||- a\n- b\n  - c\n- d|||- [ ] a|||- [X] a|||- [x] a|||- [-] a|||- [] a|||- [ ]a|||- [ ]|||1. [@3] a|||1. [@3] [ ] a|||- [@a] x|||- tag :: d|||- tag ::|||- tag :: |||-  :: d|||- a :: b :: c|||- a::b|||- a ::b|||+ [ ] a :: b|||- a\n  1. b\n  - c|||\t- a|||- a\n\t- b|||-\ta|||- a\n  #+begin_src x\n  y\n  #+end_src|||- a\n#+begin_src x\ny\n#+end_src|||- a\n  | a |\n  | b ||||- a\n  : x|||- a\n  :PROP:\n  x\n  :END:|||- a\n\n  - b\n\n  - c|||1. a\n2. b\n   1. c|||1. a\n  2. b|||- a\n-b|||- a\n  \n  b|||- a\n   \n- b|||- -----|||- a\n-----|||- a\n  -----|||- a\n* h|||1. a\n  b|||1. a\n   b|||- a\n    b|||- a\n  b\n c|||- a\n c|||- [fn:1] x|||- a [fn:1]|||1.a|||1.  a|||1.\ta|||1. |||1.|||2. a\n1. b|||- a\n+ b|||- a\n1. b|||1. a\n- b|||- a\n\n\n- b|||- a\n\n\n\n- b|||- a\n\n\n\n  b|||- #+begin_src\n- x\n- #+end_src|||- a\n:END:|||- :: x|||- a ::\n  b|||- *a* :: b|||- [[a]] :: b|||- - a|||- + a|||- 1. a|||1. - a|||- [ ] - a|||- tag :: - a|||- a\n  - b\n    - c\n  - d\n- e|||- a\n - b\n  - c|||* a\n- b|||- a\n  [fn:1] b|||- a\n\n  [fn:1] b|||- a\n#+KEY: v|||- a\n  #+KEY: v|||- a\n  # c|||- a\n# c|||- a\n\n# c|||- a\n  -----\n- b|||- a\n  \\begin{x}\n  y\n  \\end{x}|||- [ ] a\n- [X] b\n- [-] c|||- a\n  - [ ] b|||1. [@1] a|||1) [@2] a|||- a\n\n\n\n\n- b|||* a|||*|||+|||+ |||1)|||a.|||A.|||a. |||ab. c|||1.2. x|||- a\n  1. b|||- a\n  2. b|||- a\n\n  2. b`);
const T=['| a |','| a | b |','|a|b|','| a','|-','|-+-','|---|---|','| a |\n|---|\n| b |','| a |\n\n| b |','  | a |','| a |\n#+TBLFM: $1=1','| a |\n\n#+TBLFM: $1=1','#+TBLFM: $1=1','| a |\n#+TBLFM: $1=1\n#+TBLFM: $2=2','#+NAME: t\n| a |','#+CAPTION: c\n| a |','#+ATTR_HTML: :a b\n| a |','| a |\ntext','| a |\n- b','|','||','| |','| a |  ','table.el: +---+\n| a |\n+---+','+---+\n| a |\n+---+','+---+---+\n| a | b |\n+---+---+','| a | b\n| c |','| a\\|b |','| =a|b= |','| a |x','|a |','| a | \n| b |','|- |','|-a|','| - |','|\n|','| a |\n#+TBLFM: $1=1\ntext','#+TBLFM: x\n| a |','| a |\n# c\n| b |','| a |\n#+KEY: v\n| b |','| a |\n\n\n| b |','- a\n  | b |\n  | c |','- a\n| b |','| a | [[l','| \\alpha | *b* |','| a |\n:D:\nb\n:END:','|a|\n|-|\n|b|','| a |\n|- |\n| b |','|---+---|','| a |\n|---|---|\n| b | c |','| a |\n|---|\n|---|\n| b |','|-----|\n| a |','| a |\n|-----|','| a | b |\n|---+---|\n| c | d | e |','| | |','| | a |','|\t|','|a\t|','|\ta|','  |a|\n|b|','|a|\n  |b|','| a |\n\n#+TBLFM: $1=1\n#+TBLFM: $2=2','| a |\n#+tblfm: $1=1','| a |\n#+TBLFM:','#+NAME: t\n#+CAPTION: c\n| a |','#+PLOT: x\n| a |','| a |\n#+TBLFM: $1=1\n| b |'];
for(const t of T) S.push(t);
L(String.raw`#+begin_src x\ny\n#+end_src|||#+BEGIN_SRC x\ny\n#+END_SRC|||#+begin_src\n#+end_src|||#+begin_src|||#+begin_src x\ny|||#+begin_src x\ny\n#+end_example|||#+begin_example\na\n#+end_example|||#+begin_quote\na\n#+end_quote|||#+begin_center\n#+end_center|||#+begin_verse\na\n#+end_verse|||#+begin_comment\na\n#+end_comment|||#+begin_export html\n<b>\n#+end_export|||#+begin_foo\na\n#+end_foo|||#+begin_foo bar baz\na\n#+end_foo|||#+begin_FOO\na\n#+end_foo|||#+begin_\na\n#+end_|||#+begin_quote\n#+begin_src x\ny\n#+end_src\n#+end_quote|||#+begin_src x\n#+begin_src y\n#+end_src|||#+begin_src x\n* h\n#+end_src|||  #+begin_src x\n  y\n  #+end_src|||#+begin_src x\n,* y\n#+end_src|||#+begin_src x\n,#+end_src\n#+end_src|||#+begin_src x :tangle y\n#+end_src|||#+begin_src x -n 5 :a b\n#+end_src|||#+begin_src x\n\n\n#+end_src|||#+begin_src x\ny\n#+end_src\n\n\nz|||#+begin_src x\ny\n#+end_src\nz|||#+begin_src x\ny\n#+end_src z|||#+begin_src x\ny\n  #+end_src|||#+begin_src x\ny\n#+end_src  |||#+end_src|||#+begin_srcx\n#+end_srcx|||#+beginsrc|||#+begin src|||#+begin_src x\ny\n#+end_src\n#+begin_src x\nz\n#+end_src|||#+NAME: n\n#+begin_src x\ny\n#+end_src|||#+begin_example\n#+begin_example\n#+end_example|||#+begin_dummy|||#+BEGIN: clocktable :scope file\n#+END:|||#+begin: foo\n#+end:|||#+BEGIN: foo\nbar|||#+BEGIN:|||#+BEGIN: \n#+END:|||#+begin_comment x\n#+end_comment|||#+begin_src x\n#+end_src\n#+RESULTS:\n: a|||#+RESULTS:\n: a|||#+RESULTS: n\n: a|||#+begin_quote\na\n\nb\n#+end_quote|||#+begin_quote\n- a\n#+end_quote|||#+begin_center\n| a |\n#+end_center|||#+begin_verse\n  a\n b\n#+end_verse|||#+begin_src x\n  a\n   b\n#+end_src|||#+begin_example\n:a:\n#+end_example|||#+begin_src\n#+end_SRC|||#+begin_Src x\n#+end_sRc|||#+begin_src x\n\\begin{a}\n#+end_src|||#+begin_src x\n- a\n#+end_src|||#+begin_src x\n#+KEY: v\n#+end_src|||a\n#+begin_src x\ny\n#+end_src|||a\n#+end_src|||#+begin_src x\ny\n#+end_src\n#+end_src|||#+begin_special\n#+begin_special\na\n#+end_special\n#+end_special|||#+begin_quote\n#+begin_quote\na\n#+end_quote|||#+begin_src x\ny\n#+end_src\n  |||#+begin_src x\ny\n#+end_src\n\n  \n|||#+begin_export\n#+end_export|||#+begin_export a b\n#+end_export|||#+begin_src x :var a=\"b\"\n#+end_src|||#+begin_src\tx\n#+end_src|||#+begin_src  x  \n#+end_src  `);
L(String.raw`:D:\na\n:END:|||:d:\na\n:end:|||:D:\n:END:|||:D:|||::|||:D:\na|||:D: \na\n:END:|||:D:\na\n:END: |||  :D:\n a\n :END:|||:D:\n:D2:\nx\n:END:\n:END:|||:D:\n#+begin_src\n:END:\n#+end_src\n:END:|||:D-x_y:\na\n:END:|||:D x:\na\n:END:|||:D:x\na\n:END:|||:PROPERTIES:\n:a: 1\n:END:|||:LOGBOOK:\n:END:|||:D:\n\n\n:END:\n\nx|||a\n:D:\nb\n:END:|||- a\n  :D:\n  b\n  :END:|||:D:\n* h\n:END:|||:END:|||:D:\n:END:\n:END:|||:1:\n:END:|||:a b:\n:END:|||:D::\n:END:|||: D:\n:END:|||:D:\n- a\n:END:|||:D:\n| a |\n:END:|||:D:\n:END:\n\n:E:\n:END:|||:D:\n:E:\n:END:|||:D:\na\n:END:\nb|||:D:\na\n:END:\n\nb|||:D:\n\n:END:|||:D:  \n:END:|||:é:\n:END:|||:a-b:\n:END:|||:a_b:\n:END:|||:a+b:\n:END:|||:a.b:\n:END:`);
L(String.raw`#+KEY: v|||#+KEY:v|||#+KEY:|||#+KEY: v |||#+key: v|||#+KEY-A: v|||#+KEY_A: v|||#+KEY A: v|||#+:|||#+ KEY: v|||# c|||#c|||#|||# |||#  c|||  # c|||#+|||#+ |||#+KEY: v\n#+KEY2: w|||#+TITLE: x\n\ny|||#+CAPTION: c\ny|||#+CAPTION: c\n\ny|||#+NAME: n\n- a|||#+NAME: n\n:D:\n:END:|||#+NAME: n\n#+CAPTION: c\ny|||#+name: n\ny|||#+CAPTION[s]: c\ny|||#+ATTR_X: y\ny|||#+RESULTS[hash]: n\n: a|||#+HEADER: :a b\n#+begin_src x\n#+end_src|||#+HEADERS: a\ny|||#+PLOT: x\n| a ||||#+CALL: f()|||#+call: f(1)|||#+CALL:|||#+INCLUDE: "f"|||#+HTML: x|||#+html: x|||#+LATEX: x|||#+MACRO: m v|||#+SETUPFILE: f|||#+OPTIONS: a:b|||#+STARTUP: a|||#+bibliography: x|||#+TODO: A B|||#+KEY: v\n\n#+KEY: w|||#+KEY: v\n# c|||# c\n#+KEY: v|||# a\n# b|||# a\n\n# b|||# a\n\n\nb|||# a\nb|||b\n# a|||b\n\n# a|||- x\n# a|||- x\n  # a|||#+KEY: v\n- a|||#+KEY: v\nb|||#+CAPTION: a\n#+CAPTION: b\nc|||#+NAME: a\n#+NAME: b\nc|||#+CAPTION: a\n\n\nc|||#+NAME: n|||#+NAME: n\n|||#+NAME: n\n\n|||#+CAPTION: [[l][d]] *b*\nx|||#+CAPTION[a *b*]: c\nx|||#+ATTR_HTML: :a b\n#+ATTR_HTML: :c d\nx|||#+KEY:\tv|||#+KEY:  v|||#+KEY: a b  c|||  #+KEY: v|||\t#+KEY: v|||#+KEY: v\\n|||#+ATTR_LATEX:|||#+ATTR_:x|||#+KEY[o]: v|||#+KEY[]: v|||#+RESULTS[]:|||#+results:|||#+Results: x|||#+HEADER:|||#+header: :a b`);
L(String.raw`: a|||:a|||:  a|||:\n||| : a|||  :  a\n  : b|||: a\n\n: b|||: a\n: b\ny|||-----|||------|||----|||- ----|||  -----|||-----  |||-----a|||-- ---|||_____|||=====|||\\begin{a}\nb\n\\end{a}|||\\begin{a}\n\\end{a}|||\\begin{a}\nb|||\\begin{a*}\nb\n\\end{a*}|||\\BEGIN{a}\nb\n\\END{a}|||\\begin{a}\nb\n\\end{b}|||\\begin{a}b\\end{a}|||\\begin{a}\nb\n\\end{a} x|||\\begin{a}\nb\n\\end{a}\n\nc|||  \\begin{a}\n  b\n  \\end{a}|||\\begin{a b}\nx\n\\end{a b}|||\\begin{a-b}\nx\n\\end{a-b}|||\\begin{a1}\nx\n\\end{a1}|||\\begin{}\nx\n\\end{}|||\\begin{a}\n\n\n\\end{a}|||\\begin{a}\nb\n\\end{a}  |||\\begin{a}\n\\begin{a}\n\\end{a}\n\\end{a}|||\\begin{a}\n- x\n\\end{a}|||\\begin{a}\n* x\n\\end{a}|||\\begin{a}\n#+begin_src\n\\end{a}|||\\begin{a} \nb\n\\end{a}|||\\begin{a}x\n\\end{a}|||\\begin{equation}\na\n\\end{equation}`);
L(String.raw`[fn:1] a|||[fn:1]|||[fn:1]a|||[fn:1] a\nb|||[fn:1] a\n\nb|||[fn:1] a\n\n\nb|||[fn:1] a\n[fn:2] b|||[fn:1] a\n\n[fn:2] b|||  [fn:1] a|||[fn:a_b-c] x|||[fn:a b] x|||[fn:] x|||[fn::x] y|||[fn:a:b] y|||[FN:1] a|||[fn:1] a\n- b|||[fn:1] - b|||[fn:1] #+begin_src\n#+end_src|||[fn:1]\n#+begin_src x\ny\n#+end_src|||[fn:1] a\n* h|||[fn:1] a\n** b|||[fn:1] a\n#+KEY: v|||[fn:1] a\n:D:\n:END:|||[fn:1] a\n| t ||||[fn:1] a\n\n  b|||[fn:1] a\n  b|||[fn:é] x|||[fn:1] a\n\n\n\nb|||[fn:1] a\n-----|||[fn:1] a\n\\begin{x}\ny\n\\end{x}|||[fn:1] [fn:2] b|||[fn:1]\n[fn:2] b|||[fn:1] \n|||[fn:1]  a|||[fn:1]\ta|||[fn:1] | a ||||[fn:1] : a|||[fn:1] # c|||[fn:1] #+KEY: v|||[fn:1] 1. a|||[fn:1] :D:\n:END:|||[fn:1] \\begin{x}\n\\end{x}|||[fn:1] -----|||[fn:1] a\n# c\nb|||[fn:1] a\n: b|||[fn:1] a\n[fn:2] b\n[fn:3] c|||[fn:1] a\n  - b|||[fn:1] a\n- b\n- c|||[fn:1] [fn:1]|||a [fn:1] b|||x\n[fn:1] a`);
L(String.raw`CLOCK: [2020-01-01 Wed 10:00]|||CLOCK: [2020-01-01 Wed 10:00]--[2020-01-01 Wed 11:00] =>  1:00|||CLOCK: <2020-01-01 Wed 10:00>|||clock: [2020-01-01 Wed 10:00]|||  CLOCK: [2020-01-01 Wed 10:00]|||CLOCK:|||CLOCK: x|||%%(diary-date 1 1 2020)|||%%(foo|||  %%(a)|||%%(a) b|||%%a|||SCHEDULED: <2020-01-01 Wed>|||DEADLINE: <2020-01-01 Wed>|||CLOSED: [2020-01-01 Wed]|||  SCHEDULED: <2020-01-01 Wed>|||a\nSCHEDULED: <2020-01-01 Wed>|||p\n\nSCHEDULED: <2020-01-01 Wed>|||CLOCK: [2020-01-01 Wed 10:00]\nCLOCK: [2020-01-01 Wed 11:00]|||CLOCK: [2020-01-01 Wed 10:00]\nx|||x\nCLOCK: [2020-01-01 Wed 10:00]|||%%(a)\n%%(b)|||%%(a)\nx|||x\n%%(a)|||CLOCK: [2020-01-01 Wed 10:00]--[2020-01-01 Wed 11:00]|||CLOCK: [2020-01-01 Wed 10:00]--[2020-01-01 Wed 11:00] => 1:00|||CLOCK: [2020-01-01 Wed 10:00]--[2020-01-01 Wed 11:00] =>  1:0|||CLOCK: [2020-01-01 Wed]|||CLOCK: [2020-01-01]|||CLOCK: [x]`);
L(String.raw`a\nb|||a\n\nb|||a\n#+KEY: v\nb|||a\n# c\nb|||a\n: x\nb|||a\n- x|||a\n1. x|||a\n| t ||||a\n#+begin_src x\ny\n#+end_src|||a\n:D:\nb\n:END:|||a\n-----|||a\n\\begin{x}\ny\n\\end{x}|||a\n[fn:1] b|||a\n* h|||a\n  - x|||a\n   * x|||a  \n  b|||  a\n  b|||  a\n b|||a\n\n\n\nb|||a\n \nb|||a\n\t\nb|||a\\\\\nb|||a\n#+NAME: n\nb|||a\n#+CAPTION: x\nb|||a\n#+RESULTS:\nb|||a\n#+end_src\nb|||a\nCLOCK: [2020-01-01 Wed 10:00]\nb|||a\n%%(x)\nb|||a\nSCHEDULED: <2020-01-01 Wed>|||a\n+++|||a\n||||a\n:|||a\n:x|||a\n::|||a\n:x: y|||a\n#|||a\n#+|||a\n#x|||a\n+ b|||a\n- b|||a\n* b|||a\n1) b|||a\n1)b|||a\n-b|||a\n- |||a\n-|||a\n#+begin_src|||a\n#+begin_quote\nb|||a\n\\begin{x}\nb|||a\n:D:\nb|||a\n#+end_quote|||a  |||a\n|||a\n\n|||\n\na|||\n\n\na|||   |||\t|||a b|||a\n   |||x\n\n\n\n\ny|||a\n\n  b\n\n    c|||a\n     b|||\ta\n\tb|||a\u00a0|||\u00a0a|||\u00a0\n|||a\n\u00a0\nb`);
// more: what follows a list bullet or a footnote label on its line, drawers that are not closed, dynamic blocks, table.el tables,
// LaTeX environments on one line, blocks inside items, tags, alphabetical bullets, two blank lines
L(String.raw`- - a|||- 1. a|||- -----|||- [fn:1] x|||- | a ||||- #+begin_src x\n  y\n  #+end_src|||- #+KEY: v|||- :D:\n  x\n  :END:|||- # c|||- : x|||- \\begin{x}\n  y\n  \\end{x}|||- [ ] - a|||- tag :: - a|||- [@3] - a|||1. - a|||- a\n  [fn:1] b|||- a\n  - [fn:1] b|||[fn:1] [fn:2] b|||[fn:1] | a ||||[fn:1] #+begin_src x\n  y\n#+end_src|||[fn:1] - b|||[fn:1] 1. a|||[fn:1] -----|||[fn:1] #+KEY: v|||[fn:1] :D:\n:END:|||[fn:1]\n- b|||[fn:1]\n#+begin_src x\ny\n#+end_src|||[FN:1] a|||[Fn:a] a\nb|||[fn:é] x|||[fn:1] a\n\n\n  b`);
L(String.raw`a\n:D:\nb|||a\n:D:\nb\n:END:|||:D:\nb|||:D::\n:END:|||:é:\nb\n:END:|||:é-x_y:\n:END:|||a\n:END:\nb|||:END:|||x\n:D:\n:E:\nb\n:END:`);
L(String.raw`#+BEGIN: name args\ncontent\n#+END:|||#+begin: name\n#+end:|||#+BEGIN: name\n#+END|||#+BEGIN: name\n\n#+END:|||#+BEGIN: name\n- a\n- b\n| t |\n#+END:|||#+BEGIN: name\n#+BEGIN: other\n#+END:\n#+END:|||#+BEGIN: name|||#+BEGIN: name\ncontent|||#+BEGIN:|||#+BEGIN:\n#+END:|||#+BEGIN: \n#+END:|||#+END:|||#+BEGIN: n a\n#+END: x|||  #+BEGIN: n\n  x\n  #+END:|||a\n#+BEGIN: n\nb\n#+END:\nc|||a\n#+BEGIN: n\nb|||#+NAME: x\n#+BEGIN: n\nb\n#+END:|||- a\n  #+BEGIN: n\n  b\n  #+END:|||#+BEGIN: a\n#+BEGIN_src x\n#+END:\n#+end_src|||#+BEGIN: clocktable :scope file\n#+END:|||#+BEGIN: é\n#+END:|||#+BEGIN: a-b\n#+END:`);
L(String.raw`+---+---+\n| a | b |\n+---+---+|||+---+\n| a |\n+---+|||+---+---+\n| a | b |\n+---+---+\n| c | d |\n+---+---+|||+---+|||+---+\n+---+|||+---+\n\n+---+|||+---+\n| a |\n+---+\nx|||+---+\n| a |\n+---+\n\ny|||+---+\n| a |\nx|||+---+\n| a |\n+---+\n#+TBLFM: $1=1|||  +---+\n  | a |\n  +---+|||a\n+---+\n| a |\n+---+|||a\n+---+\nb|||+-+\n| a |\n+-+|||+---+\n| a |\n+---+\n| b |\n+---+|||+---+---+\n|   |   |\n+---+---+\n| c |\n+---+|||+---+\n+ a +\n+---+|||+---+\n- a\n+---+|||#+NAME: t\n+---+\n| a |\n+---+|||+---+\n| a |\n+---+\n| a | b |`);
L(String.raw`\\begin{a}x\\end{a}|||\\begin{a}{b}x\\end{a}|||\\begin{a}x\\end{a} y|||x \\begin{a}\nb\n\\end{a}|||\\begin{a}\nb\nc \\end{a}|||\\begin{a}\nb\n\\end{a}  |||a\n\\begin{a}x\\end{a}|||a\n\\begin{a}\nb|||\\BEGIN{a}\nb\n\\END{a}|||\\begin{a}\n\\end{A}`);
L(String.raw`- a\n  #+begin_src x\n(+ 1 1)\n  #+end_src|||- a\n  #+begin_src x\n* b\n- c\n  #+end_src\n- d|||- a\n  #+begin_example\nx\n  #+end_example\n- b|||- a\n  #+begin_src x\nb\n  #+end_src\nc|||- a\n  :D:\nb\n  :END:\n- c|||- a\n#+begin_src x\n  #+end_src|||- a\n  #+begin_src x\ny|||1. a\n  #+begin_quote\nb\n  #+end_quote`);
L(String.raw`1. tag :: d|||1) tag :: d|||- tag ::|||- tag :: |||- tag ::\n  d|||-  :: d|||- :: d|||- a :: b :: c|||- a ::: b|||- a ::b|||- a::b|||+ a :: b|||* a :: b\n  * c :: d|||- [ ] t :: d|||- [@3] t :: d|||- t :: [ ] x|||- a  ::  b|||- a\t:: b|||- ~a :: b~ c|||- [X] 1. t :: d|||1. [ ] t :: d|||- a :: b\n  - c :: d|||- a ::\n- b ::|||2. a :: b\n1. b|||- a :: b\n1. c`);
L(String.raw`a. a|||A) a|||a) a|||a.|||z. a\nb|||a. a\nb. b|||1. a\nb. b|||- a\n  a. b|||x\n\na. b|||II. a|||ab. a|||a.b`);
L(String.raw`- [x] a|||- [X] a|||- [x]|||- [ ]|||- [X]|||- [-] a|||- [x] a\n- [X] b|||1. [x] a|||- tag :: [x] a|||- [x] t :: d|||- [@2] [x] a|||* x\n  - [x] a`);
L(String.raw`- a\n\n\n- b|||- a\n\n\n  - b|||- a\n\n  - b\n\n\n  - c|||1. a\n\n\n2. b|||- a\n\n\n\n- b|||- a\n  \n  \n- b|||- a\n \n\n- b|||- a\n\n- b\n\n- c|||- a\n  - b\n\n\n  - c|||- a\n\n\n  b`);
L(String.raw`#+begin_src x|||#+begin_src x\ny|||#+begin_special*\na\n#+end_special*|||#+begin_a-b\nx\n#+end_a-b|||#+begin_a.b\nx\n#+end_a.b|||#+begin_a+b\nx\n#+end_a+b|||#+begin_a\nb\n#+end_c|||a\n#+begin_quote\nb|||a\n#+begin_src|||a\n#+begin_quote\nb\n#+end_quote|||a\n#+begin_special*\nb\n#+end_special*|||- a\n  #+begin_src x|||#+begin_example\n#+begin_src\n#+end_example|||- a\n#+begin_src x\ny|||#+begin_QUOTE\nb\n#+end_quote`);
L(String.raw`#+KEY[]: v|||#+KEY[a]: v|||#+KEY[a b]: v|||#+a:b: v|||a\n#+KEY[]: v|||a\n#+KEY[x]: v|||a\n#+CAPTION[x]: v\nb|||a\n#+RESULTS[x]: v\nb|||a\n#+HEADER[x]: v\nb|||a\n#+BEGIN: x|||a\n#+END:|||a\n#+KEY:v|||#+KEY:v|||a\n#+call: f()`);

const cases = [];
const seen = new Set();
for (const s of S) {
  for (const w of [s, 'x\n\n' + s, s + '\n\ny']) {
    if (seen.has(w)) continue;
    seen.add(w);
    cases.push({ id: cases.length, text: w });
  }
}

// Emacs: the tree of each text, down to the elements
const el = `
(require 'org) (require 'org-element) (require 'json) (require 'cl-lib)
(setq org-element-use-cache nil)
(defun d--n (n)
  (let* ((type (org-element-type n))
         (own (list (cons 'type (symbol-name type))
                    (cons 'b (1- (org-element-property :begin n))) (cons 'e (1- (org-element-property :end n)))
                    (cons 'pa (let ((p (org-element-property :post-affiliated n))) (and p (1- p))))
                    (cons 'pb (org-element-property :post-blank n)))))
    (when (eq type 'item)
      (setq own (append own (list (cons 'bullet (org-element-property :bullet n))
                                  (cons 'checkbox (let ((c (org-element-property :checkbox n))) (and c (symbol-name c))))
                                  (cons 'counter (org-element-property :counter n))
                                  (cons 'tag (and (org-element-property :tag n) t))))))
    (when (eq type 'table) (setq own (append own (list (cons 'tableType (symbol-name (org-element-property :type n)))))))
    (when (eq type 'special-block) (setq own (append own (list (cons 'blockType (org-element-property :type n))))))
    (when (eq type 'keyword) (setq own (append own (list (cons 'key (org-element-property :key n))))))
    (when (eq type 'section) (setq own (append own (list (cons 'cb (1- (org-element-property :begin n)))))))
    (append own
            (list (cons 'ch (vconcat (and (memq type '(org-data headline section inlinetask plain-list item footnote-definition drawer dynamic-block table))
                                          (mapcar #'d--n (org-element-contents n)))))))))
(defun d--parse (text)
  (with-temp-buffer
    (insert text)
    (let ((inhibit-message t)) (delay-mode-hooks (org-mode)))
    (condition-case e (d--n (org-element-parse-buffer)) (error (list (cons 'error (error-message-string e)))))))
(let* ((json-object-type 'alist) (json-array-type 'list) (json-key-type 'symbol)
       (cases (json-read-file (getenv "ORACLE_IN"))))
  (with-temp-file (getenv "ORACLE_OUT")
    (insert (json-encode (mapcar (lambda (c) (list (cons 'id (alist-get 'id c)) (cons 'tree (d--parse (alist-get 'text c))))) cases)))))
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parser-oracle-'));
fs.writeFileSync(path.join(dir, 'run.el'), el);
fs.writeFileSync(path.join(dir, 'in.json'), JSON.stringify(cases));
const r = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'run.el')], { env: { ...process.env, ORACLE_IN: path.join(dir, 'in.json'), ORACLE_OUT: path.join(dir, 'out.json') }, encoding: 'utf8' });
if (r.status !== 0) { console.error(r.stderr || r.error); process.exit(1); }
const out = JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8'));
const byId = new Map(out.map((o) => [o.id, o.tree]));

/** The sections of the tree (the text under each headline, and before the first), without the planning and property-drawer lines. */
function sectionsOf(tree) {
  const found = [];
  (function walk(n) {
    for (const c of n.ch) {
      if (c.type === 'section') found.push(c);
      else if (c.type === 'headline' || c.type === 'inlinetask') walk(c);
    }
  })(tree);
  return found;
}
const result = [];
for (const c of cases) {
  const tree = byId.get(c.id);
  if (tree.error) throw new Error(c.text + ': ' + tree.error);
  let hasTask = false;
  (function walk(n) { if (n.type === 'inlinetask') hasTask = true; (n.ch || []).forEach(walk); })(tree);
  if (hasTask) continue;
  const sections = sectionsOf(tree).map((s) => {
    const cut = s.ch.filter((x) => x.type === 'planning' || x.type === 'property-drawer').map((x) => [x.b, x.e]).sort((a, b) => b[0] - a[0]);
    let text = c.text.slice(s.b, s.e);
    for (const [b, e] of cut) text = text.slice(0, b - s.b) + text.slice(e - s.b);
    return {
      text,
      elements: emacsSignature(emacsOutline(s.ch, c.text, 'elements'), true),
      body: emacsCoarse(emacsOutline(s.ch, c.text, 'body')),
    };
  });
  result.push({ text: c.text, sections });
}

// Objects: what Org finds in a paragraph (the text is the paragraph itself), as emphasis, code, links with the objects of their text,
// footnote references, LaTeX fragments and scripts
const inlineTexts = [];
const I = (list) => list.split('|||').forEach((x) => inlineTexts.push(x.replace(/\\n/g, '\n')));
I(String.raw`*a\nb*|||/a\nb/|||_a\nb_|||+a\nb+|||=a\nb=|||~a\nb~|||*a\nb\nc*|||=a\nb\nc=|||*a\n b*|||x *a\nb* y *c* d|||*a *b\nc* d*|||/*a\nb*/|||a\n*b* c\n/d/|||_{a\nb}|||x_{a\nb}|||x^{a\nb}|||x_{a\nb\nc}|||[fn:a:b\nc]|||[fn::b\nc]|||a [fn:1:b *c*\nd] e|||call_x(a\nb)|||src_x{a\nb}|||x call_x(a\nb) y_z|||=*a\nb*=|||*=a\nb=*|||$a\nb$ and *c*|||\\(a\nb\\) *c*|||a\\\\\n*b* c`);
I(String.raw`[[a\nb]]|||[[a \n  b]]|||[[a\nb][c]]|||[[a][b\nc]]|||[[a\nb][c\nd]]|||[[a\nb]] now\nnext|||x [[https://x.org\n/y]] z|||<https://x.org\n.org>|||<https://x.org\n  .org>|||<https://x\n .org\n z>|||<https://x.org\n>|||<https://x.org\n\n.org>|||[[a]]\n[[b]]|||[[a\nb]]x`);
I(String.raw`'https://x.org|||$https://x.org|||%https://x.org|||x'https://x.org y|||x$https://x.org y|||x%https://x.org y|||"https://x.org|||(https://x.org)|||*https://x.org*|||-https://x.org|||a https://x.org\u00a0b|||a https://x.org\u00a0|||https://x.org/a\u00a0|||https://x.org/a\u00a0b|||https://x.org.|||https://x.org/|||é https://x.org|||1https://x.org|||_https://x.org`.replace(/\\u00a0/g, '\u00a0'));
I(String.raw`[[a][b $c$ d]]|||[[a][*b* /c/ =d=]]|||[[a][b [[c]] d]]|||[[a][https://x.org]]|||[[a][<https://x.org>]]|||[[a][b_c d^e]]|||[[a][b_{c} d]]|||[[a][b [fn:1] c]]|||[[a][\\(x\\)]]|||[[a][$$x$$]]|||[[a][b \\alpha c]]|||[[a][b]] and [[c][*d*]]|||[[a][*b*]][[c][/d/]]|||[[a][ *b* ]]|||[[a][*b]]|||[[a][b*]]|||[[a][_b_ +c+]]|||[[https://x.org][see https://y.org]]|||[[a][b ~c~ d]]|||[[a][=b $c$ d=]]|||*[[a][b]]*|||*[[a][*b*]]*|||[[a][b *c*\nd]]`);
const inlineInput = inlineTexts.map((t, i) => ({ id: i, text: t }));
const elObjects = `
(require 'org) (require 'org-element) (require 'json) (require 'cl-lib)
(setq org-element-use-cache nil)
(defun o--list (nodes) (delq nil (mapcar #'o--obj nodes)))
(defun o--obj (n)
  (if (stringp n) nil
    (let ((type (org-element-type n)))
      (cond
       ((memq type '(bold italic underline strike-through)) (list (cons 't (symbol-name type)) (cons 'ch (vconcat (o--list (org-element-contents n))))))
       ((memq type '(code verbatim)) (list (cons 't (symbol-name type)) (cons 'v (org-element-property :value n))))
       ((eq type 'link)
        (unless (eq (org-element-property :type n) 'radio)
          (list (cons 't "link") (cons 'raw (org-element-property :raw-link n))
                (cons 'ch (if (org-element-property :contents-begin n) (vconcat (o--list (org-element-contents n))) nil)))))
       ((eq type 'latex-fragment)
        (let ((v (org-element-property :value n)))
          (unless (and (string-match-p "\\\\\\\\[a-zA-Z]" v) (not (string-match-p "\\\\\\\\begin{" v))) (list (cons 't "latex") (cons 'v v)))))
       ((eq type 'footnote-reference)
        (list (cons 't "fn") (cons 'label (org-element-property :label n)) (cons 'kind (symbol-name (org-element-property :type n)))
              (cons 'ch (vconcat (o--list (org-element-contents n))))))
       ((memq type '(subscript superscript))
        (list (cons 't (symbol-name type)) (cons 'v (if (org-element-contents n) (mapconcat (lambda (x) (if (stringp x) (substring-no-properties x) "?")) (org-element-contents n) "") ""))))
       (t nil)))))
(defun o--parse (text)
  (with-temp-buffer
    (insert text "\n")
    (let ((inhibit-message t)) (delay-mode-hooks (org-mode)))
    (let ((tr (org-element-parse-buffer)) (out nil))
      (org-element-map tr 'paragraph (lambda (p) (push (vconcat (o--list (org-element-contents p))) out)) nil t)
      (vconcat (nreverse out)))))
(let* ((json-object-type 'alist) (json-array-type 'list) (json-key-type 'symbol)
       (cases (json-read-file (getenv "ORACLE_IN"))))
  (with-temp-file (getenv "ORACLE_OUT")
    (insert (json-encode (mapcar (lambda (c) (list (cons 'id (alist-get 'id c)) (cons 'paras (o--parse (alist-get 'text c))))) cases)))))
`;
fs.writeFileSync(path.join(dir, 'objects.el'), elObjects);
fs.writeFileSync(path.join(dir, 'in2.json'), JSON.stringify(inlineInput));
const r2 = spawnSync('emacs', ['--batch', '-Q', '-l', path.join(dir, 'objects.el')], { env: { ...process.env, ORACLE_IN: path.join(dir, 'in2.json'), ORACLE_OUT: path.join(dir, 'out2.json') }, encoding: 'utf8' });
if (r2.status !== 0) { console.error(r2.stderr || r2.error); process.exit(1); }
const objects = JSON.parse(fs.readFileSync(path.join(dir, 'out2.json'), 'utf8')).map((o) => ({ text: inlineTexts[o.id], emacs: o.paras }));

fs.writeFileSync('test/fixtures/parser-oracle.json', JSON.stringify({ emacs: '29.3', cases: result, objects }) + '\n');
console.log(`${result.length} texts, ${objects.length} paragraphs of objects`);
