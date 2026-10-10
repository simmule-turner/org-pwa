/**
 * Tangle: the source blocks of a document, written out as files. Follows Org's org-babel-tangle (checked against
 * Emacs): a block goes to the file named by its `:tangle` header argument (`yes` = the document's own name with the
 * language as extension, `no` = nowhere); blocks for the same file are joined in document order with a blank line
 * between them (`:padline no` removes it), after Noweb expansion; `:shebang`, `:comments` and `:tangle-mode` work as in Org.
 *
 * Differences, on purpose: paths may not be absolute or climb out of the folder with `..`, and a folder that does not
 * exist is simply created (the files are delivered together, usually as a zip).
 */
import { collectDocumentBlocks, headingSearchText, removeIndentation } from './babel-blocks.js';
import { parseHeaderArgs, resolveVars, findNamedTable } from './babel.js';
import { expandNoweb, nowebAllows } from './noweb.js';
import { serializeOrg } from './org-parser.js';

const LANG_EXTENSIONS = { 'emacs-lisp': 'el', elisp: 'el' };

const HASH = ['python', 'py', 'sh', 'bash', 'zsh', 'shell', 'ruby', 'perl', 'r', 'yaml', 'yml', 'makefile', 'make', 'toml', 'conf', 'org', 'awk', 'ps1', 'powershell', 'dockerfile', 'nix'];
const SLASH = ['js', 'javascript', 'ts', 'typescript', 'java', 'c', 'cpp', 'c++', 'cc', 'go', 'rust', 'rs', 'swift', 'kotlin', 'scala', 'php', 'csharp', 'cs', 'dart', 'groovy', 'jsonc'];
const SEMI = ['emacs-lisp', 'elisp', 'lisp', 'scheme', 'clojure', 'clj', 'racket', 'ini'];
const DASH = ['sql', 'lua', 'haskell', 'hs', 'ada', 'elm'];
const PERCENT = ['latex', 'tex', 'erlang', 'matlab', 'octave', 'prolog'];

/** [prefix, suffix] that comments out one line in `lang`, or null. */
function commentSyntax(lang) {
  const l = String(lang).toLowerCase();
  if (HASH.includes(l)) return ['# ', ''];
  if (SLASH.includes(l)) return ['// ', ''];
  if (SEMI.includes(l)) return [';; ', ''];
  if (DASH.includes(l)) return ['-- ', ''];
  if (PERCENT.includes(l)) return ['% ', ''];
  if (['css', 'scss', 'less'].includes(l)) return ['/* ', ' */'];
  if (['html', 'xml', 'svg', 'md', 'markdown'].includes(l)) return ['<!-- ', ' -->'];
  if (l === 'vim') return ['" ', ''];
  return null;
}

/** Comments out each non-blank line of `text`, as Emacs's comment-region does. */
function commentOut(text, lang) {
  const syntax = commentSyntax(lang);
  if (!syntax) throw new Error(`:comments is not supported for ${lang} blocks (no comment syntax known)`);
  return text
    .split('\n')
    .map((l) => (l.trim() === '' ? l : syntax[0] + l + syntax[1]))
    .join('\n');
}

const orgTrim = (s) => s.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');

/** Org's `%S` for a value, as ob-js writes it into `var name=value;`. */
function jsValue(v) {
  if (Array.isArray(v)) return '[' + v.map(jsValue).join(', ') + ']';
  if (v === null || v === undefined) return 'nil';
  if (v === true) return 't';
  if (typeof v === 'string') return JSON.stringify(v).replace(/\\n/g, '\\n');
  return String(v);
}

