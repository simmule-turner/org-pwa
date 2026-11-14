// The corpus for tools/gen-oracle-tables.mjs: tables with #+TBLFM lines (and #+CONSTANTS), as org text. Emacs runs
// org-table-recalculate-buffer-tables on each; test/oracle-tables.test.js holds the app to the result.
const T = (rows, tblfm, extra = '') => rows.map((r) => (r === '-' ? '|---+---+---|' : '| ' + (Array.isArray(r) ? r : [r]).join(' | ') + ' |')).join('\n') + '\n#+TBLFM: ' + tblfm + (extra ? '\n' + extra : '');
const NUM = [['1', '2', ''], ['3', '4', ''], ['5', '6', '']];
const HDR = [['a', 'b', 'c'], '-', ['1', '2', ''], ['3', '4', ''], ['5', '6', '']];
const cases = [];
const add = (org) => cases.push(org);

// arithmetic and precedence, every operator, unary signs, parentheses, floats, negatives
const exprs = ['$1+$2', '$1-$2', '$1*$2', '$1/$2', '$1^$2', '$1%$2', '$1+$2*3', '($1+$2)*3', '-$1', '+$1', '--$1', '2^3^2', '2^-1', '-2^2', '1/3', '2/4', '10/4', '10/5', '7%3', '-7%3', '7%-3', '1e3', '1.5e2', '1.5+1.5', '0.1+0.2', '1/0', '0/0', '0*$1', '$1/0', '3 4', '3.', '.5', '5.', '1_000', '0x10', '16#ff', '2#101+1', '8#17', '16#FF*2', '-16#ff', '16#1.8+1', '2#1.1', '2#102', '37#1', '1#1', '36#zz', '$1*2#11', '1,5', '$1 + $2', '( $1 )', '(($1))', '$1)', '($1', '$1+', '*2', '', ' ', '$', '$0', '$9', '$-1', '@', '@0', '@9$1', '@1$9', 'x', 'foo(1)', '1+x', 'pi', 'e', 'pi*2', 'e^2', '2*pi', 'inf', 'nan', 'uinf', '-inf', '1.0', '100.0', '1.50', '123456789*987654321', '2^100', '2^0.5', '9^0.5', '(-8)^(1/3)', '1000000*1000000', '0.000001', '1e-7', '12345678901234567890'];
for (const e of exprs) { add(T(NUM, `$3=${e}`)); }
for (const e of exprs.slice(0, 20)) { add(T(NUM, `@2$3=${e}`)); add(T(HDR, `$3=${e}`)); }

// calc functions
const fns = ['abs', 'sqrt', 'exp', 'ln', 'log10', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'floor', 'ceil', 'round', 'trunc', 'fact', 'float', 'neg', 'sign', 'arg', 'cbrt', 'inv', 'frac', 'ip', 'fp', 'rad', 'deg', 'hms', 'idiv', 'percent'];
for (const f of fns) { add(T(NUM, `$3=${f}($1)`)); add(T([['-2.5', ''], ['0', ''], ['10', '']], `$2=${f}($1)`)); }
const fns2 = ['max', 'min', 'mod', 'idiv', 'pow', 'atan2', 'gcd', 'lcm', 'choose', 'perm', 'log', 'rnd', 'round', 'floor', 'ceil', 'trunc', 'vec', 'cons', 'append', 'rdup'];
for (const f of fns2) { add(T(NUM, `$3=${f}($1,$2)`)); add(T([['7', '-3', ''], ['0', '5', ''], ['2.5', '0.5', '']], `$3=${f}($1,$2)`)); }
const vfns = ['vsum', 'vmean', 'vmax', 'vmin', 'vcount', 'vmedian', 'vprod', 'vsdev', 'vvar', 'vpsdev', 'vpvar', 'vmeane', 'vmeane', 'vgeo', 'vhar', 'vrms', 'vmad', 'vcorr', 'vcov', 'vsort', 'vrev', 'vlen', 'vunion', 'vint', 'vdiff', 'vcum', 'vpcov', 'vflat', 'vcnt', 'sum', 'mean', 'count', 'min', 'max', 'median', 'prod', 'sdev', 'var'];
for (const f of vfns) {
  add(T(HDR, `@4$3=${f}(@2$1..@4$1)`));
  add(T(NUM, `@3$3=${f}(@1$1..@2$1)`));
  add(T(NUM, `@3$3=${f}(@1$1..@2$2)`));
  add(T(NUM, `$3=${f}($1..$2)`));
  add(T(NUM, `@1$3=${f}(@<$1..@>$1)`));
  add(T([['1', ''], ['', ''], ['x', ''], ['4', '']], `@4$2=${f}(@1$1..@3$1)`));
  add(T([['1', ''], ['', ''], ['x', ''], ['4', '']], `@4$2=${f}(@1$1..@3$1);N`));
  add(T([['1', ''], ['', ''], ['x', ''], ['4', '']], `@4$2=${f}(@1$1..@3$1);E`));
  add(T([['1', ''], ['', ''], ['x', ''], ['4', '']], `@4$2=${f}(@1$1..@3$1);L`));
  add(T([['1', ''], ['', ''], ['x', ''], ['4', '']], `@4$2=${f}(@1$1..@3$1);D`));
}
add(T(NUM, '@3$3=vsum(@1..@2)'));
add(T(NUM, '@3$3=vsum(@-2..@-1)'));
add(T(NUM, '@3$3=vsum(@-2$2..@-1$2)'));
add(T(NUM, '@3$3=vsum($1..$2)'));
add(T(NUM, '@3$3=vsum(@<<..@>>)'));
add(T(HDR, '@4$3=vsum(@I..@II)'));
add(T(HDR, '@4$3=vsum(@I..@>)'));
add(T(HDR, '@4$3=vsum(@>>..@>)'));
add(T([['a'], '-', ['1'], ['2'], '-', ['3'], ['4'], ''], '@6$1=vsum(@II..@III)'));
add(T([['a'], '-', ['1'], ['2'], '-', ['3'], ['4'], ['']], '@6$1=vsum(@I..@II)'));
add(T([['a'], '-', ['1'], ['2'], '-', ['3'], ['4'], ['']], '@6$1=vsum(@-I..@-II)'));
add(T([['a'], '-', ['1'], ['2'], '-', ['3'], ['4'], ['']], '@6$1=vsum(@+I..@+II)'));
add(T(HDR, '@I$1=5'));
add(T(HDR, '@II$1=5'));
add(T(HDR, '@III$1=5'));
add(T(HDR, '@0$1=5'));
add(T(HDR, '@0=5'));
add(T(HDR, '$3=@0'));

