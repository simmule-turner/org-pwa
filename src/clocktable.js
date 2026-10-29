// @ts-check
/** @typedef {import('./types.js').Doc} Doc */
/**
 * The Clock report of the Agenda panel: a range of days and a depth, written as `#+BEGIN: clocktable ... #+END:`. The table itself
 * comes from src/clock-report.js, which reads every parameter Org's clocktable does; this module is the picker-driven way in.
 */

import { buildClockReport, formatCaptionTimestamp } from './clock-report.js';

/**
 * `:tstart` / `:tend` as Org reads them: "YYYY-MM-DD", optionally followed by " HH:MM". The start is included and the end
 * is not, so `:tend "2026-08-07"` stops at midnight before the 7th. Either may be empty for an open side.
 * @param {string | null | undefined} tstartStr
 * @param {string | null | undefined} tendStr
 */
function parseClocktableRange(tstartStr, tendStr) {
  /** @param {string | null | undefined} str */
  const read = (str) => {
    const m = /^(\d{4})-(\d\d)-(\d\d)(?: (\d\d):(\d\d))?$/.exec((str || '').trim());
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0)) : null;
  };
  return { tstart: read(tstartStr), tend: read(tendStr) };
}

/**
 * What a clocktable over `[tstartStr, tendStr)` is made from; see renderClocktable.
 * @param {Doc} doc
 * @param {string | null | undefined} [tstartStr]
 * @param {string | null | undefined} [tendStr]
 * @param {number} [maxlevel]
 */
function computeClocktable(doc, tstartStr, tendStr, maxlevel = 2) {
  return { doc, tstartStr, tendStr, maxlevel };
}

/**
 * The org dynamic block `#+BEGIN: clocktable ... #+END:` for a range and depth, as Org writes it.
 * @param {ReturnType<typeof computeClocktable>} computed
 * @param {string | null | undefined} tstartStr
 * @param {string | null | undefined} tendStr
 * @param {Date} [now]
 * @param {number} [maxlevel]
 */
function renderClocktable(computed, tstartStr, tendStr, now = new Date(), maxlevel = 2) {
  const tstartPart = tstartStr ? ` :tstart "${tstartStr}"` : '';
  const tendPart = tendStr ? ` :tend "${tendStr}"` : '';
  return buildClockReport({ files: [{ name: '', doc: computed.doc }], params: `:maxlevel ${maxlevel} :scope file${tstartPart}${tendPart}`, now });
}

export { computeClocktable, renderClocktable, parseClocktableRange, formatCaptionTimestamp };
