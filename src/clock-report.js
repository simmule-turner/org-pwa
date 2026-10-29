// @ts-check
/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {import('./types.js').Doc} Doc */
/** @typedef {import('./lisp-read.js').Lisp} Lisp */
/**
 * The clock report: `#+BEGIN: clocktable` with every parameter Org 9.6 reads, held to Emacs 29.3 by
 * test/oracle-todo-log-clock.test.js. The parameters are read as Org reads a dynamic block's: `:scope :block :maxlevel :tags :match
 * :step :stepskip0 :fileskip0 :hidefiles :narrow :formula :link :compact :properties :inherit-props :tstart :tend :wstart :mstart
 * :emphasize :level :indent :timestamp :tcolumns :filetitle :lang :header :sort`.
 *
 * Not read: `:formatter` (a function of your own), `:scope` given as a function, and `:content`.
 */

import { readLisp, isNil, listItems } from './lisp-read.js';
import { ClockReportError, clockSpecialRange, dateOfAbsoluteDay, inactiveStamp, matcherTime } from './clock-range.js';
import { layoutTable, widthWithLinks } from './org-table-layout.js';
import { searchDocumentsByMatchQuery } from './search.js';
import { recalculateTable } from './table-formula.js';

export { ClockReportError };

/** @typedef {{ name: string, doc: Doc, path?: string | null }} ReportFile  A document: its file name (`ct.org`) and, for links, its full path. */
/** @typedef {{ level: number, headline: string, tags: string[] | null, ts: string | null, time: number, props: [string, string][] | null }} ReportEntry */

const CLOCK_RE = /^[ \t]*CLOCK:[ \t]*(?:(\[.*?\])-+(\[.*?\])|=>[ \t]+([0-9]+):([0-9]+))/;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "H:MM"; a day or more reads "1d 2:05" (`org-duration-from-minutes` with Org's default format). @param {number} minutes */
export function formatClocktableDuration(minutes) {
  const days = Math.floor(minutes / 1440);
  const rest = minutes % 1440;
  const clock = `${Math.floor(rest / 60)}:${String(rest % 60).padStart(2, '0')}`;
  return days ? `${days}d ${clock}` : clock;
}

/** "2026-08-07 Fri 12:11": the moment of a clock report's caption. @param {Date} date */
export function formatCaptionTimestamp(date) {
  return inactiveStamp(date, true).slice(1, -1);
}

/** @param {string} raw @returns {Date | null} */
function clockStampToDate(raw) {
  const m = /(\d{4})-(\d{2})-(\d{2})(?:[^0-9]+(\d{2}):(\d{2}))?/.exec(raw);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0)) : null;
}

// ------------------------------------------------------------------ parameters

/** @param {string} name */
const sym = (name) => /** @type {Lisp} */ ({ k: 'sym', v: name });

/** `org-clocktable-defaults`. @type {Record<string, Lisp>} */
const DEFAULTS = {
  maxlevel: { k: 'num', v: 2 },
  lang: { k: 'str', v: 'en' },
  scope: sym('file'),
  wstart: { k: 'num', v: 1 },
  mstart: { k: 'num', v: 1 },
  narrow: sym('40!'),
  indent: sym('t'),
};

/** The parameters after the colon of a `#+BEGIN: clocktable` line, over Org's defaults; a later one of the same name wins.
 * @param {string} text @returns {Map<string, Lisp>} */
export function readClocktableParams(text) {
  /** @type {Map<string, Lisp>} */
  const params = new Map(Object.entries(DEFAULTS));
  const forms = readLisp(`(${text})`);
  const items = forms.length ? listItems(forms[0]) : [];
  if (!items) throw new ClockReportError('Invalid clocktable parameters');
  if (items.length % 2) throw new ClockReportError('Odd number of clocktable parameters', false);
  for (let i = 0; i < items.length; i += 2) {
    const key = items[i];
    if (key.k !== 'sym' || !key.v.startsWith(':')) throw new ClockReportError(`Invalid clocktable parameter ${key.k === 'sym' ? key.v : ''}`);
    params.set(key.v.slice(1), items[i + 1] ?? sym('nil'));
  }
  return params;
}

/** @param {Lisp | undefined} v */
const truthy = (v) => v !== undefined && !isNil(v);
/** @param {Lisp | undefined} v @returns {number | null} */
const numberOf = (v) => (v && v.k === 'num' ? v.v : null);
/** @param {Lisp | undefined} v @returns {string | null} */
const symbolOf = (v) => (v && v.k === 'sym' ? v.v : null);
/** @param {Lisp | undefined} v @returns {string | null} */
const textOf = (v) => (v && v.k === 'str' ? v.v : null);

