// @ts-check
// Extracted from app.js: capture ui.
import { CAPTURE_FILE_SCHEMES, computeNonCollidingKeys, expandTemplate, getCaptureFileScheme, resolveCaptureFileId, scanPrompts, storageKindForScheme } from '../src/capture-template.js';
import { captureInto } from '../src/capture-run.js';
import { getOrgTableDurationHourZeroPadding } from '../src/local-variables.js';
import { parseTableConstants, parseNamedTables, recalculateTable } from '../src/table-formula.js';
import { tableUserCall } from './extension-flow.js';
import { emitExtensionEvent } from './extension-events.js';
import { S } from './app-state.js';
import { openTimestampPickerPopup, showModalOverlay } from './dialogs.js';
import { capturePanel, capturePanelBox } from './dom.js';
import { commitAndRender, setStatus } from './editing.js';
import { UNSAVED_NOTE, writeToOtherFile } from './buffers.js';
import { findAncestorPath } from '../src/archive-model.js';
import { navigateToHeading, scrollNodeIntoView } from './navigation.js';
import { switchToTab } from './tabs.js';
import { captureLispNotes, getAllCaptureTemplates as getCaptureTemplates } from './capture-templates.js';
import { hideModalOverlay, menuButton } from './ui-widgets.js';
import { openDocsAtHeading, switchToView } from './views.js';
import { platform } from './platform.js';
import { findRunningClockAcrossSessions } from './clock-flow.js';

/** Converts org-agenda-files' own raw string value (semicolon-
 *  separated "scheme:path" entries, the same separator convention
 *  org-refile-targets already uses) into the array-of-strings shape
 *  the storage layer expects. A malformed entry -- not "scheme:path"
 *  at all, or an unrecognized scheme -- is silently skipped rather
 *  than guessed at or blocking the whole value, the same "malformed
 *  entry -- skipped, not guessed at" precedent org-refile-targets'
 *  own parser already sets (see src/refile.js), now that this is a
 *  generic Quick Settings longtext field with no separate blocking-
 *  validation step of its own. Splits only on the FIRST colon within
 *  each entry, so a path that itself contains one isn't mistaken for
 *  a second scheme separator. */
/** The More menu's own Capture step -- fetches templates the exact
 *  same way the separate, still-existing capturePanel does (async;
 *  this may resolve after the initial synchronous render, hence the
 *  moreMenuStep/moreOpen re-check below before touching the DOM), but
 *  renders each as one plain row, matching Export/Clocking's own
 *  look, rather than that panel's own two-column grid. Picking a
 *  template hands off to the unchanged capturePanel-based flow
 *  (openCapturePrompt) for the actual capture/prompt-form, exactly as
 *  before -- only how the picker itself looks and is reached changes. */
