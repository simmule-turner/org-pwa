// Extracted from app.js: attachments flow.
import { getProperty, setProperty } from '../src/archive-model.js';
import { attachmentPath, disambiguateAttachmentFilename, formatAttachmentLink, generateAttachmentId, listAttachments, removeAttachmentLink, sanitizeAttachmentFilename } from '../src/attach.js';
import { parseBody } from '../src/body-parser.js';
import { guessImageMimeType, guessViewableMimeType, resolveAttachmentTarget } from '../src/link-resolve.js';
import { detectWebmHasVideoTrack } from '../src/webm-track-detect.js';
import { S } from './app-state.js';
import { openAudioRecordingPanel } from './audio-recording.js';
import { confirmDialog, openButtonChoiceModal, pickBinaryFile, showModalOverlay } from './dialogs.js';
import { refilePanel, refilePanelBox } from './dom.js';
import { attachmentsAvailable, attachmentsFolderMissingMessage, ensureAttachmentsStorage } from './attachments-store.js';
import { commitAndRender, setStatus } from './editing.js';
import { activeDiskAdapter } from './external-sync.js';
import { guessAnyAttachmentMimeType } from './render-helpers.js';
import { render } from './render.js';
import { imageDataUrlCache } from './singletons.js';
import { hideModalOverlay, menuButton } from './ui-widgets.js';
import { base64ToArrayBuffer } from './webdav-adapter.js';
import { platform } from './platform.js';
import { saveOut } from './save-out.js';

/** Attaches a picked file to `heading` -- this app's own extension,
 *  inspired by real org's own org-attach (see src/attach.js's own
 *  header comment for the honest caveat on how closely the folder
 *  convention actually matches). Only works on GitHub/WebDAV, the
 *  same "arbitrary file write needs a backend that can do that
 *  without a fresh picker gesture per file" reasoning this app's own
 *  Agenda Files and cross-file archive/refile already established --
 *  a local (File System Access) or iOS-import file has no equivalent
 *  capability, so this refuses up front with a clear explanation
 *  rather than attempting something that can't actually succeed.
 *
 * Generates a heading's own :ID: property the first time it's ever
 * attached to (reused for every attachment after that, so they all
 * land in the same per-heading folder rather than a fresh one each
 * time); computes the attachment's own data/<prefix>/<rest>/<filename>
 * path from that ID; uploads the picked file's raw bytes; and appends
 * a real org attachment: link -- real org-attach's own actual link
 * type -- to the heading's own body (bare for an image, so it
 * displays inline; with the filename as its own description
 * otherwise), so it's immediately usable like any other link in this
 * app. No capture hint on the picker -- the general file-picker sheet
 * on both iOS and Android already offers the camera as one of its own
 * options, so a separate, dedicated camera-only entry point isn't
 * needed here.
 */
export async function attachFileToHeading(heading) {
  const storage = await ensureAttachmentsStorage(); // a local document asks for its attachments folder here, once
  if (storage === 'cancelled') return; // the person backed out of choosing it
  if (storage !== 'ok') {
    setStatus(
      "Attachments need automatic file-write access \u2014 only available with GitHub or WebDAV connected (a local file needs a fresh picker gesture per file, which browser security doesn't allow this app to do on its own for a brand-new attachment file). Connect GitHub or WebDAV in Settings first."
    );
    render();
    return;
  }

  let picked;
  try {
    picked = await pickBinaryFile();
  } catch {
    return; // no file selected -- silently do nothing, matching every other cancel-a-picker path in this app
  }

  await uploadAttachmentToHeading(heading, picked);
}

/** The actual upload/link-insertion core attachFileToHeading uses once
 *  it has a `{ name, type, base64 }` file in hand -- factored out so
 *  the audio-recording flow (which already has bytes ready, no file
 *  picker involved at all) can share this exact same logic rather
 *  than a second, separately-maintained copy of it. Same backend-
 *  availability assumption as attachFileToHeading's own caller-side
 *  check (this itself doesn't re-check, since both current callers
 *  already have): only ever called once GitHub/WebDAV is confirmed
 *  connected. */
