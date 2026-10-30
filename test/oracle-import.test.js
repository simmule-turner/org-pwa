import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { importIcalendarAsOrgText } from '../src/import-icalendar.js';
import { KNOWN } from './support/oracle-import-known.js';

// Emacs 29.3 (tools/gen-oracle-import.mjs): what icalendar-import-buffer makes of calendars, read as events (summary, day, time, end,
// repeat, description, location). Emacs writes diary lines and the app writes headings, so both are cut down to those facts.
const oracle = JSON.parse(fs.readFileSync(new URL('./fixtures/oracle-import.json', import.meta.url), 'utf8'));

/** @typedef {{ summary: string, date: string, time: string, end: string, repeat: string, desc: string, loc: string }} Event */
const pad = (/** @type {string} */ n) => n.padStart(2, '0');
const iso = (/** @type {string} */ m, /** @type {string} */ d, /** @type {string} */ y) => `${y}-${pad(m)}-${pad(d)}`;
const TIME = '(?: (\\d\\d:\\d\\d(?:-\\d\\d:\\d\\d)?))?';

/** The events of an Emacs diary text. @param {string} diary @returns {Event[]} */
function fromDiary(diary) {
  /** @type {Event[]} */
  const events = [];
  /** @type {'summary' | 'desc' | 'loc' | 'other'} */
  let mode = 'summary';
  for (const line of diary.split('\n')) {
    if (line === '') continue;
    if (!line.startsWith(' ') || events.length === 0) {
      let m;
      /** @type {Event} */
      const e = { summary: '', date: '', time: '', end: '', repeat: '', desc: '', loc: '' };
      if ((m = new RegExp(`^(\\d+)/(\\d+)/(\\d+)${TIME} (.*)$`).exec(line))) Object.assign(e, { date: iso(m[1], m[2], m[3]), time: m[4] ?? '', summary: m[5] });
      else if ((m = new RegExp(`^%%\\(and \\(diary-block (\\d+) (\\d+) (\\d+) (\\d+) (\\d+) (\\d+)\\)\\)${TIME} (.*)$`).exec(line))) {
        const [from, to] = [iso(m[1], m[2], m[3]), iso(m[4], m[5], m[6])];
        Object.assign(e, { date: from, end: to === from ? '' : to, time: m[7] ?? '', summary: m[8] });
      } else if ((m = new RegExp(`^%%\\(and \\(diary-cyclic (\\d+) (\\d+) (\\d+) (\\d+)\\)\\)${TIME} (.*)$`).exec(line))) Object.assign(e, { date: iso(m[2], m[3], m[4]), repeat: `${m[1]}d`, time: m[5] ?? '', summary: m[6] });
      else if ((m = /^%%\(diary-anniversary (\d+) (\d+) (\d+)\)(?: (\d\d:\d\d(?:-\d\d:\d\d)?))? (.*)$/.exec(line))) Object.assign(e, { date: '', repeat: '1y', time: m[4] ?? '', summary: m[5] });
      else {
        // another diary sexp: skip its balanced parentheses; a monthly rule (day of the month, no end) is a repeat of one month
        let depth = 0;
        let k = 2;
        for (; k < line.length; k++) {
          if (line[k] === '(') depth++;
          else if (line[k] === ')' && --depth === 0) { k++; break; }
        }
        const sexp = line.slice(2, k);
        const t = /^ ?(?:(\d\d:\d\d(?:-\d\d:\d\d)?) )?(.*)$/.exec(line.slice(k));
        const monthly = /^\(and \(diary-date t \d+ t\) \(diary-block (\d+) (\d+) (\d+) 1 1 9999\)\)$/.exec(sexp);
        Object.assign(e, monthly ? { date: iso(monthly[1], monthly[2], monthly[3]), repeat: '1m' } : { repeat: 'complex' }, { time: t?.[1] ?? '', summary: t?.[2] ?? line });
      }
      events.push(e);
      mode = 'summary';
      continue;
    }
    const e = events[events.length - 1];
    const prefix = /^ (Desc|Location|Organizer): ?(.*)$/.exec(line);
    if (prefix) {
      mode = prefix[1] === 'Desc' ? 'desc' : prefix[1] === 'Location' ? 'loc' : 'other';
      if (mode === 'desc') e.desc = prefix[2];
      else if (mode === 'loc') e.loc = prefix[2];
    } else if (mode === 'summary') e.summary += ' ' + line.slice(1);
    else if (mode === 'desc') e.desc += '\n' + line.slice(1);
  }
  return events;
}

