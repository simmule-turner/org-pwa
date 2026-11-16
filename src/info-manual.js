// @ts-check
// One Info manual: its files (a split manual has a main file with a tag table and the parts it names) and what info.el does with
// them: finding a node by name (Info-find-node-2), the names to complete (Info-build-node-completions), the index nodes and an index
// search (Info-index-nodes, Info-index), and the table of contents (Info-toc-build).
import { InfoError, SEP, canonicalizeWhitespace, extractMenuNodeName, extractPointer, hasIndexCookie, headerNodeName, imagesOf, menuStart, quoteRegExp, replaceImages, segmentsOf } from './info-parse.js';

/** The suffixes Info-find-file tries on a file name, in order (Info-suffix-list on a Unix system). */
export const INFO_SUFFIXES = ['.info.Z', '.info.Y', '.info.gz', '.info.z', '.info.bz2', '.info.xz', '.info.zst', '.info', '-info.Z', '-info.Y', '-info.gz', '-info.bz2', '-info.z', '-info.xz', '-info.zst', '-info', '/index.Z', '/index.Y', '/index.gz', '/index.z', '/index.bz2', '/index.xz', '/index.zst', '/index', '.Z', '.Y', '.gz', '.z', '.bz2', '.xz', '.zst', ''];

/**
 * Info-find-file: which of the stored file names `filename` names, trying each suffix on the name as given and then on its lower
 * case form. Null when none.
 * @param {Iterable<string>} names
 * @param {string} filename
 * @returns {string | null}
 */
export function findFileName(names, filename) {
  const have = new Set(names);
  const exact = have.has(filename) ? filename : null;
  if (exact !== null) return exact;
  for (const suffix of INFO_SUFFIXES) {
    if (have.has(filename + suffix)) return filename + suffix;
    if (have.has(filename.toLowerCase() + suffix)) return filename.toLowerCase() + suffix;
  }
  return null;
}

/** @typedef {{ name: string, text: string, utf8: boolean, segs: import('./info-parse.js').Segment[], start: number }} Buffer one file of a manual, with its nodes and, for a part of a split manual, where its text starts in the whole */
/** @typedef {{ name: string, text: string, buffer: Buffer, seg: import('./info-parse.js').Segment, point: number | null, images?: { src: string, alt: string | null, text: string | null }[] }} NodeRef a node found in a manual: its name as the file spells it, its text (header line first), and where an anchor put point in it */

const utf8Length = (/** @type {string} */ text, /** @type {number} */ to) => new TextEncoder().encode(text.slice(0, to)).length;

/**
 * The index of the character that holds byte `byte` of a UTF-8 text (byte-to-position takes the character a middle byte lies in).
 * @param {string} text
 * @param {number} byte
 */
function byteToIndex(text, byte) {
  let bytes = 0;
  let i = 0;
  while (i < text.length) {
    const c = /** @type {number} */ (text.codePointAt(i));
    const size = c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
    if (bytes + size > byte) break;
    bytes += size;
    i += c > 0xffff ? 2 : 1;
  }
  return i;
}

/** Whether `text` has non-ASCII characters, so byte offsets differ from character offsets. @param {string} text */
const isAscii = (text) => !/[^\x00-\x7f]/.test(text);

/** The start of the line holding index `p`. @param {string} text @param {number} p */
const lineStart = (text, p) => (p <= 0 ? 0 : text.lastIndexOf('\n', p - 1) + 1);

export class Manual {
  /**
   * @param {string} mainName the name of the main file as stored
   * @param {Map<string, string>} files the text of every stored file by name: the main file and, when it is split, its parts
   * @param {string} [encoding] the character coding of the files ('utf-8' unless the file says otherwise)
   */
  constructor(mainName, files, encoding = 'utf-8') {
    this.name = mainName;
    this.files = files;
    this.utf8 = encoding.toLowerCase().replace('_', '-') === 'utf-8';
    const main = /** @type {string} */ (files.get(mainName));
    /** @type {Buffer} */
    this.main = this.makeBuffer(mainName, main, 0);
    /** @type {{ marker: number, indirect: boolean } | null} */
    this.tag = this.findTagTable(main);
    /** @type {{ name: string, offset: number }[] | null} */
    this.parts = this.partList(main);
    /** @type {Buffer[]} */
    this.buffers = [this.main];
    if (this.parts) {
      this.buffers = [];
      for (const part of this.parts) {
        const stored = findFileName(files.keys(), part.name);
        const text = stored === null ? undefined : files.get(stored);
        if (text !== undefined) this.buffers.push(this.makeBuffer(part.name, text, part.offset));
      }
    }
    /** @type {Map<string, NodeRef>} */
    this.nodeCache = new Map();
    /** @type {string[] | null | undefined} */
    this.indexCache = undefined;
    /** @type {ReturnType<Manual['buildToc']> | null} */
    this.tocCache = null;
  }

