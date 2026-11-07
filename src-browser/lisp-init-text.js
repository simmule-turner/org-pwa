// @ts-check
// The Lisp init as it reads once its (load ...) files are in: lisp-init-load.js keeps it here, and Capture reads its templates from it
// (a template written in a loaded init file is as good as one written in the setting).

/** `raw` is the setting's own text the rest was made from, `text` the init with every (load ...) replaced by that file, and `ready`
 *  settles once the files last read on this device are in (or at once when there is no load). */
export const initText = { raw: '', text: '', ready: /** @type {Promise<void>} */ (Promise.resolve()) };
