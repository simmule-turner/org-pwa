// @ts-check
/** @typedef {import('./types.js').Heading} Heading */
/** @typedef {import('./types.js').Doc} Doc */
/**
 * Noweb references: `<<name>>` inside a source block is replaced by the body of the block named `name`
 * (`#+NAME:`), or by the bodies of all blocks whose `:noweb-ref` is `name`, or by the text of the heading whose
 * CUSTOM_ID is `name`. Text before the reference on its line is put before every line of the expansion, so a
 * reference after `//` comments the whole expansion. Follows Org's org-babel-expand-noweb-references.
 *
 * One difference, on purpose: a reference that matches nothing is an error here. Org (by default) replaces it
 * with nothing, which hides typos.
 */
import { serializeOrg } from './org-parser.js';
import { runElisp } from './babel-elisp.js';
import { parseResultsSpec } from './babel.js';
import { print } from './elisp-data.js';

/** @param {string} text */
const literalValue = (text) => (/^-?\d+(\.\d+)?$/.test(text) ? Number(text) : /^"[\s\S]*"$/.test(text) ? text.slice(1, -1) : text);

// `<<`, a non-blank character, optionally more text ending in a non-blank character, `>>`; the text before the
// reference on its line is captured too.
const REF_RE = /(.*?)(<<([^ \t\n](?:.*?[^ \t\n])?)>>)/g;
const BARE_REF_RE = /<<[^ \t\n](?:.*?[^ \t\n])?>>/g;
const MAX_DEPTH = 20;

const CONTEXT_VALUES = {
  tangle: ['yes', 'tangle', 'no-export', 'strip-export', 'strip-tangle'],
  eval: ['yes', 'no-export', 'strip-export', 'eval', 'strip-tangle'],
  export: ['yes', 'strip-tangle'],
};

/**
 * Whether the block's `:noweb` value asks for expansion when it is tangled, run (`eval`) or exported.
 * @param {Record<string, string> | null | undefined} args
 * @param {string} context
 */
export function nowebAllows(args, context) {
  const values = String((args && args.noweb) || '').split(/\s+/).filter(Boolean);
  return values.some((v) => /** @type {any} */ (CONTEXT_VALUES)[context].includes(v));
}

/**
 * The text with every `<<reference>>` removed.
 * @param {string} text
 */
export const stripReferences = (text) => text.replace(BARE_REF_RE, '');

/** The body as Emacs hands it to Noweb: trailing whitespace and blank lines kept (`emacsBody`), where blocks have it.
 * @param {{ body: string, emacsBody?: string }} block */
const bodyText = (block) => (typeof block.emacsBody === 'string' ? block.emacsBody : block.body);

/** @param {Record<string, string> | null} [args] */
const isStrip = (args) => String((args && args.noweb) || '').split(/\s+/).includes('strip-tangle');

/**
 * The text of a heading's subtree below its heading line, planning line and property drawer.
 * @param {Heading} heading
 */
function headingText(heading) {
  const lines = serializeOrg({ type: 'document', keywords: [], bodyLines: [], children: [heading] }).replace(/\n+$/, '').split('\n');
  let i = 1;
  if (/^\s*(SCHEDULED|DEADLINE|CLOSED):/.test(lines[i] || '')) i++;
  if (/^\s*:PROPERTIES:\s*$/i.test(lines[i] || '')) {
    while (i < lines.length && !/^\s*:END:\s*$/i.test(lines[i])) i++;
    i++;
  }
  return lines.slice(i).join('\n');
}

/**
 * @param {any[]} blocks
 * @param {Doc} doc
 * @param {string} id
 */
const findHeadingByCustomId = (blocks, doc, id) => {
  /** @param {any} [list] */
  const walk = (list) => {
    for (const h of list) {
      for (const [k, v] of Object.entries(h.properties || {})) if (k.toUpperCase() === 'CUSTOM_ID' && String(v) === id) return h;
      /** @type {any} */ const inner = walk(h.children || []);
      if (inner) return inner;
    }
    return null;
  };
  return walk(doc.children || []);
};

/**
 * @param {object} doc      the document
 * @param {Array<any>} blocks    collectDocumentBlocks(doc)
 * @param {object} block    the block whose body is expanded (one of `blocks`)
 * @param {{ context?: string, wrapChunk?: ((referenced: any, text: string, host: any) => string) | null }} [options] context: 'tangle' (honours :noweb strip-tangle) or 'eval' (default); wrapChunk(referenced, text, host):
 *                      with `:comments noweb` on the block that holds the reference, returns the text of the referenced
 *                      block wrapped in its begin and end comments
 * @returns {string} the body with every reference replaced
 */
