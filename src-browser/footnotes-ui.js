// The footnote commands of org-footnote.el (the rules are in src/footnotes.js). In the outline, a Footnote button in the
// paragraph and list-item editors inserts a footnote at the cursor and tapping a reference opens its sheet (note, go to
// definition, edit, delete); in Text view the same commands work on the cursor there. Sort, renumber, normalize and delete
// work from any view.
/** @typedef {import('../src/types.js').Heading} Heading */
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
import { editListItemText, editParagraphText, setHeadingText } from '../src/body-edit.js';
import { findFootnoteDefinition as findOutlineDefinition } from '../src/link-resolve.js';
import { getFootnoteAutoAdjust, getFootnoteAutoLabel, getFootnoteDefineInline, getFootnoteSection } from '../src/local-variables.js';
import { serializeOrg } from '../src/org-parser.js';
import { S } from './app-state.js';
import { hideUndoToast, showUndoToast } from './agenda-actions.js';
import { openActionSheet, openFormSheet } from './bottom-sheet.js';
import { confirmDialog } from './dialogs.js';
import { commitTextModeIfActive, openListItemEditor, openParagraphEditor, replaceDocumentText, setStatus } from './editing.js';
import { enterInsertModeAtCurrentLine } from './keyboard-focus.js';
import { readFromMinibuffer, readKeyFromMinibuffer } from './minibuffer-prompt.js';
import { navigateToHeading } from './navigation.js';
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
  replaceKeepingNarrowing(next, label);
  render();
}

/** @param {any} root @param {any} target @returns {number[] | null} */
function headingPath(root, target) {
  const kids = root.children || [];
  for (let i = 0; i < kids.length; i++) {
    if (kids[i] === target) return [i];
    const below = headingPath(kids[i], target);
    if (below) return [i, ...below];
  }
  return null;
}

/** Replaces the whole document as one undoable edit and, if a subtree was narrowed, narrows to the same place again.
 * @param {string} next @param {string} label */
function replaceKeepingNarrowing(next, label) {
  const path = S.narrowedHeading ? headingPath(S.state.doc, S.narrowedHeading) : null;
  S.narrowedHeading = null;
  replaceDocumentText(next, label);
  if (!path) return;
  /** @type {any} */
  let at = S.state.doc;
  for (const i of path) at = at && at.children ? at.children[i] : null;
  S.narrowedHeading = at || null;
}

// ---- the outline: Footnote in the editors, and the sheet of a reference --------------------------------------------------------

const CARET = '\uE000\uE001';

/** The whole file as it would be if the paragraph or list item being edited held `value`, with CARET at `caret`; the document
 * itself is left as it was.
 * @param {Heading} heading @param {'paragraph' | 'list-item' | 'heading-text'} kind @param {any} node @param {string} value @param {number} caret */
function serializeWithCaret(heading, kind, node, value, caret) {
  const savedLines = heading.bodyLines;
  const savedBody = heading.body;
  const marked = value.slice(0, caret) + CARET + value.slice(caret);
  try {
    heading.bodyLines = savedLines.slice();
    if (kind === 'heading-text') setHeadingText(heading, marked);
    else if (kind === 'paragraph') editParagraphText(heading, node, marked);
    else editListItemText(heading, node, marked.replace(/\n/g, ' '));
    return serializeOrg(S.state.doc);
  } finally {
    heading.bodyLines = savedLines;
    heading.body = savedBody;
  }
}

/** @param {string} s */
function bracketsPaired(s) {
  let depth = 0;
  for (const ch of s) {
    if (ch === '[') depth++;
    else if (ch === ']' && --depth < 0) return false;
  }
  return depth === 0;
}

/** The Footnote button of the paragraph and list-item editors.
 * @param {Heading} heading @param {'paragraph' | 'list-item' | 'heading-text'} kind @param {any} node */
export function footnoteEditorTool(heading, kind, node) {
  return {
    text: 'Footnote',
    title: 'Add a footnote at the cursor',
    id: 'footnote',
    onClick: (/** @type {HTMLTextAreaElement} */ textarea, /** @type {() => void} */ closeEditor) => openNewFootnoteSheet(heading, kind, node, textarea, closeEditor),
  };
}