/** The file mode a `:tangle-mode` value stands for, or null. Accepts `(identity #o755)`, `#o755`, `o755`, `rwxr-xr-x`
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
      m = /^([ugoa]*)((?:[+\-=][rwxXstugo]*)+)$/.exec(clause);
      const who = m[1] || 'a';
      const targets = who.includes('a') ? 'ugo' : who;
      for (const op of m[2].match(/[+\-=][rwxXstugo]*/g)) {
        let perm = 0;
        for (const c of op.slice(1)) perm |= bits[c] || 0;
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

function checkTargetPath(path) {
  if (!path || path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.startsWith('~') || path.split('/').includes('..') || path.includes('\\')) {
    throw new Error(`Cannot tangle to "${path}": a path must be relative and stay inside the folder (no /, ~ or ..)`);
  }
  return path.replace(/\/{2,}/g, '/').replace(/^\.\//, '');
}

/** The text between the previous source block (or the heading) and a block, for `:comments org`. */
function precedingText(doc, block, blocks) {
  const own = block.heading;
  let lines;
  let start = 0;
  if (own) {
    const meta = serializeOrg({ type: 'document', keywords: [], bodyLines: [], children: [{ ...own, children: [], bodyLines: [] }] }).replace(/\n+$/, '').split('\n');
    lines = [...meta, ...(own.bodyLines || [])];
    const first = meta[0];
    start = Math.max(0, first.search(/\S/) >= 0 ? /^\*+ /.exec(first)[0].length : 0);
    var beginLine = meta.length + block.beginIndex;
    var skipLines = meta.length;
  } else {
    lines = doc.bodyLines || [];
    beginLine = block.beginIndex;
    skipLines = 0;
  }
  const prior = blocks.filter((b) => b.heading === own && b.beginIndex < block.beginIndex).pop();
  let from = { line: 0, col: start };
  if (prior) {
    const endLine = skipLines + prior.endIndex;
    const candidate = { line: endLine, col: lines[endLine].length };
    if (!own || candidate.line > from.line || candidate.col > from.col) from = candidate;
  }
  const picked = lines.slice(from.line, beginLine);
  if (picked.length) picked[0] = picked[0].slice(from.col);
  return picked.join('\n') + '\n';
}

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
 * @param {object} doc
 * @param {object} [options]  documentName: the Org file's name (default "untitled.org"); lookupTable(name): rows of a named table
 * @returns {{ files: Array<{path: string, text: string, mode: number|null, blockCount: number}>, blockCount: number, warnings: string[] }}
 */
export function tangleDocument(doc, { documentName = 'untitled.org' } = {}) {
  const blocks = collectDocumentBlocks(doc);
  const lookupTable = (name) => {
    const walk = (list) => {
      for (const h of list) {
        const rows = findNamedTable(h.bodyLines || [], name);
        if (rows) return rows;
        const inner = walk(h.children || []);
        if (inner) return inner;
      }
      return null;
    };
    return findNamedTable(doc.bodyLines || [], name) || walk(doc.children || []);
  };
  const warnings = [];
  const byFile = new Map();
  for (const b of blocks) {
    if (b.commented || b.archived || b.args.tangle === 'no') continue;
    const where = b.heading ? `"${b.heading.title}" block ${b.counter}` : `block ${b.counter} before the first heading`;
    try {
      const ext = LANG_EXTENSIONS[b.lang] || b.lang;
      let path = b.args.tangle === 'yes' ? documentName.replace(/\.[^./]*$/, '') + '.' + ext : b.args.tangle;
      path = checkTargetPath(path);
      let body = nowebAllows(b.args, 'tangle') ? expandNoweb(doc, blocks, b, { context: 'tangle' }) : b.body;
      if (!('no-expand' in b.args)) {
        const parts = [];
        if (b.args.prologue) parts.push(b.args.prologue);
        if (b.args.var.length) {
          if (b.lang === 'js' || b.lang === 'javascript') {
            const vars = resolveVars(b.args.var, lookupTable);
            for (const [name, value] of Object.entries(vars)) parts.push(`var ${name}=${jsValue(value)};`);
          } else warnings.push(`${where}: :var is not added to ${b.lang} blocks`);
        }
        parts.push(body);
        if (b.args.epilogue) parts.push(b.args.epilogue);
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
    const modes = [];
    for (const { block: b, body, where } of specs) {
      const args = b.args;
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
      const insert = (t) => {
        if (comments && comments !== 'no' && t.trim() !== '') text += commentOut(t, b.lang) + '\n';
      };
      if (comments === 'both' || comments === 'org') insert(removeIndentation(precedingText(doc, b, blocks).split('\n')).join('\n'));
      const sourceName = b.name || `${b.heading ? b.heading.title : 'No heading'}:${b.counter}`;
      if (link) {
        b.beginLineText = (b.heading ? b.heading.bodyLines : doc.bodyLines)[b.beginIndex];
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
