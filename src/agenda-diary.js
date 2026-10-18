// @ts-check
// The diary file in the Agenda (org-agenda-include-diary): one row per entry, with the holidays, in the category "Diary".
import { datedEntriesAt, dateFormsFor, describeDateForm, orgTimeOfDay, diaryRowsLocated, sexpEntryLines } from './diary-file.js';
import { parseOrg } from './org-parser.js';
import { enumerateDays } from './diary-sexp.js';

/** @typedef {import('./diary-file.js').DiaryOptions} DiaryOptions */
/** @typedef {{ text: string, included?: { text: string }[], options: DiaryOptions }} DiarySource */

/** The key of a day, for grouping. @param {Date} d */
function dayKey(d) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * The Agenda items for the diary file between `rangeStart` and `rangeEnd`.
 *
 * Plain dated lines are matched here (diary-file.js). Sexp lines are evaluated by the Agenda's own sexp code: each becomes a
 * heading of a document of its own, so the same evaluator that reads `%%(…)` lines in an Org file reads them in the diary.
 * @param {DiarySource} diary
 * @param {Date} rangeStart
 * @param {Date} rangeEnd
 * @param {import('./agenda.js').AgendaOptions} agendaOptions  the options of the agenda being built
 * @param {(docs: { documentId: string, doc: import('./types.js').Doc }[], opts: import('./agenda.js').AgendaOptions) => import('./agenda.js').AgendaItem[]} buildItems  buildAgendaItems, passed in to keep the modules apart
 * @returns {import('./agenda.js').AgendaItem[]}
 */
export function buildDiaryItems(diary, rangeStart, rangeEnd, agendaOptions, buildItems) {
  const options = diary.options;
  const files = [diary.text, ...((options.hooks || []).includes('diary-include-other-diary-files') ? (diary.included || []).map((f) => f.text) : [])];
  const sexpLines = files.flatMap((text) => sexpEntryLines(text, options));

  /** @type {Map<string, Map<number, string>>} */ const sexpByDay = new Map();
  if (sexpLines.length > 0) {
    const doc = parseOrg(`#+CATEGORY: Diary\n${sexpLines.map((line) => `* Diary\n${line}\n`).join('')}`);
    const found = buildItems([{ documentId: 'diary-file', doc }], { ...agendaOptions, diary: null, contactsDocs: null, habits: null, rangeStart, rangeEnd });
    for (const item of found) {
      const ordinal = doc.children.indexOf(item.heading);
      if (ordinal === -1) continue;
      const key = dayKey(item.date);
      if (!sexpByDay.has(key)) sexpByDay.set(key, new Map());
      const day = /** @type {Map<number, string>} */ (sexpByDay.get(key));
      if (!day.has(ordinal)) day.set(ordinal, String(item.title));
    }
  }

  const template = parseOrg('* Diary').children[0];
  /** @type {import('./agenda.js').AgendaItem[]} */ const items = [];
  for (const day of enumerateDays(rangeStart, rangeEnd)) {
    const titles = sexpByDay.get(dayKey(day));
    let ordinal = -1;
    const rows = diaryRowsLocated(diary, day, options, () => {
      ordinal++;
      return titles?.get(ordinal) ?? null;
    });
    for (const located of rows) {
      const row = located.text;
      const time = orgTimeOfDay(row);
      items.push({
        documentId: 'diary-file',
        heading: { ...template, title: row },
        kind: 'diary-sexp',
        hasTime: !!time,
        repeater: null,
        todo: null,
        priority: null,
        tags: [],
        title: row,
        date: time ? new Date(day.getFullYear(), day.getMonth(), day.getDate(), time.hour, time.minute) : new Date(day.getFullYear(), day.getMonth(), day.getDate()),
        daysOverdue: 0,
        category: 'Diary',
        diaryAt: located.file >= 0 ? { file: located.file, startLine: located.startLine, endLine: located.endLine, lineText: located.lineText } : null,
      });
    }
  }
  return items;
}

/**
 * What one diary line means: whether it is an entry, the date form it matched, and the next days it applies on.
 * @param {string} line  the line, with its date
 * @param {DiaryOptions} options
 * @param {Date} from  the first day to look at
 * @param {import('./agenda.js').AgendaOptions} agendaOptions
 * @param {Parameters<typeof buildDiaryItems>[4]} buildItems
 * @param {{ count?: number, days?: number }} [limits]
 * @returns {{ kind: 'dated' | 'sexp' | 'none', form: string, text: string, dates: Date[] }}
 */
export function checkDiaryLine(line, options, from, agendaOptions, buildItems, limits = {}) {
  const count = limits.count ?? 5;
  const days = limits.days ?? 1500;
  const end = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days);
  const mark = (options.nonmarkingSymbol ?? '&').replace(/[[*.\\?+^$]/g, '\\$&');
  const sexp = (options.sexpSymbol ?? '%%').replace(/[[*.\\?+^$]/g, '\\$&');
  if (new RegExp(`^(?:${mark})?${sexp}\\(`).test(line)) {
    const probe = { text: line, options: { ...options, showHolidays: false, hooks: [] } };
    const items = buildDiaryItems(probe, from, end, agendaOptions, buildItems);
    const seen = new Set();
    /** @type {Date[]} */ const dates = [];
    for (const item of items) {
      const d = new Date(item.date.getFullYear(), item.date.getMonth(), item.date.getDate());
      if (seen.has(+d)) continue;
      seen.add(+d);
      dates.push(d);
      if (dates.length >= count) break;
    }
    return { kind: 'sexp', form: '', text: items[0] ? String(items[0].title) : '', dates };
  }
  /** @type {Date[]} */ const dates = [];
  let formIndex = -1;
  let text = '';
  for (const day of enumerateDays(from, end)) {
    const found = datedEntriesAt(line, day, { ...options, showHolidays: false });
    if (found.length === 0) continue;
    if (formIndex === -1) {
      formIndex = found[0].formIndex;
      text = found[0].lines.map((l) => l.trim()).filter(Boolean).join('; ');
    }
    dates.push(day);
    if (dates.length >= count) break;
  }
  if (formIndex === -1) return { kind: 'none', form: '', text: '', dates };
  return { kind: 'dated', form: describeDateForm(dateFormsFor(options)[formIndex]), text, dates };
}
