/**
 * The corpus for tools/gen-oracle-agenda.mjs: agenda documents and the views asked of them. "Today" is 2026-10-11 (a Sunday),
 * 16:30, New York time.  Every heading starts with a unique token (E001 ...) so a row can be matched to its heading.
 */
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const TODAY = '2026-10-11';
/** @param {number} offset days from today @param {string} [time] */
export function stamp(offset, time = '', extra = '', open = '<', close = '>') {
  const d = new Date(Date.UTC(2026, 9, 11 + offset));
  const iso = d.toISOString().slice(0, 10);
  return `${open}${iso} ${DAYS[d.getUTCDay()]}${time ? ' ' + time : ''}${extra ? ' ' + extra : ''}${close}`;
}
/** @param {number} offset */
export const isoOf = (offset) => new Date(Date.UTC(2026, 9, 11 + offset)).toISOString().slice(0, 10);

/** @returns {Record<string, string>} documents by name */
function dated() {
  let n = 0;
  const id = () => 'E' + String(++n).padStart(3, '0');
  /** @type {string[]} */ const out = ['#+CATEGORY: work', '#+TODO: TODO NEXT WAIT | DONE CANCELED'];
  const add = (/** @type {string} */ head, /** @type {string[]} */ ...lines) => out.push(`* ${head.replace('%', id())}`, ...lines);
  const OFFSETS = [-20, -5, -1, 0, 1, 2, 3, 5, 10, 14, 16, 20];
  for (const o of OFFSETS) {
    add(`TODO % sched ${o}`, `SCHEDULED: ${stamp(o)}`);
    add(`TODO % dead ${o}`, `DEADLINE: ${stamp(o)}`);
    add(`TODO % both ${o}`, `DEADLINE: ${stamp(o + 2)} SCHEDULED: ${stamp(o)}`);
  }
  for (const o of [-5, 0, 1, 3, 12]) {
    for (const t of ['09:30', '14:00-15:30', '8:00', '23:15', '00:00']) {
      add(`TODO % sched time ${t} ${o}`, `SCHEDULED: ${stamp(o, t)}`);
      add(`TODO % dead time ${t} ${o}`, `DEADLINE: ${stamp(o, t)}`);
    }
  }
  for (const o of [-8, -5, -1, 0, 2, 3]) {
    for (const r of ['+1d', '+3d', '+1w', '+2w', '+1m', '+1y', '++1d', '++3d', '++1w', '++1m', '.+1d', '.+2d', '.+1w', '+2d/4d']) {
      add(`TODO % sched ${r} ${o}`, `SCHEDULED: ${stamp(o, '', r)}`);
      add(`TODO % dead ${r} ${o}`, `DEADLINE: ${stamp(o, '', r)}`);
    }
  }
  for (const o of [3, 10, 20]) {
    for (const w of ['-0d', '-1d', '-2d', '-30d', '-2w', '-1m', '-1y']) add(`TODO % dead warn ${w} ${o}`, `DEADLINE: ${stamp(o, '', w)}`);
    for (const w of ['+1w -2d', '+1w -10d', '++1w -3d', '.+1w -3d']) add(`TODO % dead repeat+warn ${w} ${o}`, `DEADLINE: ${stamp(o, '', w)}`);
  }
  for (const o of [-6, -1, 0, 1, 3]) {
    for (const d of ['--0d', '--1d', '--3d', '--2w', '--1m']) add(`TODO % sched delay ${d} ${o}`, `SCHEDULED: ${stamp(o, '', d)}`);
    add(`TODO % sched delay+repeat ${o}`, `SCHEDULED: ${stamp(o, '', '+1w --2d')}`);
  }
  for (const state of ['DONE', 'CANCELED']) {
    for (const o of [-3, 0, 4]) {
      add(`${state} % sched ${o}`, `SCHEDULED: ${stamp(o)}`);
      add(`${state} % dead ${o}`, `DEADLINE: ${stamp(o)}`);
      add(`${state} % repeat ${o}`, `SCHEDULED: ${stamp(o, '', '+1w')} CLOSED: ${stamp(o, '10:00', '', '[', ']')}`);
    }
  }
  for (const [label, line] of [
    ['title stamp', null], ['body stamp', `text ${stamp(2)} here`], ['body stamp time', `at ${stamp(2, '10:00')}`], ['body range', `${stamp(1)}--${stamp(4)}`],
    ['body range times', `${stamp(1, '10:00')}--${stamp(1, '12:00')}`], ['body time range', `${stamp(3, '10:00-11:30')}`], ['inactive', `${stamp(2, '', '', '[', ']')}`],
    ['body repeater', `${stamp(-3, '', '+1w')}`], ['body ++', `${stamp(-3, '', '++1w')}`], ['body .+', `${stamp(-3, '', '.+1w')}`], ['two stamps', `${stamp(1)} and ${stamp(2)}`],
    ['today', `${stamp(0)}`], ['today time', `${stamp(0, '17:00')}`], ['past', `${stamp(-4)}`],
  ]) {
    if (line === null) add(`TODO % ${stamp(2)} in the title`);
    else add(`TODO % ${label}`, line);
  }
  add('% planned only text', `Not SCHEDULED: ${stamp(1)}`);
  add('DONE % done plain stamp', `${stamp(1)}`);
  for (const p of ['A', 'B', 'C', 'D']) add(`TODO [#${p}] % priority ${p}`, `SCHEDULED: ${stamp(1)}`);
  add('TODO [#A] % priority A time', `SCHEDULED: ${stamp(1, '10:00')}`);
  add('TODO [#C] % priority C time', `SCHEDULED: ${stamp(1, '10:00')}`);
  add('TODO % tagged :a:b:', `SCHEDULED: ${stamp(1)}`);
  out[out.length - 2] += ' :a:b:';
  add('NEXT % next state', `SCHEDULED: ${stamp(1)}`);
  add('WAIT % wait state', `SCHEDULED: ${stamp(1)}`);
  add('% no state sched', `SCHEDULED: ${stamp(1)}`);
  add('% no state dead', `DEADLINE: ${stamp(1)}`);
  for (const o of [-5, -1, 0, 1, 3, 8]) {
    add(`TODO % deadline then later schedule ${o}`, `DEADLINE: ${stamp(o)} SCHEDULED: ${stamp(o + 2)}`);
    add(`TODO % schedule then same deadline ${o}`, `SCHEDULED: ${stamp(o, '10:00')} DEADLINE: ${stamp(o, '16:00')}`);
    add(`TODO % repeating both ${o}`, `SCHEDULED: ${stamp(o, '', '+1w')} DEADLINE: ${stamp(o + 1, '', '+1w')}`);
    add(`TODO % deadline and plain stamp ${o}`, `DEADLINE: ${stamp(o)}`, `see ${stamp(o)} and ${stamp(o + 1)} and ${stamp(o, '', '', '[', ']')}`);
    add(`TODO % warn cookie and schedule ${o}`, `SCHEDULED: ${stamp(o - 2, '', '--1d')} DEADLINE: ${stamp(o + 4, '', '-3d')}`);
    add(`TODO % future repeating ${o}`, `SCHEDULED: ${stamp(o + 6, '', '++1w')}`);
  }
  for (const state of ['TODO', 'NEXT']) add(`${state} % last repeat ${state}`, `SCHEDULED: ${stamp(-9, '', '+1w')} DEADLINE: ${stamp(-9, '', '+2d')}`);
  add('TODO % inactive only', `[2026-10-12 Mon]`);
  add('TODO % clock line', ':LOGBOOK:', `CLOCK: [2026-10-12 Mon 10:00]--[2026-10-12 Mon 11:00] =>  1:00`, ':END:');
  // a time of day written in the title (org-agenda-search-headline-for-time), with and without a time in the stamp
  for (const o of [-1, 0, 1]) {
    add(`TODO % 9am title time sched ${o}`, `SCHEDULED: ${stamp(o)}`);
    add(`TODO % title 14:30 deadline ${o}`, `DEADLINE: ${stamp(o)}`);
    add(`TODO % 8:00 and stamp time ${o}`, `SCHEDULED: ${stamp(o, '10:00')}`);
    add(`TODO % plain stamp, title time 11:15 ${o}`, `see ${stamp(o)}`);
    add(`TODO % range title 16:00-17:00 ${o}`, `SCHEDULED: ${stamp(o)}`);
    add(`TODO % title 12am and 3pm ${o}`, `SCHEDULED: ${stamp(o)}`);
    add(`TODO % at 25:00 or 7:5 ${o}`, `SCHEDULED: ${stamp(o)}`);
    add(`TODO % title 6:45 stamp range ${o}`, `SCHEDULED: ${stamp(o, '13:00-14:00')}`);
  }
  for (const o of [-1, 0, 1]) {
    add(`TODO % 9am title time body range ${o}`, `${stamp(o)}--${stamp(o + 1)}`);
    add(`TODO % title 15:00 range times ${o}`, `${stamp(o, '10:00')}--${stamp(o + 1, '12:00')}`);
    add(`TODO % title 4pm same-day range ${o}`, `${stamp(o, '10:00')}--${stamp(o, '12:00')}`);
  }
  out.push('* TODO ' + 'E900 archived tree :ARCHIVE:', `SCHEDULED: ${stamp(1)}`, '** TODO E901 child of archived', `SCHEDULED: ${stamp(1)}`);
  out.push('* TODO E902 COMMENT tree'.replace('TODO E902 COMMENT', 'TODO COMMENT E902'), `SCHEDULED: ${stamp(1)}`, '** TODO E903 child of comment', `SCHEDULED: ${stamp(1)}`);
  out.push('* TODO E904 parent', `SCHEDULED: ${stamp(2)}`, '** TODO E905 child', `SCHEDULED: ${stamp(2)}`, '*** TODO E906 grandchild', `DEADLINE: ${stamp(2)}`);
  out.push('* TODO E907 with category', ':PROPERTIES:', ':CATEGORY: home', ':END:', `SCHEDULED: ${stamp(1)}`);
  out.push('* TODO E908 with effort', ':PROPERTIES:', ':Effort: 1:30', ':END:', `SCHEDULED: ${stamp(1)}`);
  return { dated: out.join('\n') + '\n' };
}