// ------------------------------------------------------------------ the clock sum

/** The minutes of one heading's own clock lines inside [tstart, tend), as `org-clock-sum` counts them.
 * @param {Heading} heading @param {number | null} tstart @param {number | null} tend */
function ownMinutes(heading, tstart, tend) {
  let total = 0;
  for (const lines of [heading.preLogLines || [], heading.logbookLines || [], heading.bodyLines || []]) {
    for (const line of lines) {
      const m = CLOCK_RE.exec(line);
      if (!m) continue;
      if (m[1]) {
        const from = clockStampToDate(m[1]);
        const to = clockStampToDate(m[2]);
        if (!from || !to) continue;
        const dt = (tend !== null ? Math.min(to.getTime(), tend) : to.getTime()) - (tstart !== null ? Math.max(from.getTime(), tstart) : from.getTime());
        if (dt > 0) total += Math.floor(dt / 60000);
      } else total += Number(m[4]) + 60 * Number(m[3]);
    }
  }
  return total;
}

/**
 * The time of every heading in `roots` (itself and everything below it that passes `filter`), and the total.
 * @param {Heading[]} roots @param {number | null} tstart @param {number | null} tend @param {((h: Heading) => boolean) | null} filter
 * @returns {{ time: Map<Heading, number>, total: number }}
 */
function clockSum(roots, tstart, tend, filter) {
  /** @type {Map<Heading, number>} */
  const time = new Map();
  /** @param {Heading} heading @returns {number} */
  const sum = (heading) => {
    let t = !filter || filter(heading) ? ownMinutes(heading, tstart, tend) : 0;
    for (const child of heading.children || []) t += sum(child);
    time.set(heading, t);
    return t;
  };
  let total = 0;
  for (const root of roots) total += sum(root);
  return { time, total };
}

// ------------------------------------------------------------------ rows

/** @param {string} s @param {number} maxlength  `org-shorten-string` */
function shortenString(s, maxlength) {
  if (s.length <= maxlength) return s;
  const n = Math.max(maxlength - 4, 1);
  const m = new RegExp(`^(.{1,${n}}[^ ])( |$)`).exec(s);
  return m ? m[1] + '...' : s.slice(0, Math.max(maxlength - 3, 0)) + '...';
}

/** `org-link-escape`. @param {string} link */
const escapeLink = (link) => link.replace(/(\\*)([[\]]|$)/g, (_, slashes, bracket) => slashes + slashes + (bracket ? '\\' : '') + bracket);

/** `org-link-make-string`. @param {string} link @param {string} description */
function makeLink(link, description) {
  const desc = description.trim() === '' ? '' : description.trim().replace(/\]$/, ']​').replace(/\]\]/g, ']​]');
  return `[[${escapeLink(link)}]${desc ? `[${desc}]` : ''}]`;
}

const BRACKET_LINK_RE = /\[\[((?:[^\][\\]|\\(?:\\\\)*[\][]|\\+[^\][])+)\](?:\[([\s\S]+?)\])?\]/g;
const COOKIE_RE = /\[[0-9]*(?:%|\/[0-9]*)\]/g;

/** The headline of a row as a link: the file and heading it stands for, shown as the heading's text without statistics cookies.
 * @param {string} headline @param {string | null | undefined} path */
function headlineLink(headline, path) {
  const search = '*' + headline.replace(COOKIE_RE, ' ').replace(/[ \t]+/g, ' ').trim();
  const shown = headline.replace(COOKIE_RE, '').replace(BRACKET_LINK_RE, (_, target, description) => description ?? target).trim();
  return makeLink(path ? `file:${path}::${search}` : search, shown);
}

/** @param {number} level `org-clocktable-indent-string` */
const indentString = (level) => (level === 1 ? '' : '\\_' + ' '.repeat(2 * (level - 1)));

/** `%.1f`, rounding an exact tie to the even digit as C does. @param {number} value */
function oneDecimal(value) {
  const scaled = value * 10;
  const floor = Math.floor(scaled);
  const rounded = scaled - floor === 0.5 ? (floor % 2 === 0 ? floor : floor + 1) : Math.round(scaled);
  return (rounded / 10).toFixed(1);
}

/** @param {Heading} heading */
function headlineOf(heading) {
  return heading.title.replace(/^COMMENT[ \t]+/, '').trim();
}

