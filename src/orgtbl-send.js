// @ts-check
/**
 * `orgtbl-send-table` (`#+ORGTBL: SEND name function params` above a table, `BEGIN RECEIVE ORGTBL name` ... `END RECEIVE ORGTBL name`
 * where the converted table goes) and `org-table-export`, after org-table.el. Both call the converters of src/export-convert.js through the
 * Lisp interpreter, so a function of the person's own (a `defun` of the Lisp init file) works as the transformation.
 */
import { print } from './elisp-data.js';
import { run } from './elisp.js';
import { intern } from './elisp-data.js';
import { tableTextToLisp } from './export-convert-table.js';
import './export-convert.js';
import { commitLines } from './body-edit.js';
import { serializeOrg } from './org-parser.js';
import { inheritedProperty } from './babel-args.js';
import { ancestorsOf } from './org-lisp.js';

/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {import('./types.js').Doc} Doc */
/** @typedef {import('./types.js').Table} Table */

const SEND_RE = /^[ \t]*#\+ORGTBL[: \t][ \t]*SEND[ \t]+([^ \t\r\n]+)[ \t]+([^ \t\r\n]+)([ \t]+.*)?/i;

/** `orgtbl-gather-send-defs`: the SEND lines directly above the table, from the topmost. Before the first heading the parser keeps `#+KEY:` lines apart
 * from `bodyLines` (`keywords`, each placed before the body line `bodyLineIndex`), so those are read from there.
 * @param {Doc | Heading} owner @param {number} tableLine @returns {{ name: string, transform: string, params: string }[]} */
export function gatherSendDefs(owner, tableLine) {
  /** @type {{ name: string, transform: string, params: string }[]} */
  const out = [];
  const lines = owner.bodyLines;
  if (owner.type !== 'heading') {
    const above = (/** @type {Doc} */ (owner).keywords || []).filter((/** @type {import('./types.js').Keyword} */ k) => !k.virtual && k.bodyLineIndex === tableLine);
    for (const k of above) {
      const m = SEND_RE.exec(`#+${k.key}: ${k.value}`);
      if (m) out.push({ name: m[1], transform: m[2], params: m[3] ? m[3] : '' });
      else out.length = 0;
    }
    return out;
  }
  for (let i = tableLine - 1; i >= 0; i--) {
    const m = SEND_RE.exec(lines[i]);
    if (!m) break;
    out.unshift({ name: m[1], transform: m[2], params: m[3] ? m[3] : '' });
  }
  return out;
}

/** Calls `transform` with the table and the parameters as Emacs's `(funcall transform table params)` does; the error is Emacs's message.
 * @param {string} transform @param {string} paramsText @param {string[]} tableLines @returns {string} */
function transformTable(transform, paramsText, tableLines) {
  if (intern(transform).fn === undefined || intern(transform).fn === null) throw new Error(`No such transformation function ${transform}`);
  const table = tableTextToLisp(tableLines.join('\n'));
  const result = run(`(funcall (quote ${transform}) (quote ${print(table)}) (quote (${paramsText})))`);
  if (!result.ok) throw new Error(result.error);
  if (typeof result.value !== 'string') throw new Error('Wrong type argument: stringp, ' + print(result.value));
  return result.value;
}

/** The bodies of the document, in order: the text before the first heading, then every heading's. @param {Doc} doc @returns {(Doc | Heading)[]} */
function bodies(doc) {
  /** @type {(Doc | Heading)[]} */
  const out = [doc];
  /** @param {Heading[]} nodes */
  const walk = (nodes) => {
    for (const h of nodes) {
      if (h.type !== 'heading') continue;
      out.push(h);
      walk(h.children || []);
    }
  };
  walk(doc.children || []);
  return out;
}

/** The buffer position (1-based, in characters) of the line after the SEENth `BEGIN RECEIVE` line of the document: what Emacs names in its error. @param {Doc} doc @param {RegExp} begin @param {number} seen */
function receiverPosition(doc, begin, seen) {
  let at = 1;
  let n = 0;
  for (const line of serializeOrg(doc).split('\n')) {
    at += [...line].length + 1;
    if (begin.test(line) && ++n === seen) return at;
  }
  return at;
}

/** `orgtbl-send-replace-tbl`: the text between every `BEGIN RECEIVE ORGTBL name` and its `END RECEIVE ORGTBL name` line becomes `text`.
 * @param {Doc} doc @param {string} name @param {string} text */
