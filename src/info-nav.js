// @ts-check
// Moving through manuals the way Emacs's Info mode does: going to a node (also by `(manual)node`), Next, Prev, Up, the menu, history
// back and forward, the index (i and `,`), searching (s and S), and what SPC and DEL do at the end and the start of a node. The
// session holds what Info mode holds in its buffer: the current manual and node, point, the history. Each command is info.el's,
// written over the text of the manual (src/info-manual.js, src/info-parse.js).
import { emacsRegexToJs } from './elisp-regex.js';
import { InfoError, canonicalizeWhitespace, displayNode, extractMenuNodeName, extractPointer, menuItemTarget, quoteRegExp } from './info-parse.js';

/** @typedef {import('./info-manual.js').Manual} Manual */
/** @typedef {import('./info-manual.js').NodeRef} NodeRef */
/** @typedef {{ resolve: (filename: string) => Manual | null }} InfoLibrary where `(manual)node` and `dir` find their manuals */
/** @typedef {{ file: string, node: string, point: number }} HistoryEntry */

const WS = '[ \\t\\n\\r\\f]';

/**
 * Info-goto-node's reading of a node name: `(FILE)NODE`, `NODE` (file ''), or `(FILE)` (the Top node of FILE). Blanks around either
 * part go.
 * @param {string} spec
 * @returns {{ file: string, node: string }}
 */
export function parseGotoSpec(spec) {
  const m = new RegExp(WS + '*(\\(' + WS + '*([^\\t)]*)' + WS + '*\\)' + WS + '*|)([^\\n]*)').exec(spec);
  const [, whole, inner, rest] = /** @type {RegExpExecArray} */ (m);
  const trim = (/** @type {string} */ s) => s.replace(new RegExp(WS + '+$'), '');
  return { file: whole === '' ? '' : trim(inner), node: trim(rest) };
}

/** The line start at or before index `p`. @param {string} text @param {number} p */
const bol = (text, p) => (p <= 0 ? 0 : text.lastIndexOf('\n', p - 1) + 1);

/** forward-line by `n` lines (negative goes back): where point ends. @param {string} text @param {number} p @param {number} n */
function forwardLine(text, p, n) {
  let at = p;
  if (n > 0) {
    for (let i = 0; i < n; i++) {
      const nl = text.indexOf('\n', at);
      if (nl === -1) return text.length;
      at = nl + 1;
    }
    return at;
  }
  at = bol(text, at);
  for (let i = 0; i < -n && at > 0; i++) at = bol(text, at - 1);
  return at;
}

/**
 * An Emacs regexp as Info-search uses it: each run of blanks stands for any run of whitespace (Info-search-whitespace-regexp), unless
 * a repetition follows it.
 * @param {string} pattern
 * @param {boolean} fold
 */
export function searchRegExp(pattern, fold) {
  let out = '';
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\' && i + 1 < pattern.length) {
      out += c + pattern[++i];
      continue;
    }
    if (inClass) {
      out += c;
      if (c === ']' && !(out.endsWith('[]') || out.endsWith('[^]'))) inClass = false;
      continue;
    }
    if (c === '[') {
      inClass = true;
      out += c;
      continue;
    }
    if (c === ' ') {
      let j = i;
      while (pattern[j + 1] === ' ') j++;
      const after = pattern[j + 1];
      if (after === '*' || after === '+' || after === '?' || (after === '\\' && pattern[j + 2] === '{')) out += pattern.slice(i, j + 1);
      else out += '\\s-+';
      i = j;
      continue;
    }
    out += c;
  }
  return emacsRegexToJs(out, (fold ? 'i' : '') + 'g');
}

