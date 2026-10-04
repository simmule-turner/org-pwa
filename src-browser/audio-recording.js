// Extracted from app.js: audio recording.
import { generateRecordingFilename } from '../src/attach.js';
import { S } from './app-state.js';
import { uploadAttachmentToHeading } from './attachments-flow.js';
import { showModalOverlay } from './dialogs.js';
import { refilePanel, refilePanelBox } from './dom.js';
import { ensureAttachmentsStorage } from './attachments-store.js';
import { setStatus } from './editing.js';
import { render } from './render.js';
import { hideModalOverlay, menuButton } from './ui-widgets.js';

/** org-xx-extra-menu-independent Attach sub-action -- opens the audio-
 *  recording panel for `heading`, resetting any state left over from
 *  a previous recording session (own defensive cleanup, in case a
 *  prior session was ever abandoned mid-flow without going through
 *  discardAudioRecording's own explicit cleanup). */
export async function openAudioRecordingPanel(heading) {
  const storage = await ensureAttachmentsStorage(); // a local document asks for its attachments folder here, once
  if (storage === 'cancelled') return; // the person backed out of choosing it
  if (storage !== 'ok') {
    setStatus(
      "Attachments need automatic file-write access \u2014 only available with GitHub or WebDAV connected (a local file needs a fresh picker gesture per file, which browser security doesn't allow this app to do on its own for a brand-new attachment file). Connect GitHub or WebDAV in Settings first."
    );
    render();
    return;
  }
  if (S.recordedBlobUrl) {
    URL.revokeObjectURL(S.recordedBlobUrl);
    S.recordedBlobUrl = null;
  }
  S.mediaRecorder = null;
  S.recordedChunks = [];
  S.recordingStartedAt = null;
  S.pendingAudioRecording = { heading };
  renderAudioRecordingPanel();
}

/** Renders the audio-recording panel into refilePanel -- one of three
 *  states depending on mediaRecorder/recordedBlobUrl's own current
 *  values: idle (nothing recorded yet -- a single Record button),
 *  recording (mediaRecorder.state === 'recording' -- a live elapsed-
 *  time readout plus Stop, re-rendered once a second via its own
 *  setInterval while recording, to actually keep that readout
 *  moving), or review (recordedBlobUrl is set -- real, native
 *  <audio controls> playback of exactly what was just recorded,
 *  plus Save / Re-record / Cancel). */
export function renderAudioRecordingPanel() {
  refilePanelBox.innerHTML = '';
  if (!S.pendingAudioRecording) {
    hideModalOverlay(refilePanel);
    return;
  }
  showModalOverlay(refilePanel);
  const heading = S.pendingAudioRecording.heading;

  const label = document.createElement('div');
  label.style.fontSize = '13px';
  label.style.marginBottom = '8px';
  label.textContent = `Record audio for "${heading.title || '(untitled)'}"`;
  refilePanelBox.appendChild(label);

  if (S.recordedBlobUrl) {
    // Review state -- listen back before committing to an upload.
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.src = S.recordedBlobUrl;
    audio.style.width = '100%';
    audio.style.marginBottom = '8px';
    refilePanelBox.appendChild(audio);

    const row = document.createElement('div');
    row.className = 'panel-row';
    row.appendChild(
      menuButton('\ud83d\udcbe Save', () => {
        saveAudioRecording(heading);
      })
    );
    row.appendChild(
      menuButton('\ud83d\udd04 Re-record', () => {
        openAudioRecordingPanel(heading);
        startAudioRecording();
      })
    );
    row.appendChild(
      menuButton('Cancel', () => {
        discardAudioRecording();
      })
    );
    refilePanelBox.appendChild(row);
    return;
  }

  if (S.mediaRecorder && S.mediaRecorder.state === 'recording') {
    // Recording state -- a live elapsed-time readout.
    const elapsedMs = Date.now() - S.recordingStartedAt;
    const totalSeconds = Math.floor(elapsedMs / 1000);
    const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const ss = String(totalSeconds % 60).padStart(2, '0');
    const timer = document.createElement('div');
    timer.style.fontSize = '24px';
    timer.style.fontWeight = '700';
    timer.style.textAlign = 'center';
    timer.style.margin = '12px 0';
    timer.textContent = `\ud83d\udd34 ${mm}:${ss}`;
    refilePanelBox.appendChild(timer);

    const row = document.createElement('div');
    row.className = 'panel-row';
    row.appendChild(
      menuButton('\u23f9 Stop', () => {
        stopAudioRecording();
      })
    );
    row.appendChild(
      menuButton('Cancel', () => {
        discardAudioRecording();
      })
    );
    refilePanelBox.appendChild(row);
    return;
  }

  // Idle state -- nothing recorded yet.
  const row = document.createElement('div');
  row.className = 'panel-row';
  row.appendChild(
    menuButton('\u23fa Record', () => {
      startAudioRecording();
    })
  );
  row.appendChild(
    menuButton('Cancel', () => {
      discardAudioRecording();
    })
  );
  refilePanelBox.appendChild(row);
}

