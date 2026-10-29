// The case corpus for the markup oracle (tools/gen-oracle-markup.mjs): one line of text each, parsed by Emacs 29.3 and by the app.
const MARKS = ['*', '/', '_', '+', '~', '='];
const BEFORE = ['', ' ', '-', '(', '{', "'", '"', 'a', '.', ',', ';', ':', '!', '?', '\\', '[', '<', '$', '9', '\t', '—', 'é'];
const AFTER = ['', ' ', '.', ',', ';', ':', '!', '?', ')', '}', ']', '"', "'", '-', 'a', '\\', '/', '*', '_', '\t', '9', '<', '—', 'é'];
const INNER = ['x', 'xy', 'x y', ' x', 'x ', ' x ', 'x\ty', 'a*b', 'a/b', 'a_b', 'a+b', 'a=b', 'a~b', '"x"', '(x)', 'x.', '.x', '-x-', '', '*', 'xx*yy'];

export const emphasisCases = [];
for (const m of MARKS) {
  for (const b of BEFORE) for (const a of AFTER) emphasisCases.push({ line: `${b}${m}xy${m}${a}` });
  for (const i of INNER) emphasisCases.push({ line: `${m}${i}${m}`, }, { line: `a ${m}${i}${m} b` });
}
for (const m of MARKS) for (const n of MARKS) {
  emphasisCases.push({ line: `${m}a ${n}b${n} c${m}` }, { line: `${m}${n}ab${n}${m}` }, { line: `${m}a${m}${n}b${n}` }, { line: `${m}a${m} ${n}b${n}` }, { line: `${m}a ${m}${n}b${n}` });
}

