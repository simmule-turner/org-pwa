// @ts-check
// Moving a SCHEDULED or DEADLINE to another day as Emacs does: the repeater and warning stay, a time that is not typed again goes.

const DATE_RE = /\d{4}-\d{2}-\d{2}(?: [^\s\d<>\]+.-]+\.?)?/;

const CADENCE_RE = /\s(?:\+\+|\.\+|\+)\d+[hdwmy](?:\/\d+[hdwmy])?/;
const WARNING_RE = /\s--?\d+[hdwmy]/;

/**
 * What `org-schedule` / `org-deadline` write: `picked` (its date and, if the person typed one, its time), with the repeater and the
 * warning period `existing` had. A time the old stamp had is not kept: Emacs drops it when the new date comes without one. With no
 * `existing`, `picked` as it is.
 * @param {string | null | undefined} existing  e.g. "<2026-10-11 Sun 09:00 ++14d -2d>"
 * @param {string} picked  e.g. "<2026-10-25 Sun>"
 * @returns {string}
 */
export function rescheduleTimestamp(existing, picked) {
  if (!existing || !DATE_RE.test(existing) || !DATE_RE.test(picked)) return picked;
  const cadence = CADENCE_RE.exec(existing)?.[0] ?? '';
  const warning = WARNING_RE.exec(existing)?.[0] ?? '';
  const extra = (cadence && !CADENCE_RE.test(picked) ? cadence : '') + (warning && !WARNING_RE.test(picked) ? warning : '');
  return picked.replace(/([>\]])$/, `${extra}$1`);
}

/** Whether a SCHEDULED/DEADLINE timestamp repeats, so that marking it done moves it on rather than finishing it.
 * @param {string | null | undefined} raw */
export function hasRepeater(raw) {
  return !!raw && /\s(?:\+\+|\.\+|\+)\d+[hdwmy]/.test(raw);
}

/**
 * Sets a heading's SCHEDULED or DEADLINE the way Emacs's `org-add-planning-info` does: the edited keyword goes first on the planning
 * line, the others keep their order, and CLOSED goes (the entry is open again).
 * @param {{ planning: Record<string, any> }} heading
 * @param {'scheduled' | 'deadline'} field
 * @param {string} stamp
 */
export function setPlanningField(heading, field, stamp) {
  const planning = heading.planning;
  const order = /** @type {string[]} */ (planning.order || []).filter((k) => k !== field && k !== 'closed');
  planning[field] = stamp;
  planning.closed = null;
  Object.defineProperty(planning, 'order', { value: [field, ...order], writable: true, enumerable: false });
}
