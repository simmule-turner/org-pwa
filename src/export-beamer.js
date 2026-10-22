// @ts-check
/**
 * Beamer export (ox-beamer): LaTeX export of a presentation. The walk over the headings lives in export-latex.js (a Beamer export is
 * a LaTeX export with `beamer` set); this file holds what is Beamer's own and needs no export state: the environment table, the
 * `%`-escapes of an environment, the frame's option list, the theme lines, and how a headline's `BEAMER_*` properties are read.
 *
 *   - A headline whose relative level is below the frame level is a section, at it a frame, below it an environment inside the frame.
 *     The frame level is the `H:` option (`org-beamer-frame-level`, default 1), unless the headline or an ancestor has
 *     `:BEAMER_env: frame` (that level) or a descendant has (then the headline is a section).
 *   - `BEAMER_env` names the environment of a headline inside a frame (`block` when empty), `BEAMER_col` makes it a column, `BEAMER_act`
 *     is its overlay specification, `BEAMER_opt` its options, `BEAMER_ref` what `againframe` shows again.
 *   - The keywords `#+BEAMER_THEME:`, `#+BEAMER_COLOR_THEME:`, `#+BEAMER_FONT_THEME:`, `#+BEAMER_INNER_THEME:`, `#+BEAMER_OUTER_THEME:`
 *     and `#+BEAMER_HEADER:`, and the lines `#+BEAMER:` and `@@beamer:...@@`, go straight to the file.
 */

/** @typedef {import('./types.js').Heading} Heading */

/** `org-beamer-environments-default` (without frame, columns and column, which have forms of their own): name, begin and end strings. */
export const BUILT_IN_ENVIRONMENTS = [
  ['block', '\\begin{block}%a{%h}', '\\end{block}'],
  ['alertblock', '\\begin{alertblock}%a{%h}', '\\end{alertblock}'],
  ['verse', '\\begin{verse}%a %% %h', '\\end{verse}'],
  ['quotation', '\\begin{quotation}%a %% %h', '\\end{quotation}'],
  ['quote', '\\begin{quote}%a %% %h', '\\end{quote}'],
  ['structureenv', '\\begin{structureenv}%a %% %h', '\\end{structureenv}'],
  ['theorem', '\\begin{theorem}%a[%h]', '\\end{theorem}'],
  ['definition', '\\begin{definition}%a[%h]', '\\end{definition}'],
  ['example', '\\begin{example}%a[%h]', '\\end{example}'],
  ['exampleblock', '\\begin{exampleblock}%a{%h}', '\\end{exampleblock}'],
  ['proof', '\\begin{proof}%a[%h]', '\\end{proof}'],
  ['beamercolorbox', '\\begin{beamercolorbox}%o{%h}', '\\end{beamercolorbox}'],
];

/** @param {Heading} h @param {string} key */
export const prop = (h, key) => {
  const p = h.properties || {};
  const found = Object.keys(p).find((k) => k.toUpperCase() === key);
  return found ? String(p[found]).trim() : '';
};

/** The headline's environment as written (`''` when it has none). @param {Heading} h */
export const envOf = (h) => prop(h, 'BEAMER_ENV');

/** Is `env` one of these names, whatever its case? @param {string} env @param {string[]} names */
export const isEnv = (env, names) => names.includes(env.toLowerCase());

/** Does the headline stand for a column: it has a width, or its environment is `column`? @param {Heading} h */
export const isColumn = (h) => prop(h, 'BEAMER_COL') !== '' || envOf(h).toLowerCase() === 'column';

/**
 * The overlay specification of a headline: `%a` is it when it is in angle brackets, `%A` when in square brackets, `%R` as written.
 * @param {string} raw
 * @returns {{ angle: string, square: string, raw: string }}
 */
export function actionOf(raw) {
  return { angle: /^<.*>$/s.test(raw) ? raw : '', square: /^\[.*\]$/s.test(raw) ? raw : '', raw };
}

/** Options as `%o` writes them: in square brackets, once. @param {string} raw */
export const bracketed = (raw) => (raw === '' ? '' : /^\[.*\]$/s.test(raw) ? raw : '[' + raw + ']');

/**
 * `org-fill-template`: each `%` and a letter that has a value is replaced; the others stay as they are.
 * @param {string} template @param {Record<string, string>} values
 */
export function fillTemplate(template, values) {
  return template.replace(/%([a-zA-Z])/g, (whole, key) => (Object.prototype.hasOwnProperty.call(values, key) ? values[key] : whole));
}

/**
 * The begin and end strings of an environment: the ones an init text adds win over the built-in ones. Null for a name that is neither.
 * @param {string} name @param {{ name: string, begin: string, end: string }[]} extra
 * @returns {{ begin: string, end: string } | null}
 */
export function environmentFor(name, extra) {
  const own = extra.find((e) => e.name === name);
  if (own) return { begin: own.begin, end: own.end };
  const found = BUILT_IN_ENVIRONMENTS.find((e) => e[0] === name);
  return found ? { begin: found[1], end: found[2] } : null;
}

