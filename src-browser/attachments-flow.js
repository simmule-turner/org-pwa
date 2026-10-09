// Extracted from app.js: attachments flow.
import { deleteProperty, getProperty, setProperty } from '../src/archive-model.js';
import { addAttachTag, attachmentSizeCheck, attachmentDir, prefersInAppCamera, attachmentDirFromProperty, ownAttachmentDirectory, disambiguateAttachmentFilename, formatAttachmentLink, generateAttachmentId, removeAttachmentLink, removeAttachTag, sanitizeAttachmentFilename, shouldInsertAttachmentLink } from '../src/attach.js';
import { parseBody } from '../src/body-parser.js';
import { serializeOrg } from '../src/org-parser.js';
import { guessImageMimeType, guessViewableMimeType, resolveAttachmentDirectory, resolveAttachmentTarget } from '../src/link-resolve.js';
import { detectWebmHasVideoTrack } from '../src/webm-track-detect.js';
import { S } from './app-state.js';
import { openAudioRecordingPanel } from './audio-recording.js';
import { confirmDialog, openButtonChoiceModal, openGridChoiceModal, openMultiFieldPopup, openTextFieldPopup, pickBinaryFile, pickBinaryFiles, showModalOverlay } from './dialogs.js';
import { showAttachmentFolder } from './attach-folder-panel.js';
import { cameraAvailable, openCameraPanel } from './camera-capture.js';
import { utf8ToBase64 } from './github-adapter.js';
import { showAttachmentPreview } from './attach-preview.js';
import { getAttachLinkMode } from './settings.js';
import { refilePanel, refilePanelBox } from './dom.js';
import { attachmentsAvailable, attachmentsFolderMissingMessage, ensureAttachmentsStorage } from './attachments-store.js';
import { commitAndRender, setStatus } from './editing.js';
import { activeDiskAdapter } from './external-sync.js';
import { guessAnyAttachmentMimeType } from './render-helpers.js';
import { render } from './render.js';
import { imageDataUrlCache, kv } from './singletons.js';
import { hideModalOverlay, menuButton } from './ui-widgets.js';
import { base64ToArrayBuffer } from './webdav-adapter.js';
import { platform } from './platform.js';
import { saveOut } from './save-out.js';

/** Whether attachments can be written for the open document, asking for the org-pwa folder first when that is all that is missing.
 *  Says why, and returns false, when they cannot. */
async function requireAttachmentStorage() {
  const storage = await ensureAttachmentsStorage(); // a local document asks for its attachments folder here, once
  if (storage === 'cancelled') return false; // the person backed out of choosing it
  if (storage !== 'ok') {
    setStatus(
      "Attachments need automatic file-write access \u2014 only available with GitHub or WebDAV connected (a local file needs a fresh picker gesture per file, which browser security doesn't allow this app to do on its own for a brand-new attachment file). Connect GitHub or WebDAV in Settings first."
    );
    render();
    return false;
  }
  return true;
}

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
  if (!(await requireAttachmentStorage())) return;

  // A Chromebook or desktop browser has no camera in its file chooser, so Attach asks which first; a phone's own chooser has it.
  if (!platform.pickFile && prefersInAppCamera(navigator.userAgent, navigator.maxTouchPoints) && (await cameraAvailable())) {
    openButtonChoiceModal({
      label: `Attach to "${heading.title || '(untitled)'}"`,
      buttons: [
        { text: 'Choose a file', onClick: () => pickAndUpload(heading) },
        { text: 'Take a photo', onClick: () => openCameraPanel('photo', (picked) => uploadAttachmentToHeading(heading, picked)) },
        { text: 'Record a video', onClick: () => openCameraPanel('video', (picked) => uploadAttachmentToHeading(heading, picked)) },
        { text: 'Cancel', onClick: () => {} },
      ],
    });
    return;
  }
  await pickAndUpload(heading);
}

async function pickAndUpload(heading) {
  let picked;
  try {
    // a shell may offer the camera beside the files; the browser's chooser takes several at once
    picked = await (platform.pickFile ? platform.pickFile() : pickBinaryFiles());
  } catch {
    return; // no file selected -- silently do nothing, matching every other cancel-a-picker path in this app
  }
  for (const file of Array.isArray(picked) ? picked : [picked]) await uploadAttachmentToHeading(heading, file);
}

/** The file names in an attachment folder (sorted), or null if the backend could not say. A folder that does not exist yet is an
 *  empty one. This is where org-attach gets its list: the folder, not links in the text. */
async function listFolder(dir) {
  try {
    const entries = await activeDiskAdapter().list(dir);
    return entries.filter((entry) => entry.type === 'file').map((entry) => entry.name).sort((a, b) => a.localeCompare(b));
  } catch {
    return null;
  }
}

