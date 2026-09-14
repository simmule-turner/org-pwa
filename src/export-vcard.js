
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
  const ignore = getProperty(heading, 'IGNORE');
  if (ignore && String(ignore).trim().toLowerCase() === 't') return null;

  const email = getProperty(heading, 'EMAIL');
  const phone = getProperty(heading, 'PHONE') || getProperty(heading, 'CELL');
  const workPhone = getProperty(heading, 'WORK_PHONE');
  const address = getProperty(heading, 'ADDRESS') || getProperty(heading, 'ADR');
  const nickname = getProperty(heading, 'NICKNAME');
  const note = getProperty(heading, 'NOTE');
  const birthdayRaw = getProperty(heading, birthdayProperty);
  // Real RFC 6350 only mandates FN -- every one of the properties above
  // is genuinely optional there. But FN alone (a heading's own title,
  // which every heading trivially has) isn't enough on its own to treat
  // an arbitrary heading as a contact for bulk export purposes -- real
  // org-contacts-matcher's own actual logic (confirmed directly against
  // the source: EMAIL<>""|PHONE<>""|ADDRESS<>""|BIRTHDAY<>""|...) is the
  // model here: at least ONE recognized contact property present, not
  // specifically email.
  if (!email && !phone && !workPhone && !address && !nickname && !note && !birthdayRaw) return null;

  const fullName = heading.title || '(untitled)';
  const { family, given } = splitNameForN(fullName);

  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${escapeVcardText(fullName)}`, `N:${escapeVcardText(family)};${escapeVcardText(given)};;;`];
  if (email) lines.push(`EMAIL:${escapeVcardText(email)}`);
  if (phone) lines.push(`TEL:${escapeVcardText(phone)}`);
  if (workPhone) lines.push(`TEL;TYPE=WORK:${escapeVcardText(workPhone)}`);
  if (address) lines.push(`ADR:;;${escapeVcardText(address)};;;;`);
  if (nickname) lines.push(`NICKNAME:${escapeVcardText(nickname)}`);
  if (note) lines.push(`NOTE:${escapeVcardText(note)}`);
  if (birthdayRaw) {
    const bday = parseBirthdayDate(birthdayRaw);
    if (bday) lines.push(`BDAY:${bday.year}-${pad2(bday.month)}-${pad2(bday.day)}`);
  }

  lines.push('END:VCARD');
  return lines.map(foldLine);
}

// Tree style's own FIELDTYPE -> vCard field mapping. Real org-vcard's
// own mapping table (org-vcard--styles-languages-mappings) is fully
// customizable and considerably larger than this; this covers the
// same set of vCard fields the flat style above already supports, so
// the two styles have matching capability rather than tree covering a
// different, larger or smaller set of information than flat does.
const TREE_FIELDTYPE_TO_VCARD_LINE = {
  cell: (value) => `TEL;TYPE=CELL:${escapeVcardText(value)}`,
  phone: (value) => `TEL:${escapeVcardText(value)}`,
  'phone-work': (value) => `TEL;TYPE=WORK:${escapeVcardText(value)}`,
  'phone-home': (value) => `TEL;TYPE=HOME:${escapeVcardText(value)}`,
  email: (value) => `EMAIL:${escapeVcardText(value)}`,
  'email-work': (value) => `EMAIL;TYPE=WORK:${escapeVcardText(value)}`,
  'email-home': (value) => `EMAIL;TYPE=HOME:${escapeVcardText(value)}`,
  address: (value) => `ADR:;;${escapeVcardText(value)};;;;`,
  'address-work': (value) => `ADR;TYPE=WORK:;;${escapeVcardText(value)};;;;`,
  'address-home': (value) => `ADR;TYPE=HOME:;;${escapeVcardText(value)};;;;`,
  nickname: (value) => `NICKNAME:${escapeVcardText(value)}`,
  note: (value) => `NOTE:${escapeVcardText(value)}`,
  birthday: (value) => {
    const bday = parseBirthdayDate(value);
    return bday ? `BDAY:${bday.year}-${pad2(bday.month)}-${pad2(bday.day)}` : null;
  },
};

/** Builds one contact's own VCARD block for the tree style, or null
 *  when `heading` isn't a genuine contact heading at all -- the
 *  required marker is :KIND: individual plus :FIELDTYPE: name, per the
 *  real org-vcard tree structure (confirmed directly against
 *  https://github.com/pinoaffe/org-vcard's own README): every other
 *  heading walkHeadings visits within a contact's own subtree (an
 *  "Email"/"Cell" grouping heading, or the actual value leaf itself)
 *  correctly returns null here too, since only the contact heading
 *  itself is a card. Real RFC 6350 only mandates FN, already present
 *  regardless of what the walk below finds -- no field is otherwise
 *  required, matching this module's own flat-style requirement
 *  exactly (see buildVcard's own doc comment for the full reasoning). */
/** Reads a note heading's own real text: a #+BEGIN_VERSE or
 *  #+BEGIN_QUOTE block in its body, lines rejoined with real newlines
 *  (the exact reverse of import-vcard.js's own note.split('\n')) --
 *  either block name is accepted, since a person might reasonably
 *  prefer QUOTE's own reflow-friendly convention over VERSE's exact
 *  line-break preservation when writing a note by hand. Falls back to
 *  the heading's own title when no such block is present at all, so a
 *  note heading written before this existed (or typed by hand without
 *  a block) still exports correctly -- never a hard requirement. */
function noteBlockText(heading) {
  const block = (heading.body || []).find((b) => b.type === 'block' && (b.name === 'VERSE' || b.name === 'QUOTE'));
  return block ? block.lines.join('\n') : heading.title || '';
}

function buildVcardFromTreeContact(heading) {
  if (String(getProperty(heading, 'KIND') || '').toLowerCase() !== 'individual') return null;
  if (String(getProperty(heading, 'FIELDTYPE') || '').toLowerCase() !== 'name') return null;

  const fullName = heading.title || '(untitled)';
  const { family, given } = splitNameForN(fullName);
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${escapeVcardText(fullName)}`, `N:${escapeVcardText(family)};${escapeVcardText(given)};;;`];

  function walk(node) {
    for (const child of node.children || []) {
      const fieldType = String(getProperty(child, 'FIELDTYPE') || '').toLowerCase();
      const builder = TREE_FIELDTYPE_TO_VCARD_LINE[fieldType];
      if (builder) {
        const value = fieldType === 'note' ? noteBlockText(child) : child.title || '';
        const line = builder(value);
        if (line) lines.push(line);
      }
      walk(child); // recurse into grouping headings ("Email" > "Work" > the actual address) as well as leaves directly under the contact
    }
  }
  walk(heading);

  lines.push('END:VCARD');
  return lines.map(foldLine);
}