function replaceReceivers(doc, name, text) {
  const quoted = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const begin = new RegExp(`BEGIN +RECEIVE +ORGTBL +${quoted}([ \\t]|$)`);
  const end = new RegExp(`END +RECEIVE +ORGTBL +${quoted}([ \\t]|$)`);
  let found = false;
  let seen = 0; // the BEGIN lines passed so far, in document order
  for (const body of bodies(doc)) {
    for (let i = 0; i < body.bodyLines.length; i++) {
      if (!begin.test(body.bodyLines[i])) continue;
      found = true;
      seen++;
      let j = i + 1;
      while (j < body.bodyLines.length && !end.test(body.bodyLines[j])) j++;
      if (j >= body.bodyLines.length) throw new Error(`Cannot find end of receiver location at ${receiverPosition(doc, begin, seen)}`);
      commitLines(/** @type {Heading} */ (body), i + 1, j - i - 1, text.split('\n'));
      i = i + 1 + text.split('\n').length;
    }
  }
  if (!found) throw new Error('No valid receiver location found in the buffer');
}

/**
 * `orgtbl-send-table`: every `#+ORGTBL: SEND` line above the table converts it and puts the result where the receiver is. Returns the
 * number of receivers installed (0 when `maybe` and the table has no SEND line).
 * @param {Doc} doc @param {Heading | Doc} owner  the heading (or the document) whose body holds the table @param {Table} table @param {boolean} [maybe]
 */
export function sendTable(doc, owner, table, maybe = false) {
  const dests = gatherSendDefs(owner, table.lineIndex);
  if (!dests.length) {
    if (maybe) return 0;
    throw new Error("Don't know how to transform this table");
  }
  const tableLines = owner.bodyLines.slice(table.lineIndex, table.lineIndex + table.lineCount).filter((l) => /^[ \t]*\|/.test(l));
  for (const d of dests) replaceReceivers(doc, d.name, transformTable(d.transform, d.params, tableLines));
  return dests.length;
}

/** The formats `org-table-export` offers, in Emacs's order. */
export const TABLE_EXPORT_FORMATS = ['orgtbl-to-tsv', 'orgtbl-to-csv', 'orgtbl-to-latex', 'orgtbl-to-html', 'orgtbl-to-generic', 'orgtbl-to-texinfo', 'orgtbl-to-orgtbl', 'orgtbl-to-unicode'];

/**
 * `org-table-export`: the table converted by the format of the TABLE_EXPORT_FORMAT property (else the one named for the file's extension,
 * else `org-table-export-default-format`), for the file of the TABLE_EXPORT_FILE property (else `table` with the format's extension).
 * @param {Doc} doc @param {Heading | Doc} owner @param {Table} table @param {{ file?: string, format?: string, defaultFormat?: string }} [given]
 * @returns {{ fileName: string, text: string }}
 */
export function exportTable(doc, owner, table, given = {}) {
  const ancestors = owner === doc ? [] : [...ancestorsOf(doc, /** @type {Heading} */ (owner)), /** @type {Heading} */ (owner)];
  const property = (/** @type {string} */ n) => inheritedProperty(doc, ancestors, n);
  const file = given.file ?? property('TABLE_EXPORT_FILE') ?? undefined;
  const ext = (file ? /\.([^./]+)$/.exec(file)?.[1] : undefined) ?? '';
  let format = given.format ?? property('TABLE_EXPORT_FORMAT') ?? undefined;
  if (!format) format = (ext && TABLE_EXPORT_FORMATS.find((f) => new RegExp(ext + '$').test(f))) || given.defaultFormat || 'orgtbl-to-tsv';
  const m = /([^ \t\r\n]+)( +.*)?/.exec(format);
  if (!m) throw new Error('TABLE_EXPORT_FORMAT invalid');
  const tableLines = owner.bodyLines.slice(table.lineIndex, table.lineIndex + table.lineCount).filter((l) => /^[ \t]*\|/.test(l));
  const text = transformTable(m[1], m[2] ?? '', tableLines);
  const suffix = { 'orgtbl-to-tsv': 'tsv', 'orgtbl-to-csv': 'csv', 'orgtbl-to-latex': 'tex', 'orgtbl-to-html': 'html', 'orgtbl-to-orgtbl': 'org' }[m[1]] ?? 'txt';
  return { fileName: file ?? `table.${suffix}`, text: text + '\n' };
}