export const fixedCases = [
  // emphasis in running text
  'This is *bold*, /italic/, _under_, +strike+, ~code~ and =verb=.', '*bold* text', 'text *bold*', 'a*b*c', 'a *b*c', 'a*b* c', '**', '***', '*a**', '**a*', '*a*b*', '*a* *b*', '*a b* *c d*',
  '*bold /italic/ bold*', '/italic *bold* italic/', '*bold ~code~ bold*', '~code *not bold* code~', '=verb /not italic/ verb=', '*bold =verb *x* more= bold*', '_under *bold* under_', '+strike _under_ strike+',
  '*a* is *b*', '*a*-*b*', '(*a*)', '"*a*"', "'*a*'", '{*a*}', '[*a*]', '<*a*>', '*a* b', '*a*​b', '​*a*', 'x​*a*​', '*​a*', '*a​*',
  '~a~~b~', '=a==b=', '*a*,*b*', '*a*.', '*a*...', '*a*?!', 'x *y\\* z*', '*y\\*', '\\*a*', '\\*a\\*', '*a\\*', '*a *b* c*', '*a* *', '* a *', 'a * b * c', '1 * 2 * 3', '2*3*4', '2 *3* 4',
  '~/usr/bin~', '=/usr/bin=', '/usr/bin/ and /usr/local/', 'a/b/c', 'a /b/ c', 'path/to/file and /abs', '+1 +2 +3', 'a +b+ c', 'x+y+z', '-*a*-', '-*a*', '*a*-', '_a_b_', '_a_ _b_', '__a__', '_a__',
  '*日本語*', '/日本語/', '*é*', 'é*a*', '*a*é', '*a*日', '日*a*',
  'a *b\nc* d'.replace('\n', ' '),
  // sub/superscripts
  'x_i', 'x^2', 'x_{ij}', 'x^{10}', 'x_1^2', 'x_{a}^{b}', 'x^{a}_{b}', 'x_i_j', 'x_{i_j}', 'x_{i}{j}', 'x_', 'x^', '_x', '^x', ' _x', 'x _y', 'x_ y', 'x_{ y}', 'x_{}', 'x_{', 'x_{a', 'x_{a{b}}', 'x_{a}b}', 'a_b_c', 'a_b c_d', 'snake_case_name', 'a^b^c', 'a_1', 'a_12', 'a_1a', 'a_a1', 'a_-1', 'a_+1', 'a_*', 'a_*b', 'a^*', 'a_\\alpha', 'a_(1)', 'a_(1', 'a_(1)b', 'a^(x+y)', 'a_.b', 'a_b.', 'a_b,', 'a_b)', 'a_1.5', 'a_1,5', 'a_.5',
  'a_{*b*}', 'a_*b*', '*a_b*', '_a_b_', '/a_b/', '=a_b=', '~a_b~', 'H_2O', 'H_{2}O', 'x^2+y^2=z^2', 'e^{i\\pi}', 'e^{-x}', 'e^-x', 'x^+', 'x^-', 'x^n_m', 'a_b^c', 'a^b_c', 'a_{b}c', '(a)_b', '[a]_b', '}_b', 'a._b', 'a,_b', "a'_b", 'a"_b',
  '2_3', '2^3', '-_a', '-^a', 'a-_b', 'a=_b', 'a~_b',
  // latex fragments
  '$a$', '$a+b$', '$ a$', '$a $', '$a$b', '$a$ b', '$a$.', '$a$,', '$a$-b', '$a$)', '($a$)', '"$a$"', "'$a$'", 'a$b$', 'a $b$ c', 'costs $5 and $10 total', '$5', '$5 $6', '$5.00 and $6.00', '$a$$b$', '$$a$$', '$$a$$ b', '$$ a $$', '$$a', '$$', '$$$', '$a', 'a$', '$.5$', '$a.$', '$a,$', '$a;$', '$a?$', '$a!$', '$a:$', '$a-$', '$a$a', '$a$1', '$1$', '$1$2', '$ $', '$$ $$', '$\\alpha$', '$a_b$', '$a^b$', '$a\\$b$', '\\$a$', '$a\\$', '$a$$', '$$a$ b$',
  '\\(a\\)', '\\(a+b\\)', '\\( a \\)', '\\(\\)', '\\(a', 'a\\(b\\)c', '\\[a\\]', '\\[a+b\\]', '\\[ a \\]', 'x \\[a\\] y', '\\begin{equation}a\\end{equation}', ' \\begin{equation}a\\end{equation}', 'x \\begin{equation}a\\end{equation}', '\\begin{align*}a\\end{align*}', '\\begin{foo}a\\end{foo}', '\\begin{foo}a\\end{bar}', '\\begin{a}',
  'x \\(a\\) and $b$ and \\[c\\]', '\\(*a*\\)', '*\\(a\\)*', '*$a$*', '$*a*$', '=$a$=', '~\\(a\\)~',
  // entities and the like (they stay text in the tree the app builds)
  '\\alpha', '\\alpha{}', '\\alpha beta', 'a\\alphab', '\\Alpha', '\\pi', '\\nbsp', '\\_ ', '\\there4', '\\sup2', '\\frac12', '\\unknown', '*\\alpha*', '_\\alpha_', 'x_\\alpha',
  // links, targets, footnotes
  '[[https://x.org]]', '[[https://x.org][d]]', '[[https://x.org][*d*]]', '*[[https://x.org][d]]*', '[[https://x.org][d]]*', '*[[x]]', '[[x]]a', 'a[[x]]', '[[x][y]][[z]]', '[[a_b]]', '[[a_b][c_d]]', '[[*a*]]', '[[a]] _b_', '[[a][b]] c_d', '[[a][]]', '[[]]', '[[', ']]', '[[a]', '[[a]][', '[a]', '[[a][b][c]]', '[[a]]]', '[[[a]]]',
  '<<a>>', '<<a b>>', '<<a>>b', '<< a>>', '<<a >>', '<<a<b>>', '<<<a>>>', '<<<a b>>>', '<<< a>>>', '*<<a>>*', '<<a>', '<<>>', '<<<>>>', '<a>', '<<a>>>',
  '[fn:1]', '[fn:a]', '[fn:a-b_c]', '[fn:1]a', 'a[fn:1]', '[fn:1][fn:2]', '[fn:a:text]', '[fn:a:*bold*]', '[fn::text]', '[fn::*bold* x]', '[fn::[[a]]]', '[fn:a:b [c] d]', '[fn:a:b [c d]', '[fn:]', '[fn::]', '[fn:a b]', '[fn:a:', '[fn:a:]', '[fn:1:x]y', '*[fn:1]*',
  '@@html:<b>@@', '@@html:<b>@@ *x*', '{{{m}}} *x*', '{{{m(a,b)}}}', '<2026-01-01> *x*', '[2026-01-01 Thu] _x_', '*a* <2026-01-01 Thu>', 'src_python{1+1}', 'call_f(1)', '*src_python{1+1}*', 'a *b* src_c{x} d',
  '[cite:@a]', '*[cite:@a]*', 'a [cite:@a] b', '[cite/t:@a; @b]', '[cite:see @a p. 5]', '[cite:x]', '[cite:]', '[cite:@a', 'a_[cite:@a]',
  // mixtures from real notes
  'See *Section 2* and the /Introduction/ (page _12_) for ~code~ and =verbatim=.', 'Use ~M-x org-mode~ then press =C-c C-c=; "quoted *bold*" words.', 'x_1 and y^2 with *bold* and $z$', 'A_b *C* d_e', 'Emails: a_b@c.org and *me@x.org*', 'CamelCase_snake *bold_text* and _under*score_',
  '*bold* [[https://x.org][link *with* markup]] _u_', 'TODO: *fix* [[file:a.org::*h][the h]] by ~tomorrow~', '*[[a]]* and /[[b]]/', '=[[a]]=', '~[[a]]~',

  // more whitespace and letters than ASCII
  '*a*\u00a0b', '\u00a0*a*', '*\u00a0a*', '*a\u00a0*', '*a*\u2003b', '*a*\u3000b', '*a*\u202fb', '*a*\u2028b', '*a*\ufeffb', '\ufeff*a*', '*\u1680a*', '*a*\u000bb', 'x\u00a0_a', 'x_\u00a0a', 'é_1', 'é_é', 'é_日本', 'x_é', 'x_日本語', 'x_٣', 'x_²', 'x_a\u0301', 'x_\u0301',
  '*a*\u0301', '*a\u0301*', 'a\u0301*b*', '*日本*語', '日本*語*', '*a*[b]', '*a*[', '*a*(b)', '*a*{b}', '*a*>', '*a*|', '*a*&', '*a*%', '*a*#', '*a*@', '*a*$', '*a*^', '*a*~', '*a*=', '*a*+', '*a*`', '*a*\\', '*a*\\\\',
  // scripts, braces and parentheses
  'a_{b{c}}', 'a_{b{c{d}}}', 'a_{b{c{d{e}}}}', 'a_{b}{c}', 'a_{{b}}', 'a_{b}}', 'a_{b\nc}', 'a_(b(c))', 'a_(b(c(d)))', 'a_(b(c(d(e))))', 'a_(b)c)', 'a_(', 'a_()', 'a_{}x', 'a^{}', 'a_-', 'a_+', 'a_,', 'a_.', 'a_\\', 'a_\\1', 'a_1\\', 'a_,1', 'a_.1', 'a_-.1', 'a_+-1', 'a_--1', 'a_1-', 'a_1+2', 'a_1,2,3', 'a_1.2.3', 'a_x.y.z.', 'a_x_y', 'a^x^y', 'a_x^y', 'a_^', 'a^_', 'a__', 'a^^', 'a_^b', 'a^_b', '_^a', '^_a', '^^a', '__', '_', '^', 'a ^b', 'a ^2',
  'a_{*b}', 'a_{/b/}', 'a_{[[x]]}', 'a_{$b$}', 'a_{b} *c*', 'a_{b *c*}', '*a_{b}*', '*a_b*', '/a^2/', '+a_1+', '~a_1~', '=a_1=', '*a*_1', '*a*^2', '_a_1', '_a_^2', '(a)^2', '[a]_1', '"a"^2', '*^2*', '*_2*', '=^2=',
  // inline code and calls
  'src_python{print(1)}', 'src_python[:exports code]{print(1)}', 'src_python[:a b] {x}', 'src_python', 'src_{x}', 'src_python{', 'src_python{a{b}c}', 'src_python{a}b}', 'SRC_python{x}', 'Src_python{x}', 'asrc_python{x}', 'a src_python{x} b', 'a_src_python{x}', '_src_python{x}', '*src_python{*x*}*', 'call_f()', 'call_f(1)', 'call_f(1,2)', 'call_f[:a b](1)', 'call_f(1)[:x y]', 'call_f[:a b](1)[:x]', 'call_f', 'call_f(', 'call_f[', 'CALL_f(1)', 'acall_f(1)', 'a call_f(1) b', 'call_f(*x*)', 'call_f(a(b)c)',
  // entities and LaTeX commands
  '\\alpha{}', '\\alpha{}*b*', '\\alpha{*b*}', '\\alpha*b*', '\\alpha_1', '\\alpha^2', '\\alpha$', '\\alpha ', '\\alpha\\beta', '\\nbsp{}x', '\\there4x', '\\sup2x', '\\frac12x', '\\frac15', '\\foo{*b*}', '\\foo[*b*]', '\\foo*', '\\foo*{x}', '\\foo{a}{b}', '\\foo[a][b]{c}', '\\foo{a', '\\foo{a{b}}', '\\foo\n', 'a\\\\b', '\\\\', '\\\\ ', '\\', 'a\\', '\\1', '\\ a', '\\*a*', '\\_a_', '\\/a/', '\\+a+', '\\~a~', '\\=a=', '\\$a$', '\\^a', 'a\\^b', 'C:\\users\\name', 'path\\to\\file *x*',
  '\\(a\\) *b*', '\\(a *b* c\\)', '*\\(a\\)*', '\\(a\n\\)', '\\[a\\]b', '\\[a', '$$a$$$', '$$$$', '$$ $$', '$$a$ b$$', '$a\\$', '$a\\$b$', 'a$b$c', 'a $b$c', '$a$ $b$', '$a$$', '$$a', '$a$)', '$a$]', '$a$[', '$a$}', '$a$<', '$a$>', '$a$"', "$a$'", '$a$`', '$a$#', '$a$@', '$a$^', '$a$&', '$a$%', '$a$*', '$a$+', '$a$=', '$a$|', '$a$~', '$a$/', '$a$_', '$a$\\', '$a$é', '$a$—', '$a$\u00a0b', '$a$\u2003', '$a$\u200b', '$a; $', '$a;$', '$;a$', '$a,$', '$a.$', '$.a$', '$,a$', '$a $', '$ a$', '$a\t$', '$\ta$',
  // targets, links and footnotes
  '<<a>>>', '<<<a>>', '<<<a>>>>', '<<a>b>>', '<<a\nb>>', '<<a b>>', '<<a  b>>', '<< a>>', '<<a >>', '<<\ta>>', '<<>a>>', '<<a>>b', 'x<<a>>', '<<a>><<b>>', '<<<a>>><<<b>>>', '<<<a>>>x', '<<a>> *b*', '*<<a>>*', '<<*a*>>', '<<<*a*>>>',
  '[[a][b]] *c*', '[[a][*b*]]', '[[a][b *c* d]]', '[[a][b [[c]] d]]', '[[a][b]c]]', '[[a\\][b]]', '[[a\\\\][b]]', '[[a]\\]]', '[[a b][c d]]', '[[ a ]]', '[[a]]\n', '<https://x.org>', '<https://x.org> *b*', 'https://x.org *b*', '*https://x.org*', '_https://x.org_', 'a_https://x.org', 'https://x.org/a_b_c', 'https://x.org/*a*', 'https://x.org/~a~',
  '[fn:1] *b*', '[fn:1]*b*', '*b*[fn:1]', '[fn:a:b *c* d] e', '[fn::[[x][y]]]', '[fn:a:b]c]', '[fn:a:[b]]', '[fn:a:[b', '[fn:a:b\nc]', '[fn:1', 'fn:1', '[FN:1]', '[fn:1 ]', '[fn: 1]', '[fn:é]', '[fn:a.b]', '[fn:a-b]', '[fn:a_b]', '[fn:a:b:c]', '[fn:a::c]',
  '@@html:x@@', '@@html:*x*@@', '@@html:@@', '@@:x@@', '@@html:x@', '@@ht ml:x@@', '@@html-x:y@@', '{{{a}}}', '{{{a(*b*)}}}', '{{{a}}', '{{{}}}', '{{{1a}}}', '{{{a b}}}', '{{{a(b}}}', '<2026-01-01>', '<2026-01-01 Thu>', '[2026-01-01]', '[2026-01-01 *x*]', '<2026-01-01>--<2026-01-02>', '[1/2]', '[50%]', '[%]', '[/]', '*[1/2]*', '[1/2] *x*',
  'a^\\alpha', 'a^\\', 'a^\\1', 'a^_', 'a^_b', 'a^ b', 'a^é', 'a^(b)', 'a^-b', 'a^+', 'a^.', 'a^,', 'a^*b', 'a^{b}', 'a^[b]', 'a^<b>', 'a^$b$', 'a^\'b\'', 'a^"b"', 'x ^2', '^^2', '^-1', '^{2}', '^(2)', '^*', '^.', '^,', '^+',
];