// references
const refs = ['$1', '$2', '$3', '$<', '$>', '$<<', '$>>', '@1$1', '@2$1', '@>$1', '@<$1', '@>>$1', '@<<$1', '@-1$1', '@+1$1', '@-2$1', '@+2$1', '@-1', '@+1', '@I$1', '@II$1', '@-I$1', '@+I$1', '@2', '$-1', '$+1', '@I', '@II', '@2$1..@3$2', '@2..@3', '$1..$2', '@I..@II', '@<..@>', 'string($1)', '"x"', "'x'", '$1$2', '@2$1@3$1', 'vec($1,$2)', '[1,2,3]', 'vsum([1,2,3])', '[$1,$2]'];
for (const r of refs) { add(T(HDR, `$3=${r}`)); add(T(HDR, `@4$3=${r}`)); }
for (const r of ['$1', '@>$1', '@-1$3', '@<$1']) add(T(HDR, `@3$3=${r}`));
add(T(HDR, '@2$3=@>$3'));
add(T(HDR, '@2$3=@<$3'));
add(T(HDR, '@2$3=$3'));
add(T(HDR, '$3=$3+1'));
add(T(HDR, '$3=@-1$3+1'));
add(T(HDR, '@3$3=@-1$3+1::@2$3=7'));
add(T(HDR, '@2$3=@3$3::@3$3=5'));
add(T(HDR, '@2$3=@3$3+1::@3$3=5+1'));

// targets
const targets = ['$3', '$1', '$2', '$4', '$9', '$>', '$<', '$-1', '@2', '@3', '@>', '@<', '@2$3', '@>$3', '@<$3', '@-1$3', '@I$3', '@2$>', '@2$<', '@2$3..@4$3', '@2..@4', '$1..$2', '@2$1..@3$2', '@I..@II', '@II..@III', '@I', '@II', '@1', '@0', '@9', '$0', '@9$1', '@2$9', '@2$0', '@>>$1', '@<<$1', '@>>', '@<<'];
for (const tg of targets) { add(T(HDR, `${tg}=7`)); add(T(NUM, `${tg}=$1+1`)); add(T(HDR, `${tg}='(+ 1 2)`)); }

// modes and formats
const modes = ['N', 'E', 'L', 'D', 'T', 't', 'U', 'p5', 'p20', 's', 'n3', 'n0', 'f0', 'f1', 'f2', 'f5', 'e0', 'e2', 'e5', 'g', 'g3', '%.3f', '%5.1f', '%d', '%s', '%x', '%e', '%g', '%03d', '%-5d|', 'R', 'S', 'p2 f2', 'N f2', 'N;D', 'T N', 'E f1', 'L N', 'f2 E', '', ' ', 'zz', 'f', 'e', 'n', 'p', 'f-1', 'f100', 'f2 f3', '%.0f', '%.10f', '%i', '%c', 'N%.2f', 'T%.1f'];
for (const m of modes) {
  add(T([['1', '2', '3'], ['10', '20', '30'], ['1.2345678', '0.5', 'x']], `$3=$1/$2;${m}`));
  add(T([['1:30', '2:15', ''], ['0:45', '12:00:30', '']], `$3=$1+$2;${m}`));
}
const nums = ['0', '1', '-1', '1.5', '-1.5', '0.5', '1/3', '2/3', '123456.789', '1e10', '1e-5', '12345678.9', '0.000123', '1e21', '1e100', '99999999999999999', '100', '1000000'];
for (const n of nums) for (const m of ['', 'f2', 'e2', 'n3', 's3', '%.3f', 'N', 'p3']) add(T([['']], `$1=${n}${m ? ';' + m : ''}`));

