
/**
 * Exports contacts -- Org headlines carrying a valid EMAIL property --
 * across a set of documents to a standard vCard 3.0 (.vcf) file, one
 * VCARD per matching headline. Mirrors real org-contacts.el's own
 * org-contacts-export-as-vcard as closely as this app's own model
 * allows -- confirmed directly against the org-contacts.el source
 * (https://github.com/emacsmirror/org-contacts/blob/master/org-contacts.el):
 * an entry counts as an exportable contact only if (1) it has a
 * non-empty EMAIL property, and (2) it is not marked :IGNORE: t. A
 * heading missing EMAIL is silently skipped, not treated as an error
 * -- most real-world files mix genuine contacts with ordinary,
 * unrelated headings, and flagging every one of those as a "failure"
 * would make the export unusable on anything but a file dedicated
 * entirely to contacts.
 *
 * Property -> vCard field mapping (headline title is always FN):
 *   EMAIL                -> EMAIL (required)
 *   PHONE / CELL          -> TEL
 *   WORK_PHONE             -> TEL;TYPE=WORK
 *   ADDRESS / ADR          -> ADR (placed in ADR's own "street" component --
 *                              this app stores addresses as one free-text
 *                              string, not vCard's seven structured parts,
 *                              and "street" is where a single unstructured
 *                              address string is conventionally placed)
 *   NICKNAME               -> NICKNAME
 *   NOTE                   -> NOTE
 *   org-contacts-birthday-property (default BIRTHDAY) -> BDAY
 *
 * BDAY deliberately does NOT reuse agenda.js's own parseContactEvent --
 * that function requires a trailing description ("YYYY-MM-DD
 * Description", org-contacts-anniversaries' own agenda-display format)
 * and would silently reject a bare "YYYY-MM-DD" value with no
 * description at all, which is BIRTHDAY's own more common, simpler
 * form when it's used only for vCard export rather than also feeding
 * the agenda view. parseBirthdayDate below accepts a bare date and
 * ignores any trailing text, so the same BIRTHDAY property already
 * written for org-contacts-anniversaries (date + description) still
 * exports its date correctly here too, without requiring two separate
 * properties for what's conceptually the same fact.
 *
 * vCard 3.0's own spec technically requires N (structured name)
 * alongside FN, and some real-world importers are strict about this
 * even though FN alone is often functionally sufficient -- N is
 * synthesized with a simple last-word-is-family-name split (see
 * splitNameForN), the same fallback approach real org-contacts.el
 * itself uses when it only has a plain headline to work with.
 */

import { walkHeadings } from './agenda.js';
import { isArchived, getProperty } from './archive-model.js';
import { isCommentedHeading } from './comment-model.js';
import { foldLine } from './export-icalendar.js';

