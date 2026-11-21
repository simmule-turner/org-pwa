// @ts-check
// The Emacs-mode keys that ask a question (C-c C-x p, C-c C-x e, C-c C-q, C-c ,, C-c C-x ;, C-c C-w) ask it in the minibuffer with the prompt
// text Emacs 29.3 / Org 9.6 uses, and apply the answer to the heading at the caret as the Emacs command does (checked against Emacs in
// test/emacs-prompts.test.js). Each returns after the answer is applied or the question quit.
import { getProperty, setProperty } from '../src/archive-model.js';
import { getAllowedEffortValues } from '../src/effort-values.js';
import { parseTagsInput, setHeadingTags, setPriority } from '../src/heading-edit.js';
import { getGlobalProperties, getPriorityRange, getRefileTargets } from '../src/local-variables.js';
import { parseOrgDuration } from '../src/org-duration.js';
import { getRefileCandidates, parseRefileTargetsWithErrors } from '../src/refile.js';
import { readDate, readDateSettings } from '../src/read-date.js';
import { rescheduleTimestamp, setPlanningField } from '../src/reschedule.js';
import { compactTimeOfDay, formatStamp, timeStringToTime } from '../src/timestamp-edit.js';
import { S } from './app-state.js';
import { readDatePrompt } from './date-prompt-flow.js';
import { commitAndRender, setStatus } from './editing.js';
import { readMinibuffer } from './emacs-minibuffer.js';
import { timerSetTimer } from './timer-flow.js';
import { askSortEntries } from './outline-edit-flow.js';
import { onItemLine } from '../src/emacs-org.js';
import { headingAtCaretInText } from './text-org-commands.js';

/** The properties Emacs offers for `org-set-property` (`org-default-properties`) before the ones in use. */
export const DEFAULT_PROPERTIES = ['ARCHIVE', 'CATEGORY', 'SUMMARY', 'DESCRIPTION', 'CUSTOM_ID', 'LOCATION', 'LOGGING', 'COLUMNS', 'VISIBILITY', 'DIARY', 'CLOCK_MODELINE_TOTAL', 'LOG_INTO_DRAWER', 'EFFORT', 'COOKIE_DATA', 'Effort_ALL'].sort();

/** @typedef {{ host: HTMLElement, say: (text: string) => void, adopt: () => void }} Ask */

/** Every name in `heading`'s drawer plus the defaults, as Emacs's property completion has them. @param {import('../src/types.js').Heading} heading */
function propertyNames(heading) {
  const own = Object.keys(heading.properties ?? {});
  return [...new Set([...own, ...DEFAULT_PROPERTIES])].sort();
}

