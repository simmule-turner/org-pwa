// @ts-check
// The Export page's General and HTML cards: text for the preamble, postamble, head, page header and page footer, each with a switch.
// Nothing is applied until its box is ticked, and anything the file itself says wins (see src/export-defaults.js).
import { EXPORT_DEFAULT_ITEMS, LATEX_CLASSES, LATEX_COMPILERS, encodeExportText, encodeLispString, exportItemState, hasLatexTocFix, hasPagedToc, LATEX_HEADER_KEY, LATEX_INIT_KEY, latexExportDefaults, withLatexTocFix, withPagedToc } from '../src/export-defaults.js';
import { S } from './app-state.js';
import { setStatus } from './editing.js';
import { commitGlobalVariableChange } from './settings-quick.js';
import { menuButton } from './ui-widgets.js';
import { latexClassNames } from '../src/latex-config.js';

/** @typedef {typeof EXPORT_DEFAULT_ITEMS[number]} ExportItem */

const CODES = [
  ['%t', 'Title (#+TITLE)'],
  ['%s', 'Subtitle (#+SUBTITLE)'],
  ['%a', 'Author (#+AUTHOR)'],
  ['%d', 'Date (#+DATE)'],
  ['%e', 'Email address (#+EMAIL), as a link'],
  ['%c', 'Creator line (#+CREATOR)'],
  ['%C %T', 'When the file was exported'],
  ['%%', 'A literal percent sign'],
];
const PAGE_CODES = [
  ['%p', 'Page number (page header and footer only)'],
  ['%P', 'Number of pages (page header and footer only)'],
  ['|', 'Splits left | centre | right. Two parts are left and right; one part is the centre. Leave a part empty to skip it.'],
];

/** @param {string} text @param {string} css */
function line(text, css) {
  const d = document.createElement('div');
  d.textContent = text;
  d.style.cssText = css;
  return d;
}

/** The "Format codes" help, closed until opened.
 * @param {boolean} withPage */
function codesHelp(withPage) {
  const box = document.createElement('details');
  box.setAttribute('data-export-codes', '');
  box.style.cssText = 'margin: 6px 0 4px';
  const summary = document.createElement('summary');
  summary.textContent = 'Format codes';
  summary.style.cssText = 'cursor: pointer; font-size: 13px; min-height: 32px; display: flex; align-items: center';
  box.appendChild(summary);
  for (const [code, meaning] of withPage ? [...CODES, ...PAGE_CODES] : CODES) {
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; gap: 10px; font-size: 12px; padding: 4px 0; border-top: 0.5px solid var(--border)';
    row.appendChild(line(code, 'flex: 0 0 52px; font-family: monospace'));
    row.appendChild(line(meaning, 'flex: 1 1 auto; min-width: 0'));
    box.appendChild(row);
  }
  box.appendChild(line('Example: "Prepared by %a, %d". A setting written in the file itself, such as #+OPTIONS: html-preamble:"...", takes the place of the one here.', 'font-size: 11px; opacity: 0.65; margin-top: 6px'));
  return box;
}

/** One item: a tick box with its name, then the text.
 * @param {ExportItem} item @param {string} name @param {string} variable @param {boolean} multiline */
function itemRow(item, name, variable, multiline) {
  const state = exportItemState(S.globalVariables, item);
  const row = document.createElement('div');
  row.setAttribute('data-export-item', item.id);
  row.style.cssText = 'margin-top: 10px; padding-top: 10px; border-top: 0.5px solid var(--border)';

  const head = document.createElement('label');
  head.style.cssText = 'display: flex; align-items: center; gap: 8px; min-height: 44px; font-size: 14px; cursor: pointer';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = state.on;
  box.style.cssText = 'width: 22px; height: 22px; margin: 0';
  head.appendChild(box);
  const label = document.createElement('span');
  label.style.fontWeight = '700';
  label.textContent = name;
  head.appendChild(label);
  head.appendChild(line(variable, 'font-size: 12px; opacity: 0.65'));
  row.appendChild(head);

  /** @type {HTMLInputElement | HTMLTextAreaElement} */
  let field;
  if (multiline) {
    field = document.createElement('textarea');
    field.rows = 4;
    field.style.resize = 'vertical';
  } else {
    field = document.createElement('input');
    field.type = 'text';
    field.style.minHeight = '44px';
  }
  field.value = state.text;
  field.setAttribute('aria-label', name + ' text');
  field.style.cssText += '; width: 100%; box-sizing: border-box; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border-strong); background: var(--bg); color: var(--fg); font-family: monospace; font-size: 13px';
  row.appendChild(field);

  box.onchange = async () => {
    if (item.lisp) await commitGlobalVariableChange(item.key, box.checked ? encodeLispString(field.value.trim() === '' ? item.text : field.value) : null);
    else await commitGlobalVariableChange(item.key + '-on', box.checked ? 't' : null);
    setStatus(`${name}: ${box.checked ? 'applied to every export that does not set its own' : 'not applied'}.`);
  };
  field.onchange = async () => {
    if (item.lisp) {
      if (field.value.trim() === '') field.value = item.text;
      if (box.checked) await commitGlobalVariableChange(item.key, encodeLispString(field.value));
      setStatus(box.checked ? `${name} text saved.` : `${name}: tick the box to apply it.`);
      return;
    }
    const same = field.value === item.text;
    await commitGlobalVariableChange(item.key, same || field.value.trim() === '' ? null : encodeExportText(field.value));
    if (field.value.trim() === '') field.value = item.text;
    setStatus(`${name} text saved.`);
  };
  return row;
}