/** Requests microphone access (a real, explicit browser permission
 *  prompt the first time -- HTTPS-only, matching every other
 *  camera/mic-adjacent capability this app already relies on) and
 *  starts a real MediaRecorder session against the resulting stream.
 *  No explicit mimeType is requested -- left to the browser's own
 *  default choice, which is exactly what varies by platform (webm on
 *  Chrome/Firefox/Edge, mp4 on Safari -- see extensionForRecordedMimeType's
 *  own docs in attach.js) and exactly why the eventual saved
 *  filename's own extension is derived from mediaRecorder.mimeType
 *  itself rather than assumed upfront. Re-renders the panel once a
 *  second while recording, purely to keep the elapsed-time readout
 *  moving -- the interval is cleared in both stopAudioRecording and
 *  discardAudioRecording, whichever ends the session. */
export async function startAudioRecording() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    setStatus(`Could not access the microphone: ${err.message}`);
    render();
    return;
  }

  S.recordedChunks = [];
  const recorder = new MediaRecorder(stream);
  S.mediaRecorder = recorder;
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) S.recordedChunks.push(e.data);
  };
  recorder.onstop = () => {
    stream.getTracks().forEach((track) => track.stop());
    const blob = new Blob(S.recordedChunks, { type: recorder.mimeType });
    S.recordedBlobUrl = URL.createObjectURL(blob);
    renderAudioRecordingPanel();
  };

  S.recordingStartedAt = Date.now();
  recorder.start();
  renderAudioRecordingPanel();

  const tickInterval = setInterval(() => {
    if (!S.mediaRecorder || S.mediaRecorder.state !== 'recording') {
      clearInterval(tickInterval);
      return;
    }
    renderAudioRecordingPanel();
  }, 1000);
}

/** Ends the in-progress MediaRecorder session -- fires the recorder's
 *  own onstop handler (set up in startAudioRecording), which is what
 *  actually assembles the recorded chunks into a real Blob and moves
 *  the panel into its own review state. */
export function stopAudioRecording() {
  if (S.mediaRecorder && S.mediaRecorder.state === 'recording') {
    S.mediaRecorder.stop();
  }
}

/** Converts the just-recorded Blob to base64 (via the same FileReader
 *  approach pickBinaryFile already uses for a picked file, for the
 *  same reasons -- fast, native, non-blocking) and hands it to
 *  uploadAttachmentToHeading, the exact same upload/link-insertion
 *  core a regular picked-file attachment already goes through. The
 *  filename itself is generated fresh (generateRecordingFilename,
 *  see attach.js), since a recording -- unlike a picked file -- never
 *  had a name of its own to begin with. */
export async function saveAudioRecording(heading) {
  const blobUrl = S.recordedBlobUrl;
  const mimeType = S.mediaRecorder.mimeType;
  const res = await fetch(blobUrl);
  const blob = await res.blob();

  const reader = new FileReader();
  const base64 = await new Promise((resolve, reject) => {
    reader.onload = () => {
      const dataUrl = reader.result;
      const commaIndex = dataUrl.indexOf(',');
      resolve(commaIndex === -1 ? '' : dataUrl.slice(commaIndex + 1));
    };
    reader.onerror = () => reject(reader.error || new Error('Could not read the recording'));
    reader.readAsDataURL(blob);
  });

  URL.revokeObjectURL(blobUrl);
  S.recordedBlobUrl = null;
  S.pendingAudioRecording = null;
  S.mediaRecorder = null;
  S.recordedChunks = [];
  renderAudioRecordingPanel();

  await uploadAttachmentToHeading(heading, { name: generateRecordingFilename(mimeType), type: mimeType, base64 });
}

/** Discards whatever's currently in progress (a live recording, or
 *  one already stopped and pending review) and closes the panel --
 *  the actual MediaRecorder session, if one is still running, is
 *  stopped first so the microphone itself is genuinely released, not
 *  just the UI dismissed while still recording in the background. */
export function discardAudioRecording() {
  if (S.mediaRecorder && S.mediaRecorder.state === 'recording') {
    S.mediaRecorder.stop();
  }
  if (S.recordedBlobUrl) {
    URL.revokeObjectURL(S.recordedBlobUrl);
    S.recordedBlobUrl = null;
  }
  S.mediaRecorder = null;
  S.recordedChunks = [];
  S.pendingAudioRecording = null;
  renderAudioRecordingPanel();
}
