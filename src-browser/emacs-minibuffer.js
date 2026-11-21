// @ts-check
// Emacs mode's minibuffer: a prompt on the bottom line of the text with the matches above it (completion as Emacs's try-completion has it,
// src/emacs-complete.js), and a read-only list for *Messages* and the buffer list. Plain DOM on the text's wrapper; nothing else moves.
import { allCompletions, completeInput } from '../src/emacs-complete.js';
import { buildMonthGrid, MONTH_NAMES } from '../src/calendar-grid.js';
import { calendarMotion, dateAnswer, isoDate, moveCalendarDate } from '../src/date-prompt.js';
import { eventKey } from '../src/emacs-keymap.js';

/** The arrows, which Org's date prompt binds with Shift. */
const SHIFTED_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

/** @typedef {{ cursor: Date, describe: (answer: string) => { date: Date, text: string }, markers: (year: number, month: number) => (date: Date) => { hasBirthday?: boolean, hasOther?: boolean } | undefined }} DateCalendar
 *  The calendar beside a date prompt: `cursor` is where Emacs's calendar starts (the default date), `describe` the live "=> <date>" for the answer so far, `markers` the days with something on them. */

/**
 * The calendar of a date prompt as Org has it in the minibuffer: the month with the day the answer means marked, the live display after the input, a tap on a day
 * that answers with it, S-arrows (a day, a week) and M-S-arrows (a month, a year) that move the calendar cursor, `<` and `>` that scroll a month, and `.` at the start
 * (or C-.) for today. The answer is what was typed, a space and the day picked (Emacs's `org-ans0`, `org-ans1`, `org-ans2`).
 * @param {{ calendar: DateCalendar, input: HTMLInputElement, note: HTMLElement, finish: (answer: string) => void }} o
 * @returns {{ element: HTMLElement, answer: () => string, update: () => void, key: (e: KeyboardEvent) => boolean }}
 */
