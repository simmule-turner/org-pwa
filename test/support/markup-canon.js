// The app's inline nodes in the token shape tools/gen-oracle-markup.mjs gives Emacs's objects (test/oracle-markup.test.js).
/** @param {any[]} toks */
export function merge(toks) {
  const out = [];
  for (const t of toks) {
    if (t.t === 'text') {
      if (!t.v) continue;
      const last = out[out.length - 1];
      if (last && last.t === 'text') last.v += t.v;
      else out.push({ t: 'text', v: t.v });
    } else out.push(t.c ? { ...t, c: merge(t.c) } : t);
  }
  return out;
}

/** The app's nodes in the shape the fixture has. @param {any[]} nodes @returns {any[]} */
export function canon(nodes) {
  return merge(nodes.flatMap((n) => {
    switch (n.type) {
      case 'text': return { t: 'text', v: n.value };
      case 'bold': case 'italic': case 'underline': return { t: n.type, c: canon(n.children) };
      case 'strikethrough': return { t: 'strike', c: canon(n.children) };
      case 'code': case 'verbatim': return { t: n.type, v: n.value };
      case 'subscript': return { t: 'sub', v: n.raw };
      case 'superscript': return { t: 'sup', v: n.raw };
      case 'latex': return { t: 'latex', v: n.raw };
      case 'link': case 'image': return { t: 'link', raw: n.target, d: n.description ?? null };
      case 'target': case 'radio-target': return { t: 'target', v: n.name };
      case 'footnote-ref': return { t: 'fn', label: n.label, inline: false, c: [] };
      case 'footnote-def': return { t: 'fn', label: n.label || null, inline: true, c: canon(n.children) };
      case 'citation': return [{ t: 'cite', v: n.raw }, { t: 'text', v: ' '.repeat(n.blanks || 0) }]; // the node swallows the blanks after it
      default: return { t: 'text', v: n.raw ?? n.value ?? '' };
    }
  }));
}

