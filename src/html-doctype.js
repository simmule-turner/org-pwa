// @ts-check
// #+HTML_DOCTYPE: and org-html-doctype: the declaration Org writes for each name (org-html-doctype-alist), and what
// the choice changes in the rest of the page, as ox-html.el has it: XHTML closes void tags with " />" and gets an XML
// declaration and xmlns, HTML 5 gets a charset meta and no table attributes, the older ones a Content-Type meta and
// the attributes `org-html-table-default-attributes` names.

const DECLARATIONS = /** @type {Record<string, string>} */ ({
  'html4-strict': '<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01//EN"\n"http://www.w3.org/TR/html4/strict.dtd">',
  'html4-transitional': '<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN"\n"http://www.w3.org/TR/html4/loose.dtd">',
  'html4-frameset': '<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01 Frameset//EN"\n"http://www.w3.org/TR/html4/frameset.dtd">',
  'xhtml-strict': '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN"\n"http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">',
  'xhtml-transitional': '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN"\n"http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">',
  'xhtml-frameset': '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Frameset//EN"\n"http://www.w3.org/TR/xhtml1/DTD/xhtml1-frameset.dtd">',
  'xhtml-11': '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN"\n"http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">',
  html5: '<!DOCTYPE html>',
  xhtml5: '<!DOCTYPE html>',
});

/** Emacs's default: org-html-doctype. */
export const DEFAULT_DOCTYPE = 'xhtml-strict';

/**
 * @typedef {{ declaration: string, xhtml: boolean, html5: boolean, close: string }} DoctypeInfo
 *   `close` is what ends a void tag: " />" for XHTML, ">" otherwise
 */

/**
 * The doctype for a name as `#+HTML_DOCTYPE:` or `org-html-doctype` gives it. A name that is not in the table is written as it is,
 * as Org does with a literal declaration.
 * @param {string | null | undefined} name
 * @returns {DoctypeInfo}
 */
export function doctypeInfo(name) {
  const value = name && name.trim() ? name.trim() : DEFAULT_DOCTYPE;
  const lower = value.toLowerCase();
  return {
    declaration: Object.prototype.hasOwnProperty.call(DECLARATIONS, value) ? DECLARATIONS[value] : value,
    xhtml: lower.includes('xhtml'),
    html5: ['html5', 'xhtml5', '<!doctype html>'].includes(lower),
    close: lower.includes('xhtml') ? ' />' : '>',
  };
}

/** The XML declaration before an XHTML page that is not XHTML 5 (org-html-xml-declaration), or ''.
 * @param {DoctypeInfo} d */
export function xmlDeclaration(d) {
  return d.xhtml && !d.html5 ? '<?xml version="1.0" encoding="utf-8"?>\n' : '';
}

/** The `<html ...>` tag: xmlns and both language attributes for XHTML, lang for HTML 5, nothing for HTML 4.
 * @param {DoctypeInfo} d @param {string} lang */
export function htmlTag(d, lang) {
  if (d.xhtml) return `<html xmlns="http://www.w3.org/1999/xhtml" lang="${lang}" xml:lang="${lang}">`;
  return d.html5 ? `<html lang="${lang}">` : '<html>';
}

/** The meta tag that gives the character set.
 * @param {DoctypeInfo} d */
export function charsetMeta(d) {
  return d.html5 ? '<meta charset="utf-8" />' : '<meta http-equiv="Content-Type" content="text/html;charset=utf-8" />';
}