function dateCalendar({ calendar, input, note, finish }) {
  const element = document.createElement('div');
  element.className = 'te-datecal';
  element.style.cssText = 'padding:4px 8px;max-width:21em;';
  /** @type {string | null} */ let picked = null;
  let cursor = calendar.cursor;
  let view = { year: calendar.cursor.getFullYear(), month: calendar.cursor.getMonth() };
  let scrolled = false;
  const answer = () => dateAnswer(input.value, picked);
  const scroll = (/** @type {number} */ months) => {
    const total = view.year * 12 + view.month + months;
    view = { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
    scrolled = true;
    draw();
  };
  const pick = (/** @type {Date} */ date, /** @type {boolean} */ accept) => {
    picked = isoDate(date);
    if (accept) finish(answer());
    else update();
  };
  function draw() {
    const { date: shown } = calendar.describe(answer());
    const marks = calendar.markers(view.year, view.month);
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;';
    const nav = (/** @type {string} */ label, /** @type {string} */ title, /** @type {number} */ by) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.title = title;
      b.setAttribute('aria-label', title);
      b.style.cssText = 'font:inherit;border:0;background:transparent;color:inherit;padding:0 8px;cursor:pointer;';
      b.onpointerdown = (e) => e.preventDefault(); // the input keeps the focus
      b.onclick = () => scroll(by);
      return b;
    };
    const title = document.createElement('span');
    title.style.fontWeight = 'bold';
    title.textContent = `${MONTH_NAMES[view.month]} ${view.year}`;
    head.append(nav('«', 'Previous year', -12), nav('‹', 'Previous month (<)', -1), title, nav('›', 'Next month (>)', 1), nav('»', 'Next year', 12));
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(7,1fr);gap:1px;text-align:center;';
    for (const w of ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']) {
      const d = document.createElement('span');
      d.textContent = w;
      d.style.opacity = '.6';
      grid.appendChild(d);
    }
    for (const cell of buildMonthGrid(view.year, view.month, new Date())) {
      if (!cell) {
        grid.appendChild(document.createElement('span'));
        continue;
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = String(cell.day);
      b.dataset.date = isoDate(cell.date);
      b.style.cssText = 'font:inherit;border:1px solid transparent;border-radius:4px;background:transparent;color:inherit;padding:2px 0;cursor:pointer;';
      const mark = marks(cell.date);
      if (mark?.hasBirthday && mark.hasOther) b.style.background = '#CC5500';
      else if (mark?.hasBirthday) b.style.background = '#2E8B57';
      else if (mark?.hasOther) b.style.background = '#3B6EA5';
      if (mark?.hasBirthday || mark?.hasOther) b.style.color = '#fff';
      if (cell.isToday) b.style.textDecoration = 'underline';
      if (isoDate(cell.date) === isoDate(shown)) {
        b.style.border = '2px solid currentColor';
        b.style.fontWeight = 'bold';
        b.setAttribute('aria-current', 'date');
      }
      b.onpointerdown = (e) => e.preventDefault();
      b.onclick = () => pick(cell.date, true);
      grid.appendChild(b);
    }
    element.replaceChildren(head, grid);
  }
  function update() {
    const { date, text } = calendar.describe(answer());
    note.textContent = text;
    if (!scrolled || (picked !== null && isoDate(date) === picked)) {
      view = { year: date.getFullYear(), month: date.getMonth() };
      scrolled = false;
    }
    draw();
  }
  /** @param {KeyboardEvent} e @returns {boolean} whether the key was a calendar key */
  const key = (e) => {
    const name = eventKey({ key: e.key, ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey && SHIFTED_KEYS.has(e.key) });
    const motion = name ? calendarMotion(name) : null;
    if (motion) {
      cursor = moveCalendarDate(cursor, motion.unit, motion.n);
      scrolled = false;
      pick(cursor, false);
    } else if (!e.ctrlKey && !e.altKey && (e.key === '<' || e.key === '>')) scroll(e.key === '<' ? -1 : 1);
    else if (e.ctrlKey && e.key === 'v') scroll(3);
    else if (e.altKey && e.key === 'v') scroll(-3);
    else if ((e.ctrlKey && e.key === '.') || (e.key === '.' && !e.ctrlKey && !e.altKey && input.selectionStart === 0 && input.selectionEnd === 0)) {
      cursor = new Date();
      scrolled = false;
      pick(cursor, false);
    } else return false;
    e.preventDefault();
    return true;
  };
  return { element, answer, update, key };
}

/** @param {HTMLElement} host @returns {HTMLDivElement} */
function panel(host) {
  const box = document.createElement('div');
  box.className = 'te-minibuffer';
  box.style.cssText = 'position:absolute;left:0;right:0;bottom:0;z-index:30;display:flex;flex-direction:column;background:var(--surface);border-top:1px solid var(--border);font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;';
  host.appendChild(box);
  return box;
}

/**
 * Reads a line with completion.
 * With `calendar` (a date prompt) the month is drawn above the line, and the answer is what was typed and the day picked in it.
 * @param {{ host: HTMLElement, prompt: string, candidates: string[], initial?: string, fold?: boolean, requireMatch?: boolean,
 *   history?: string[], message?: (text: string) => void, calendar?: DateCalendar | null }} o
 * @returns {Promise<string | null>} what was typed, or null when quit (C-g or Esc)
 */
export function readMinibuffer(o) {
  return new Promise((resolve) => {
    const box = panel(o.host);
    const list = document.createElement('div');
    list.style.cssText = 'max-height:8.5em;overflow-y:auto;padding:2px 8px;display:flex;flex-wrap:wrap;gap:2px 16px;';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:4px;padding:4px 8px;';
    const label = document.createElement('span');
    label.textContent = o.prompt;
    label.style.cssText = 'font-weight:bold;white-space:pre;';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = o.initial ?? '';
    input.autocapitalize = 'off';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.style.cssText = 'flex:1;min-width:0;font:inherit;border:0;outline:0;background:transparent;color:inherit;';
    const note = document.createElement('span');
    note.style.cssText = 'opacity:.7;white-space:nowrap;';
    row.append(label, input, note);
    box.append(list, row);
    const finish = (/** @type {string | null} */ value) => {
      box.remove();
      resolve(value);
    };
    const cal = o.calendar ? dateCalendar({ calendar: o.calendar, input, note, finish }) : null;
    if (cal) box.prepend(cal.element);
    const history = o.history ?? [];
    let historyAt = -1;
    const fold = o.fold ?? false;

    const refresh = () => {
      list.replaceChildren();
      for (const name of allCompletions(input.value, o.candidates, fold).slice(0, 200)) {
        const item = document.createElement('button');
        item.type = 'button';
        item.textContent = name;
        item.style.cssText = 'font:inherit;border:0;background:transparent;color:inherit;padding:0;cursor:pointer;';
        item.onclick = () => {
          input.value = name;
          refresh();
          input.focus();
        };
        list.appendChild(item);
      }
    };
    input.addEventListener('input', () => {
      note.textContent = '';
      refresh();
      cal?.update();
    });
    input.addEventListener('keydown', (e) => {
      const ctrl = e.ctrlKey;
      if (cal?.key(e)) return;
      if (e.key === 'Escape' || (ctrl && e.key === 'g')) {
        e.preventDefault();
        finish(null);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (cal) {
          finish(cal.answer());
          return;
        }
        const typed = input.value;
        if (o.requireMatch && !o.candidates.includes(typed)) {
          const done = completeInput(typed, o.candidates, fold);
          if (done.input !== typed && allCompletions(done.input, o.candidates, fold).length === 1 && o.candidates.includes(done.input)) finish(done.input);
          else {
            note.textContent = '[No match]';
            o.message?.('[No match]');
          }
          return;
        }
        finish(typed);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const done = completeInput(input.value, o.candidates, fold);
        input.value = done.input;
        note.textContent = done.message;
        refresh();
      } else if ((e.altKey && e.key === 'p') || (e.altKey && e.key === 'n') || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const older = e.key === 'ArrowUp' || e.key === 'p';
        historyAt = Math.max(-1, Math.min(history.length - 1, historyAt + (older ? 1 : -1)));
        input.value = historyAt < 0 ? '' : history[historyAt];
        refresh();
      }
    });
    refresh();
    cal?.update();
    input.focus();
  });
}

/**
 * A one-key question in the echo area (Emacs's read-char-exclusive and read-char-choice): no Enter, the first accepted key answers. Space answers as `y`,
 * Backspace as `n`, Esc, C-g and Enter as `q`; any other key is ignored. Keys in `stay` call `onStay` and leave the question open.
 * @param {{ host: HTMLElement, prompt: string, keys: string, stay?: string, onStay?: (key: string) => void }} o
 * @returns {Promise<string>}
 */
export function readKeyEcho(o) {
  return new Promise((resolve) => {
    const box = panel(o.host);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:flex-start;gap:4px;padding:4px 8px;';
    const label = document.createElement('span');
    label.textContent = o.prompt;
    label.style.cssText = 'font-weight:bold;white-space:pre-wrap;flex:1;min-width:0;';
    const input = document.createElement('input');
    input.type = 'text';
    input.autocapitalize = 'off';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.style.cssText = 'flex:0 0 1.5em;width:1.5em;font:inherit;border:0;outline:0;background:transparent;color:inherit;';
    row.append(label, input);
    box.append(row);
    /** @param {string} key */
    const answer = (key) => {
      if (o.stay?.includes(key)) {
        o.onStay?.(key);
        return;
      }
      box.remove();
      resolve(key);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape' || e.key === 'Enter' || (e.ctrlKey && e.key === 'g')) answer('q');
      else if (e.key === 'Backspace' || e.key === 'Delete') answer('n');
      else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const typed = e.key === ' ' ? 'y' : e.key;
        if (o.keys.includes(typed)) answer(typed);
      }
    });
    input.focus();
  });
}

