// @ts-check
/** @typedef {import('../src/types.js').Heading} Heading */
/** @typedef {import('../src/types.js').Doc} Doc */
/** @typedef {import('../src/types.js').Block & { resultsName?: string }} SourceBlock */
// Running JavaScript source blocks (Org Babel's C-c C-c) -- the commands around the sandbox.
import { UNSAVED_DOCUMENT_ID } from '../src/agenda.js';
import { commitLines } from '../src/body-edit.js';
import { parseLocationHeader, parseNetHeader } from '../src/extension-net.js';
import { cacheHash } from '../src/babel-cache.js';
import { evalAllowed, headerText, existingResultsHash, formatError, formatResult, isJsBlock, parseHeaderArgs, parseResultsSpec, pickedNames, placeResults, resolveVars, timeoutMs } from '../src/babel.js';
import { collectDocumentBlocks } from '../src/babel-blocks.js';
import { findAncestorPath } from '../src/archive-model.js';
import { flatBodyNodes } from '../src/body-parser.js';
import { babelLibrary, lobIngest, lobIngestMessage } from '../src/babel-lob.js';
import { sbeEvaluate } from '../src/babel-sbe.js';
import { setSbeHandler } from '../src/table-formula.js';
import { babelOptions } from '../src/babel-options.js';
import { elementInfo, executableElements, executeElement, moveToSrcBlock, removeResult, resultsPlace } from '../src/babel-ops.js';
import { plainVariables, referenceLookup } from '../src/babel-ref.js';
import { expandNoweb, nowebAllows } from '../src/noweb.js';
import { getBabelJs, getBabelLisp } from '../src/local-variables.js';
import { isElispBlock, runElisp } from '../src/babel-elisp.js';
import { blockResultLines } from '../src/babel-ops.js';
import { trustDigest } from '../src/babel-trust.js';
import { serializeOrg } from '../src/org-parser.js';
import { S } from './app-state.js';
import { runJavaScript } from './babel-run.js';
import { syncBabelOptions } from './babel-options-sync.js';
import { confirmDialog, openButtonChoiceModal } from './dialogs.js';
import { stripCommaEscapeApp } from './doc-helpers.js';
import { commitAndRender, setStatus } from './editing.js';
import { withKeyboardFocusPreserved } from './keyboard-focus.js';
import { scrollFocusedHeadingIntoView } from './render-helpers.js';
import { setKeyboardFocusToRow } from './keyboard-focus.js';
import { scrollNodeIntoView } from './navigation.js';
import { flattenVisibleRows } from '../src/outline-view-model.js';
import { render } from './render.js';
import { authorizeBlock, createServices, documentOwner } from './extension-services.js';

// `(org-sbe ...)` in a table formula calls the named blocks of the document in view
setSbeHandler((args) => sbeEvaluate(S.state.doc, args));

// each answer is kept with a digest of the document's executable parts (src/babel-trust.js); the earlier list of bare ids is not read
const TRUSTED_DOCUMENTS_KEY = 'org-pwa-babel-trust';
const MAX_TRUSTED_DOCUMENTS = 200;
const SECRET_NAME_RE = /token|password|secret|credential|auth|key/i;

/** Whether JavaScript blocks may run. Read from the app's Global Variables only, never from a
 *  file's own Local Variables: a document must not be able to switch code execution on for itself. */
export function babelEnabled() {
  return getBabelJs(S.globalVariables);
}

/** Whether Emacs Lisp blocks may run: on unless `org-babel-load-languages` leaves `emacs-lisp` out (Org's default list has it). Global variables only. */
export function babelLispEnabled() {
  return getBabelLisp(S.globalVariables);
}

function trustedDocuments() {
  try {
    const list = JSON.parse(localStorage.getItem(TRUSTED_DOCUMENTS_KEY) || '[]');
    return Array.isArray(list) ? list.filter((e) => e && typeof e.id === 'string' && typeof e.digest === 'string') : [];
  } catch (e) {
    return [];
  }
}

/** Asks once per document on this device, as Emacs's org-confirm-babel-evaluate does, and again when the document's code changes.
 *  An unsaved document is asked every time. */
