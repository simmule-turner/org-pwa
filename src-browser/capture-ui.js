// Extracted from app.js: capture ui.
import { CAPTURE_FILE_SCHEMES, computeNonCollidingKeys, expandCaptureText, expandTemplate, getCaptureFileScheme, insertCapture, resolveCaptureFileId, resolveOlpTarget, scanPrompts } from '../src/capture-template.js';
import { parseOrg } from '../src/org-parser.js';
import { S } from './app-state.js';
import { openTimestampPickerPopup, showModalOverlay } from './dialogs.js';
import { getOlpPrepend } from './doc-helpers.js';
import { capturePanel, capturePanelBox } from './dom.js';
import { commitAndRender, setStatus } from './editing.js';
import { activeDiskAdapter, writeToOtherFile } from './external-sync.js';
import { navigateToHeading } from './navigation.js';
import { getCaptureTemplates } from './settings.js';
import { agendaFilesCache, kv } from './singletons.js';
import { hideModalOverlay, menuButton } from './ui-widgets.js';
import { switchToView } from './views.js';

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

  const templates = await getCaptureTemplates(kv);
  if (!S.captureOpen) return; // panel was closed again before this resolved
  S.currentCaptureTemplates = templates;

  if (templates.length === 0) {
    const empty = document.createElement('div');
    empty.style.opacity = '0.6';
    empty.style.fontSize = '13px';
    empty.style.marginBottom = '8px';
    empty.textContent = 'No capture templates configured yet — add some in Settings.';
    capturePanelBox.appendChild(empty);
    const closeRow = document.createElement('div');
    closeRow.className = 'panel-row';
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

  const nonCollidingKeys = S.captureOpenedViaGodMode ? computeNonCollidingKeys(templates, (t) => t.key) : new Map();

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
    label.textContent = template.description;
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

/** For a table-line template with preText/postText defined, determines
 *  whether a table already exists at its own resolved target -- and
 *  so whether preText/postText (and their own %^{...} prompts) will
 *  actually be used this capture, or discarded. Returns:
 *    true  -- a table already exists there; preText/postText won't be
 *             used, so their own prompts shouldn't be asked
 *    false -- no table there yet (or the OLP path itself doesn't
 *             exist yet either); preText/postText WILL be used
 *    null  -- couldn't be determined without a real network fetch (a
 *             different file that isn't already the open document, an
 *             already-loaded agenda file, or a local file) -- callers
 *             should treat this the same as false (ask every prompt,
 *             so nothing's silently skipped) rather than block the
 *             capture form on I/O just to decide its own shape
 *
 *  Only ever resolves the target from what's ALREADY resident in
 *  memory or a fast local-disk read -- never triggers a fetch of a
 *  remote file that isn't already cached. Uses resolveOlpTarget's own
 *  allowCreate: false, which leaves the document completely untouched
 *  on a missing path rather than creating anything speculatively --
 *  this is purely a peek, not a real capture, so nothing should be
 *  left behind even if the person then cancels. */
export async function peekTableAlreadyExists(template) {
  const targetFileId = resolveCaptureFileId(template.file, S.state.documentId);

  let doc;
  if (targetFileId === S.state.documentId) {
    doc = S.state.doc;
  } else if (S.state.storageKind === 'filesystem' || S.state.storageKind === 'input') {
    try {
      const existing = await activeDiskAdapter().read(targetFileId);
      if (!existing) return null; // doesn't exist yet at all -- can't peek an OLP path in a document that isn't there; fall back to asking
      doc = parseOrg(existing.content);
    } catch {
      return null;
    }
  } else {
    const entry = Array.from(agendaFilesCache.values()).find((e) => e.documentId === targetFileId);
    doc = entry && entry.doc; // undefined if not cached, or cached as {error}/{loading} rather than {doc}
  }
  if (!doc) return null;

  const target = resolveOlpTarget(doc, template.olp, { now: new Date(), prepend: getOlpPrepend(template), allowCreate: false });
  if (!target) return false; // the heading path itself doesn't exist yet -- definitely no table under it either
  const existingTable = [...target.body].reverse().find((n) => n.type === 'table');
  return !!existingTable;
}

/** Opens the given template: straight to capturing it if it has no
 *  %^{Prompt} placeholders to fill in, otherwise shows the in-app
 *  prompt form first. For a table-line template with preText/postText,
 *  first peeks (see peekTableAlreadyExists) whether a table already
 *  exists at the target, so a form-only-used-once prompt isn't asked
 *  on every subsequent capture when that can be determined cheaply;
 *  the decision is captured once, in capturePromptSkipPrePost, and
 *  reused unchanged through to the actual commit. */
export async function openCapturePrompt(template) {
  const hasPrePost = template.type === 'table-line' && (template.preText || template.postText);
  const skipPrePost = hasPrePost ? (await peekTableAlreadyExists(template)) === true : false;
  S.capturePromptSkipPrePost = skipPrePost;

  const scanText = skipPrePost ? template.template : (template.preText || '') + template.template + (template.postText || '');
  const prompts = scanPrompts(scanText);
  if (prompts.length === 0) {
    runCaptureWithAnswers(template, []);
    return;
  }
  S.capturePromptTemplate = template;
  S.capturePromptValues = prompts.map((p) => p.default || '');
  renderCapturePanel();
}

/** Renders the in-app form for answering a template's %^{Prompt}
 *  placeholders -- one labeled input per prompt (completions, if any,
 *  shown as a hint under the field, matching what window.prompt's own
 *  message text used to fold in), Capture/Cancel at the bottom. */
export function renderCapturePromptForm() {
  const template = S.capturePromptTemplate;
  const scanText = S.capturePromptSkipPrePost ? template.template : (template.preText || '') + template.template + (template.postText || '');
  const prompts = scanPrompts(scanText);
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
    const context = { now: previewNow, promptAnswers: S.capturePromptValues };
    if (S.capturePromptSkipPrePost) {
      const { text } = expandTemplate(template.template, context);
      preview.textContent = text;
    } else {
      const { preText, text, postText } = expandCaptureText(template.preText, template.template, template.postText, context);
      preview.textContent = template.type === 'table-line' ? [preText, text, postText].filter(Boolean).join('\n') : preText + text + postText;
    }
  }
  updatePreview();

  const promptInputs = [];
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

export async function runCaptureWithAnswers(template, answers) {
  if (S.currentView === 'text') {
    // Same reasoning as search's own text-mode guard above: leaving text
    // mode reparses the document into new objects, so do it now, before
    // resolveOlpTarget below touches state.doc, not after.
    switchToView('org');
  }

  const now = new Date();
  // capturePromptSkipPrePost is the SAME decision openCapturePrompt used
  // to build the prompt list `answers` was collected against -- reused
  // here unchanged (never re-derived) so promptAnswers indices stay
  // correctly aligned with what was actually asked. When true, preText/
  // postText are passed as empty strings to expandCaptureText below --
  // NOT omitted from insertCapture entirely, since insertCapture itself
  // always freshly re-checks whether a table already exists regardless
  // of what the peek guessed, and correctly ignores empty pre/post text
  // either way.
  const preTextSrc = S.capturePromptSkipPrePost ? '' : template.preText || '';
  const postTextSrc = S.capturePromptSkipPrePost ? '' : template.postText || '';

  const rawFile = String(template.file || '').trim();
  if (rawFile) {
    const { scheme } = getCaptureFileScheme(rawFile);
    if (scheme && !CAPTURE_FILE_SCHEMES.has(scheme)) {
      setStatus(`Can't capture: "${template.file}" starts with an unrecognized scheme ("${scheme}:") \u2014 only "github:" and "webdav:" are understood. Remove the prefix for a plain path, or fix the scheme name.`);
      renderCapturePanel();
      return;
    }
    if (scheme && scheme !== S.state.storageKind) {
      setStatus(
        `Can't capture: "${template.file}" targets ${scheme}, but the currently open document is on ${S.state.storageKind === 'github' ? 'GitHub' : S.state.storageKind === 'webdav' ? 'WebDAV' : S.state.storageKind} \u2014 capture can't switch backends. Remove the "${scheme}:" prefix to capture into a sibling file on the same backend as whatever's currently open instead.`
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
    const { ok } = await writeToOtherFile(targetFileId, {
      label: 'capture',
      allowMissing: true,
      mutate: (doc) => {
        const target = resolveOlpTarget(doc, template.olp, { now, prepend: getOlpPrepend(template) });
        let tableRowNumber = null;
        if (template.type === 'table-line') {
          const existingTable = [...target.body].reverse().find((n) => n.type === 'table');
          const dataRowCount = existingTable ? existingTable.rows.filter((r) => r.type === 'row').length : 0;
          // @# reflects the row's ACTUAL final position -- 1 (the new first
          // data row) when prepending to an existing table, dataRowCount + 1
          // (the next row after every existing one) when appending, the
          // table's own default.
          tableRowNumber = template.prepend && existingTable ? 1 : dataRowCount + 1;
        }
        const { preText, text, postText } = expandCaptureText(preTextSrc, template.template, postTextSrc, { now, promptAnswers: answers, tableRowNumber });
        insertCapture(target, template.type, text, template.prepend, template.omitEmptyEntries, preText, postText);
        return true;
      },
    });
    if (!ok) {
      renderCapturePanel();
      return;
    }

    setStatus(`Captured to ${targetFileId}.`);
    afterSuccessfulCapture();
    return;
  }

  const target = resolveOlpTarget(S.state.doc, template.olp, { now, prepend: getOlpPrepend(template) });

  let tableRowNumber = null;
  if (template.type === 'table-line') {
    const existingTable = [...target.body].reverse().find((n) => n.type === 'table');
    const dataRowCount = existingTable ? existingTable.rows.filter((r) => r.type === 'row').length : 0;
    // @# reflects the row's ACTUAL final position -- 1 (the new first
    // data row) when prepending to an existing table, dataRowCount + 1
    // (the next row after every existing one) when appending, the
    // table's own default.
    tableRowNumber = template.prepend && existingTable ? 1 : dataRowCount + 1;
  }

  const { preText, text, postText } = expandCaptureText(preTextSrc, template.template, postTextSrc, {
    now,
    promptAnswers: answers,
    tableRowNumber,
  });

  insertCapture(target, template.type, text, template.prepend, template.omitEmptyEntries, preText, postText);
  commitAndRender(`Captured: ${template.description}`);

  switchToView('org');
  navigateToHeading(target, { revealOwnBody: true });
  setStatus('Captured.');
  afterSuccessfulCapture();
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
