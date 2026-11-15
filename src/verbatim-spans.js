// =verbatim= and ~code~ spans, with Org's border rules: the marker follows a space or opening punctuation and ends before a space or closing one
export const VERBATIM_SPAN_RE = /(^|[\s({'"])([=~])(?=\S)([^\n]*?\S)\2(?=$|[\s\-.,;:!?)}'"\\])/g;

/** Runs `fn` on the parts of `text` that are not verbatim or code spans, and leaves the spans as they are.
 * @param {string} text
 * @param {(piece: string) => string} fn */
export function outsideVerbatim(text, fn) {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(VERBATIM_SPAN_RE)) {
    const start = (m.index ?? 0) + m[1].length;
    out += fn(text.slice(last, start)) + text.slice(start, (m.index ?? 0) + m[0].length);
    last = (m.index ?? 0) + m[0].length;
  }
  return out + fn(text.slice(last));
}
