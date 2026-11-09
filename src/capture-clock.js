// @ts-check
/** @typedef {import('./types.js').Heading} Heading */
// A capture template's :clock-in, :clock-keep and :clock-resume: the clock work org-capture does around filing an entry.
import { clockIn, clockOut } from './clock.js';

/**
 * Clocks in the heading a capture filed under, as org-capture does: the running clock, if any, is stopped first. Without :clock-keep
 * the new clock is stopped again as the capture finishes (Emacs does that when you finish the capture buffer, so it leaves a clock of no
 * length), and with :clock-resume the clock that was interrupted starts again. :clock-keep wins over :clock-resume.
 * @param {Heading} heading the new entry, or the heading the new text went under
 * @param {Heading | null} previous the heading with a running clock now
 * @param {{ keep?: boolean, resume?: boolean }} how
 * @param {string} timestamp the inactive timestamp of now @param {Date} now
 * @param {(heading: Heading) => Record<string, any>} optionsFor how a heading's clock lines are written
 * @returns {{ started: boolean, stopped: Heading | null, running: boolean }}
 */
function clockCaptured(heading, previous, how, timestamp, now, optionsFor) {
  const interrupted = previous && previous !== heading ? previous : null;
  let stopped = null;
  if (interrupted && clockOut(interrupted, timestamp, now, optionsFor(interrupted))) stopped = interrupted;
  const started = clockIn(heading, timestamp, optionsFor(heading));
  if (!started) return { started, stopped, running: false };
  if (how.keep) return { started, stopped, running: true };
  clockOut(heading, timestamp, now, optionsFor(heading));
  if (how.resume && stopped) return { started, stopped, running: clockIn(stopped, timestamp, optionsFor(stopped)) };
  return { started, stopped, running: false };
}

export { clockCaptured };
