// The footnote commands of org-footnote.el (the rules are in src/footnotes.js). Insert footnote and the jump between a
// reference and its definition use the cursor, so they work in Text view; sort, renumber, normalize and delete work from
// any view.
import {
  canInsertFootnoteAt,
  createFootnoteDefinition,
  deleteFootnote,
  findFootnoteDefinition,
  findFootnoteReference,
  footnoteAt,
  footnoteLabels,
  insertFootnote,
  normalizeFootnotes,
  renumberFootnotes,
  sortFootnotes,
  uniqueFootnoteLabel,
} from '../src/footnotes.js';
import { getFootnoteAutoAdjust, getFootnoteAutoLabel, getFootnoteDefineInline, getFootnoteSection } from '../src/local-variables.js';
import { serializeOrg } from '../src/org-parser.js';
import { S } from './app-state.js';
import { confirmDialog } from './dialogs.js';
import { commitTextModeIfActive, replaceDocumentText, setStatus } from './editing.js';
import { readFromMinibuffer, readKeyFromMinibuffer } from './minibuffer-prompt.js';
import { render } from './render.js';

/** @returns {any} */
function textEditor() {
  return S.currentView === 'text' ? document.getElementById('document-text-edit-input') : null;
}

/** What #+STARTUP: sets for footnotes (fninline, fnlocal, fnauto, fnprompt, fnconfirm, fnplain, fnadjust and their opposites);
 * a Local Variables setting of the same name wins.
 * @returns {Record<string, string>} */
function startupFootnoteVariables() {
  /** @type {Record<string, string>} */
  const vars = {};
  const doc = S.state.doc;
  for (const k of doc ? doc.keywords : []) {
    if (String(k.key).toUpperCase() !== 'STARTUP') continue;
    for (const word of String(k.value).trim().split(/\s+/)) {
      if (word === 'fninline') vars['org-footnote-define-inline'] = 't';
      else if (word === 'nofninline') vars['org-footnote-define-inline'] = 'nil';
      else if (word === 'fnlocal') vars['org-footnote-section'] = 'nil';
      else if (word === 'fnauto') vars['org-footnote-auto-label'] = 't';
      else if (word === 'fnprompt' || word === 'fnplain') vars['org-footnote-auto-label'] = 'nil';
      else if (word === 'fnconfirm') vars['org-footnote-auto-label'] = 'confirm';
      else if (word === 'fnadjust') vars['org-footnote-auto-adjust'] = 't';
      else if (word === 'nofnadjust') vars['org-footnote-auto-adjust'] = 'nil';
    }
  }
  return vars;
}

function footnoteVariables() {
  return { ...startupFootnoteVariables(), ...S.state.localVariables };
}

function footnoteOptions() {
  const vars = footnoteVariables();
  return { section: getFootnoteSection(vars), defineInline: getFootnoteDefineInline(vars), autoAdjust: getFootnoteAutoAdjust(vars) };
}

/** A label as typed in the minibuffer: "fn:" dropped, blank meaning none (org-footnote-normalize-label).
 * @param {string} answer @returns {string | null} */
function labelFromAnswer(answer) {
  const t = answer.trim();
  if (t === '') return null;
  return t.startsWith('fn:') ? t.slice(3) : t;
}

/** Why a command that rewrites the file can't run now, or null; the text it works on otherwise.
 * @returns {{ text: string, editor: any } | null} */
function wholeText() {
  if (!S.state.doc) return null;
  if (S.isBufferReadOnly) {
    setStatus('Buffer is read-only — change not applied.');
    return null;
  }
  const editor = textEditor();
  if (editor) {
    if (S.narrowedTextModeRange) {
      setStatus('Widen first (C-x n w): footnotes are handled across the whole file.');
      return null;
    }
    return { text: editor.value, editor };
  }
  commitTextModeIfActive();
  return { text: serializeOrg(S.state.doc), editor: null };
}

/** Puts `next` in place of the whole text, in Text view or as one undoable edit of the document.
 * @param {{ text: string, editor: any }} work @param {string} next @param {string} label @param {number} [cursor] */
function putText(work, next, label, cursor) {
  if (work.editor) {
    work.editor.value = next;
    if (cursor !== undefined) {
      work.editor.focus();
      work.editor.setSelectionRange(cursor, cursor);
    }
    return;
  }
  S.narrowedHeading = null;
  replaceDocumentText(next, label);
  render();
}

/** org-footnote-new: a reference at the cursor and, unless it is anonymous, inline or to an existing note, the start of its
 * definition in the footnote section, with the cursor there to write it. */
export async function insertFootnoteCommand() {
  const editor = textEditor();
  if (!S.state.doc) return;
  if (!editor) {
    setStatus('Insert footnote: open Text view and put the cursor where the footnote goes.');
    return;
  }
  if (S.isBufferReadOnly || editor.readOnly) {
    setStatus('Buffer is read-only — change not applied.');
    return;
  }
  if (S.narrowedTextModeRange) {
    setStatus('Widen first (C-x n w): the definition goes in the footnote section of the whole file.');
    return;
  }
  const at = editor.selectionStart;
  const before = editor.value;
  if (!canInsertFootnoteAt(before, at)) {
    setStatus('Cannot insert a footnote here.');
    return;
  }
  const auto = getFootnoteAutoLabel(footnoteVariables());
  /** @type {string | null} */
  let label;
  if (auto === 'random') {
    label = Math.floor(Math.random() * 0x7fffffff).toString(16);
  } else {
    const proposed = uniqueFootnoteLabel(before);
    if (auto === 't') label = proposed;
    else {
      const answer = await readFromMinibuffer('Label (leave empty for anonymous): ', auto === 'confirm' ? proposed : '');
      if (answer === null) return;
      label = labelFromAnswer(answer);
    }
  }
  if (editor.value !== before) {
    setStatus('The text changed while you were choosing a label — try again.');
    return;
  }
  const options = footnoteOptions();
  const result = insertFootnote(before, at, label, options);
  if (!result) {
    setStatus('Cannot insert a footnote here.');
    return;
  }
  editor.value = result.text;
  editor.focus();
  editor.setSelectionRange(result.cursor, result.cursor);
  if (result.existing) setStatus(`New reference to existing note ${label}.`);
  else if (label !== null && !options.defineInline) setStatus(`Footnote ${label}: write its definition.`);
}