async function confirmDocumentTrust(lisp = false) {
  const id = S.state.documentId || '';
  const savedId = id && !id.startsWith(UNSAVED_DOCUMENT_ID) ? id : '';
  const digest = savedId ? await trustDigest(serializeOrg(S.state.doc)) : '';
  if (savedId && trustedDocuments().some((e) => e.id === savedId && e.digest === digest)) return true;
  const ok = await confirmDialog(
    lisp
      ? 'Run Emacs Lisp from this document? It runs in the app\'s own interpreter, with no access to your files, accounts or the network. Run only code you trust.'
      : 'Run JavaScript from this document? It runs in a sandbox with no access to your files or accounts, and reaches the network or your position only if its header asks and you allow it. Run only code you trust.',
    { confirmLabel: 'Run', danger: false },
  );
  if (ok && savedId) {
    try {
      localStorage.setItem(TRUSTED_DOCUMENTS_KEY, JSON.stringify([...trustedDocuments().filter((e) => e.id !== savedId), { id: savedId, digest }].slice(-MAX_TRUSTED_DOCUMENTS)));
    } catch (e) {
      /* not remembered; asked again next time */
    }
  }
  return ok;
}

/** `org-confirm-babel-evaluate` and `:eval query`: a block that asks (`:eval query`) is asked every time; otherwise nothing is asked when the
 *  global variable is nil, and once per document (see confirmDocumentTrust) when it is t. @param {boolean} lisp @param {Record<string, any>} args */
async function confirmEvaluation(lisp, args) {
  syncBabelOptions();
  if (String(args.eval || '').trim() === 'query') return confirmDialog(`Evaluate this ${lisp ? 'emacs-lisp' : 'js'} code block on your system?`, { confirmLabel: 'Evaluate', danger: false });
  if (!babelOptions.confirm) return true;
  return confirmDocumentTrust(lisp);
}

/** The variables a script can read with org.vars.get: the effective settings, minus anything
 *  that looks like a credential. */
function visibleVariables() {
  const merged = { ...(S.globalVariables || {}), ...((S.state && S.state.localVariables) || {}) };
  const out = /** @type {Record<string, string>} */ ({});
  for (const [name, value] of Object.entries(merged)) {
    if (typeof value === 'string' && !SECRET_NAME_RE.test(name)) out[name] = value;
  }
  return out;
}

/**
 * @param {Heading} heading
 * @param {SourceBlock} block
 * @param {string[]} lines
 * @param {string} label
 */
function writeResults(heading, block, lines, label, hash = /** @type {string | null} */ (null), handling = 'replace') {
  const { start, removeCount, insert } = placeResults(heading.bodyLines, block, lines, { hash, handling, name: block.resultsName || '' });
  // the cursor stays on the block, whose body is re-parsed by the edit
  withKeyboardFocusPreserved(heading, () => commitLines(heading, start, removeCount, insert));
  commitAndRender(label);
  if (S.keyboardFocusedHeading === heading) scrollFocusedHeadingIntoView();
}

/**
 * Runs a JavaScript block and writes its result under it as #+RESULTS:. True when it ran (or was left alone as Emacs leaves it), false when it
 * failed or was not allowed to run.
 * @param {Heading} heading
 * @param {SourceBlock} block
 * @returns {Promise<boolean>}
 */