export async function uploadAttachmentToHeading(heading, picked) {
  setStatus('Uploading attachment\u2026');
  render();

  let id = getProperty(heading, 'ID');
  if (!id) {
    id = generateAttachmentId();
    setProperty(heading, 'ID', id);
  }

  const filename = disambiguateAttachmentFilename(sanitizeAttachmentFilename(picked.name), listAttachments(heading));
  const path = attachmentPath(id, filename, S.state.documentId);

  try {
    const adapter = activeDiskAdapter();
    await adapter.writeBinary(path, picked.base64);
  } catch (err) {
    setStatus(`Could not attach "${filename}": ${err.message}`);
    render();
    return;
  }

  // Avoid immediately re-downloading the exact bytes just uploaded --
  // the heading's own re-render below will try to display this
  // attachment inline (if it's an image and inline images are on),
  // and without this, that would mean a full second network fetch of
  // content already sitting right here in memory.
  imageDataUrlCache.set(`${S.state.storageKind}:${path}`, `data:${guessImageMimeType(path)};base64,${picked.base64}`);

  heading.bodyLines.push(formatAttachmentLink(filename));
  heading.body = parseBody(heading.bodyLines);

  setStatus(`Attached "${filename}".`);
  commitAndRender(`Attached "${filename}"`);
}

/** Downloads a non-image attachment: link's own actual file -- what
 *  tapping one does, since (unlike a file:/github:/webdav: link)
 *  there's no sensible "navigate into this as an org document"
 *  action for a PDF, a photo, or any other binary attachment; a real
 *  browser download is the correct action instead, the same
 *  mechanism export already uses via downloadFile. `target` is the
 *  link's own full "attachment:filename" text; `heading` is whichever
 *  heading this link's own body content belongs to (see
 *  renderInlineNodes' own heading-threading docs), needed to resolve
 *  which :ID: actually owns this attachment, matching the exact same
 *  ancestor-chain lookup the inline-image case already uses. */
/** The shared core both saveAttachmentLink and openAttachmentLink use:
 *  confirms a backend that can actually read an attachment is
 *  connected, resolves `target`'s own real storage path, and fetches
 *  the actual bytes. Returns `{ filename, resolvedPath, result }` on
 *  success; on any failure, has already called setStatus/render with
 *  a clear explanation itself and returns null, so both callers can
 *  just check for that and return early rather than duplicating each
 *  of these three failure cases (and their own explanatory messages)
 *  a second time. */
export async function resolveAndReadAttachment(target, heading) {
  const filename = target.replace(/^attachment:/i, '');
  if (!attachmentsAvailable()) {
    setStatus(
      attachmentsFolderMissingMessage() ||
        "Can't access this attachment \u2014 only available with GitHub or WebDAV connected, the same backends attachments themselves are only ever stored on."
    );
    render();
    return null;
  }
  const resolvedPath = resolveAttachmentTarget(S.state.doc, heading, target, S.state.documentId);
  if (!resolvedPath) {
    setStatus("Can't resolve this attachment \u2014 no heading in its own ancestor chain has an :ID: property.");
    render();
    return null;
  }
  try {
    const adapter = activeDiskAdapter();
    const result = await adapter.readBinary(resolvedPath);
    if (!result) {
      setStatus(`Attachment "${filename}" not found at ${resolvedPath}.`);
      render();
      return null;
    }
    return { filename, resolvedPath, result };
  } catch (err) {
    setStatus(`Could not access "${filename}": ${err.message}`);
    render();
    return null;
  }
}

/** Downloads `target` to the device -- unconditionally, regardless of
 *  file type, the actual behavior "Open" used to have before this
 *  fix, moved here and given its own honest name now that Open itself
 *  means something different. */