/** The first timestamp in an entry after its planning line: active (`<..>`) or inactive (`[..]`). @param {Heading} heading @param {boolean} active */
function firstTimestamp(heading, active) {
  const re = active ? /<\d{4}-\d\d-\d\d[^>\n]*>/ : /\[\d{4}-\d\d-\d\d[^\]\n]*\]/;
  for (const line of [...(heading.preLogLines || []), ...(heading.bodyLines || [])].filter((l) => !/^\s*(CLOCK:|SCHEDULED:|DEADLINE:|CLOSED:)/.test(l))) {
    const m = re.exec(line);
    if (m) return m[0];
  }
  return null;
}

/** The tags Org lists for an entry: `#+FILETAGS:` first, then each level from the outermost down, a repeated tag once.
 * @param {Heading} heading @param {Heading[]} ancestors @param {Doc} doc */
function clockTags(heading, ancestors, doc) {
  const fileTags = (doc.keywords || []).filter((k) => k.key.toUpperCase() === 'FILETAGS').flatMap((k) => k.value.split(/[:\s]+/).filter(Boolean));
  return [...new Set([...fileTags, ...[...ancestors, heading].flatMap((h) => h.tags || [])])];
}

/** Org's `org-entry-get` for the properties a clock report asks of an entry.
 * @param {Heading} heading @param {Heading[]} ancestors @param {string} name @param {boolean} inherit @param {ReportFile} file */
function entryProperty(heading, ancestors, name, inherit, file) {
  const upper = name.toUpperCase();
  const own = (/** @type {Heading} */ h) => {
    const key = Object.keys(h.properties || {}).find((k) => k.toUpperCase() === upper);
    return key === undefined ? null : h.properties[key];
  };
  const category = () => {
    for (const h of [heading, ...[...ancestors].reverse()]) {
      const v = own(h);
      if (v !== null) return v.trim();
    }
    const kw = (file.doc.keywords || []).find((k) => k.key.toUpperCase() === 'CATEGORY');
    return kw && kw.value.trim() ? kw.value.trim() : file.name.replace(/\.org$/i, '');
  };
  switch (upper) {
    case 'CATEGORY': return category();
    case 'ITEM': return heading.title.trim();
    case 'TODO': return heading.todo || null;
    case 'PRIORITY': return heading.priority || 'B';
    case 'TAGS': return heading.tags && heading.tags.length ? `:${heading.tags.join(':')}:` : null;
    case 'ALLTAGS': {
      const all = clockTags(heading, ancestors, file.doc);
      return all.length ? `:${all.join(':')}:` : null;
    }
    case 'FILE': return file.path || file.name;
    case 'SCHEDULED': return heading.planning?.scheduled || null;
    case 'DEADLINE': return heading.planning?.deadline || null;
    case 'CLOSED': return heading.planning?.closed || null;
    case 'TIMESTAMP': return firstTimestamp(heading, true);
    case 'TIMESTAMP_IA': return firstTimestamp(heading, false);
    default: {
      const v = own(heading);
      if (v !== null || !inherit) return v;
      for (const a of [...ancestors].reverse()) {
        const av = own(a);
        if (av !== null) return av;
      }
      return null;
    }
  }
}

// ------------------------------------------------------------------ the table of a file

/**
 * `org-clock-get-table-data`: the rows of one file.
 * @param {ReportFile} file @param {Heading[]} roots the headings in scope
 * @param {Map<string, Lisp>} p @param {number | null} tstart @param {number | null} tend @param {Date} now
 * @returns {{ name: string, title: string, fileTime: number, entries: ReportEntry[] }}
 */