/** @param {import('../src/types.js').Heading} heading @param {string} name @returns {string[]} the `<name>_ALL` values Emacs completes from */
function allowedValues(heading, name) {
  const all = getProperty(heading, `${name}_ALL`);
  return all ? (all.match(/"[^"]*"|\S+/g) ?? []).map((w) => w.replace(/^"|"$/g, '')) : [];
}

/** `org-set-property` (C-c C-x p). @param {Ask} a @param {import('../src/types.js').Heading} heading */
async function setPropertyAsk(a, heading) {
  const current = Object.keys(heading.properties ?? {})[0];
  const name = await readMinibuffer({ host: a.host, prompt: current ? `Property [${current}]: ` : 'Property: ', candidates: propertyNames(heading), message: a.say });
  if (name === null) return;
  const key = name === '' && current ? current : name;
  if (!/^\S+$/.test(key) || key.includes(':')) {
    setStatus(`Invalid property name: "${key}"`);
    return;
  }
  const old = getProperty(heading, key);
  const value = await readMinibuffer({ host: a.host, prompt: `${key} value${old ? ` [${old}]` : ''}: `, candidates: allowedValues(heading, key), initial: old ? '' : undefined, message: a.say });
  if (value === null) return;
  setProperty(heading, key, value === '' && old ? old : value);
  commitAndRender(`Property ${key} set`);
}

/** `org-set-effort` (C-c C-x e). @param {Ask} a @param {import('../src/types.js').Heading} heading */
async function setEffortAsk(a, heading) {
  /** @type {string[]} */ let choices;
  try {
    choices = getAllowedEffortValues({ doc: S.state.doc, heading, globalProperties: getGlobalProperties(S.state.localVariables) });
  } catch (e) {
    setStatus(String(/** @type {Error} */ (e).message));
    return;
  }
  const value = await readMinibuffer({ host: a.host, prompt: 'Effort: ', candidates: choices, message: a.say });
  if (value === null) return;
  if (value.trim() !== '' && parseOrgDuration(value.trim()) === null) {
    setStatus(`Invalid duration format: "${value}"`);
    return;
  }
  setProperty(heading, 'EFFORT', value.trim());
  commitAndRender(value.trim() === '' ? 'Effort cleared' : `Effort set to ${value.trim()}`);
}

/** `org-set-tags-command` (C-c C-q): the tags are one `:a:b:` string, as Emacs puts it in the minibuffer. @param {Ask} a @param {import('../src/types.js').Heading} heading */
async function setTagsAsk(a, heading) {
  /** @type {string[]} */
  const used = [];
  /** @param {import('../src/types.js').Heading[]} list */
  const walk = (list) => list.forEach((h) => (used.push(...(h.tags ?? [])), walk(h.children ?? [])));
  walk(S.state.doc?.headings ?? []);
  const tags = heading.tags ?? [];
  const typed = await readMinibuffer({ host: a.host, prompt: 'Tags: ', candidates: [...new Set(used)], initial: tags.length ? `:${tags.join(':')}:` : '', message: a.say });
  if (typed === null) return;
  setHeadingTags(heading, parseTagsInput(typed.replace(/,/g, ' ')));
  commitAndRender('Tags set');
}

/** `org-priority` (C-c ,): the key read is a letter in the range, SPC to remove, and Emacs's errors for the rest. @param {Ask} a @param {import('../src/types.js').Heading} heading */
async function setPriorityAsk(a, heading) {
  const range = getPriorityRange(S.state.localVariables);
  const hi = String.fromCharCode(Math.min(range.highest ?? 65, 90));
  const lo = String.fromCharCode(Math.min(range.lowest ?? 67, 90));
  const key = await readMinibuffer({ host: a.host, prompt: `Priority ${hi}-${lo}, SPC to remove: `, candidates: [], message: a.say });
  if (key === null) return;
  const c = key.slice(0, 1);
  if (c === ' ') {
    if (!heading.priority) {
      setStatus('No priority cookie found in line');
      return;
    }
    setPriority(heading, null);
    commitAndRender('Priority removed');
    return;
  }
  const up = c.toUpperCase();
  if (!/^[A-Z]$/.test(up) || up < hi || up > lo) {
    setStatus(`Priority must be between \`${hi}' and \`${lo}'`);
    return;
  }
  setPriority(heading, up);
  commitAndRender(`Priority set to ${up}`);
}

/** `org-refile` (C-c C-w): `Refile subtree "<title>" to: ` over the outline paths. @param {Ask} a @param {import('../src/types.js').Heading} heading */
async function refileAsk(a, heading) {
  const { entries } = parseRefileTargetsWithErrors(getRefileTargets(S.state.localVariables));
  const { loadRefileTargetDocs, performRefile } = await import('./refile-flow.js');
  const docs = await loadRefileTargetDocs(entries);
  const candidates = getRefileCandidates(entries, docs, S.state.documentId, S.agendaFilesConfig, heading);
  const byName = new Map(candidates.map((c) => [c.outlinePath.join('/'), c]));
  const chosen = await readMinibuffer({ host: a.host, prompt: `Refile subtree "${heading.title}" to: `, candidates: [...byName.keys()], requireMatch: true, message: a.say });
  if (chosen === null) return;
  const target = byName.get(chosen);
  if (!target) {
    setStatus(`No such refile target: ${chosen}`);
    return;
  }
  await performRefile(heading, target.documentId, target.outlinePath, '', false);
}

/** `org-timer-set-timer` (C-c C-x ;): the effort of the heading at the caret when it has one, else the question. @param {Ask} a @param {import('../src/types.js').Heading} heading */
async function timerAsk(a, heading) {
  S.keyboardFocusedHeading = heading;
  await timerSetTimer({ ask: (message, initial) => readMinibuffer({ host: a.host, prompt: message, candidates: [], initial, message: a.say }) });
}

/** `org-sort` (C-c ^): on a heading the children are sorted, before the first heading the top-level entries; the key is asked in the echo area.
 *  A list item or table row at the caret would be sorted by Emacs as a list or table, which the Text view does not do yet. @param {Ask} _a @param {import('../src/types.js').Heading | null} heading */
async function sortAsk(_a, heading) {
  const ta = /** @type {HTMLTextAreaElement | null} */ (document.getElementById('document-text-edit-input'));
  if (ta) {
    const lineStart = ta.value.lastIndexOf('\n', ta.selectionStart - 1) + 1;
    const line = ta.value.slice(lineStart, ta.value.indexOf('\n', lineStart) < 0 ? undefined : ta.value.indexOf('\n', lineStart));
    if (onItemLine(ta.value, ta.selectionStart) || /^\s*\|/.test(line)) {
      setStatus('Sorting a list or table at the caret is not available in the Text view yet: use the outline');
      return;
    }
  }
  S.keyboardFocusedHeading = heading; // before the first heading there is none: the top-level entries, not the outline's focused heading
  askSortEntries(heading);
}

/** `org-schedule` (C-c C-s) and `org-deadline` (C-c C-d): `SCHEDULED Date+time [2026-11-24]: ` with the calendar beside it. The date and time are read as the prompt reads them and
 *  put in the planning line, the repeater and warning of the stamp it replaces kept. @param {Ask} _a @param {import('../src/types.js').Heading} heading @param {'scheduled' | 'deadline'} field */
async function planningAsk(_a, heading, field) {
  const old = heading.planning?.[field] ?? null;
  const defaultTime = old ? timeStringToTime(old) : null;
  const typed = await readDatePrompt({ prefix: field === 'deadline' ? 'DEADLINE' : 'SCHEDULED', defaultTime, initial: old ? (compactTimeOfDay(old) ?? '') : '' });
  if (typed === null) return;
  const r = readDate(typed, { now: new Date(), defaultTime, ...readDateSettings({ ...S.globalVariables, ...S.state.localVariables }), endBound: true });
  const end = r.endTimeGiven ? /([0-9]+):([0-9]+)/.exec(r.endTimeGiven) : null;
  const stamp = formatStamp(r.date, r.timeGiven, false, end ? `-${String(Number(end[1])).padStart(2, '0')}:${String(Number(end[2])).padStart(2, '0')}` : null);
  setPlanningField(heading, field, rescheduleTimestamp(old, stamp));
  commitAndRender(`${field === 'deadline' ? 'Deadline' : 'Scheduled'}: ${stamp}`);
}

const ASKS = {
  'org-schedule': (/** @type {Ask} */ a, /** @type {import('../src/types.js').Heading} */ h) => planningAsk(a, h, 'scheduled'),
  'org-deadline': (/** @type {Ask} */ a, /** @type {import('../src/types.js').Heading} */ h) => planningAsk(a, h, 'deadline'),
  'org-sort': sortAsk,
  'org-timer-set-timer': timerAsk,
  'org-set-property': setPropertyAsk,
  'org-set-effort': setEffortAsk,
  'org-set-tags-command': setTagsAsk,
  'org-priority': setPriorityAsk,
  'org-refile': refileAsk,
};

/** @param {string} name @returns {boolean} whether the command asks its question in the minibuffer */
export function asksInMinibuffer(name) {
  return Object.prototype.hasOwnProperty.call(ASKS, name);
}

/** Runs the command `name` with its question in the minibuffer; `false` when the caret is in no heading. @param {string} name @param {Ask} a */
export async function runAsking(name, a) {
  a.adopt();
  const heading = headingAtCaretInText({ allowNone: name === 'org-sort' });
  if (!heading && name !== 'org-sort') return false;
  await ASKS[/** @type {keyof typeof ASKS} */ (name)](a, /** @type {import('../src/types.js').Heading} */ (heading));
  return true;
}