  /** @param {string} name @param {string} text @param {number} start @returns {Buffer} */
  makeBuffer(name, text, start) {
    return { name, text, utf8: this.utf8, segs: segmentsOf(text), start };
  }

  /** The tag table of the main file: where it starts and whether the manual is split, or null (Info-find-node-2's test). @param {string} text */
  findTagTable(text) {
    let pos = text.length;
    pos = lineStart(text, pos);
    for (let i = 0; i < 8 && pos > 0; i++) pos = lineStart(text, pos - 1);
    const end = /\x1f\nEnd tag table\n/i.exec(text.slice(pos));
    if (!end) return null;
    const before = text.slice(0, pos + end.index + end[0].length);
    const at = before.toLowerCase().lastIndexOf('\ntag table:\n');
    if (at === -1) return null;
    const indirect = text.startsWith('(Indirect)\n', at + '\nTag Table:\n'.length);
    return { marker: indirect ? at + '\nTag Table:\n(Indirect)\n'.length : at, indirect };
  }

  /** The parts of a split manual and where each starts, from the "Indirect:" table, or null. @param {string} text */
  partList(text) {
    const at = text.indexOf('\n\x1f\nIndirect:');
    if (at === -1) return null;
    const start = at + '\n\x1f\nIndirect:'.length;
    const stop = text.indexOf('\n\x1f', start);
    const block = text.slice(start, stop === -1 ? text.length : stop);
    /** @type {{ name: string, offset: number }[]} */
    const parts = [];
    for (const m of block.matchAll(/^(.*): ([0-9]+)$/gm)) parts.push({ name: m[1], offset: Number(m[2]) });
    return parts;
  }

  /** The tag table's text from where the search for a node starts. */
  tagText() {
    const tag = /** @type {{ marker: number }} */ (this.tag);
    const text = this.main.text;
    return text.slice(lineStart(text, tag.marker));
  }

  /**
   * Info-find-in-tag-table: the first entry for the node, as [is an anchor, byte position], trying the exact case first and, unless
   * `strictCase`, any case when that finds no anchor (which is also what Emacs does when it found a node).
   * @param {string} name @param {boolean} strictCase
   * @returns {{ anchor: boolean, pos: number } | null}
   */
  tagLookup(name, strictCase) {
    const tagText = this.tagText();
    const source = '(Node:|Ref:) *(' + quoteRegExp(name) + ') *[,\\t\\n\\x7f]';
    /** @param {boolean} fold */
    const one = (fold) => {
      const m = new RegExp(source, fold ? 'i' : '').exec(tagText);
      if (!m) return null;
      const num = /^\s*([0-9]+)/.exec(tagText.slice(m.index + m[0].length));
      if (!num) return null;
      return { anchor: m[1].toLowerCase() === 'ref:', pos: Number(num[1]) };
    };
    let found = one(false);
    if (!strictCase && !(found && found.anchor)) found = one(true);
    return found;
  }

  /** The buffer and index a byte position of a split manual lies at (Info-read-subfile). @param {number} nodepos */
  partPosition(nodepos) {
    const parts = /** @type {{ name: string, offset: number }[]} */ (this.parts);
    let last = null;
    for (const part of parts) {
      if (part.offset > nodepos) break;
      last = part;
    }
    if (!last) return null;
    const buffer = this.buffers.find((b) => b.name === /** @type {{ name: string }} */ (last).name);
    if (!buffer) return null;
    const first = buffer.text.startsWith(SEP) ? 1 : buffer.text.indexOf('\n' + SEP) + 2;
    const bytes = nodepos - /** @type {{ offset: number }} */ (last).offset + (buffer.utf8 ? utf8Length(buffer.text, first) : first);
    return { buffer, index: this.positionOf(buffer, bytes) };
  }

  /** @param {Buffer} buffer @param {number} bytes */
  positionOf(buffer, bytes) {
    return buffer.utf8 && !isAscii(buffer.text) ? byteToIndex(buffer.text, bytes) : bytes;
  }