export async function executeSourceBlock(heading, block) {
  syncBabelOptions();
  const lisp = isElispBlock(block);
  if (!lisp && !isJsBlock(block)) {
    setStatus('Only emacs-lisp and JavaScript (js) blocks can run here.');
    return false;
  }
  if (lisp && !babelLispEnabled()) {
    setStatus('Emacs Lisp blocks are off: (emacs-lisp . t) is not in org-babel-load-languages.');
    return false;
  }
  if (!lisp && !babelEnabled()) {
    setStatus('JavaScript blocks are off. Turn on "Run JavaScript source blocks" in Settings.');
    return false;
  }
  if (S.isBufferReadOnly) {
    setStatus('Buffer is read-only — result not written.');
    return false;
  }
  // Header arguments as Org inherits them (file and heading properties, #+HEADER:); the block's own text alone if it cannot be found.
  const all = collectDocumentBlocks(S.state.doc);
  const info = all.find((b) => b.heading === heading && b.beginIndex === block.lineIndex) || null;
  const args = info ? info.args : parseHeaderArgs(block.params);
  if (info && info.name) block = { ...block, resultsName: info.name }; // Org writes `#+RESULTS: name` under a named block
  const spec = parseResultsSpec(args.results);
  if (spec.file && !lisp) spec.unsupported = 'file'; // only Lisp blocks can give a file link
  if (spec.unsupported) {
    setStatus(`Unsupported :results option "${spec.unsupported}".`);
    return false;
  }
  if (!evalAllowed(args)) {
    setStatus(`Evaluation of this block is disabled (:eval ${args.eval}).`);
    return true; // (Emacs only says so, and goes on)
  }
  if (!(await confirmEvaluation(lisp, args))) return false;

  const beginLine = heading.bodyLines[block.lineIndex];
  let vars;
  /** @type {import('../src/babel.js').TableNames} */ const names = {};
  try {
    vars = resolveVars(args.var, referenceLookup(S.state.doc, all), { colnames: args.colnames, rownames: args.rownames, hlines: args.hlines, names });
  } catch (err) {
    setStatus(`Source block failed: ${err.message}`); // as in Emacs, the error stops the command and writes nothing
    return false;
  }
  if (!lisp) vars = plainVariables(vars);

  let code = block.lines.map(stripCommaEscapeApp).join('\n');
  if (info && nowebAllows(args, 'eval')) {
    try {
      code = expandNoweb(S.state.doc, all, info);
    } catch (err) {
      writeResults(heading, block, formatError(err.message), 'Source block failed');
      return false;
    }
  }

  const hashBody = info && !nowebAllows(args, 'eval') ? info.emacsBody : code; // what Org digests: the body (Noweb expanded) before :prologue and :epilogue

  // :prologue and :epilogue go around the body, as org-babel-expand-body:generic puts them; an error's line stays the body's
  let lineOffset = 0;
  if (!lisp && args.prologue !== undefined) {
    const prologue = headerText(args.prologue);
    code = prologue + '\n' + code;
    lineOffset = prologue.split('\n').length;
  }
  if (!lisp && args.epilogue !== undefined) code += '\n' + headerText(args.epilogue);

  /** @type {string | null} */
  let hash = null;
  if (args.cache === 'yes') {
    hash = await cacheHash({ lang: info ? info.lang : 'js', args, vars, code: hashBody });
    if (existingResultsHash(heading.bodyLines, block) === hash) {
      setStatus('Cached: nothing has changed since the last run, so the block was not run. Delete its #+RESULTS: to run it again.');
      return true;
    }
  }

  /** @type {{ ok: boolean, message?: string, line?: number | null, value?: unknown, hasValue?: boolean, output?: string }} */
  let outcome;
  const started = Date.now();
  const owner = documentOwner(S.state.documentId);
  if (lisp) {
    // the interpreter has no network or position to declare; a step budget stops a loop that never ends
    setStatus('Running…');
    outcome = runElisp({ code, vars, spec, lexical: args.lexical, names: pickedNames(args, names) });
  } else {
    let declared;
    try {
      declared = { hosts: parseNetHeader(args.net), location: parseLocationHeader(args.location) };
    } catch (err) {
      writeResults(heading, block, formatError(err.message), 'Source block failed');
      return false;
    }
    if ((declared.hosts.length || declared.location) && !(await authorizeBlock(owner, declared))) {
      setStatus('Not allowed; the block was not run.');
      return false;
    }
    setStatus('Running…');
    outcome = await runJavaScript({
      code,
      vars,
      variables: visibleVariables(),
      timeoutMs: timeoutMs(args),
      onRpc: createServices({ owner, declared }),
    });
  }

  // The block is found again by its position and first line: the document may have changed while it ran.
  if (heading.bodyLines[block.lineIndex] !== beginLine) {
    setStatus('The document changed while the block ran; the result was not written.');
    return false;
  }
  if (lisp && !outcome.ok) {
    // as in Emacs, an error in the Lisp stops the command and writes nothing under the block
    setStatus(`Source block failed: ${outcome.message}`);
    return false;
  }
  const wrap = args.wrap === undefined ? null : args.wrap;
  /** @type {string[]} */
  let lines;
  if (outcome.ok && lisp) {
    try {
      const written = blockResultLines({ doc: S.state.doc, all }, { skipped: false, value: /** @type {import('../src/elisp-data.js').LObj} */ (outcome.value), js: null, spec, args }, { lang: info ? info.lang : 'emacs-lisp', name: info ? info.name : null });
      if (written === null) {
        setStatus(`Ran in ${Date.now() - started} ms (results: silent).`);
        return true;
      }
      lines = written;
    } catch (err) {
      outcome = { ok: false, message: err.message };
      lines = formatError(String(outcome.message));
    }
  } else {
    lines = outcome.ok ? formatResult(spec.collect === 'output' ? outcome.output : outcome.hasValue ? outcome.value : undefined, spec, { wrap, lang: info ? info.lang : 'js' }) : formatError(String(outcome.message), outcome.line && outcome.line > lineOffset ? outcome.line - lineOffset : null);
  }
  if (outcome.ok && spec.silent) {
    setStatus(`Ran in ${Date.now() - started} ms (results: silent).`);
    return true;
  }
  writeResults(heading, block, lines, outcome.ok ? 'Executed source block' : 'Source block failed', outcome.ok ? hash : null, outcome.ok ? spec.handling : 'replace');
  setStatus(outcome.ok ? `Ran in ${Date.now() - started} ms.` : `Source block failed: ${outcome.message}`);
  return outcome.ok;
}