// dates and times
const dates = [['<2024-03-15 Fri>', '<2024-03-20 Wed>', ''], ['[2024-03-15 Fri 10:00]', '[2024-03-15 Fri 12:30]', ''], ['2024-03-15', '2024-03-20', ''], ['<2024-02-28 Wed>', '<2024-03-01 Fri>', '']];
for (const f of ['$2-$1', '$1+1', '$1+30', '$1-1', '$2+$1', '$1*2', 'date($1)', 'date($1)+1', 'date($2)-date($1)', '$1+0.5', 'now', 'daysto($1)', 'weekday($1)', 'time($1)', 'hms($1)', '$1<$2', '$1==$2', '$1<=$2', '$1>$2', 'if($1<$2,1,2)', 'if($1,1,2)', 'if(0,1,2)', 'if(1,1)', 'if()', 'ifnull(1)', '$1 && $2', '$1 || $2', '!$1', '$1 != $2', '$1 >= $2', '1 < 2 < 3', 'and(1,0)', 'or(1,0)', 'not(1)', 'xor(1,0)', 'lnot(0)', 'land(1,1)', 'lor(0,0)']) {
  for (const m of ['', 'T', 'N']) for (const row of dates) add(T([row], `$3=${f}${m ? ';' + m : ''}`));
}
const times = [['1:30', '2:15', ''], ['0:45', '12:00:30', ''], ['100:00', '0:01', ''], ['-1:30', '0:30', ''], ['1:30:15', '0:00:45', ''], ['0', '0', ''], ['1.5', '2.25', ''], ['25:61', '0:0', ''], ['1:2:3:4', '1:', ''], [':30', '30:', '']];
for (const f of ['$1+$2', '$1-$2', '$1*2', '$1/2', '$1+1', '$1', '$2', '$1/$2', '$2/$1', 'vsum($1..$2)', 'vmean($1..$2)', '$1*$2', '60*$1']) for (const m of ['', 'T', 'U', 't', 'N', 'p3']) for (const row of times) add(T([row], `$3=${f}${m ? ';' + m : ''}`));
for (const f of ['$1+$2', 'vsum(@1$1..@2$1)']) add(T([['1:30', ''], ['0:45', '']], `${f.startsWith('v') ? '@3$1' : '$2'}=${f};T`, '#+TBLFM: placeholder').replace('\n#+TBLFM: placeholder', ''));

// text, strings, equality
for (const f of ['string($1)', 'string($1)+1', '"a"+"b"', '$1 == "x"', 'string($1) == "x"', 'string($1)==string($2)', 'len($1)', 'concat($1,$2)', 'upper($1)', 'lower($1)', 'vec($1)', '$1+1', '$1*2', '$1 == 1', '$1 == $2', 'if($1 == "x", 1, 2)', 'if(string($1) == "x", 1, 2)']) {
  for (const row of [['x', 'y', ''], ['1', '1', ''], ['', '', ''], ['1.0', '1', ''], ['abc', '12', ''], [' 5 ', '6', ''], ['1e2', '100', ''], ['0x10', '16', ''], ['16#ff', '2', ''], ['2#101', '2', ''], ['8#17', '1', ''], ['16#1.8', '2', ''], ['2#102', '2', ''], ['1,000', '2', ''], ['$5', '3', ''], ['5%', '3', ''], ['<5>', '3', '']]) add(T([row], `$3=${f}`));
}
add(T([['x', 'y', ''], ['1', '2', ''], ['3', '4', '']], '$3=$1+$2;N'));
add(T([['x', '2', ''], ['1', '', ''], ['', '3', '']], '$3=$1+$2'));
add(T([['x', '2', ''], ['1', '', ''], ['', '3', '']], '$3=$1+$2;E'));
add(T([['x', '2', ''], ['1', '', ''], ['', '3', '']], '$3=$1+$2;N'));
add(T([['x', '2', ''], ['1', '', ''], ['', '3', '']], '$3=$1+$2;L'));
add(T([['x', '2', ''], ['1', '', ''], ['', '3', '']], '$3=$1+$2;D'));
add(T([['x', '2', ''], ['1', '', ''], ['', '3', '']], '$3=$1+$2;T'));
add(T([['x', '2', ''], ['1', '', ''], ['', '3', '']], '$3=$1+$2;U'));

// lisp
for (const f of ["'(+ $1 $2)", "'(* 2 $1)", "'(concat $1 $2)", "'(format \"%s-%s\" $1 $2)", "'(identity \"x\")", "'(if (> $1 2) \"big\" \"small\")", "'(+ 1", "'(error \"boom\")", "'(foo)", "'(string-to-number $1)", "'(/ $1 0)", "'(list 1 2)", "'(quote x)", "'(setq x 1)", "'(length $1)", "'(+ @1$1 @2$1)", "'(vsum $1)", "'(orgtbl-ascii-draw $1 0 10 12)", "'(orgtbl-ascii-draw $1 0 10 12 \"ab\")", "'(orgtbl-ascii-draw $1 0 3 5)", "'(orgtbl-ascii-draw -1 0 10 12)", "'(orgtbl-ascii-draw 20 0 10 12)", "'(orgtbl-ascii-draw 5 0 10)", "'(org-sbe)", "'nil", "'t", "'()", "'\"s\"", "'1", "'1.5", "'(round 2.5)", "'(float-time)"]) {
  add(T(NUM, `$3=${f}`));
  add(T(NUM, `$3=${f};N`));
  add(T(NUM, `$3=${f};E`));
}
for (const f of ['(+ $1 $2)', '(* 2 $1)']) add(T(NUM, `$3=${f}`));
add(T(NUM, '$3=($1)'));
add(T([['x', 'y', ''], ['a', 'b', '']], "$3='(concat $1 $2)"));
add(T([['x', 'y', ''], ['a', 'b', '']], "$3='(concat \"<\" $1 $2 \">\")"));
add(T([['x', 'y', ''], ['3', '4', '']], "$3='(+ (string-to-number $1) $2)"));
add(T([['x', 'y', ''], ['3', '4', '']], "$3='(+ $1 $2);N"));
add(T([['x', 'y', ''], ['3', '4', '']], "$3='(+ (string-to-number $1) 1);p3"));

