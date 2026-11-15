// @ts-check
/**
 * `org-list-to-lisp` and `org-list-to-generic` (and `-org`, `-html`, `-latex`, `-subtree`), after org-list.el. A list is the symbol of
 * its type followed by its items; an item is a list of strings and sub-lists. `org-list-to-generic` writes it back as Org syntax,
 * reads it again, and transcodes every list and item by the parameters (`:istart`, `:ifmt`, ...) and, where none applies, by the
 * back end named in `:backend` (org when none).
 */
import { Cons, NIL, Sym, Subr, intern, isStr, list, print, toArray } from './elisp-data.js';
import { funcall } from './elisp-core.js';
import { findLists } from './list-edit.js';
import { parseOrg } from './org-parser.js';
import { exportHtmlObjects } from './export-html.js';
import { exportLatexObjects } from './export-latex.js';
import { exportToAscii } from './export-ascii.js';
import { backendName, combine, isFunction, normalizeString, nonBlank, pget, plistOf, text, trim } from './export-convert-lisp.js';
import { signal } from './elisp-data.js';

/** @typedef {import('./elisp-data.js').LObj} LObj */
/** @typedef {{ kind: 'para', text: string, blank: number, raw?: boolean }} Paragraph a paragraph, or (raw) a block whose lines are kept as they are */
/** @typedef {{ kind: 'list', list: PlainList, blank: number }} SubList */
/** @typedef {{ type: 'ordered' | 'unordered' | 'descriptive', items: Item[] }} PlainList */
/** @typedef {{ counter: number | null, checkbox: 'on' | 'off' | 'trans' | null, tag: string | null, children: (Paragraph | SubList)[] }} Item */

/** `string-width` of the leading part of an item line. @param {string} s */
function stringWidth(s) {
  let w = 0;
  for (const ch of s) w += ch === '\t' ? 8 : 1;
  return w;
}

/** `org-remove-indentation`. @param {string} s */
function removeIndentation(s) {
  const lines = s.split('\n');
  let min = Infinity;
  for (const l of lines) {
    if (!/\S/.test(l)) continue;
    const ind = stringWidth(/^[ \t]*/.exec(l)?.[0] ?? '');
    if (ind === 0) return s;
    min = Math.min(min, ind);
  }
  return lines.map((l) => (/\S/.test(l) ? ' '.repeat(stringWidth(/^[ \t]*/.exec(l)?.[0] ?? '') - min) + l.replace(/^[ \t]*/, '') : '')).join('\n');
}

/** Where each item ends: at the next line, blank or not, that is indented no more than the item (Org's `org-list-struct`). @param {string[]} lines @param {{ line: number, indent: number }[]} items @param {number} listEnd @returns {number[]} */
function itemEnds(lines, items, listEnd) {
  return items.map((it) => {
    for (let j = it.line + 1; j < listEnd; j++) if (lines[j].trim() !== '' && stringWidth(/^[ \t]*/.exec(lines[j])?.[0] ?? '') <= it.indent) return j;
    return listEnd;
  });
}

/** The type of a list from the text its items start with. @param {string} first @param {string} bullet @returns {'ordered' | 'unordered' | 'descriptive'} */
function listTypeOf(first, bullet) {
  return /^(.*)[ \t]+::(?:[ \t]+|$)/.test(first.replace(/^(?:\[@[0-9A-Za-z]+\][ \t]*)?(?:\[[ X-]\](?:[ \t]+|$))?/, '')) ? 'descriptive' : /[0-9A-Za-z]/.test(bullet) ? 'ordered' : 'unordered';
}

/**
 * `org-list-to-lisp` on the text of a buffer, for the list at a line.
 * @param {string} source @param {number} lineIndex  the line point is on
 * @returns {{ value: LObj, start: number, end: number, top: number } | null} the parsed list and the lines it takes
 */