const WEEKDAYS = [0, 1, 3, 6];
/** Settings variants of the day and week views: Lisp bindings for Emacs, the same names for the app. */
export const VARIANTS = [
  { id: 'default', vars: {} },
  { id: 'warn0', vars: { 'org-deadline-warning-days': '0' } },
  { id: 'warn3', vars: { 'org-deadline-warning-days': '3' } },
  { id: 'warn30', vars: { 'org-deadline-warning-days': '30' } },
  { id: 'delay2', vars: { 'org-scheduled-delay-days': '2' } },
  { id: 'warn3delay1', vars: { 'org-deadline-warning-days': '3', 'org-scheduled-delay-days': '1' } },
];
/** The other settings of the day logic: org-agenda-skip-*, the past days, future and last repeats, negative warning and delay. */
export const SETTING_VARIANTS = [
  { id: 'warn -3', vars: { 'org-deadline-warning-days': '-3' } },
  { id: 'delay -2', vars: { 'org-scheduled-delay-days': '-2' } },
  { id: 'past days', vars: { 'org-deadline-past-days': '3', 'org-scheduled-past-days': '4' } },
  { id: 'past days 0', vars: { 'org-deadline-past-days': '0', 'org-scheduled-past-days': '0' } },
  { id: 'future repeats nil', vars: { 'org-agenda-show-future-repeats': 'nil' } },
  { id: 'future repeats next', vars: { 'org-agenda-show-future-repeats': "'next" } },
  { id: 'last repeat t', vars: { 'org-agenda-prefer-last-repeat': 't' } },
  { id: 'last repeat NEXT', vars: { 'org-agenda-prefer-last-repeat': '("NEXT")' } },
  { id: 'sched if deadline t', vars: { 'org-agenda-skip-scheduled-if-deadline-is-shown': 't' } },
  { id: 'sched if deadline repeated', vars: { 'org-agenda-skip-scheduled-if-deadline-is-shown': "'repeated-after-deadline" } },
  { id: 'sched if deadline not-today', vars: { 'org-agenda-skip-scheduled-if-deadline-is-shown': "'not-today" } },
  { id: 'prewarning t', vars: { 'org-agenda-skip-deadline-prewarning-if-scheduled': 't' } },
  { id: 'prewarning 2', vars: { 'org-agenda-skip-deadline-prewarning-if-scheduled': '2' } },
  { id: 'prewarning pre-scheduled', vars: { 'org-agenda-skip-deadline-prewarning-if-scheduled': "'pre-scheduled" } },
  { id: 'delay if deadline t', vars: { 'org-agenda-skip-scheduled-delay-if-deadline': 't', 'org-scheduled-delay-days': '2' } },
  { id: 'delay if deadline post', vars: { 'org-agenda-skip-scheduled-delay-if-deadline': "'post-deadline", 'org-scheduled-delay-days': '2' } },
  { id: 'delay if deadline 1', vars: { 'org-agenda-skip-scheduled-delay-if-deadline': '1' } },
  { id: 'stamp if deadline t', vars: { 'org-agenda-skip-timestamp-if-deadline-is-shown': 't' } },
  { id: 'additional stamps t', vars: { 'org-agenda-skip-additional-timestamps-same-entry': 't' } },
  { id: 'inactive t', vars: { 'org-agenda-include-inactive-timestamps': 't' } },
  { id: 'skip sched done', vars: { 'org-agenda-skip-scheduled-if-done': 't' } },
  { id: 'skip deadline done', vars: { 'org-agenda-skip-deadline-if-done': 't' } },
  { id: 'skip stamp done', vars: { 'org-agenda-skip-timestamp-if-done': 't' } },
  { id: 'skip all done', vars: { 'org-agenda-skip-scheduled-if-done': 't', 'org-agenda-skip-deadline-if-done': 't', 'org-agenda-skip-timestamp-if-done': 't' } },
];
export const SORTINGS = [
  null,
  '((agenda time-up priority-down category-keep))',
  '((agenda priority-down))',
  '((agenda priority-up))',
  '((agenda time-down))',
  '((agenda category-up))',
  '((agenda category-down priority-up))',
  '((agenda todo-state-up))',
  '((agenda todo-state-down time-up))',
  '((agenda tag-up))',
  '((agenda tag-down))',
  '((agenda alpha-up))',
  '((agenda alpha-down))',
  '((agenda effort-up))',
  '((agenda effort-down))',
  '((agenda timestamp-up))',
  '((agenda timestamp-down))',
  '((agenda scheduled-up))',
  '((agenda deadline-up))',
  '((agenda habit-up))',
  '((agenda deadline-down scheduled-down))',
  '((agenda user-defined-up))',
];

