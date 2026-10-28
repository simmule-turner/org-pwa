// The sections of examples/plots.org (tools/gen-plots-example.mjs, test/example-plots.test.js). `org` is a #+PLOT: line and its table.
export const SECTIONS = [
  {
    heading: 'Lines',
    prose: 'A =#+PLOT:= line directly above a table graphs it. =ind= is the column for the x position and =deps= the columns to draw, each as its own line, named by the header row. Tap *📊 Plot* below the table to see the graph.',
    org: '#+PLOT: title:"Sales" ind:1 deps:(2 3) with:lines\n| Month | Pens | Books |\n|-------+------+-------|\n| 1     |   40 |    12 |\n| 2     |   55 |    18 |\n| 3     |   48 |    25 |\n',
  },
  {
    heading: 'Points on a numeric axis',
    prose: 'When the x column holds numbers, the points are placed by value. =with:= is =lines=, =points=, =boxes=, =histograms= or =impulses=.',
    org: '#+PLOT: ind:2 deps:(3) with:points\n| Run | Distance | Time |\n|-----+----------+------|\n| a   |        1 |  6.1 |\n| b   |        2 | 12.5 |\n| c   |        5 | 31.0 |\n',
  },
  {
    heading: 'Boxes',
    prose: '=with:boxes= draws a bar per row.',
    org: '#+PLOT: ind:1 deps:(2) with:boxes\n| Day | Steps |\n|-----+-------|\n| 1   |  8000 |\n| 2   |  9500 |\n| 3   |  4300 |\n',
  },
  {
    heading: 'Rows as series',
    prose: '=transpose:yes= swaps rows and columns first, so each row of the table becomes a line.',
    org: '#+PLOT: ind:1 transpose:yes\n| Year  | 2024 | 2025 | 2026 |\n|-------+------+------+------|\n| Pens  |   40 |   55 |   48 |\n| Books |   12 |   18 |   25 |\n',
  },
  {
    heading: 'A radar chart',
    prose: '=type:radar= draws one axis per row, after =transpose:yes= turns the columns into axes. =min= and =max= set the range.',
    radar: true,
    org: '#+PLOT: transpose:yes type:radar min:0 max:4\n| Format | Tools | Speed | Portability |\n|--------+-------+-------+-------------|\n| Org    |     4 |     3 |           4 |\n| Word   |     3 |     2 |           2 |\n',
  },
];

/** Cases where the app does not do what Emacs does, so the file says so and the test holds both results. */
export const DIFFERENCES = [
  { name: 'deps', org: '#+PLOT: ind:2\n| Label | Week | A | B |\n|-------+------+---+---|\n| p     |    1 | 3 | 5 |\n| q     |    2 | 4 | 6 |\n' },
  { name: 'ind', org: '#+PLOT: with:lines\n| Month | Pens | Books |\n|-------+------+-------|\n| 1     |   40 |    12 |\n| 2     |   55 |    18 |\n' },
  { name: 'labels', org: '#+PLOT: ind:1 deps:(3) labels:("Mine") with:lines\n| Month | Pens | Books |\n|-------+------+-------|\n| 1     |   40 |    12 |\n' },
];
