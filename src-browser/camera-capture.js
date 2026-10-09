// The in-app camera, for a device whose file chooser has no camera in it (a Chromebook or a desktop browser): a live preview from
// the webcam, then either one still (Take photo) or a recording (Record, Stop), a review, and Attach or Retake. A phone's own
// chooser offers the camera itself, so this is not used there. `onAttach({ name, type, base64 })` is given what to store.
import { generateCaptureFilename } from '../src/attach.js';
import { S } from './app-state.js';
import { lockBackgroundScroll } from './dialogs.js';
import { setStatus } from './editing.js';
import { render } from './render.js';
import { keepOverlayInVisibleViewport, menuButton } from './ui-widgets.js';

const blobToBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const comma = dataUrl.lastIndexOf(','); // the type may hold commas (codecs=vp8,opus); base64 never does
      resolve(comma === -1 ? '' : dataUrl.slice(comma + 1));
    };
    reader.onerror = () => reject(reader.error || new Error('Could not read the capture'));
    reader.readAsDataURL(blob);
  });

/** Whether this browser has a camera the page can use: the API is there and a video input is listed. */
export async function cameraAvailable() {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !navigator.mediaDevices.enumerateDevices) return false;
    return (await navigator.mediaDevices.enumerateDevices()).some((device) => device.kind === 'videoinput');
  } catch {
    return false;
  }
}

/** Opens the camera panel for a 'photo' or a 'video'. Asks for the camera (and the microphone, for a video) first. */
export async function openCameraPanel(kind, onAttach) {
  if (kind === 'video' && typeof MediaRecorder === 'undefined') {
    setStatus("This browser can't record video.");
    render();
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: kind === 'video' });
  } catch (err) {
    setStatus(`Could not use the camera: ${err.message}`);
    render();
    return;
  }

  let phase = 'live'; // live | recording | review
  let recorder = null;
  let chunks = [];
  let captured = null; // the Blob in review
  let capturedUrl = null;
  let clock = null;
  let startedAt = 0;

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;overflow:hidden;';
  const modal = document.createElement('div');
  modal.className = 'panel';
  modal.style.cssText = 'background:var(--modal-bg);color:var(--fg);border:1px solid var(--border-strong);border-radius:10px;padding:14px;width:100%;max-width:640px;max-height:100%;overflow-y:auto;box-sizing:border-box;';
  overlay.appendChild(modal);
  const title = document.createElement('div');
  title.style.cssText = 'font-size:13px;opacity:0.75;margin-bottom:8px;';
  title.textContent = kind === 'video' ? 'Record a video' : 'Take a photo';
  modal.appendChild(title);
  const stage = document.createElement('div');
  modal.appendChild(stage);
  const readout = document.createElement('div');
  readout.style.cssText = 'font-size:20px;font-weight:700;text-align:center;margin:8px 0;min-height:1.2em;';
  modal.appendChild(readout);
  const row = document.createElement('div');
  row.className = 'panel-row';
  row.style.marginTop = '6px';
  modal.appendChild(row);

  const live = document.createElement('video');
  live.autoplay = true;
  live.muted = true;
  live.playsInline = true;
  live.srcObject = stream;
  live.style.cssText = 'display:block;width:100%;max-height:60vh;background:#000;border-radius:6px;';

  const stopStream = () => stream.getTracks().forEach((track) => track.stop());
  const wasOpen = S.buttonChoiceModalOpen;
  S.buttonChoiceModalOpen = true;
  const stopTrackingViewport = keepOverlayInVisibleViewport(overlay);
  const unlockScroll = lockBackgroundScroll(overlay);

  function close() {
    clearInterval(clock);
    if (recorder && recorder.state === 'recording') {
      recorder.onstop = null;
      recorder.stop();
    }
    stopStream();
    if (capturedUrl) URL.revokeObjectURL(capturedUrl);
    S.buttonChoiceModalOpen = wasOpen;
    document.removeEventListener('keydown', onKeyDown, true);
    stopTrackingViewport();
    unlockScroll();
    if (overlay.parentNode) document.body.removeChild(overlay);
  }
  function onKeyDown(e) {
    if (e.key !== 'Escape' || document.body.lastElementChild !== overlay) return;
    e.preventDefault();
    e.stopPropagation();
    close();
  }
  document.addEventListener('keydown', onKeyDown, true);

  function showReview() {
    phase = 'review';
    capturedUrl = URL.createObjectURL(captured);
    const media = document.createElement(kind === 'video' ? 'video' : 'img');
    media.src = capturedUrl;
    if (kind === 'video') media.controls = true;
    media.style.cssText = 'display:block;width:100%;max-height:60vh;background:#000;border-radius:6px;';
    stage.replaceChildren(media);
    draw();
  }
  function retake() {
    clearInterval(clock);
    if (capturedUrl) URL.revokeObjectURL(capturedUrl);
    capturedUrl = null;
    captured = null;
    chunks = [];
    phase = 'live';
    stage.replaceChildren(live);
    draw();
  }
  function takePhoto() {
    const canvas = document.createElement('canvas');
    canvas.width = live.videoWidth || 640;
    canvas.height = live.videoHeight || 480;
    canvas.getContext('2d').drawImage(live, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          readout.textContent = "Couldn't take the photo.";
          return;
        }
        captured = blob;
        showReview();
      },
      'image/jpeg',
      0.92
    );
  }
  function startRecording() {
    chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      clearInterval(clock);
      captured = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
      showReview();
    };
    startedAt = Date.now();
    recorder.start();
    phase = 'recording';
    clock = setInterval(draw, 500);
    draw();
  }
  async function attach() {
    const blob = captured;
    const type = blob.type || (kind === 'video' ? 'video/webm' : 'image/jpeg');
    const base64 = await blobToBase64(blob);
    close();
    await onAttach({ name: generateCaptureFilename(kind, '', type), type, base64 });
  }

  function draw() {
    row.replaceChildren();
    readout.textContent = '';
    if (phase === 'live') {
      row.appendChild(menuButton(kind === 'video' ? '⏺ Record' : '📷 Take photo', kind === 'video' ? startRecording : takePhoto));
    } else if (phase === 'recording') {
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      readout.textContent = `🔴 ${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
      row.appendChild(menuButton('⏹ Stop', () => recorder.stop()));
    } else {
      row.appendChild(menuButton('📎 Attach', attach));
      row.appendChild(menuButton('🔄 Retake', retake));
    }
    row.appendChild(menuButton('Cancel', close));
  }

  stage.appendChild(live);
  draw();
  document.body.appendChild(overlay);
}
