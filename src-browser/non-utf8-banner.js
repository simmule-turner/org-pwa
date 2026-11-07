// @ts-check
// The banner for a file that is not valid UTF-8 and so is open read-only: Convert to UTF-8… and Dismiss. Shown from render() for
// the open document, so it follows tab switches, a close and a conversion without being told.
import { dismissNonUtf8Banner, shouldShowNonUtf8Banner } from '../src/utf8.js';
import { syncContentOffset } from './chrome.js';
import { nonUtf8Banner, nonUtf8ConvertBtn, nonUtf8DismissBtn, nonUtf8Text } from './dom.js';
import { S } from './app-state.js';
import { convertToUtf8 } from './utf8-convert.js';

export function syncNonUtf8Banner() {
  const id = S.state ? S.state.documentId : null;
  const show = shouldShowNonUtf8Banner(id);
  if (show) nonUtf8Text.textContent = `"${id}" is not valid UTF-8, so it is open read-only.`;
  const display = show ? 'flex' : 'none';
  if (nonUtf8Banner.style.display === display) return;
  nonUtf8Banner.style.display = display;
  syncContentOffset();
}

nonUtf8ConvertBtn.addEventListener('click', () => {
  void convertToUtf8();
});

nonUtf8DismissBtn.addEventListener('click', () => {
  if (S.state && S.state.documentId) dismissNonUtf8Banner(S.state.documentId);
  syncNonUtf8Banner();
});
