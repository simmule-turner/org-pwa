// Capture templates as the launcher's own shortcuts (Android's long-press list on the app icon), and a way to put an icon
// for one on the home screen. Only a platform that has launcher shortcuts does anything (platform.captureShortcuts, see
// platform.js); in a browser every function here returns at once.
import { S } from './app-state.js';
import { openButtonChoiceModal } from './dialogs.js';
import { setStatus } from './editing.js';
import { platform } from './platform.js';
import { getCaptureTemplates } from './settings.js';
import { kv } from './singletons.js';

/** A template as a shortcut: its key, and the description it is listed under. Templates without both are not offered. */
function shortcutsFor(templates) {
  return (templates || []).filter((t) => t && t.key && t.description).map((t) => ({ key: String(t.key), label: String(t.description) }));
}

/** Publishes one shortcut per capture template, in the order the templates are listed. Called at startup and whenever the
 *  templates change, so the launcher's list always matches. */
export async function syncCaptureShortcuts() {
  if (!platform.captureShortcuts.supported()) return;
  try {
    await platform.captureShortcuts.set(shortcutsFor(await getCaptureTemplates(kv)));
  } catch {
    // shortcuts are a convenience: a launcher that refuses them must never get in the way of the app
  }
}

/** "Add a capture icon to the home screen": pick a template (or the template list), and the launcher is asked to pin it. */
export async function addCaptureIconToHomeScreen() {
  if (!platform.captureShortcuts.supported()) {
    setStatus('Capture icons are available in the Android app.');
    return;
  }
  let canPin = false;
  try {
    canPin = await platform.captureShortcuts.canPin();
  } catch {
    canPin = false;
  }
  if (!canPin) {
    setStatus("This launcher can't add icons from an app. Long-press the app icon instead and drag a Capture shortcut out.");
    return;
  }
  const choices = [{ key: '', label: 'Capture (the template list)' }, ...shortcutsFor(await getCaptureTemplates(kv))];
  openButtonChoiceModal({
    label: 'Add an icon for which capture?',
    buttons: choices.map((choice) => ({
      text: choice.label,
      onClick: async () => {
        let requested = false;
        try {
          requested = await platform.captureShortcuts.pin(choice);
        } catch {
          requested = false;
        }
        setStatus(requested ? `Asked the launcher to add a "${choice.label}" icon: confirm it if it asks.` : "The launcher didn't add the icon.");
      },
    })),
  });
}
