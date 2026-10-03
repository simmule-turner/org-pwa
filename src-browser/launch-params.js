// Capture from outside the app. A launch URL can carry what to capture: `index.html?capture=KEY` runs the template
// with that key, a bare `?capture` shows the template list, and `&text=...&title=...&url=...` hand content to the
// template's %i and %a. The manifest points Android's share sheet at the same URL (share_target) and offers
// `?capture` as an icon shortcut. The parsing is src/capture-shared.js; this is the browser half.
import { parseLaunchParams } from '../src/capture-shared.js';
import { S } from './app-state.js';
import { openCapturePrompt, renderCapturePanel } from './capture-ui.js';
import { setStatus } from './editing.js';
import { getCaptureTemplates } from './settings.js';
import { kv } from './singletons.js';

/** Acts on the launch URL, once, after startup has restored everything. A URL with nothing for Capture does nothing. */
export async function handleLaunchParams() {
  const params = parseLaunchParams(window.location.search);
  if (!params) return;
  // Remove the parameters first, so a reload (or the app being restored) never runs the capture a second time.
  window.history.replaceState(window.history.state, '', window.location.pathname + window.location.hash);
  await runLaunch(params);
}

/** Runs a launch: `{ capture, shared }` as parseLaunchParams makes it. This is what a launch URL ends up calling, and
 *  what a native shell calls directly when something is shared to the app (there is no URL to parse then). `capture` is
 *  a template key ('' to show the list, null for none), and `shared` is `{ title, text, url }` or null. */
export async function runLaunch(params) {
  S.captureShared = params.shared;
  S.captureOpen = true;
  const templates = await getCaptureTemplates(kv);
  S.currentCaptureTemplates = templates;

  if (params.capture) {
    const template = templates.find((t) => t.key === params.capture);
    if (template) {
      S.captureOpenedFromExtraMenu = true; // as for an Extras entry that names a template: the panel closes once it is captured
      await openCapturePrompt(template);
      return;
    }
    setStatus(`No capture template "${params.capture}" \u2014 pick one.`);
  }
  renderCapturePanel();
}
