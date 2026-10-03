// "Show display measurements": what this screen and this web view actually report, for working out why something sits
// where it does (the app bar under or too far below a status bar, a keyboard that is not noticed, a notch). Read-only; it
// shows the numbers in a text box, and OK copies them, so they can be pasted into a bug report.
import { S } from './app-state.js';
import { contentAreaEl, modelineBarEl, topBarEl } from './dom.js';
import { openTextFieldPopup } from './dialogs.js';
import { setStatus } from './editing.js';
import { platform } from './platform.js';

const px = (n) => `${Math.round(n * 10) / 10}px`;

/** The padding a CSS value resolves to, which is how env() values are read back. */
function resolveLength(cssValue) {
  const probe = document.createElement('div');
  probe.style.cssText = `position:absolute;visibility:hidden;padding-top:${cssValue}`;
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).paddingTop;
  probe.remove();
  return resolved;
}

/** The report, as `[label, value]` pairs. */
export function collectDisplayMeasurements() {
  const sides = ['top', 'right', 'bottom', 'left'];
  const root = getComputedStyle(document.documentElement);
  const vv = window.visualViewport;
  const chrome = /Chrome\/(\d+)/.exec(navigator.userAgent);
  const firstButton = document.querySelector('#topBar header button');
  const header = document.querySelector('#topBar header');
  const base = S.viewportBaseline;
  const rect = (el) => (el ? el.getBoundingClientRect() : null);
  const first = rect(firstButton);
  const rows = [
    ['platform', platform.name],
    ['web view', chrome ? `Chrome/${chrome[1]}` : navigator.userAgent.slice(0, 60)],
    ['devicePixelRatio', String(window.devicePixelRatio)],
    ['window (innerWidth x innerHeight)', `${window.innerWidth} x ${window.innerHeight}`],
    ['visual viewport (width x height, offsetTop)', vv ? `${px(vv.width)} x ${px(vv.height)}, ${px(vv.offsetTop)}` : 'none'],
    ['screen (width x height)', `${screen.width} x ${screen.height}`],
    ['env(safe-area-inset) top/right/bottom/left', sides.map((side) => resolveLength(`env(safe-area-inset-${side}, 0px)`)).join(' / ')],
    ['--safe-area-inset (injected by Capacitor) top/right/bottom/left', sides.map((side) => root.getPropertyValue(`--safe-area-inset-${side}`).trim() || '(not set)').join(' / ')],
    ['top bar: padding-top, height', `${getComputedStyle(topBarEl).paddingTop}, ${px(topBarEl.offsetHeight)}`],
    ['top bar header: height', header ? px(header.getBoundingClientRect().height) : 'none'],
    ['first button: top, height', first ? `${px(first.top)}, ${px(first.height)}` : 'none'],
    ['document area starts at', px(contentAreaEl.getBoundingClientRect().top)],
    ['mode line: bottom offset', modelineBarEl.style.bottom || '0'],
    ['tallest window at this width', base ? `${base.height} (width ${base.width})` : 'not yet measured'],
  ];
  return rows;
}

export function showDisplayMeasurements() {
  const text = collectDisplayMeasurements().map(([label, value]) => `${label}: ${value}`).join('\n');
  openTextFieldPopup({
    label: 'Display measurements (OK copies them)',
    value: text,
    defaultValue: text,
    onSave: async (edited) => {
      try {
        await platform.clipboard.writeText(edited);
        setStatus('Display measurements copied.');
      } catch {
        setStatus("Couldn't copy them: select the text in the box instead.");
      }
    },
  });
}