function tableData(file, roots, p, tstart, tend, now) {
  const maxlevel = numberOf(p.get('maxlevel')) ?? 3;
  const match = textOf(p.get('match'));
  /** @type {Set<Heading> | null} */
  let matched = null;
  if (match !== null && (match === '' || /(^|[^A-Za-z0-9_])LEVEL\s*(<=|>=|<>|!=|[=<>])/.test(match))) throw new ClockReportError(`Cannot match entries with "${match}"`); // Org's matcher fails on these
  if (match !== null) {
    const kw = new Set((file.doc.keywords || []).filter((k) => /^(TODO|SEQ_TODO|TYP_TODO)$/i.test(k.key)).flatMap((k) => (k.value.split('|')[1] || '').split(/\s+/).map((w) => w.replace(/\(.*$/, '')).filter(Boolean)));
    matched = new Set(searchDocumentsByMatchQuery([{ documentId: file.name, doc: file.doc }], match, { doneKeywords: kw.size ? kw : ['DONE'], now }).map((r) => /** @type {Heading} */ (r.heading)));
  }
  const { time, total } = clockSum(roots, tstart, tend, matched ? (h) => /** @type {Set<Heading>} */ (matched).has(h) : null);
  const link = truthy(p.get('link'));
  const wantTags = truthy(p.get('tags'));
  const wantTimestamp = truthy(p.get('timestamp'));
  const properties = (listItems(p.get('properties')) || []).flatMap((x) => (x.k === 'str' ? [x.v] : x.k === 'sym' ? [x.v] : []));
  const inherit = truthy(p.get('inherit-props'));
  /** @type {ReportEntry[]} */
  const entries = [];
  /** @param {Heading} heading @param {Heading[]} ancestors */
  const walk = (heading, ancestors) => {
    const t = time.get(heading) || 0;
    if (t > 0 && heading.level <= maxlevel) {
      const headline = headlineOf(heading);
      entries.push({
        level: heading.level,
        headline: link ? headlineLink(headline, file.path) : headline,
        tags: wantTags ? clockTags(heading, ancestors, file.doc) : null,
        ts: wantTimestamp ? (['SCHEDULED', 'DEADLINE', 'TIMESTAMP', 'TIMESTAMP_IA'].map((n) => entryProperty(heading, ancestors, n, false, file)).find((v) => v !== null) ?? null) : null,
        time: t,
        props: properties.length ? properties.flatMap((n) => { const v = entryProperty(heading, ancestors, n, inherit, file); return v === null ? [] : [/** @type {[string, string]} */ ([n, v])]; }) : null,
      });
    }
    for (const child of heading.children || []) walk(child, [...ancestors, heading]);
  };
  const owner = (/** @type {Heading} */ root) => ancestorsOf(file.doc, root);
  for (const root of roots) walk(root, owner(root));
  const titleKeyword = (file.doc.keywords || []).find((k) => k.key.toUpperCase() === 'TITLE');
  return { name: file.name, title: truthy(p.get('filetitle')) && titleKeyword && titleKeyword.value.trim() ? titleKeyword.value.trim() : file.name, fileTime: total, entries };
}

/** The headings above `target`, outermost first. @param {Doc} doc @param {Heading} target @returns {Heading[]} */
function ancestorsOf(doc, target) {
  /** @param {Heading[]} nodes @param {Heading[]} path @returns {Heading[] | null} */
  const find = (nodes, path) => {
    for (const n of nodes) {
      if (n === target) return path;
      const hit = find(n.children || [], [...path, n]);
      if (hit) return hit;
    }
    return null;
  };
  return find(doc.children || [], []) || [];
}

// ------------------------------------------------------------------ writing the table

const TERMS = /** @type {Record<string, string[]>} */ ({
  en: ['File', 'L', 'Timestamp', 'Headline', 'Time', 'ALL', 'Total time', 'File time', 'Clock summary at'],
  es: ['Archivo', 'N', 'Fecha y hora', 'Tarea', 'Tiempo', 'TODO', 'Tiempo total', 'Tiempo archivo', 'Clock summary at'],
  fr: ['Fichier', 'N', 'Horodatage', 'En-tête', 'Durée', 'TOUT', 'Durée totale', 'Durée fichier', 'Horodatage sommaire à'],
  nl: ['Bestand', 'N', 'Tijdstip', 'Hoofding', 'Duur', 'ALLES', 'Totale duur', 'Bestandstijd', 'Clock summary at'],
  de: ['Datei', 'E', 'Zeitstempel', 'Kopfzeile', 'Dauer', 'GESAMT', 'Gesamtdauer', 'Dateizeit', 'Erstellt am'],
});
const TERM_INDEX = /** @type {Record<string, number>} */ ({ File: 0, L: 1, Timestamp: 2, Headline: 3, Time: 4, ALL: 5, 'Total time': 6, 'File time': 7, 'Clock summary at': 8 });

/**
 * @typedef {{
 *   files: ReportFile[], now: Date, origin: Heading | null,
 * }} ReportContext
 */

/** Aligns a table given as lines (`|a|b|`, `|-`), as `org-table-align` does, and applies a `<N>` width row. @param {string[]} lines @returns {string[]} */
function alignTable(lines) {
  /** @type {(string[] | null)[]} */
  const rows = lines.map((l) => (l.startsWith('|-') ? null : l.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())));
  const cookieAt = rows.findIndex((r) => r && r.some((c) => /^<\d+>$/.test(c)));
  const cookieRow = cookieAt >= 0 ? rows[cookieAt] : null;
  const body = rows.filter((_, i) => i !== cookieAt);
  const out = layoutTable(body, widthWithLinks);
  if (cookieAt < 0 || !cookieRow) return out;
  // the width row keeps its cookie in the cell and is padded like the other rows
  const widths = (out.find((l) => l.startsWith('|-')) || out[0]).slice(1, -1).split(/[+|]/).map((s) => (s.startsWith('-') ? s.length - 2 : widthWithLinks(s.trim())));
  const cells = widths.map((w, i) => (cookieRow[i] ?? '').padEnd(w, ' '));
  out.splice(cookieAt, 0, '| ' + cells.join(' | ') + ' |');
  return out;
}

