// @ts-check
/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {import('./types.js').Doc} Doc */
/**
 * Tangle: the source blocks of a document, written out as files. Follows Org's org-babel-tangle (checked against
 * Emacs): a block goes to the file named by its `:tangle` header argument (`yes` = the document's own name with the
 * language as extension, `no` = nowhere); blocks for the same file are joined in document order with a blank line
 * between them (`:padline no` removes it), after Noweb expansion; `:shebang`, `:comments` and `:tangle-mode` work as in Org.
 *
 * Differences, on purpose: paths may not be absolute or climb out of the folder with `..`, and a folder that does not
 * exist is simply created (the files are delivered together, usually as a zip).
 */
import { collectDocumentBlocks, headingSearchText, removeIndentation, fullPreambleLines } from './babel-blocks.js';
import { resolveVars, findNamedTable, headerText, parseResultsSpec } from './babel.js';
import { runElisp } from './babel-elisp.js';
import { print } from './elisp-data.js';
import { expandNoweb, nowebAllows } from './noweb.js';
import { serializeOrg } from './org-parser.js';

const LANG_EXTENSIONS = { 'emacs-lisp': 'el', elisp: 'el' };

const HASH = ['python', 'py', 'sh', 'bash', 'zsh', 'shell', 'ruby', 'perl', 'r', 'yaml', 'yml', 'makefile', 'make', 'toml', 'conf', 'org', 'awk', 'ps1', 'powershell', 'dockerfile', 'nix'];
const SLASH = ['js', 'javascript', 'ts', 'typescript', 'java', 'cpp', 'c++', 'cc', 'go', 'rust', 'rs', 'swift', 'kotlin', 'scala', 'php', 'csharp', 'cs', 'dart', 'groovy', 'jsonc'];
const SEMI = ['emacs-lisp', 'elisp', 'lisp', 'scheme', 'clojure', 'clj', 'racket', 'ini'];
const DASH = ['sql', 'lua', 'haskell', 'hs', 'ada', 'elm'];
const PERCENT = ['latex', 'tex', 'erlang', 'matlab', 'octave', 'prolog'];

/**
 * [prefix, suffix] that comments out one line in `lang`, or null.
 * @param {any} [lang]
 */
function commentSyntax(lang) {
  const l = String(lang).toLowerCase();
  if (HASH.includes(l)) return ['# ', ''];
  if (SLASH.includes(l)) return ['// ', ''];
  if (SEMI.includes(l)) return [';; ', ''];
  if (DASH.includes(l)) return ['-- ', ''];
  if (PERCENT.includes(l)) return ['% ', ''];
  if (['css', 'less'].includes(l)) return ['/* ', ' */'];
  if (l === 'c') return ['/* ', ' */']; // Emacs's c-mode comments with /* */, c++-mode with //
  if (l === 'scss') return ['// ', ''];
  if (['html', 'xml', 'svg', 'md', 'markdown'].includes(l)) return ['<!-- ', ' -->'];
  if (l === 'vim') return ['" ', ''];
  return null;
}

let lastSyntax = ['# ', ''];

/**
 * Comments out each non-blank line of `text`, as Emacs's comment-region does.
 * @param {string} text
 * @param {any} [lang]
 */
function commentOut(text, lang) {
  const known = commentSyntax(lang);
  if (known) lastSyntax = known;
  // A language Emacs has no mode for leaves the buffer in the mode of the block before it, so it comments like that block
  // (Org's own `# ` when there is none).
  const syntax = known || lastSyntax;
  return text
    .split('\n')
    .map((l) => (l.trim() === '' ? l : syntax[0] + l + syntax[1]))
    .join('\n');
}

/** @param {string} s */
const orgTrim = (s) => s.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');

/**
 * Org's `%S` for a value, as ob-js writes it into `var name=value;`.
 * @param {any} [v]
 */
/** @returns {any} */ function jsValue(/** @type {any} */ v) {
  if (Array.isArray(v)) return '[' + v.map(jsValue).join(', ') + ']';
  if (v === null || v === undefined) return 'nil';
  if (v === true) return 't';
  if (typeof v === 'string') return JSON.stringify(v).replace(/\\n/g, '\\n');
  return String(v);
}

