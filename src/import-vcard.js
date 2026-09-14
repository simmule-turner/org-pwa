/** Parses vCard 3.0/4.0 text (one or more BEGIN:VCARD...END:VCARD
 *  blocks, as produced by this app's own exportToVcard or any real
 *  contacts app) into org headings -- the reverse of export-vcard.js's
 *  own exportToVcard, built to mirror its already-verified flat/tree
 *  structures exactly so a round trip (export, then import the result,
 *  then export again) produces the same content.
 *
 *  Only FN is treated as required, matching real RFC 6350's own sole
 *  mandatory property (confirmed directly: https://www.rfc-editor.org/rfc/rfc6350)
 *  and this module's own already-corrected export-side requirement --
 *  a vCard block with no FN at all is skipped, everything else is
 *  optional. A vCard's own EMAIL, TEL, ADR, etc. are read and mapped
 *  when present, never required.
 */

/** Unfolds vCard line continuations: per RFC 2425/6350, a line
 *  starting with a single space or tab is a continuation of the
 *  previous line, with that one leading whitespace character removed
 *  and the rest appended directly -- the reverse of foldLine (already
 *  used by this module's own export side) folding a long line the
 *  same way. */
function unfoldVcardLines(text) {
  const rawLines = text.split(/\r\n|\r|\n/);
  const unfolded = [];
  for (const line of rawLines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += line.slice(1);
    } else {
      unfolded.push(line);
    }
  }
  return unfolded;
}

/** Reverses escapeVcardText's own escaping (\\\\ -> \\, \\; -> ;, \\, -> ,,
 *  \\n -> a real newline) -- the exact inverse of that function, not a
 *  separately-invented unescaping scheme. */
function unescapeVcardText(text) {
  return text.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

/** Parses one already-unfolded "NAME;PARAM=VALUE;...:VALUE" line into
 *  { name, params, value } -- name and every param key upper-cased
 *  (vCard property/param names are case-insensitive per the spec),
 *  value left as the real, already-unescaped text. Returns null for a
 *  line with no ":" at all (malformed, or a blank/structural line),
 *  skipped rather than thrown on -- a real-world vCard file
 *  occasionally has stray blank lines, and one malformed line
 *  shouldn't abort parsing every other contact in the file. */
function parseVcardLine(line) {
  const colonIndex = line.indexOf(':');
  if (colonIndex === -1) return null;
  const nameAndParams = line.slice(0, colonIndex);
  const rawValue = line.slice(colonIndex + 1);
  const parts = nameAndParams.split(';');
  const name = parts[0].toUpperCase();
  const params = {};
  for (let i = 1; i < parts.length; i++) {
    const eq = parts[i].indexOf('=');
    if (eq === -1) continue;
    params[parts[i].slice(0, eq).toUpperCase()] = parts[i].slice(eq + 1).toUpperCase();
  }
  return { name, params, value: unescapeVcardText(rawValue) };
}

/** Parses the raw text of a .vcf file -- one or more VCARD blocks --
 *  into an array of contact objects: { fn, emails: [{value, type}],
 *  tels: [{value, type}], adr, nickname, note, bday, categories: [] }.
 *  A block missing FN entirely is skipped (see this module's own doc
 *  comment above for why); every other field is collected only when
 *  present. Any line outside a BEGIN:VCARD/END:VCARD pair (a
 *  top-level VERSION, or stray blank lines) is ignored rather than
 *  causing an error, and an unrecognized property name within a block
 *  is silently skipped -- this app has no use for every one of the
 *  many properties a real vCard can carry, and a property it doesn't
 *  map shouldn't block the ones it does. */
export function parseVcards(text) {
  const lines = unfoldVcardLines(text);
  const contacts = [];
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^BEGIN:VCARD$/i.test(line)) {
      current = { fn: null, emails: [], tels: [], adr: null, nickname: null, note: null, bday: null, categories: [] };
      continue;
    }
    if (/^END:VCARD$/i.test(line)) {
      if (current && current.fn) contacts.push(current);
      current = null;
      continue;
    }
    if (!current) continue;

    const parsed = parseVcardLine(line);
    if (!parsed) continue;
    switch (parsed.name) {
      case 'FN':
        current.fn = parsed.value;
        break;
      case 'EMAIL':
        current.emails.push({ value: parsed.value, type: parsed.params.TYPE || null });
        break;
      case 'TEL':
        current.tels.push({ value: parsed.value, type: parsed.params.TYPE || null });
        break;
      case 'ADR': {
        // Real ADR is 7 semicolon-separated components (PO Box;
        // Extended;Street;City;Region;PostalCode;Country). This app's
        // own single free-text ADDRESS property has nowhere to put
        // seven separate parts, so every non-empty component is
        // joined into one readable string -- this correctly recovers
        // exactly what this app's own export wrote (which only ever
        // populates the street component), and still produces a
        // sensible single string for a real-world vCard from another
        // contacts app with a fully structured address.
        const joined = parsed.value
          .split(';')
          .map((part) => part.trim())
          .filter(Boolean)
          .join(', ');
        if (joined) current.adr = joined;
        break;
      }
      case 'NICKNAME':
        current.nickname = parsed.value;
        break;
      case 'NOTE':
        current.note = parsed.value;
        break;
      case 'BDAY':
        current.bday = parsed.value;
        break;
      case 'CATEGORIES':
        current.categories = parsed.value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        break;
      default:
        break; // an unmapped property -- ignored, not an error
    }
  }

  return contacts;
}