// constants
const C = '#+CONSTANTS: c=299792458 g=9.81 pi2=6.28 a_b=3 z=0 neg=-4 f=1.5e3\n';
for (const f of ['$c', '$g', '$g*2', '$c/1000', '$pi2', '$a_b', '$z', '$neg', '$f', '$unknown', '$c+$1', '$1*$g', '$g;f1', '$c;e3', '$2*$c', 'vsum($c,$g)', 'sqrt($g)', '$cc', '$_', '$A', '$G', 'pi', 'e']) add(C + T(NUM, `$3=${f}`));
add('#+CONSTANTS: c=1\n#+CONSTANTS: d=2\n' + T(NUM, '$3=$c+$d'));
add('#+CONSTANTS: c=1 c=2\n' + T(NUM, '$3=$c'));
add('#+CONSTANTS: c=1 d\n' + T(NUM, '$3=$c'));
add('#+CONSTANTS: c=x\n' + T(NUM, '$3=$c'));
add('#+CONSTANTS: c=1+1\n' + T(NUM, '$3=$c'));
add('#+CONSTANTS: c=299792458 m/s\n' + T(NUM, '$3=$c'));
add('#+constants: c=5\n' + T(NUM, '$3=$c'));
add('#+CONSTANTS:\n' + T(NUM, '$3=$c'));

// structure: multiple formulas, order, rows, columns, hlines
add(T(HDR, '$3=$1+$2::@2$3=100'));
add(T(HDR, '@2$3=100::$3=$1+$2'));
add(T(HDR, '$3=$1+$2::$1=$1*2'));
add(T(HDR, '$1=$1*2::$3=$1+$2'));
add(T(HDR, '$2=$1*2::$1=7'));
add(T(HDR, '$1=7::$2=$1*2'));
add(T(HDR, '$3=$2+1::$2=$1+1'));
add(T(HDR, '$2=$1+1::$3=$2+1'));
add(T(HDR, '@3=$1+$2'));
add(T(HDR, '@3=7'));
add(T(HDR, '@3$2..@4$3=1'));
add(T(HDR, '@2$1..@4$1=$2'));
add(T(HDR, '@3$>=5'));
add(T(HDR, '@>$>=5'));
add(T(HDR, '@<$<=5'));
add(T(HDR, '@>=1'));
add(T(HDR, '$>=$1'));
add(T(HDR, '$3=$1;$3=$2'));
add(T(HDR, '$3=$1::$3=$2'));
add(T(HDR, '$3=$1+$2::'));
add(T(HDR, '::$3=$1'));
add(T(HDR, '$3'));
add(T(HDR, '='));
add(T(HDR, '$3='));
add(T(HDR, '=5'));
add(T(HDR, '@=5'));
add(T(HDR, '$ 3=5'));
add(T(HDR, '$3 = $1 + $2'));
add(T(HDR, '$3=$1+$2 '));
add(T(HDR, '  $3=$1+$2'));
add(T(HDR, '$3==5'));
add(T(HDR, '$3=5=6'));
add(T(HDR, '$3=$1=$2'));
add(T(HDR, '$3=$1;;N'));
add(T(HDR, '$3=$1;N;'));
add(T(HDR, '@2$3=$1\n#+TBLFM: @3$3=$2'));
add(T(HDR, '$3=$1') + '\n#+TBLFM: $3=$2');
add(T(HDR, '$3=$1+1') + '\n\n| x | y |\n|---+---|\n| 1 | 2 |\n#+TBLFM: $2=$1*2');
add(T([['a']], '$2=1'));
add(T([['a', 'b']], '$1=$2'));
add(T([['a', 'b']], '@2=1'));
add(T([['1', '2'], '-', ['3', '4'], '-'], '@3$1=5'));
add(T([['1', '2'], '-', '-', ['3', '4']], '@>$1=5'));
add(T(['-', ['1', '2']], '@1$1=5'));
add(T([['1', '2'], ['3']], '$2=$1+1'));
add(T([['1'], ['3', '4', '5']], '$3=$1+1'));
add(T([['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']], '$13=$10+$11+$12'));
add(T([['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']], '$12=$10+$11'));
add(T([['', '', '']], '$1=1'));
add(T([['', '', '']], '$2=$1'));
add(T([['1', '', '']], '$2=$1'));
add(T([['1', '', ''], ['2', '', ''], ['3', '', '']], '$2=@-1$1'));
add(T([['1', '', ''], ['2', '', ''], ['3', '', '']], '$2=@-1$2+1'));
add(T([['1', '', ''], ['2', '', ''], ['3', '', '']], '$2=@+1$1'));
add(T([['1', '', ''], ['2', '', ''], ['3', '', '']], '$2=@-1$1+@+1$1'));
add(T([['1', '', ''], ['2', '', ''], ['3', '', '']], '@2$2=@-1$1+@+1$1'));
add(T([['1', '', ''], ['2', '', ''], ['3', '', '']], '$2=vsum(@-1..@+1)'));
add(T([['1', '', ''], ['2', '', ''], ['3', '', '']], '$2=vsum(@<..@-1)'));
add(T([['1', '', ''], ['2', '', ''], ['3', '', '']], '$2=vsum(@<..@>)'));
add(T([['1', '', ''], ['2', '', ''], ['3', '', '']], '@>$2=vsum(@<..@-1)'));
add(T([['1', '', ''], '-', ['2', '', ''], ['3', '', '']], '$2=@I$1'));
add(T([['1', '', ''], '-', ['2', '', ''], ['3', '', '']], '$2=@-I$1'));
add(T([['1', '', ''], '-', ['2', '', ''], ['3', '', '']], '$2=@+I$1'));
add(T([['1', '', ''], '-', ['2', '', ''], ['3', '', '']], '$2=@-I'));
add(T([['1', '', ''], '-', ['2', '', ''], ['3', '', '']], '$2=@1$1'));