// ---- affiliated keywords: the lines above a paragraph, then the text -------
const KEYS = ['NAME', 'CAPTION', 'HEADER', 'HEADERS', 'RESULTS', 'RESULT', 'DATA', 'PLOT', 'SOURCE', 'SRCNAME', 'TBLNAME', 'LABEL', 'RESNAME', 'ATTR_HTML', 'ATTR_ORG', 'ATTR_LATEX', 'ATTR_ODT', 'ATTR_X-Y', 'ATTR_', 'ATTR', 'TITLE', 'AUTHOR', 'OPTIONS', 'TBLFM', 'PROPERTY', 'BEGIN', 'END', 'INCLUDE', 'MACRO', 'FILETAGS', 'BIBLIOGRAPHY', 'ATTR_a1_b-c', 'attr_html', 'name', 'Caption', 'caption', 'results', 'Results'];
export const affiliatedCases = [];
for (const k of KEYS) {
  for (const v of ['v', 'a b c', '', ' ', ':width 3', 'x : y']) affiliatedCases.push(`#+${k}: ${v}\ntext`);
  affiliatedCases.push(`#+${k}:v\ntext`, `#+${k}:\ntext`, `#+${k}\ntext`, `  #+${k}: v\ntext`, `#+${k}[s]: v\ntext`, `#+${k}[]: v\ntext`, `#+${k}[a b]: v\ntext`, `#+${k} : v\ntext`, `#+ ${k}: v\ntext`, `# +${k}: v\ntext`, `#+${k}: v\n\ntext`, `#+${k}: v`, `#+${k}: v\n#+${k}: w\ntext`, `#+${k}: v\n# c\ntext`, `#+${k}: v\n#+TITLE: t\ntext`, `#+TITLE: t\n#+${k}: v\ntext`);
}
affiliatedCases.push('#+NAME: a\n#+CAPTION: b\n#+ATTR_HTML: :x y\n#+RESULTS:\ntext', '#+CAPTION[short]: long\n| a |', '#+NAME: t\n| a |', '#+NAME: t\n#+begin_src sh\nx\n#+end_src', '#+NAME: t\n- item', '#+NAME: t\n* heading', '#+NAME: t\n\n* heading', '#+CAPTION: c\n#+begin_example\nx\n#+end_example', '#+NAME: n\n[[file:a.png]]', '#+RESULTS:\n: out', '#+RESULTS: n\n: out', '#+RESULTS[hash]: n\n: out', '#+NAME: n\n: fixed', '#+NAME: n\n# comment', '#+NAME: n\n#+KEY: v', '#+CAPTION: a\n#+CAPTION: b\ntext', '#+HEADER: :a b\n#+HEADER: :c d\n#+begin_src sh\nx\n#+end_src', '#+NAME: n\n-----', '#+NAME: n\n\\begin{equation}\nx\n\\end{equation}');

