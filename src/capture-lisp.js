// @ts-check
/**
 * Capture templates written the way Emacs takes them, in the Lisp init text:
 *   (setq org-capture-templates
 *     '(("t" "Todo" entry (file+headline "notes.org" "Tasks") "* TODO %?" :prepend t)))
 * and (add-to-list 'org-capture-templates '(...)). Each entry becomes the template object the JSON form uses.
 * What cannot be carried over is reported, not guessed at.
 */
import { isNil, listItems, stringValue, symbolName } from './lisp-read.js';
import { runInit, toObject } from './lisp-init.js';
import { print } from './elisp-data.js';

/** @typedef {import('./lisp-read.js').Lisp} Lisp */
/** @typedef {import('./types.js').CaptureTemplate} CaptureTemplate */

const TYPES = new Set(['entry', 'item', 'checkitem', 'table-line', 'plain']);
/** Keywords that only change how Emacs shows the capture buffer; nothing to do here. */
const QUIET = new Set([':unnarrowed', ':kill-buffer', ':no-save', ':hook']);
/** Keywords that have no effect here. */
const UNSUPPORTED = new Set([':after-finalize', ':refile-targets']);
/** Emacs keywords that are on or off, with the field they set. */
const FLAGS = /** @type {Record<string, string>} */ ({ ':immediate-finish': 'immediateFinish', ':time-prompt': 'timePrompt', ':clock-in': 'clockIn', ':clock-keep': 'clockKeep', ':clock-resume': 'clockResume' });
/** Emacs keywords that take a count of blank lines or a position, with the field they set. */
const EMACS_OPTIONS = /** @type {Record<string, [string, 'count' | 'string']>} */ ({
  ':empty-lines': ['emptyLines', 'count'],
  ':empty-lines-before': ['emptyLinesBefore', 'count'],
  ':empty-lines-after': ['emptyLinesAfter', 'count'],
  ':table-line-pos': ['tableLinePos', 'string'],
});
/**
 * A function the way a template names it, as text the capture can run again: a symbol's name, or the `(lambda ...)` form as written.
 * @param {Lisp | undefined} f
 * @returns {string | null}
 */
function functionText(f) {
  if (!f) return null;
  if (f.k === 'sym') return isNil(f) ? null : f.v;
  const items = listItems(f);
  const head = items && symbolName(items[0]);
  if (head === 'lambda') return print(toObject(f));
  if (head === 'function' && items && items.length === 2) return functionText(items[1]);
  return null;
}

/**
 * The functions of a keyword such as :prepare-finalize: one function or a list of them, as text; null when something in it is not a function.
 * @param {Lisp | undefined} f
 * @returns {string[] | null}
 */
function functionTexts(f) {
  if (!f || isNil(f)) return [];
  const single = functionText(f);
  if (single !== null) return [single];
  const items = f.k === 'list' ? f.items : null;
  if (!items || (items.length && symbolName(items[0]) === 'lambda')) return null;
  const all = items.map(functionText);
  return all.every((x) => x !== null) ? /** @type {string[]} */ (all) : null;
}

/**
 * Where a template files: `{ file, olp }` (with `datetree` for file+olp+datetree, `fn` for a function that finds the place), or a reason it cannot be read.
 * @param {Lisp | undefined} target
 * @returns {{ file: string, olp: string[], datetree?: boolean, treeType?: string, fn?: string } | string}
 */
function readTarget(target) {
  const items = listItems(target);
  const head = items && symbolName(items[0]);
  if (!items || !head) return 'the target is not a list such as (file+olp "f.org" "Heading")';
  const file = stringValue(items[1]) ?? '';
  if (head === 'file') return { file, olp: [] };
  if (head === 'file+function') {
    const fn = items.length === 3 ? functionText(items[2]) : null;
    return fn === null ? 'file+function needs a function (a name or a lambda form)' : { file, olp: [], fn };
  }
  if (head === 'function') {
    const fn = items.length === 2 ? functionText(items[1]) : null;
    return fn === null ? 'function needs a function (a name or a lambda form)' : { file: '', olp: [], fn: fn };
  }
  if (head === 'file+headline') {
    const heading = stringValue(items[2]);
    return heading === null ? 'file+headline needs a heading as a string' : { file, olp: [heading] };
  }
  if (head === 'file+olp') {
    const path = items.slice(2).map(stringValue);
    return path.length && path.every((s) => s !== null) ? { file, olp: /** @type {string[]} */ (path) } : 'file+olp needs headings as strings';
  }
  if (head === 'file+olp+datetree' || head === 'file+datetree' || head === 'file+weektree') {
    // the last two are Org's older names, which it changes into the first (with :tree-type week for a week tree)
    const path = items.slice(2).map(stringValue);
    if (!path.every((s) => s !== null)) return `${head} needs headings as strings`;
    return { file, olp: /** @type {string[]} */ (path), datetree: true, ...(head === 'file+weektree' ? { treeType: 'week' } : {}) };
  }
  return `the target ${head} is not supported (use file, file+headline, file+olp, file+olp+datetree or file+function)`;
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
  if (target.olp.length === 0 && !target.datetree && !target.fn && type !== 'entry' && type !== 'plain') return say(`a ${type} needs a heading to go under (use file+headline or file+olp)`), null;

  /** @type {CaptureTemplate} */
  const out = { key, description, type, olp: target.olp, template: text };
  if (target.file) out.file = target.file;
  if (target.datetree) out.datetree = true;
  if (target.treeType) out.treeType = target.treeType;
  if (target.fn) out.targetFunction = target.fn;
  const props = items.slice(5);
  for (let i = 0; i < props.length; i += 2) {
    const name = symbolName(props[i]);
    const value = props[i + 1];
    if (!name || !name.startsWith(':')) continue;
    if (name === ':prepend') out.prepend = !isNil(value);
    else if (name === ':jump-to-captured') out.jumpToCaptured = !isNil(value);
    else if (name === ':time-prompt' && !target.datetree) notes.push(`Capture template "${key}": :time-prompt has no effect without a file+olp+datetree target, as in Emacs.`);
    else if (FLAGS[name]) out[FLAGS[name]] = !isNil(value);
    else if (name === ':prepare-finalize' || name === ':before-finalize') {
      const fns = functionTexts(value);
      const field = name === ':prepare-finalize' ? 'prepareFinalize' : 'beforeFinalize';
      if (fns === null) notes.push(`Capture template "${key}": ${name} needs a function or a list of functions and is ignored.`);
      else if (fns.length) out[field] = fns;
    }
    else if (name === ':tree-type') {
      const kind = symbolName(value);
      if (!target.datetree) notes.push(`Capture template "${key}": :tree-type has no effect without a file+olp+datetree target.`);
      else if (kind === 'week' || kind === 'month') out.treeType = target.treeType || kind;
      else if (!kind) notes.push(`Capture template "${key}": :tree-type as a list or a function is an Org 9.8 feature and is not supported; the day tree is used.`);
    }
    else if (EMACS_OPTIONS[name]) {
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
  const init = runInit(initText);
  // a form that sets the templates and fails leaves none of them: say why
  for (const { message, form } of init.failed) if (/org-capture-templates/.test(form)) notes.push(`The Lisp init could not set the capture templates: ${message}`);
  const value = init.get('org-capture-templates');
  const entries = listItems(value) || [];
  /** @type {CaptureTemplate[]} */ const templates = [];
  for (const entry of entries) {
    const t = readEntry(entry, notes);
    if (t) templates.push(t);
  }
  return { templates, notes };
}
