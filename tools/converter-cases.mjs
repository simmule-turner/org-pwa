// The cases of tools/gen-converters-oracle.mjs beyond Org's own tests: Lisp source for Emacs and for the app's interpreter alike.
const q = (s) => JSON.stringify(s);
const T = (text, params) => `(orgtbl-to-generic (org-table-to-lisp ${q(text)}) '${params})`;
const TABLES = [
  '| a |',
  '| a | b |\n|---+---|\n| c | d |',
  '| a | b |\n| c | d |\n|---+---|\n| e | f |',
  '|---+---|\n| a | b |\n|---+---|\n| c | d |\n|---+---|',
  '| N | x |\n|---+---|\n| 1 | 2.5 |\n| 10 | 3e4 |',
  '| ! | a | b |\n|---+---+---|\n| # | 1 | 2 |\n| * | 3 | 4 |',
  '| a | *b* | /c/ | =d= |\n| ~e~ | _f_ | x_1 | $y$ |',
  '| <l> | <r5> | <c> |\n| a | b | c |\n| dd | ee | ff |',
  '| a |   |\n|   | b |',
  '| a | b |\n|---+---|\n| c | d |\n|---+---|\n| e | f |',
  '| 1 | 2e3 |\n| 1.5e-3 | 4 |',
  '| a & b | 50% | c_d | # |\n| <x> | "q" | \\alpha | a,b |',
];
const PARAMS = [
  '()', '(:hline nil)', '(:hline "~")', '(:sep "!")', '(:sep "," :fmt "<%s>")', '(:lstart "> " :lend " <")', '(:lstart "[" :lend "]" :sep ";")',
  '(:hlstart "H " :hlend " h")', '(:hllstart "L " :hllend " l" :hlstart "H ")', '(:llstart "<< " :llend " >>")',
  '(:tstart "<begin>" :tend "<end>")', '(:splice t)', '(:tstart "<b>" :splice t)', '(:skip 1)', '(:skip 2)', '(:skipcols (1))', '(:skipcols (2))',
  '(:lfmt "%s;%s")', '(:llfmt "last: %s;%s" :lfmt "%s;%s")', '(:hlfmt "H(%s;%s)" :lfmt "d(%s;%s)")', '(:hllfmt "HL(%s;%s)" :hlfmt "H(%s;%s)")',
  '(:fmt "$%s$")', '(:fmt (2 "$%s$"))', '(:fmt (2 (lambda (c) (format "<%s>" c))))', '(:hfmt "*%s*" :fmt "_%s_")', '(:hsep "!" :sep "?")', '(:hsep "!")',
  '(:efmt "%s\\\\times10^{%s}")', '(:efmt "%s*10^%s" :fmt "(%s)")', '(:efmt (2 "%s E %s"))', '(:efmt nil)',
  '(:lstart (lambda () "S:") :lend (lambda () ":E"))', '(:lfmt (lambda (cells) (concat "[" (mapconcat (quote identity) cells "|") "]")))',
  '(:sep "\\t")', '(:backend html :raw t)', '(:backend latex :raw t)', '(:backend html)', '(:backend latex)', '(:backend ascii)', '(:backend org)',
  '(:backend html :sep "|" :lstart "(" :lend ")")', '(:backend latex :lstart "<" :lend ">")', '(:backend latex :fmt "{%s}")', '(:backend html :fmt "<%s>")',
  '(:backend latex :sep " & " :lend " \\\\\\\\")', '(:raw t :fmt "%s")', '(:hline nil :skip 1)', '(:skip 1 :skipcols (1))', '(:hline "-" :hlstart "#")',
  '(:tstart (lambda () "TS") :tend "TE" :hline "--")', '(:lstart "|" :sep "|" :lend "|" :hline "|-")',
];
export const EXTRA_CASES = [];
for (const t of TABLES) for (const p of PARAMS) EXTRA_CASES.push(T(t, p));
for (const p of ['(:skip "x")', '(:skipcols 1)', '(:fmt 3)', '(:backend nosuchbackend)', '(:tstart 3)', '(:hline 4)', '(:efmt (1 2))'])
  EXTRA_CASES.push(T('| 2e3 | a |', p));
