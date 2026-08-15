
/**
 * LaTeX math fragment rendering -- the engine adapter layer.
 *
 * This is the ONLY module in the codebase that references KaTeX
 * (window.katex) directly. Every caller -- in-app paragraph rendering,
 * the read-only Docs viewer, HTML export -- goes through renderMathHtml
 * below, and never touches the underlying engine itself. Detection of
 * what counts as a LaTeX fragment in the first place lives entirely in
 * src/inline-markup.js's own matchLatexFragmentAt, which knows nothing
 * about KaTeX or any other rendering engine at all -- it just produces
 * { type: 'latex', source, displayMode } nodes. That separation is what
 * makes this specific file the sole cost of a future engine swap.
 *
 * ---- Why KaTeX, and the actual cost of swapping to something else ----
 *
 * Chosen for this app specifically because it's synchronous (renders a
 * complete HTML string in one call, no promise/callback), small, and
 * fast -- a good fit for this app's own offline-first, lightweight
 * philosophy. The real tradeoff, worth being explicit about: KaTeX
 * supports a SUBSET of LaTeX, not the full language. Some macros,
 * packages, and less-common environments that a real LaTeX install (or
 * MathJax, which is closer to full coverage and is what real org's own
 * HTML export defaults to) would render, KaTeX will simply error on.
 * If that gap turns out to matter in practice, here's what swapping
 * actually costs:
 *
 * CHEAP (nothing to change): src/inline-markup.js's own fragment
 * DETECTION. Recognizing $...$ / \(...\) / \[...\] / $$...$$ /
 * \begin{env}...\end{env} in the source text has nothing to do with
 * which engine renders the result -- that logic doesn't change at all
 * regardless of what replaces KaTeX.
 *
 * CHEAP (a rewrite confined to this one file): the actual rendering
 * call. renderMathHtml's own public shape -- given a source string and
 * a displayMode flag, return { html, ok } -- doesn't need to change for
 * a different SYNCHRONOUS engine; only this function's own internals
 * (which library global/import to call, how it reports an error) would
 * need rewriting.
 *
 * THE REAL COST: MathJax's modern API is promise-based, not
 * synchronous, so swapping to it specifically (as opposed to some other
 * synchronous alternative) would need this file's own PUBLIC interface
 * to change from synchronous to asynchronous -- and that ripples
 * outward to every caller, which is the one part of this design that
 * genuinely isn't free. Concretely, today's three call sites
 * (renderLatexNode in app.js for in-app + Docs-viewer rendering, and
 * the HTML-export path) would each need to switch from calling
 * renderMathHtml synchronously to awaiting it, and the DOM-building
 * code around them would need a placeholder-node-now,
 * fill-in-when-resolved pattern instead of building the final node in
 * one pass. That's a real, non-trivial change, but a contained and
 * well-understood one -- exactly three call sites, not a rewrite of the
 * detection logic, the paragraph renderer, or the export pipeline
 * itself.
 *
 * ---- Caching ----
 *
 * Rendering the identical source string twice always produces the
 * identical output -- a pure function of (source, displayMode) -- so
 * results are cached here, keyed on both together. This matters once a
 * document has more than a handful of fragments: without it, every
 * render() call re-runs KaTeX on every visible fragment from scratch,
 * even when nothing about that fragment changed. The cache is a plain
 * Map with no eviction; for the realistic range of fragment counts in
 * a single document this is never going to be a meaningful memory
 * concern, and keeping it unbounded avoids the complexity of a real
 * LRU for a problem that doesn't actually exist at this scale.
 */

const renderCache = new Map();

function cacheKey(source, displayMode) {
  return (displayMode ? 'D:' : 'I:') + source;
}

/** True if the KaTeX global is actually available -- false in any
 *  context where index.html's own <script> tag never ran (every
 *  existing Node-based DOM-stub test in this project imports app.js
 *  directly, bypassing index.html entirely, so window.katex is
 *  undefined there unless a test explicitly mocks it in). Exported
 *  so callers can decide how to handle "math rendering isn't
 *  available in this context" themselves, rather than this module
 *  silently pretending it succeeded. */
function isMathEngineAvailable() {
  return typeof window !== 'undefined' && !!window.katex;
}

/** Renders `source` (the raw LaTeX between whichever delimiters
 *  matchLatexFragmentAt found) to an HTML string. `displayMode` picks
 *  KaTeX's own block-vs-inline layout, matching which delimiter form
 *  the fragment used ($$.../\[...\]/\begin{}...\end{} are display;
 *  $.../\(...\) are inline). Returns { html, ok }: ok is false for
 *  either "the engine isn't available in this context at all" or "the
 *  engine rejected this specific LaTeX as invalid" -- callers
 *  (renderLatexNode in app.js) are expected to show a graceful,
 *  visibly-distinct fallback in either case, never let a rendering
 *  failure break the surrounding paragraph's own render entirely. */
function renderMathHtml(source, displayMode) {
  const key = cacheKey(source, displayMode);
  if (renderCache.has(key)) return renderCache.get(key);

  let result;
  if (!isMathEngineAvailable()) {
    result = { html: null, ok: false };
  } else {
    try {
      const html = window.katex.renderToString(source, {
        displayMode,
        throwOnError: true,
        strict: 'ignore', // real org itself doesn't police LaTeX style/deprecation warnings -- 'ignore' matches that, rather than KaTeX's own default of surfacing them as console warnings for every fragment
      });
      result = { html, ok: true };
    } catch {
      result = { html: null, ok: false };
    }
  }

  renderCache.set(key, result);
  return result;
}

export { renderMathHtml, isMathEngineAvailable };