export const TODO_SETTINGS = [
  { id: 'default', vars: {} },
  { id: 'ignore with date', vars: { 'org-agenda-todo-ignore-with-date': 't' } },
  { id: 'ignore scheduled t', vars: { 'org-agenda-todo-ignore-scheduled': 't' } },
  { id: 'ignore scheduled future', vars: { 'org-agenda-todo-ignore-scheduled': "'future" } },
  { id: 'ignore scheduled past', vars: { 'org-agenda-todo-ignore-scheduled': "'past" } },
  { id: 'ignore scheduled 2', vars: { 'org-agenda-todo-ignore-scheduled': '2' } },
  { id: 'ignore scheduled -2', vars: { 'org-agenda-todo-ignore-scheduled': '-2' } },
  { id: 'ignore deadlines t', vars: { 'org-agenda-todo-ignore-deadlines': 't' } },
  { id: 'ignore deadlines all', vars: { 'org-agenda-todo-ignore-deadlines': "'all" } },
  { id: 'ignore deadlines far', vars: { 'org-agenda-todo-ignore-deadlines': "'far" } },
  { id: 'ignore deadlines future', vars: { 'org-agenda-todo-ignore-deadlines': "'future" } },
  { id: 'ignore deadlines past', vars: { 'org-agenda-todo-ignore-deadlines': "'past" } },
  { id: 'ignore deadlines 3', vars: { 'org-agenda-todo-ignore-deadlines': '3' } },
  { id: 'ignore deadlines far warn3', vars: { 'org-agenda-todo-ignore-deadlines': "'far", 'org-deadline-warning-days': '3' } },
  { id: 'ignore timestamp t', vars: { 'org-agenda-todo-ignore-timestamp': 't' } },
  { id: 'ignore timestamp future', vars: { 'org-agenda-todo-ignore-timestamp': "'future" } },
  { id: 'ignore timestamp past', vars: { 'org-agenda-todo-ignore-timestamp': "'past" } },
  { id: 'ignore timestamp 3', vars: { 'org-agenda-todo-ignore-timestamp': '3' } },
  { id: 'no sublevels', vars: { 'org-agenda-todo-list-sublevels': 'nil' } },
  { id: 'no sublevels ignore scheduled', vars: { 'org-agenda-todo-list-sublevels': 'nil', 'org-agenda-todo-ignore-scheduled': 't' } },
];
export const HABIT_SETTINGS = [
  { id: 'default', vars: {} },
  { id: 'every day', vars: { 'org-habit-show-habits-only-for-today': 'nil' } },
  { id: 'all today', vars: { 'org-habit-show-all-today': 't' } },
  { id: 'every day, all today', vars: { 'org-habit-show-habits-only-for-today': 'nil', 'org-habit-show-all-today': 't' } },
  { id: 'hidden', vars: { 'org-habit-show-habits': 'nil' } },
  { id: 'past days', vars: { 'org-habit-scheduled-past-days': '2', 'org-scheduled-past-days': '1', 'org-habit-show-habits-only-for-today': 'nil' } },
  { id: 'delay', vars: { 'org-scheduled-delay-days': '2', 'org-habit-show-habits-only-for-today': 'nil' } },
  { id: 'sorting', vars: { 'org-habit-show-habits-only-for-today': 'nil' }, sorting: '((agenda habit-up priority-down))' },
  { id: 'sorting two', vars: {}, sorting: '((agenda priority-down))' },
];
export const TODO_QUERIES = [null, '*', 'NEXT', 'TODO|WAIT', 'DONE', 'bogus'];
export const TODO_SORTINGS = [null, '((todo priority-up category-keep))', '((todo alpha-up))', '((todo alpha-down))', '((todo todo-state-up priority-down))', '((todo category-up priority-down))', '((todo tag-up))', '((todo effort-up))', '((todo effort-down))', '((todo timestamp-up))', '((todo timestamp-down))', '((todo scheduled-up))', '((todo deadline-up))', '((todo deadline-down scheduled-up))', '((todo ts-up))', '((todo time-up))', '((todo time-down))', '((todo time-up priority-down))'];