/** C-c C-c on the keyboard-focused block, call or inline block. */
export function executeFocusedBlock() {
  const row = S.keyboardFocusedBodyRow;
  if (row && row.rowType === 'block') return executeSourceBlock(row.heading, row.node);
  return executeMaybe();
}

// ---- the other Babel commands: calls, inline blocks, moving, results, whole buffers ---------------------------------------------

/** What src/babel-ops.js needs to know of `heading`: the document, its blocks, the section's ancestors (ending with it) and its lines. @param {Heading} heading */
function envFor(heading) {
  const doc = S.state.doc;
  return { doc, all: collectDocumentBlocks(doc), ancestors: [...(findAncestorPath(doc, heading) || []), heading], lines: heading.bodyLines };
}

/** The JavaScript runner a call or an inline block uses (no network or position: those are declared by a block's own header). */
function jsRunner() {
  const owner = documentOwner(S.state.documentId);
  return async (/** @type {{ code: string, vars: Record<string, unknown> }} */ { code, vars }) => runJavaScript({ code, vars, variables: visibleVariables(), timeoutMs: 5000, onRpc: createServices({ owner, declared: { hosts: [], location: false } }) });
}

/**
 * Runs a `#+CALL:` line, an inline call or an inline source block of `heading` and writes the result (`org-babel-execute-src-block` for
 * the element). True when it ran or was left alone, false when it failed or was refused.
 * @param {Heading} heading @param {import('../src/babel-ops.js').Element} element
 */
async function executeOtherElement(heading, element) {
  syncBabelOptions();
  if (S.isBufferReadOnly) {
    setStatus('Buffer is read-only — result not written.');
    return false;
  }
  const env = envFor(heading);
  let info;
  try {
    info = elementInfo(env, element);
  } catch (err) {
    setStatus(`Source block failed: ${err.message}`);
    return false;
  }
  if (!info) {
    setStatus('Not on anything executable: no source block or Library of Babel entry has that name.');
    return false;
  }
  const lisp = isElispBlock({ name: 'SRC', params: info.lang });
  if (lisp && !babelLispEnabled()) {
    setStatus('Emacs Lisp blocks are off: (emacs-lisp . t) is not in org-babel-load-languages.');
    return false;
  }
  if (!lisp && !(isJsBlock({ name: 'SRC', params: info.lang }) && babelEnabled())) {
    setStatus(isJsBlock({ name: 'SRC', params: info.lang }) ? 'JavaScript blocks are off. Turn on "Run JavaScript source blocks" in Settings.' : 'Only emacs-lisp and JavaScript (js) blocks can run here.');
    return false;
  }
  if (!evalAllowed(info.args)) {
    setStatus(`Evaluation of this block is disabled (:eval ${info.args.eval}).`);
    return true;
  }
  if (!(await confirmEvaluation(lisp, info.args))) return false;
  const beginLine = heading.bodyLines[element.line];
  try {
    const edit = await executeElement(env, element, { runJs: jsRunner() });
    if (heading.bodyLines[element.line] !== beginLine) {
      setStatus('The document changed while the block ran; the result was not written.');
      return false;
    }
    if (!edit) {
      setStatus('Ran (nothing written).');
      return true;
    }
    withKeyboardFocusPreserved(heading, () => commitLines(heading, edit.start, edit.removeCount, edit.insert));
    commitAndRender('Executed source block');
    setStatus('Code block evaluation complete.');
    return true;
  } catch (err) {
    setStatus(`Source block failed: ${err.message}`);
    return false;
  }
}