/**
 * `org-clocktable-write-default`.
 * @param {ReportContext} ctx @param {Map<string, Lisp>} p
 * @param {{ name: string, title: string, fileTime: number, entries: ReportEntry[] }[]} tables @param {boolean} multifile
 * @param {string} rangeText
 * @returns {{ text: string, total: number }}
 */
function writeTable(ctx, p, tables, multifile, rangeText) {
  const lang = textOf(p.get('lang')) ?? symbolOf(p.get('lang')) ?? 'en';
  const terms = TERMS[Object.keys(TERMS).find((k) => k.toLowerCase() === lang.toLowerCase()) || ''] || null;
  const tr = (/** @type {string} */ s) => (terms ? terms[TERM_INDEX[s]] : s);
  const header = p.get('header');
  const maxlevel = numberOf(p.get('maxlevel')) ?? 3;
  const emph = truthy(p.get('emphasize'));
  const compact = truthy(p.get('compact'));
  const link = truthy(p.get('link'));
  let narrowValue = p.get('narrow');
  if (!truthy(narrowValue) && compact) narrowValue = sym('40!');
  /** @type {number | null} */ let narrow = null;
  let narrowCut = false;
  if (narrowValue && truthy(narrowValue)) {
    const asNumber = numberOf(narrowValue);
    const asSymbol = symbolOf(narrowValue);
    if (asNumber !== null) {
      narrow = asNumber;
      narrowCut = link; // a width in the table cannot be kept next to links, so the headline is cut instead
    } else if (asSymbol !== null && /^[0-9]+!$/.test(asSymbol)) {
      narrow = Number(asSymbol.slice(0, -1));
      narrowCut = true;
    } else throw new ClockReportError(`Invalid value ${asSymbol ?? '?'} of :narrow property in clock table`);
  }
  const levelColumn = !compact && truthy(p.get('level'));
  const wantTimestamp = truthy(p.get('timestamp'));
  const wantTags = truthy(p.get('tags'));
  const properties = (listItems(p.get('properties')) || []).flatMap((x) => (x.k === 'str' ? [x.v] : x.k === 'sym' ? [x.v] : []));
  const tcolumns = numberOf(p.get('tcolumns'));
  let timeColumns = 1;
  if (!(compact || maxlevel < 2)) {
    const levels = tables.filter((t) => t.fileTime !== 0).flatMap((t) => t.entries.map((e) => e.level));
    timeColumns = Math.min(maxlevel, tcolumns ?? 100, levels.length ? Math.max(...levels) : 1);
  }
  const indent = compact || truthy(p.get('indent'));
  const formula = p.get('formula');
  const percent = symbolOf(formula) === '%';
  const bareFormula = truthy(formula) && !percent && !(formula && formula.k === 'str'); // Org then leaves the table as it was written
  const totalTime = tables.reduce((s, t) => s + t.fileTime, 0);
  const sort = p.get('sort');

  /** @type {string[]} */
  const lines = [];
  const pipes = (/** @type {number} */ n) => '|'.repeat(Math.max(0, n));
  // the text before the table
  /** @type {string} */ let caption;
  const headerText = textOf(header);
  if (header !== undefined && truthy(header) && headerText !== null) caption = headerText;
  else if (header !== undefined && truthy(header)) caption = '';
  else caption = `#+CAPTION: ${tr('Clock summary at')} [${formatCaptionTimestamp(ctx.now)}]${rangeText ? `, for ${rangeText}.` : ''}\n`;
  if (narrow !== null && !narrowCut) {
    lines.push(`|${multifile ? '|' : ''}${levelColumn ? '|' : ''}${wantTimestamp ? '|' : ''}${wantTags ? '|' : ''}${pipes(properties.length)}<${narrow}>| |`);
  }
  lines.push(
    '|' +
      (multifile ? `${tr('File')}|` : '') +
      (levelColumn ? `${tr('L')}|` : '') +
      (wantTimestamp ? `${tr('Timestamp')}|` : '') +
      (wantTags ? 'Tags |' : '') +
      (properties.length ? properties.join('|') + '|' : '') +
      `${tr('Headline')}|` +
      `${tr('Time')}|` +
      pipes(timeColumns - 1) +
      (percent ? '%|' : '')
  );
  // the total
  lines.push(
    '|-',
    '|' +
      (multifile ? `| ${tr('ALL')} ` : '') +
      (levelColumn ? '|' : '') +
      (wantTimestamp ? '|' : '') +
      (wantTags ? '|' : '') +
      pipes(properties.length) +
      `*${tr('Total time')}*| ` +
      `*${formatClocktableDuration(totalTime)}*` +
      '|' +
      pipes(timeColumns - 1) +
      (!percent ? '' : totalTime === 0 ? '0.0|' : '100.0|')
  );
  if (totalTime > 0) {
    for (const table of tables) {
      if (!(table.fileTime > 0 || !truthy(p.get('fileskip0')))) continue;
      lines.push('|-');
      if (multifile) {
        const title = table.title;
        lines.push(
          `| ${title} ${levelColumn ? '| ' : ''} | ${wantTimestamp ? '| ' : ''}${wantTags ? '| ' : ''}${pipes(properties.length)}*${tr('File time')}* | *${formatClocktableDuration(table.fileTime)}*|${pipes(timeColumns - 1)}` +
            (percent ? ` ${totalTime === 0 ? '0.0' : oneDecimal(100 * (table.fileTime / totalTime))} |` : '')
        );
      }
      if (maxlevel > 0) {
        for (const entry of table.entries) {
          let headline = entry.headline;
          if (narrowCut && narrow !== null) {
            const whole = new RegExp(`^${BRACKET_LINK_RE.source}$`).exec(headline);
            headline = whole && whole[2] !== undefined ? `[[${whole[1]}][${shortenString(whole[2], narrow)}]]` : shortenString(headline, narrow);
          }
          const field = (/** @type {string} */ f) => (!emph ? `${f} |` : entry.level === 1 ? `*${f}* |` : entry.level === 2 ? `/${f}/ |` : `${f} |`);
          lines.push(
            '|' +
              (multifile ? '|' : '') +
              (levelColumn ? `${entry.level}|` : '') +
              (wantTimestamp ? `${entry.ts ?? ''}|` : '') +
              (wantTags ? `${(entry.tags || []).join(', ')}|` : '') +
              (properties.length ? properties.map((n) => (entry.props || []).find(([k]) => k === n)?.[1] ?? '').join('|') + '|' : '') +
              (indent ? indentString(entry.level) : '') +
              field(headline) +
              pipes(Math.min(timeColumns, entry.level) - 1) +
              field(formatClocktableDuration(entry.time)) +
              pipes(timeColumns - entry.level) +
              (percent ? `${oneDecimal(100 * (entry.time / totalTime))} |` : '')
          );
        }
      }
    }
  }
  let aligned = bareFormula ? lines : alignTable(lines);
  let tail = '';
  const formulaText = textOf(formula);
  if (formulaText !== null) {
    tail = `\n#+TBLFM: ${formulaText}`;
    aligned = recalculate(aligned, formulaText);
  }
  if (sort && truthy(sort)) aligned = sortTable(aligned, sort);
  return { text: caption + aligned.join('\n') + tail, total: totalTime };
}

