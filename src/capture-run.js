// @ts-check
/**
 * Filing a capture template into a document, the way the Capture panel does it: find the target, expand the template, let the
 * template's Lisp functions have their say, and file the text. The Lisp parts are those a template written in Lisp can name:
 * a target function (`(file+function "f.org" FN)`, which finds the place) and `:prepare-finalize` (which edits the text on its way in).
 */
import { Reader } from './elisp-read.js';
import { defun, evalPlain, funcallPlain, state } from './elisp-core.js';
import { Cons, NIL, Sym, intern } from './elisp-data.js';
import { describeFailure } from './elisp.js';
import { enterBuffer, openBuffer, textBefore } from './elisp-buffer.js';
import { withDefaultTime } from './elisp-time.js';
import { withContext } from './diary-lisp.js';
import { expandCaptureText, fileCapture, filePlainText, holdsHeading, plannedTableRow, resolveOlpTarget } from './capture-template.js';
import { findHeadingAtLine, headingLineIndex, parseOrg, serializeOrg } from './org-parser.js';
import { parseBody } from './body-parser.js';

/** @typedef {import('./types.js').Doc} Doc */
/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {import('./types.js').CaptureTemplate} CaptureTemplate */
/** @typedef {import('./elisp-data.js').LObj} LObj */