export async function saveAttachmentLink(target, heading) {
  setStatus('Downloading attachment\u2026');
  render();
  const attachment = await resolveAndReadAttachment(target, heading);
  if (!attachment) return;
  const { filename, resolvedPath, result } = attachment;
  saveOut(filename, base64ToArrayBuffer(result.base64), guessAnyAttachmentMimeType(resolvedPath));
  setStatus(`Downloaded "${filename}".`);
  render();
}

/** THE FIX: tries to actually VIEW `target` -- opening a new tab with
 *  the browser's own native viewer (a PDF's own built-in renderer,
 *  native video playback, or plain text shown as-is -- see
 *  guessViewableMimeType's own docs in link-resolve.js for exactly
 *  which types, and why HTML/SVG are deliberately excluded) --
 *  falling back to the exact same download behavior saveAttachmentLink
 *  has only when no viewer is available for the file type at all,
 *  since there's nothing else useful to do with it. */
export async function openAttachmentLink(target, heading) {
  setStatus('Opening attachment\u2026');
  render();
  const attachment = await resolveAndReadAttachment(target, heading);
  if (!attachment) return;
  const { filename, resolvedPath, result } = attachment;
  let viewableMimeType = guessViewableMimeType(resolvedPath);
  if (/\.webm$/i.test(resolvedPath)) {
    // .webm is genuinely ambiguous (a legitimate container for both
    // audio-only and audio+video content) -- guessViewableMimeType's
    // own default here is a heuristic (this app's own recording
    // feature usually produces audio-only .webm), not a real answer.
    // The file's own actual content has the real answer, so read it
    // directly rather than continuing to guess.
    const hasVideo = detectWebmHasVideoTrack(new Uint8Array(base64ToArrayBuffer(result.base64)));
    if (hasVideo === true) viewableMimeType = 'video/webm';
    else if (hasVideo === false) viewableMimeType = 'audio/webm';
    // hasVideo === null (couldn't determine) -- keep the existing heuristic result rather than guessing differently
  }
  if (!viewableMimeType) {
    saveOut(filename, base64ToArrayBuffer(result.base64), guessAnyAttachmentMimeType(resolvedPath));
    setStatus(`No viewer available for "${filename}" \u2014 downloaded instead.`);
    render();
    return;
  }
  const blob = new Blob([base64ToArrayBuffer(result.base64)], { type: viewableMimeType });
  try {
    await platform.viewFile(blob, filename); // a browser opens it at once; a native shell may find no app that can
    setStatus(`Opened "${filename}".`);
  } catch (error) {
    setStatus(`Couldn't open "${filename}": ${error && error.message ? error.message : error}`);
  }
  render();
}

/** Deletes `filename` from `heading`'s own attachments -- both the
 *  underlying file on the backend (via the storage adapter's own
 *  delete) and the [[attachment:...]] link referencing it in the
 *  heading's own body text (via removeAttachmentLink). The backend
 *  delete happens first: if it fails, the in-document link is left
 *  alone too, rather than ending up in a state where the app thinks
 *  the attachment is gone but the actual file is still sitting on
 *  GitHub/WebDAV. */
export async function deleteAttachment(heading, filename) {
  if (!attachmentsAvailable()) {
    setStatus(
      attachmentsFolderMissingMessage() ||
        "Can't delete this attachment \u2014 only available with GitHub or WebDAV connected, the same backends attachments themselves are only ever stored on."
    );
    render();
    return;
  }
  const resolvedPath = resolveAttachmentTarget(S.state.doc, heading, `attachment:${filename}`, S.state.documentId);
  if (!resolvedPath) {
    setStatus("Can't resolve this attachment \u2014 no heading in its own ancestor chain has an :ID: property.");
    render();
    return;
  }
  setStatus('Deleting attachment\u2026');
  render();
  try {
    const adapter = activeDiskAdapter();
    await adapter.delete(resolvedPath);
  } catch (err) {
    setStatus(`Could not delete "${filename}": ${err.message}`);
    render();
    return;
  }
  removeAttachmentLink(heading, filename);
  heading.body = parseBody(heading.bodyLines);
  setStatus(`Deleted "${filename}".`);
  commitAndRender(`Deleted "${filename}"`);
}