export async function renderCapturePanel() {
  capturePanelBox.innerHTML = '';
  if (!S.captureOpen) {
    hideModalOverlay(capturePanel);
    S.capturePromptTemplate = null;
    S.currentCaptureTemplates = [];
    S.captureShared = null; // shared-in content and the clipboard belong to one capture only
    S.captureClipboard = '';
    return;
  }
  showModalOverlay(capturePanel);

  if (S.capturePromptTemplate) {
    renderCapturePromptForm();
    return;
  }

  const heading = document.createElement('div');
  heading.style.fontSize = '12px';
  heading.style.opacity = '0.65';
  heading.style.marginBottom = '8px';
  heading.textContent = 'Capture \u2014 pick a template';
  capturePanelBox.appendChild(heading);

  const templates = await getCaptureTemplates();
  if (!S.captureOpen) return; // panel was closed again before this resolved
  S.currentCaptureTemplates = templates;
  if (captureLispNotes.length) setStatus(captureLispNotes.join(' '));

  if (templates.length === 0) {
    const empty = document.createElement('div');
    empty.style.opacity = '0.6';
    empty.style.fontSize = '13px';
    empty.style.marginBottom = '8px';
    empty.textContent = 'No capture templates are defined. Capture templates are set with org-capture-templates in the Lisp init (Settings \u2192 Advanced \u2192 Lisp init); examples/capture-templates.org has some to copy.';
    capturePanelBox.appendChild(empty);
    const closeRow = document.createElement('div');
    closeRow.className = 'panel-row';
    closeRow.appendChild(
      menuButton('Capture Templates help', () => {
        S.captureOpen = false;
        renderCapturePanel();
        openDocsAtHeading('#capture-templates');
      })
    );
    closeRow.appendChild(
      menuButton('Close', () => {
        S.captureOpen = false;
        renderCapturePanel();
      })
    );
    capturePanelBox.appendChild(closeRow);
    return;
  }

  const grid = document.createElement('div');
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = '1fr 1fr';
  grid.style.gap = '6px';

  const nonCollidingKeys = computeNonCollidingKeys(templates, (/** @type {{key: string}} */ t) => t.key); // badges however the picker was opened

  for (const template of templates) {
    const btn = document.createElement('button');
    btn.style.textAlign = 'left';
    btn.style.padding = '10px 12px';
    btn.style.border = '1px solid var(--border-strong)';
    btn.style.borderRadius = '8px';
    btn.style.background = 'var(--bg)';
    btn.style.color = 'var(--fg)';
    btn.style.fontSize = '14px';
    btn.style.minHeight = '44px';
    btn.style.display = 'flex';
    btn.style.alignItems = 'center';
    btn.style.gap = '8px';
    const hotkey = nonCollidingKeys.get(template);
    if (hotkey) {
      const badge = document.createElement('span');
      badge.textContent = hotkey;
      badge.style.fontSize = '11px';
      badge.style.fontFamily = 'monospace';
      badge.style.border = '1px solid var(--border-strong)';
      badge.style.borderRadius = '4px';
      badge.style.padding = '1px 5px';
      badge.style.opacity = '0.7';
      badge.style.flexShrink = '0';
      btn.appendChild(badge);
    }
    const label = document.createElement('span');
    label.textContent = template.description || '';
    btn.appendChild(label);
    btn.onclick = () => openCapturePrompt(template);
    grid.appendChild(btn);
  }
  capturePanelBox.appendChild(grid);

  const closeRow = document.createElement('div');
  closeRow.className = 'panel-row';
  closeRow.style.marginTop = '6px';
  closeRow.appendChild(
    menuButton('Close', () => {
      S.captureOpen = false;
      renderCapturePanel();
    })
  );
  capturePanelBox.appendChild(closeRow);
}

/** Opens the given template: straight to capturing it if it has no
 *  %^{Prompt} placeholders to fill in, otherwise shows the in-app
 *  prompt form first.
 * @param {import('../src/types.js').CaptureTemplate} template */
export async function openCapturePrompt(template) {
  await readClipboardIfUsed(template); // first, while the tap that chose the template still counts as a gesture
  const prompts = scanPrompts(template.template, templateContext());
  if (prompts.length === 0) {
    runCaptureWithAnswers(template, []);
    return;
  }
  S.capturePromptTemplate = template;
  S.capturePromptValues = prompts.map((p) => p.default || '');
  renderCapturePanel();
}

/** What a template can read besides the clock and its own answers: shared-in content, the clipboard, the running
 *  clock (%k, %K), the open file (%f, %F) and `user-full-name` (%n). */
function templateContext() {
  const running = findRunningClockAcrossSessions();
  const fullName = S.globalVariables && S.globalVariables['user-full-name'];
  return {
    shared: S.captureShared,
    clipboard: S.captureClipboard,
    userFullName: typeof fullName === 'string' ? fullName : '',
    clock: running ? { heading: running.heading.title, file: running.isActive ? S.state.documentId : (S.documentSessions.find((x) => x.tabId === running.tabId)?.state.documentId ?? '') } : null,
    originalFile: S.state.documentId || '',
  };
}

/**
 * Whether `text` uses a clipboard placeholder (%x, %c, %^C or %^L).
 * @param {string} text
 */
function usesClipboardToken(text) {
  return /%(?:[xc]|\^[CL])/.test(text);
}