/** @returns {{ id: string, doc: string, view: string, date: string, span?: string, weekday?: number, vars: Record<string, string>, sorting: string | null }[]} */
function scenarios() {
  /** @type {any[]} */ const out = [];
  for (const v of VARIANTS) {
    for (const o of [-6, -1, 0, 1, 2, 3, 5, 9, 14, 15, 20, 30]) out.push({ id: `day ${v.id} ${isoOf(o)}`, doc: 'dated', view: 'agenda', date: isoOf(o), span: 'day', vars: v.vars, sorting: null });
  }
  for (const v of SETTING_VARIANTS) {
    for (const o of [-6, -2, 0, 1, 3, 6, 14]) out.push({ id: `setting ${v.id} ${isoOf(o)}`, doc: 'dated', view: 'agenda', date: isoOf(o), span: 'day', vars: v.vars, sorting: null });
  }
  for (const s of SORTINGS) {
    for (const o of [0, 1, 3]) out.push({ id: `sort ${s ?? 'default'} ${isoOf(o)}`, doc: 'dated', view: 'agenda', date: isoOf(o), span: 'day', vars: {}, sorting: s });
  }
  for (const wd of WEEKDAYS) {
    for (const o of [-9, 0, 3, 7, 13]) out.push({ id: `week start ${wd} ${isoOf(o)}`, doc: 'dated', view: 'agenda', date: isoOf(o), span: 'week', weekday: wd, vars: {}, sorting: null });
  }
  for (const v of VARIANTS.slice(0, 4)) for (const o of [0, 8]) out.push({ id: `week ${v.id} ${isoOf(o)}`, doc: 'dated', view: 'agenda', date: isoOf(o), span: 'week', weekday: 1, vars: v.vars, sorting: null });
  // Emacs's month span runs from the date it is given for the days of that month; the app's month is the calendar month, so ask for the 1st
  for (const date of ['2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01']) out.push({ id: `month ${date}`, doc: 'dated', view: 'agenda', date, span: 'month', vars: {}, sorting: null });
  // org-agenda-span, org-agenda-start-day and org-agenda-start-on-weekday: the days a span lists, from a given start day
  for (const span of ['day', 'week', 'fortnight', 'month', '3', '10', '7']) {
    for (const date of span === 'month' ? ['2026-10-05', '2026-10-31'] : ['2026-10-05', '2026-10-11', '2026-10-14', '2026-10-31', '2026-12-20']) {
      for (const wd of span === 'week' || span === 'fortnight' || span === '7' ? [null, 0, 4, 'nil'] : [null]) out.push({ id: `span ${span} ${date} wd ${wd}`, doc: 'dated', view: 'agenda', date, span, ...(wd !== null ? { weekday: wd } : {}), vars: {}, sorting: null });
    }
  }
  for (const date of ['2026-01-01']) out.push({ id: `span year ${date}`, doc: 'dated', view: 'agenda', date, span: 'year', vars: {}, sorting: null });
  for (const [startDay, span] of [['"+2d"', 'day'], ['"-1"', 'day'], ['"2026-10-05"', 'week'], ['"fri"', 'week'], ['"+1w"', 'week'], ['"mon"', 'day'], ['"-1w"', 'week'], ['"20"', 'day'], ['"5"', 'week'], ['"oct 20"', 'day'], ['"10-12"', 'week'], ['"10-10"', 'day'], ['"tomorrow"', 'day'], ['"-2d"', 'fortnight'], ['"+2fri"', 'day'], ['"-1mon"', 'week'], ['"."', 'week'], ['"+0"', 'day'], ['"2026-10-30"', 'month'], ['"-fri"', 'day'], ['"sun"', 'week']]) {
    out.push({ id: `start-day ${startDay} ${span}`, doc: 'dated', view: 'agenda', date: null, span, vars: { 'org-agenda-start-day': startDay }, sorting: null });
  }
  // log mode: org-agenda-start-with-log-mode (t, only, clockcheck or a list of kinds), org-agenda-log-mode-items, org-agenda-log-mode-add-notes
  const LOG_VARIANTS = [
    { id: 'log t', vars: { 'org-agenda-start-with-log-mode': 't' } },
    { id: 'log only', vars: { 'org-agenda-start-with-log-mode': "'only" } },
    { id: 'log clockcheck', vars: { 'org-agenda-start-with-log-mode': "'clockcheck" } },
    { id: 'log (closed)', vars: { 'org-agenda-start-with-log-mode': '(closed)' } },
    { id: 'log (state)', vars: { 'org-agenda-start-with-log-mode': '(state)' } },
    { id: 'log (clock state)', vars: { 'org-agenda-start-with-log-mode': '(clock state)' } },
    { id: 'log (closed clock state)', vars: { 'org-agenda-start-with-log-mode': '(closed clock state)' } },
    { id: 'log t, items state', vars: { 'org-agenda-start-with-log-mode': 't', 'org-agenda-log-mode-items': '(state)' } },
    { id: 'log t, items all', vars: { 'org-agenda-start-with-log-mode': 't', 'org-agenda-log-mode-items': '(closed clock state)' } },
    { id: 'log only, items all', vars: { 'org-agenda-start-with-log-mode': "'only", 'org-agenda-log-mode-items': '(closed clock state)' } },
    { id: 'log all, no notes', vars: { 'org-agenda-start-with-log-mode': '(closed clock state)', 'org-agenda-log-mode-add-notes': 'nil' } },
  ];
  for (const v of LOG_VARIANTS) for (const o of [-2, -1, 0, 1]) out.push({ id: `${v.id} ${isoOf(o)}`, doc: 'log', view: 'agenda', date: isoOf(o), span: 'day', vars: v.vars, sorting: null });
  out.push({ id: 'log all week', doc: 'log', view: 'agenda', date: isoOf(-3), span: 'week', weekday: 1, vars: { 'org-agenda-start-with-log-mode': '(closed clock state)' }, sorting: null });
  for (const s of ['((agenda priority-down))', '((agenda time-down))', '((agenda category-up))']) out.push({ id: `log sort ${s}`, doc: 'log', view: 'agenda', date: isoOf(0), span: 'day', vars: { 'org-agenda-start-with-log-mode': '(closed clock state)' }, sorting: s });
  // stuck projects: org-stuck-projects (matcher, TODO keywords, tags, regexp) and the match view with its matcher
  const STUCK = [
    ['default', null],
    ['todo next', '("+LEVEL=2/-DONE" ("TODO" "NEXT") nil nil)'],
    ['star', '("+LEVEL=2/-DONE" ("*") nil nil)'],
    ['no done filter', '("+LEVEL=2" ("TODO" "NEXT") nil nil)'],
    ['wait', '("+LEVEL=2/-DONE" ("WAIT") nil nil)'],
    ['tags', '("+LEVEL=2/-DONE" nil ("next") nil)'],
    ['tags star', '("+LEVEL=2/-DONE" nil ("*") nil)'],
    ['tags two', '("+LEVEL=2/-DONE" ("TODO") ("next" "other") nil)'],
    ['regexp', '("+LEVEL=2/-DONE" nil nil "next action")'],
    ['regexp scheduled', '("+LEVEL=2/-DONE" ("TODO") nil "\\\\<SCHEDULED:")'],
    ['regexp alt', '("+LEVEL=2/-DONE" nil nil "plain\\\\|waiting")'],
    ['level 3', '("+LEVEL=3" ("NEXT") nil nil)'],
    ['tag matcher', '("+proj" ("TODO") nil nil)'],
    ['tag matcher star', '("+proj|next" ("*") nil nil)'],
    ['todo matcher', '("TODO" ("NEXT") nil nil)'],
    ['all', '("+LEVEL=2/-DONE" ("*") ("*") "text")'],
  ];
  for (const [id, value] of STUCK) out.push({ id: `stuck ${id}`, doc: 'stuck', view: 'stuck', query: null, vars: value === null ? {} : { 'org-stuck-projects': `'${value}` }, sorting: null });
  // org-agenda-skip-function (and -global) with the helpers Emacs ships, in the agenda, the TODO list and a match view
  const SKIPS = [
    ["'(org-agenda-skip-entry-if 'todo '(\"NEXT\"))", 'entry todo NEXT'],
    ["'(org-agenda-skip-entry-if 'todo '(\"NEXT\" \"WAIT\"))", 'entry todo NEXT WAIT'],
    ["'(org-agenda-skip-entry-if 'todo 'done)", 'entry todo done'],
    ["'(org-agenda-skip-entry-if 'todo 'todo)", 'entry todo todo'],
    ["'(org-agenda-skip-entry-if 'todo 'any)", 'entry todo any'],
    ["'(org-agenda-skip-entry-if 'nottodo 'todo)", 'entry nottodo todo'],
    ["'(org-agenda-skip-entry-if 'nottodo '(\"TODO\"))", 'entry nottodo TODO'],
    ["'(org-agenda-skip-entry-if 'todo '(\"*\"))", 'entry todo star'],
    ["'(org-agenda-skip-entry-if 'scheduled)", 'entry scheduled'],
    ["'(org-agenda-skip-entry-if 'notscheduled)", 'entry notscheduled'],
    ["'(org-agenda-skip-entry-if 'deadline)", 'entry deadline'],
    ["'(org-agenda-skip-entry-if 'notdeadline)", 'entry notdeadline'],
    ["'(org-agenda-skip-entry-if 'timestamp)", 'entry timestamp'],
    ["'(org-agenda-skip-entry-if 'nottimestamp)", 'entry nottimestamp'],
    ["'(org-agenda-skip-entry-if 'regexp \"sched\")", 'entry regexp'],
    ["'(org-agenda-skip-entry-if 'notregexp \"child\")", 'entry notregexp'],
    ["'(org-agenda-skip-entry-if 'regexp \"\\\\(sched\\\\|dead\\\\)\")", 'entry regexp alt'],
    ["'(org-agenda-skip-entry-if 'scheduled 'deadline)", 'entry scheduled deadline'],
    ["'(org-agenda-skip-entry-if 'scheduled 'todo '(\"NEXT\"))", 'entry scheduled todo NEXT'],
    ["'(org-agenda-skip-entry-if 'todo '(\"NEXT\") 'scheduled)", 'entry todo NEXT scheduled'],
    ["'(org-agenda-skip-subtree-if 'todo '(\"NEXT\"))", 'subtree todo NEXT'],
    ["'(org-agenda-skip-subtree-if 'todo 'done)", 'subtree todo done'],
    ["'(org-agenda-skip-subtree-if 'nottodo 'todo)", 'subtree nottodo todo'],
    ["'(org-agenda-skip-subtree-if 'regexp \"parent\")", 'subtree regexp'],
    ["'(org-agenda-skip-subtree-if 'scheduled)", 'subtree scheduled'],
    ["'(org-agenda-skip-subtree-if 'timestamp)", 'subtree timestamp'],
    ["'(org-agenda-skip-if nil '(scheduled))", 'skip-if entry scheduled'],
    ["'(org-agenda-skip-if t '(deadline todo))", 'skip-if subtree deadline todo'],
    ["'(org-agenda-skip-entry-if 'bogus)", 'entry bogus'],
  ];
  for (const [fn, id] of SKIPS) {
    for (const o of [0, 2]) out.push({ id: `skip ${id} ${isoOf(o)}`, doc: 'dated', view: 'agenda', date: isoOf(o), span: 'day', vars: { 'org-agenda-skip-function': fn }, sorting: null });
    out.push({ id: `skip ${id} todo`, doc: 'todos', view: 'todo', query: null, vars: { 'org-agenda-skip-function': fn }, sorting: null });
    out.push({ id: `skip ${id} match`, doc: 'stuck', view: 'match', query: '+LEVEL=2', vars: { 'org-agenda-skip-function': fn }, sorting: null });
  }
  out.push({ id: 'skip global', doc: 'dated', view: 'agenda', date: isoOf(1), span: 'day', vars: { 'org-agenda-skip-function-global': "'(org-agenda-skip-entry-if 'todo '(\"NEXT\"))" }, sorting: null });
  out.push({ id: 'skip global and local', doc: 'dated', view: 'agenda', date: isoOf(1), span: 'day', vars: { 'org-agenda-skip-function-global': "'(org-agenda-skip-entry-if 'todo '(\"NEXT\"))", 'org-agenda-skip-function': "'(org-agenda-skip-entry-if 'todo '(\"WAIT\"))" }, sorting: null });
  out.push({ id: 'skip week', doc: 'dated', view: 'agenda', date: isoOf(-3), span: 'week', weekday: 1, vars: { 'org-agenda-skip-function': "'(org-agenda-skip-subtree-if 'todo '(\"NEXT\"))" }, sorting: null });
  for (const q of ['+LEVEL=2', 'TODO']) out.push({ id: `match ${q}`, doc: 'stuck', view: 'match', query: q, vars: {}, sorting: null });
  // custom commands: a composite (block) command runs its blocks in order, each under the global settings and its own
  const COMMANDS = [
    ['stuck', 'stuck', '(("x" "Stuck" stuck))'],
    ['stuck settings', 'stuck', '(("x" "Stuck" stuck "" ((org-stuck-projects \'("+LEVEL=2/-DONE" ("WAIT") nil "")))))'],
    ['tags and tags-todo', 'stuck', '(("x" "Both" ((tags "+LEVEL=2") (tags-todo "TODO"))))'],
    ['block sorting', 'stuck', '(("x" "Sorted" ((tags "+LEVEL=2" ((org-agenda-sorting-strategy \'(alpha-down)))) (tags "+LEVEL=2"))))'],
    ['block global sorting', 'stuck', '(("x" "Global" ((tags "+LEVEL=2") (tags-todo "TODO")) ((org-agenda-sorting-strategy \'(alpha-down)))))'],
    ['block skip', 'stuck', '(("x" "Skip" ((tags "+LEVEL=2" ((org-agenda-skip-function \'(org-agenda-skip-entry-if \'todo \'("NEXT"))))) (tags "+LEVEL=2"))))'],
    ['block global skip', 'stuck', '(("x" "Skip" ((tags "+LEVEL=2") (tags-todo "TODO")) ((org-agenda-skip-function \'(org-agenda-skip-entry-if \'todo \'("NEXT"))))))'],
    ['block stuck and tags', 'stuck', '(("x" "Stuck and tags" ((stuck "") (tags "+LEVEL=2"))))'],
    ['block todo', 'todos', '(("x" "Todos" ((todo "NEXT") (alltodo "") (todo "WAIT"))))'],
    ['block todo sorting', 'todos', '(("x" "Todos" ((todo "TODO" ((org-agenda-sorting-strategy \'(alpha-down)))) (todo "NEXT"))))'],
  ];
  for (const [id, doc, value] of COMMANDS) out.push({ id: `command ${id}`, doc, view: 'command', key: 'x', vars: { 'org-agenda-custom-commands': `'${value}` }, sorting: null });
  // clock check: org-agenda-clock-consistency-checks, with log mode `clockcheck`
  const CHECKS = [
    ['default', null],
    ['max 2h', '(:max-duration "2:00" :min-duration 0 :max-gap "0:05" :gap-ok-around ("4:00"))'],
    ['min 10m', '(:max-duration "10:00" :min-duration "0:10" :max-gap "0:05" :gap-ok-around ("4:00"))'],
    ['min number', '(:max-duration 600 :min-duration 10 :max-gap 5 :gap-ok-around ("4:00"))'],
    ['gap 1h', '(:max-duration "10:00" :min-duration 0 :max-gap "1:00" :gap-ok-around ("4:00"))'],
    ['gap ok lunch', '(:max-duration "10:00" :min-duration 0 :max-gap "0:05" :gap-ok-around ("4:00" "13:30"))'],
    ['gap ok none', '(:max-duration "10:00" :min-duration 0 :max-gap "0:05" :gap-ok-around nil)'],
    ['gap never', '(:max-duration "10:00")'],
    ['empty', 'nil'],
  ];
  for (const [id, value] of CHECKS) for (const o of [-2, -1, 0]) out.push({ id: `clockcheck ${id} ${isoOf(o)}`, doc: 'clocks', view: 'agenda', date: isoOf(o), span: 'day', vars: { 'org-agenda-start-with-log-mode': "'clockcheck", ...(value === null ? {} : { 'org-agenda-clock-consistency-checks': `'${value}` }) }, sorting: null });
  out.push({ id: 'clockcheck week', doc: 'clocks', view: 'agenda', date: isoOf(-3), span: 'week', weekday: 1, vars: { 'org-agenda-start-with-log-mode': "'clockcheck" }, sorting: null });
  out.push({ id: 'clocks log t', doc: 'clocks', view: 'agenda', date: isoOf(0), span: 'day', vars: { 'org-agenda-start-with-log-mode': 't' }, sorting: null });
  for (const t of TODO_SETTINGS) out.push({ id: `todo ${t.id}`, doc: 'todos', view: 'todo', query: null, vars: t.vars, sorting: null });
  for (const q of TODO_QUERIES) out.push({ id: `todo query ${q}`, doc: 'todos', view: 'todo', query: q, vars: {}, sorting: null });
  for (const q of TODO_SORTINGS) out.push({ id: `todo sort ${q}`, doc: 'todos', view: 'todo', query: null, vars: {}, sorting: q });
  for (const q of TODO_SORTINGS.slice(0, 3)) out.push({ id: `todo dated sort ${q}`, doc: 'dated', view: 'todo', query: null, vars: {}, sorting: q });
  for (const h of HABIT_SETTINGS) for (const o of [-3, 0, 1, 2, 5]) out.push({ id: `habit ${h.id} ${isoOf(o)}`, doc: 'habits', view: 'agenda', date: isoOf(o), span: 'day', vars: h.vars, sorting: h.sorting ?? null });
  return out;
}