/**
 * The values an environment's strings can use, for the headline `h` whose title is `title` (exported) and `rawTitle`.
 * @param {Heading} h @param {string} title
 * @returns {Record<string, string>}
 */
export function environmentValues(h, title) {
  const act = actionOf(prop(h, 'BEAMER_ACT'));
  const opt = prop(h, 'BEAMER_OPT');
  return { a: act.angle, A: act.square, R: act.raw, o: bracketed(opt), O: opt, h: title, r: h.title, H: h.title === '' ? '' : '{' + h.title + '}' };
}

/**
 * The options of a frame, in the order Org writes them: the label (unless the options give one, or say `allowframebreaks`), `fragile`
 * (when the frame holds verbatim text and the options do not already say so), the default options, then the headline's own.
 * @param {{ label: string, fragile: boolean, defaults: string, own: string }} p
 * @returns {string} the list without brackets
 */
export function frameOptions({ label, fragile, defaults, own }) {
  const mine = own.replace(/^\[/, ''); // a leading bracket is dropped, the closing one stays: Org writes `[t]` as `t]]`
  const parts = mine.split(',').map((x) => x.trim());
  const labelled = /(^|,)\s*label=/.test(mine) || parts.includes('allowframebreaks');
  return [labelled ? '' : 'label={' + label + '}', fragile && !parts.includes('fragile') ? 'fragile' : '', defaults, mine].filter((x) => x !== '').join(',');
}

/** The theme lines: `\usetheme` (always, `default` unless set) and the colour, font, inner and outer theme the file names. @param {import('./types.js').Doc} doc @param {string} defaultTheme @returns {string[]} */
export function themeLines(doc, defaultTheme) {
  /** @param {string} key */
  const value = (key) => {
    const kw = (doc.keywords || []).filter((k) => k.key.toUpperCase() === key).pop();
    return kw ? kw.value.trim() : null;
  };
  /** @type {[string, string, string | null][]} */
  const rows = [
    ['BEAMER_THEME', '\\usetheme', value('BEAMER_THEME') ?? defaultTheme],
    ['BEAMER_COLOR_THEME', '\\usecolortheme', value('BEAMER_COLOR_THEME')],
    ['BEAMER_FONT_THEME', '\\usefonttheme', value('BEAMER_FONT_THEME')],
    ['BEAMER_INNER_THEME', '\\useinnertheme', value('BEAMER_INNER_THEME')],
    ['BEAMER_OUTER_THEME', '\\useoutertheme', value('BEAMER_OUTER_THEME')],
  ];
  return rows.flatMap(([, command, theme]) => {
    if (theme === null) return [];
    const m = /\[.*\]/.exec(theme); // greedy, as Org's: `[a]Name[b]` reads as options `[a]Name[b]` and a name that is empty
    return [m ? command + m[0] + '{' + theme.replace(m[0], '').trim() + '}' : command + '{' + theme + '}'];
  });
}

/** The `#+BEAMER_HEADER:` lines, written after the title. @param {import('./types.js').Doc} doc @returns {string[]} */
export function headerLines(doc) {
  return (doc.keywords || []).filter((k) => k.key.toUpperCase() === 'BEAMER_HEADER').map((k) => k.value.trim());
}

/** `@@beamer:<2>@@` at the start of a text: its overlay specification and the text after it, or null. @param {string} text @returns {{ overlay: string, rest: string } | null} */
export function leadingOverlay(text) {
  const m = /^@@beamer:(<[^@]*>)@@/.exec(text);
  return m ? { overlay: m[1], rest: text.slice(m[0].length) } : null;
}

/** An overlay for a list as `[<+->]`: the `:overlay` attribute gets its brackets if it has none. @param {string | undefined} overlay */
export function listOverlay(overlay) {
  return !overlay ? '' : /^\[.*\]$/s.test(overlay) ? overlay : '[' + overlay + ']';
}

/**
 * `#+TOC: headlines N [options]`: the depth lines and the command, as ox-beamer writes it (with no frame around it).
 * @param {string} value @param {number | boolean | undefined} withToc  the `toc:` option
 * @returns {string}
 */
export function tocLines(value, withToc) {
  const given = /[0-9]+/.exec(value);
  const depth = given ? Number(given[0]) : typeof withToc === 'number' ? withToc : null;
  const options = /\[.*?\]/.exec(value);
  return (depth === null ? '' : '\\setcounter{tocdepth}{' + depth + '}\n') + '\\tableofcontents' + (options ? options[0] : '') + '\n';
}

/** The frame that holds the table of contents when `toc` is on. @param {{ title: string, options: string }} cfg @param {number | boolean | undefined} withToc */
export function outlineFrame({ title, options }, withToc) {
  return '\\begin{frame}' + (options ? '[' + options + ']' : '') + '{' + title + '}\n' + (typeof withToc === 'number' ? '\\setcounter{tocdepth}{' + withToc + '}\n' : '') + '\\tableofcontents\n\\end{frame}\n';
}
