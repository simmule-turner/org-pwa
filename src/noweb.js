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
 * @param {any} args
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

/** @param {any} [args] */
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
  const walk = (/** @type {any} */ list) => {
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
   */
  const expandBlock = (target, stack) => {
    if (stack.includes(target)) throw new Error(`The references ${[...stack, target].map((b) => '<<' + (b.name || b.args['noweb-ref'] || 'this block') + '>>').join(' -> ')} go around in a circle`);
    if (stack.length >= MAX_DEPTH) throw new Error('References nest more than ' + MAX_DEPTH + ' levels deep');
    if (context === 'tangle' && stack.length === 0 && isStrip(target.args)) return target.body.replace(BARE_REF_RE, '');
    const usePrefix = !target.args['noweb-prefix'] || !/^(no|nil)$/i.test(target.args['noweb-prefix']);
    return target.body.replace(REF_RE, (/** @type {any} */ whole, /** @type {string} */ prefix, /** @type {any} */ ref, /** @type {any} */ id) => {
      if (/\(.*\)/.test(id)) throw new Error(`<<${id}>>: running a block from a reference is not supported`);
      const wrap = wrapChunk && context === 'tangle' && target.args.comments === 'noweb' ? (/** @type {any} */ b, /** @type {string} */ text) => wrapChunk(b, text, target) : null;
      const expansion = resolve(id, [...stack, target], wrap);
      const text = usePrefix ? expansion.split(/[\n\r]/).join('\n' + prefix) : expansion;
      return prefix + text;
    });
  };
  /**
   * @param {any} [b]
   * @param {any} [stack]
   */
  const bodyOf = (b, stack) => (nowebAllows(b.args, 'eval') ? expandBlock(b, stack) : b.body);
  /**
   * @param {string} id
   * @param {any} [stack]
   * @param {any} [wrap]
   */
  const resolve = (id, stack, wrap) => {
    /** @param {any} [b] */
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
    throw new Error(`Cannot resolve <<${id}>>: no block is named ${id}, none has :noweb-ref ${id}, and no heading has CUSTOM_ID ${id}`);
  };
  return expandBlock(block, []);
}
