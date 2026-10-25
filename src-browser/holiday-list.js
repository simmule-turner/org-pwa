// @ts-check
// list-holidays: asks for a first and last year in the minibuffer, as Emacs does, and lists the holidays between them in a new buffer
// named *Holidays*.
import { listHolidays } from '../src/holidays.js';
import { createNewUnsavedDocument } from './documents-io.js';
import { setStatus } from './editing.js';
import { readFromMinibuffer } from './minibuffer-prompt.js';
import { switchToView } from './views.js';

/** Asks until the answer is a whole number the check accepts; null when cancelled. @param {string} prompt @param {number} initial @param {(n: number) => boolean} ok */
async function askYear(prompt, initial, ok) {
  for (;;) {
    const answer = await readFromMinibuffer(prompt, String(initial));
    if (answer === null) return null;
    const n = Number(answer.trim());
    if (/^\d+$/.test(answer.trim()) && ok(n)) return n;
    setStatus('Please enter a valid year');
  }
}

export async function listHolidaysCommand() {
  const first = await askYear('Start year (>0): ', new Date().getFullYear(), (n) => n > 0);
  if (first === null) return setStatus('Quit');
  const last = await askYear(`End year (>=${first}): `, first, (n) => n >= first);
  if (last === null) return setStatus('Quit');
  setStatus('Computing holidays…');
  await createNewUnsavedDocument(listHolidays(first, last), `Holidays ${first === last ? first : `${first}–${last}`} in *Holidays*.`, '*Holidays*');
  switchToView('text'); // a list of lines, not an outline
}