/** The Info breadcrumbs of a node: its ancestors up to four levels, "(manual)Top" first (Info-breadcrumbs), ending in a newline. @param {Manual} manual @param {string} fileName @param {string} current */
export function breadcrumbs(manual, fileName, current) {
  const nodes = manual.toc();
  /** @type {(string | null)[]} */
  const crumbs = [];
  let node = /** @type {string | null | undefined} */ (current);
  for (let depth = 4; node !== 'Top' && depth > 0; depth--) {
    const rec = nodes.find((n) => n.name === node);
    node = rec ? rec.up : null;
    if (node) crumbs.unshift(node);
  }
  crumbs.push(current);
  const first = crumbs.shift();
  const list = ['Top', ...(first === undefined || first === null || first === 'Top' ? crumbs : [null, ...crumbs])];
  const label = fileName.replace(/^.*\//, '').replace(/(.)\.[^.]*$/, '$1');
  return list.map((n) => (n === null ? '...' : n === 'Top' ? '(' + label + ')Top' : n)).join(' > ') + '\n';
}

/** The text of the "*TOC*" node Emacs builds for a manual: `filePath` is the file as Emacs names it in the header line. @param {Manual} manual @param {string} filePath */
export function tocNodeText(manual, filePath) {
  let out = `File: ${filePath},  Node: *TOC*,  Up: Top\n\nTable of Contents\n*****************\n\n*Note Top::\n`;
  for (const row of manual.tocRows().slice(1)) out += '\t'.repeat(row.level) + (row.section !== null ? row.section + '\n' : '*Note ' + row.node + ':: \n');
  return out;
}

/**
 * The text of the "*History*" node Emacs builds for `L` (Info-history-find-node): a menu of the nodes visited, the latest first, and where point
 * is once Info-history has moved it past two cross references (the second entry, or the first when there is only one).
 * @param {{ file: string, node: string }[]} visited Info-history-list, the *History* node itself left out
 * @returns {{ text: string, point: number, entries: { file: string, node: string }[] }}
 */
export function historyNodeText(visited) {
  const entries = visited.filter((v) => !(v.file === '*History*' && v.node === 'Top'));
  let text = 'File: *History*,  Node: Top,  Up: (dir)\n\nHistory of Visited Nodes\n************************\n\n* Menu:\n\n';
  const starts = [];
  for (const e of entries) {
    starts.push(text.length + 2);
    text += `* ${e.node}: (${e.file})${e.node}.\n`;
  }
  return { text, point: starts.length === 0 ? text.length : starts[Math.min(1, starts.length - 1)], entries };
}

/** What Info-index-next and Info-index report, for the status line. @typedef {{ message: string }} Note */

export class InfoSession {
  /** @param {InfoLibrary} library */
  constructor(library) {
    this.library = library;
    /** @type {Manual | null} */
    this.manual = null;
    /** @type {NodeRef | null} */
    this.node = null;
    /**
     * What Emacs has fontified in its *info* buffer since it last read a file or subfile into it: Info-isearch-filter sees hidden
     * text only there. `bufferId` names that file or subfile.
     * @type {Set<unknown>}
     */
    this.fontified = new Set();
    /** @type {string | null} */
    this.bufferId = null;
    /** Where point is, as an index into the node's text. */
    this.point = 0;
    /** @type {HistoryEntry[]} Info-history: the nodes left, most recent first */
    this.history = [];
    /** @type {HistoryEntry[]} Info-history-forward */
    this.forward = [];
    /** @type {{ file: string, node: string }[]} Info-history-list: every node visited, most recent first, each once */
    this.visited = [];
    /** @type {{ entry: string, node: string, indexNode: string, line: number }[]} */
    this.alternatives = [];
    this.alternative = 0;
    /** @type {string[]} */
    this.searchHistory = [];
    this.searchFold = true;
    /** What the last command had to say, shown in the status line. */
    this.message = '';
    /** @type {Map<string, ReturnType<typeof displayNode>>} */
    this.displays = new Map();
  }

  get file() {
    return this.manual ? this.manual.name : null;
  }

  get name() {
    return this.node ? this.node.name : null;
  }

  /** The text of the current node. */
  get text() {
    return this.node ? this.node.text : '';
  }

  /** The node as Info shows it: the text with the hidden markup left out, its links; cached for the node. */
  display() {
    const node = /** @type {NodeRef} */ (this.node);
    const key = (this.file || '') + '\0' + node.name;
    let shown = this.displays.get(key);
    if (!shown) {
      shown = displayNode(node.text, { index: /** @type {Manual} */ (this.manual).isIndexNode(node.name) });
      this.displays.set(key, shown);
    }
    return shown;
  }

  /**
   * Info-find-node: goes to `nodename` of `filename` (null: the current file), saving where it was in the history. When the node is
   * not found nothing changes and an InfoError says so.
   * @param {string | null} filename
   * @param {string} nodename
   * @param {{ noGoingBack?: boolean, strictCase?: boolean }} [options]
   */
  find(filename, nodename, options = {}) {
    const name = canonicalizeWhitespace(nodename);
    let manual = this.manual;
    if (filename !== null) {
      manual = this.library.resolve(filename);
      if (!manual && filename.toLowerCase() === 'dir') {
        // Emacs has emptied the buffer and reset its local variables by the time it finds there is no directory
        this.forward = [];
        if (this.manual && this.node) {
          this.bufferId = null;
          this.fontify(this.manual, this.node);
        }
        throw new InfoError("Can't find the Info directory node");
      }
      if (!manual) {
        if (!this.manual) this.find('dir', 'top', { noGoingBack: true });
        throw new InfoError(`Info file \`${filename}' does not exist; consider installing it`);
      }
    }
    if (!manual) throw new InfoError('No Info file');
    const ref = manual.findNode(name, !!options.strictCase);
    if (!options.noGoingBack && this.manual && this.node) this.history.unshift({ file: this.manual.name, node: this.node.name, point: this.point });
    this.manual = manual;
    this.node = ref;
    this.fontify(manual, ref);
    this.point = ref.point !== null ? ref.point : ref.text.indexOf('\n') + 1;
    this.forward = [];
    this.remember(manual.name, ref.name);
    if (ref.point !== null && name !== ref.name) this.remember(manual.name, name);
  }

  /**
   * Info-select-node's side effect on the buffer: a node of another file or subfile empties it, then the node gets fontified.
   * @param {Manual} manual @param {NodeRef} ref
   */
  fontify(manual, ref) {
    const id = manual.name + '\0' + ref.buffer.name;
    if (id !== this.bufferId) {
      this.bufferId = id;
      this.fontified = new Set();
    }
    this.fontified.add(ref.seg);
  }

  /** Info-history-list: puts a node first, once. @param {string} file @param {string} node */
  remember(file, node) {
    this.visited = [{ file, node }, ...this.visited.filter((v) => !(v.file === file && v.node === node))];
  }

  /**
   * Info-goto-node: `NODE` in this manual or `(MANUAL)NODE`; `(MANUAL)` alone is its Top node.
   * @param {string} spec
   * @param {boolean} [strictCase]
   */
  goto(spec, strictCase = false) {
    const { file, node } = parseGotoSpec(spec);
    this.find(file === '' ? null : file, node === '' ? 'Top' : node, { strictCase });
  }

  /** Info-directory: the directory node. */
  directory() {
    this.find('dir', 'top');
  }

  /** Info-top-node. */
  top() {
    this.goto('Top');
  }

  /** Info-extract-pointer of the current node, or an InfoError "Node has no X". @param {string} name @param {string} label */
  pointer(name, label) {
    const got = extractPointer(this.text, name);
    if (got === null) throw new InfoError('Node has no ' + label);
    return got;
  }

  /** Info-next. */
  next() {
    this.goto(this.pointer('next', 'Next'));
  }

  /** Info-prev. */
  prev() {
    this.goto(this.pointer('prev[ious]*', 'Previous'));
  }

  /**
   * Info-up: the superior node, with point on the menu entry that leads back here when the menu has one.
   * @param {boolean} [sameFile]
   */
  up(sameFile = false) {
    const oldNode = this.name;
    const oldFile = this.file;
    const node = this.pointer('up', 'Up');
    if (sameFile && node.startsWith('(')) throw new InfoError('Up node is in another Info file');
    this.goto(node);
    const p = this.point;
    const text = this.text;
    const menu = text.toLowerCase().indexOf('\n* menu:');
    if (oldFile !== null && menu !== -1) {
      const base = oldFile.replace(/^.*\//, '');
      const re = oldNode === 'Top' ? new RegExp('\\n\\*[^:]+: +\\(' + base.replace(/[\\[\]*+?^$|(){}]/g, '\\$&') + '\\)', 'i') : new RegExp('\\n\\* +(' + quoteRegExp(/** @type {string} */ (oldNode)) + ':|[^:]+: +' + quoteRegExp(/** @type {string} */ (oldNode)) + ')', 'i');
      const m = re.exec(text.slice(menu + 8));
      if (m) {
        const end = menu + 8 + m.index + m[0].length;
        const start = bol(text, end);
        this.point = text.startsWith('* ', start) ? start + 2 : start;
        return;
      }
    }
    this.point = p;
    for (const h of this.history) {
      if (h.file === this.file && h.node === this.name) {
        this.point = h.point;
        break;
      }
    }
  }

  /** Info-menu: the node of the menu entry called `item` (a start of its name will do). @param {string} item */
  menu(item) {
    this.gotoMenuEntry(menuItemTarget(this.text, item, this.isIndex()), this.isIndex());
  }

  /**
   * Goes to the node a menu entry names; from an index node point goes to the entry's line or definition too (Info-point-loc).
   * @param {{ target: string, label: string, line: number | null }} got
   * @param {boolean} indexNode
   */
  gotoMenuEntry(got, indexNode) {
    this.goto(got.target);
    if (!indexNode || this.node === null || this.node.point !== null) return;
    if (got.line !== null) this.point = forwardLine(this.text, this.point, got.line - 2);
    else this.point = this.findIndexName(got.label, this.point);
  }

  /** Info-history-back. */
  historyBack() {
    if (this.history.length === 0) throw new InfoError('This is the first Info node you looked at');
    const forward = [{ file: /** @type {string} */ (this.file), node: /** @type {string} */ (this.name), point: this.point }, ...this.forward];
    const [target] = this.history;
    this.history = this.history.slice(1);
    this.find(target.file, target.node);
    this.history = this.history.slice(1);
    this.forward = forward;
    this.point = target.point;
  }

  /** Info-history-forward. */
  historyForward() {
    if (this.forward.length === 0) throw new InfoError('This is the last Info node you looked at');
    const [target, ...rest] = this.forward;
    this.find(target.file, target.node);
    this.forward = rest;
    this.point = target.point;
  }

  /**
   * Info-extract-menu-counting: the node of the `count`th menu entry, or of the last one (`count` null). `noDetail` stops before
   * "The Detailed Node Listing".
   * @param {number | null} count
   * @param {boolean} [noDetail]
   * @returns {{ target: string, label: string, line: number | null }}
   */
  menuCounting(count, noDetail = false) {
    const text = this.text;
    let bound = text.length;
    if (noDetail) {
      const d = /^[ \t-]*The Detailed Node Listing/m.exec(text.slice(this.point));
      if (d) bound = this.point + d.index;
    }
    const at = text.toLowerCase().indexOf('\n* menu:');
    if (at === -1 || at + 8 > bound) throw new InfoError('No menu in this node');
    let p = at + 8;
    let after = -1;
    if (count !== null) {
      for (let i = 0; i < count; i++) {
        const f = text.indexOf('\n* ', p);
        if (f === -1 || f + 3 > bound) throw new InfoError('Too few items in menu');
        p = f + 3;
        after = p;
      }
    } else {
      for (;;) {
        const f = text.indexOf('\n* ', p);
        if (f === -1 || f + 3 > bound) break;
        p = f + 3;
        after = p;
      }
    }
    const got = after === -1 ? null : extractMenuNodeName(text, after, { indexNode: this.isIndex() });
    if (!got) throw new InfoError('No such item in menu');
    return got;
  }

  /** Whether the current node is an index node. */
  isIndex() {
    return !!this.manual && !!this.name && this.manual.isIndexNode(this.name);
  }

  /** Info-next-menu-item: the node of the first menu entry after point. */
  nextMenuItem() {
    const text = this.text;
    let p = forwardLine(text, this.point, -1);
    const menu = text.toLowerCase().indexOf('\n* menu:', p);
    if (menu !== -1) p = menu + 8;
    const star = text.indexOf('\n* ', p);
    const got = star === -1 ? null : extractMenuNodeName(text, star + 3);
    if (!got) throw new InfoError('No more items in menu');
    this.goto(got.target);
  }

  /** Info-last-menu-item: the node of the menu entry before point. */
  lastMenuItem() {
    const text = this.text;
    const p = forwardLine(text, this.point, 1);
    const lower = text.toLowerCase();
    const beg = lower.lastIndexOf('\n* menu:', p - 8);
    const star = beg === -1 ? -1 : text.lastIndexOf('\n* ', p - 3);
    if (star === -1 || star < beg) throw new InfoError('No previous items in menu');
    const got = extractMenuNodeName(text, star + 3);
    if (!got) throw new InfoError('No such item in menu');
    this.goto(got.target);
  }

  /** @param {() => void} fn runs it and says whether it succeeded: Info-no-error */
  attempt(fn) {
    try {
      fn();
      return true;
    } catch (err) {
      if (err instanceof InfoError) return false;
      throw err;
    }
  }

  /** Info-next-preorder. */
  nextPreorder() {
    if (this.attempt(() => this.nextMenuItem())) return;
    if (this.attempt(() => this.next())) return;
    if (this.attempt(() => this.up(true))) {
      this.point = this.text.length;
      const old = [...this.history];
      this.nextPreorder();
      this.history = old;
      return;
    }
    throw new InfoError('No more nodes');
  }

  /** Info-last-preorder (with Info-scroll-prefer-subnodes nil, its default). */
  lastPreorder() {
    const prev = this.attempt(() => this.pointer('prev', 'Previous'));
    if (prev && this.pointer('up', 'Up') !== this.pointer('prev', 'Previous')) {
      this.attempt(() => this.prev());
      this.point = this.text.length;
      const old = [...this.history];
      while (this.attempt(() => { this.lastMenuItem(); this.point = this.text.length; })) {
        // keeps going down the last menu entries
      }
      this.history = old;
      return;
    }
    if (this.attempt(() => this.up(true))) {
      const menu = this.text.toLowerCase().indexOf('\n* menu:');
      this.point = menu === -1 ? this.text.length : menu + 8;
      return;
    }
    throw new InfoError('No previous nodes');
  }

  /**
   * What SPC does when the end of the node shows: the first menu entry's node, else the next node of the preorder (the next one
   * at this level, or the superior's next).
   */
  scrollForward() {
    this.point = this.text.length;
    if (this.attempt(() => this.gotoMenuEntry(this.menuCounting(1), this.isIndex()))) return;
    this.nextPreorder();
  }

  /** What DEL does when the start of the node shows: the end of the previous node, descending its last menu entries. */
  scrollBackward() {
    this.lastPreorder();
  }

  /**
   * Info-index: goes to the first entry for `topic` in the manual's index and keeps the rest for `,`. An empty topic goes to the
   * index node itself.
   * @param {string} topic
   */
  index(topic) {
    const manual = /** @type {Manual} */ (this.manual);
    if (this.file !== null && this.file.toLowerCase().replace(/^.*\//, '') === 'dir') throw new InfoError('The Info directory node has no index; type m to select a manual');
    const clean = topic.startsWith(':') ? topic.slice(1) : topic;
    const nodes = manual.indexNodes();
    if (nodes.length === 0) throw new InfoError('No index');
    const origNode = this.name;
    const visited = this.visited;
    this.goto(nodes[0]);
    if (clean === '') return;
    // The rest runs with Info-history bound to nil, so that these moves leave no history.
    const afterFirst = this.history;
    this.history = [];
    try {
      for (const name of nodes.slice(1)) this.goto(name);
      const matches = manual.indexMatches(clean);
      if (matches.length === 0) {
        this.goto(/** @type {string} */ (origNode));
        throw new InfoError(`No \`${clean}' in index`);
      }
      this.visited = visited;
      this.alternatives = matches;
      this.alternative = 0;
      this.indexNext(0);
    } finally {
      this.history = afterFirst;
    }
  }

  /** Info-index-next: the next (or, by a negative `num`, an earlier) entry found by the last index search. @param {number} num */
  indexNext(num) {
    if (this.alternatives.length === 0) throw new InfoError("No previous `i' command");
    let index = this.alternative + num;
    const total = this.alternatives.length;
    if (total > 1 && index < 0) {
      this.alternative = total - 2;
      this.message = "No previous matches, use `,' to continue from end of list";
      return;
    }
    if (total > 1 && index >= total) {
      this.alternative = -1;
      this.message = "No previous matches, use `,' to continue from start of list";
      return;
    }
    index = ((index % total) + total) % total;
    this.alternative = index;
    const entry = this.alternatives[index];
    this.goto(entry.node);
    const text = this.text;
    if (entry.line > 0) this.point = forwardLine(text, this.point, entry.line - 2);
    else {
      this.point = forwardLine(text, this.point, 3);
      this.point = this.findIndexName(entry.entry, this.point);
    }
    this.message = `Found \`${entry.entry}' in ${entry.indexNode}.  ${total > 1 ? `(${total} total; use \`,' for next)` : '(Only match)'}`;
  }

  /**
   * Info-find-index-name: the start of the line in this node where `name` is defined, or the top of the node. Two of the searches
   * there are literal text with brackets in it, as in info.el, and find nothing.
   * @param {string} name
   * @param {number} from
   * @returns {number}
   */
  findIndexName(name, from) {
    const text = this.text;
    const rest = text.slice(from);
    const q = quoteRegExp(name);
    /** @param {string} re */
    const find = (re) => {
      const m = new RegExp(re, 'im').exec(rest);
      return m ? from + m.index + m[0].length : -1;
    };
    /** @param {string} literal */
    const literal = (literal) => {
      const i = rest.toLowerCase().indexOf(literal.toLowerCase());
      return i === -1 ? -1 : from + i + literal.length;
    };
    let at = find(`[a-zA-Z]+: ${q}(?: |$)`);
    if (at === -1) at = find(`[a-zA-Z]+: [a-zA-Z0-9_ *&]+ ${q}(?: |$)`);
    if (at === -1) at = literal(`['\`‘]${name}['’]`);
    const paren = /^.*( \(.*\))$/.exec(name);
    if (at === -1 && paren) at = literal(`['\`‘]${name.slice(0, name.length - paren[1].length)}['’]`);
    if (at === -1) at = literal(name);
    if (at === -1) {
      const numbered = /^(.*) <[0-9]+>$/.exec(name);
      if (numbered) return bol(text, this.findIndexName(numbered[1], from));
    }
    return at === -1 ? 0 : bol(text, at);
  }

  /**
   * Info-search: from point to the next match of the Emacs regexp `pattern` in this node and the following ones of the manual,
   * going to the node it is in (point after the match). Hits in the header line do not count, nor do those in text Info hides or replaces where Emacs has fontified it. An empty pattern repeats the
   * last one.
   * @param {string} pattern
   * @param {boolean} [fold]
   */
  search(pattern, fold = true) {
    let regexp = pattern;
    if (regexp === '') regexp = this.searchHistory[0] || '';
    if (regexp === '') throw new InfoError('No previous search');
    this.searchHistory = [regexp, ...this.searchHistory.filter((p) => p !== regexp)];
    this.searchFold = fold;
    const re = searchRegExp(regexp, fold);
    const manual = /** @type {Manual} */ (this.manual);
    const nodes = manual.allNodes();
    const here = /** @type {NodeRef} */ (this.node);
    const current = nodes.findIndex((n) => n.buffer === here.buffer && n.seg === here.seg);
    for (let i = Math.max(current, 0); i < nodes.length; i++) {
      const node = nodes[i];
      const from = i === current ? this.point : 0;
      const sameBuffer = manual.name + '\0' + node.buffer.name === this.bufferId;
      const shown = sameBuffer && this.fontified.has(node.seg) ? displayNode(node.text, { index: manual.isIndexNode(node.name) }) : null;
      const headerEnd = node.text.indexOf('\n');
      re.lastIndex = from;
      let m;
      while ((m = re.exec(node.text))) {
        if (m[0] === '') re.lastIndex++;
        const end = m.index + m[0].length;
        if (end <= headerEnd || (shown && shown.touched(m.index, end))) continue;
        const before = { file: /** @type {string} */ (this.file), node: /** @type {string} */ (this.name), point: this.point };
        if (i !== current) {
          this.node = node;
          this.fontify(manual, node);
          this.history.unshift(before);
          this.forward = [];
          this.remember(manual.name, node.name);
        }
        this.point = m.index + m[0].length;
        return;
      }
    }
    // Without subfiles Emacs repeats the search without its filter for hidden text, in the node; a hit there (in the hidden markup
    // or the header) gets it past the "Search failed" check and into a failed read of the subfile list.
    if (manual.buffers.length <= 1) {
      const again = searchRegExp(regexp, fold);
      again.lastIndex = this.point;
      if (again.exec(here.text)) {
        this.forward = []; // the cleanup selects the node again
        this.remember(manual.name, here.name);
        throw new InfoError('Wrong type argument: stringp, nil');
      }
    }
    // A failed search of a split manual has read the other subfiles over the buffer, and reads the first one back.
    if (manual.buffers.length > 1) {
      this.bufferId = null;
      this.fontify(manual, here);
      this.forward = [];
      this.remember(manual.name, here.name);
    }
    throw new InfoError(`Search failed: "${regexp.replace(/[\\"]/g, '\\$&')}"`);
  }

  /** Info-search-next: the same search again. */
  searchNext() {
    this.search('', this.searchFold);
  }
}