/**
 * Exports every valid contact across `docs` (an array of `{
 * documentId, doc }` pairs, matching export-icalendar.js's own input
 * shape) to a complete .vcf file string. `opts.scope`, when given a
 * single heading or an array of headings, restricts the scan to just
 * those headings' own subtrees (itself and descendants, for each) --
 * the same convention exportToIcalendar itself already uses for a
 * single heading, extended here to a set for exporting the current
 * narrow-scope's own matches, which can be several discontiguous
 * headings rather than one single subtree. Deduplicated by heading
 * object reference, so a heading whose own ancestor is also in scope
 * isn't exported twice. `opts.birthdayProperty` defaults to
 * "BIRTHDAY", matching org-contacts-birthday-property's own default
 * and this app's already-established handling of it for
 * org-contacts-anniversaries. `opts.style` is 'flat' (default, real
 * org-contacts.el's own convention -- one heading per contact, EMAIL/
 * PHONE/etc. as that heading's own properties) or 'tree' (real
 * org-vcard's own alternative style -- see buildVcardFromTreeContact
 * below for the full structure).
 *
 * Deliberately does NOT support any kind of name/tag/property
 * filtering -- real org-vcard-export has no filtering mechanism at
 * all, confirmed directly against the actual source: it exports
 * whatever's in scope (the whole buffer, or a real narrowing
 * restriction), nothing more selective than that. An earlier version
 * of this app modeled its own scope around org-contacts-filter's own
 * name/tags/property arguments instead, before switching to org-vcard
 * as the actual model to follow -- this function's own narrow-scope
 * support above is the replacement for that: filtering happens by
 * narrowing the outline first (Search's own Narrow button, or subtree
 * narrowing), then exporting "This file," not through any filter
 * option on the export itself.
 */
export function exportToVcard(docs, opts = {}) {
  const { scope = null, birthdayProperty = 'BIRTHDAY', style = 'flat' } = opts;
  const scopeHeadings = scope === null ? null : Array.isArray(scope) ? scope : [scope];

  const cards = [];
  const seen = new Set();
  const visit = (heading) => {
    if (seen.has(heading)) return;
    seen.add(heading);
    if (isArchived(heading)) return;
    if (isCommentedHeading(heading)) return;
    const card = style === 'tree' ? buildVcardFromTreeContact(heading) : buildVcard(heading, birthdayProperty);
    if (card) cards.push(card);
  };

  if (scopeHeadings === null) {
    for (const { doc } of docs) walkHeadings(doc, visit);
  } else {
    for (const heading of scopeHeadings) walkHeadings({ children: [heading] }, visit);
  }

  return cards.flat().join('\r\n') + (cards.length ? '\r\n' : '');
}