// whitespace, alignment, widths, unicode, special cell text
add('| a | b |\n|---+---|\n| 日本 | 1 |\n| xx | 22 |\n#+TBLFM: $2=$2+1');
add('| a | b |\n|---+---|\n| <5> | <r> |\n| xx | 22 |\n#+TBLFM: $2=$2+1');
add('| a | b |\n|-|-|\n| 1 | 2 |\n#+TBLFM: $2=$2+1');
add('|a|b|\n|-|-|\n|1|2|\n#+TBLFM: $2=$2+1');
add('| a | b |\n|---+---|\n| 1 | 2 |\n#+TBLFM: $2=$2+1\n#+TBLFM: $1=$1+1');
add('  | a | b |\n  |---+---|\n  | 1 | 2 |\n  #+TBLFM: $2=$2+1');
add('| a | b |\n|---+---|\n| 1 | 2 |\n\n#+TBLFM: $2=$2+1');
add('| a | b |\n|---+---|\n| 1 | 2 |\n#+tblfm: $2=$2+1');
add('| a | b |\n|---+---|\n| 1 | 2 |\n#+NAME: t\n#+TBLFM: $2=$2+1');
add('#+NAME: t\n| a | b |\n|---+---|\n| 1 | 2 |\n#+TBLFM: $2=$2+1');
add('#+NAME: t\n| a | b |\n|---+---|\n| 1 | 2 |\n#+TBLFM: $2=remote(t,@2$1)');
add('#+NAME: t\n| a | b |\n|---+---|\n| 1 | 2 |\n\n| x | y |\n|---+---|\n| 0 | 0 |\n#+TBLFM: $2=remote(t,@2$1)');
add('#+NAME: t\n| a | b |\n|---+---|\n| 1 | 2 |\n\n| x | y |\n|---+---|\n| 0 | 0 |\n#+TBLFM: $2=remote(t,@2$1)+remote(t,@2$2)');
add('#+NAME: t\n| a | b |\n|---+---|\n| 1 | 2 |\n\n| x | y |\n|---+---|\n| 0 | 0 |\n#+TBLFM: $2=vsum(remote(t,@2$1..@2$2))');
add('| x | y |\n|---+---|\n| 0 | 0 |\n#+TBLFM: $2=remote(nope,@2$1)');
add('| a | b |\n|---+---|\n| <2024-03-15 Fri> | 2 |\n#+TBLFM: $2=$1+1');
add('| a | b |\n|---+---|\n| =1+1 | 2 |\n#+TBLFM: $2=$1+1');
add('| a | b |\n|---+---|\n| #ERROR | 2 |\n#+TBLFM: $2=$1+1');
add('| a | b |\n|---+---|\n| [[x][1]] | 2 |\n#+TBLFM: $2=$1+1');
add('| a | b |\n|---+---|\n| *1* | 2 |\n#+TBLFM: $2=$1+1');
add('| a | b |\n|---+---|\n| 1 \\vert 2 | 2 |\n#+TBLFM: $2=$1+1');
add('| a | b |\n|---+---|\n| -- | 2 |\n#+TBLFM: $2=$1+1');
add('| a | b |\n|---+---|\n| - | 2 |\n#+TBLFM: $2=$1+1');
add('| a | b |\n|---+---|\n| nan | 2 |\n#+TBLFM: $2=$1+1');
add('| a | b |\n|---+---|\n| inf | 2 |\n#+TBLFM: $2=$1+1');
add('| a | b |\n|---+---|\n| 1/2 | 2 |\n#+TBLFM: $2=$1+1');
add('| a | b |\n|---+---|\n| 1:2 | 2 |\n#+TBLFM: $2=$1+1');
add('| a | b |\n|---+---|\n| 2e3 | 2 |\n#+TBLFM: $2=$1+1');
add('| a | b |\n|---+---|\n| 2.5k | 2 |\n#+TBLFM: $2=$1+1');
add('| a | b |\n|---+---|\n| 50% | 2 |\n#+TBLFM: $2=$1+1');
add('| a | b |\n|---+---|\n| (1) | 2 |\n#+TBLFM: $2=$1+1');
add('| a | b |\n|---+---|\n| -1 | 2 |\n#+TBLFM: $2=$1+1');
add('| a | b |\n|---+---|\n| +1 | 2 |\n#+TBLFM: $2=$1+1');
add('| a | b |\n|---+---|\n| .5 | 2 |\n#+TBLFM: $2=$1+1');
add('| a | b |\n|---+---|\n| 5. | 2 |\n#+TBLFM: $2=$1+1');
add('| a | b |\n|---+---|\n| 1 2 | 2 |\n#+TBLFM: $2=$1+1');
add('| a | b |\n|---+---|\n| 1,5 | 2 |\n#+TBLFM: $2=$1+1');
add('| a | b |\n|---+---|\n| 1_0 | 2 |\n#+TBLFM: $2=$1+1');
add('| a | b |\n|---+---|\n| 1e | 2 |\n#+TBLFM: $2=$1+1');