const unavailable = (what) =>
  attachmentsFolderMissingMessage() ||
  `Can't ${what} \u2014 attachments are only available with GitHub or WebDAV connected, the same backends they are stored on.`;

/** The attachments of `heading`, read from its folder. Returns the names, or null after saying why it could not. */
export async function attachmentFiles(heading) {
  if (!attachmentsAvailable()) {
    setStatus(unavailable('list attachments'));
    render();
    return null;
  }
  const dir = resolveAttachmentDirectory(S.state.doc, heading, S.state.documentId);
  if (!dir) return []; // no :ID: anywhere above: nothing has been attached
  const names = await listFolder(dir);
  if (!names) {
    setStatus("Couldn't read the attachment folder.");
    render();
  }
  return names;
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
  const tooBig = attachmentSizeCheck(String(picked.base64 || '').length, S.state.storageKind);
  if (tooBig && tooBig.refuse) {
    setStatus(tooBig.refuse);
    render();
    return;
  }
  if (tooBig && tooBig.warn && !(await confirmDialog(tooBig.warn, { confirmLabel: 'Attach', danger: false }))) return;
  setStatus('Uploading attachment\u2026');
  render();

  let dir = ownAttachmentDirectory(heading, S.state.documentId); // its DIR, else its ID's folder
  if (!dir) {
    const id = generateAttachmentId();
    setProperty(heading, 'ID', id);
    dir = attachmentDir(id, S.state.documentId);
  }

  const existingNames = (await listFolder(dir)) || [];
  const filename = disambiguateAttachmentFilename(sanitizeAttachmentFilename(picked.name), existingNames);
  const path = `${dir}/${filename}`;

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

  addAttachTag(heading); // org-attach-auto-tag
  if (shouldInsertAttachmentLink(filename, await getAttachLinkMode(kv))) {
    heading.bodyLines.push(formatAttachmentLink(filename));
    heading.body = parseBody(heading.bodyLines);
  }

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
  const bytes = base64ToArrayBuffer(result.base64);
  const viewableMimeType = viewableMimeFor(resolvedPath, bytes);
  // a picture, recording, video or text file is shown inside the app (org-attach-open-in-emacs); anything else goes to the viewer
  if (showAttachmentPreview(filename, viewableMimeType || guessImageMimeType(resolvedPath), bytes)) {
    setStatus(`Opened "${filename}".`);
    render();
    return;
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
  const remaining = await listFolder(resolveAttachmentDirectory(S.state.doc, heading, S.state.documentId));
  if (remaining && remaining.length === 0) removeAttachTag(heading);
  setStatus(`Deleted "${filename}".`);
  commitAndRender(`Deleted "${filename}"`);
}

/** org-attach-delete-all: every file in the heading's folder, after one confirmation, then the links to them and the ATTACH tag.
 *  A backend with no folder delete (GitHub) removes them one at a time. */
export async function deleteAllAttachments(heading) {
  const names = await attachmentFiles(heading);
  if (!names) return;
  if (names.length === 0) {
    setStatus('No attachments on this heading yet.');
    render();
    return;
  }
  const label = names.length === 1 ? `"${names[0]}"` : `all ${names.length} attachments`;
  if (!(await confirmDialog(`Delete ${label}? This removes the actual files, not just the links to them.`))) return;
  setStatus('Deleting attachments\u2026');
  render();
  const dir = resolveAttachmentDirectory(S.state.doc, heading, S.state.documentId);
  const adapter = activeDiskAdapter();
  let deleted = 0;
  let failure = null;
  for (const name of names) {
    try {
      await adapter.delete(`${dir}/${name}`);
      removeAttachmentLink(heading, name);
      deleted++;
    } catch (err) {
      failure = err;
      break;
    }
  }
  heading.body = parseBody(heading.bodyLines);
  if (deleted === names.length) removeAttachTag(heading);
  setStatus(failure ? `Deleted ${deleted} of ${names.length}; then: ${failure.message}` : `Deleted ${deleted} attachment${deleted === 1 ? '' : 's'}.`);
  commitAndRender(`Deleted ${deleted} attachment${deleted === 1 ? '' : 's'}`);
}

/** The type a viewer should be told: guessViewableMimeType's answer, with a .webm settled by its content (audio or video). */
function viewableMimeFor(path, bytes) {
  let mime = guessViewableMimeType(path);
  if (/\.webm$/i.test(path)) {
    const hasVideo = detectWebmHasVideoTrack(new Uint8Array(bytes));
    if (hasVideo === true) mime = 'video/webm';
    else if (hasVideo === false) mime = 'audio/webm';
  }
  return mime;
}

// ---- phase 2: DIR, sync, the folder list, and files made in the app -------------------------------------------------------

/** Sets the ATTACH tag to match what is in the heading's folder (org-attach-sync): on if there are files, off if not. Returns the
 *  number of files, or null if the folder could not be read or the heading has none. */
async function syncAttachTag(heading) {
  const dir = resolveAttachmentDirectory(S.state.doc, heading, S.state.documentId);
  if (!dir) {
    removeAttachTag(heading);
    return 0;
  }
  const names = await listFolder(dir);
  if (!names) return null;
  if (names.length > 0) addAttachTag(heading);
  else removeAttachTag(heading);
  return names.length;
}

/** org-attach-sync: for files added to the folder by other means, or removed from it. */
export async function syncAttachments(heading) {
  if (!attachmentsAvailable()) {
    setStatus(unavailable('sync attachments'));
    render();
    return;
  }
  const count = await syncAttachTag(heading);
  if (count === null) {
    setStatus("Couldn't read the attachment folder.");
    render();
    return;
  }
  const message = count === 0 ? 'No attachments: the ATTACH tag is off.' : `${count} attachment${count === 1 ? '' : 's'}: the ATTACH tag is on.`;
  setStatus(message);
  commitAndRender(message);
}

/** org-attach-set-directory: names the folder by a DIR property instead of the ID. */
export function setAttachmentDirectory(heading) {
  openMultiFieldPopup({
    label: 'Attachment folder (DIR)',
    fields: [{ key: 'dir', label: 'Folder, relative to this file (start with / for the root)', type: 'text', value: getProperty(heading, 'DIR') || '', placeholder: 'e.g. files/report' }],
    onSave: async (values) => {
      const dir = attachmentDirFromProperty(values.dir, S.state.documentId);
      if (!dir) {
        setStatus('That is not a folder I can use (no empty names, "..", or backslashes).');
        render();
        return;
      }
      setProperty(heading, 'DIR', values.dir.trim());
      await syncAttachTag(heading);
      setStatus(`Attachments for this heading are now in ${dir}.`);
      commitAndRender(`Set attachment folder ${dir}`);
    },
  });
}

/** Copies every file in `from` to `to` and removes the original, one at a time. Returns how many moved. */
async function moveFolderFiles(from, to) {
  const adapter = activeDiskAdapter();
  const names = (await listFolder(from)) || [];
  let moved = 0;
  for (const name of names) {
    const file = await adapter.readBinary(`${from}/${name}`);
    if (!file) continue;
    await adapter.writeBinary(`${to}/${name}`, file.base64);
    await adapter.delete(`${from}/${name}`);
    moved++;
  }
  return moved;
}

/** org-attach-unset-directory: removes DIR. With files in that folder, asks what to do with them, as org does: move them to the
 *  ID's folder, delete them, or leave them where they are. */
export async function unsetAttachmentDirectory(heading) {
  if (!getProperty(heading, 'DIR')) {
    setStatus('This heading has no DIR property.');
    render();
    return;
  }
  const dir = attachmentDirFromProperty(getProperty(heading, 'DIR'), S.state.documentId);
  const names = dir && attachmentsAvailable() ? (await listFolder(dir)) || [] : [];
  const finish = async (message) => {
    deleteProperty(heading, 'DIR');
    await syncAttachTag(heading);
    setStatus(message);
    commitAndRender(message);
  };
  if (names.length === 0) {
    await finish('Removed the DIR property.');
    return;
  }
  const count = `${names.length} file${names.length === 1 ? '' : 's'}`;
  openButtonChoiceModal({
    label: `Remove DIR: what about the ${count} in ${dir}?`,
    buttons: [
      {
        text: 'Move them to the ID folder',
        onClick: async () => {
          let id = getProperty(heading, 'ID');
          if (!id) {
            id = generateAttachmentId();
            setProperty(heading, 'ID', id);
          }
          try {
            const moved = await moveFolderFiles(dir, attachmentDir(id, S.state.documentId));
            await finish(`Moved ${moved} file${moved === 1 ? '' : 's'} to the ID folder and removed DIR.`);
          } catch (err) {
            setStatus(`Could not move the files: ${err.message}`);
            render();
          }
        },
      },
      {
        text: 'Delete them',
        onClick: async () => {
          if (!(await confirmDialog(`Delete ${count} in ${dir}? This removes the actual files.`))) return;
          try {
            const adapter = activeDiskAdapter();
            for (const name of names) await adapter.delete(`${dir}/${name}`);
            for (const name of names) removeAttachmentLink(heading, name);
            heading.body = parseBody(heading.bodyLines);
            await finish(`Deleted ${count} and removed DIR.`);
          } catch (err) {
            setStatus(`Could not delete the files: ${err.message}`);
            render();
          }
        },
      },
      { text: 'Leave them in place', onClick: () => finish(`Removed DIR; the ${count} stay in ${dir}.`) },
      { text: 'Cancel', onClick: () => {} },
    ],
  });
}

/** org-attach-reveal: the folder as a list, each file with Open, Save and Delete. */
export async function revealAttachmentFolder(heading) {
  if (!attachmentsAvailable()) {
    setStatus(unavailable('show the attachment folder'));
    render();
    return;
  }
  const dir = resolveAttachmentDirectory(S.state.doc, heading, S.state.documentId);
  if (!dir) {
    setStatus('No attachments on this heading yet.');
    render();
    return;
  }
  showAttachmentFolder({
    title: `Folder \u2014 ${dir}`,
    load: () => listFolder(dir),
    act: (action, name) => performAttachmentAction(heading, name, action),
    add: () => pickAndUpload(heading),
    saveMany: async (names) => {
      for (const name of names) await performAttachmentAction(heading, name, 'save');
    },
    removeMany: async (names) => {
      if (!(await confirmDialog(`Delete ${names.length} attachment${names.length === 1 ? '' : 's'}? This removes the actual files, not just the links.`))) return;
      for (const name of names) await deleteAttachment(heading, name);
    },
  });
}

/** org-attach-buffer: saves one of the open documents, as text, into the heading's folder. */
export async function attachOpenDocument(heading) {
  if (!(await requireAttachmentStorage())) return;
  const documents = S.documentSessions.map((session) => (session.tabId === S.activeTabId ? S.state : session.state));
  if (documents.length === 0) documents.push(S.state);
  const attach = (state) => {
    const name = String(state.documentId || 'document.org').split('/').pop();
    return uploadAttachmentToHeading(heading, { name, type: 'text/plain', base64: utf8ToBase64(serializeOrg(state.doc)) });
  };
  if (documents.length === 1) {
    await attach(documents[0]);
    return;
  }
  openButtonChoiceModal({
    label: 'Attach which open document?',
    buttons: [...documents.map((state) => ({ text: String(state.documentId || 'document').split('/').pop(), onClick: () => attach(state) })), { text: 'Cancel', onClick: () => {} }],
  });
}

/** org-attach-new: makes a text file in the heading's folder from a name and what to put in it. */
export async function attachNewTextFile(heading) {
  if (!(await requireAttachmentStorage())) return;
  openMultiFieldPopup({
    label: 'New attachment',
    fields: [{ key: 'name', label: 'File name', type: 'text', value: 'note.txt' }],
    onSave: (values) => {
      if (!values.name) return;
      openTextFieldPopup({
        label: `Contents of ${values.name}`,
        value: '',
        onSave: (text) => uploadAttachmentToHeading(heading, { name: values.name, type: 'text/plain', base64: utf8ToBase64(text) }),
      });
    },
  });
}

/** org-attach's dispatcher (C-c C-a), as a grid of buttons laid out like the Capture template picker. The keys are org's own, and
 *  work when pressed; each button shows its key as a badge, as Capture's does. `viaKeys` (opened from god-mode) also lets a phone keyboard's letters reach the menu. */
export function openAttachChoicePrompt(heading, { viaKeys = false } = {}) {
  openGridChoiceModal({
    label: `Attach \u2014 ${heading.title || '(untitled)'}`,
    showKeys: viaKeys,
    buttons: [
      { key: 'a', text: 'Attach', onClick: () => attachFileToHeading(heading) },
      { key: 'r', text: 'Record audio', onClick: () => openAudioRecordingPanel(heading) },
      { key: 'b', text: 'Attach open document', onClick: () => attachOpenDocument(heading) },
      { key: 'n', text: 'New text file', onClick: () => attachNewTextFile(heading) },
      { key: 'o', text: 'Open', onClick: () => startAttachmentPickFlow(heading, 'open') },
      { key: 'f', text: 'Folder', onClick: () => revealAttachmentFolder(heading) },
      { key: 'd', text: 'Delete one', onClick: () => startAttachmentPickFlow(heading, 'delete') },
      { key: 'D', text: 'Delete all', onClick: () => deleteAllAttachments(heading) },
      { key: 's', text: 'Set DIR', onClick: () => setAttachmentDirectory(heading) },
      { key: 'S', text: 'Unset DIR', onClick: () => unsetAttachmentDirectory(heading) },
      { key: 'z', text: 'Sync', onClick: () => syncAttachments(heading) },
    ],
  });
}

/** Shared entry point for Open, Export and Delete: reads `heading`'s attachment folder and either acts directly (exactly
 *  one file) or opens the file-list picker (several), as org-attach does ("if there is more than one, prompt for a file name
 *  first"). */
export async function startAttachmentPickFlow(heading, action) {
  const filenames = await attachmentFiles(heading);
  if (!filenames) return;
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
  label.textContent = `${action === 'delete' ? 'Delete' : action === 'save' ? 'Export' : 'Open'} which attachment?`;
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