/** @param {Heading} heading @param {'paragraph' | 'list-item' | 'heading-text'} kind @param {any} node @param {HTMLTextAreaElement} textarea @param {() => void} closeEditor */
function openNewFootnoteSheet(heading, kind, node, textarea, closeEditor) {
  if (S.isBufferReadOnly) {
    setStatus('Buffer is read-only \u2014 change not applied.');
    return;
  }
  const caret = textarea.selectionStart;
  const marked = serializeWithCaret(heading, kind, node, textarea.value, caret);
  const at = marked.indexOf(CARET);
  const text = marked.replace(CARET, '');
  if (at < 0 || !canInsertFootnoteAt(text, at)) {
    setStatus('Put the cursor after the words the footnote belongs to \u2014 not at the start of a line or inside a link.');
    return;
  }
  const options = footnoteOptions();
  const auto = getFootnoteAutoLabel(footnoteVariables());
  const proposed = auto === 'nil' ? '' : auto === 'random' ? Math.floor(Math.random() * 0x7fffffff).toString(16) : uniqueFootnoteLabel(text);
  const existing = new Set(footnoteLabels(text));
  const field = 'width:100%;box-sizing:border-box;min-height:var(--target);font-size:var(--text-body);margin:4px 0 10px;';
  /** @type {HTMLInputElement} */ let labelInput;
  /** @type {HTMLTextAreaElement} */ let noteInput;
  /** @type {HTMLInputElement} */ let inlineBox;
  /** @type {HTMLElement} */ let message;
  /** @type {HTMLElement} */ let noteBlock;

  const refresh = () => {
    const label = labelFromAnswer(labelInput.value);
    const bad = label !== null && /[\s[\]:]/.test(label);
    const known = label !== null && existing.has(label);
    noteBlock.style.display = known ? 'none' : '';
    message.textContent = bad
      ? 'A label has no spaces, brackets or colons.'
      : known
        ? `Footnote ${label} already exists \u2014 this adds another reference to it.`
        : label === null
          ? 'No label: the note is written right here in the text.'
          : '';
    return !bad;
  };

  const sheet = openFormSheet({
    title: 'New footnote',
    submitLabel: 'Insert',
    build: (panel) => {
      const labelCaption = document.createElement('label');
      labelCaption.textContent = 'Label';
      labelCaption.style.cssText = 'display:block;margin-top:var(--space-2);font-size:13px;opacity:0.75;';
      labelInput = document.createElement('input');
      labelInput.type = 'text';
      labelInput.value = proposed;
      labelInput.placeholder = 'Leave empty for an unlabelled note';
      labelInput.setAttribute('autocapitalize', 'off');
      labelInput.setAttribute('autocomplete', 'off');
      labelInput.spellcheck = false;
      labelInput.style.cssText = field;
      labelInput.addEventListener('input', refresh);
      labelInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          sheet.submit();
        }
      });
      labelCaption.appendChild(labelInput);

      noteBlock = document.createElement('div');
      const noteCaption = document.createElement('label');
      noteCaption.textContent = 'Note';
      noteCaption.style.cssText = 'display:block;font-size:13px;opacity:0.75;';
      noteInput = document.createElement('textarea');
      noteInput.rows = 3;
      noteInput.placeholder = 'The text of the note';
      noteInput.style.cssText = field + 'resize:vertical;min-height:calc(var(--target) * 2);';
      noteInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          sheet.submit();
        }
      });
      noteCaption.appendChild(noteInput);
      const inlineRow = document.createElement('label');
      inlineRow.style.cssText = 'display:flex;align-items:center;gap:12px;min-height:var(--target);font-size:var(--text-body);cursor:pointer;';
      inlineBox = document.createElement('input');
      inlineBox.type = 'checkbox';
      inlineBox.checked = options.defineInline;
      inlineBox.style.cssText = 'width:22px;height:22px;flex-shrink:0;';
      const inlineText = document.createElement('span');
      inlineText.textContent = 'Write it inline, in the text';
      inlineRow.append(inlineBox, inlineText);
      noteBlock.append(noteCaption, inlineRow);

      message = document.createElement('div');
      message.setAttribute('role', 'status');
      message.style.cssText = 'font-size:13px;min-height:1.3em;margin-top:2px;opacity:0.85;';
      panel.append(labelCaption, noteBlock, message);
      refresh();
      setTimeout(() => (labelInput.value === '' || auto === 'nil' ? labelInput : noteInput).focus(), 0);
    },
    onSubmit: () => {
      if (!refresh()) return false;
      const label = labelFromAnswer(labelInput.value);
      const known = label !== null && existing.has(label);
      const note = known ? '' : noteInput.value.trim().replace(/\n\s*\n+/g, '\n');
      const inline = label === null || inlineBox.checked;
      if (!known && inline && !bracketsPaired(note)) {
        message.textContent = 'Square brackets in an inline note must come in pairs.';
        return false;
      }
      const result = insertFootnote(text, at, label, { ...options, defineInline: inline });
      if (!result) {
        message.textContent = 'A footnote cannot go here.';
        return false;
      }
      const out = result.existing || !note ? result.text : result.text.slice(0, result.cursor) + note + result.text.slice(result.cursor);
      closeEditor();
      S.editingParagraph = null;
      S.editingListItem = null;
      S.editingHeadingText = null;
      replaceKeepingNarrowing(out, 'Inserted footnote');
      render();
      showUndoToast(label === null ? 'Footnote added' : result.existing ? `Reference to footnote ${label} added` : `Footnote ${label} added`, note ? note.slice(0, 80) : undefined);
    },
  });
}