/** @returns {string} a tree of TODO entries with planning lines of every kind, for the TODO list */
function todos() {
  let n = 0;
  const id = () => 'T' + String(++n).padStart(3, '0');
  /** @type {string[]} */ const out = ['#+CATEGORY: work', '#+TODO: TODO NEXT WAIT | DONE CANCELED'];
  const add = (/** @type {string} */ head, /** @type {string[]} */ ...lines) => out.push(`${head.replace('%', id())}`, ...lines);
  const plans = [
    ['none', []], ['sched past', [`SCHEDULED: ${stamp(-3)}`]], ['sched today', [`SCHEDULED: ${stamp(0)}`]], ['sched near', [`SCHEDULED: ${stamp(2)}`]], ['sched far', [`SCHEDULED: ${stamp(40)}`]],
    ['dead past', [`DEADLINE: ${stamp(-2)}`]], ['dead today', [`DEADLINE: ${stamp(0)}`]], ['dead near', [`DEADLINE: ${stamp(5)}`]], ['dead far', [`DEADLINE: ${stamp(30)}`]], ['dead cookie', [`DEADLINE: ${stamp(20, '', '-3w')}`]],
    ['both', [`SCHEDULED: ${stamp(-1)} DEADLINE: ${stamp(4)}`]], ['repeat', [`SCHEDULED: ${stamp(-8, '', '+1w')}`]],
    ['stamp past', [`see ${stamp(-4)}`]], ['stamp future', [`see ${stamp(6)}`]], ['stamp+sched', [`SCHEDULED: ${stamp(1)}`, `and ${stamp(9)}`]], ['inactive', [`seen ${stamp(2, '', '', '[', ']')}`]],
    ['range', [`${stamp(1)}--${stamp(3)}`]], ['time', [`SCHEDULED: ${stamp(1, '09:30')}`]], ['title stamp', []],
  ];
  for (const [label, lines] of plans) {
    add(`* TODO % ${label}${label === 'title stamp' ? ' ' + stamp(3) : ''}`, ...lines);
    add(`** TODO % child of ${label}`);
    add(`*** NEXT % grandchild of ${label}`);
  }
  for (const state of ['NEXT', 'WAIT', 'DONE', 'CANCELED']) add(`* ${state} % state ${state}`, `SCHEDULED: ${stamp(1)}`);
  add('* % no state', `SCHEDULED: ${stamp(1)}`);
  add('** TODO % todo under no state');
  add('* DONE % done parent');
  add('** TODO % todo under done');
  add('*** WAIT % wait under todo under done');
  for (const p of ['A', 'B', 'C', 'D']) add(`* TODO [#${p}] % priority ${p}`);
  add('* TODO % tags one :a:');
  add('* TODO % tags two :b:a:');
  add('* TODO % has category', ':PROPERTIES:', ':CATEGORY: home', ':END:');
  add('** TODO % inherits category');
  add('* TODO % with effort', ':PROPERTIES:', ':Effort: 0:30', ':END:');
  add('* TODO % effort two', ':PROPERTIES:', ':Effort: 2:00', ':END:');
  add('* TODO % archived tree :ARCHIVE:');
  add('** TODO % child of archived');
  add('* TODO COMMENT % comment tree');
  add('** TODO % child of comment');
  add('* TODO % in a block', '#+BEGIN_SRC text', `${stamp(1)}`, '#+END_SRC');
  for (const t of ['lunch 12:30', '9am standup', '14:00-15:30 review', 'call at 8:15pm', 'no time here', '7:05 early', '12am midnight', '5pm tea']) add(`* TODO % ${t}`);
  add('* TODO % alpha later zzz');
  add('* TODO % Alpha earlier AAA');
  return out.join('\n') + '\n';
}

