/**
 * What the calendar and holiday built-ins are compared with Emacs 29.3 on (tools/gen-calendar-oracle.mjs, test/calendar-lisp.test.js).
 * `[month, year, source]` evaluates the expression with `displayed-month` and `displayed-year` bound; `[month, year, source, 'list']`
 * sets `calendar-holidays` to the list the source gives and answers `(calendar-holiday-list)`.
 */

/** @type {([number, number, string] | [number, number, string, 'list'])[]} */
export const CASES = [
  ...[    '(calendar-month-name 3)', '(calendar-month-name 3 t)', '(calendar-month-name 13)', '(calendar-day-name (list 10 28 2026))', '(calendar-day-name (list 10 28 2026) t)',
    'calendar-day-name-array', 'calendar-month-name-array', 'calendar-day-abbrev-array', 'calendar-month-abbrev-array',
    '(calendar-date-is-valid-p (list 2 30 2026))', '(calendar-date-is-valid-p (list 2 29 2028))', '(calendar-date-is-valid-p (list 13 1 2026))', '(calendar-date-is-valid-p 5)',
    '(calendar-day-number (list 10 28 2026))', '(calendar-day-number (list 12 31 2028))', '(calendar-date-equal (list 1 2 3) (list 1 2 3))', '(calendar-date-equal (list 1 2 3) (list 1 2 4))',
    '(calendar-dayname-on-or-before 1 740000)', '(calendar-dayname-on-or-before 6 740000)', '(calendar-nth-named-absday 2 0 3 2026)', '(calendar-nth-named-absday -1 1 5 2026)', '(calendar-nth-named-absday 1 4 11 2026 5)',
    '(calendar-hebrew-from-absolute 740000)', '(calendar-hebrew-to-absolute (list 7 1 5787))', '(calendar-hebrew-leap-year-p 5787)', '(calendar-hebrew-leap-year-p 5786)',
    '(calendar-hebrew-last-month-of-year 5787)', '(calendar-hebrew-last-day-of-month 2 5786)', '(calendar-hebrew-last-day-of-month 12 5786)',
    '(calendar-islamic-from-absolute 740000)', '(calendar-islamic-to-absolute (list 9 1 1448))', '(calendar-islamic-leap-year-p 1448)', '(calendar-islamic-leap-year-p 1447)', '(calendar-islamic-last-day-of-month 12 1447)',
    '(calendar-julian-from-absolute 740000)', '(calendar-julian-to-absolute (list 12 25 2026))',
    '(calendar-date-is-visible-p (list 11 3 2026))', '(calendar-date-is-visible-p (list 1 3 2027))', '(calendar-date-is-visible-p (list 9 30 2026))', '(calendar-date-is-visible-p (list 8 30 2026))',
    '(calendar-day-name 5)', '(calendar-dayname-on-or-before 1 "x")',
  ].map((s) => /** @type {[number, number, string]} */ ([10, 2026, s])),
  // ---- the holiday functions, one window each
  ...[[1, 2026], [2, 2026], [3, 2026], [4, 2026], [7, 2026], [10, 2026], [11, 2026], [12, 2026], [12, 2027], [1, 2028], [3, 2027], [9, 2026]].flatMap(([m, y]) => [
    '(holiday-fixed 12 25 "Christmas")', '(holiday-fixed 1 1 "New Year")', '(holiday-float 11 4 4 "Thanksgiving")', '(holiday-float 5 1 -1 "Memorial Day")', '(holiday-float 12 1 1 "x" 5)',
    '(holiday-easter-etc)', '(holiday-easter-etc 0 "Easter")', '(holiday-easter-etc -2 "Good Friday")', '(holiday-greek-orthodox-easter)', '(holiday-advent)', '(holiday-advent 0 "Advent")',
    '(holiday-julian 12 25 "Julian Christmas")', '(holiday-hebrew 7 1 "Rosh")', '(holiday-hebrew-passover)', '(holiday-hebrew-rosh-hashanah)', '(holiday-hebrew-hanukkah)',
    '(holiday-islamic 9 1 "Ramadan")', '(holiday-islamic-new-year)', '(holiday-bahai-new-year)', '(holiday-bahai 1 1 "x")',
    '(holiday-sexp (quote (calendar-nth-named-day 2 0 3 year)) "Second Sunday of March")',
    '(holiday-sexp (quote (if (= (% year 2) 0) (list 7 4 year))) (quote (format "July 4 %d" (calendar-extract-year date))))',
    '(let ((calendar-christian-all-holidays-flag t)) (holiday-easter-etc))',
    '(let ((calendar-hebrew-all-holidays-flag t)) (holiday-hebrew-passover))',
  ].map((s) => /** @type {[number, number, string]} */ ([m, y, s]))),
  // ---- lists with Lisp in them
  ...[[10, 2026], [11, 2026], [12, 2026], [2, 2027], [7, 2026]].flatMap(([m, y]) => [
    `'((holiday-fixed 7 4 "Independence Day") (holiday-fixed 12 25 "Christmas"))`,
    `'((if (> displayed-year 2026) (holiday-fixed 1 1 "New Year")) (holiday-float 11 4 4 "Thanksgiving"))`,
    `'((let ((n 11)) (holiday-fixed n 11 "Veterans")) (holiday-fixed 10 31 "Halloween"))`,
    `(mapcar (lambda (d) (list (list 10 d 2026) "Tenth")) '(1 15 31))`,
    `(list (quote (append (holiday-fixed 12 25 "A") (holiday-fixed 12 26 "B"))) (quote (holiday-easter-etc)))`,
    `'((holiday-sexp (list 11 (+ year 0) year) "Odd") (holiday-fixed 3 14 "Pi"))`,
    `'((holiday-fixed 7 4 "Independence Day") (holiday-hebrew-rosh-hashanah) (holiday-islamic-new-year) (holiday-julian 12 25 "Julian"))`,
    `'((progn (holiday-fixed 10 31 "Halloween") (holiday-fixed 11 1 "All Saints")))`,
  ].map((s) => /** @type {[number, number, string, 'list']} */ ([m, y, s, 'list']))),
];