// column/field names via _ and ^ rows, # and * marks
add('| ! | a | b |\n|---+---+---|\n| # | 1 | 2 |\n| # | 3 | 4 |\n#+TBLFM: $3=$a*2');
add('| ! | a | b |\n| _ | x | y |\n|---+---+---|\n| # | 1 | 2 |\n#+TBLFM: $y=$x*2');
add('| ! | a | b |\n|---+---+---|\n| # | 1 | 2 |\n| * | 3 | 4 |\n#+TBLFM: $3=$1+$2');
add('| / | a | b |\n|---+---+---|\n| # | 1 | 2 |\n| $ | 3 | 4 |\n#+TBLFM: $3=$1+$2');
add('| / | < | > |\n| # | 1 | 2 |\n| # | 3 | 4 |\n#+TBLFM: $3=$2');
add('| # | 1 | |\n| * | 3 | |\n| ^ | n | |\n| # | 5 | |\n#+TBLFM: $3=$2*2');
add('| # | 1 | |\n| $ | n | |\n#+TBLFM: $3=$2*2');
add('| # | 1 | |\n| # | 2 | |\n| # | 3 | |\n#+TBLFM: @2$3=@-1$2');
add('| # | 1 | |\n| # | 2 | |\n| # | 3 | |\n#+TBLFM: @2$3=@-1$2::@3$3=@-1$3');
add('| ! | a | b |\n|---+---+---|\n| # | 1 | 2 |\n#+TBLFM: $b=$a+1;N');
add('| ! | a | b |\n|---+---+---|\n| # | 1 | 2 |\n#+TBLFM: $3=$a+$b');
add('| ! | a | b |\n|---+---+---|\n| # | 1 | 2 |\n#+TBLFM: @2$b=7');
add('| ! | a | b |\n| _ | a | b |\n|---+---+---|\n| # | 1 | 2 |\n#+TBLFM: $b=$a*3');
add('| ! | a | b |\n| _ | a | b |\n|---+---+---|\n| # | 1 | 2 |\n#+TBLFM: $c=$a*3');

// the number of the row (@#) and of the column ($#) of the field being set
for (const e of ['@#', '@#-1', '@#*2', '$#', '$#+@#', '$1+@#', 'if(@# == 2, 7, 8)', 'if(round($2/3) == 1, 0, round($2/3))', "'(+ @# 1)", "'(+ $# 1)"]) { add(T(NUM, `$3=${e}`)); add(T(HDR, `$3=${e}`)); add(T(NUM, `@2$3=${e}`)); }
add(T([['a', 'b'], '-', ['', '5'], ['', '7']], '$1=@#-1'));
add('|   | 5 |\n|---+---|\n|   | 7 |\n#+TBLFM: $1=@#-1');
add('|   | 5 |\n|   | 7 |\n#+TBLFM: $1=@#');