  /**
   * Info-find-node-in-buffer: the first node at or after index `from` whose header line names `name`, exact case first and then, unless
   * `strictCase`, any case.
   * @param {Buffer} buffer @param {string} name @param {boolean} strictCase @param {number} from
   */
  searchBuffer(buffer, name, strictCase, from) {
    const source = '(Node:|Ref:) *(' + quoteRegExp(name) + ') *[,\\t\\n\\x7f]';
    for (const fold of strictCase ? [false] : [false, true]) {
      const re = new RegExp(source, fold ? 'i' : '');
      for (const seg of buffer.segs) {
        const eligible = seg.sep === 0 ? from === 0 : seg.sep - 1 >= from;
        if (eligible && re.test(seg.header)) return seg;
      }
    }
    return null;
  }

  /** @param {Buffer} buffer @param {import('./info-parse.js').Segment} seg @param {number | null} [point] @returns {NodeRef} */
  nodeRef(buffer, seg, point = null) {
    const raw = buffer.text.slice(seg.start, seg.end);
    return { name: /** @type {string} */ (headerNodeName(seg.header)), text: replaceImages(raw), buffer, seg, point, images: imagesOf(raw) };
  }

  /**
   * Info-find-node-2: the node named `nodename` (or the anchor, which gives the node it sits in). Throws an InfoError for no such node.
   * @param {string} nodename
   * @param {boolean} [strictCase]
   * @returns {NodeRef}
   */
  findNode(nodename, strictCase = false) {
    if (nodename === '*') {
      const seg = { sep: 0, start: 0, headerEnd: this.main.text.indexOf('\n') + 1, end: this.main.text.length, header: this.main.text.split('\n')[0] + '\n' };
      return { name: '*', text: this.main.text, buffer: this.main, seg, point: null };
    }
    /** @type {{ buffer: Buffer, index: number } | null} */
    let guess = null;
    if (this.tag) {
      const hit = this.tagLookup(nodename, strictCase);
      if (hit) {
        const where = this.parts ? this.partPosition(hit.pos) : { buffer: this.main, index: this.positionOf(this.main, hit.pos) };
        if (where) {
          if (hit.anchor) {
            let seg = null;
            for (const s of where.buffer.segs) if (s.sep < where.index) seg = s;
            if (seg && headerNodeName(seg.header) !== null) return this.nodeRef(where.buffer, seg, where.index - seg.start);
          }
          guess = { buffer: where.buffer, index: where.index };
        }
      }
    }
    if (guess) {
      for (const slack of [1000, 10000]) {
        const seg = this.searchBuffer(guess.buffer, nodename, strictCase, Math.max(0, guess.index - slack));
        if (seg) return this.nodeRef(guess.buffer, seg);
      }
    } else {
      for (const buffer of this.buffers) {
        const seg = this.searchBuffer(buffer, nodename, strictCase, 0);
        if (seg) return this.nodeRef(buffer, seg);
      }
    }
    const dotted = /([^.]+)\./.exec(nodename);
    if (dotted) return this.findNode(dotted[1]);
    throw new InfoError('No such node or anchor: ' + nodename);
  }

  /** The text of every node in the manual, in file order, by name (first one of a name wins). */
  allNodes() {
    /** @type {NodeRef[]} */
    const nodes = [];
    for (const buffer of this.buffers) {
      for (const seg of buffer.segs) if (headerNodeName(seg.header) !== null) nodes.push(this.nodeRef(buffer, seg));
    }
    return nodes;
  }

  /**
   * Info-build-node-completions: the names Go to node completes: "*" first, then the tag table's nodes and anchors, or the headers of
   * the file when it has no tag table.
   * @returns {string[]}
   */
  completions() {
    /** @type {string[]} */
    const names = ['*'];
    if (this.tag) {
      // the search starts at the marker and needs a newline before each entry, so the first entry of a split manual's table, which
      // the marker sits right in front of, is not found
      for (const m of this.main.text.slice(this.tag.marker).matchAll(/\n(?:Node|Ref): (.*)\x7f/gi)) names.push(m[1]);
      return names;
    }
    for (const buffer of this.buffers) {
      for (const seg of buffer.segs) {
        const m = /Node: *([^,\n]*) *[,\n\t]/i.exec(seg.header);
        if (m) names.push(m[1]);
      }
    }
    return names;
  }

  /**
   * Info-file-supports-index-cookies: whether makeinfo 4.7 or later made the file (its version is in the first lines).
   */
  supportsIndexCookies() {
    const head = this.main.text.split('\n', 3).join('\n') + '\n';
    const m = /makeinfo[ \n]version[ \n]([0-9]+.[0-9]+)/i.exec(head);
    if (!m) return false;
    const [major, minor] = m[1].split('.').map(Number);
    return major > 4 || (major === 4 && minor >= 7);
  }