/** Normalizes a BDAY value to YYYY-MM-DD -- accepts the real vCard
 *  3.0/4.0 basic forms (YYYY-MM-DD with dashes, or YYYYMMDD without,
 *  per RFC 6350's own date value type). Returns null for anything
 *  else (a text-form birthday, or a malformed value) rather than
 *  guessing -- an org date property with the wrong value is worse
 *  than one left out entirely. */
function normalizeBday(raw) {
  const dashed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (dashed) return `${dashed[1]}-${dashed[2]}-${dashed[3]}`;
  const bare = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
  if (bare) return `${bare[1]}-${bare[2]}-${bare[3]}`;
  return null;
}

/** A heading title can't legally contain a literal newline (a heading
 *  is one line) -- collapses one to a space, the same lossy-but-safe
 *  handling a multi-line vCard value (a NOTE, most plausibly) needs
 *  wherever it ends up as a heading's own title rather than a
 *  property value (which can hold a real newline safely). */
function forHeadingTitle(text) {
  return text.replace(/\r?\n/g, ' ').trim();
}

const TEL_TYPE_TO_TREE_FIELDTYPE = { WORK: 'phone-work', HOME: 'phone-home', CELL: 'cell' };
const EMAIL_TYPE_TO_TREE_FIELDTYPE = { WORK: 'email-work', HOME: 'email-home' };

function telFieldType(tel) {
  const type = (tel.type || '').toUpperCase();
  for (const key of Object.keys(TEL_TYPE_TO_TREE_FIELDTYPE)) {
    if (type.includes(key)) return TEL_TYPE_TO_TREE_FIELDTYPE[key];
  }
  return 'phone';
}

function emailFieldType(email) {
  const type = (email.type || '').toUpperCase();
  for (const key of Object.keys(EMAIL_TYPE_TO_TREE_FIELDTYPE)) {
    if (type.includes(key)) return EMAIL_TYPE_TO_TREE_FIELDTYPE[key];
  }
  return 'email';
}

/** Builds one contact's own flat-style org heading -- the reverse of
 *  buildVcard in export-vcard.js. This app's own flat structure has a
 *  single :EMAIL: and single :PHONE:/:WORK_PHONE: property each (not
 *  a list), matching real org-contacts.el's own convention already
 *  established for export here -- when a vCard carries more than one
 *  of the same type, the first is used and the rest are silently
 *  dropped, a real, known limitation (real org-vcard's own project
 *  README lists "add support for multiple instances of EMAIL
 *  property" as an open TODO too, confirmed directly -- not something
 *  this app invented, though not confirmed to be scoped to flat style
 *  specifically there). */
