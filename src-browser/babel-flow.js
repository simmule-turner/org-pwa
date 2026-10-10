// Running JavaScript source blocks (Org Babel's C-c C-c) -- the commands around the sandbox.
import { UNSAVED_DOCUMENT_ID } from '../src/agenda.js';
import { commitLines } from '../src/body-edit.js';
import { parseLocationHeader, parseNetHeader } from '../src/extension-net.js';
import { findNamedTable, formatError, formatResult, isJsBlock, parseHeaderArgs, parseResultsSpec, placeResults, resolveVars, timeoutMs } from '../src/babel.js';
import { collectDocumentBlocks } from '../src/babel-blocks.js';
import { expandNoweb, nowebAllows } from '../src/noweb.js';
import { getBabelJs } from '../src/local-variables.js';
import { S } from './app-state.js';
import { runJavaScript } from './babel-run.js';
import { confirmDialog } from './dialogs.js';
import { allHeadingsInOrder, stripCommaEscapeApp } from './doc-helpers.js';
import { commitAndRender, setStatus } from './editing.js';
import { authorizeBlock, createServices, documentOwner } from './extension-services.js';

const TRUSTED_DOCUMENTS_KEY = 'org-pwa-babel-documents';
const MAX_TRUSTED_DOCUMENTS = 200;
const SECRET_NAME_RE = /token|password|secret|credential|auth|key/i;

/** Whether JavaScript blocks may run. Read from the app's Global Variables only, never from a
 *  file's own Local Variables: a document must not be able to switch code execution on for itself. */
export function babelEnabled() {
  return getBabelJs(S.globalVariables);
}

function trustedDocuments() {
  try {
    const list = JSON.parse(localStorage.getItem(TRUSTED_DOCUMENTS_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

/** Asks once per document on this device, as Emacs's org-confirm-babel-evaluate does. An
 *  unsaved document is asked every time. */
async function confirmDocumentTrust() {
  const id = S.state.documentId || '';
  const savedId = id && !id.startsWith(UNSAVED_DOCUMENT_ID) ? id : '';
  if (savedId && trustedDocuments().includes(savedId)) return true;
  const ok = await confirmDialog(
    'Run JavaScript from this document? It runs in a sandbox with no access to your files or accounts, and reaches the network or your position only if its header asks and you allow it. Run only code you trust.',
    { confirmLabel: 'Run', danger: false },
  );
  if (ok && savedId) {
    try {
      localStorage.setItem(TRUSTED_DOCUMENTS_KEY, JSON.stringify([...trustedDocuments().filter((x) => x !== savedId), savedId].slice(-MAX_TRUSTED_DOCUMENTS)));
    } catch (e) {
      /* not remembered; asked again next time */
    }
  }
  return ok;
}

/** The variables a script can read with org.vars.get: the effective settings, minus anything
 *  that looks like a credential. */
function visibleVariables() {
  const merged = { ...(S.globalVariables || {}), ...((S.state && S.state.localVariables) || {}) };
  const out = {};
  for (const [name, value] of Object.entries(merged)) {
    if (typeof value === 'string' && !SECRET_NAME_RE.test(name)) out[name] = value;
  }
  return out;
}

function lookupTable(name) {
  for (const { heading } of allHeadingsInOrder(S.state.doc)) {
    const rows = findNamedTable(heading.bodyLines || [], name);
    if (rows) return rows;
  }
  return null;
}

function writeResults(heading, block, lines, label) {
  const { start, removeCount, insert } = placeResults(heading.bodyLines, block, lines);
  commitLines(heading, start, removeCount, insert);
  commitAndRender(label);
}

/** Runs a JavaScript block and writes its result under it as #+RESULTS:. */
export async function executeSourceBlock(heading, block) {
  if (!babelEnabled()) {
    setStatus('JavaScript blocks are off. Turn on "Run JavaScript source blocks" in Settings.');
    return;
  }
  if (!isJsBlock(block)) {
    setStatus('Only JavaScript (js) blocks can run here.');
    return;
  }
  if (S.isBufferReadOnly) {
    setStatus('Buffer is read-only — result not written.');
    return;
  }
  // Header arguments as Org inherits them (file and heading properties, #+HEADER:); the block's own text alone if it cannot be found.
  const all = collectDocumentBlocks(S.state.doc);
  const info = all.find((b) => b.heading === heading && b.beginIndex === block.lineIndex) || null;
  const args = info ? info.args : parseHeaderArgs(block.params);
  const spec = parseResultsSpec(args.results);
  if (spec.unsupported) {
    setStatus(`Unsupported :results option "${spec.unsupported}".`);
    return;
  }
  if (!(await confirmDocumentTrust())) return;

  const beginLine = heading.bodyLines[block.lineIndex];
  let vars;
  try {
    vars = resolveVars(args.var, lookupTable);
  } catch (err) {
    writeResults(heading, block, formatError(err.message), 'Executed source block');
    return;
  }

  let declared;
  try {
    declared = { hosts: parseNetHeader(args.net), location: parseLocationHeader(args.location) };
  } catch (err) {
    writeResults(heading, block, formatError(err.message), 'Source block failed');
    return;
  }
  const owner = documentOwner(S.state.documentId);
  if ((declared.hosts.length || declared.location) && !(await authorizeBlock(owner, declared))) {
    setStatus('Not allowed; the block was not run.');
    return;
  }

  let code = block.lines.map(stripCommaEscapeApp).join('\n');
  if (info && nowebAllows(args, 'eval')) {
    try {
      code = expandNoweb(S.state.doc, all, info);
    } catch (err) {
      writeResults(heading, block, formatError(err.message), 'Source block failed');
      return;
    }
  }

  setStatus('Running…');
  const started = Date.now();
  const outcome = await runJavaScript({
    code,
    vars,
    variables: visibleVariables(),
    timeoutMs: timeoutMs(args),
    onRpc: createServices({ owner, declared }),
  });

  // The block is found again by its position and first line: the document may have changed while it ran.
  if (heading.bodyLines[block.lineIndex] !== beginLine) {
    setStatus('The document changed while the block ran; the result was not written.');
    return;
  }
  const lines = outcome.ok ? formatResult(spec.collect === 'output' ? outcome.output : outcome.hasValue ? outcome.value : undefined, spec, { wrap: args.wrap || '' }) : formatError(outcome.message, outcome.line);
  if (outcome.ok && spec.silent) {
    setStatus(`Ran in ${Date.now() - started} ms (results: silent).`);
    return;
  }
  writeResults(heading, block, lines, outcome.ok ? 'Executed source block' : 'Source block failed');
  setStatus(outcome.ok ? `Ran in ${Date.now() - started} ms.` : `Source block failed: ${outcome.message}`);
}

/** C-c C-c on the keyboard-focused block. */
export function executeFocusedBlock() {
  const row = S.keyboardFocusedBodyRow;
  if (!babelEnabled()) {
    setStatus('JavaScript blocks are off. Turn on "Run JavaScript source blocks" in Settings.');
    return;
  }
  if (!row || row.rowType !== 'block') {
    setStatus('Move the cursor onto a source block first, or tap Run on it.');
    return;
  }
  return executeSourceBlock(row.heading, row.node);
}
