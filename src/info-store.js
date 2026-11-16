// @ts-check
// The files of Info manuals as the app keeps them: reading a file (also compressed), grouping the files someone picked into manuals
// (a split manual is a main file and its numbered parts), finding out which parts are missing, the directory entries a manual
// brings, and the `dir` text the app composes from the manuals on the device.
import { findFileName, Manual } from './info-manual.js';
import { extractMenuNodeName, menuStart, segmentsOf } from './info-parse.js';

/** Unpacks gzip data. @param {Uint8Array} bytes @returns {Promise<Uint8Array>} */
export async function gunzip(bytes) {
  const stream = new Blob([/** @type {BlobPart} */ (bytes)]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Whether data starts with the gzip signature. @param {Uint8Array} bytes */
export const isGzip = (bytes) => bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;

/**
 * The text of an Info file from its bytes: unpacked when it is gzip data, then decoded as UTF-8 unless the file says otherwise in its
 * Local Variables block (`coding: iso-8859-1`) or is not valid UTF-8 (read as Latin-1 then, as Emacs's `undecided` does).
 * @param {Uint8Array} bytes
 * @returns {Promise<{ text: string, encoding: string }>}
 */
export async function readInfoBytes(bytes) {
  const raw = isGzip(bytes) ? await gunzip(bytes) : bytes;
  const tail = new TextDecoder('latin1').decode(raw.subarray(Math.max(0, raw.length - 3000)));
  const declared = /^coding:[ \t]*([A-Za-z0-9_.-]+)/im.exec(tail.slice(Math.max(0, tail.lastIndexOf('Local Variables:'))));
  /** @type {string} */
  let encoding = declared && tail.includes('Local Variables:') ? declared[1].toLowerCase() : 'utf-8';
  if (encoding === 'utf-8-unix' || encoding === 'utf8') encoding = 'utf-8';
  if (encoding === 'latin-1' || encoding === 'iso-latin-1') encoding = 'iso-8859-1';
  try {
    return { text: new TextDecoder(encoding, { fatal: encoding === 'utf-8' }).decode(raw), encoding };
  } catch (err) {
    if (encoding !== 'utf-8') throw err;
    return { text: new TextDecoder('iso-8859-1').decode(raw), encoding: 'iso-8859-1' };
  }
}

/**
 * What a file name says: the manual it belongs to (`org` for `org.info`, `org.info-2.gz`), its part number when it is a part of a split
 * manual, and whether it is compressed.
 * @param {string} fileName
 * @returns {{ base: string, part: number | null, compressed: boolean }}
 */
export function classifyName(fileName) {
  const compressed = /\.gz$/i.test(fileName);
  const plain = fileName.replace(/\.gz$/i, '');
  const part = /^(.*)\.info-([0-9]+)$/i.exec(plain);
  if (part) return { base: part[1], part: Number(part[2]), compressed };
  const main = /^(.*)\.info$/i.exec(plain);
  return { base: main ? main[1] : plain, part: null, compressed };
}

/** Image files an Info manual can name, with the type a page shows them as. */
const IMAGE_TYPES = /** @type {Record<string, string>} */ ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif' });

/** The media type of an image file name, or null when it is not one a page can show. @param {string} fileName @returns {string | null} */
export function imageType(fileName) {
  const m = /\.([a-z0-9]+)$/i.exec(fileName);
  return m ? IMAGE_TYPES[m[1].toLowerCase()] || null : null;
}

/** Whether the text looks like an Info file or a part of one: a node separator, a header line or a tag table. @param {string} text */
export function looksLikeInfo(text) {
  return segmentsOf(text).some((s) => /^File:/i.test(s.header)) || /\x1f\nIndirect:/.test(text) || /\x1f\nTag Table:/i.test(text);
}

/** The parts a main file names in its "Indirect:" table, or null for a file that is not split. @param {string} text */
export function namedParts(text) {
  const at = text.indexOf('\n\x1f\nIndirect:');
  if (at === -1) return null;
  const start = at + '\n\x1f\nIndirect:'.length;
  const stop = text.indexOf('\n\x1f', start);
  return [...text.slice(start, stop === -1 ? text.length : stop).matchAll(/^(.*): [0-9]+$/gm)].map((m) => m[1]);
}

/**
 * @typedef {object} PickedFile a file someone chose
 * @property {string} name
 * @property {string} text its text (unpacked)
 * @property {string} encoding
 * @property {number} size its size in bytes as chosen (packed when it was)
 */
/**
 * @typedef {object} ManualGroup the files of one manual among those picked
 * @property {string} base the manual's name, as `(base)node` names it
 * @property {PickedFile[]} files
 * @property {string | null} main the name of the main file, when it was picked
 * @property {string[]} missing the parts that were not picked (or the main file, as its name, when only parts were)
 * @property {'ready' | 'incomplete' | 'invalid'} status
 * @property {string} note what to tell about it
 */

/**
 * Groups the picked files by the manual they belong to and says for each whether it is whole: a main file names its parts, and every one
 * must be there; parts without their main file cannot say, and wait for it.
 * @param {PickedFile[]} picked
 * @returns {ManualGroup[]}
 */
export function groupFiles(picked) {
  /** @type {Map<string, PickedFile[]>} */
  const byBase = new Map();
  for (const file of picked) {
    const { base } = classifyName(file.name);
    byBase.set(base, [...(byBase.get(base) || []), file]);
  }
  /** @type {ManualGroup[]} */
  const groups = [];
  for (const [base, files] of byBase) {
    const mainFile = files.find((f) => classifyName(f.name).part === null) || null;
    const ordered = [...files].sort((a, b) => (classifyName(a.name).part ?? -1) - (classifyName(b.name).part ?? -1));
    if (!mainFile) {
      const numbers = files.map((f) => classifyName(f.name).part).filter((n) => n !== null);
      groups.push({ base, files: ordered, main: null, missing: [base + '.info'], status: 'incomplete', note: `Part ${numbers.join(', ')} of a split manual. Add ${base}.info and the other parts too.` });
      continue;
    }
    if (!looksLikeInfo(mainFile.text)) {
      groups.push({ base, files: ordered, main: mainFile.name, missing: [], status: 'invalid', note: 'Not an Info file.' });
      continue;
    }
    const wanted = namedParts(mainFile.text);
    if (!wanted) {
      groups.push({ base, files: [mainFile], main: mainFile.name, missing: [], status: 'ready', note: '' });
      continue;
    }
    const names = files.map((f) => f.name);
    const missing = wanted.filter((w) => findFileName(names, w) === null);
    groups.push({
      base,
      files: ordered,
      main: mainFile.name,
      missing,
      status: missing.length === 0 ? 'ready' : 'incomplete',
      note: missing.length === 0 ? '' : `Missing ${missing.length === 1 ? 'part' : 'parts'}: ${missing.join(', ')}.`,
    });
  }
  return groups;
}

/**
 * @typedef {object} ManualRecord what is stored on the device for one manual
 * @property {string} name the manual's name, as `(name)node` names it
 * @property {string} main the name of its main file
 * @property {Record<string, string>} files the text of each file by name
 * @property {string} encoding
 * @property {number} size the size of the files as chosen, in bytes
 * @property {boolean} compressed
 * @property {number} added when it was added, in milliseconds
 * @property {string} title what the manual calls itself in the directory
 * @property {DirEntry[]} entries the directory entries it brings
 */

/** @typedef {{ section: string, text: string }} DirEntry a menu entry for the directory: the entry's lines, and the section it is listed in */

/** The title a manual gives itself: the name of its first directory entry, else its file name. @param {string} base @param {DirEntry[]} entries */
function titleOf(base, entries) {
  const m = entries.length ? /^\* +([^:]*):/.exec(entries[0].text) : null;
  return m ? m[1].trim() : base;
}

/**
 * The directory entries a manual's main file brings (what install-info reads): each INFO-DIR-SECTION names the section of the
 * START-INFO-DIR-ENTRY blocks that follow it.
 * @param {string} text
 * @returns {DirEntry[]}
 */
export function dirEntriesOf(text) {
  const head = text.indexOf('\x1f') === -1 ? text : text.slice(0, text.indexOf('\x1f'));
  /** @type {DirEntry[]} */
  const entries = [];
  let section = 'Other';
  let inside = false;
  /** @type {string[] | null} */
  let current = null;
  const flush = () => {
    if (current) entries.push({ section, text: current.join('\n') });
    current = null;
  };
  for (const line of head.split('\n')) {
    const s = /^INFO-DIR-SECTION[ \t]+(.*?)[ \t]*$/.exec(line);
    if (s && !inside) {
      section = s[1];
      continue;
    }
    if (/^START-INFO-DIR-ENTRY/.test(line)) {
      inside = true;
      continue;
    }
    if (/^END-INFO-DIR-ENTRY/.test(line)) {
      flush();
      inside = false;
      continue;
    }
    if (!inside) continue;
    if (line.startsWith('* ')) {
      flush();
      current = [line];
    } else if (current && /^[ \t]/.test(line)) current.push(line);
  }
  return entries;
}

/**
 * The record to store for a ready group.
 * @param {ManualGroup} group
 * @param {number} now
 * @returns {ManualRecord}
 */
export function recordOf(group, now) {
  const main = /** @type {PickedFile} */ (group.files.find((f) => f.name === group.main));
  /** @type {Record<string, string>} */
  const files = {};
  for (const f of group.files) files[f.name] = f.text;
  const entries = dirEntriesOf(main.text);
  return {
    name: group.base,
    main: main.name,
    files,
    encoding: main.encoding,
    size: group.files.reduce((n, f) => n + f.size, 0),
    compressed: group.files.some((f) => classifyName(f.name).compressed),
    added: now,
    title: titleOf(group.base, entries),
    entries,
  };
}

/** A Manual for a stored record. @param {ManualRecord} record */
export function manualOf(record) {
  return new Manual(record.main, new Map(Object.entries(record.files)), record.encoding);
}

// ---------------------------------------------------------------------------------------------------------------------
// The directory

const DIR_HEAD = `This is the file .../info/dir, which contains the
topmost node of the Info hierarchy, called (dir)Top.
The first time you invoke Info you start off looking at this node.

\x1f
File: dir,\tNode: Top\tThis is the top of the INFO tree

  This (the Directory node) gives a menu of major topics.
  Typing "q" exits, "H" lists all Info commands, "d" returns here,
  "h" gives a primer for first-timers,
  "mEmacs<Return>" visits the Emacs manual, etc.

  In Emacs, you can click mouse button 2 on a menu item or cross reference
  to select it.

* Menu:
`;

/** How Info-dir-remove-duplicates joins headings that name the same group (Info-streamline-headings). */
/** @type {[RegExp, string][]} */
const STREAMLINE = [
  [/Emacs/, 'Emacs'],
  [/Software development|Programming/, 'Software development'],
  [/Compression|Data Compression/, 'Compression'],
  [/Libraries/, 'Libraries'],
  [/Network applications|World Wide Web|Net Utilities/, 'Network applications'],
];

/** What makes two entries the same one for Info-dir-remove-duplicates: the start of the first line, in lower case. @param {DirEntry} entry */
const dirKey = (entry) => {
  const m = /^\* ([^:\n]+:[^.\n]+.)/.exec(entry.text.split('\n')[0]);
  return (m ? m[1] : entry.text).toLowerCase();
};

/**
 * The text of the `dir` file for the manuals on the device: their directory entries by section (sections and entries in alphabetical
 * order, as install-info keeps them), then headings that name one group (Programming and Software development) joined, and an
 * entry listed twice kept once, as Info-dir-remove-duplicates does when Emacs reads the directory.
 * @param {ManualRecord[]} records
 */
export function composeDir(records) {
  /** @type {Map<string, DirEntry[]>} */
  const sections = new Map();
  for (const record of records) {
    const entries = record.entries.length ? record.entries : [{ section: 'Other', text: `* ${record.name}: (${record.name}).` }];
    for (const entry of entries) {
      let heading = entry.section;
      for (const [re, name] of STREAMLINE) if (re.test(heading)) heading = name;
      const list = sections.get(heading) || [];
      if (!list.some((e) => dirKey(e) === dirKey(entry))) list.push(entry);
      sections.set(heading, list);
    }
  }
  const names = [...sections.keys()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  let out = DIR_HEAD;
  for (const heading of names) {
    out += '\n' + heading + '\n';
    const list = /** @type {DirEntry[]} */ (sections.get(heading)).slice().sort((a, b) => a.text.toLowerCase().localeCompare(b.text.toLowerCase()));
    for (const entry of list) out += entry.text + '\n';
  }
  return out;
}

/** A Manual for the directory of the manuals on the device: the `dir` file with its Top node. @param {ManualRecord[]} records */
export function dirManual(records) {
  return new Manual('dir', new Map([['dir', composeDir(records)]]));
}

/**
 * The sections of the directory node, in order: the heading, and for each entry its name, the manual and node it leads to and its
 * description.
 * @param {string} text the text of the directory's Top node
 * @returns {{ heading: string | null, entries: { name: string, file: string, node: string, description: string }[] }[]}
 */
export function dirSections(text) {
  const at = menuStart(text);
  /** @type {{ heading: string | null, entries: { name: string, file: string, node: string, description: string }[] }[]} */
  const sections = [];
  if (at === -1) return sections;
  const lines = text.slice(at).split('\n');
  let offset = at;
  /** @type {{ heading: string | null, entries: { name: string, file: string, node: string, description: string }[] }} */
  let current = { heading: null, entries: [] };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineStart = offset;
    offset += line.length + 1;
    if (line.startsWith('* ')) {
      const got = extractMenuNodeName(text, lineStart + 2);
      if (!got) continue;
      const target = /^\(([^)]*)\)(.*)$/.exec(got.target);
      const lineEnd = text.indexOf('\n', got.end);
      const first = text.slice(got.end, lineEnd === -1 ? text.length : lineEnd).replace(/^[.,]/, '').trim();
      const more = [];
      for (let j = i + 1; j < lines.length && /^[ \t]+\S/.test(lines[j]); j++) more.push(lines[j].trim());
      current.entries.push({ name: got.label.trim(), file: target ? target[1] : '', node: target ? target[2] || 'Top' : got.target, description: [first, ...more].filter(Boolean).join(' ') });
    } else if (/^[^ \t\n*]/.test(line)) {
      if (current.entries.length || current.heading !== null) sections.push(current);
      current = { heading: line.trim(), entries: [] };
    }
  }
  if (current.entries.length || current.heading !== null) sections.push(current);
  return sections;
}
