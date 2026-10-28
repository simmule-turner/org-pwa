// The sections of examples/table-formulas.org that Emacs fills in (tools/gen-table-formulas-example.mjs, test/example-table-formulas.test.js).
// `input` is the table as typed; the section's table is what Emacs 29.3 made of it.
export const SECTIONS = [
  {
    heading: 'Named fields',
    prose: 'A row marked =_= names the field below each of its cells; a row marked =^= names the field above. A name can then stand for that field on the right of a formula, or be the target on the left: =$tax== writes that one field.',
    input: '|   | Price | Tax | Total |\n| _ | price | tax | total |\n| # |   100 |     |       |\n#+TBLFM: $tax=$price*0.2;%.2f::$total=$price*1.2;%.2f\n',
  },
  {
    heading: 'A default format',
    prose: 'A =$= row can hold =%== and a format. It is added to a formula that has flags such as =N= but no format of its own, so one line sets the decimals for the table. A formula with no flags at all does not get it.',
    input: '| $ | %=%.2f |      |      |\n| # |      1 |    3 |      |\n| # |      2 |    7 |      |\n#+TBLFM: $4=$2/$3;N\n',
  },
  {
    heading: 'Several formulas, in order',
    prose: 'Formulas do not run in the order written. Org sorts them by their target, and runs column formulas row by row before field formulas, so a formula sees the results of the ones that sort before it. Here =$3= is written first but runs after =$2=.',
    input: '| Base | Doubled | Plus ten |\n|------+---------+----------|\n|    3 |         |          |\n|    8 |         |          |\n#+TBLFM: $3=$2+10::$2=$1*2\n',
  },
];