/** The function a template names: a symbol's name, or a `(lambda ...)` form, as the Lisp init text gave it. @param {string} source @returns {LObj} */
function functionOf(source) {
  if (/^[^\s()'"]+$/.test(source)) return intern(source);
  let form = new Reader(source).read();
  if (form instanceof Cons && form.car instanceof Sym && form.car.name === 'function' && form.cdr instanceof Cons) form = form.cdr.car;
  return form instanceof Sym ? form : evalPlain(form, null);
}

/**
 * Runs the functions named by `sources`, one after another with no arguments, in a buffer that holds `text` with point at its start.
 * @param {string} text @param {string[]} sources @param {Date} [now] the moment `format-time-string` formats when it is given no time
 * @param {string[]} [plist] the template's `org-capture-plist`, as name and Lisp text in turn, for `org-capture-get`
 * @returns {{ ok: true, text: string, line: number, atLineStart: boolean } | { ok: false, message: string }}  `line` is the 0-based line point ends on
 */
export function runInBuffer(text, sources, now, plist) {
  try {
    return withContext({}, () => withDefaultTime(now ?? new Date(), () => {
      if (plist) setCapturePlist(plist);
      const b = openBuffer(text);
      enterBuffer(b);
      for (const source of sources) funcallPlain(functionOf(source), []);
      const buffer = /** @type {import('./elisp-data.js').Buffer} */ (state.buffer);
      const before = textBefore(buffer, buffer.pt);
      return { ok: /** @type {const} */ (true), text: buffer.text, line: before.split('\n').length - 1, atLineStart: before === '' || before.endsWith('\n') };
    }));
  } catch (raw) {
    return { ok: false, message: describeFailure(raw).message };
  }
}

/** `org-capture-get` and `org-capture-put`, as Emacs's org-capture.el defines them over `org-capture-plist`. */
defun('org-capture-get', 1, 2, ([prop]) => funcallPlain(intern('plist-get'), [intern('org-capture-plist').value ?? NIL, prop]));
defun('org-capture-put', 0, -1, (stuff) => {
  const plist = intern('org-capture-plist');
  for (let i = 0; i < stuff.length; i += 2) plist.value = funcallPlain(intern('plist-put'), [plist.value ?? NIL, stuff[i], stuff[i + 1] ?? NIL]);
  return plist.value ?? NIL;
});

/** Makes `org-capture-plist` hold the template's properties for the function about to run. @param {string[]} plist name and Lisp text in turn */
function setCapturePlist(plist) {
  const pairs = [];
  for (let i = 0; i + 1 < plist.length; i += 2) pairs.push(`${plist[i]} ${plist[i + 1]}`);
  const sym = intern('org-capture-plist');
  sym.special = true;
  sym.value = evalPlain(new Reader(`'(${pairs.join(' ')})`).read(), null);
}

/** The document taken over by another parse of it, for when a function's insertions are not a simple splice. @param {Doc} doc @param {string} text */
function replaceContents(doc, text) {
  Object.assign(doc, parseOrg(text));
}

/** The last heading in the order of the file, or the file itself. @param {Doc | Heading} node @returns {Doc | Heading} */
function lastNode(node) {
  return node.children.length ? lastNode(node.children[node.children.length - 1]) : node;
}

/**
 * Puts the whole lines `lines` into `doc` before its line `at` (0-based), so that it serializes as `after`. Headings that stay are
 * the same objects; where the splice would not give `after` the document is parsed again from it.
 * @param {Doc} doc @param {number} at @param {string[]} lines @param {string} after
 */
function insertLines(doc, at, lines, after) {
  const fragment = parseOrg(lines.join('\n'));
  const { lines: where, total } = headingLineIndex(doc);
  const nodes = [...where.entries()];
  const atHeading = nodes.find(([, w]) => w.line === at);
  const plain = fragment.keywords.length === 0;
  const onlyHeadings = plain && fragment.bodyLines.length === 0 && fragment.children.length > 0;
  const last = lastNode(doc);
  const lastLines = last.bodyLines || [];
  try {
    const level = onlyHeadings ? fragment.children[0].level : 0;
    const flat = onlyHeadings && fragment.children.every((h) => h.level === level);
    if (flat && atHeading && level === atHeading[0].level) {
      const siblings = parentChildren(doc, atHeading[0]);
      siblings.splice(siblings.indexOf(atHeading[0]), 0, ...fragment.children);
    } else if (flat && atHeading && level > atHeading[0].level) {
      // deeper than the heading it goes before: the last children of the nearest heading above that is shallower, where a parse puts them,
      // so that nothing else is rebuilt (and every other heading keeps its fold)
      const above = nodes.filter(([, w]) => w.line < at).map(([n]) => n);
      const parent = [...above].reverse().find((n) => n.level < level);
      (parent ? parent.children : doc.children).push(...fragment.children);
    } else if (onlyHeadings && at === total - 1 && lastLines[lastLines.length - 1] === '' && fragment.children.every((h) => h.level === 1)) {
      // only the empty line that ends the file follows: the headings go before it
      lastLines.pop();
      last.body = parseBody(lastLines);
      doc.children.push(...fragment.children);
      const end = lastNode(doc);
      end.bodyLines.push('');
      end.body = parseBody(end.bodyLines);
    } else if (plain && fragment.children.length === 0) {
      const [owner, w] = nodes.filter(([n, here]) => here.bodyStart <= at && at - here.bodyStart <= n.bodyLines.length).pop() ?? [null, null];
      if (owner && w) {
        owner.bodyLines.splice(at - w.bodyStart, 0, ...fragment.bodyLines);
        owner.body = parseBody(owner.bodyLines);
      }
    }
  } catch {
    // the check below sees what is left of it
  }
  if (serializeOrg(doc) !== after) replaceContents(doc, after);
}

/** The list a heading is in. @param {Doc} doc @param {Heading} heading @returns {Heading[]} */
function parentChildren(doc, heading) {
  /** @param {Doc | Heading} node @returns {Heading[] | null} */
  const find = (node) => {
    if (node.children.includes(heading)) return node.children;
    for (const child of node.children) {
      const hit = find(child);
      if (hit) return hit;
    }
    return null;
  };
  return find(doc) ?? doc.children;
}

/**
 * Runs a target function on the document, as `(file+function FILE FN)` does in Emacs: FN sees the text of the whole file with point
 * at its start, and the capture goes where point ends. Lines the function inserted are put into `doc`; a function that changes or
 * deletes a line is refused. Returns the heading point is on (null: not on a heading) and how the text is to be filed.
 * @param {Doc} doc @param {string} source @param {Date} [moment] what `format-time-string` formats when given no time
 * @param {string[]} [plist] the template's properties for `org-capture-get`
 * @returns {{ ok: true, apply: () => Heading | null, insertAtPoint: (lines: string[]) => void, onHeading: boolean, atLineStart: boolean, line: number, after: string } | { ok: false, message: string }}
 */
export function runTargetFunction(doc, source, moment, plist) {
  const before = serializeOrg(doc);
  const ran = runInBuffer(before, [source], moment, plist);
  if (!ran.ok) return ran;
  const was = before.split('\n');
  const now = ran.text.split('\n');
  let head = 0;
  while (head < was.length && head < now.length && was[head] === now[head]) head++;
  let tail = 0;
  while (tail < was.length - head && tail < now.length - head && was[was.length - 1 - tail] === now[now.length - 1 - tail]) tail++;
  if (was.length - head - tail !== 0) return { ok: false, message: 'The target function changed the file; only inserting is supported' };
  const inserted = now.slice(head, now.length - tail);
  const onHeading = /^\*+ /.test(now[ran.line] ?? '');
  return {
    ok: true,
    onHeading,
    atLineStart: ran.atLineStart,
    line: ran.line,
    after: ran.text,
    apply: () => {
      if (inserted.length) insertLines(doc, head, inserted, ran.text);
      return onHeading ? findHeadingAtLine(doc, ran.line) : null;
    },
    insertAtPoint: (put) => insertLines(doc, ran.line, put, [...now.slice(0, ran.line), ...put, ...now.slice(ran.line)].join('\n')),
  };
}

/** The part of `host`'s text that holds its line `line` (0-based): a list item for a list, else the block, table or paragraph. @param {Doc | Heading} host @param {number} line @returns {object | null} */
export function bodyNodeAt(host, line) {
  /** @type {object | null} */
  let found = null;
  if (line < 0 || line >= (host.bodyLines || []).length) return null;
  for (const node of host.body || []) {
    if (node.type === 'list') {
      for (const item of node.items) if (item.lineIndex <= line) found = item;
    } else if (node.lineIndex !== undefined && node.lineIndex <= line && line < node.lineIndex + (node.lineCount || 1)) found = node;
  }
  return found;
}

/**
 * What the screen is to scroll to after filing: the node that is drawn as a row, the heading that holds it (null: the file's own
 * text), and for a table the index of the new row in its `rows`.
 * @typedef {{ node: object, heading: Heading | null, row: number | null }} Reveal
 */

/** The new text of a plain capture a target function put at line `line` of the file. @param {Doc} doc @param {number} line @returns {Reveal | null} */
export function revealAtLine(doc, line) {
  const heading = findHeadingAtLine(doc, line);
  if (heading) return { node: heading, heading, row: null };
  const owner = [...headingLineIndex(doc).lines.entries()].filter(([n, w]) => w.bodyStart <= line && line - w.bodyStart < n.bodyLines.length).pop();
  const host = owner ? owner[0] : doc;
  const node = bodyNodeAt(host, line - (owner ? owner[1].bodyStart : 0));
  return node ? { node, heading: owner ? owner[0] : null, row: null } : null;
}

/**
 * Files `template` into `doc` (a file, or the one a target function chooses). `prepare` runs the template's :prepare-finalize functions;
 * on a failure nothing has been filed and `message` says why.
 * @param {Doc} doc
 * @param {CaptureTemplate} template
 * @param {{ now: Date, answers?: string[], context: Record<string, any>, place: (doc: Doc) => any }} options
 *   `context` is what the template can read besides the clock and its answers; `place` gives the options of filing (blank lines, table).
 * @returns {{ ok: true, target: Doc | Heading, placed: any, reveal: Reveal | null, afterFinalizeMessage?: string } | { ok: false, message: string }}  `reveal`: where the new text is on screen; `afterFinalizeMessage`: why an :after-finalize function failed (the entry is filed all the same)
 */
export function captureInto(doc, template, options) {
  const result = captureIntoDoc(doc, template, options);
  if (result.ok && template.afterFinalize?.length) {
    // Emacs runs :after-finalize once the entry is filed, in whatever buffer was current before the capture (the capture buffer is gone), so here an empty one
    const ran = runInBuffer('', template.afterFinalize, options.now);
    if (!ran.ok) return { ...result, afterFinalizeMessage: ran.message };
  }
  return result;
}

/** @param {Doc} doc @param {CaptureTemplate} template @param {{ now: Date, answers?: string[], context: Record<string, any>, place: (doc: Doc) => any }} options @returns {{ ok: true, target: Doc | Heading, placed: any, reveal: Reveal | null } | { ok: false, message: string }} */
function captureIntoDoc(doc, template, options) {
  const { now, answers, context, place } = options;
  const prepend = template.type === 'table-line' ? false : !!template.prepend; // for a table row, :prepend is where the row goes, not where a new heading goes
  /** @type {Doc | Heading} */
  let target;
  /** @type {null | (() => Heading | null)} */
  let apply = null;
  /** @type {Doc | Heading | null} */
  let planned = null;
  /** @type {null | ((lines: string[]) => void)} */
  let insertPlain = null;
  let pointLine = 0;
  if (template.targetFunction) {
    const found = runTargetFunction(doc, template.targetFunction, now, template.plist);
    if (!found.ok) return { ok: false, message: `Capture failed: ${found.message}` };
    if (!found.onHeading && template.type !== 'entry' && template.type !== 'plain') return { ok: false, message: `Capture failed: the target function must leave point on a heading to file a ${template.type}` };
    if (template.type === 'plain' && !found.atLineStart) return { ok: false, message: 'Capture failed: the target function must leave point at the start of a line to file plain text' };
    apply = found.apply;
    pointLine = found.line;
    insertPlain = template.type === 'plain' ? found.insertAtPoint : null;
    const scratch = parseOrg(found.after);
    planned = found.onHeading ? findHeadingAtLine(scratch, found.line) : scratch;
    target = doc;
  } else {
    try {
      target = (template.olp || []).length || template.datetree ? resolveOlpTarget(doc, template.olp || [], { now, prepend, unique: true, datetree: !!template.datetree, treeType: template.treeType, mustExist: !!template.olpMustExist }) : doc; // no path: the file's top level
    } catch (err) {
      return { ok: false, message: `Capture failed: ${/** @type {Error} */ (err).message}` };
    }
  }
  const tableRowNumber = template.type === 'table-line' ? plannedTableRow(planned ?? target, !!template.prepend, template) : null;
  let expanded;
  try {
    expanded = expandCaptureText(template.template, { ...context, now, promptAnswers: answers, tableRowNumber });
  } catch (err) {
    return { ok: false, message: `Can't capture: ${/** @type {Error} */ (err).message}` };
  }
  let text = expanded.text.replace(/\n$/, ''); // the newline that ends an expansion is the line's own
  const finalizers = [...(template.prepareFinalize ?? []), ...(template.beforeFinalize ?? [])]; // :before-finalize runs on the same text, after :prepare-finalize
  if (finalizers.length) {
    const ran = runInBuffer(expanded.text, finalizers, now, template.plist); // the buffer ends with the newline of its last line
    if (!ran.ok) return { ok: false, message: `Capture failed: ${ran.message}` };
    text = ran.text.replace(/\n$/, '');
  }
  if (apply) target = apply() ?? doc;
  if (insertPlain) {
    // Emacs puts plain text where point is, whatever it is on
    const before = template.emptyLinesBefore ?? template.emptyLines ?? 0;
    const after = template.emptyLinesAfter ?? template.emptyLines ?? 0;
    insertPlain([...Array(before).fill(''), ...text.split('\n'), ...Array(after).fill('')]);
    return { ok: true, target: doc, placed: null, reveal: revealAtLine(doc, pointLine + before) };
  }
  if (template.type === 'plain' && holdsHeading(text)) {
    const at = filePlainText(doc, target, text, template.prepend, { ...place(doc) });
    return { ok: true, target: doc, placed: null, reveal: revealAtLine(doc, at) };
  }
  /** @type {{ row?: number, host?: Doc | Heading, line?: number }} */
  let filed = {};
  const placed = fileCapture(doc, target, template.type, text, template.prepend, { ...place(doc), cursorAtEnd: expanded.cursorAtEnd || finalizers.length > 0, onFiled: (where) => (filed = where) });
  /** @type {Reveal | null} */
  let reveal = null;
  if (placed && 'level' in placed) reveal = { node: placed, heading: placed, row: null };
  else if (filed.host && filed.line !== undefined) {
    // found again by its line: filing may have parsed the text of the last heading again
    const node = bodyNodeAt(filed.host, filed.line);
    if (node) reveal = { node, heading: 'level' in filed.host && filed.host.level ? /** @type {Heading} */ (filed.host) : null, row: filed.row ?? null };
  }
  return { ok: true, target, placed, reveal };
}
