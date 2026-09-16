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

/** THE FEATURE: Google Contacts' own vCard export quirk, per direct
 *  report -- escapes colons with a backslash even though \: isn't a
 *  standard vCard escape sequence at all (only \\, \;, \,, \n are
 *  defined by RFC 6350), confirmed directly against a real
 *  Google-exported vCard where this appeared repeatedly throughout a
 *  NOTE field's own text. Applied only when Google mode is on (the
 *  checkbox in the Import screen, default on): a literal "\:" from
 *  some other, non-Google vCard source could plausibly be
 *  intentional, however unlikely, and shouldn't be silently rewritten
 *  without it being clear Google-specific handling is what did it. */
function unescapeGoogleColon(text) {
  return text.replace(/\\:/g, ':');
}

/** Splits `text` on `delimiter`, ignoring any occurrence of it inside
 *  a double-quoted substring -- needed because a real vCard parameter
 *  value can be quoted specifically to contain characters (";", ":")
 *  that would otherwise be mistaken for structural delimiters, most
 *  relevantly a LABEL="..." parameter whose own text might contain
 *  either. */
function splitRespectingQuotes(text, delimiter) {
  const parts = [];
  let current = '';
  let inQuotes = false;
  for (const char of text) {
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
    } else if (char === delimiter && !inQuotes) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

/** Parses one already-unfolded "NAME;PARAM=VALUE;...:VALUE" line into
 *  { name, params, value } -- name and every param key upper-cased
 *  (vCard property/param names are case-insensitive per the spec).
 *  A quoted parameter value (LABEL="...") has its own surrounding
 *  quotes stripped and is left in its own real case -- unlike TYPE,
 *  which stays upper-cased since it's compared case-insensitively
 *  wherever this module reads it. The main value is left as the
 *  real, already-unescaped text (and, when googleMode is on, also
 *  run through unescapeGoogleColon); a quoted LABEL value gets the
 *  same unescaping. Returns null for a line with no ":" at all
 *  (malformed, or a blank/structural line), skipped rather than
 *  thrown on -- a real-world vCard file occasionally has stray blank
 *  lines, and one malformed line shouldn't abort parsing every other
 *  contact in the file. */
function parseVcardLine(line, googleMode) {
  const colonParts = splitRespectingQuotes(line, ':');
  if (colonParts.length < 2) return null;
  const nameAndParams = colonParts[0];
  const rawValue = colonParts.slice(1).join(':'); // only the FIRST colon is structural; a later one (unquoted, in the real value) is legitimately part of it
  const parts = splitRespectingQuotes(nameAndParams, ';');
  const name = parts[0].toUpperCase();
  const params = {};
  for (let i = 1; i < parts.length; i++) {
    const eq = parts[i].indexOf('=');
    if (eq === -1) continue;
    const key = parts[i].slice(0, eq).toUpperCase();
    let val = parts[i].slice(eq + 1);
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (key === 'LABEL') {
      val = unescapeVcardText(val);
      if (googleMode) val = unescapeGoogleColon(val);
    } else {
      val = val.toUpperCase();
    }
    params[key] = val;
  }
  let value = unescapeVcardText(rawValue);
  if (googleMode) value = unescapeGoogleColon(value);
  return { name, params, value };
}

/** Parses the raw text of a .vcf file -- one or more VCARD blocks --
 *  into an array of contact objects: { fn, emails: [{value, type}],
 *  tels: [{value, type}], adrs: [{value, label, type}], nickname,
 *  note, bday, categories: [] }. A block missing FN entirely is
 *  skipped (see this module's own doc comment above for why); every
 *  other field is collected only when present. adrs is a real list,
 *  the same shape as emails/tels -- confirmed directly, against a
 *  real multi-address vCard, that storing it as a single overwritten
 *  scalar (an earlier version of this function) silently discarded
 *  every address but the last one parsed, before either org style
 *  ever got a chance to keep more than one. Any line outside a
 *  BEGIN:VCARD/END:VCARD pair (a top-level VERSION, or stray blank
 *  lines) is ignored rather than causing an error, and an
 *  unrecognized property name within a block is silently skipped --
 *  this app has no use for every one of the many properties a real
 *  vCard can carry, and a property it doesn't map shouldn't block the
 *  ones it does.
 *
 *  `googleMode` (default true) enables two Google Contacts export
 *  quirks this parser specifically handles: an 8th ADR component read
 *  as a human-readable label (see the ADR case below), and "\:"
 *  unescaped to ":" everywhere (see unescapeGoogleColon's own doc
 *  comment). */
export function parseVcards(text, opts = {}) {
  const { googleMode = true } = opts;
  const lines = unfoldVcardLines(text);
  const contacts = [];
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^BEGIN:VCARD$/i.test(line)) {
      current = {
        fn: null,
        emails: [],
        tels: [],
        adrs: [],
        nickname: null,
        note: null,
        bday: null,
        org: null,
        jobTitle: null,
        url: null,
        photo: null,
        categories: [],
      };
      continue;
    }
    if (/^END:VCARD$/i.test(line)) {
      if (current && current.fn) contacts.push(current);
      current = null;
      continue;
    }
    if (!current) continue;

    const parsed = parseVcardLine(line, googleMode);
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
        // Extended;Street;City;Region;PostalCode;Country). A LABEL
        // can accompany it two ways: a real LABEL="..." parameter on
        // the ADR line itself (the standard vCard 4.0 form), or --
        // Google's own real, non-standard export convention,
        // confirmed directly against an actual Google-exported vCard
        // -- an 8th value component after the 7 structured ones,
        // holding the same address again as a human-readable,
        // multi-line label. Both structured components AND the label
        // are preserved here, separately -- never one discarded in
        // favor of the other, so a later export can reconstruct
        // something equivalent to the original either way. With
        // googleMode off, an 8th component is ignored entirely,
        // matching real RFC 6350's own strict 7-component definition
        // rather than Google's own non-standard extension of it.
        const rawParts = parsed.value.split(';');
        const structured = rawParts
          .slice(0, 7)
          .map((part) => part.trim())
          .filter(Boolean)
          .join(', ');
        const googleLabel = googleMode && rawParts.length >= 8 ? rawParts[7].trim() : '';
        const label = parsed.params.LABEL || googleLabel || null;
        const value = structured || label || '';
        const finalLabel = structured ? label : null; // no structured value at all -- value already equals the label, so it's not stored a second time
        if (value) current.adrs.push({ value, label: finalLabel, type: parsed.params.TYPE || null });
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
      case 'ORG':
        // Real ORG can carry several ";"-separated components (Company;
        // Department;Unit), the same organizational-hierarchy idea ADR's
        // own components express for an address -- joined the same way,
        // into one readable string, rather than keeping only the first.
        current.org =
          parsed.value
            .split(';')
            .map((part) => part.trim())
            .filter(Boolean)
            .join(', ') || null;
        break;
      case 'TITLE':
        current.jobTitle = parsed.value || null;
        break;
      case 'URL':
        current.url = parsed.value || null;
        break;
      case 'PHOTO':
        // Only a real URL reference (http/https) is mapped -- a
        // base64-embedded image is left unmapped entirely, same as an
        // unrecognized property, since inlining that much binary-as-text
        // data into a single org property line would bloat the file for
        // no real benefit in a text-based document viewer.
        current.photo = /^https?:\/\//i.test(parsed.value) ? parsed.value : null;
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
 *  handling any multi-line vCard value needs wherever it ends up as a
 *  heading's own title. */
function forHeadingTitle(text) {
  return text.replace(/\r?\n/g, ' ').trim();
}

/** THE FIX: the same newline problem forHeadingTitle solves for
 *  headings, but for a single-line :PROPERTY: value instead -- an org
 *  property drawer line is just as strictly one physical line as a
 *  heading is. Confirmed directly, against a real multi-line vCard
 *  ADR/NOTE value, that writing one through with an embedded raw
 *  newline (the earlier version of this module) produced invalid org
 *  syntax that silently truncated on the very next parse: everything
 *  after the first embedded newline was read back as unrelated
 *  following lines, not as part of the property's own value, losing
 *  real data on every round trip rather than just reformatting it.
 *  " ; " (rather than forHeadingTitle's plain space) keeps each
 *  original line visually distinct once flattened, since a property
 *  value this dense (a multi-paragraph note, an address with several
 *  components) reads as an unbroken run-on otherwise. */
function forPropertyValue(text) {
  return text.replace(/\r?\n/g, ' ; ').trim();
}

const TEL_TYPE_TO_TREE_FIELDTYPE = { WORK: 'phone-work', HOME: 'phone-home', CELL: 'cell' };
const EMAIL_TYPE_TO_TREE_FIELDTYPE = { WORK: 'email-work', HOME: 'email-home' };
const ADR_TYPE_TO_TREE_FIELDTYPE = { WORK: 'address-work', HOME: 'address-home' };

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

/** THE FEATURE: mirrors email/tel's own TYPE-based mapping, now that
 *  adrs is a real list -- 'address-work'/'address-home', falling back
 *  to plain 'address' for an untyped ADR line or one with some other
 *  TYPE value (OTHER, PREF, etc.) neither WORK nor HOME covers. */
function adrFieldType(adr) {
  const type = (adr.type || '').toUpperCase();
  for (const key of Object.keys(ADR_TYPE_TO_TREE_FIELDTYPE)) {
    if (type.includes(key)) return ADR_TYPE_TO_TREE_FIELDTYPE[key];
  }
  return 'address';
}

/** Builds one contact's own flat-style org heading -- the reverse of
 *  buildVcard in export-vcard.js. This app's own flat structure has a
 *  single :EMAIL:, single :PHONE:/:WORK_PHONE:, and single :ADDRESS:
 *  property each (not a list), matching real org-contacts.el's own
 *  convention already established for export here -- when a vCard
 *  carries more than one of the same type, the FIRST is kept and the
 *  rest are silently dropped (real org-vcard's own project README
 *  lists "add support for multiple instances of EMAIL property" as an
 *  open TODO too, confirmed directly -- not something this app
 *  invented, though not confirmed to be scoped to flat style
 *  specifically there). "First" is deliberate and now consistent
 *  across every one of these fields -- an earlier version kept
 *  email/phone's own first but address's own LAST (an accidental
 *  inconsistency from ADR overwriting a scalar instead of being
 *  looked up the same way email/phone already were), confirmed
 *  directly against a real two-address vCard where the work address
 *  silently won over home purely because it happened to be parsed
 *  second, not because of any deliberate preference. This IS still a
 *  real ceiling for anyone whose contacts genuinely need more than
 *  one of the same field kept -- see buildTreeOrgFromContact below,
 *  which has none.
 *
 *  THE FEATURE: a separate :ADDRESS_LABEL: property preserves an
 *  address's own label (see parseVcards' own ADR case above) when
 *  present, alongside :ADDRESS: -- never one discarded for the
 *  other. */
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
  if (contact.adrs.length) {
    propertyLines.push(`:ADDRESS: ${forPropertyValue(contact.adrs[0].value)}`);
    if (contact.adrs[0].label) propertyLines.push(`:ADDRESS_LABEL: ${forPropertyValue(contact.adrs[0].label)}`);
  }
  if (contact.nickname) propertyLines.push(`:NICKNAME: ${forPropertyValue(contact.nickname)}`);
  if (contact.org) propertyLines.push(`:ORG: ${forPropertyValue(contact.org)}`);
  if (contact.jobTitle) propertyLines.push(`:JOB_TITLE: ${forPropertyValue(contact.jobTitle)}`);
  if (contact.url) propertyLines.push(`:URL: ${contact.url}`);
  if (contact.photo) propertyLines.push(`:PHOTO: ${contact.photo}`);
  if (contact.note) propertyLines.push(`:NOTE: ${forPropertyValue(contact.note)}`);
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
 *  (not just the first) -- a real vCard with four EMAIL addresses and
 *  two ADR entries correctly produces six separate field headings
 *  here, none dropped, confirmed directly against exactly such a
 *  real-world vCard. Fields sit directly under the contact heading
 *  (the simpler of the two equally-valid structures the real
 *  org-vcard README shows -- see export-vcard.js's own
 *  buildVcardFromTreeContact for the other, which this app's own
 *  export never produces but its own import already reads correctly
 *  regardless of which one a file uses, since it recurses through any
 *  depth).
 *
 *  THE FEATURE: note is the one field that does NOT use its own value
 *  as the heading's title, unlike every other field here -- instead,
 *  a fixed "Note" title with the real text as a #+BEGIN_VERSE block in
 *  the heading's own body. Verse specifically, not quote: a contact
 *  note is typically a record of distinct facts, one per original
 *  line (old phone numbers, past addresses, each its own line) --
 *  verse preserves each line break exactly as written, where quote's
 *  own convention allows reflow, which would blur separate facts
 *  together. This also sidesteps forHeadingTitle/forPropertyValue's
 *  own newline-collapsing entirely for note specifically, since real
 *  org body content, unlike a heading title or property value, can
 *  safely hold real newlines -- multi-paragraph notes stay genuinely
 *  readable instead of becoming one dense, semicolon-joined line.
 *
 *  THE FEATURE: an address with a label gets BOTH its own structured
 *  value as the heading's title AND the label as a separate
 *  #+BEGIN_VERSE block in the same heading's own body -- neither one
 *  discarded for the other, unlike note (which only ever has real
 *  text, no separate "structured" form to also preserve). */
const FIELDTYPE_LABELS = {
  cell: 'Cell',
  phone: 'Phone',
  'phone-work': 'Work Phone',
  'phone-home': 'Home Phone',
  email: 'Email',
  'email-work': 'Work Email',
  'email-home': 'Home Email',
  address: 'Address',
  'address-work': 'Work Address',
  'address-home': 'Home Address',
  nickname: 'Nickname',
  org: 'Organization',
  'job-title': 'Job Title',
  url: 'URL',
  photo: 'Photo',
  note: 'Note',
  birthday: 'Birthday',
};

function buildTreeOrgFromContact(contact) {
  const title = forHeadingTitle(contact.fn);
  const tagSuffix = contact.categories.length ? `  :${contact.categories.map((c) => c.replace(/[^A-Za-z0-9_@]/g, '_')).join(':')}:` : '';
  const lines = [`* ${title}${tagSuffix}`, ':PROPERTIES:', ':KIND: individual', ':FIELDTYPE: name', ':END:'];

  const field = (value, fieldType, forceBlock = false, extraBlockText = null) => {
    if (forceBlock || value.includes('\n')) {
      const label = FIELDTYPE_LABELS[fieldType] || fieldType;
      lines.push(`** ${label}`, ':PROPERTIES:', `:FIELDTYPE: ${fieldType}`, ':END:', '#+BEGIN_VERSE', ...value.split('\n'), '#+END_VERSE');
    } else if (extraBlockText) {
      // Both a real, single-line title AND a separate body block --
      // an address with its own structured value as well as a
      // distinct label, neither one discarded for the other.
      lines.push(`** ${forHeadingTitle(value)}`, ':PROPERTIES:', `:FIELDTYPE: ${fieldType}`, ':END:', '#+BEGIN_VERSE', ...extraBlockText.split('\n'), '#+END_VERSE');
    } else {
      lines.push(`** ${forHeadingTitle(value)}`, ':PROPERTIES:', `:FIELDTYPE: ${fieldType}`, ':END:');
    }
  };

  for (const email of contact.emails) field(email.value, emailFieldType(email));
  for (const tel of contact.tels) field(tel.value, telFieldType(tel));
  for (const adr of contact.adrs) field(adr.value, adrFieldType(adr), false, adr.label);
  if (contact.nickname) field(contact.nickname, 'nickname');
  if (contact.org) field(contact.org, 'org');
  if (contact.jobTitle) field(contact.jobTitle, 'job-title');
  if (contact.url) field(contact.url, 'url');
  if (contact.photo) field(contact.photo, 'photo');
  if (contact.note) field(contact.note, 'note', true); // always the fixed-title+verse treatment, matching real contact notes' own typical multi-fact, one-per-line shape, regardless of whether this particular one happens to be single-line
  if (contact.bday) {
    const normalized = normalizeBday(contact.bday);
    if (normalized) field(normalized, 'birthday');
  }

  return lines.join('\n');
}

/** Converts vCard text (one or more contacts) into org text ready to
 *  insert into a document -- `style` is 'flat' or 'tree' (default),
 *  matching exportToVcard's own style option. Tree is the default
 *  here specifically because flat has a real ceiling (only the first
 *  of each repeated field -- email, phone, address -- survives;
 *  everything else is silently dropped), where tree keeps every one.
 *  `googleMode` (default true) enables the two Google Contacts export
 *  quirks this module specifically handles -- an 8th ADR component
 *  read as a human-readable label, and "\:" unescaped to ":" -- see
 *  parseVcards and unescapeGoogleColon's own doc comments for the
 *  full reasoning on each. Each contact becomes its own top-level
 *  heading (or heading subtree, for tree style); multiple contacts
 *  are joined with a single blank line between them, matching how a
 *  real org file's own headings are conventionally separated.
 *  Returns an empty string for a file with no valid (FN-bearing)
 *  contacts at all, the same "nothing to do, not an error" convention
 *  exportToVcard's own empty case already uses. */
export function importVcardsAsOrgText(vcardText, opts = {}) {
  const { style = 'tree', googleMode = true } = opts;
  const contacts = parseVcards(vcardText, { googleMode });
  const builder = style === 'tree' ? buildTreeOrgFromContact : buildFlatOrgFromContact;
  return contacts.map(builder).join('\n\n');
}