const SPECIAL = ['orgtbl-to-csv', 'orgtbl-to-tsv', 'orgtbl-to-latex', 'orgtbl-to-html', 'orgtbl-to-orgtbl', 'orgtbl-to-unicode'];
const SP = {
  'orgtbl-to-csv': ['nil', '(:hline "---")', '(:skip 1)', '(:lstart "#")'],
  'orgtbl-to-tsv': ['nil', '(:hline nil)'],
  'orgtbl-to-latex': ['nil', '(:booktabs t)', '(:environment "tabularx")', '(:environment "longtable")', '(:environment "longtable" :booktabs t)', '(:raw t)', '(:splice t)', '(:fmt "\\\\textbf{%s}")', '(:hline nil)'],
  'orgtbl-to-html': ['nil', '(:attributes nil)', '(:attributes (:border "2"))', '(:attributes (:class "x" :id "y"))', '(:splice t)', '(:lstart "<tr>" :lend "</tr>")', '(:raw t)'],
  'orgtbl-to-orgtbl': ['nil', '(:hline nil)', '(:tstart "#+ORGTBL: SEND x y")', '(:lstart "| " :lend " |" :sep " | ")', '(:skip 1)', '(:fmt "%s!")'],
  'orgtbl-to-unicode': ['nil', '(:narrow t)', '(:skip 1)'],
};
const TABLES2 = TABLES.filter((_, i) => [0, 1, 2, 3, 4, 5, 6, 7, 8, 11].includes(i));
for (const f of SPECIAL) for (const t of TABLES2) for (const p of SP[f]) EXTRA_CASES.push(`(${f} (org-table-to-lisp ${q(t)}) ${p === 'nil' ? 'nil' : "'" + p})`);
EXTRA_CASES.push(`(orgtbl-to-csv '(("a,b" "c\\"d" 3) hline (1.5 nil ?x)) nil)`);
EXTRA_CASES.push(`(orgtbl-to-generic '(("a" "b") hline ("c" "d")) '(:sep ", "))`);
EXTRA_CASES.push(`(orgtbl-to-orgtbl '(("a|b" "c")) nil)`);
EXTRA_CASES.push(`(orgtbl-to-generic '(("a\\nb" "c") ("d" "e")) '(:sep ","))`);
EXTRA_CASES.push(`(orgtbl-to-generic nil nil)`);
EXTRA_CASES.push(`(orgtbl-to-generic '(hline) '(:hline "-"))`);
EXTRA_CASES.push(`(orgtbl-to-csv '(("") ("")) nil)`);
for (const t of ['| a | b |', '|a|b|\n|c|d|', '| a | b |\n|---+---|\n| c |\n', '| a | | c |\n|  |', '|-\n|-\n| x |', '  | a | b | \n  | c | d |', '| a | b |\n\ntext', '| a |b |c|\n|-|\n| 1 | 2 |', '| a |\n#+TBLFM: $1=1', '', 'text'])
  EXTRA_CASES.push(`(org-table-to-lisp ${q(t)})`);
for (const [t, a] of [['|a|b|\n|-\n|c|d|', ''], ['|a|b|\n|A|B|\n|-\n|c|d|', ' "."'], ['|a|b|\n|A|B|\n|-\n|c|d|', ' nil 1'], ['|-\n|a|b|\n|-\n|c|d|', ''], ['| a |  b |\n| c | d |', '']])
  EXTRA_CASES.push(`(org-table-collapse-header (org-table-to-lisp ${q(t)})${a})`);
const L = (text, form) => `(org-test-with-temp-text ${q(text)} ${form})`;
const LISTS = [
  '- a', '1. a', '- a :: b', '- a\n- b', '- a\n  - b\n  - c\n- d', '1. one\n   + sub one\n   + [X] sub two\n   more text in first item\n2. [@3] last item',
  '- [ ] a\n- [X] b\n- [-] c', '- term :: desc\n- t2 :: d2\n  - x', '- a\n\n  para two\n- b', '- a\n  continuation\n  line', '3. a\n4. b', '- *bold* /it/ =v= ~c~',
  '- a\n  1. x\n  2. y\n- b :: c\n  - [X] z', '- a & b < c', '- a\n   - b\n      - c', 'Paragraph\n\n- a\n- b\n\nAfter',
];
const GP = ['nil', '(:ustart "<u>" :uend "</u>")', '(:ostart "<o>" :oend "</o>")', '(:dstart "<d>" :dend "</d>")', '(:splice t)', '(:istart "* " :iend ";")', '(:icount (lambda (type depth c) (format "[%d] " c)))',
  '(:isep ",")', '(:isep "\\n")', '(:ifmt (lambda (type c) (upcase c)))', '(:cbon "[x]" :cboff "[ ]" :cbtrans "[-]")', '(:dtstart "<dt>" :dtend "</dt>" :ddstart "<dd>" :ddend "</dd>")',
  '(:ustart (lambda (d) (format "U%d" d)) :uend (lambda (d) (format "/U%d" d)))', '(:istart (lambda (type d) (format "(%s %d)" type d)))', '(:backend html)', '(:backend latex)', '(:backend html :raw t)',
  '(:backend latex :raw t)', '(:backend html :istart "<i>" :iend "</i>")', '(:backend ascii)', '(:splice t :istart "- " :ustart "x")'];