export function openAttachChoicePrompt(heading) {
  openButtonChoiceModal({
    label: `Attachments for "${heading.title || '(untitled)'}"`,
    buttons: [
      { text: '\ud83d\udcce Attach a file', onClick: () => attachFileToHeading(heading) },
      { text: '\ud83c\udfa4 Record audio', onClick: () => openAudioRecordingPanel(heading) },
      { text: '\ud83d\udcc2 Open', onClick: () => startAttachmentPickFlow(heading, 'open') },
      { text: '\ud83d\udcbe Save', onClick: () => startAttachmentPickFlow(heading, 'save') },
      { text: '\ud83d\uddd1\ufe0f Delete', onClick: () => startAttachmentPickFlow(heading, 'delete') },
      { text: 'Cancel', onClick: () => {} },
    ],
  });
}

/** Shared entry point for Open and Delete: enumerates `heading`'s own
 *  attachments (listAttachments) and either acts directly (0 or
 *  exactly 1 attachment -- nothing to disambiguate) or opens the
 *  file-list picker (more than one), matching org-attach's own actual
 *  "if there's more than one, prompt for a file name first" behavior
 *  for org-attach-open, applied identically to delete too since the
 *  same ambiguity exists there. */
export function startAttachmentPickFlow(heading, action) {
  const filenames = listAttachments(heading);
  if (filenames.length === 0) {
    setStatus('No attachments on this heading yet.');
    render();
    return;
  }
  if (filenames.length === 1) {
    performAttachmentAction(heading, filenames[0], action);
    return;
  }
  S.pendingAttachFileList = { heading, filenames, action };
  renderAttachFileListPanel();
}

/** The "which attachment?" picker, shown only when Open/Delete found
 *  more than one on the heading -- one button per filename, tapping
 *  it performs whichever action (`open`/`delete`) this flow started
 *  as. */
export function renderAttachFileListPanel() {
  refilePanelBox.innerHTML = '';
  if (!S.pendingAttachFileList) {
    hideModalOverlay(refilePanel);
    return;
  }
  showModalOverlay(refilePanel);
  const { heading, filenames, action } = S.pendingAttachFileList;

  const label = document.createElement('div');
  label.style.fontSize = '13px';
  label.style.marginBottom = '8px';
  label.textContent = `${action === 'delete' ? 'Delete' : action === 'save' ? 'Save' : 'Open'} which attachment?`;
  refilePanelBox.appendChild(label);

  const row = document.createElement('div');
  row.className = 'panel-row';
  for (const filename of filenames) {
    row.appendChild(
      menuButton(filename, () => {
        S.pendingAttachFileList = null;
        renderAttachFileListPanel();
        performAttachmentAction(heading, filename, action);
      })
    );
  }
  row.appendChild(
    menuButton('Cancel', () => {
      S.pendingAttachFileList = null;
      renderAttachFileListPanel();
    })
  );
  refilePanelBox.appendChild(row);
}

/** Dispatches to the actual open/delete implementation once a single
 *  attachment has been settled on -- either because there was only
 *  ever one, or because the file-list picker resolved the ambiguity.
 *  Delete always confirms first, matching every other destructive
 *  action in this app; Open never does, since downloading a file (or
 *  viewing it, if the browser handles that download itself) isn't
 *  destructive. */
export async function performAttachmentAction(heading, filename, action) {
  if (action === 'delete') {
    if (!(await confirmDialog(`Delete attachment "${filename}"? This removes the actual file, not just the link to it.`))) return;
    deleteAttachment(heading, filename);
  } else if (action === 'save') {
    saveAttachmentLink(`attachment:${filename}`, heading);
  } else {
    openAttachmentLink(`attachment:${filename}`, heading);
  }
}