/** The block node of `heading` that starts at body line `line`. @param {Heading} heading @param {number} line */
const blockNodeAt = (heading, line) => flatBodyNodes(heading.body || []).find((n) => n.type === 'block' && n.lineIndex === line);

/** Runs one element of `heading` of any kind. @param {Heading} heading @param {import('../src/babel-ops.js').Element} element */
async function executeAnyElement(heading, element) {
  if (element.type === 'src-block') {
    const node = blockNodeAt(heading, element.line);
    return node ? executeSourceBlock(heading, node) : false;
  }
  return executeOtherElement(heading, element);
}

/** What a tap-less "point" is on the focused row: the body lines it covers. */
function focusedRange() {
  const row = S.keyboardFocusedBodyRow;
  if (!row || !row.heading || row.heading.type === 'document') return null;
  const node = 'node' in row ? row.node : 'item' in row ? row.item : undefined;
  if (!node || typeof node.lineIndex !== 'number') return null;
  return { heading: /** @type {Heading} */ (row.heading), from: node.lineIndex, to: node.lineIndex + (('lineCount' in node && node.lineCount) || 1) };
}

/** Whether the focused row holds a #+CALL: line or an inline block. */
export function focusedHasExecutable() {
  const range = focusedRange();
  return !!range && executableElements(range.heading.bodyLines).some((e) => e.point.line >= range.from && e.point.line < range.to);
}

/** `org-babel-execute-maybe` (C-c C-c, C-c C-v e): runs the source block, `#+CALL:` line or inline block or call on the focused row; with
 *  several inline ones on it, asks which. */
export async function executeMaybe() {
  const range = focusedRange();
  if (!range) {
    setStatus('Move the cursor onto a source block, a #+CALL: line or a paragraph with an inline block first.');
    return false;
  }
  const { heading, from, to } = range;
  const found = executableElements(heading.bodyLines).filter((e) => e.point.line >= from && e.point.line < to);
  if (found.length === 0) {
    setStatus('Not on anything executable.');
    return false;
  }
  if (found.length === 1) return executeAnyElement(heading, found[0].element);
  const lines = heading.bodyLines;
  openButtonChoiceModal({
    label: 'Run which?',
    buttons: found.map((e) => ({ text: (lines[e.point.line] || '').slice(e.point.col, e.point.col + 40), onClick: () => executeAnyElement(heading, e.element) })),
  });
  return true;
}

/** Every heading of the document under `root` (all of it when null), in order, `root` first. @param {Heading | null} root @returns {Heading[]} */
function sections(root) {
  /** @type {Heading[]} */ const out = [];
  /** @param {Heading} h */
  const walk = (h) => {
    out.push(h);
    for (const c of h.children || []) walk(c);
  };
  if (root) walk(root);
  else for (const h of S.state.doc.children || []) walk(h);
  return out;
}

/** `org-babel-execute-buffer` (C-c C-v b) and, with `root`, `org-babel-execute-subtree` (C-c C-v s): every executable element in order; the
 *  first one that fails stops the rest, as in Emacs. The text before the first heading is not run (its lines are not editable here).
 *  @param {Heading | null} [root] */
export async function executeBuffer(root = null) {
  let count = 0;
  for (const heading of sections(root)) {
    for (let k = 0; ; k++) {
      const found = executableElements(heading.bodyLines);
      if (k >= found.length) break;
      if (!(await executeAnyElement(heading, found[k].element))) return false;
      count++;
    }
  }
  setStatus(`Ran ${count} source block${count === 1 ? '' : 's'}, calls and inline blocks.`);
  return true;
}

/** `org-babel-execute-subtree` (C-c C-v s) on the focused heading. */
export function executeSubtree() {
  if (!S.keyboardFocusedHeading) {
    setStatus('Move the cursor onto a heading first.');
    return false;
  }
  return executeBuffer(S.keyboardFocusedHeading);
}