  /**
   * Info-index-nodes: the names of the index nodes: those that carry the index cookie, or for a manual older than that the nodes of
   * the first "Index" menu entry of Top and the nodes that follow it while their names say "Index".
   * @returns {string[]}
   */
  indexNodes() {
    if (this.indexCache !== undefined) return this.indexCache || [];
    /** @type {string[]} */
    let nodes = [];
    if (this.supportsIndexCookies()) {
      for (const buffer of this.buffers) {
        let from = buffer.text.indexOf('\0\x08[index\0\x08]');
        while (from !== -1) {
          let sep = buffer.text.lastIndexOf(SEP, from);
          while (sep > 0 && buffer.text[sep - 1] !== '\n') sep = buffer.text.lastIndexOf(SEP, sep - 1);
          if (sep === -1) break;
          const nodeAt = /Node: /i.exec(buffer.text.slice(sep));
          if (nodeAt) {
            const name = /[ \t\n]*((?:\([^)]+\))?(?:[^,\t\n]*[^,\t\n ]|))/y;
            name.lastIndex = sep + nodeAt.index + nodeAt[0].length;
            const got = name.exec(buffer.text);
            if (got) nodes.push(got[1]);
          }
          from = buffer.text.indexOf('\0\x08[index\0\x08]', from + 1);
        }
      }
    } else {
      try {
        const top = this.findNode('Top').text;
        const at = menuStart(top);
        if (at !== -1) {
          const m = /\n\* (.*\bIndex\b)/i.exec(top.slice(at - 1));
          if (m) {
            const got = extractMenuNodeName(top, at - 1 + m.index + 3);
            if (got) {
              nodes = [got.target];
              let current = this.findNode(got.target);
              for (;;) {
                const next = extractPointer(current.text, 'next');
                if (next === null || !/\bIndex\b/i.test(next)) break;
                nodes.push(next);
                current = this.findNode(next);
              }
            }
          }
        }
      } catch (err) {
        if (!(err instanceof InfoError)) throw err;
      }
    }
    this.indexCache = nodes;
    return nodes;
  }

  /** Whether the node named `name` is an index node. @param {string} name */
  isIndexNode(name) {
    return this.indexNodes().includes(name);
  }

  /**
   * Info-index: the entries of the index nodes that contain `topic` (any case), the exact ones first, then the rest, each in the
   * order of the manual. An entry has its text, the node it leads to, the index node it is in and its line (0 when it has none).
   * @param {string} topic
   * @returns {{ entry: string, node: string, indexNode: string, line: number }[]}
   */
  indexMatches(topic) {
    const clean = topic.startsWith(':') ? topic.slice(1) : topic;
    const re = new RegExp('\\n\\* +([^\\n]*(' + quoteRegExp(clean) + ')[^\\n]*):[ \\t]+([^\\n]*)\\.(?:[ \\t\\n]*\\(line +([0-9]+)\\))?', 'gi');
    /** @type {{ entry: string, node: string, indexNode: string, line: number }[]} */
    const all = [];
    for (const name of this.indexNodes()) {
      const node = this.findNode(name);
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(node.text))) all.push({ entry: m[1], node: m[3], indexNode: node.name, line: Number(m[4] || 0) });
    }
    const exact = all.filter((e) => e.entry === clean);
    return [...exact, ...all.filter((e) => e.entry !== clean)];
  }

  /**
   * Info-toc-build: for every node its name, its Up node (none when that is in another file), the section it is listed under in Top,
   * and the nodes of its menu.
   * @returns {{ name: string, up: string | null, section: string | undefined, items: string[] }[]}
   */
  buildToc() {
    /** @type {string[][]} */
    const sections = [['Top', 'Top']];
    /** @type {{ name: string, up: string | null, section: string | undefined, items: string[] }[]} */
    const nodes = [];
    const indexNodes = this.indexNodes();
    for (const buffer of this.buffers) {
      const text = buffer.text;
      const head = /\n\x1f\nFile:/gi;
      let at = 0;
      for (;;) {
        head.lastIndex = at;
        const found = head.exec(text);
        if (!found) break;
        const nodeRe = /Node: /gi;
        nodeRe.lastIndex = found.index + found[0].length;
        const nodeFound = nodeRe.exec(text);
        if (!nodeFound) break;
        const nameStart = nodeFound.index + nodeFound[0].length;
        const nameRe = /[ \t\n]*((?:\([^)]+\))?(?:[^,\t\n]*[^,\t\n ]|))/y;
        nameRe.lastIndex = nameStart;
        const nodename = /** @type {RegExpExecArray} */ (nameRe.exec(text))[1];
        const nextSep = text.indexOf('\n' + SEP, nameStart);
        let bound = (nextSep === -1 ? text.length : nextSep + 2) - 2;
        const upRe = new RegExp('Up:[ \\t\\n]*((?:\\([^)]+\\))?(?:[^,\\t\\n]*[^,\\t\\n ]|))', 'gi');
        upRe.lastIndex = nameStart;
        const upFound = upRe.exec(text);
        /** @type {string | null} */
        let upnode = upFound && upFound.index + upFound[0].length <= bound ? upFound[1] : null;
        if (upnode !== null && upnode.includes('(')) upnode = null;
        let section = 'Top';
        /** @type {string[]} */
        const items = [];
        let point;
        if (!indexNodes.includes(nodename)) {
          const menuRe = /^\* Menu:/gim;
          menuRe.lastIndex = upFound && upFound.index + upFound[0].length <= bound ? upFound.index + upFound[0].length : nameStart;
          const menuFound = menuRe.exec(text);
          if (menuFound && menuFound.index + menuFound[0].length <= bound) {
            point = text.indexOf('\n', menuFound.index);
            point = point === -1 ? text.length : point + 1;
            if (nodename === 'Top') {
              const detail = /^[ \t—-]*The Detailed Node Listing/gm;
              detail.lastIndex = point;
              const d = detail.exec(text);
              if (d) bound = d.index + d[0].length;
            }
            while (point < bound) {
              const lineEnd = text.indexOf('\n', point);
              const line = text.slice(point, lineEnd === -1 ? text.length : lineEnd);
              if (/^\* +[^:]+:/.test(line)) {
                const got = extractMenuNodeName(text, point + 2);
                if (got) {
                  items.push(got.target);
                  if (nodename === 'Top') sections.unshift([got.target, section]);
                }
              } else if (nodename === 'Top') {
                const s = /^([^ \t\n*=.-][^:\n]*)/.exec(line);
                if (s) section = s[1];
              }
              point = lineEnd === -1 ? text.length : lineEnd + 1;
            }
          }
        }
        const sectionOf = sections.find((s) => s[0] === nodename);
        nodes.push({ name: nodename, up: upnode, section: sectionOf ? sectionOf[1] : undefined, items });
        at = Math.max(bound, nameStart);
      }
    }
    return nodes;
  }

  /** The table of contents: Info-toc-nodes, built once. */
  toc() {
    if (!this.tocCache) this.tocCache = this.buildToc();
    return this.tocCache;
  }

  /**
   * Info-toc-insert: the lines of the "*TOC*" node as (level, section heading or node) rows, in order.
   * @returns {{ level: number, section: string | null, node: string | null }[]}
   */
  tocRows() {
    const list = this.toc();
    /** @type {{ level: number, section: string | null, node: string | null }[]} */
    const rows = [{ level: 0, section: null, node: 'Top' }];
    /** @param {string[]} nodes @param {number} level */
    const insert = (nodes, level) => {
      let section = 'Top';
      for (const name of nodes) {
        const node = list.find((n) => n.name === name);
        if (node && node.section !== undefined && node.section !== section && node.name !== node.section) {
          section = node.section;
          rows.push({ level, section, node: null });
        }
        rows.push({ level, section: null, node: name });
        if (node) insert(node.items, level + 1);
      }
    };
    const top = list.find((n) => n.name === 'Top');
    insert(top ? top.items : [], 0);
    return rows;
  }
}

/** @param {string} s */
export const nodeKey = (s) => canonicalizeWhitespace(s);
/** Whether a node text begins its own index (carries the cookie). @param {string} text */
export const isCookieNode = (text) => hasIndexCookie(text);

/**
 * What Go to node offers for `typed`: Emacs completes node names (case ignored) with the basic and partial-completion styles, so the
 * typed text is a prefix of the name, or pieces of it that a blank, "-", "_", ".", "/", ":" or "|" separates are the starts of the
 * name's words ("L f" reaches "Lisp functions"). The names keep the manual's order.
 * @param {string[]} names the completions of the manual
 * @param {string} typed
 * @returns {string[]}
 */
export function completeNodeNames(names, typed) {
  const parts = typed.split(/([-_./:| ])/);
  const source = parts.map((p, i) => (i % 2 === 1 ? '.*' + p.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') : p.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'))).join('');
  const re = new RegExp('^' + source, 'i');
  return names.filter((n) => re.test(n));
}