/** @returns {string} habits and tasks for the agenda's habit rules */
function habitsDoc() {
  let n = 0;
  const id = () => 'K' + String(++n).padStart(3, '0');
  /** @type {string[]} */ const out = ['#+CATEGORY: habits', '#+TODO: TODO NEXT WAIT | DONE CANCELED'];
  const log = (/** @type {number[]} */ days) => days.length ? [':LOGBOOK:', ...days.map((d) => `- State "DONE"       from "TODO"       ${stamp(d, '20:14', '', '[', ']')}`), ':END:'] : [];
  for (const o of [-8, -3, -1, 0, 1, 3, 9]) {
    for (const [r, hist] of [['.+1d/3d', [-5, -2]], ['.+2d', [-1]], ['+1w', [-9, -2]], ['++2d/4d', []], ['.+1d', [0]]]) {
      out.push(`* TODO ${id()} habit ${r} at ${o}`, `SCHEDULED: ${stamp(o, '', r)}`, ':PROPERTIES:', ':STYLE: habit', ':END:', ...log(/** @type {number[]} */ (hist)));
    }
  }
  out.push(`* TODO ${id()} habit with time`, `SCHEDULED: ${stamp(0, '09:00', '.+1d')}`, ':PROPERTIES:', ':STYLE: habit', ':END:');
  out.push(`* TODO [#A] ${id()} habit priority A`, `SCHEDULED: ${stamp(0, '', '.+2d')}`, ':PROPERTIES:', ':STYLE: habit', ':END:');
  out.push(`* TODO ${id()} habit with deadline`, `SCHEDULED: ${stamp(-1, '', '.+2d')} DEADLINE: ${stamp(3)}`, ':PROPERTIES:', ':STYLE: habit', ':END:');
  out.push(`* DONE ${id()} habit done`, `SCHEDULED: ${stamp(0, '', '.+2d')}`, ':PROPERTIES:', ':STYLE: habit', ':END:');
  for (const o of [-4, -1, 0, 1, 4]) {
    out.push(`* TODO ${id()} plain ${o}`, `SCHEDULED: ${stamp(o)}`);
    out.push(`* TODO [#A] ${id()} plain A ${o}`, `SCHEDULED: ${stamp(o)}`);
    out.push(`* TODO ${id()} plain repeating ${o}`, `SCHEDULED: ${stamp(o, '', '+2d')}`);
  }
  return out.join('\n') + '\n';
}