// ---- #+ATTR_*: options -------------------------------------------------------
export const attrCases = [':width 300', ':width 300 :alt A cat', ':width 300 :align center', ':a', ':a :b', ':a b :c', ':a b c :d e f', ':a "b c"', ':a "b c" :d', ':a \'b\'', ':a (b c)', ':a ((b) c)', ':a b:c', ':a:b', 'a :b c', 'a b :c d', ':width', '', ' ', ':A b', ':a B', ':a-b c', ':a_b c', ':1 b', ':a 1', ':a -1', ':a :', ': a', '::a b', ':a  b', ':a\tb', ':width 300 :height 200', ':width 300px', ':width 50%', ':a b :a c', ':a "b', ':a b"', ':a "b" c', ':a ,b', ':a b,c', ':a nil', ':a t', ':a yes', ':a \\"', ':a :b "c :d"', ':a (:b c)', ':a [b]', ':a {b}', ':a <b>', ':a $b$', ':a *b*', ':a [[b]]', ':a ==', ':a -', ':a --', ':a ~'];

// ---- link types and paths ----------------------------------------------------
export const linkCases = [
  'https://x.org', 'http://x.org/a?b=c#d', 'ftp://h/f', 'mailto:a@b.c', 'mailto:a@b.c?subject=x', 'doi:10.1/x', 'news:comp.emacs', 'shell:ls', 'elisp:(foo)', 'help:org-mode', 'file:a.org', 'file:a.org::*h', 'file:a.org::12', 'file:a.org::/re/', 'file:a.org::(ref)', 'file:a.org::text', 'file:a.org::', 'file:~/a.org', 'file:/abs/a.org', 'file:./a.org', 'file:../a.org', 'file:a b.org', 'file+sys:a.org', 'file+emacs:a.org', 'file:a.org::*h::x', 'FILE:a.org', 'File:a.org',
  './a.org', '../a.org', '~/a.org', '/a.org', '/', './', '~/', '~', '~user/x', 'a.org', 'a/b.org', './a.org::*h', '/a.org::12', '~/a.org::/re/', '/a.org::',
  'id:abc-123', 'id:ABC', 'id:', 'id:abc::x', 'ID:abc', 'attachment:a.png', 'attachment:a/b.png', 'attachment:', 'attachment:a.org::*h',
  '#custom', '#', '#a b', '*heading', '* heading', '*', '*h::x', 'fuzzy words', 'a', 'a b', '(coderef)', '(', '()', '(a b)', 'x(y)', '#+name', 'a::b', 'a::*b', '::x', '*a*', '/a/', '_a_', 'a:b', 'a:', ':a', 'a: b', 'xyz:foo', 'tel:+1', 'git://x', 'ssh://h', 'file://x', 'C:\\x', 'a@b.c', 'www.x.org', 'x.org', 'HTTP://X.ORG', 'Https://x.org', 'mailto:', 'http:', 'http://', 'https:foo', 'doi:', 'shell:', 'elisp:', 'file:',
  'https://x.org/a b', 'https://x.org/a%20b', 'https://x.org/(a)', 'https://x.org/a_b', 'https://x.org/*a*', 'https://x.org/~a', 'https://x.org::a', 'file:a.org::*h c', 'file:a%20b.org', 'file:"a b.org"', 'file: a.org', ' file:a.org', 'file:a.org ', ' https://x.org', 'https://x.org ',
];

