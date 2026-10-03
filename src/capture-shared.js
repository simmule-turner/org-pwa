/**
 * Content that arrives from outside the app, for Capture: shared from another app (Android's share sheet, through
 * the manifest's share_target) or passed in a launch URL (`index.html?capture=KEY&text=...`). Everything here is
 * pure so it can be tested in Node, and all of it treats the incoming text as UNTRUSTED: it is only ever inserted
 * as document text by a capture template's %i, %a and %x, never as markup.
 */

const MAX_FIELD = 20000; // characters kept from any one parameter, so a huge share cannot flood the form
const URL_AT_END_RE = /(?:^|\s)(https?:\/\/\S+)\s*$/i;
const LINKABLE_RE = /^(?:https?|ftp|mailto):/i;

/** Android apps differ in how they share a page: some put the address in `url`, some put "Title\nhttps://..." or
 *  just the address in `text`. When there is no `url` but `text` ends with an http(s) address, move it to `url`. */
function normalizeShared({ title, text, url }) {
  if (!url && text) {
    const m = URL_AT_END_RE.exec(text);
    if (m) {
      url = m[1];
      text = text.slice(0, m.index).trim();
    }
  }
  return { title: title || '', text: text || '', url: url || '' };
}

/**
 * Reads a launch URL's query string. Returns null when it carries nothing for Capture, otherwise
 * `{ capture, shared }`: `capture` is the template key asked for ('' when the parameter is present but empty, meaning
 * "show the template list"; null when absent) and `shared` is `{ title, text, url }` or null when nothing was shared.
 */
function parseLaunchParams(search) {
  const params = new URLSearchParams(search || '');
  const field = (name) => (params.get(name) || '').slice(0, MAX_FIELD).trim();
  const shared = normalizeShared({ title: field('title'), text: field('text'), url: field('url') });
  const hasShared = !!(shared.title || shared.text || shared.url);
  const hasCapture = params.has('capture');
  if (!hasCapture && !hasShared) return null;
  return { capture: hasCapture ? field('capture') : null, shared: hasShared ? shared : null };
}

/** `%a`: the shared page as an org link, `[[url][title]]` or `[[url]]`, or '' when there is no usable address.
 *  Only web and mail addresses become links (anything else, such as a javascript: URL, is dropped), and brackets
 *  and spaces that would break the link are replaced. */
function sharedAnnotation({ title, url } = {}) {
  if (!url || !LINKABLE_RE.test(url)) return '';
  const target = url.replace(/\s/g, '%20').replace(/\[/g, '%5B').replace(/\]/g, '%5D');
  const label = (title || '').replace(/\s+/g, ' ').replace(/\[/g, '(').replace(/\]/g, ')').trim();
  return label ? `[[${target}][${label}]]` : `[[${target}]]`;
}

/**
 * Text for %i and %x, placed after `prefix` (whatever precedes the token on its line in the expanded template).
 * As org does, every line after the first gets that prefix, so an indented `  %i` stays indented. And because the text
 * is untrusted, a line that would become a heading (stars at the start of a line) or a `#+` keyword or block line
 * gets a leading comma, the same escape org uses inside blocks, so shared text can never change the document's
 * structure: a shared bullet list written with `* ` would otherwise turn into headings.
 */
function placeInsertedText(value, prefix) {
  const lines = String(value || '').replace(/\r\n?/g, '\n').split('\n');
  const lead = prefix.trim() === '' ? prefix : null; // null: the template's own text precedes it, so it cannot start a line
  const guard = (line) => {
    if (lead === null) return line;
    const startsHeading = lead === '' && /^\*+\s/.test(line);
    const startsKeyword = /^\s*#\+/.test(line);
    return startsHeading || startsKeyword ? ',' + line : line;
  };
  return lines.map((line, i) => (i === 0 ? guard(line) : prefix + guard(line))).join('\n');
}

/**
 * What a native shell hands the app when something is shared to it: `{ title, text, url, capture? }`, any of them possibly
 * missing, as `{ capture, shared }` in the form runLaunch takes. With no `capture` key the template list opens, as it does
 * for the web share target. The same limits and the same "address inside the text" handling as a share URL.
 */
function launchFromShare(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const field = (value) => (typeof value === 'string' ? value : '').slice(0, MAX_FIELD).trim();
  const shared = normalizeShared({ title: field(p.title), text: field(p.text), url: field(p.url) });
  const any = !!(shared.title || shared.text || shared.url);
  return { capture: typeof p.capture === 'string' ? field(p.capture) : '', shared: any ? shared : null };
}

export { MAX_FIELD, normalizeShared, parseLaunchParams, sharedAnnotation, placeInsertedText, launchFromShare };