// string(), typeof(), subvec() and vlen(), with the fields pasted into quoted text as Org does
for (const e of ['string("")', 'string("a b")', 'string([97,98])', 'string(5)', 'string($1)', 'typeof($1)', 'typeof($2)', 'typeof(1.5)', 'typeof(2.)', 'typeof(nan)', 'typeof(inf)', 'typeof(-inf)', 'typeof([1,2])', 'typeof([[1,2],[3,4]])', 'typeof("a")', 'subvec([1,2,3,4],2,4)', 'subvec([1,2,3,4],2)', 'subvec([1,2,3,4],-2)', 'subvec([1,2,3,4],0,0)', 'subvec([1,2,3,4],5)', 'subvec([1,2,3],-1,0)', 'subvec("$1",1,2)', 'string(subvec("$1", 2, vlen("$1")))', 'vlen("abc")', 'vlen("$1")', 'vlen(5)', 'vlen([])', 'vlen([[1,2],[3,4]])', 'vlen($1..$2)', 'if(typeof($1) == 12, string(""), $1)', 'if("$1" == "(1)", string("one"), string("other"))', 'if("$2" == "nan", string(""), $2 + 1)', '"$1" == "(1)"', '"$1..$2" == "[1,2]"', '"@0$1..@0$2" == "[1,2]"', '"$#" == "3"', 'if(1, x, string(""))', 'if(0, x, string(""))']) {
  add(T(NUM, `$3=${e}`));
  add(T([['1', '', ''], ['', '2', ''], ['', '', '']], `$3=${e}; E`));
  add(T([['1', '', ''], ['', '2', ''], ['', '', '']], `$3=${e}; EN`));
  add(T([['1', '', ''], ['', '2', ''], ['', '', '']], `$3=${e}; N`));
}
// empty fields in range references with E, and Lisp formulas with the L, N and E flags
for (const e of ["if(typeof(vmean($1..$2)) == 12, string(\"\"), vmean($1..$2))", "if(\"$1..$2\" == \"[]\", string(\"\"), vmean($1..$2))", 'vlen($1..$2)', 'vsum($1..$2)', 'vmean(@0$1..@0$2)']) {
  for (const flags of ['', '; E', '; N', '; EN']) add(T([['1', '2', ''], ['', '4', ''], ['', '', '']], `$3=${e}${flags}`));
}
for (const e of ["'(identity $1)", "'(+ $1 $2)", "'(+ $1..$2)", "'(length '($1..$2))", "'(type-of $1)", "'(type-of @1)", "'(identity @1)", "'(if (eq \"$1\" \"\") \"\" (1+ $1))", "'(concat \"$1\" \"-\" \"$2\")", "'(@0$1)", "'(org-lookup-first $1 '($1 $2) '(7 8))"]) {
  for (const flags of ['', '; L', '; N', '; E', '; EN', '; EL']) add(T([['1', '2', ''], ['', '4', ''], ['z', '', ''], ['', '', '']], `$3=${e}${flags}`));
}
add('| nil | (list) | \'() |\n|-----+--------+-----|\n| r | r | r |\n| r | r | r |\n#+TBLFM: @2$<<..@2$> = \'(type-of @1) :: @3$<<..@3$> = \'(identity @1); L');
add('| type-of @1 | nil | (list) | \'() |\n| identity "@1" | nil | (list) | \'() |\n| identity @1 | nil | (list) | \'() |\n#+TBLFM: @<<$2..@>$> = \'(@0$1); L');
// the sub-total example of the Org manual
add('|-------+---------+---------|\n| Item  |    Item | Sub-    |\n| name  |   value | total   |\n|-------+---------+---------|\n| a1    |     4.1 | replace |\n| a2    |     8.2 | replace |\n| a3    |         | replace |\n|-------+---------+---------|\n| b1    |    16.0 | replace |\n|-------+---------+---------|\n| c1    |      32 | replace |\n| c2    |      64 | replace |\n|-------+---------+---------|\n| Total | replace | replace |\n|-------+---------+---------|\n#+TBLFM: @>$2 = vsum(@II..@>>) :: $3 = if(vlen(@0..@+I) == 1, vsum(@-I$2..@+I$2) +.0, string("")); EN f-1 :: @>$3 = string("")');
for (const f of ['$3=vlen(@0..@+I)', '$3=vlen(@II..@>>)', '@>$3=vlen(@-I$2..@+I$2)', '@2$3=vlen(@I..@II)', '@>$3=vlen(@II..@>>);N']) add('|-----+---+---|\n| a | 1 | |\n|-----+---+---|\n| b | 2 | |\n| c | | |\n|-----+---+---|\n| d | 3 | |\n#+TBLFM: ' + f);
// where the header ends: a hline at the top starts none, and one with no row below ends none
add('|---+---|\n| a | |\n| b | |\n#+TBLFM: $2=1');
add('| a | |\n|---+---|\n#+TBLFM: $2=1');
add('|---+---|\n| a | |\n|---+---|\n| b | |\n#+TBLFM: $2=1');
add('| a | |\n|---+---|\n| b | |\n#+TBLFM: $2=1');
// $PROP_name: a property of the entry, inherited, and the #+PROPERTY: lines
add('* H\n  :PROPERTIES:\n  :time_constant: 08:00:00\n  :END:\n\n  |  |\n  #+TBLFM: $1=2*$PROP_time_constant;T');
add('* H\n  :PROPERTIES:\n  :time_constant: 08:00:00\n  :END:\n\n  |  |\n  #+TBLFM: $1=2*$PROP_time_constant;t');
add('* H\n  :PROPERTIES:\n  :Factor: 3\n  :END:\n** Child\n   | 2 |  |\n   #+TBLFM: $2=$1*$PROP_factor');
add('#+PROPERTY: factor 5\n* H\n| 2 |  |\n#+TBLFM: $2=$1*$PROP_factor');
add('* H\n  :PROPERTIES:\n  :Factor: 3\n  :Factor+: 4\n  :END:\n| 2 |  |\n#+TBLFM: $2=$PROP_factor');
add('* H\n| 2 |  |\n#+TBLFM: $2=$PROP_nothere');
add('* H\n  :PROPERTIES:\n  :txt: abc\n  :END:\n| 2 |  |\n#+TBLFM: $2=$PROP_txt');
add('* H\n  :PROPERTIES:\n  :n: 1.5\n  :END:\n| 2 |  |\n#+TBLFM: $2=$PROP_n + $1');
add("* H\n  :PROPERTIES:\n  :n: 7\n  :END:\n| 2 |  |\n#+TBLFM: $2='(+ 1 $PROP_n)");
add('#+CONSTANTS: n=9\n* H\n  :PROPERTIES:\n  :n: 7\n  :END:\n| 2 |  |\n#+TBLFM: $2=$PROP_n+$n');
add("#+CONSTANTS: n=9\n| 2 |  |\n#+TBLFM: $2='(+ 1 $n)");
add("| 2 |  |\n#+TBLFM: $2='(+ 1 $nothere)");
// org-lookup-first, org-lookup-last and org-lookup-all
for (const e of ['(org-lookup-first "b" \'("a" "b" "b") \'(1 2 3))', '(org-lookup-last "b" \'("a" "b" "b") \'(1 2 3))', '(org-lookup-all "b" \'("a" "b" "b") \'(1 2 3))', '(org-lookup-first "b" \'("a" "b" "b"))', '(org-lookup-all 2 \'(1 2 3) nil \'<)', '(org-lookup-first 2 \'(1 2 3) nil \'<)', '(org-lookup-last 2 \'(1 2 3) nil \'<)', '(org-lookup-first "x" \'("a" "b"))', '(org-lookup-all 5 \'(5 5) \'(1))']) add('| 1 | |\n#+TBLFM: $2=\'' + e);
add('#+NAME: data\n| Purchase | Product | Shop | Rating |\n|----------+---------+------+--------|\n| a        | p1      | s1   |      1 |\n| b        | p1      | s2   |      4 |\n| c        | p2      | s1   |      2 |\n| d        | p3      | s2   |      8 |\n\n| Product | Rating  | Ranking |\n|---------+---------+---------|\n| p1      | replace | replace |\n| p2      | replace | replace |\n| p3      | replace | replace |\n#+TBLFM: $2 = \'(let ((all (org-lookup-all \'$1 \'(remote(data, @I$2..@>$2)) \'(remote(data, @I$4..@>$4))))) (/ (apply \'+ all) (length all) 1.0)); L :: $3 = \'(+ 1 (length (org-lookup-all $2 \'(@I$2..@>$2) nil \'<))); N');
// remote references: by a field of this table, a table named with digits, and in a Lisp formula
for (const f of ['@2$2 = remote($1, @>$1)', '@2$2 = remote(@<$1, @2$1)', "@2$2 = '(identity remote($1, @2$1)); N", "@2$2 = '(+ remote(t2012, @2$1..@>$1)); N", "@2$2 = '(identity remote(t2012, @2$1)); L", "@2$2 = '(identity remote(t2012, @2$1))", "@2$2 = '(length '(remote(t2012, @1$1..@>$1)))", '@2$2 = remote(nope, @1$1)', '@2$2 = remote($9, @1$1)']) {
  add('#+NAME: t2012\n| amount |\n|--------|\n|      1 |\n|      2 |\n\n#+NAME: 2012\n| amount |\n|--------|\n|      5 |\n|      6 |\n\n| t2012 | replace |\n| 2012  | replace |\n#+TBLFM: ' + f);
}
add('#+NAME: 2012\n| amount |\n|--------|\n|      1 |\n|      2 |\n|--------|\n|      3 |\n#+TBLFM: @>$1 = vsum(@I..@II)\n\n#+NAME: 2013\n| amount |\n|--------|\n|      4 |\n|      8 |\n|--------|\n|     12 |\n#+TBLFM: @>$1 = vsum(@I..@II)\n\n#+NAME: summary\n|  year | amount  |\n|-------+---------|\n|  2012 | replace |\n|  2013 | replace |\n|-------+---------|\n| total | replace |\n#+TBLFM: @<<$2..@>>$2 = remote($<, @>$1) :: @>$2 = vsum(@I..@II)');
add('#+NAME: 2012\n| amount |\n|--------|\n|      1 |\n|      2 |\n|--------|\n|      3 |\n\n#+NAME: 2013\n| amount |\n|--------|\n|      4 |\n|      8 |\n|--------|\n|     12 |\n\n#+NAME: summary\n| year   |    2012 |    2013 | total   |\n|--------+---------+---------+---------|\n| amount | replace | replace | replace |\n#+TBLFM: @2$<<..@2$>> = remote(@<, @>$1) :: @2$> = vsum($<<..$>>)');
add('#+NAME: tt\n| 3 | 4 |\n| 5 | 6 |\n\n| a | b |\n#+TBLFM: $1=remote(tt, @2$2) ::  $2=vsum(remote(tt, @1$1..@2$2))');
// a field formula outside the table: Emacs refuses (org-table-formula-create-columns is nil), a column formula adds the column
add('| 2 |\n| 4 |\n| 8 |\n#+TBLFM: @1$2=5');
add('| 2 |\n| 4 |\n| 8 |\n#+TBLFM: $3=15');
// Calc algebra of text (chosen deviations, see test/support/oracle-tables-known.js)
add('| 0 | replace |\n| z | replace |\n|   | replace |\n| nan | replace |\n#+TBLFM: $2 = if("$1" == "nan", string(""), $1 + 1); E');
add('| 0 | replace |\n| a b | replace |\n| c   d | replace |\n|   | replace |\n| 2012-12 | replace |\n#+TBLFM: $2 = if("$1" == "nan", string(""), $1); E');
add('| 1.5 A/B | 2.0 B | |\n#+TBLFM: $3=$1*$2;u');
add('#+NAME: table\n|   | x   42 |   |\n\n| replace | replace |\n#+TBLFM: $2 = 2 * remote(table, @1$2)');

export const CASES = cases.filter((c) => !/=now\b|float-time|=daysto|=weekday|\$0=|\$0'/.test(c));
