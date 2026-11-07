// @ts-check
// Asks before a large Org file is opened. The refuse limit is enforced where files are read (line-endings-adapter.js); this
// is the "warn" limit, and only for a file the person is opening, not for the reads the agenda or a refile make.
import { checkSize, utf8Length } from '../src/size-limits.js';
import { confirmDialog } from './dialogs.js';

/**
 * `adapter` with a read that asks first when the file is over the warn limit. Declining ends the open with an error that
 * says so, and nothing has been parsed or shown by then.
 * @template {{ read: (id: string, ...rest: never[]) => Promise<unknown> }} A
 * @param {A} adapter
 * @returns {A}
 */
export function askingBeforeLargeRead(adapter) {
  const asking = Object.create(adapter);
  asking.read = async (/** @type {string} */ id, /** @type {never[]} */ ...rest) => {
    const result = /** @type {{ content?: unknown } | null} */ (await adapter.read(id, ...rest));
    if (!result || typeof result.content !== 'string') return result;
    const verdict = checkSize('orgFile', utf8Length(result.content), undefined, id);
    if (verdict.ok === 'warn' && !(await confirmDialog(verdict.message, { confirmLabel: 'Open', cancelLabel: 'Cancel', danger: false }))) {
      throw new Error(`"${id}" was not opened.`);
    }
    return result;
  };
  return asking;
}
