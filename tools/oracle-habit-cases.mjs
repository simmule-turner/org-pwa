/**
 * The corpus for tools/gen-oracle-habits.mjs: habits of every repeater kind, scheduled position and completion history. "Today" is
 * 2026-10-13 (a Tuesday). Each habit heading starts with a token (H0001 ...).
 */
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const TODAY = '2026-10-13';
const iso = (/** @type {number} */ offset) => new Date(Date.UTC(2026, 9, 13 + offset)).toISOString().slice(0, 10);
const stamp = (/** @type {number} */ offset, /** @type {string} */ extra = '', /** @type {string} */ time = '', /** @type {string} */ open = '<', /** @type {string} */ close = '>') => `${open}${iso(offset)} ${DAYS[new Date(Date.UTC(2026, 9, 13 + offset)).getUTCDay()]}${time ? ' ' + time : ''}${extra ? ' ' + extra : ''}${close}`;
const done = (/** @type {number} */ offset, state = 'DONE') => `- State "${state}"       from "TODO"       ${stamp(offset, '', '20:14', '[', ']')}`;

/** A small seeded generator, so the corpus is the same every time. */
function rng(seed) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

const REPEATERS = ['.+1d', '.+2d', '.+3d', '.+1w', '.+2w', '.+1m', '+1d', '+2d', '+1w', '++1d', '++3d', '++1w', '.+2d/4d', '.+1d/3d', '.+3d/5d', '.+1w/2w', '+2d/5d', '++1d/2d', '.+1m/2m', '+1y', '.+1d/2d'];
const OFFSETS = [-30, -10, -5, -2, -1, 0, 1, 2, 5, 10];
/** @type {[string, number[]][]} */
const HISTORIES = [
  ['none', []], ['yesterday', [-1]], ['3 days ago', [-3]], ['10 days ago', [-10]], ['25 days ago', [-25]], ['two', [-2, -9]], ['five in a row', [-1, -2, -3, -4, -5]],
  ['today', [0]], ['future', [2]], ['same day twice', [-4, -4]], ['spread', [-20, -13, -6, -1]], ['before window', [-40, -33]],
];

/** @returns {{ id: string, org: string, error?: boolean }[]} */
function build() {
  const next = rng(7);
  /** @type {{ id: string, org: string, error?: boolean }[]} */ const habits = [];
  let n = 0;
  const token = () => 'H' + String(++n).padStart(4, '0');
  const habit = (/** @type {string} */ label, /** @type {string} */ planning, /** @type {string[]} */ log, /** @type {string[]} */ extraProps = [], todo = 'TODO') => {
    const id = token();
    const lines = [`* ${todo} ${id} ${label}`, planning, ':PROPERTIES:', ':STYLE: habit', ...extraProps, ':END:'];
    if (log.length) lines.push(':LOGBOOK:', ...log, ':END:');
    habits.push({ id, org: lines.join('\n') });
  };
  for (const r of REPEATERS) {
    for (const o of OFFSETS) {
      for (let k = 0; k < 3; k++) {
        const [name, days] = HISTORIES[Math.floor(next() * HISTORIES.length)];
        // newest first, as org-log-states-order-reversed puts them
        const log = [...days].sort((a, b) => b - a).map((d) => done(d));
        habit(`${r} at ${o} ${name}`, `SCHEDULED: ${stamp(o, r)}`, log);
      }
    }
  }
  // long histories (more entries than the graph's days), other keywords, closing notes, notes under the entries
  habit('long history', `SCHEDULED: ${stamp(0, '.+2d/4d')}`, Array.from({ length: 40 }, (_, i) => done(-1 - i)));
  habit('canceled', `SCHEDULED: ${stamp(-3, '.+2d/4d')}`, [done(-2, 'CANCELED'), done(-8)]);
  habit('closing note', `SCHEDULED: ${stamp(-3, '.+2d/4d')}`, [`- CLOSING NOTE ${stamp(-2, '', '20:14', '[', ']')} \\\\`, '  done late', done(-8)]);
  habit('with time', `SCHEDULED: ${stamp(-1, '.+1d/2d', '09:00')}`, [done(-3)]);
  habit('other state', `SCHEDULED: ${stamp(-1, '.+1d/2d')}`, [`- State "WAIT"       from "TODO"       ${stamp(-2, '', '20:14', '[', ']')}`]);
  habit('done today with deadline', `SCHEDULED: ${stamp(-4, '.+2d/3d')} DEADLINE: ${stamp(2)}`, [done(0)]);
  habit('done keyword title', `SCHEDULED: ${stamp(0, '.+3d')}`, [done(-1)], [], 'NEXT');
  // not habits for Emacs: it stops with an error
  const bad = [
    ['no repeater', `SCHEDULED: ${stamp(0)}`], ['zero repeat', `SCHEDULED: ${stamp(0, '.+0d')}`], ['deadline not longer', `SCHEDULED: ${stamp(0, '.+3d/3d')}`], ['deadline shorter', `SCHEDULED: ${stamp(0, '.+3d/2d')}`], ['hours', `SCHEDULED: ${stamp(0, '.+2h')}`],
  ];
  for (const [label, planning] of bad) {
    const id = token();
    habits.push({ id, error: true, org: [`* TODO ${id} bad ${label}`, planning, ':PROPERTIES:', ':STYLE: habit', ':END:'].join('\n') });
  }
  return habits;
}

export const HABITS = build();
export const VARIANTS = [
  { id: 'default', preceding: 21, following: 7, green: false },
  { id: 'short', preceding: 7, following: 3, green: false },
  { id: 'long green', preceding: 30, following: 14, green: true },
];
export const HEADER = '#+TODO: TODO NEXT WAIT | DONE CANCELED\n';