export function listToLisp(source, lineIndex) {
  const lines = source.split('\n');
  const found = findLists(lines).find((l) => lineIndex >= l.start && lineIndex < l.end) ?? findLists(lines, true).find((l) => lineIndex >= l.start && lineIndex < l.end);
  if (!found) return null;
  const starts = [0];
  for (let i = 0; i < lines.length; i++) starts.push(starts[i] + lines[i].length + 1);
  const { items } = found;
  const ends = itemEnds(lines, items, found.end);
  const slice = (/** @type {number} */ from, /** @type {number} */ to) => source.slice(from, Math.min(to, source.length));
  /** `trim` of org-list-to-lisp: no indentation, no final newline. @param {string} t */
  const trimText = (t) => removeIndentation(t.endsWith('\n') ? t.slice(0, -1) : t);
  /** @param {number[]} siblings @returns {LObj} */
  const parseSublist = (siblings) => {
    const first = items[siblings[0]];
    const m = /^[ \t]*\S+[ \t]*/.exec(lines[first.line]) ?? [''];
    const firstText = lines[first.line].slice(m[0].length);
    const type = listTypeOf(firstText, first.bullet);
    return list([intern(type), ...siblings.map(parseItem)]);
  };
  /** @param {number} idx @returns {LObj} */
  const parseItem = (idx) => {
    const it = items[idx];
    const children = items.map((x, i) => i).filter((i) => items[i].parent === idx);
    const bodyEnd = children.length ? starts[items[children[0]].line] : starts[ends[idx]];
    const m = /^[ \t]*\S+[ \t]*/.exec(lines[it.line]) ?? [''];
    /** @type {LObj[]} */
    const body = [trimText(' '.repeat(stringWidth(m[0])) + slice(starts[it.line] + m[0].length, bodyEnd))];
    if (children.length) {
      body.push(parseSublist(children));
      const subEnd = starts[ends[children[children.length - 1]]];
      const itemEnd = starts[ends[idx]];
      if (subEnd !== itemEnd) body.push(trimText(slice(subEnd, itemEnd)));
    }
    return list(body);
  };
  const top = items.map((x, i) => i).filter((i) => items[i].parent === -1);
  return { value: parseSublist(top), start: found.start, end: found.end, top: starts[found.start] };
}

/** The lines of text at the end of a string, as `org-list--trailing-newlines` counts them. @param {string} s */
function trailingNewlines(s) {
  const tail = /[ \t\n]*$/.exec(s)?.[0] ?? '';
  const newlines = (tail.match(/\n/g) ?? []).length;
  if (!newlines) return 0;
  return newlines - 1 + (/[^\n]$/.test(tail) ? 1 : 0);
}

/** @param {LObj} listValue @returns {string} the list as Org syntax */
function listAsText(listValue) {
  /** @param {LObj} l @returns {string} */
  const insertList = (l) => (l instanceof Cons ? toArray(l.cdr).map((i) => insertItem(i, l.car)).join('') : '');
  /** @param {LObj} item @param {LObj} type @returns {string} */
  const insertItem = (item, type) => {
    const ordered = type instanceof Sym && type.name === 'ordered';
    const ind = ordered ? 3 : 2;
    let out = ordered ? '1. ' : '- ';
    for (const e of toArray(item)) out += e instanceof Cons ? insertList(e) : text(e) + '\n';
    const lines = out.split('\n');
    return lines.map((l, i) => (i === 0 || l.trim() === '' ? l : ' '.repeat(ind) + l)).join('\n');
  };
  return insertList(listValue);
}