/** Puts every item in `ids` back to its text and switches it off.
 * @param {string[]} ids */
async function resetItems(ids) {
  for (const item of EXPORT_DEFAULT_ITEMS) {
    if (!ids.includes(item.id)) continue;
    await commitGlobalVariableChange(item.key, null);
    if (!item.lisp) await commitGlobalVariableChange(item.key + '-on', null);
  }
}

/** @param {string} title @param {string} sub @param {string} intro */
function cardShell(title, sub, intro) {
  const card = document.createElement('div');
  card.className = 'settings-section';
  const t = document.createElement('div');
  t.className = 'panel-section-title';
  t.textContent = title;
  card.appendChild(t);
  card.appendChild(line(sub, 'font-size: 12px; opacity: 0.65; margin-top: -4px'));
  card.appendChild(line(intro, 'font-size: 12px; opacity: 0.75; margin-top: 6px'));
  return card;
}

/**
 * @param {() => void} rerender
 * @returns {{ general: HTMLElement, html: HTMLElement, latex: HTMLElement }} */
export function buildExportCards(rerender) {
  const general = cardShell('General', 'Printed pages and PDF', 'Written as left | centre | right. A ticked item is used for every export that does not set its own.');
  general.setAttribute('data-export-card', 'general');
  general.appendChild(itemRow(EXPORT_DEFAULT_ITEMS[3], 'Page header', 'page-header', false));
  general.appendChild(itemRow(EXPORT_DEFAULT_ITEMS[4], 'Page footer', 'page-footer', false));
  general.appendChild(codesHelp(true));
  const resetGeneral = document.createElement('div');
  resetGeneral.className = 'panel-row';
  resetGeneral.appendChild(menuButton('Reset General', async () => { await resetItems(['pageHeader', 'pageFooter']); rerender(); }));
  general.appendChild(resetGeneral);

  const html = cardShell('HTML', 'Web page export', 'A ticked item sets the Org variable of that name, for every HTML export whose file does not set its own. Unticking removes it.');
  html.setAttribute('data-export-card', 'html');
  html.appendChild(itemRow(EXPORT_DEFAULT_ITEMS[0], 'Preamble', 'org-html-preamble', false));
  html.appendChild(itemRow(EXPORT_DEFAULT_ITEMS[1], 'Postamble', 'org-html-postamble', false));
  html.appendChild(itemRow(EXPORT_DEFAULT_ITEMS[2], 'Head', 'org-html-head', true));
  html.appendChild(pagedTocRow(rerender));
  html.appendChild(line('The head goes inside <head>. Lines the file gives with #+HTML_HEAD: come after it, so they can override it.', 'font-size: 11px; opacity: 0.65; margin-top: 4px'));
  html.appendChild(codesHelp(false));
  const resetHtml = document.createElement('div');
  resetHtml.className = 'panel-row';
  resetHtml.appendChild(menuButton('Reset HTML', async () => { await resetItems(['preamble', 'postamble', 'head']); rerender(); }));
  html.appendChild(resetHtml);

  const latex = cardShell('LaTeX', 'LaTeX export', 'Used for every LaTeX export whose file does not set its own #+LATEX_CLASS: or #+LATEX_COMPILER:.');
  latex.setAttribute('data-export-card', 'latex');
  const current = latexExportDefaults(S.globalVariables);
  latex.appendChild(choiceRow('Document class', 'org-latex-default-class', [...LATEX_CLASSES, ...latexClassNames(current.init).filter((n) => !LATEX_CLASSES.includes(n))], current.cls || 'article'));
  latex.appendChild(choiceRow('Compiler', 'org-latex-compiler', LATEX_COMPILERS, current.compiler || 'pdflatex'));
  latex.appendChild(latexTocFixRow(rerender, current.header || ''));
  latex.appendChild(line('xelatex and lualatex write Unicode text as it is; pdflatex gets the inputenc and fontenc packages.', 'font-size: 11px; opacity: 0.65; margin-top: 4px'));
  latex.appendChild(latexInitRow(rerender, current.init || ''));
  return { general, html, latex };
}

/** The init text for the LaTeX export: Emacs Lisp that sets org-latex-classes, org-latex-packages-alist and the source block backend.
 * @param {() => void} rerender @param {string} text */
