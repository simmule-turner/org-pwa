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

/** Whether the block's `:noweb` value asks for expansion when it is tangled, run (`eval`) or exported. */
export function nowebAllows(args, context) {
  const values = String((args && args.noweb) || '').split(/\s+/).filter(Boolean);
  return values.some((v) => CONTEXT_VALUES[context].includes(v));
}

/** The text with every `<<reference>>` removed. */
export const stripReferences = (text) => text.replace(BARE_REF_RE, '');

const isStrip = (args) => String((args && args.noweb) || '').split(/\s+/).includes('strip-tangle');

/** The text of a heading's subtree below its heading line, planning line and property drawer. */
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

const findHeadingByCustomId = (blocks, doc, id) => {
  const walk = (list) => {
    for (const h of list) {
      for (const [k, v] of Object.entries(h.properties || {})) if (k.toUpperCase() === 'CUSTOM_ID' && String(v) === id) return h;
      const inner = walk(h.children || []);
      if (inner) return inner;
    }
    return null;
  };
  return walk(doc.children || []);
};

/**
 * @param {object} doc      the document
 * @param {Array} blocks    collectDocumentBlocks(doc)
 * @param {object} block    the block whose body is expanded (one of `blocks`)
 * @param {object} [options] context: 'tangle' (honours :noweb strip-tangle) or 'eval' (default)
 * @returns {string} the body with every reference replaced
 */
export function expandNoweb(doc, blocks, block, { context = 'eval' } = {}) {
  const expandBlock = (target, stack) => {
    if (stack.includes(target)) throw new Error(`The references ${[...stack, target].map((b) => '<<' + (b.name || b.args['noweb-ref'] || 'this block') + '>>').join(' -> ')} go around in a circle`);
    if (stack.length >= MAX_DEPTH) throw new Error('References nest more than ' + MAX_DEPTH + ' levels deep');
    if (context === 'tangle' && stack.length === 0 && isStrip(target.args)) return target.body.replace(BARE_REF_RE, '');
    const usePrefix = !target.args['noweb-prefix'] || !/^(no|nil)$/i.test(target.args['noweb-prefix']);
    return target.body.replace(REF_RE, (whole, prefix, ref, id) => {
      if (/\(.*\)/.test(id)) throw new Error(`<<${id}>>: running a block from a reference is not supported`);
      const expansion = resolve(id, [...stack, target]);
      const text = usePrefix ? expansion.split(/[\n\r]/).join('\n' + prefix) : expansion;
      return prefix + text;
    });
  };
  const bodyOf = (b, stack) => (nowebAllows(b.args, 'eval') ? expandBlock(b, stack) : b.body);
  const resolve = (id, stack) => {
    const heading = findHeadingByCustomId(blocks, doc, id);
    if (heading) return headingText(heading);
    const named = blocks.find((b) => b.name === id && !b.commented);
    if (named) return bodyOf(named, stack);
    const refs = blocks.filter((b) => !b.commented && b.args['noweb-ref'] === id);
    if (refs.length) {
      let out = '';
      refs.forEach((b, i) => {
        out += bodyOf(b, stack);
        if (i < refs.length - 1) out += Object.prototype.hasOwnProperty.call(b.args, 'noweb-sep') ? b.args['noweb-sep'] : '\n';
      });
      return out;
    }
    throw new Error(`Cannot resolve <<${id}>>: no block is named ${id}, none has :noweb-ref ${id}, and no heading has CUSTOM_ID ${id}`);
  };
  return expandBlock(block, []);
}