/** @param {string} source @returns {PlainList | null} */
function parseList(source) {
  const lines = source.replace(/\n$/, '').split('\n');
  const found = findLists(lines)[0];
  if (!found || found.start !== 0) return null;
  const { items } = found;
  const ends = itemEnds(lines, items, found.end);
  /** @param {number[]} siblings @returns {PlainList} */
  const build = (siblings) => {
    const bullet = items[siblings[0]].bullet;
    const firstLine = lines[items[siblings[0]].line].replace(/^[ \t]*\S+[ \t]*/, '');
    return { type: listTypeOf(firstLine, bullet), items: siblings.map(buildItem) };
  };
  /** @param {number} idx @returns {Item} */
  const buildItem = (idx) => {
    const it = items[idx];
    const children = items.map((x, i) => i).filter((i) => items[i].parent === idx);
    const first = lines[it.line].replace(/^[ \t]*\S+[ \t]*/, '');
    const parsed = /^(?:\[@([0-9A-Za-z]+)\][ \t]*)?(?:\[([ X-])\](?:[ \t]+|$))?(?:(.*)[ \t]+::(?:[ \t]+|$))?/.exec(first) ?? [''];
    const counter = parsed[1] === undefined ? null : /^\d+$/.test(parsed[1]) ? Number(parsed[1]) : parsed[1].toLowerCase().charCodeAt(0) - 96;
    const checkbox = parsed[2] === undefined ? null : parsed[2] === 'X' ? 'on' : parsed[2] === ' ' ? 'off' : 'trans';
    const tag = parsed[3] === undefined ? null : parsed[3];
    const rest = first.slice(parsed[0].length);
    /** @type {(Paragraph | SubList)[]} */
    const kids = [];
    /** @param {string[]} chunk @param {boolean} firstOfItem */
    const paragraphs = (chunk, firstOfItem) => {
      // group the lines in paragraphs; the blank lines after one are its post-blank
      /** @type {string[][]} */
      const groups = [];
      /** @type {boolean[]} */
      const blocks = [];
      /** @type {number[]} */
      const blanks = [];
      let inBlock = false;
      for (const l of chunk) {
        if (inBlock) {
          groups[groups.length - 1].push(l);
          if (/^[ \t]*#\+end_/i.test(l)) inBlock = false;
        } else if (/^[ \t]*#\+begin_/i.test(l)) {
          groups.push([l]);
          blocks[groups.length - 1] = true;
          inBlock = !/^[ \t]*#\+end_/i.test(l);
        } else if (l.trim() === '') {
          if (groups.length) blanks[groups.length - 1] = (blanks[groups.length - 1] ?? 0) + 1;
        } else if (!groups.length || blanks[groups.length - 1] || blocks[groups.length - 1]) groups.push([l]);
        else groups[groups.length - 1].push(l);
      }
      groups.forEach((g, gi) => {
        if (blocks[gi]) {
          kids.push({ kind: 'para', raw: true, text: g.map((l, k) => (k === 0 || k === g.length - 1 ? l.replace(/^[ \t]+/, '') : l)).join('\n') + '\n', blank: blanks[gi] ?? 0 });
          return;
        }
        const ignoreFirst = firstOfItem && gi === 0;
        const rest2 = ignoreFirst ? g.slice(1) : g;
        const min = Math.min(Infinity, ...rest2.filter((l) => l.trim()).map((l) => stringWidth(/^[ \t]*/.exec(l)?.[0] ?? '')));
        const cut = (/** @type {string} */ l) => (min === Infinity ? l : l.replace(new RegExp(`^[ \\t]{0,${min}}`), ''));
        const body = (ignoreFirst ? [g[0].replace(/^[ \t]+/, ''), ...rest2.map(cut)] : rest2.map(cut)).join('\n');
        kids.push({ kind: 'para', text: body + '\n', blank: blanks[gi] ?? 0 });
      });
    };
    const childStart = children.length ? items[children[0]].line : ends[idx];
    const textLines = [rest, ...lines.slice(it.line + 1, childStart)];
    paragraphs(textLines, true);
    if (children.length) {
      kids.push({ kind: 'list', list: build(children), blank: 0 });
      const subEnd = ends[children[children.length - 1]];
      if (subEnd < ends[idx]) paragraphs(lines.slice(subEnd, ends[idx]), false);
    }
    return { counter, checkbox, tag, children: kids };
  };
  return build(items.map((x, i) => i).filter((i) => items[i].parent === -1));
}

/** @param {string} backend @returns {{ objects: (t: string) => string, plain: (t: string) => string, list: (type: PlainList['type'], contents: string) => string, item: (list: PlainList, item: Item, contents: string, orderedLevel: number, tag: string | null) => string, paragraph: (p: Paragraph, parentItem: Item, position: number, objs: (t: string) => string) => string } | null} */
function listBackend(backend) {
  if (backend === 'org') return null;
  const doc = parseOrg('');
  if (backend === 'html') {
    return {
      objects: (t) => exportHtmlObjects(doc, t),
      plain: (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\\-/g, '&#x00ad;').replace(/---(?!-)/g, '&#x2014;').replace(/(^|[^-])--(?=[^-]|$)/g, '$1&#x2013;').replace(/\.\.\./g, '&#x2026;'),
      list: (type, contents) => {
        const tag = type === 'ordered' ? 'ol' : type === 'unordered' ? 'ul' : 'dl';
        return `<${tag} class="org-${tag}">\n${contents}</${tag}>`;
      },
      item: (l, it, contents, _level, tag) => {
        const cls = it.checkbox ? ` class="${it.checkbox}"` : '';
        const box = it.checkbox ? { on: '<code>[X]</code>', off: '<code>[&#xa0;]</code>', trans: '<code>[-]</code>' }[it.checkbox] + ' ' : '';
        const body = nonBlank(contents) ? trim(contents) : '';
        if (l.type === 'descriptive') return `<dt${cls}>${box}${tag ?? '(no term)'}</dt><dd>${body}</dd>`;
        const term = tag;
        const extra = l.type === 'ordered' ? (term ?? it.counter) !== null ? ` value="${term ?? it.counter}"` : '' : term !== null ? ` id="${term}"` : '';
        return `<li${cls}${extra}>${box}${body}</li>`;
      },
      paragraph: (p, parent, position, objs) => {
        const followers = parent.children.slice(position + 1);
        if (position === 0 && followers.length <= 1 && (followers.length === 0 || followers[0].kind === 'list')) return objs(p.text);
        return `<p>\n${objs(p.text)}</p>`;
      },
    };
  }
  return {
    objects: (t) => exportLatexObjects(doc, t),
    plain: (t) => t.replace(/[%$#&{}_~^\\]/g, (c) => (c === '\\' ? '$\\backslash$' : c === '~' ? '\\textasciitilde{}' : c === '^' ? '\\^{}' : '\\' + c)).replace(/\.\.\./g, '\\ldots{}'),
    list: (type, contents) => {
      const env = type === 'ordered' ? 'enumerate' : type === 'descriptive' ? 'description' : 'itemize';
      return `\\begin{${env}}\n${contents}\\end{${env}}`;
    },
    item: (l, it, contents, orderedLevel, tagOut) => {
      const ordered = l.type === 'ordered';
      const box = it.checkbox ? { on: '$\\boxtimes$', off: '$\\square$', trans: '$\\boxminus$' }[it.checkbox] : null;
      const tag = tagOut;
      const counter = it.counter !== null && orderedLevel < 5 ? `\\setcounter{enum${['i', 'ii', 'iii', 'iv'][Math.max(orderedLevel - 1, 0)]}}{${it.counter - 1}}\n` : '';
      let head = '\\item';
      if (box && tag) head += (ordered ? `{${box} ${tag}} ` : `[{${box} ${tag}}] `);
      else if (box || tag) head += (ordered ? `{${box ?? tag}} ` : `[{${box ?? tag}}] `);
      else if (/^[ \t]*\[/.test(contents)) head += '\\relax ';
      else head += ' ';
      return counter + head + trim(contents);
    },
    paragraph: (p, _parent, _position, objs) => objs(p.text),
  };
}

/**
 * `org-list-to-generic`.
 * @param {LObj} listValue @param {LObj} params
 * @returns {string}
 */
export function listToGeneric(listValue, params) {
  const P = (/** @type {string} */ k) => pget(params, k);
  const name = backendName(P(':backend'));
  const raw = P(':raw') !== NIL;
  const splice = P(':splice') !== NIL;
  const [ustart, uend, ostart, oend, dstart, dend, istart, iend, icount, isep, ifmt, cbon, cboff, cbtrans, dtstart, dtend, ddstart, ddend] = [':ustart', ':uend', ':ostart', ':oend', ':dstart', ':dend', ':istart', ':iend', ':icount', ':isep', ':ifmt', ':cbon', ':cboff', ':cbtrans', ':dtstart', ':dtend', ':ddstart', ':ddend'].map(P);
  const parsed = listValue instanceof Cons ? parseList(listAsText(listValue)) : null;
  const B = name && name !== 'org' ? listBackend(name) : null;
  if (name === 'ascii') {
    if (splice || [ustart, uend, ostart, oend, dstart, dend, istart, iend, icount, isep, ifmt, cbon, cboff, cbtrans, dtstart, dtend, ddstart, ddend].some((v) => v !== NIL)) throw signal('user-error', ['The ascii back end writes a whole list: list and item parameters cannot be combined with it']);
    if (!parsed) return '';
    const out = normalizeString(exportToAscii(parseOrg(listAsText(listValue)), null, 72, { charset: 'ascii', bodyOnly: true }));
    return nonBlank(out) ? out.slice(0, -1) : '';
  }
  const objects = (/** @type {string} */ t) => (B ? (raw ? B.plain(t) : B.objects(t)) : t);
  /** `org-list--generic-eval`. @param {LObj} value @param {LObj[]} args @returns {string | null} */
  const evaluate = (value, args) => {
    if (value === NIL) return null;
    if (isStr(value)) return text(value);
    if (isFunction(value)) {
      const result = funcall(value, args);
      return result === NIL ? null : text(result);
    }
    throw signal('error', [`Wrong value: ${print(value, false)}`]);
  };
  if (!parsed) return '';

  /** @param {PlainList} pl @param {number} depth @returns {string} */
  const exportList = (/** @type {PlainList} */ pl, /** @type {number} */ depth, /** @type {number} */ orderedAbove) => {
    const orderedLevel = orderedAbove + (pl.type === 'ordered' ? 1 : 0);
    const type = intern(pl.type);
    const depthArg = depth;
    let start = null;
    let end = null;
    if (!splice) {
      start = evaluate(pl.type === 'ordered' ? ostart : pl.type === 'unordered' ? ustart : dstart, [depthArg]);
      end = evaluate(pl.type === 'ordered' ? oend : pl.type === 'unordered' ? uend : dend, [depthArg]);
    }
    let body = '';
    pl.items.forEach((it, index) => {
      const next = index < pl.items.length - 1;
      body += normalizeString(exportItem(pl, it, depth, next, type, orderedLevel));
    });
    const contents = normalizeString(body);
    const out = (start !== null ? start + '\n' : '') + (start !== null || end !== null || splice || !name || !B ? contents : B.list(pl.type, contents)) + (end ?? '');
    return normalizeString(out) + (end !== null ? '\n'.repeat(trailingNewlines(end)) : '');
  };

  /** @param {PlainList} pl @param {Item} it @param {number} depth @param {boolean} next @param {Sym} type @param {number} orderedLevel @returns {string} */
  function exportItem(pl, it, depth, next, type, orderedLevel) {
    const separator = next ? evaluate(isep, [type, depth]) : null;
    let closing = evaluate(iend, [type, depth]);
    if (closing === null || closing === '') closing = '\n';
    else if (separator !== null && !closing.endsWith('\n')) closing += '\n';
    // the contents of the item: its paragraphs and lists, each ended by a newline
    let contents = '';
    it.children.forEach((child, position) => {
      if (child.kind === 'para') contents += normalizeString(child.raw ? child.text : B ? B.paragraph(child, it, position, objects) : objects(child.text)) + '\n'.repeat(child.blank);
      else contents += exportList(child.list, depth + 1, orderedLevel) + '\n'.repeat(child.blank);
    });
    contents = normalizeString(contents);
    const postBlank = Math.max(trailingNewlines(separator ?? closing) - 1, 0);
    const counterText = it.counter !== null && icount !== NIL ? evaluate(icount, [type, depth, it.counter]) : evaluate(istart, [type, depth]);
    let body;
    if (istart !== NIL || iend !== NIL || icount !== NIL || ifmt !== NIL || cbon !== NIL || cboff !== NIL || cbtrans !== NIL || !name || (pl.type === 'descriptive' && (dtstart !== NIL || dtend !== NIL || ddstart !== NIL || ddend !== NIL))) {
      const box = it.checkbox === 'on' ? cbon : it.checkbox === 'off' ? cboff : it.checkbox === 'trans' ? cbtrans : NIL;
      const stripped = contents.length === 0 ? '' : contents.slice(0, -1);
      const formatted = ifmt !== NIL ? evaluate(ifmt, [type, stripped]) : stripped;
      body = text(box) + (it.tag !== null ? text(dtstart) + objects(it.tag) + text(dtend) : '') + (it.tag !== null ? text(ddstart) : '') + (formatted ?? '') + (it.tag !== null ? text(ddend) : '');
    } else if (B) body = B.item(pl, it, contents, orderedLevel, it.tag === null ? null : objects(it.tag));
    else body = '';
    body = body === '' ? '' : normalizeString(body).slice(0, -1);
    return (counterText ?? '') + body + closing + (separator ?? '') + '\n'.repeat(postBlank);
  }

  const output = exportList(parsed, 1, 0);
  return nonBlank(output) ? output.slice(0, -1) : '';
}

/** A JavaScript function as a Lisp function. @param {string} name @param {number} min @param {number} max @param {(args: LObj[]) => LObj} fn */
function builtin(name, min, max, fn) {
  return new Subr(name, fn, min, max);
}

/** `org-list-to-org`: the defaults it gives `org-list-to-generic`. @param {LObj} listValue @param {LObj} params */
export function listToOrg(listValue, params) {
  const makeItem = builtin('org-list-to-org-item', 2, 3, ([type, , c]) => (type instanceof Sym && type.name === 'ordered' ? '1. ' : '- ') + (c !== undefined && c !== NIL ? `[@${String(c)}] ` : ''));
  const defaults = plistOf([
    [intern(':istart'), makeItem], [intern(':icount'), makeItem],
    [intern(':ifmt'), builtin('org-list-to-org-ifmt', 2, 2, ([, contents]) => text(contents).replace(/\n/g, '\n  '))],
    [intern(':dtend'), ' :: '], [intern(':cbon'), '[X] '], [intern(':cboff'), '[ ] '], [intern(':cbtrans'), '[-] '],
  ]);
  return listToGeneric(listValue, plistOf(combine([defaults, params])));
}

/**
 * `org-list-to-subtree`.
 * @param {LObj} listValue @param {LObj} startLevel @param {LObj} params @param {boolean} blank  whether a blank line comes before a new entry
 * @param {boolean} oddLevelsOnly
 */
export function listToSubtree(listValue, startLevel, params, blank, oddLevelsOnly) {
  const level = startLevel === NIL ? 1 : Number(startLevel);
  const makeStars = builtin('org-list-to-subtree-stars', 2, 3, ([, depth]) => {
    const l = level + (Number(depth) - 1);
    return '*'.repeat(oddLevelsOnly ? 2 * l - 1 : l) + ' ';
  });
  const defaults = plistOf([
    [intern(':splice'), intern('t')], [intern(':istart'), makeStars], [intern(':icount'), makeStars],
    [intern(':dtstart'), ' '], [intern(':dtend'), ' '], [intern(':isep'), blank ? '\n\n' : '\n'],
    [intern(':cbon'), 'DONE '], [intern(':cboff'), 'TODO '], [intern(':cbtrans'), 'TODO '],
  ]);
  return listToGeneric(listValue, plistOf(combine([defaults, params])));
}

export { list, trim };