/** Applies a `#+TBLFM:` to the lines of a table and aligns it again. @param {string[]} lines @param {string} formula */
function recalculate(lines, formula) {
  /** @type {import('./types.js').TableRow[]} */
  const rows = lines.map((l) => (l.startsWith('|-') ? { type: /** @type {const} */ ('rule') } : { type: /** @type {const} */ ('row'), cells: l.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()) }));
  let result;
  try {
    result = recalculateTable({ type: 'table', rows, tblfm: formula, lineIndex: 0, lineCount: rows.length });
  } catch {
    return lines;
  }
  if (!result) return lines;
  return alignTable(result.map((r) => (r.type === 'rule' ? '|-' : '|' + r.cells.join('|') + '|')));
}

/** `:sort (COLUMN . CHAR)`: the lines of the table from the third on, in the order of the CHAR (`a` text, `n` number, `t` time, capital for reverse).
 * @param {string[]} lines @param {Lisp} sort */
function sortTable(lines, sort) {
  const pair = sort.k === 'list' && sort.tail && sort.items.length === 1 ? { col: numberOf(sort.items[0]), how: numberOf(sort.tail) } : null;
  if (!pair || !pair.col || !pair.how) return lines;
  const column = pair.col;
  const how = String.fromCodePoint(pair.how);
  const cell = (/** @type {string} */ l) => (l.replace(/^\|\s*/, '').split(/\s*\|\s*/)[column - 1] ?? '').trim().replace(/\[\[(?:[^\][\\]|\\.)*\]\[([^\]]*)\]\]/g, '$1').replace(/\[\[((?:[^\][\\]|\\.)*)\]\]/g, '$1');
  const first = lines.map((l) => l.startsWith('|-')).lastIndexOf(true) + 1; // the rows below the last rule
  const keyed = lines.slice(first).map((l, i) => ({ l, i, c: cell(l) }));
  const lower = how.toLowerCase();
  const num = (/** @type {string} */ s) => { const m = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(s); return m ? Number(m[0]) : 0; }; // string-to-number
  const time = (/** @type {string} */ s) => { const m = /^(\d+):(\d\d)$/.exec(s); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; };
  keyed.sort((a, b) => {
    let r = 0;
    if (lower === 'a') r = a.c.toLowerCase() < b.c.toLowerCase() ? -1 : a.c.toLowerCase() > b.c.toLowerCase() ? 1 : 0;
    else if (lower === 'n') r = num(a.c) - num(b.c);
    else if (lower === 't') r = time(a.c) - time(b.c);
    if (how !== lower) r = -r;
    return r || a.i - b.i;
  });
  return [...lines.slice(0, first), ...keyed.map((k) => k.l)];
}