for (const l of LISTS) EXTRA_CASES.push(L(l, '(org-list-to-lisp)'));
for (const l of LISTS) for (const p of GP) EXTRA_CASES.push(L(l, `(org-list-to-generic (org-list-to-lisp) ${p === 'nil' ? 'nil' : "'" + p})`));
for (const l of LISTS) {
  EXTRA_CASES.push(L(l, '(org-list-to-org (org-list-to-lisp))'));
  EXTRA_CASES.push(L(l, '(org-list-to-html (org-list-to-lisp))'));
  EXTRA_CASES.push(L(l, '(org-list-to-latex (org-list-to-lisp))'));
  EXTRA_CASES.push(L(l, '(org-list-to-org (org-list-to-lisp) \'(:istart "+ "))'));
}
EXTRA_CASES.push(`(org-list-to-org '(unordered ("a" (ordered ("b")))) nil)`);
EXTRA_CASES.push(`(org-list-to-latex '(unordered ("a") ("b")) nil)`);
EXTRA_CASES.push(`(org-list-to-html '(ordered ("a" (unordered ("b")))) '(:istart "<li>"))`);
EXTRA_CASES.push(`(org-list-to-generic nil nil)`);
EXTRA_CASES.push(`(org-list-to-generic '(unordered ("a")) '(:backend nosuch))`);
EXTRA_CASES.push(`(org-list-to-generic '(unordered ("a")) '(:ustart 3))`);
EXTRA_CASES.push(L('- a\n  - b\n- c', '(progn (org-list-to-lisp t) (buffer-string))'));
EXTRA_CASES.push(L('x\n- a\n- b\ny', '(progn (org-list-to-lisp t) (buffer-string))'));
EXTRA_CASES.push(L('para', '(org-list-to-lisp)'));
EXTRA_CASES.push(L('- a\n- b', '(progn (org-list-to-lisp) (point))'));
EXTRA_CASES.push(`(org-combine-plists '(:a 1 :b 2) '(:a 3) nil '(:c 4))`);
for (const s of ['a,b', 'plain', 'say \\"x\\"', 'a\\nb']) EXTRA_CASES.push(`(org-quote-csv-field "${s}")`);
// more tables for the back ends: column groups, special columns and rows, header rows, rules at the ends, ragged rows
const TABLES3 = [
  '| / | < | > |\n| a | b | c |\n| d | e | f |',
  '| ! | a | b |\n|---+---+---|\n| ^ | 1 | 2 |\n| _ | 3 | 4 |\n| $ | 5 | 6 |',
  '| a | b |\n|---+---|\n| c | d |\n|---+---|\n| e | f |\n|---+---|',
  '|---+---|\n|---+---|\n| a | b |',
  '| a |\n|---|\n|---|\n| b |',
  '| a | b | c |\n| d |\n| e | f |',
  '| <r> | <l> |\n| 1 | x |\n| 22 | y |',
  '| x | <3> |\n| 1 | 12345 |',
  '| 1 | 2 |\n| 3 | 4 |\n|---+---|\n| 5 | 6 |',
  '| a | b |\n|---+---|\n| 1 | 2 |\n| 3 | 4 |\n|---+---|\n| s | t |',
  '| A | B |\n| a | b |\n|---+---|\n| c | d |\n|---+---|\n| e | f |',
  '| 1 | x |\n| 2 | y |\n| z | 3 |',
  '| -- | --- | ... | a--b |',
  '| \\alpha | \\to | x^2 | a_b |',
  '| *a* b | [[http://x.org][x]] | <2024-01-02 Tue> | ~c~ |',
  '| | |',
  '| ! | a |\n| ! | b |',
];
const BP = {
  'orgtbl-to-html': ['nil', '(:skipcols (1))', '(:hline nil)', '(:skip 1)'],
  'orgtbl-to-latex': ['nil', '(:booktabs t)', '(:environment "longtable" :booktabs t)', '(:environment "longtable")', '(:skip 1)', '(:hline nil)'],
  'orgtbl-to-orgtbl': ['nil', '(:skipcols (2))', '(:hline nil)'],
  'orgtbl-to-unicode': ['nil', '(:narrow t)', '(:skipcols (1))'],
  'orgtbl-to-csv': ['nil'],
};
for (const f of Object.keys(BP)) for (const t of TABLES3) for (const p of BP[f]) EXTRA_CASES.push(`(${f} (org-table-to-lisp ${q(t)}) ${p === 'nil' ? 'nil' : "'" + p})`);
for (const t of TABLES3) for (const p of ['(:backend html)', '(:backend latex)', '(:backend html :lstart "<R>" :lend "</R>")', '(:backend latex :lfmt "%s;%s" :hline "~")', '(:backend html :hlfmt "H:%s")', '(:backend ascii)', '(:backend org :lstart "|" :lend "|")'])
  EXTRA_CASES.push(`(orgtbl-to-generic (org-table-to-lisp ${q(t)}) '${p})`);
