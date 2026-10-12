// @ts-check
// The DOM elements the app wires up, looked up once.
// Extracted from app.js so other modules can use them: a module script runs after
// the document has been parsed, so these lookups behave exactly as they did there.

// Disable auto-capitalization AND auto-correction app-wide, on every
// text input/textarea this app ever creates -- Chrome and Safari on
// mobile default autocapitalize to "sentences," which fights against
// this app's own conventions (tags, properties, list markers, and
// most everyday capture text are almost always lowercase) with no
// per-field way to opt out short of setting the attribute directly.
// autocorrect="off" is the same idea for a DIFFERENT, separately
// surprising behavior: iOS/Safari's own "double-tap space inserts a
// period" system shortcut is tied to the same underlying
// autocorrection subsystem as spelling suggestions, and ties directly
// to this attribute -- most noticeable while typing normal prose into
// a plain text field (a Settings text box, a capture prompt answer),
// where two spaces in a row (easy to type without noticing on a
// mobile keyboard) silently becomes ". " instead. Wrapping
// createElement here, once, covers every input/textarea this app ever
// creates without needing the same attributes repeated at dozens of
// individual call sites. A manual capital or period is still one tap
// away on the keyboard's own keys -- this only removes the automatic,
// unrequested kind, never the ability to type either deliberately.
/** The element with this id. The page always has it, so it is typed as present (as before, a missing one is simply null).
 * @param {string} id @returns {HTMLElement} */
function byId(id) {
  return /** @type {HTMLElement} */ (document.getElementById(id));
}

export const nativeCreateElement = document.createElement.bind(document);

export const outlineEl = byId('outline');

export const tabBarEl = byId('tabBar');

export const sidePanelEl = byId('sidePanel');

export const sidePanelDividerEl = byId('sidePanelDivider');

export const splitRowEl = byId('splitRow');

export const saveBtnEl = byId('saveBtn');

export const statusEl = byId('status');

export const topBarEl = byId('topBar');

export const contentAreaEl = byId('contentArea');

export const modelineBarEl = byId('modelineBar');

export const modelineEl = byId('modeline');

export const minibufferEl = byId('minibuffer');

export const minibufferSearchEl = byId('minibufferSearch');

export const navBackBtn = byId('navBackBtn');

export const extraMenuBtn = byId('extraMenuBtn');

export const extraMenuPanel = byId('extraMenuPanel');

export const viewMenuBtn = byId('viewMenuBtn');

export const godModeBtn = byId('godModeBtn');

export const viewMenuPanel = byId('viewMenuPanel');

export const fileMenuBtn = byId('fileMenuBtn');

export const fileMenuPanel = byId('fileMenuPanel');

export const settingsBtn = byId('settingsBtn');

export const searchBtn = byId('searchBtn');

export const searchPanel = byId('searchPanel');

export const godModeKeyboardInput = byId('godModeKeyboardInput');

export const floatingKeyboard = byId('floatingKeyboard');

export const captureBtn = byId('captureBtn');

export const capturePanel = byId('capturePanel');

export const capturePanelBox = byId('capturePanelBox');

export const doneNotePanel = byId('doneNotePanel');

export const doneNotePanelBox = byId('doneNotePanelBox');

export const refilePanel = byId('refilePanel');

export const refilePanelBox = byId('refilePanelBox');

export const fileScreen = byId('fileScreen');
export const fileScreenBox = byId('fileScreenBox');
export const archiveRefilePanel = byId('archiveRefilePanel');

export const archiveRefilePanelBox = byId('archiveRefilePanelBox');

export const externalChangeBanner = byId('externalChangeBanner');

export const externalChangeText = byId('externalChangeText');

export const externalChangeMergeBtn = byId('externalChangeMergeBtn');

export const externalChangeReloadBtn = byId('externalChangeReloadBtn');

export const externalChangeDismissBtn = byId('externalChangeDismissBtn');

export const moreBtn = byId('moreBtn');

export const morePanel = byId('morePanel');