/** org-footnote-action: on a reference, go to its definition (or offer to create one); on a definition, go to its reference;
 * elsewhere add a footnote, or when that is not possible offer the other commands. */
export async function footnoteActionCommand() {
  const editor = textEditor();
  if (!S.state.doc) return;
  if (!editor || S.narrowedTextModeRange) {
    await footnoteMenu();
    return;
  }
  const text = editor.value;
  const at = editor.selectionStart;
  const here = footnoteAt(text, at);
  /** @param {number} pos */
  const go = (pos) => {
    editor.focus();
    editor.setSelectionRange(pos, pos);
  };
  if (here && here.kind === 'reference') {
    if (here.label === null) {
      go(here.contentsBegin);
      return;
    }
    const def = findFootnoteDefinition(text, here.label);
    if (def) {
      go(def.cursor);
      return;
    }
    if (S.isBufferReadOnly) return;
    const create = await confirmDialog(`No definition for ${here.label}. Create one?`, { confirmLabel: 'Create', cancelLabel: 'Cancel', danger: false });
    if (!create || editor.value !== text) return;
    const made = createFootnoteDefinition(text, here.label, footnoteOptions());
    editor.value = made.text;
    go(made.cursor);
    return;
  }
  if (here && here.kind === 'definition' && here.onLabel) {
    const ref = findFootnoteReference(text, at, here.label);
    if (ref) go(ref.begin);
    else setStatus(`Cannot find reference of footnote "${here.label}".`);
    return;
  }
  if (canInsertFootnoteAt(text, at)) {
    await insertFootnoteCommand();
    return;
  }
  await footnoteMenu();
}

/** The one-key menu org-footnote-action offers where no footnote can be added. */
async function footnoteMenu() {
  const key = await readKeyFromMinibuffer('Footnotes: [s]ort | [r]enumber fn:N | [S]=r+s | [n]ormalize | [d]elete: ', 'srSnd');
  if (key === 's') sortFootnotesCommand();
  else if (key === 'r') renumberFootnotesCommand();
  else if (key === 'S') {
    renumberFootnotesCommand();
    sortFootnotesCommand();
  } else if (key === 'n') normalizeFootnotesCommand();
  else if (key === 'd') await deleteFootnoteCommand();
}

/** org-footnote-normalize: every footnote becomes a numbered one, in reading order, with its definition in the footnote section. */
export function normalizeFootnotesCommand() {
  const work = wholeText();
  if (!work) return;
  const next = normalizeFootnotes(work.text, footnoteOptions());
  if (next === work.text) {
    setStatus(footnoteLabels(work.text).length ? 'Footnotes are already normalized.' : 'There are no footnotes.');
    return;
  }
  putText(work, next, 'Normalized footnotes');
  setStatus('Footnotes normalized.');
}

/** org-footnote-renumber-fn:N: the numbered footnotes in the order of their first reference. */
export function renumberFootnotesCommand() {
  const work = wholeText();
  if (!work) return;
  const next = renumberFootnotes(work.text).text;
  if (next === work.text) {
    setStatus('The numbered footnotes are already in order.');
    return;
  }
  putText(work, next, 'Renumbered footnotes');
  setStatus('Footnotes renumbered.');
}

/** org-footnote-sort: definitions in the order of their references, all under the footnote heading. */
export function sortFootnotesCommand() {
  const work = wholeText();
  if (!work) return;
  const next = sortFootnotes(work.text, footnoteOptions());
  if (next === work.text) {
    setStatus(footnoteLabels(work.text).length ? 'Footnote definitions are already in order.' : 'There are no footnotes.');
    return;
  }
  putText(work, next, 'Sorted footnotes');
  setStatus('Footnote definitions sorted.');
}

/** org-footnote-delete: the footnote at the cursor (an anonymous one just goes), or the one whose label is asked for; its
 * definitions and every reference. */
export async function deleteFootnoteCommand() {
  const work = wholeText();
  if (!work) return;
  const text = work.text;
  const here = work.editor ? footnoteAt(text, work.editor.selectionStart) : null;
  /** @type {string | null} */
  let label = here ? here.label : null;
  if (here && here.kind === 'reference' && here.label === null) {
    putText(work, text.slice(0, here.begin) + text.slice(here.end), 'Deleted footnote', here.begin);
    setStatus('Anonymous footnote removed.');
    return;
  }
  if (label === null) {
    const labels = footnoteLabels(text);
    if (!labels.length) {
      setStatus('There are no footnotes.');
      return;
    }
    const answer = await readFromMinibuffer(`Delete which footnote? (${labels.slice(0, 8).join(', ')}${labels.length > 8 ? ', …' : ''}): `);
    if (answer === null) return;
    label = labelFromAnswer(answer);
    if (label === null) return;
  }
  if (work.editor ? work.editor.value !== text : false) return;
  const result = deleteFootnote(text, label, footnoteOptions());
  if (result.references === 0 && result.definitions === 0) {
    setStatus(`There is no footnote "${label}".`);
    return;
  }
  putText(work, result.text, 'Deleted footnote');
  setStatus(`${result.definitions} definition(s) of and ${result.references} reference(s) of footnote ${label} removed.`);
}
