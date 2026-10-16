// org-footnote-new and org-footnote-normalize (the rules are in src/footnotes.js). The new-footnote command writes at the
// cursor, so it works in Text view; normalizing works from any view.
import { footnoteLabels, insertFootnote, normalizeFootnotes, uniqueFootnoteLabel } from '../src/footnotes.js';
import { getFootnoteAutoLabel, getFootnoteDefineInline, getFootnoteSection } from '../src/local-variables.js';
import { serializeOrg } from '../src/org-parser.js';
import { S } from './app-state.js';
import { commitTextModeIfActive, replaceDocumentText, setStatus } from './editing.js';
import { readFromMinibuffer } from './minibuffer-prompt.js';
import { render } from './render.js';

/** @returns {any} */
function textEditor() {
  return S.currentView === 'text' ? document.getElementById('document-text-edit-input') : null;
}

function footnoteOptions() {
  const vars = S.state.localVariables;
  return { section: getFootnoteSection(vars), defineInline: getFootnoteDefineInline(vars) };
}

/** A label as typed in the minibuffer: "fn:" dropped, blank meaning anonymous (org-footnote-normalize-label).
 * @param {string} answer @returns {string | null} */
function labelFromAnswer(answer) {
  const t = answer.trim();
  if (t === '') return null;
  return t.startsWith('fn:') ? t.slice(3) : t;
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
  const auto = getFootnoteAutoLabel(S.state.localVariables);
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
  const result = insertFootnote(before, at, label, footnoteOptions());
  if (!result) {
    setStatus('Cannot insert a footnote here.');
    return;
  }
  editor.value = result.text;
  editor.focus();
  editor.setSelectionRange(result.cursor, result.cursor);
  if (result.existing) setStatus(`New reference to existing note ${label}.`);
  else if (label !== null && !footnoteOptions().defineInline) setStatus(`Footnote ${label}: write its definition.`);
}

/** org-footnote-normalize: every footnote becomes a numbered one, in reading order, with its definition in the footnote section. */
export function normalizeFootnotesCommand() {
  if (!S.state.doc) return;
  if (S.isBufferReadOnly) {
    setStatus('Buffer is read-only — change not applied.');
    return;
  }
  const options = footnoteOptions();
  const editor = textEditor();
  if (editor) {
    if (S.narrowedTextModeRange) {
      setStatus('Widen first (C-x n w): footnotes are normalized across the whole file.');
      return;
    }
    const next = normalizeFootnotes(editor.value, options);
    if (next === editor.value) {
      setStatus('Footnotes are already normalized.');
      return;
    }
    editor.value = next;
    setStatus('Footnotes normalized.');
    return;
  }
  commitTextModeIfActive();
  const text = serializeOrg(S.state.doc);
  const next = normalizeFootnotes(text, options);
  if (next === text) {
    setStatus(footnoteLabels(text).length ? 'Footnotes are already normalized.' : 'There are no footnotes.');
    return;
  }
  S.narrowedHeading = null;
  replaceDocumentText(next, 'Normalized footnotes');
  render();
  setStatus('Footnotes normalized.');
}
