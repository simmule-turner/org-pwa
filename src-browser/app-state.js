// @ts-check
/**
 * The app's shared mutable state, in one place.
 *
 * app.js used to keep this in 113 module-level `let` variables (the open
 * document, the current view, which panels are open, keyboard focus, ...).
 * A `let` can't be shared across files -- an importing module can read it
 * but never assign it -- so every function that touched one had to live in
 * app.js. Each is now a property of this one object, `S`, which any module
 * can import and both read and write:
 *
 *     S.isDirty = true;
 *
 * The properties are defined where the old `let` declarations were, in
 * app.js, so initialisation order is exactly what it was.
 */
/** @typedef {import('../src/types.js').AppState} AppState */
export const S = /** @type {AppState} */ (/** @type {unknown} */ ({}));

/** The views that list agenda rows and redraw when the agenda files load: the Agenda, the TODO list, and the Match and Search views.
 * @param {string} view */
export const isAgendaFamilyView = (view) => view === 'agenda' || view === 'tasklist' || view === 'match' || view === 'searchview';