/**
 * A value as Lisp prints it (`prin1`), for the `(let ((x '5)) ...)` ob-emacs-lisp wraps around a block that has `:var`.
 * @param {unknown} v
 * @returns {string}
 */
function lispValue(v) {
  if (Array.isArray(v)) return '(' + v.map(lispValue).join(' ') + ')';
  if (v === null || v === undefined || v === false || v === '') return v === '' ? '""' : 'nil';
  if (v === true) return 't';
  if (typeof v === 'string') return '"' + v.replace(/[\\"]/g, '\\$&') + '"';
  return String(v);
}

/** The file mode a `:tangle-mode` value stands for, or null. Accepts `(identity #o755)`, `#o755`, `o755`, `rwxr-xr-x`
 * @param {any} [value]
 *  and chmod forms such as `u+x` or `a=rw,u+x` (starting from 644). */
export function interpretFileMode(value) {
  const v = String(value || '').trim();
  let m = /^\(identity\s+#o([0-7]{3})\)$/.exec(v) || /^#o([0-7]{3})$/.exec(v) || /^o0?([0-7]{3})$/.exec(v);
  if (m) return parseInt(m[1], 8);
  if (/^[r-][w-][xs-][r-][w-][xs-][r-][w-][x-]$/.test(v)) {
    let mode = 0;
    for (let i = 0; i < 9; i++) if (v[i] !== '-') mode |= 1 << (8 - i);
    return mode;
  }
  if (/^[ugoa]*(?:[+\-=][rwxXstugo]*)+(?:,[ugoa]*(?:[+\-=][rwxXstugo]*)+)*$/.test(v)) {
    let mode = 0o644;
    const bits = { r: 4, w: 2, x: 1, X: 1 };
    for (const clause of v.split(',')) {
      m = /** @type {RegExpExecArray} */ (/^([ugoa]*)((?:[+\-=][rwxXstugo]*)+)$/.exec(clause));
      const who = m[1] || 'a';
      const targets = who.includes('a') ? 'ugo' : who;
      for (const op of m[2].match(/[+\-=][rwxXstugo]*/g) || []) {
        let perm = 0;
        for (const c of op.slice(1)) perm |= /** @type {any} */ (bits)[c] || 0;
        for (const t of targets) {
          const shift = t === 'u' ? 6 : t === 'g' ? 3 : 0;
          if (op[0] === '+') mode |= perm << shift;
          else if (op[0] === '-') mode &= ~(perm << shift);
          else mode = (mode & ~(7 << shift)) | (perm << shift);
        }
      }
    }
    return mode;
  }
  return null;
}

/** @param {string} path */
function checkTargetPath(path) {
  if (!path || path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.startsWith('~') || path.split('/').includes('..') || path.includes('\\')) {
    throw new Error(`Cannot tangle to "${path}": a path must be relative and stay inside the folder (no /, ~ or ..)`);
  }
  return path.replace(/\/{2,}/g, '/').replace(/^\.\//, '');
}

/**
 * The text between the previous source block (or the heading) and a block, for `:comments org`.
 * @param {Doc} doc
 * @param {any} block
 * @param {any[]} blocks
 */
function precedingText(doc, block, blocks) {
  const own = block.heading;
  /** @type {string[]} */
  let lines;
  let start = 0;
  /** @type {(b: { beginLineText?: string, beginIndex: number }) => number} */
  let fullBeginOf = () => 0;
  if (own) {
    const meta = serializeOrg({ type: 'document', keywords: [], bodyLines: [], children: [{ ...own, children: [], bodyLines: [] }] }).replace(/\n+$/, '').split('\n');
    lines = [...meta, ...(own.bodyLines || [])];
    const first = meta[0];
    start = Math.max(0, first.search(/\S/) >= 0 ? (/^\*+ /.exec(first) || [''])[0].length : 0);
    var beginLine = meta.length + block.beginIndex;
    var skipLines = meta.length;
  } else {
    // before the first heading the `#+KEY:` lines the parser took out are text Emacs sees too
    lines = fullPreambleLines(doc);
    fullBeginOf = (b) => {
      const same = blocks.filter((o) => !o.heading && o.beginLineText === b.beginLineText && o.beginIndex <= b.beginIndex).length;
      let seen = 0;
      for (let i = 0; i < lines.length; i++) if (lines[i] === b.beginLineText && ++seen === same) return i;
      return b.beginIndex;
    };
    beginLine = fullBeginOf(block);
    skipLines = 0;
  }
  const prior = blocks.filter((b) => b.heading === own && b.beginIndex < block.beginIndex).pop();
  let from = { line: 0, col: start };
  if (prior) {
    const endLine = own ? skipLines + prior.endIndex : fullBeginOf(prior) + (prior.endIndex - prior.beginIndex);
    const candidate = { line: endLine, col: lines[endLine].length };
    if (!own || candidate.line > from.line || candidate.col > from.col) from = candidate;
  }
  const picked = lines.slice(from.line, beginLine);
  if (picked.length) picked[0] = picked[0].slice(from.col);
  return picked.join('\n') + '\n';
}

/**
 * @param {any} block
 * @param {string} documentName
 * @param {any} [targetPath]
 */
function linkFor(block, documentName, targetPath) {
  const depth = targetPath.split('/').length - 1;
  const rel = '../'.repeat(depth) + documentName;
  let search;
  if (block.name) search = block.name;
  else if (block.heading) search = '*' + headingSearchText(block.heading.title).replace(/[[\]]/g, (c) => '\\' + c);
  else search = (block.beginLineText || '').trim().replace(/^#/, '');
  return `file:${rel}::${search}`;
}

/**
 * Tangles `doc`.
 * @param {Doc} doc
 * @param {{ documentName?: string }} [options]  documentName: the Org file's name (default "untitled.org"); lookupTable(name): rows of a named table
 * @returns {{ files: Array<{path: string, text: string, mode: number|null, blockCount: number}>, blockCount: number, warnings: string[] }}
 */
export function tangleDocument(doc, { documentName = 'untitled.org' } = {}) {
  const blocks = collectDocumentBlocks(doc);
  /** @param {string} name */
  const lookupTable = (name) => {
    /** @param {any} [list] */
    const walk = (list) => {
      for (const h of list) {
        const rows = findNamedTable(h.bodyLines || [], name);
        if (rows) return rows;
        /** @type {any} */ const inner = walk(h.children || []);
        if (inner) return inner;
      }
      return null;
    };
    return findNamedTable(doc.bodyLines || [], name) || walk(doc.children || []);
  };
  // `:comments noweb`: a referenced block is wrapped in begin and end comments naming it
  /**
   * @param {any} ref
   * @param {string} text
   * @param {any} [host]
   */
  const wrapChunk = (ref, text, host) => {
    let target;
    if (ref.name) target = ref.name;
    else if (ref.heading) target = '*' + headingSearchText(ref.heading.title).replace(/[[\]]/g, (c) => '\\' + c);
    else target = ((ref.heading ? ref.heading.bodyLines : doc.bodyLines)[ref.beginIndex] || '').trim().replace(/^#/, '');
    const name = ref.name || '';
    return commentOut(`[[file:${documentName}::${target}][${name}]]`, host.lang) + '\n' + text + '\n' + commentOut(name ? `${name} ends here` : 'ends here', host.lang);
  };
  const warnings = [];
  lastSyntax = ['# ', ''];
  const byFile = new Map();
  for (const b of blocks) {
    if (b.commented || b.archived || b.args.tangle === 'no') continue;
    const where = b.heading ? `"${b.heading.title}" block ${b.counter}` : `block ${b.counter} before the first heading`;
    try {
      const langName = b.langText || b.lang; // Emacs keeps the language's case: ```C``` gives doc.C
      const ext = /** @type {any} */ (LANG_EXTENSIONS)[langName] || langName;
      let path = b.args.tangle === 'yes' ? documentName.replace(/\.[^./]*$/, '') + '.' + ext : b.args.tangle;
      path = checkTargetPath(path);
      let body = nowebAllows(b.args, 'tangle') ? expandNoweb(doc, blocks, b, { context: 'tangle', wrapChunk }) : b.body;
      if (!('no-expand' in b.args)) {
        const parts = [];
        if (b.args.prologue) parts.push(headerText(b.args.prologue));
        if (b.args.var.length) {
          if (b.lang === 'js' || b.lang === 'javascript') {
            const vars = resolveVars(b.args.var, lookupTable, { colnames: b.args.colnames, rownames: b.args.rownames, hlines: b.args.hlines });
            for (const [name, value] of Object.entries(vars)) parts.push(`var ${name}=${jsValue(value)};`);
          } else if (b.lang === 'emacs-lisp' || b.lang === 'elisp') {
            // ob-emacs-lisp: the body goes inside a `let` binding each variable to its quoted value
            let bindings = null;
            try {
              // a value that is Lisp (`(+ 1 2)`, `'(a b)`) is evaluated, as Emacs does; anything else is a number, string or table
              bindings = b.args.var.map((/** @type {string} */ spec) => {
                const eq = spec.indexOf('=');
                const name = spec.slice(0, eq);
                const text = spec.slice(eq + 1);
                if (/^['(]/.test(text)) {
                  const run = runElisp({ code: text, spec: parseResultsSpec('') });
                  if (!run.ok) throw new Error(run.message);
                  return `(${name} '${print(run.value)})`;
                }
                const vars = resolveVars([spec], lookupTable, { colnames: b.args.colnames, rownames: b.args.rownames, hlines: b.args.hlines });
                return `(${name} '${lispValue(vars[name])})`;
              });
            } catch (e) {
              warnings.push(`${where}: :var is not added to ${b.lang} blocks (${/** @type {Error} */ (e).message})`);
            }
            if (bindings) body = `(let (${bindings.join('\n      ')})\n${body}\n)`;
          } else warnings.push(`${where}: :var is not added to ${b.lang} blocks`);
        }
        parts.push(body);
        if (b.args.epilogue) parts.push(headerText(b.args.epilogue));
        body = parts.join('\n');
      }
      body = orgTrim(removeIndentation(body.split('\n')).join('\n'));
      if (!byFile.has(path)) byFile.set(path, []);
      byFile.get(path).push({ block: b, body, path, where });
    } catch (err) {
      throw new Error(`${where}: ${err.message}`);
    }
  }

  const files = [];
  let blockCount = 0;
  for (const [path, specs] of byFile) {
    let text = '';
    let shebanged = false;
    /** @type {any[]} */ const modes = [];
    for (const { block: b, body, where } of specs) {
      const args = b.args;
      if (commentSyntax(b.lang)) lastSyntax = /** @type {string[]} */ (commentSyntax(b.lang));
      const shebang = args.shebang ? args.shebang : '';
      let mode = args['tangle-mode'] ? interpretFileMode(args['tangle-mode']) : null;
      if (args['tangle-mode'] && mode === null) throw new Error(`${where}: File mode ${args['tangle-mode']} is not recognized`);
      if (shebang && mode === null) mode = 0o755;
      if (mode !== null && !modes.includes(mode)) modes.unshift(mode);
      if (args.padline !== 'no' && text !== '') text += '\n';
      if (shebang && !shebanged) {
        text += shebang + '\n';
        shebanged = true;
      }
      const comments = args.comments;
      const link = ['both', 'link', 'yes', 'noweb'].includes(comments);
      /** @param {string} t */
      const insert = (t) => {
        if (comments && comments !== 'no' && t.trim() !== '') text += commentOut(t, b.lang) + '\n';
      };
      if (comments === 'both' || comments === 'org') insert(removeIndentation(precedingText(doc, b, blocks).split('\n')).join('\n'));
      const sourceName = b.name || `${b.heading && b.heading.title ? b.heading.title : 'No heading'}:${b.counter}`;
      if (link) {
        insert(`[[${linkFor(b, documentName, path)}][${sourceName}]]`);
      }
      text += body + '\n';
      if (link) insert(`${sourceName} ends here`);
      blockCount++;
    }
    files.push({ path, text, mode: modes.length ? modes[modes.length - 1] : null, blockCount: specs.length });
  }
  return { files, blockCount, warnings };
}