EXTRA_CASES.push(`(orgtbl-to-html (org-table-to-lisp "| a | b |") '(:attributes (:id "x" :class "c d" :data "a&b\\"c")))`);
EXTRA_CASES.push(`(orgtbl-to-latex (org-table-to-lisp "| a | 2e3 |") '(:latex-table-scientific-notation "%s\\\\times10^{%s}"))`);
EXTRA_CASES.push(`(orgtbl-to-generic (org-table-to-lisp "| a | 2e3 |") '(:backend latex :latex-table-scientific-notation "%s\\\\times10^{%s}" :latex-tables-centered nil))`);
EXTRA_CASES.push(`(orgtbl-to-generic (org-table-to-lisp "| a |") '(:backend latex :latex-default-table-environment "tabularx" :latex-tables-booktabs t))`);
EXTRA_CASES.push(`(orgtbl-to-unicode (org-table-to-lisp "| a | b |\\n|---+---|\\n| c | d |") '(:ascii-art nil))`);
EXTRA_CASES.push(`(orgtbl-to-generic (org-table-to-lisp "| a | b |") '(:backend ascii :ascii-charset utf-8))`);
EXTRA_CASES.push(`(orgtbl-to-generic (org-table-to-lisp "| a | b |") '(:backend ascii :ascii-charset latin1))`);
// lists: raw, dashes, tags, counters, multi-paragraph items, odd nesting
const LISTS2 = [
  '- a -- b ... c', '- 50% & x_y ~z ^q \\ x', '- tag :: body\n- other :: text\n  more', '1. [@5] five\n2. six\n   - sub\n3. [@2] two', '- a\n\n  second paragraph\n\n  third\n- b',
  '- a\n  - b\n\n    para in b\n  - c\n- d', '- [ ] todo\n- [X] done\n  - [-] part\n- [ ] x :: y', '+ plus\n+ items', '- a\n  #+begin_example\n  code\n  #+end_example\n- b', '1. a\n   1. b\n      1. c\n         1. d\n            1. e', '- *a* :: =b=', '-\n- x',
];
for (const l of LISTS2) {
  EXTRA_CASES.push(L(l, '(org-list-to-lisp)'));
  for (const p of ['nil', '(:backend html)', '(:backend latex)', '(:backend html :raw t)', '(:backend latex :raw t)', '(:backend ascii)', '(:istart "* " :ifmt (lambda (type c) (upcase c)))', '(:splice t)', '(:isep "\\n" :cbon "X" :cboff "O")', '(:dtstart "<" :dtend ">" :ddstart "[" :ddend "]")', '(:ostart (lambda (d) "OL") :oend (lambda (d) "/OL\\n"))'])
    EXTRA_CASES.push(L(l, `(org-list-to-generic (org-list-to-lisp) ${p === 'nil' ? 'nil' : "'" + p})`));
  EXTRA_CASES.push(L(l, '(org-list-to-org (org-list-to-lisp))'));
  EXTRA_CASES.push(L(l, '(org-list-to-subtree (org-list-to-lisp))'));
  EXTRA_CASES.push(L(l, '(org-list-to-subtree (org-list-to-lisp) 2)'));
}
EXTRA_CASES.push(`(with-temp-buffer (insert "* H\\ntext\\n") (goto-char (point-max)) (org-list-to-subtree '(unordered ("a" (unordered ("b"))) ("c"))))`);
EXTRA_CASES.push(`(with-temp-buffer (insert "* H\\n\\ntext\\n") (goto-char (point-max)) (org-list-to-subtree '(unordered ("a"))))`);
EXTRA_CASES.push(`(let ((org-odd-levels-only t)) (org-list-to-subtree '(unordered ("a" (unordered ("b")))) 2))`);
EXTRA_CASES.push(`(org-list-to-subtree '(unordered ("[X] a") ("[ ] b") ("[-] c")) 1)`);
EXTRA_CASES.push(`(org-list-to-subtree '(descriptive ("t :: d")) 1)`);