// ------------------------------------------------------------------ the dynamic block

/**
 * The range a block, `:tstart` and `:tend` stand for: moments in milliseconds, or null for no limit; and the text of the block's range.
 * @param {Map<string, Lisp>} p @param {Date} now
 * @returns {{ tstart: number | null, tend: number | null, rangeText: string, block: Lisp | undefined }}
 */
function readRange(p, now) {
  const block = p.get('block');
  if (block && truthy(block)) {
    const key = numberOf(block) ?? symbolOf(block) ?? textOf(block);
    if (key === null) throw new ClockReportError('Invalid :block');
    const r = clockSpecialRange(key, now, { wstart: numberOf(p.get('wstart')), mstart: numberOf(p.get('mstart')) });
    return { tstart: r.start ? r.start.getTime() : null, tend: r.end.getTime(), rangeText: r.text, block };
  }
  /** @param {Lisp | undefined} v */
  const limit = (v) => {
    if (!v || !truthy(v)) return null;
    if (v.k === 'num') return matcherTime(dateOfAbsoluteDay(v.v), now);
    if (v.k === 'str') return matcherTime(v.v, now);
    throw new ClockReportError('Wrong type argument: stringp');
  };
  return { tstart: limit(p.get('tstart')), tend: limit(p.get('tend')), rangeText: '', block: undefined };
}

/**
 * The files and headings a `:scope` reads, as `org-dblock-write:clocktable` picks them.
 * @param {ReportContext} ctx @param {Map<string, Lisp>} p
 * @returns {{ sources: { file: ReportFile, roots: Heading[] }[], multifile: boolean }}
 */
function readScope(ctx, p) {
  const scopeLisp = p.get('scope');
  const scope = !scopeLisp || isNil(scopeLisp) ? 'file' : symbolOf(scopeLisp);
  const hide = truthy(p.get('hidefiles'));
  const first = ctx.files[0];
  const items = scopeLisp ? listItems(scopeLisp) : null;
  if (scope === null && items && items.length) {
    const sources = items.map((it) => {
      const name = textOf(it) ?? symbolOf(it) ?? '';
      const file = ctx.files.find((f) => f.name === name || (f.path || '') === name || f.name === name.split('/').pop());
      if (!file) throw new ClockReportError(`No such file: ${name}`);
      return { file, roots: file.doc.children || [] };
    });
    return { sources, multifile: !hide };
  }
  if (scope === 'agenda' || scope === 'agenda-with-archives') return { sources: ctx.files.map((file) => ({ file, roots: file.doc.children || [] })), multifile: !hide };
  if (scope === 'file' || scope === 'file-with-archives') return { sources: [{ file: first, roots: first.doc.children || [] }], multifile: false };
  const tree = scope === null ? null : /^tree([0-9]+)$/.exec(scope);
  if (scope === 'subtree' || scope === 'tree' || tree) {
    const origin = ctx.origin;
    const file = origin ? ctx.files.find((f) => containsHeading(f.doc, origin)) : null;
    if (!origin || !file) return { sources: [{ file: first, roots: [] }], multifile: false };
    const chain = [...ancestorsOf(file.doc, origin), origin];
    let root = origin;
    if (scope === 'tree') root = chain[0];
    else if (tree) {
      const wanted = Number(tree[1]);
      root = chain[0];
      for (let i = chain.length - 2; i >= 0; i--) if (chain[i].level <= wanted) { root = chain[i]; break; }
    }
    return { sources: [{ file, roots: [root] }], multifile: false };
  }
  throw new ClockReportError(`Unknown scope: ${scope ?? '?'}`);
}

