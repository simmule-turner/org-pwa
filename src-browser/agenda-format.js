// Extracted from app.js: agenda format. These have no dependency on the app's shared mutable state,
// so they moved verbatim (see tools/ notes in CHANGELOG v412).
import { summarizeDayEffort } from '../src/agenda.js';
import { formatClockDuration } from '../src/clock.js';

/** Moves `anchorDate` by one unit of `viewType` in `direction` (-1 or 1)
 *  — this is "scrolling by the view amount": a day, a week, or a month. */
export function agendaStepAnchor(viewType, anchorDate, direction) {
  const next = new Date(anchorDate);
  if (viewType === 'day') next.setDate(next.getDate() + direction);
  else if (viewType === 'week') next.setDate(next.getDate() + direction * 7);
  else next.setMonth(next.getMonth() + direction);
  return next;
}

export function isoWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7; // Sunday=0 -> 7, so Monday=1..Sunday=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // move to this week's own Thursday
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

export function buildDayHeaderRow(dateKeyStr, showWeekNumber, dayItems = []) {
  const [y, m, d] = dateKeyStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const isToday = date.toDateString() === new Date().toDateString();
  const dayOfWeek = date.getDay(); // 0=Sun..6=Sat
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  const row = document.createElement('div');
  row.style.display = 'flex';
  row.style.alignItems = 'baseline';
  row.style.gap = '2px';
  row.style.fontSize = '12px';
  row.style.fontFamily = 'monospace';
  row.style.fontWeight = isWeekend ? '700' : '400';
  row.style.opacity = '0.75';
  row.style.margin = '10px 0 4px';

  const weekdaySpan = document.createElement('span');
  weekdaySpan.textContent = date.toLocaleDateString(undefined, { weekday: 'long' });
  weekdaySpan.style.width = '10ch'; // just past "Wednesday" (9ch), the longest English weekday name -- every day-of-month column lines up underneath it regardless of which weekday is showing. A fixed width, not min-width -- min-width only sets a floor, so if any weekday name's actual rendered width ever exceeded the guessed value on some font/platform, that row's own column would silently grow wider than the rest, misaligning everything after it.
  weekdaySpan.style.whiteSpace = 'nowrap';
  row.appendChild(weekdaySpan);

  const daySpan = document.createElement('span');
  daySpan.textContent = String(d); // right-aligned, never zero-padded -- "1" stays "1", not "01"
  daySpan.style.width = '2ch';
  daySpan.style.textAlign = 'right';
  daySpan.style.whiteSpace = 'nowrap';
  row.appendChild(daySpan);

  const monthYearSpan = document.createElement('span');
  monthYearSpan.textContent = ' ' + date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  row.appendChild(monthYearSpan);

  if (showWeekNumber) {
    const weekSpan = document.createElement('span');
    weekSpan.textContent = 'W' + isoWeekNumber(date);
    row.appendChild(weekSpan);
  }

  if (isToday) {
    const todaySpan = document.createElement('span');
    todaySpan.textContent = '\u2014 Today';
    row.appendChild(todaySpan);
  }

  // Planned effort for the day, when any of it has been estimated -- a
  // day nobody has put an EFFORT on shows nothing extra.
  const effort = summarizeDayEffort(dayItems);
  if (effort.estimated > 0) {
    const effortSpan = document.createElement('span');
    effortSpan.setAttribute('data-day-effort', '');
    effortSpan.style.marginLeft = 'auto';
    effortSpan.style.paddingLeft = '8px';
    effortSpan.style.fontWeight = '400';
    effortSpan.style.whiteSpace = 'nowrap';
    effortSpan.textContent =
      `\u23f1 ${formatClockDuration(Math.round(effort.minutes))}` + (effort.unestimated > 0 ? ` +${effort.unestimated}?` : '');
    effortSpan.title =
      `${effort.estimated} estimated task${effort.estimated === 1 ? '' : 's'}` +
      (effort.unestimated > 0 ? `; ${effort.unestimated} TODO${effort.unestimated === 1 ? '' : 's'} with no estimate yet` : '');
    row.appendChild(effortSpan);
  }

  return row;
}

export function formatAgendaItemTimeText(item) {
  if (!item.hasTime) return '';
  const start = item.date.toTimeString().slice(0, 5);
  if (item.endDate) return start + '-' + item.endDate.toTimeString().slice(0, 5);
  return start + ' \u2026\u2026';
}

export function agendaItemKindLabel(item) {
  if (item.hasTime) return null;
  if (item.kind === 'scheduled') return 'Scheduled:';
  if (item.kind === 'deadline') return 'Deadline:';
  return null;
}

export function formatAgendaRangeLabel(viewType, start, end) {
  const fmt = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  if (viewType === 'day') return fmt(start) + ` (W${isoWeekNumber(start)})`;
  if (viewType === 'month') {
    const w1 = isoWeekNumber(start);
    const w2 = isoWeekNumber(end);
    const weekRange = w1 === w2 ? `W${w1}` : `W${w1}-W${w2}`;
    return start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) + ` (${weekRange})`;
  }
  return fmt(start) + ' \u2013 ' + fmt(end) + ` (W${isoWeekNumber(start)})`;
}