export function expandNoweb(doc, blocks, block, { context = 'eval', wrapChunk = null } = {}) {
  /**
   * @param {any} [target]
   * @param {any} [stack]
   * @returns {string}
   */
  const expandBlock = (target, stack) => {
    if (stack.includes(target)) throw new Error(`The references ${[...stack, target].map((b) => '<<' + (b.name || b.args['noweb-ref'] || 'this block') + '>>').join(' -> ')} go around in a circle`);
    if (stack.length >= MAX_DEPTH) throw new Error('References nest more than ' + MAX_DEPTH + ' levels deep');
    if (context === 'tangle' && stack.length === 0 && isStrip(target.args)) return bodyText(target).replace(BARE_REF_RE, '');
    const usePrefix = !target.args['noweb-prefix'] || !/^(no|nil)$/i.test(target.args['noweb-prefix']);
    return bodyText(target).replace(REF_RE, (/** @type {any} */ whole, /** @type {string} */ prefix, /** @type {any} */ ref, /** @type {any} */ id) => {
      if (/\(.*\)\s*$/.test(id)) return prefix + callBlock(id);
      const wrap = wrapChunk && context === 'tangle' && target.args.comments === 'noweb' ? (/** @type {any} */ b, /** @type {string} */ text) => wrapChunk(b, text, target) : null;
      const expansion = resolve(id, [...stack, target], wrap);
      const text = usePrefix ? expansion.split(/[\n\r]/).join('\n' + prefix) : expansion;
      return prefix + text;
    });
  };
  /**
   * @param {any} [b]
   * @param {any} [stack]
   * @returns {string}
   */
  const bodyOf = (b, stack) => (nowebAllows(b.args, 'eval') ? expandBlock(b, stack) : bodyText(b));
  /**
   * @param {string} id
   * @param {any} [stack]
   * @param {any} [wrap]
   * @returns {string}
   */
  const resolve = (id, stack, wrap) => {
    /** @param {any} [b]
     * @returns {string} */
    const chunk = (b) => (wrap ? wrap(b, bodyOf(b, stack)) : bodyOf(b, stack));
    const heading = findHeadingByCustomId(blocks, /** @type {Doc} */ (doc), id);
    if (heading) return headingText(heading);
    const named = blocks.find((b) => b.name === id && !b.commented);
    if (named) return chunk(named);
    const refs = blocks.filter((b) => !b.commented && b.args['noweb-ref'] === id);
    if (refs.length) {
      let out = '';
      refs.forEach((b, i) => {
        out += chunk(b);
        if (i < refs.length - 1) out += Object.prototype.hasOwnProperty.call(b.args, 'noweb-sep') ? b.args['noweb-sep'] : '\n';
      });
      return out;
    }
    return ''; // as in Emacs, a reference that matches nothing becomes nothing
  };
  /**
   * `<<name(args)>>`: runs the named block (Lisp only) with the arguments given to its :var variables, in order, and inserts what it returns.
   * @param {string} id
   * @returns {string}
   */
  const callBlock = (id) => {
    const m = /^([^(]*)\((.*)\)\s*$/.exec(id) || [];
    const target = blocks.find((b) => b.name === m[1] && !b.commented);
    if (!target) throw new Error(`Reference \`${m[1]}' not found in this buffer`);
    if (target.lang !== 'emacs-lisp' && target.lang !== 'elisp') throw new Error(`<<${id}>>: only Emacs Lisp blocks can be run from a reference`);
    const names = (target.args.var || []).map((/** @type {string} */ v) => v.split('=')[0]);
    const given = m[2].trim() === '' ? [] : m[2].split(',').map((a) => a.trim());
    if (given.length > names.length) throw new Error(`Variable "${given[names.length]}" must be assigned a default value`);
    /** @type {Record<string, unknown>} */ const vars = {};
    for (const spec of target.args.var || []) {
      const eq = spec.indexOf('=');
      vars[spec.slice(0, eq)] = literalValue(spec.slice(eq + 1));
    }
    given.forEach((a, i) => (vars[names[i]] = literalValue(a)));
    const run = runElisp({ code: bodyText(target), vars, spec: parseResultsSpec('replace') });
    if (!run.ok) throw new Error(run.message);
    return typeof run.value === 'string' ? run.value : print(run.value, false);
  };
  return expandBlock(block, []);
}