/** The log-mode document: CLOSED stamps, CLOCK lines and `State` lines of the log, on the days around today. @returns {string} */
function logs() {
  let n = 0;
  const id = () => 'E' + String(++n).padStart(3, '0');
  /** @type {string[]} */ const out = ['#+CATEGORY: work', '#+TODO: TODO NEXT WAIT | DONE CANCELED'];
  const add = (/** @type {string} */ head, /** @type {string[]} */ ...lines) => out.push(`* ${head.replace('%', id())}`, ...lines);
  const ts = (/** @type {number} */ o, /** @type {string} */ t = '') => stamp(o, t, '', '[', ']');
  for (const o of [-2, -1, 0, 1]) {
    add(`DONE % closed ${o}`, `CLOSED: ${ts(o, '09:30')}`);
    add(`CANCELED % closed no time ${o}`, `CLOSED: ${ts(o)}`);
    add(`DONE % closed with schedule ${o}`, `CLOSED: ${ts(o, '17:05')} SCHEDULED: ${stamp(o)}`);
    add(`TODO % clock ${o}`, ':LOGBOOK:', `CLOCK: ${ts(o, '10:00')}--${ts(o, '10:45')} =>  0:45`, `CLOCK: ${ts(o - 1, '22:00')}--${ts(o, '01:30')} =>  3:30`, ':END:');
    add(`TODO % open clock ${o}`, ':LOGBOOK:', `CLOCK: ${ts(o, '15:00')}`, ':END:');
    add(`TODO % clock no time ${o}`, ':LOGBOOK:', `CLOCK: ${ts(o)}--${ts(o)} =>  0:00`, ':END:');
    add(`TODO % clock note ${o}`, ':LOGBOOK:', `CLOCK: ${ts(o, '13:00')}--${ts(o, '13:10')} =>  0:10`, '- the clock note', ':END:');
    add(`NEXT % states ${o}`, ':LOGBOOK:', `- State "NEXT"       from "TODO"       ${ts(o, '08:00')} \\\\`, '  started it', `- State "TODO"       from "WAIT"       ${ts(o, '07:00')}`, `- State "FOO"        from "TODO"       ${ts(o, '06:00')}`, `- Note taken on ${ts(o, '11:00')} \\\\`, '  a note', ':END:');
    add(`DONE % 9am closed, no time ${o}`, `CLOSED: ${ts(o)}`);
    add(`DONE % 10:15 closed, with time ${o}`, `CLOSED: ${ts(o, '16:00')}`);
    add(`DONE % done state ${o}`, `CLOSED: ${ts(o, '12:00')}`, ':LOGBOOK:', `- State "DONE"       from "TODO"       ${ts(o, '12:00')} \\\\`, '  finished the job :-)', ':END:');
  }
  add('TODO % body lines :tag:', `- State "TODO" from "NEXT" ${ts(0, '07:00')}`, `- State "NEXT" from "" ${ts(0, '07:30')} \\\\`, '  note line', 'CLOCK: ' + ts(0, '13:00') + '--' + ts(0, '13:10') + ' =>  0:10', '  - clock note here');
  add('TODO [#A] % priority and tag :t1:t2:', ':LOGBOOK:', `CLOCK: ${ts(0, '09:00')}--${ts(0, '09:30')} =>  0:30`, ':END:');
  add('TODO % no keywords in text', 'text mentions CLOSED: ' + ts(0, '11:11') + ' and State', 'also CLOCK: ' + ts(0, '11:12'));
  out.push('# comment line CLOSED: ' + ts(0, '10:10'), '#+BEGIN_SRC org', 'CLOCK: ' + ts(0, '10:20'), '#+END_SRC');
  add('TODO % parent');
  out.push(`** DONE ${id()} child`, 'CLOSED: ' + ts(0, '14:00'));
  out.push(`*** TODO ${id()} grandchild`, ':LOGBOOK:', `CLOCK: ${ts(0, '16:00')}--${ts(0, '16:20')} =>  0:20`, ':END:');
  out.push('* TODO ' + id() + ' archived :ARCHIVE:', 'CLOSED: ' + ts(0, '09:00'));
  out.push('* COMMENT ' + id() + ' commented', 'CLOSED: ' + ts(0, '09:05'));
  return out.join('\n') + '\n';
}