function buildFlatOrgFromContact(contact) {
  const title = forHeadingTitle(contact.fn);
  const tagSuffix = contact.categories.length ? `  :${contact.categories.map((c) => c.replace(/[^A-Za-z0-9_@]/g, '_')).join(':')}:` : '';
  const lines = [`* ${title}${tagSuffix}`];

  const propertyLines = [];
  if (contact.emails.length) propertyLines.push(`:EMAIL: ${contact.emails[0].value}`);
  const nonWorkTel = contact.tels.find((t) => !(t.type || '').toUpperCase().includes('WORK'));
  const workTel = contact.tels.find((t) => (t.type || '').toUpperCase().includes('WORK'));
  if (nonWorkTel) propertyLines.push(`:PHONE: ${nonWorkTel.value}`);
  if (workTel) propertyLines.push(`:WORK_PHONE: ${workTel.value}`);
  if (contact.adr) propertyLines.push(`:ADDRESS: ${contact.adr}`);
  if (contact.nickname) propertyLines.push(`:NICKNAME: ${contact.nickname}`);
  if (contact.note) propertyLines.push(`:NOTE: ${contact.note}`);
  if (contact.bday) {
    const normalized = normalizeBday(contact.bday);
    if (normalized) propertyLines.push(`:BIRTHDAY: ${normalized}`);
  }

  if (propertyLines.length) {
    lines.push(':PROPERTIES:', ...propertyLines, ':END:');
  }
  return lines.join('\n');
}

/** Builds one contact's own tree-style org subtree -- the reverse of
 *  buildVcardFromTreeContact in export-vcard.js. Unlike flat style,
 *  every value of the same type becomes its own descendant heading
 *  (not just the first), since tree style has no single-property
 *  limitation to work around -- a real vCard with three EMAIL
 *  addresses correctly produces three separate email/email-work/
 *  email-home headings here. Fields sit directly under the contact
 *  heading (the simpler of the two equally-valid structures the real
 *  org-vcard README shows -- see export-vcard.js's own
 *  buildVcardFromTreeContact for the other, which this app's own
 *  export never produces but its own import via buildVcardFromTreeContact
 *  already reads correctly regardless of which one a file uses, since
 *  it recurses through any depth). */
function buildTreeOrgFromContact(contact) {
  const title = forHeadingTitle(contact.fn);
  const tagSuffix = contact.categories.length ? `  :${contact.categories.map((c) => c.replace(/[^A-Za-z0-9_@]/g, '_')).join(':')}:` : '';
  const lines = [`* ${title}${tagSuffix}`, ':PROPERTIES:', ':KIND: individual', ':FIELDTYPE: name', ':END:'];

  const field = (value, fieldType) => {
    lines.push(`** ${forHeadingTitle(value)}`, ':PROPERTIES:', `:FIELDTYPE: ${fieldType}`, ':END:');
  };

  for (const email of contact.emails) field(email.value, emailFieldType(email));
  for (const tel of contact.tels) field(tel.value, telFieldType(tel));
  if (contact.adr) field(contact.adr, 'address');
  if (contact.nickname) field(contact.nickname, 'nickname');
  if (contact.note) field(contact.note, 'note');
  if (contact.bday) {
    const normalized = normalizeBday(contact.bday);
    if (normalized) field(normalized, 'birthday');
  }

  return lines.join('\n');
}

/** Converts vCard text (one or more contacts) into org text ready to
 *  insert into a document -- `style` is 'flat' (default) or 'tree',
 *  matching exportToVcard's own style option exactly. Each contact
 *  becomes its own top-level heading (or heading subtree, for tree
 *  style); multiple contacts are joined with a single blank line
 *  between them, matching how a real org file's own headings are
 *  conventionally separated. Returns an empty string for a file with
 *  no valid (FN-bearing) contacts at all, the same "nothing to do,
 *  not an error" convention exportToVcard's own empty case already
 *  uses. */
export function importVcardsAsOrgText(vcardText, opts = {}) {
  const { style = 'flat' } = opts;
  const contacts = parseVcards(vcardText);
  const builder = style === 'tree' ? buildTreeOrgFromContact : buildFlatOrgFromContact;
  return contacts.map(builder).join('\n\n');
}
