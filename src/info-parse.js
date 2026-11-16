// @ts-check
// GNU Info files, read the way Emacs 29.3's info.el reads them: the node separators, the header line and its pointers, the tag table
// (also the "Indirect:" table of a split manual), the menus, the cross references, the index nodes and what the Info reader shows of a
// node (hidden markup, the plain-text form of images). Everything here is pure text work; the Info view (src-browser/info-view.js)
// and the session (src/info-nav.js) build on it. Regular expressions are the ones info.el uses, written for JavaScript.

/** The node separator, ^_. */
export const SEP = '\x1f';

/** What Emacs signals with `user-error` or `error`. */
export class InfoError extends Error {}

/** @param {string} s a string with runs of blanks and newlines: info--node-canonicalize-whitespace */
export const canonicalizeWhitespace = (s) => s.replace(/[ \t\n]+/g, ' ');
/** @param {string} s regexp-quote for JavaScript */
export const quoteRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const SYNTAX_WHITESPACE = /[ \t\n\r\f]/;

/**
 * @typedef {object} Segment one node of a file as info.el sees it
 * @property {number} sep the index of its ^_
 * @property {number} start the index of its header line
 * @property {number} headerEnd the index after the header line (and its newline)
 * @property {number} end the index where Info-select-node ends it: at the next newline followed by ^_ or ^L, keeping that newline
 * @property {string} header the header line
 */

/**
 * The nodes of a file: each ^_ at the start of a line (or of the file) is followed by a line of its own, then the header line.
 * @param {string} text
 * @returns {Segment[]}
 */
export function segmentsOf(text) {
  /** @type {Segment[]} */
  const segs = [];
  let p = text.indexOf(SEP);
  while (p !== -1) {
    if (p === 0 || text[p - 1] === '\n') {
      const lineEnd = text.indexOf('\n', p);
      if (lineEnd !== -1) {
        const start = lineEnd + 1;
        const nl = text.indexOf('\n', start);
        const headerEnd = nl === -1 ? text.length : nl + 1;
        const stop = /\n[\x1f\f]/g;
        stop.lastIndex = start;
        const m = stop.exec(text);
        segs.push({ sep: p, start, headerEnd, end: m ? m.index + 1 : text.length, header: text.slice(start, headerEnd) });
      }
    }
    p = text.indexOf(SEP, p + 1);
  }
  return segs;
}

/** The name of the node a header line gives, spelled as in the node (Info-select-node), or null. @param {string} header */
export function headerNodeName(header) {
  const m = /Node:[ \t]*/i.exec(header);
  if (!m) return null;
  const rest = header.slice(m.index + m[0].length);
  return /** @type {RegExpMatchArray} */ (rest.match(/^[^,\t\n]*/))[0];
}