/** The stuck-projects document: projects (level 2) with and without next actions. @returns {string} */
function stuck() {
  let n = 0;
  const id = () => 'E' + String(++n).padStart(3, '0');
  const out = ['#+CATEGORY: proj', '#+TODO: TODO NEXT WAIT | DONE CANCELED', '#+FILETAGS: :f:'];
  /** @param {string} stars @param {string} head @param {string[]} [lines] */
  const add = (stars, head, ...lines) => out.push(`${stars} ${head.replace('%', id())}`, ...lines);
  add('*', 'Area A');
  add('**', '% stuck: only notes');
  add('***', '% a plain note');
  add('**', '% not stuck: has todo child');
  add('***', 'TODO % do it');
  add('**', '% not stuck: has next child');
  add('***', 'NEXT % next action');
  add('**', 'DONE % finished project', '*** TODO % open task of a finished project');
  add('**', 'TODO % project with its own keyword');
  add('**', 'NEXT % project with next keyword');
  add('**', '% stuck: only done child');
  add('***', 'DONE % done child');
  add('**', '% stuck: only wait child');
  add('***', 'WAIT % waiting');
  add('**', '% tagged project :proj:');
  add('***', '% child with tag :next:');
  add('**', '% tagged parent :next:');
  add('**', '% deep action');
  add('***', '% sub project');
  add('****', 'TODO % deep todo');
  add('**', '% scheduled child');
  add('***', '% plain heading', `SCHEDULED: ${stamp(2)}`);
  add('**', '% body mentions next action', 'We need a next action here.');
  add('**', '% body mentions TODO in text', 'a line with TODO inside');
  add('**', '% canceled child only');
  add('***', 'CANCELED % canceled');
  add('*', 'Area B :area:');
  add('**', '% stuck project in B');
  add('**', '% project in B with todo');
  add('***', 'TODO % B action');
  add('***', 'TODO % B action two :next:');
  add('**', '% level two with tags :proj:other:');
  add('**', '% archived project :ARCHIVE:');
  add('**', 'COMMENT % commented project');
  add('*', 'TODO % level one todo');
  add('***', 'TODO % level three todo');
  return out.join('\n') + '\n';
}

/** The clock-check document: clock lines of a day with all the kinds of issue (clock-check lines start the line, as Emacs needs). @returns {string} */
function clocks() {
  let n = 0;
  const id = () => 'E' + String(++n).padStart(3, '0');
  const out = ['#+CATEGORY: clk', '#+TODO: TODO NEXT WAIT | DONE CANCELED'];
  const ts = (/** @type {number} */ o, /** @type {string} */ t = '') => stamp(o, t, '', '[', ']');
  /** @param {string} head @param {string[]} lines */
  const add = (head, ...lines) => out.push(`* ${head.replace('%', id())}`, ':LOGBOOK:', ...lines, ':END:');
  for (const o of [-2, -1, 0]) {
    const c = (/** @type {string} */ a, /** @type {string} */ b, /** @type {string} */ d) => `CLOCK: ${ts(o, a)}--${ts(o, b)} =>  ${d}`;
    add(`TODO % normal ${o}`, c('09:00', '09:30', '0:30'));
    add(`TODO % overlap ${o}`, c('09:20', '09:50', '0:30'));
    add(`TODO % short ${o}`, c('09:55', '10:00', '0:05'));
    add(`TODO % gap ${o}`, c('11:00', '11:30', '0:30'));
    add(`TODO % long ${o}`, `CLOCK: ${ts(o, '12:00')}--${ts(o, '23:30')} => 11:30`);
    add(`TODO % night ${o}`, c('02:00', '02:10', '0:10'), c('05:00', '05:10', '0:10'));
    add(`TODO % lunch gap ${o}`, c('13:00', '13:10', '0:10'), c('14:00', '14:10', '0:10'));
    add(`TODO % two day ${o}`, `CLOCK: ${ts(o - 1, '22:00')}--${ts(o, '01:00')} =>  3:00`);
    add(`TODO % open ${o}`, `CLOCK: ${ts(o, '15:00')}`);
    add(`TODO % noted ${o}`, c('16:00', '16:20', '0:20'), '- a clock note');
  }
  return out.join('\n') + '\n';
}

export const DOCS = { ...dated(), todos: todos(), habits: habitsDoc(), log: logs(), stuck: stuck(), clocks: clocks() };
export const SCENARIOS = scenarios();
