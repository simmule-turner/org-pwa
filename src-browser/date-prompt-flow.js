// @ts-check
// The question `org-read-date` asks, in the minibuffer: Emacs's prompt text (`Date+time [2026-11-24]: `, with SCHEDULED or DEADLINE before it for
// those commands), and in Emacs mode the calendar beside it (src-browser/emacs-minibuffer.js). The answer is what Emacs hands its analysis (what was
// typed and the day picked), null when quit.
import { datePromptLabel, describeDate } from '../src/date-prompt.js';
import { readDateSettings } from '../src/read-date.js';
import { S } from './app-state.js';
import { dayMarkerLookup } from './calendar-markers.js';
import { readFromMinibuffer } from './minibuffer-prompt.js';

/**
 * @param {{ prefix?: string | null, defaultTime?: Date | null, withTime?: boolean, initial?: string }} [o]
 *   `defaultTime` is the date the prompt starts from (that of the time stamp being changed), `initial` the text it starts with (its time of day).
 * @returns {Promise<string | null>}
 */
export function readDatePrompt({ prefix = null, defaultTime = null, withTime = false, initial = '' } = {}) {
  const now = new Date();
  const vars = readDateSettings({ ...S.globalVariables, ...S.state.localVariables });
  const label = datePromptLabel({ prefix, defaultTime, withTime, now, extendTodayUntil: vars.extendTodayUntil });
  return readFromMinibuffer(label, initial, [], {
    cursor: defaultTime ?? now,
    describe: (answer) => describeDate(answer, { defaultTime, withTime, now, vars }),
    markers: dayMarkerLookup,
  });
}