/** Reads the clipboard into S.captureClipboard, but only for a template that has %x, so a template that does not
 *  never touches it (the browser may ask permission, and iOS shows a Paste confirmation). A refusal or failure
 * @param {import('../src/types.js').CaptureTemplate} template
 *  leaves them empty and says so, so the capture still goes ahead. */
async function readClipboardIfUsed(template) {
  S.captureClipboard = '';
  if (!usesClipboardToken(template.template)) return;
  try {
    S.captureClipboard = await platform.clipboard.readText();
  } catch {
    setStatus("Couldn't read the clipboard (allow pasting if asked), so the clipboard placeholders are empty.");
  }
}

/** Renders the in-app form for answering a template's %^{Prompt}
 *  placeholders -- one labeled input per prompt (completions, if any,
 *  shown as a hint under the field, matching what window.prompt's own
 *  message text used to fold in), Capture/Cancel at the bottom. */
export function renderCapturePromptForm() {
  const template = /** @type {import('../src/types.js').CaptureTemplate} */ (S.capturePromptTemplate);
  const prompts = scanPrompts(template.template, templateContext());
  const previewNow = new Date(); // captured once, not per-keystroke, so the displayed time doesn't visibly tick while typing

  const heading = document.createElement('div');
  heading.style.fontSize = '12px';
  heading.style.opacity = '0.65';
  heading.style.marginBottom = '8px';
  heading.textContent = template.key + ' \u2014 ' + template.description;
  capturePanelBox.appendChild(heading);

  const previewLabel = document.createElement('div');
  previewLabel.style.fontSize = '11px';
  previewLabel.style.opacity = '0.6';
  previewLabel.style.marginBottom = '2px';
  previewLabel.textContent = 'Preview:';
  capturePanelBox.appendChild(previewLabel);

  const preview = document.createElement('div');
  preview.style.fontFamily = 'ui-monospace, monospace';
  preview.style.fontSize = '13px';
  preview.style.whiteSpace = 'pre-wrap';
  preview.style.wordBreak = 'break-word';
  preview.style.background = 'var(--surface, #f6f6f6)';
  preview.style.border = '1px solid var(--border-strong)';
  preview.style.borderRadius = '6px';
  preview.style.padding = '8px 10px';
  preview.style.marginBottom = '12px';
  capturePanelBox.appendChild(preview);

  function updatePreview() {
    const context = { ...templateContext(), now: previewNow, promptAnswers: S.capturePromptValues };
    try {
      preview.textContent = expandTemplate(template.template, context).text;
    } catch (err) {
      preview.textContent = /** @type {Error} */ (err).message;
    }
  }
  updatePreview();

  /** @type {HTMLInputElement[]} */ const promptInputs = [];
  prompts.forEach((p, i) => {
    const field = document.createElement('div');
    field.style.marginBottom = '10px';

    const label = document.createElement('div');
    label.style.fontSize = '13px';
    label.style.marginBottom = '3px';
    label.textContent = p.prompt;
    field.appendChild(label);

    const input = document.createElement('input');
    input.type = 'text';
    input.value = S.capturePromptValues[i];
    input.style.width = '100%';
    input.style.boxSizing = 'border-box';
    input.style.fontSize = '15px';
    input.style.padding = '8px 10px';
    input.style.border = '1px solid var(--border-strong)';
    input.style.borderRadius = '6px';
    input.style.background = 'var(--bg)';
    input.style.color = 'var(--fg)';
    input.addEventListener('input', () => {
      S.capturePromptValues[i] = input.value;
      updatePreview();
    });
    field.appendChild(input);
    promptInputs.push(input);

    if (p.timestamp) {
      const pickerBtn = document.createElement('button');
      pickerBtn.textContent = '\ud83d\udcc5 Pick ' + (p.timestamp.hasTime ? 'date & time' : 'date');
      pickerBtn.style.marginTop = '4px';
      pickerBtn.style.fontSize = '13px';
      pickerBtn.style.padding = '6px 10px';
      pickerBtn.onclick = async () => {
        const result = await openTimestampPickerPopup(p.timestamp);
        if (result === null) return; // Cancel/Escape/backdrop -- the field itself is left exactly as it was
        input.value = result;
        S.capturePromptValues[i] = result;
        updatePreview();
      };
      field.appendChild(pickerBtn);
    }

    if (p.completions.length > 0) {
      const hint = document.createElement('div');
      hint.style.fontSize = '11px';
      hint.style.opacity = '0.6';
      hint.style.marginTop = '2px';
      hint.textContent = 'Options: ' + p.completions.join(', ');
      field.appendChild(hint);
    }

    capturePanelBox.appendChild(field);
    if (i === 0) input.focus();
  });

  const row = document.createElement('div');
  row.className = 'panel-row';
  row.appendChild(
    menuButton('Cancel', () => {
      S.capturePromptTemplate = null;
      if (S.captureOpenedFromExtraMenu) {
        S.captureOpenedFromExtraMenu = false;
        S.captureOpen = false;
      }
      setStatus('Capture cancelled.');
      renderCapturePanel();
    })
  );
  row.appendChild(
    menuButton('Reset', () => {
      S.capturePromptValues = prompts.map((p) => p.default || '');
      promptInputs.forEach((input, i) => (input.value = S.capturePromptValues[i]));
      updatePreview();
      promptInputs[0]?.focus();
    })
  );
  row.appendChild(
    menuButton('OK', () => {
      const answers = S.capturePromptValues.slice();
      runCaptureWithAnswers(template, answers);
    })
  );
  capturePanelBox.appendChild(row);
}

