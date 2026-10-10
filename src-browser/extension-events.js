// A one-way notice that something happened, for the init script's org.on hooks. Kept in its own module with
// no imports so the places that announce an event (saving, TODO changes, capture, opening a file) need not
// import the extension code, which imports them.
const slot = { listener: null };

/** The extension code registers here once. */
export function onExtensionEvent(fn) {
  slot.listener = fn;
}

/** Announces an event. Does nothing when no script is listening, and never throws into the caller. */
export function emitExtensionEvent(name, payload = {}) {
  if (!slot.listener) return;
  try {
    slot.listener(name, payload);
  } catch (err) {
    console.error('extension event:', err);
  }
}