/** The text of the note that begins at `begin` (inline: between the brackets; a definition: its first paragraph).
 * @param {string} text @param {number} begin @param {string} label */
function noteText(text, begin, label) {
  const open = `[fn:${label}`;
  if (text.startsWith(open + ':', begin)) {
    let depth = 0;
    for (let i = begin; i < text.length; i++) {
      if (text[i] === '[') depth++;
      else if (text[i] === ']' && --depth === 0) return text.slice(begin + open.length + 1, i).trim();
    }
  }
  const start = begin + open.length + 1;
  const stop = /\n[ \t]*\n|\n\[fn:|\n\*+ /.exec(text.slice(start));
  return text.slice(start, stop ? start + stop.index : undefined).trim();
}

/** The sheet of a footnote reference in the outline: its note, and what can be done with it.
 * @param {string} label */
export function openFootnoteSheet(label) {
  if (!S.state.doc) return;
  hideUndoToast(); // it sits above sheets
  const text = serializeOrg(S.state.doc);
  const found = findFootnoteDefinition(text, label);
  const def = /** @type {any} */ (findOutlineDefinition(S.state.doc, label));
  const note = found ? noteText(text, found.begin, label) : '';
  const writable = !S.isBufferReadOnly;
  /** @type {import('./bottom-sheet.js').SheetAction[]} */
  const actions = [];
  if (!found) {
    actions.push({
      label: 'Create the note',
      hint: 'Adds an empty definition in the footnote section',
      disabled: !writable,
      onClick: () => {
        const made = createFootnoteDefinition(serializeOrg(S.state.doc), label, footnoteOptions());
        replaceKeepingNarrowing(made.text, 'Created footnote definition');
        render();
        const created = /** @type {any} */ (findOutlineDefinition(S.state.doc, label));
        if (created) editDefinitionNode(created);
      },
    });
  } else {
    actions.push({ label: 'Edit note', disabled: !writable || !def, onClick: () => def && editDefinitionNode(def) });
    actions.push({
      label: 'Go to the note',
      disabled: !def,
      onClick: () => def && navigateToHeading(def.heading, { revealOwnBody: true, targetNode: def.node }),
    });
  }
  actions.push({
    label: 'Delete footnote',
    hint: 'Removes the note and every reference to it',
    danger: true,
    disabled: !writable,
    onClick: () => {
      const result = deleteFootnote(serializeOrg(S.state.doc), label, footnoteOptions());
      if (result.references === 0 && result.definitions === 0) {
        setStatus(`There is no footnote "${label}".`);
        return;
      }
      replaceKeepingNarrowing(result.text, 'Deleted footnote');
      render();
      showUndoToast(`Footnote ${label} deleted`, `${result.references} reference${result.references === 1 ? '' : 's'}, ${result.definitions} note${result.definitions === 1 ? '' : 's'}`);
    },
  });
  openActionSheet({ title: `Footnote ${label}`, subtitle: found ? (note.length > 240 ? note.slice(0, 237) + '\u2026' : note || '(empty note)') : 'This footnote has no note yet.', actions });
}

/** Opens the editor of the paragraph or list item that holds a footnote's note.
 * @param {{ heading: any, kind: string, node: any }} def */
function editDefinitionNode(def) {
  S.pendingCursorPosition = 'end';
  if (def.node.type === 'paragraph') {
    S.editingParagraph = { heading: def.heading, paragraph: def.node };
    render();
    openParagraphEditor(def.heading, def.node);
  } else if (def.node.type === 'list-item' || def.node.text !== undefined) {
    S.editingListItem = { heading: def.heading, item: def.node };
    render();
    openListItemEditor(def.heading, def.node);
  } else {
    setStatus('This note is inside a table cell \u2014 edit it there.');
  }
}

/** With a paragraph or list item selected in the outline: opens its editor and the New footnote sheet at its end.
 * @returns {boolean} */
function startFootnoteAtFocusedRow() {
  const row = S.keyboardFocusedBodyRow;
  if (!row || (row.rowType !== 'paragraph' && row.rowType !== 'list-item') || S.isBufferReadOnly) return false;
  S.pendingCursorPosition = 'end';
  enterInsertModeAtCurrentLine();
  const button = /** @type {HTMLElement | null} */ (document.querySelector('[data-editor-tool="footnote"]'));
  if (!button) return false;
  button.click();
  return true;
}

/** org-footnote-new: a reference at the cursor and, unless it is anonymous, inline or to an existing note, the start of its
 * definition in the footnote section, with the cursor there to write it. */
export async function insertFootnoteCommand() {
  const editor = textEditor();
  if (!S.state.doc) return;
  if (!editor) {
    if (!startFootnoteAtFocusedRow()) setStatus('Insert footnote: tap the paragraph, choose Edit text, put the cursor where it goes and tap Footnote.');
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
    if (!editor && startFootnoteAtFocusedRow()) return;
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