function latexInitRow(rerender, text) {
  const row = document.createElement('div');
  row.setAttribute('data-export-latex-init', '');
  row.style.cssText = 'margin-top: 10px; padding-top: 10px; border-top: 0.5px solid var(--border)';
  const name = document.createElement('div');
  name.style.cssText = 'font-size: 14px; font-weight: 700; min-height: 32px; display: flex; align-items: center';
  name.textContent = 'Classes, packages and source blocks';
  row.appendChild(name);
  row.appendChild(line("Emacs Lisp, as in an init file: (add-to-list 'org-latex-classes ...), (add-to-list 'org-latex-packages-alist '(\"\" \"listings\")), (setq org-latex-src-block-backend 'listings) or 'minted, org-latex-listings-options, org-latex-minted-options. Other forms are ignored.", 'font-size: 11px; opacity: 0.65; margin-bottom: 6px'));
  const field = document.createElement('textarea');
  field.rows = 8;
  field.value = text;
  field.spellcheck = false;
  field.setAttribute('aria-label', 'LaTeX init text');
  field.style.cssText = 'width: 100%; box-sizing: border-box; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border-strong); background: var(--bg); color: var(--fg); font-family: monospace; font-size: 13px; resize: vertical';
  field.onchange = async () => {
    await commitGlobalVariableChange(LATEX_INIT_KEY, field.value.trim() === '' ? null : encodeLispString(field.value));
    setStatus(field.value.trim() === '' ? 'LaTeX init text removed.' : 'LaTeX init text saved.');
    rerender();
  };
  row.appendChild(field);
  return row;
}

/** "Add TOC with page numbers": adds or removes the Paged.js script and its CSS in org-html-head, so the text box above shows it.
 * @param {() => void} rerender */
function pagedTocRow(rerender) {
  const head = EXPORT_DEFAULT_ITEMS[2];
  const state = exportItemState(S.globalVariables, head);
  const row = document.createElement('label');
  row.setAttribute('data-export-paged-toc', '');
  row.style.cssText = 'display: flex; align-items: center; gap: 8px; min-height: 44px; margin-top: 10px; font-size: 14px; cursor: pointer';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = state.on && hasPagedToc(state.text);
  box.style.cssText = 'width: 22px; height: 22px; margin: 0';
  row.appendChild(box);
  const text = document.createElement('span');
  text.textContent = 'Add TOC with page numbers';
  text.style.fontWeight = '700';
  row.appendChild(text);
  box.onchange = async () => {
    const next = withPagedToc(state.on ? state.text : '', box.checked);
    await commitGlobalVariableChange(head.key, next.trim() === '' ? null : encodeLispString(next));
    setStatus(box.checked ? 'Table of contents with page numbers added to Head. Needs #+OPTIONS: toc:… in the file, and a network connection when the HTML is opened.' : 'Page-number table of contents removed from Head.');
    rerender();
  };
  return row;
}

/** "Fix wide TOC numbers": adds or removes the tocloft lines in the LaTeX header kept in org-xx-latex-header.
 * @param {() => void} rerender @param {string} header */
function latexTocFixRow(rerender, header) {
  const row = document.createElement('label');
  row.setAttribute('data-export-latex-toc-fix', '');
  row.style.cssText = 'display: flex; align-items: center; gap: 8px; min-height: 44px; margin-top: 10px; font-size: 14px; cursor: pointer';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = hasLatexTocFix(header);
  box.style.cssText = 'width: 22px; height: 22px; margin: 0';
  row.appendChild(box);
  const text = document.createElement('span');
  text.textContent = 'Fix wide TOC numbers';
  text.style.fontWeight = '700';
  row.appendChild(text);
  row.appendChild(line(LATEX_HEADER_KEY, 'font-size: 12px; opacity: 0.65'));
  box.onchange = async () => {
    const next = withLatexTocFix(header, box.checked);
    await commitGlobalVariableChange(LATEX_HEADER_KEY, next.trim() === '' ? null : encodeLispString(next));
    setStatus(box.checked ? 'Table-of-contents number fix added to every LaTeX export (needs the tocloft package).' : 'Table-of-contents number fix removed.');
    rerender();
  };
  return row;
}

/** A labelled list of words that sets one Org variable; the first word is the variable's own default and is stored as unset.
 * @param {string} name @param {string} variable @param {string[]} words @param {string} current */
function choiceRow(name, variable, words, current) {
  const row = document.createElement('div');
  row.setAttribute('data-export-choice', variable);
  row.style.cssText = 'margin-top: 10px; padding-top: 10px; border-top: 0.5px solid var(--border)';
  const label = document.createElement('label');
  label.style.cssText = 'display: flex; flex-direction: column; gap: 4px; font-size: 14px';
  const head = document.createElement('span');
  head.style.fontWeight = '700';
  head.textContent = name;
  label.appendChild(head);
  label.appendChild(line(variable, 'font-size: 12px; opacity: 0.65'));
  const select = document.createElement('select');
  select.style.cssText = 'min-height: 44px; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border-strong); background: var(--bg); color: var(--fg); font-size: 14px';
  for (const w of words) {
    const o = document.createElement('option');
    o.value = w;
    o.textContent = w;
    o.selected = w === current;
    select.appendChild(o);
  }
  select.onchange = async () => {
    await commitGlobalVariableChange(variable, select.value === words[0] ? null : encodeLispString(select.value));
    setStatus(`${name}: ${select.value}.`);
  };
  label.appendChild(select);
  row.appendChild(label);
  return row;
}
