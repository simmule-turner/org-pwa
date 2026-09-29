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
export const nativeCreateElement = document.createElement.bind(document);

export const outlineEl = document.getElementById('outline');

export const tabBarEl = document.getElementById('tabBar');

export const sidePanelEl = document.getElementById('sidePanel');

export const sidePanelDividerEl = document.getElementById('sidePanelDivider');

export const splitRowEl = document.getElementById('splitRow');

export const saveBtnEl = document.getElementById('saveBtn');

export const statusEl = document.getElementById('status');

export const topBarEl = document.getElementById('topBar');

export const contentAreaEl = document.getElementById('contentArea');

export const modelineBarEl = document.getElementById('modelineBar');

export const modelineEl = document.getElementById('modeline');

export const minibufferEl = document.getElementById('minibuffer');

export const minibufferSearchEl = document.getElementById('minibufferSearch');

export const navBackBtn = document.getElementById('navBackBtn');

export const extraMenuBtn = document.getElementById('extraMenuBtn');

export const extraMenuPanel = document.getElementById('extraMenuPanel');

export const viewMenuBtn = document.getElementById('viewMenuBtn');

export const viewMenuPanel = document.getElementById('viewMenuPanel');

export const fileMenuBtn = document.getElementById('fileMenuBtn');

export const fileMenuPanel = document.getElementById('fileMenuPanel');

export const settingsBtn = document.getElementById('settingsBtn');

export const searchBtn = document.getElementById('searchBtn');

export const searchPanel = document.getElementById('searchPanel');

export const captureBtn = document.getElementById('captureBtn');

export const capturePanel = document.getElementById('capturePanel');

export const capturePanelBox = document.getElementById('capturePanelBox');

export const doneNotePanel = document.getElementById('doneNotePanel');

export const doneNotePanelBox = document.getElementById('doneNotePanelBox');

export const refilePanel = document.getElementById('refilePanel');

export const refilePanelBox = document.getElementById('refilePanelBox');

export const externalChangeBanner = document.getElementById('externalChangeBanner');

export const externalChangeText = document.getElementById('externalChangeText');

export const externalChangeMergeBtn = document.getElementById('externalChangeMergeBtn');

export const externalChangeReloadBtn = document.getElementById('externalChangeReloadBtn');

export const externalChangeDismissBtn = document.getElementById('externalChangeDismissBtn');

export const moreBtn = document.getElementById('moreBtn');

export const morePanel = document.getElementById('morePanel');