/**
 * @param {import('../src/types.js').CaptureTemplate} template
 * @param {string[]} [answers]
 */
export async function runCaptureWithAnswers(template, answers) {
  if (S.currentView === 'text') {
    // Same reasoning as search's own text-mode guard above: leaving text
    // mode reparses the document into new objects, so do it now, before
    // resolveOlpTarget below touches state.doc, not after.
    switchToView('org');
  }

  const now = new Date();
  const rawFile = String(template.file || '').trim();
  if (rawFile) {
    const { scheme } = getCaptureFileScheme(rawFile);
    if (scheme && !CAPTURE_FILE_SCHEMES.has(scheme)) {
      setStatus(`Can't capture: "${template.file}" starts with an unrecognized scheme ("${scheme}:") \u2014 only "github:", "webdav:" and "local:" are understood. Remove the prefix for a plain path, or fix the scheme name.`);
      renderCapturePanel();
      return;
    }
    if (scheme && storageKindForScheme(scheme) !== S.state.storageKind) {
      setStatus(
        `Can't capture: "${template.file}" targets ${scheme}, but the currently open document is on ${S.state.storageKind === 'github' ? 'GitHub' : S.state.storageKind === 'webdav' ? 'WebDAV' : S.state.storageKind === 'filesystem' ? 'a local file' : 'an imported file'} \u2014 capture can't switch backends. Remove the "${scheme}:" prefix to capture into a sibling file on the same backend as whatever's currently open instead.`
      );
      renderCapturePanel();
      return;
    }
  }

  const targetFileId = resolveCaptureFileId(template.file, S.state.documentId);

  if (targetFileId !== S.state.documentId) {
    // Cross-file capture: read/insert/write the OTHER file directly via
    // whichever backend the current document itself came from, without
    // touching state.doc or switching the active view at all -- matching
    // real org-capture's own behavior of not switching your current
    // buffer just because a template's target is elsewhere.
    setStatus(`Capturing to ${targetFileId}\u2026`);
    /** @type {any} */ let captured = null;
    const { ok } = await writeToOtherFile(targetFileId, {
      label: 'capture',
      historyLabel: `Captured: ${template.description}`,
      allowMissing: true,
      mutate: (doc) => {
        const result = captureInto(doc, template, { now, answers, context: templateContext(), place: (d) => placeOptions(template, d) });
        if (!result.ok) {
          setStatus(result.message);
          return null;
        }
        captured = result;
        return true;
      },
    });
    if (!ok) {
      renderCapturePanel();
      return;
    }

    setStatus(`Captured to ${targetFileId}${UNSAVED_NOTE}.`);
    if (template.jumpToCaptured && captured) {
      // :jump-to-captured t visits the other file's buffer, as Emacs does
      const tab = S.documentSessions.find((/** @type {any} */ x) => x.state && x.state.documentId === targetFileId);
      if (tab) {
        switchToTab(tab.tabId);
        showCaptured(template, captured);
      }
    }
    afterSuccessfulCapture();
    emitExtensionEvent('capture', { description: template.description || '', file: targetFileId, sameFile: false });
    return;
  }

  const result = captureInto(S.state.doc, template, { now, answers, context: templateContext(), place: (d) => placeOptions(template, d) });
  if (!result.ok) {
    setStatus(result.message);
    renderCapturePanel();
    return;
  }
  const { target } = result;
  commitAndRender(`Captured: ${template.description}`);

  const hasTarget = (template.olp || []).length || template.datetree || template.targetFunction;
  // Emacs returns to the buffer it came from after a capture; only :jump-to-captured t goes to the new entry
  if (template.jumpToCaptured) showCaptured(template, result);
  setStatus('Captured.');
  afterSuccessfulCapture();
  emitExtensionEvent('capture', { description: template.description || '', file: targetFileId, sameFile: true, heading: hasTarget && 'level' in target ? target : null });
}

