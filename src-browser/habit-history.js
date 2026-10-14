// @ts-check
// The longer view of one habit: how many times in a row it was done on time, the best run, the last 12 weeks as a grid, and the
// latest completions. Read only: it draws from the log lines already in the heading and saves nothing.
import { buildHabitHistory, dayNumberToDate } from '../src/habit.js';
import { openContentSheet } from './bottom-sheet.js';

/** @param {Date} d */
const dayText = (d) => d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
/** @param {number} n @param {string} one */
const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;

/**
 * @param {import('../src/types.js').Heading} heading
 * @param {(keyword: string) => boolean} isDone
 * @param {Date} [today]
 */
export function openHabitHistory(heading, isDone, today = new Date()) {
  const h = buildHabitHistory(heading, isDone, today);
  if (!h) return;
  const every = h.maxDays > h.minDays ? `every ${h.minDays} to ${plural(h.maxDays, 'day')}` : `every ${plural(h.minDays, 'day')}`;
  openContentSheet({
    title: heading.title || 'Habit',
    subtitle: every,
    build: (panel) => {
      panel.setAttribute('data-habit-history', '');
      const tiles = document.createElement('div');
      tiles.style.cssText = 'display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:8px 0;';
      for (const [value, label] of /** @type {[number, string][]} */ ([
        [h.streak, 'on time in a row'],
        [h.best, 'best run'],
        [h.doneInWindow, `done in ${h.weeks} weeks`],
      ])) {
        const tile = document.createElement('div');
        tile.style.cssText = 'border:1px solid var(--border-strong);border-radius:10px;padding:8px 10px;';
        const big = document.createElement('div');
        big.textContent = String(value);
        big.style.cssText = 'font-size:22px;font-weight:700;';
        const small = document.createElement('div');
        small.textContent = label;
        small.style.cssText = 'font-size:12px;opacity:0.7;';
        tile.append(big, small);
        tiles.appendChild(tile);
      }
      panel.appendChild(tiles);

      const now = document.createElement('div');
      now.style.cssText = 'font-size:13px;line-height:1.5;margin:4px 0 10px;';
      now.textContent =
        (h.lastDone === null ? 'Not done yet.' : `Last done ${dayText(dayNumberToDate(h.lastDone))}.`) +
        ` Due from ${dayText(dayNumberToDate(h.scheduled))}` +
        (h.deadline > h.scheduled ? `, last chance ${dayText(dayNumberToDate(h.deadline))}.` : '.');
      panel.appendChild(now);

      const grid = document.createElement('div');
      grid.setAttribute('data-habit-grid', '');
      grid.style.cssText = `display:grid;grid-template-rows:repeat(7,18px);grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:3px;`;
      for (const cell of h.grid) {
        const c = document.createElement('div');
        c.style.borderRadius = '3px';
        c.style.background = cell.future ? 'transparent' : cell.done ? '#3f9b57' : 'var(--surface)';
        if (cell.today) c.style.outline = '2px solid var(--fg)';
        if (cell.done) c.setAttribute('data-habit-done', '');
        c.title = dayText(dayNumberToDate(cell.day));
        grid.appendChild(c);
      }
      const label = document.createElement('div');
      label.textContent = `Last ${h.weeks} weeks`;
      label.style.cssText = 'font-size:13px;font-weight:700;margin-bottom:6px;';
      panel.append(label, grid);

      const key = document.createElement('div');
      key.textContent = 'Green: done. Rows run Monday to Sunday; today is outlined.';
      key.style.cssText = 'font-size:12px;opacity:0.7;margin:6px 0 10px;';
      panel.appendChild(key);

      for (const r of h.recent) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:10px;min-height:36px;align-items:center;border-top:1px solid var(--border);font-size:14px;';
        const when = document.createElement('div');
        when.style.flex = '1 1 auto';
        when.textContent = dayText(dayNumberToDate(r.day));
        const gap = document.createElement('div');
        gap.style.cssText = 'font-size:12px;opacity:0.7;';
        gap.textContent = r.gap === null ? '' : `${plural(r.gap, 'day')} after the one before`;
        row.append(when, gap);
        panel.appendChild(row);
      }
    },
  });
}
