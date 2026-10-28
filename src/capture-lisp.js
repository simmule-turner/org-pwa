// @ts-check
/**
 * Capture templates written the way Emacs takes them, in the Lisp init text:
 *   (setq org-capture-templates
 *     '(("t" "Todo" entry (file+headline "notes.org" "Tasks") "* TODO %?" :prepend t)))
 * and (add-to-list 'org-capture-templates '(...)). Each entry becomes the template object the JSON form uses.
 * What cannot be carried over is reported, not guessed at.
 */
import { isNil, listItems, stringValue, symbolName } from './lisp-read.js';
import { runInit } from './lisp-init.js';

/** @typedef {import('./lisp-read.js').Lisp} Lisp */
/** @typedef {import('./types.js').CaptureTemplate} CaptureTemplate */

const TYPES = new Set(['entry', 'item', 'checkitem', 'table-line', 'plain']);
/** Keywords that only change how Emacs shows the capture buffer; nothing to do here. */
const QUIET = new Set([':immediate-finish', ':unnarrowed', ':kill-buffer', ':jump-to-captured', ':no-save', ':hook', ':before-finalize', ':after-finalize', ':prepare-finalize']);
/** Keywords that have no effect here. */
const UNSUPPORTED = new Set([':clock-in', ':clock-keep', ':clock-resume', ':tree-type', ':refile-targets', ':time-prompt', ':ignore-this-entry', ':template-file']);
/** Emacs keywords that take a count of blank lines or a position, with the field they set. */
const EMACS_OPTIONS = /** @type {Record<string, [string, 'count' | 'string']>} */ ({
  ':empty-lines': ['emptyLines', 'count'],
  ':empty-lines-before': ['emptyLinesBefore', 'count'],
  ':empty-lines-after': ['emptyLinesAfter', 'count'],
  ':table-line-pos': ['tableLinePos', 'string'],
});
/** App options with no Emacs name, written as keywords after the template. */
const APP_OPTIONS = /** @type {Record<string, [string, 'boolean' | 'string']>} */ ({
  ':omit-empty-entries': ['omitEmptyEntries', 'boolean'],
  ':prepend-heading': ['prependHeading', 'boolean'],
  ':table-header': ['tableHeader', 'boolean'],
  ':pre-text': ['preText', 'string'],
  ':post-text': ['postText', 'string'],
});

/**
 * Where a template files: `{ file, olp }`, or a reason it cannot be read.
 * @param {Lisp | undefined} target
 * @returns {{ file: string, olp: string[] } | string}
 */
function readTarget(target) {
  const items = listItems(target);
  const head = items && symbolName(items[0]);
  if (!items || !head) return 'the target is not a list such as (file+olp "f.org" "Heading")';
  const file = stringValue(items[1]) ?? '';
  if (head === 'file') return { file, olp: [] };
  if (head === 'file+headline') {
    const heading = stringValue(items[2]);
    return heading === null ? 'file+headline needs a heading as a string' : { file, olp: [heading] };
  }
  if (head === 'file+olp') {
    const path = items.slice(2).map(stringValue);
    return path.length && path.every((s) => s !== null) ? { file, olp: /** @type {string[]} */ (path) } : 'file+olp needs headings as strings';
  }
  return `the target ${head} is not supported (use file, file+headline or file+olp)`;
}

/**
 * Reads one `("key" "description" type target template props...)` entry.
 * @param {Lisp} entry
 * @param {string[]} notes
 * @returns {CaptureTemplate | null}
 */
function readEntry(entry, notes) {
  const items = listItems(entry);
  const key = items && stringValue(items[0]);
  if (!items || key === null || key === undefined) return null;
  if (items.length <= 2) return null; // a group heading such as ("w" "Work"), which has no template of its own
  const say = (/** @type {string} */ why) => notes.push(`Capture template "${key}" is left out: ${why}.`);
  const description = stringValue(items[1]) ?? '';
  const type = symbolName(items[2]);
  if (!type || !TYPES.has(type)) return say(`the type ${type ?? 'given'} is not supported (use entry, item, checkitem, table-line or plain)`), null;
  const target = readTarget(items[3]);
  if (typeof target === 'string') return say(target), null;
  const text = stringValue(items[4]);
  if (text === null) return say('the template must be a string'), null;
  if (target.olp.length === 0 && type !== 'entry' && type !== 'plain') return say(`a ${type} needs a heading to go under (use file+headline or file+olp)`), null;

  /** @type {CaptureTemplate} */
  const out = { key, description, type, olp: target.olp, template: text };
  if (target.file) out.file = target.file;
  const props = items.slice(5);
  for (let i = 0; i < props.length; i += 2) {
    const name = symbolName(props[i]);
    const value = props[i + 1];
    if (!name || !name.startsWith(':')) continue;
    if (name === ':prepend') out.prepend = !isNil(value);
    else if (APP_OPTIONS[name]) {
      const [field, kind] = APP_OPTIONS[name];
      out[field] = kind === 'string' ? (stringValue(value) ?? '') : !isNil(value);
    } else if (EMACS_OPTIONS[name]) {
      const [field, kind] = EMACS_OPTIONS[name];
      if (kind === 'count') {
        if (value && value.k === 'num' && Number.isInteger(value.v) && value.v >= 0) out[field] = value.v;
        else notes.push(`Capture template "${key}": ${name} needs a whole number and is ignored.`);
      } else if (stringValue(value) !== null) out[field] = stringValue(value);
      else notes.push(`Capture template "${key}": ${name} needs a string and is ignored.`);
    } else if (UNSUPPORTED.has(name)) notes.push(`Capture template "${key}": ${name} has no effect here.`);
    else if (!QUIET.has(name)) notes.push(`Capture template "${key}": ${name} is not known and has no effect.`);
  }
  return out;
}

/**
 * The templates `org-capture-templates` holds after the init text has run, with the reasons for any left out or changed.
 * @param {string} initText
 * @returns {{ templates: CaptureTemplate[], notes: string[] }}
 */
export function captureTemplatesFromLisp(initText) {
  /** @type {string[]} */ const notes = [];
  const value = runInit(initText).get('org-capture-templates');
  const entries = listItems(value) || [];
  /** @type {CaptureTemplate[]} */ const templates = [];
  for (const entry of entries) {
    const t = readEntry(entry, notes);
    if (t) templates.push(t);
  }
  return { templates, notes };
}

/**
 * The JSON templates with the Lisp ones added; a Lisp template replaces a JSON one with the same key.
 * @param {CaptureTemplate[]} json
 * @param {CaptureTemplate[]} lisp
 */
export function mergeCaptureTemplates(json, lisp) {
  const keys = new Set(lisp.map((t) => t.key));
  return [...json.filter((t) => !keys.has(t.key)), ...lisp];
}