/** Goes to what a capture just filed (:jump-to-captured t): the headings above it are opened and it is scrolled to, a table row included.
 * @param {import('../src/types.js').CaptureTemplate} template
 * @param {{ target: any, placed: any, reveal: any }} result */
function showCaptured(template, result) {
  const { target, placed, reveal } = result;
  switchToView('org');
  const hasTarget = (template.olp || []).length || template.datetree || template.targetFunction;
  const shown = hasTarget && 'level' in target ? target : placed && 'level' in placed ? placed : null;
  if (reveal) {
    if (reveal.heading) {
      for (const ancestor of findAncestorPath(S.state.doc, reveal.heading) || []) ancestor.collapsed = false;
      reveal.heading.collapsed = false;
    }
    const table = /** @type {import('../src/types.js').Table} */ (/** @type {unknown} */ (reveal.node));
    const line = reveal.row === null ? -1 : table.rows.slice(0, reveal.row).filter((r) => r.type === 'row').length;
    const within = reveal.row === null ? null : (/** @type {HTMLElement} */ rowEl) => /** @type {HTMLElement | undefined} */ (rowEl.querySelectorAll('tr')[line]) ?? null;
    const heading = /** @type {import('../src/types.js').Heading | null} */ (shown ?? reveal.heading);
    if (heading) navigateToHeading(heading, { revealOwnBody: true, targetNode: reveal.node, within });
    else scrollNodeIntoView(reveal.node, within);
  } else if (shown) navigateToHeading(/** @type {any} */ (shown), { revealOwnBody: true });
}

/** What a template says about how its text is filed: the blank lines around it, the table row, and the sums of a table it joins.
 * @param {import('../src/types.js').CaptureTemplate} template @param {import('../src/types.js').Doc} doc */
function placeOptions(template, doc) {
  return {
    emptyLines: template.emptyLines,
    emptyLinesBefore: template.emptyLinesBefore,
    emptyLinesAfter: template.emptyLinesAfter,
    tableLinePos: template.tableLinePos,
    recalculate: (/** @type {import('../src/types.js').Table} */ table) => {
      try {
        return recalculateTable(table, { hourZeroPad: getOrgTableDurationHourZeroPadding(S.state.localVariables), constants: parseTableConstants(doc), tables: parseNamedTables(doc), userCall: tableUserCall });
      } catch {
        return null;
      }
    },
  };
}

/** After a successful capture, the form always closes, returning to
 *  the template list -- captureOpen itself is untouched here, so the
 *  panel stays open on that list, which is how rapid multi-template
 *  capture actually works: tap the next template straight from the
 *  list, not a reopened copy of the same form. */
export function afterSuccessfulCapture() {
  S.capturePromptTemplate = null;
  if (S.captureOpenedFromExtraMenu) {
    S.captureOpenedFromExtraMenu = false;
    S.captureOpen = false;
  }
  renderCapturePanel();
}