const IMAGE_RE = /(\0\x08\[image((?:[^\x08]|[^\0]+\x08)*)\0\x08\])/gi;
const PARAMETER_RE = /[ \t\n\r\f]*([^=]+)=(?:([^\\s "]+)|"((?:[^\\"]|\\[\\"])*)")/g;

/** The KEY=VALUE pairs of an image marker: Info-split-parameter-string, whose last pair for a key wins in `assoc-string`. @param {string} parameters */
function imageParameters(parameters) {
  /** @type {Map<string, string>} */
  const found = new Map();
  PARAMETER_RE.lastIndex = 0;
  let m;
  while ((m = PARAMETER_RE.exec(parameters))) found.set(m[1], m[2] !== undefined ? m[2] : m[3].replace(/\\([\\"])/g, '$1'));
  return found;
}

/**
 * The text of a node with its image markers (\0\b[image src=... \0\b]) as plain text, which is what Emacs leaves in a buffer that
 * cannot show images: the text parameter, else the alt one, else [image:SRC], else [image].
 * @param {string} text
 */
export function replaceImages(text) {
  if (!text.includes('\0\x08[image')) return text;
  return text.replace(IMAGE_RE, (_all, _whole, parameters) => {
    const p = imageParameters(parameters);
    const src = p.get('src');
    if (p.has('text')) return /** @type {string} */ (p.get('text'));
    if (p.has('alt')) return /** @type {string} */ (p.get('alt'));
    return src !== undefined ? '[image:' + src + ']' : '[image]';
  });
}

/**
 * The images a node names (Info-fontify-images): the file (src), the text to show in its place, and the alt text, for each marker
 * that has a src.
 * @param {string} text the node as the file has it, markers in place
 * @returns {{ src: string, alt: string | null, text: string | null }[]}
 */
export function imagesOf(text) {
  if (!text.includes('\0\x08[image')) return [];
  /** @type {{ src: string, alt: string | null, text: string | null }[]} */
  const found = [];
  IMAGE_RE.lastIndex = 0;
  let m;
  while ((m = IMAGE_RE.exec(text))) {
    const p = imageParameters(m[2]);
    const src = p.get('src');
    if (src !== undefined) found.push({ src, alt: p.get('alt') ?? null, text: p.get('text') ?? null });
  }
  return found;
}

// ---------------------------------------------------------------------------------------------------------------------
// Pointers, menus and cross references of one node (text = the node as Info-select-node narrows to it, header line first)

/** info.el's Info-following-node-name-re, with `allowed` the inside of the character class: group 1 is the whole node name. @param {string} allowed */
const followingNodeName = (allowed) => `[ \\t\\n]*((?:\\([^)]+\\))?(?:[${allowed}]*[${allowed} ]|))`;

/**
 * Info-extract-pointer: the node pointer called `name` in the header line ("next", "prev[ious]*", "up"), found as Emacs finds it, by
 * searching backward from the end of the first line; null when there is none.
 * @param {string} text the node
 * @param {string} name
 */
export function extractPointer(text, name) {
  const nl = text.indexOf('\n');
  const line = nl === -1 ? text : text.slice(0, nl + 1);
  const re = new RegExp(name + ':' + followingNodeName('^,\\t\\n'), 'iy');
  for (let i = line.length; i >= 0; i--) {
    re.lastIndex = i;
    const m = re.exec(line);
    if (m) return m[1];
  }
  return null;
}

/** The Next, Prev and Up pointers of a node, or null for each it lacks. @param {string} text */
export function pointers(text) {
  return { next: extractPointer(text, 'next'), prev: extractPointer(text, 'prev[ious]*'), up: extractPointer(text, 'up') };
}


const ENTRY_NAME = '(?:[^:]|:[^:,.;() \\t\\n])*';

/**
 * Info-extract-menu-node-name: at `pos` (after the "* " of a menu entry, or after the "*note" of a cross reference), the node that
 * the entry or reference names, blanks canonicalized, and where the match ends. Null when what follows is not an entry. For an index
 * entry (`indexNode`) the line number comes too.
 * @param {string} text
 * @param {number} pos
 * @param {{ multiLine?: boolean, indexNode?: boolean }} [mode]
 * @returns {{ target: string, label: string, end: number, line: number | null } | null}
 */
export function extractMenuNodeName(text, pos, mode = {}) {
  let p = pos;
  while (p < text.length && (text[p] === ' ' || text[p] === '\t' || text[p] === '\n')) p++;
  const allowed = mode.indexNode ? '^,\\t\\n' : mode.multiLine ? '^.,\\t' : '^.,\\t\\n';
  const re = new RegExp('(' + ENTRY_NAME + '):(:|' + followingNodeName(allowed) + ')' + (mode.indexNode ? '\\.(?:[ \\t\\n]+\\(line +([0-9]+)\\))?' : ''), 'iy');
  re.lastIndex = p;
  const m = re.exec(text);
  if (!m) return null;
  const named = m[3] !== undefined && m[3] !== '' ? m[3] : m[1];
  return { target: canonicalizeWhitespace(named), label: m[1], end: m.index + m[0].length, line: mode.indexNode && m[4] !== undefined ? Number(m[4]) : null };
}

const MENU_ENTRY_RE = '^\\* +(' + ENTRY_NAME + ')(:[ \\t\\n]*((\\([^)]+\\))?([^.,:\\t\\n]*[^.,:\\t\\n ]|))[,:.]([ \\t]*))';

/** The index just after "\n* Menu:" in a node, or -1 when it has no menu. @param {string} text */
export function menuStart(text) {
  const i = text.toLowerCase().indexOf('\n* menu:');
  return i === -1 ? -1 : i + 8;
}

/**
 * The entries of a node's menu, in order: the name shown, the node it leads to, its description (the rest of the line and the
 * indented lines that continue it) and where the entry starts.
 * @param {string} text the node
 * @returns {{ name: string, target: string, description: string, index: number }[]}
 */
export function menuEntries(text) {
  const from = menuStart(text);
  if (from === -1) return [];
  const re = new RegExp('^\\* Menu:|' + MENU_ENTRY_RE, 'gim');
  re.lastIndex = from;
  /** @type {{ name: string, target: string, description: string, index: number }[]} */
  const entries = [];
  let m;
  while ((m = re.exec(text))) {
    if (m[1] === undefined) continue;
    const got = extractMenuNodeName(text, m.index + 2);
    if (!got) continue;
    entries.push({ name: m[1], target: got.target, description: continuationText(text, m.index + m[0].length), index: m.index });
  }
  return entries;
}

/** The rest of the line from `from` and the indented lines that go on from it, in one line of text. @param {string} text @param {number} from */
function continuationText(text, from) {
  let lineEnd = text.indexOf('\n', from);
  if (lineEnd === -1) lineEnd = text.length;
  const parts = [text.slice(from, lineEnd).trim()];
  let p = lineEnd + 1;
  while (p < text.length) {
    const e = text.indexOf('\n', p);
    const line = text.slice(p, e === -1 ? text.length : e);
    if (!/^[ \t]+[^*\n]/.test(line)) break;
    parts.push(line.trim());
    p = e === -1 ? text.length : e + 1;
  }
  return parts.filter(Boolean).join(' ');
}

/**
 * Info-extract-menu-item: the first menu entry named `name` (matched from its start, as `m` does), or the first one whose name
 * starts that way: the node it leads to and, in an index node, its line.
 * @param {string} text the node
 * @param {string} name
 * @param {boolean} [indexNode]
 * @returns {{ target: string, label: string, end: number, line: number | null }}
 */
export function menuItemTarget(text, name, indexNode = false) {
  const at = menuStart(text);
  if (at === -1) throw new InfoError('No menu in this node');
  const q = quoteRegExp(name);
  const after = text.slice(at);
  let m = new RegExp('\\n\\* +' + q + ':', 'i').exec(after);
  if (!m) m = new RegExp('\\n\\* +' + q, 'i').exec(after);
  if (!m) throw new InfoError('No such item in menu');
  const got = extractMenuNodeName(text, at + m.index + 3, { indexNode });
  if (!got) throw new InfoError('No such item in menu');
  return got;
}

/**
 * The cross references of a node, in order: the label, the node they lead to, and where the "*Note" starts. A reference that does not
 * name a node is left out.
 * @param {string} text the node
 * @returns {{ label: string, target: string, index: number }[]}
 */
export function crossReferences(text) {
  const re = /\*note[ \n\t]+/gi;
  /** @type {{ label: string, target: string, index: number }[]} */
  const found = [];
  let m;
  while ((m = re.exec(text))) {
    const got = extractMenuNodeName(text, m.index + 5, { multiLine: true });
    if (got) found.push({ label: canonicalizeWhitespace(got.label), target: got.target, index: m.index });
  }
  return found;
}

/** Whether a node's text carries the index cookie that makeinfo 4.7 and later write into index nodes. @param {string} text */
export const hasIndexCookie = (text) => text.includes('\0\x08[index\0\x08]');

// ---------------------------------------------------------------------------------------------------------------------
// What the Info reader shows of a node: Info-fontify-node hides markup (the "*Note " of a cross reference, the node part of a menu
// entry, "(line N)" in an index, the cookies) and replaces some of it; this applies the same properties to the text.

/** "(line 12)", the part of an index entry that Info hides. */
const INDEX_LINE_RE = /[ \t\n]*\(line +[0-9]+\)/g;
const COOKIE_RE = /\0[\0-\x1f]\[[^\0]*\0[\0-\x1f]\]\n?/g;
const URL_RE = /(?:https?|ftp):\/\/[^ \t\n"`‘({<>})’']+/gi;
const XREF_RE = /(\*Note[ \n\t]+)([^:]*)(:[ \t]*([^.,:(]*)((\([^)]*\))[^.,:]*)?[,:]?\n?)/gid;

/**
 * @typedef {object} NodeLink
 * @property {number} start where the link starts in the shown text
 * @property {number} end where it ends
 * @property {string | null} node the node it leads to
 * @property {string | null} url or the web address it opens
 * @property {'xref' | 'menu' | 'url'} kind
 */

/**
 * Whether `word` ends right at `p`, after the start of a line or a blank (or a "(" where `paren`): the looking-back tests
 * Info-fontify-node makes before a cross reference.
 * @param {string} text @param {number} p @param {string} word @param {boolean} fold @param {boolean} paren
 */
function wordBefore(text, p, word, fold, paren) {
  const q = p - word.length;
  if (q < 0) return false;
  const got = text.slice(q, p);
  if (fold ? got.toLowerCase() !== word : got !== word) return false;
  return q === 0 || text[q - 1] === '\n' || text[q - 1] === ' ' || (paren && text[q - 1] === '(');
}

/**
 * The text Info shows for a node, and the links in it. `text` is the node with the header line first; `index` says it is an index
 * node; `multiFont` is a graphical display (underlines under titles are hidden). The first line is the header, which Info shows as
 * breadcrumbs (see breadcrumbs in src/info-nav.js); it is left as it is here and holds no links.
 * @param {string} text
 * @param {{ index?: boolean, multiFont?: boolean }} [options]
 * @returns {{ text: string, links: NodeLink[], touched: (start: number, end: number) => boolean, shown: number[] }}
 */
export function displayNode(text, options = {}) {
  const n = text.length;
  const hidden = new Uint8Array(n + 1);
  /** @type {({ end: number, str: string } | undefined)[]} */
  const disp = new Array(n + 1);
  /** @param {number} a @param {number} b @param {number} v */
  const setHidden = (a, b, v) => {
    for (let i = Math.max(0, a); i < Math.min(n, b); i++) hidden[i] = v;
  };
  const marked = new Uint8Array(n + 1);
  /** @param {number} a @param {number} b @param {string} str */
  const setDisplay = (a, b, str) => {
    disp[a] = { end: b, str };
    for (let i = a; i < b; i++) marked[i] = 1;
  };
  /** @type {{ start: number, end: number, node: string | null, url: string | null, kind: 'xref' | 'menu' | 'url' }[]} */
  const raw = [];

  if (options.multiFont) {
    const title = /\n([^ \t\n].+)\n(\*\*+|==+|--+|\.\.+)$/gm;
    let t;
    while ((t = title.exec(text))) {
      if ([...t[1]].length !== [...t[2]].length) continue;
      const underline = t.index + 1 + t[1].length + 1;
      setHidden(underline - 1, underline + t[2].length, 1);
      title.lastIndex = underline + t[2].length;
    }
  }

  // cross references
  const lineAt = (/** @type {number} */ p) => {
    let count = 1;
    for (let i = text.indexOf('\n'); i !== -1 && i < p; i = text.indexOf('\n', i + 1)) count++;
    return count;
  };
  XREF_RE.lastIndex = 0;
  let m;
  while ((m = XREF_RE.exec(text))) {
    const start = m.index;
    const next = start + m[0].length;
    const ind = /** @type {RegExpExecArray & { indices: [number, number][] }} */ (m).indices;
    let tag = null;
    if (lineAt(next) > 4) {
      let p = start;
      while (p > 0 && SYNTAX_WHITESPACE.test(text[p - 1])) p--;
      if (p > 0 && '([{'.includes(text[p - 1])) while (p > 0 && (SYNTAX_WHITESPACE.test(text[p - 1]) || '([{'.includes(text[p - 1]))) p--;
      if (wordBefore(text, p, 'see', true, true)) tag = '';
      else if (wordBefore(text, p, 'also', false, false)) tag = '';
      else if (wordBefore(text, p, 'in', true, false)) tag = '';
      else if (p === 0 || '.!?'.includes(text[p - 1])) tag = 'See ';
      else if (text.slice(p, start).includes('\n\n')) tag = 'See ';
      else tag = 'see ';
    }
    const g1 = ind[1];
    const nlInNote = m[1].indexOf('\n');
    const noteEnd = nlInNote === -1 ? g1[1] : g1[0] + nlInNote;
    if (tag === null) setHidden(g1[0], noteEnd, 1);
    else setDisplay(g1[0], noteEnd, tag);
    const g3 = ind[3];
    setHidden(g3[0], g3[1], 1);
    if (m[6] !== undefined) setHidden(ind[6][0], ind[6][1], 0);
    const nlRel = /\n[ \t]*/.exec(m[3]);
    if (nlRel) {
      const rest = /^[.)]*(?:\n|$)/.test(text.slice(g3[1] + 1));
      if (!rest) setHidden(g3[0] + nlRel.index, g3[0] + nlRel.index + nlRel[0].length, 0);
    }
    const got = extractMenuNodeName(text, start + 5, { multiLine: true });
    raw.push({ start: ind[2][0], end: ind[2][1], node: got ? got.target : null, url: null, kind: 'xref' });
    XREF_RE.lastIndex = next;
  }

  // menu entries
  const menuAt = menuStart(text);
  if (menuAt !== -1 && !options.index) {
    const re = new RegExp('^\\* Menu:|' + MENU_ENTRY_RE, 'gimd');
    re.lastIndex = menuAt;
    while ((m = re.exec(text))) {
      if (m[1] === undefined) continue;
      const ind = /** @type {RegExpExecArray & { indices: [number, number][] }} */ (m).indices;
      setHidden(ind[2][0], ind[6][1] - 1, 1);
      if (m[4] !== undefined && text[ind[4][1]] !== '.') setHidden(ind[4][0], ind[4][1], 0);
      setDisplay(ind[6][1] - 1, ind[6][1], ' ');
      const got = extractMenuNodeName(text, m.index + 2);
      if (got) raw.push({ start: ind[1][0], end: ind[1][1], node: got.target, url: null, kind: 'menu' });
      let line = text.indexOf('\n', ind[6][1]);
      let pos = ind[6][1];
      while (line !== -1) {
        const e = text.indexOf('\n', line + 1);
        const body = text.slice(line + 1, e === -1 ? n : e);
        const lead = /^([ \t]+)[^*\n]/.exec(body);
        if (!lead) {
          pos = line + 1;
          break;
        }
        // the indentation of a description's next line: hidden but for a last space
        setHidden(line + 1, line + 1 + lead[1].length - 1, 1);
        setDisplay(line + lead[1].length, line + lead[1].length + 1, ' ');
        pos = e === -1 ? n : e + 1;
        line = e;
      }
      if (line === -1) pos = n;
      re.lastIndex = pos;
    }
  }

  if (options.index) {
    INDEX_LINE_RE.lastIndex = 0;
    while ((m = INDEX_LINE_RE.exec(text))) setHidden(m.index, m.index + m[0].length, 1);
  }

  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text))) raw.push({ start: m.index, end: m.index + m[0].length, node: null, url: m[0], kind: 'url' });

  COOKIE_RE.lastIndex = 0;
  while ((m = COOKIE_RE.exec(text))) if (!hidden[m.index] && !disp[m.index]) setHidden(m.index, m.index + m[0].length, 1);

  let tail = n;
  while (tail > 0 && text[tail - 1] === '\n') tail--;
  if (tail < n - 1) setHidden(tail, n - 1, 1);

  let out = '';
  const shown = new Array(n + 1);
  for (let i = 0; i < n; ) {
    shown[i] = out.length;
    if (hidden[i]) {
      i++;
      continue;
    }
    const d = disp[i];
    if (d) {
      out += d.str;
      for (let j = i + 1; j < d.end; j++) shown[j] = out.length;
      i = d.end;
      continue;
    }
    out += text[i];
    i++;
  }
  shown[n] = out.length;
  const links = raw
    .map((r) => ({ start: shown[r.start], end: shown[r.end], node: r.node, url: r.url, kind: r.kind }))
    .filter((l) => l.end > l.start && (l.node !== null || l.url !== null))
    .sort((a, b) => a.start - b.start);
  /** Whether any text from `start` to `end` is hidden or replaced: what Info-isearch-filter rejects. */
  const touched = (/** @type {number} */ start, /** @type {number} */ end) => {
    for (let i = start; i < end; i++) if (hidden[i] || marked[i]) return true;
    return false;
  };
  return { text: out, links, touched, shown };
}