/** Puts keyboard focus on the block row at `line` of `heading`, unfolding what hides it (`org-fold-show-context`). @param {Heading | null} heading @param {number} line */
function focusBlockAt(heading, line) {
  if (!heading) return;
  for (const ancestor of findAncestorPath(S.state.doc, heading) || []) ancestor.collapsed = false;
  heading.collapsed = false;
  heading.bodyHidden = false;
  render();
  const row = flattenVisibleRows(S.state.doc).find((r) => r.rowType === 'block' && r.heading === heading && r.node.lineIndex === line);
  if (!row) return;
  setKeyboardFocusToRow(row);
  render();
  scrollNodeIntoView(row.node);
}

/** `org-babel-next-src-block` and `org-babel-previous-src-block` (C-c C-v n, C-c C-v p), `count` blocks. @param {number} count @param {boolean} backward */
export function gotoSrcBlock(count, backward) {
  if (!S.state.doc) return false;
  const row = S.keyboardFocusedBodyRow;
  const heading = S.keyboardFocusedHeading;
  const range = focusedRange();
  const from = { heading: heading || null, line: range ? range.from : -1 };
  if (row && range && !backward) from.line = range.to - 1; // from the end of the row it is on
  try {
    const target = moveToSrcBlock(S.state.doc, from, count, backward);
    focusBlockAt(target.heading, target.line);
    return true;
  } catch (err) {
    setStatus(err.message);
    return false;
  }
}

/** The element on the focused row that has results: the first block, call or inline block, with its name. */
function focusedResultElement() {
  const range = focusedRange();
  if (!range) return null;
  const found = executableElements(range.heading.bodyLines).filter((e) => e.point.line >= range.from && e.point.line < range.to);
  if (!found.length) return null;
  const element = found[0].element;
  return { heading: range.heading, element, name: element.type === 'src-block' ? element.scan.name : null };
}

/** `org-babel-where-is-src-block-result`: moves to the results of the focused block, call or inline block. */
export function goToResult() {
  const at = focusedResultElement();
  const place = at && resultsPlace(at.heading.bodyLines, at.element, at.name);
  if (!at || !place) {
    setStatus('No result.');
    return false;
  }
  const node = flatBodyNodes(at.heading.body || []).find((n) => n.lineIndex !== undefined && n.lineIndex <= place.line && place.line < n.lineIndex + (('lineCount' in n && n.lineCount) || 1));
  if (node) {
    const row = flattenVisibleRows(S.state.doc).find((r) => r.rowType !== 'heading' && r.rowType !== 'list-item' && r.heading === at.heading && r.node === node);
    if (row) {
      setKeyboardFocusToRow(row);
      render();
      scrollNodeIntoView(node);
    }
  }
  return true;
}

/** `org-babel-remove-result-one-or-many` (C-c C-v k): removes the result of the focused block; with `all`, of every source block of the document. @param {boolean} [all] */
export function removeResults(all = false) {
  if (S.isBufferReadOnly) {
    setStatus('Buffer is read-only — nothing removed.');
    return false;
  }
  syncBabelOptions();
  const targets = all ? sections(null).flatMap((h) => executableElements(h.bodyLines).filter((e) => e.element.type === 'src-block').map((e) => ({ heading: h, element: e.element }))) : [focusedResultElement()].filter((t) => t !== null);
  let removed = 0;
  // from the last block up, so an earlier one's lines stay where they were
  for (const t of targets.slice().reverse()) {
    const name = t.element.type === 'src-block' ? t.element.scan.name : null;
    const edit = removeResult(t.heading.bodyLines, t.element, name);
    if (!edit) continue;
    withKeyboardFocusPreserved(t.heading, () => commitLines(t.heading, edit.start, edit.removeCount, edit.insert));
    removed++;
  }
  if (removed) commitAndRender('Removed results');
  setStatus(removed ? `Removed ${removed} result${removed === 1 ? '' : 's'}.` : 'No result to remove.');
  return removed > 0;
}

/** `org-babel-lob-ingest` (C-c C-v i): adds the named source blocks of this document to the Library of Babel, where a #+CALL: line or call_name() finds them from any document until the app is closed. */
export function ingestLibrary() {
  if (!S.state.doc) return false;
  syncBabelOptions();
  try {
    setStatus(lobIngestMessage(lobIngest(S.state.doc)) + ` (${babelLibrary.size} in all)`);
    return true;
  } catch (err) {
    setStatus(`Library of Babel: ${err.message}`);
    return false;
  }
}
