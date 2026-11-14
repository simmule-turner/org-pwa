// @ts-check
// Timestamps as the export back ends write them (org-timestamp-translate): the date with its day name taken from the date itself, and
// `<:` (org-export-with-timestamps), which leaves out the timestamps that stand alone in a paragraph.

export const TIMESTAMP_RE = /([<[])(\d{4})-(\d{1,2})-(\d{1,2})(?: +[^\s\d>\]+-][^\s>\]]*)?(?: +(\d{1,2}):(\d{2})(?:-(\d{1,2}):(\d{2}))?)?((?: +(?:[.+]\+?|-{1,2})\d+[hdwmy](?:\/\d+[hdwmy])?)*) *([>\]])/g;
const DAY_ABBREVIATIONS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Timestamps as ox-ascii writes them: the date with its day name (a day past the end of a month rolls over, as encode-time does),
 * a time range as two timestamps, and a repeater without its habit part.
 * @param {string} text
 */
export function translateTimestamps(text) {
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return text.replace(TIMESTAMP_RE, (whole, open, y, mo, d, h1, m1, h2, m2, marks, close) => {
    if (open === '<' !== (close === '>')) return whole;
    const dayText = (/** @type {Date} */ date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${DAY_ABBREVIATIONS[date.getDay()]}`;
    const tail = marks.replace(/\/\d+[hdwmy]/g, '');
    // a time goes through the local clock, as encode-time does: 24:00 is midnight of the next day, and a time skipped by
    // daylight saving time moves forward
    const stamp = (/** @type {string | undefined} */ hh, /** @type {string | undefined} */ mm) => {
      if (hh === undefined) return `${open}${dayText(new Date(Number(y), Number(mo) - 1, Number(d), 12))}${tail}${close}`;
      const at = new Date(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm));
      return `${open}${dayText(at)} ${pad(at.getHours())}:${pad(at.getMinutes())}${tail}${close}`;
    };
    return h2 === undefined ? stamp(h1, m1) : `${stamp(h1, m1)}--${stamp(h2, m2)}`;
  });
}

/**
 * What `#+OPTIONS: <:` does to a paragraph: when it holds nothing but timestamps and blanks, the timestamps it says to leave out
 * (`nil`: all, `active`: all but the active ones, `inactive`: all but the inactive ones) are removed; any other paragraph stays as it is.
 * @param {string} text the paragraph
 * @param {boolean | string | undefined} mode true or undefined keeps everything
 */
export function withoutIsolatedTimestamps(text, mode) {
  if (mode === true || mode === undefined) return text;
  if (text.replace(TIMESTAMP_RE, '').replace(/--/g, '').trim() !== '') return text;
  return text.replace(TIMESTAMP_RE, (whole, open) => (mode === false || (mode === 'active' ? open === '[' : open === '<') ? '' : whole)).replace(/^[ \t]*--[ \t]*$/gm, '');
}

/**
 * One timestamp with the day name Org gives its date (a missing or wrong name is replaced), the rest as written.
 * @param {string} stamp
 */
export function withDayName(stamp) {
  return stamp.replace(/^([<[])(\d{4})-(\d\d)-(\d\d)(?: +[^\s\d>\]+-][^\s>\]]*)?/, (_whole, open, y, mo, d) => `${open}${y}-${mo}-${d} ${DAY_ABBREVIATIONS[new Date(Number(y), Number(mo) - 1, Number(d), 12).getDay()]}`);
}
