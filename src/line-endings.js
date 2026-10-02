/**
 * Line endings. Inside the app a document is always plain "\n" text; the file on disk, GitHub or WebDAV may use
 * Windows "\r\n" ones. Without care, the first Save of such a file rewrites every line (a whole-file diff in the
 * person's history, and a conflict with whatever else edits it). So the adapters read a file, remember which style it
 * had, hand the app "\n" text, and put the file's own style back on write. Pure, so it runs in Node.
 */

/** The line ending a file mostly uses: "\r\n" when more of its line breaks are Windows-style than Unix-style, else
 *  "\n" (including for a file with no line breaks at all, so a new file is Unix-style). A file that mixes the two is
 *  saved with whichever it has more of. */
function detectLineEnding(text) {
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/\n/g) || []).length - crlf;
  return crlf > lf ? '\r\n' : '\n';
}

/** The text with every "\r\n" as "\n". A lone "\r" is left alone: it is not a line break to org. */
function toLf(text) {
  return text.replace(/\r\n/g, '\n');
}

/** "\n" text in `eol`'s style. */
function fromLf(text, eol) {
  return eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text;
}

export { detectLineEnding, toLf, fromLf };
