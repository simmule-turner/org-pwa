// @ts-check
// Asks before a document's own text makes the app fetch a web address (a #+SETUPFILE:, a bibliography), as Emacs does
// (Allow once / Always allow this address / Never). The answer for "always" and "never" is kept per address.
import { remoteDecision, remoteKey } from '../src/remote-resources.js';
import { openButtonChoiceModal } from './dialogs.js';
import { kv } from './singletons.js';

/** Answers given in this visit, by address. */
const thisVisit = new Map();
/** Questions on screen, by address, so a second request for the same address waits for the first answer. */
const asking = new Map();

/** @param {string} url @param {string} what
 * @returns {Promise<'once' | 'always' | 'never' | 'skip'>} */
function askPerson(url, what) {
  return new Promise((resolve) => {
    let done = false;
    /** @param {'once' | 'always' | 'never' | 'skip'} choice */
    const answer = (choice) => {
      if (done) return;
      done = true;
      resolve(choice);
    };
    const overlay = openButtonChoiceModal({
      label: `This document asks to load ${what} from ${url}. Load it?`,
      buttons: [
        { text: 'Load once', onClick: () => answer('once') },
        { text: 'Always load from this address', onClick: () => answer('always') },
        { text: 'Never load from this address', onClick: () => answer('never') },
        { text: 'Not now', onClick: () => answer('skip') },
      ],
    });
    // closed without a choice (Escape, a tap outside): the same as "Not now"
    const watcher = new MutationObserver(() => {
      if (!document.body.contains(overlay)) {
        watcher.disconnect();
        answer('skip');
      }
    });
    watcher.observe(document.body, { childList: true });
  });
}

/**
 * True when the address may be fetched: it was allowed before, or the person allows it now.
 * @param {string} url @param {string} what  for example 'a setup file'
 */
export async function mayFetchRemote(url, what) {
  const key = remoteKey(url);
  let saved = null;
  try {
    const entry = await kv.get(key);
    saved = entry && typeof entry.value === 'string' ? entry.value : null;
  } catch {
    // the kept answer cannot be read: ask
  }
  let decision = remoteDecision(saved, thisVisit.get(key));
  if (decision === 'ask') {
    let pending = asking.get(key);
    if (!pending) {
      pending = askPerson(url, what);
      asking.set(key, pending);
    }
    const answer = await pending;
    asking.delete(key);
    thisVisit.set(key, answer === 'always' ? 'once' : answer === 'never' ? 'skip' : answer);
    if (answer === 'always' || answer === 'never') {
      try {
        await kv.set(key, answer);
      } catch {
        // not kept; asked again next visit
      }
    }
    decision = remoteDecision(null, thisVisit.get(key));
  }
  return decision === 'fetch';
}