// ---- LaTeX environments at the start of a paragraph ---------------------------
export const envCases = [
  '\\begin{equation}\nx\n\\end{equation}', '\\begin{equation}\nx\n\\end{equation}\ntext', '  \\begin{equation}\nx\n\\end{equation}', '\\begin{equation}x\\end{equation}', '\\begin{equation}\n\\end{equation}', '\\begin{equation}', '\\begin{equation}\nx', '\\begin{equation}\nx\n\\end{align}', '\\begin{a}\nx\n\\end{a}', '\\begin{a*}\nx\n\\end{a*}', '\\begin{a-b}\nx\n\\end{a-b}', '\\begin{a_b}\nx\n\\end{a_b}', '\\begin{}\nx\n\\end{}', '\\begin{align*}\na &= b \\\\\nc &= d\n\\end{align*}', '\\begin{align}\n\\begin{aligned}\nx\n\\end{aligned}\n\\end{align}', '\\begin{a}\nx\n\\end{a}\n\\end{a}', '\\begin{a}\n\\begin{a}\nx\n\\end{a}', 'x\n\\begin{a}\ny\n\\end{a}', 'x \\begin{a}\ny\n\\end{a}', '\\begin{a} x\ny\n\\end{a}', '\\begin{a}\ny\n\\end{a} x', '\\begin{a}\ny\n\\end{a}  ', '\\begin{a}\ny\n  \\end{a}', '\\begin{a}\ny\n\\end{a}\n\n\\begin{b}\nz\n\\end{b}', '\\begin{A}\nx\n\\end{a}', '\\begin{a}\n\ny\n\\end{a}', '\\begin{a}\n*b*\n\\end{a}', '\\BEGIN{a}\nx\n\\END{a}', '\\begin {a}\nx\n\\end{a}', '\\begin{a}  \nx\n\\end{a}', '\\begin{a}\n#+end_src\n\\end{a}', '\\begin{1}\nx\n\\end{1}', '\\begin{a b}\nx\n\\end{a b}',
];