/** @param {Doc} doc @param {Heading} target */
function containsHeading(doc, target) {
  /** @param {Heading[]} nodes @returns {boolean} */
  const has = (nodes) => nodes.some((n) => n === target || has(n.children || []));
  return has(doc.children || []);
}

/**
 * The contents of the block (everything between `#+BEGIN:` and `#+END:`) for one run, and the total time it shows.
 * @param {ReportContext} ctx @param {Map<string, Lisp>} p
 * @returns {{ text: string, total: number }}
 */
function blockContent(ctx, p) {
  const step = p.get('step');
  const range = readRange(p, ctx.now);
  if (step && truthy(step)) {
    if (!range.block && !(truthy(p.get('tstart')) && truthy(p.get('tend')))) throw new ClockReportError("Clocktable `:step' can only be used with `:block' or `:tstart', `:tend'");
    return stepContent(ctx, p, range, symbolOf(step));
  }
  const { sources, multifile } = readScope(ctx, p);
  const tables = sources.map(({ file, roots }) => tableData(file, roots, p, range.tstart, range.tend, ctx.now));
  return writeTable(ctx, p, tables, multifile, range.rangeText);
}

/** `org-clocktable-steps`. @param {ReportContext} ctx @param {Map<string, Lisp>} p @param {{ tstart: number | null, tend: number | null }} range @param {string | null} step */
function stepContent(ctx, p, range, step) {
  const headers = /** @type {Record<string, string>} */ ({ day: 'Daily report: ', week: 'Weekly report starting on: ', semimonth: 'Semimonthly report starting on: ', month: 'Monthly report starting on: ', year: 'Annual report starting on: ', quarter: 'Quarterly report starting on: ' });
  if (!step || !(step in headers)) throw new ClockReportError(`Unknown \`:step' specification: ${step}`);
  const skipEmpty = truthy(p.get('stepskip0'));
  const weekStart = numberOf(p.get('wstart')) ?? 1;
  const monthStart = numberOf(p.get('mstart')) ?? 1;
  const startMs = range.tstart ?? new Date(2003, 0, 1).getTime();
  if (range.tend === null) throw new ClockReportError('Wrong type argument: stringp, nil');
  const endMs = range.tend;
  /** @type {string[]} */
  const out = [];
  let start = new Date(startMs);
  /** @type {number | null} */ let lastTotal = null;
  while (start.getTime() < endMs) {
    const d = start.getDate();
    const m = start.getMonth();
    const y = start.getFullYear();
    const dow = start.getDay();
    /** @type {Date} */ let next;
    switch (step) {
      case 'day': next = new Date(y, m, d + 1); break;
      case 'week': next = new Date(y, m, d + (dow === weekStart ? 7 : (((weekStart - dow) % 7) + 7) % 7)); break;
      case 'semimonth': next = new Date(y, d < 16 ? m : m + 1, d < 16 ? 16 : 1); break;
      case 'month': next = new Date(y, m + 1, monthStart); break;
      case 'quarter': next = new Date(y, m + 3, monthStart); break;
      default: next = new Date(y + 1, 0, 1);
    }
    const stepParams = new Map(p);
    stepParams.set('header', { k: 'str', v: '' });
    stepParams.set('step', sym('nil'));
    stepParams.set('block', sym('nil'));
    stepParams.set('tstart', { k: 'str', v: inactiveStamp(start, true) });
    stepParams.set('tend', { k: 'str', v: inactiveStamp(new Date(Math.min(endMs, next.getTime())), true) });
    const sub = blockContent(ctx, stepParams);
    lastTotal = sub.total;
    if (!(skipEmpty && sub.total === 0)) out.push('', headers[step] + inactiveStamp(start, false), sub.text);
    start = next;
  }
  if (skipEmpty && out.length && /** @type {number} */ (lastTotal) === 0) out.push(''); // Org leaves the blank line of a skipped last step
  return { text: out.join('\n'), total: 0 };
}

/**
 * The clock report for `#+BEGIN: clocktable PARAMS`, as the whole dynamic block.
 * @param {{ files: ReportFile[], params: string, now?: Date, origin?: Heading | null }} input
 *   `files` are the open documents (the first is the one the block is in); `origin` is the heading the block is in, for
 *   `:scope tree` and `subtree`.
 * @returns {string}
 */
export function buildClockReport({ files, params, now = new Date(), origin = null }) {
  const p = readClocktableParams(params);
  const ctx = { files, now, origin };
  const { text } = blockContent(ctx, p);
  return `#+BEGIN: clocktable ${params}\n${text}\n#+END:`;
}

export { WEEKDAYS };