/**
 * A read-only list over the text (the *Messages* log, the buffer list): `q`, Esc, C-g or a tap on its title close it; a line can be picked when `onPick` is given.
 * @param {{ host: HTMLElement, title: string, lines: string[], onPick?: (index: number) => void }} o
 * @returns {Promise<void>}
 */
export function showList(o) {
  return new Promise((resolve) => {
    const box = panel(o.host);
    box.style.top = '0';
    box.style.borderTop = '0';
    box.style.borderBottom = '1px solid var(--border)';
    box.style.maxHeight = '100%';
    const head = document.createElement('div');
    head.textContent = `${o.title}   (q closes; so does a tap here)`;
    head.style.cssText = 'font-weight:bold;padding:4px 8px;border-bottom:1px solid var(--border);cursor:pointer;';
    head.onclick = () => close();
    const body = document.createElement('div');
    body.tabIndex = 0;
    body.style.cssText = 'flex:1;overflow:auto;padding:4px 8px;white-space:pre;outline:0;';
    o.lines.forEach((text, index) => {
      const line = document.createElement('div');
      line.textContent = text;
      if (o.onPick) {
        line.style.cursor = 'pointer';
        line.onclick = () => {
          close();
          o.onPick?.(index);
        };
      }
      body.appendChild(line);
    });
    const close = () => {
      box.remove();
      resolve();
    };
    body.addEventListener('keydown', (e) => {
      if (e.key === 'q' || e.key === 'Escape' || (e.ctrlKey && e.key === 'g')) {
        e.preventDefault();
        close();
      }
    });
    box.append(head, body);
    body.focus();
  });
}