function escapeVcardText(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

const BIRTHDAY_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;

/** Accepts a bare "YYYY-MM-DD", optionally followed by anything else
 *  (a description, as org-contacts-anniversaries' own format would
 *  add) -- unlike agenda.js's own parseContactEvent, trailing text is
 *  optional here, not required. Returns null for an out-of-range
 *  month/day or a value that doesn't start with a recognizable date
 *  at all, silently skipping BDAY for that contact rather than
 *  emitting a malformed field. */
function parseBirthdayDate(raw) {
  const m = BIRTHDAY_DATE_RE.exec(String(raw).trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

/** Best-effort split of a plain "First Last" headline into N's own
 *  Family;Given components. Last whitespace-separated word becomes
 *  the family name, everything before it the given name(s); a single-
 *  word name (a company, a mononym) becomes just the family name with
 *  an empty given name. */
function splitNameForN(fullName) {
  const trimmed = fullName.trim();
  const lastSpace = trimmed.lastIndexOf(' ');
  if (lastSpace === -1) return { family: trimmed, given: '' };
  return { family: trimmed.slice(lastSpace + 1), given: trimmed.slice(0, lastSpace) };
}

/** Builds one heading's own VCARD block (an array of already-folded
 *  lines), or null if this heading isn't a valid, exportable contact
 *  at all -- either requirement (1) EMAIL present, (2) not :IGNORE: t
 *  fails. */
function buildVcard(heading, birthdayProperty) {
  const email = getProperty(heading, 'EMAIL');
  if (!email) return null;
  const ignore = getProperty(heading, 'IGNORE');
  if (ignore && String(ignore).trim().toLowerCase() === 't') return null;

  const fullName = heading.title || '(untitled)';
  const { family, given } = splitNameForN(fullName);

  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${escapeVcardText(fullName)}`, `N:${escapeVcardText(family)};${escapeVcardText(given)};;;`, `EMAIL:${escapeVcardText(email)}`];

  const phone = getProperty(heading, 'PHONE') || getProperty(heading, 'CELL');
  if (phone) lines.push(`TEL:${escapeVcardText(phone)}`);
  const workPhone = getProperty(heading, 'WORK_PHONE');
  if (workPhone) lines.push(`TEL;TYPE=WORK:${escapeVcardText(workPhone)}`);
  const address = getProperty(heading, 'ADDRESS') || getProperty(heading, 'ADR');
  if (address) lines.push(`ADR:;;${escapeVcardText(address)};;;;`);
  const nickname = getProperty(heading, 'NICKNAME');
  if (nickname) lines.push(`NICKNAME:${escapeVcardText(nickname)}`);
  const note = getProperty(heading, 'NOTE');
  if (note) lines.push(`NOTE:${escapeVcardText(note)}`);
  const birthdayRaw = getProperty(heading, birthdayProperty);
  if (birthdayRaw) {
    const bday = parseBirthdayDate(birthdayRaw);
    if (bday) lines.push(`BDAY:${bday.year}-${pad2(bday.month)}-${pad2(bday.day)}`);
  }

  lines.push('END:VCARD');
  return lines.map(foldLine);
}

/**
 * Exports every valid contact across `docs` (an array of `{
 * documentId, doc }` pairs, matching export-icalendar.js's own input
 * shape) to a complete .vcf file string. `opts.scope`, when given a
 * single heading, restricts the scan to that heading's own subtree
 * only (itself and its descendants) -- the same convention
 * exportToIcalendar itself already uses. `opts.birthdayProperty`
 * defaults to "BIRTHDAY", matching org-contacts-birthday-property's
 * own default and this app's already-established handling of it for
 * org-contacts-anniversaries.
 *
 * `opts.nameFilter`, when given a non-empty string, restricts the
 * export to only those contacts whose own heading title matches it --
 * the same scope and behavior as real org-contacts-export-as-vcard's
 * own optional NAME argument, confirmed directly against the actual
 * org-contacts.el source: NAME is passed straight through to
 * (org-contacts-filter name), which matches ONLY against a contact's
 * own name (the heading title), via Emacs's string-match-p -- never
 * against property keys or values at all, regardless of this app's
 * own earlier description. `opts.nameFilterRegex` (default false)
 * selects Emacs-style regex matching (case-insensitive, matching
 * string-match-p's own default there) when true, matching real
 * org-contacts' own always-regex behavior -- or a plain, case-
 * insensitive substring match when false, a friendlier option real
 * org-contacts doesn't offer at all. An invalid regex throws a clear,
 * catchable error rather than silently matching nothing or crashing
 * with an unhelpful native RegExp message.
 */
export function exportToVcard(docs, opts = {}) {
  const { scope = null, birthdayProperty = 'BIRTHDAY', nameFilter = '', nameFilterRegex = false } = opts;
  const trimmedFilter = nameFilter.trim();
  let filterRe = null;
  if (trimmedFilter) {
    if (nameFilterRegex) {
      try {
        filterRe = new RegExp(trimmedFilter, 'i');
      } catch (err) {
        throw new Error(`Invalid regex in the contact name filter: ${err.message}`);
      }
    } else {
      filterRe = new RegExp(trimmedFilter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    }
  }

  const cards = [];
  const walkScope = (doc, visit) => walkHeadings(scope ? { children: [scope] } : doc, visit);

  for (const { doc } of docs) {
    walkScope(doc, (heading) => {
      if (isArchived(heading)) return;
      if (isCommentedHeading(heading)) return;
      if (filterRe && !filterRe.test(heading.title || '')) return;
      const card = buildVcard(heading, birthdayProperty);
      if (card) cards.push(card);
    });
  }

  return cards.flat().join('\r\n') + (cards.length ? '\r\n' : '');
}