/** The events of the headings the app makes. @param {string} orgText @returns {Event[]} */
function fromOrg(orgText) {
  /** @type {Event[]} */
  const events = [];
  const lines = orgText.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const h = /^\* (?:TODO |DONE )?(.*?)(?: <(\d{4}-\d\d-\d\d) \w+(?: (\d\d:\d\d(?:-\d\d:\d\d)?))?(?: [.+]+(\d+)([dwmy]))?>(?:--<(\d{4}-\d\d-\d\d) \w+(?: \d\d:\d\d)?>)?)?(?: (:[\w:@]+:))?$/.exec(lines[i]);
    if (!h) continue;
    /** @type {Event} */
    const e = { summary: h[1], date: h[2] ?? '', time: h[3] ?? '', end: h[6] ?? '', repeat: h[4] ? `${h[5] === 'w' ? Number(h[4]) * 7 : h[4]}${h[5] === 'w' ? 'd' : h[5]}` : '', desc: '', loc: '' };
    let j = i + 1;
    const body = [];
    for (; j < lines.length && !lines[j].startsWith('* '); j++) {
      const loc = /^:LOCATION: (.*)$/.exec(lines[j]);
      if (loc) e.loc = loc[1];
      else if (/^ {2}\S/.test(lines[j]) || (body.length && /^ {2}/.test(lines[j]))) body.push(lines[j].slice(2));
      const rr = /^:RRULE: /.test(lines[j]);
      if (rr) e.repeat = 'complex';
    }
    e.desc = body.join('\n').trimEnd();
    events.push(e);
    i = j - 1;
  }
  return events;
}

/** Compares what both sides know: a diary sexp that gives no date (an anniversary, a rule Emacs cannot write as a repeat) leaves the day to the app's. @param {Event[]} got @param {Event[]} want */
function align(got, want) {
  return [got.map((e, i) => (want[i] && want[i].date === '' ? { ...e, date: '' } : e)), want.map((e) => ({ ...e, summary: e.summary.replace(/^ /, '') }))];
}
const show = (/** @type {Event[]} */ es) => es.map((e) => `${e.summary}|${e.date}|${e.time}|${e.end}|${e.repeat}|${e.desc}|${e.loc}`).join('\n');

/** @param {{ ics: string, emacs: string }} c @returns {{ got: string, want: string }} */
function compare(c) {
  /** @type {string} */
  let got;
  try {
    const [g, w] = align(fromOrg(importIcalendarAsOrgText(c.ics, { zone: 'UTC' }).orgText), c.emacs.startsWith('ERROR') ? [] : fromDiary(c.emacs));
    got = show(g);
    return { got, want: c.emacs.startsWith('ERROR') ? c.emacs : show(w) };
  } catch (e) {
    got = 'ERROR ' + /** @type {Error} */ (e).message;
  }
  const want = c.emacs.startsWith('ERROR') ? c.emacs : show(fromDiary(c.emacs));
  return { got, want };
}

test('calendar events give what icalendar-import-buffer gives, except the known deviations', () => {
  const bad = [];
  for (const c of oracle.cases) {
    const { got, want } = compare(c);
    if (got !== want && !KNOWN.some((k) => k.match.test(c.ics))) bad.push({ ics: c.ics.replace(/BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-\/\/test\/\/EN\r\n|END:VCALENDAR\r\n/g, ''), got, want });
  }
  assert.deepEqual(bad.slice(0, Number(process.env.SHOW) || 12), []);
  assert.equal(bad.length, 0);
});

test('every known deviation still covers a deviating calendar', () => {
  for (const k of KNOWN) assert.ok(oracle.cases.some((c) => k.match.test(c.ics) && compare(c).got !== compare(c).want), k.reason);
});
